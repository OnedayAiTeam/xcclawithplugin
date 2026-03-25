import WebSocket from "ws";
import { buildLonglinkWsUrl } from "./urls.js";
import type { ClawithMemoryState } from "./memory-state.js";
import type { XcclawithSection } from "./schema.js";
import { DEFAULT_LONGLINK_ACK_TIMEOUT_MS } from "./constants.js";
import { resolveEffectiveSection } from "./schema.js";
import { xcLine } from "./trace-log.js";

type UserDmAckWaiter = {
  targetUserId: string;
  conversationId: string;
  resolve: (v: { conversationId: string }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PeerAckWaiter = {
  targetAgentId: string;
  resolve: (v: { conversationId: string }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type LogSink = {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
  debug?: (m: string) => void;
};

type DownFrame = {
  type?: string;
  id?: string;
  ts?: number;
  payload?: Record<string, unknown>;
};

export type GatewayTaskHandler = (params: {
  eventId: string;
  payload: Record<string, unknown>;
}) => void | Promise<void>;

export class LonglinkHub {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly eff: ReturnType<typeof resolveEffectiveSection>;
  private readonly userDmAckWaiters: UserDmAckWaiter[] = [];
  private readonly peerAckWaiters: PeerAckWaiter[] = [];

  constructor(
    _section: XcclawithSection,
    private readonly memory: ClawithMemoryState,
    private readonly log: LogSink,
    private readonly onGatewayTask: GatewayTaskHandler,
    private readonly abortSignal: AbortSignal,
  ) {
    this.eff = resolveEffectiveSection(_section);
    this.log.info(
      xcLine("longlink.hub", "constructor", {
        host: this.eff.host,
        longlinkPort: this.eff.longlinkPort,
        directoryPort: this.eff.directoryPort,
        userIdLen: this.eff.userId.length,
        apiKeyLen: this.eff.apiKey.length,
      }),
    );
  }

  start(): void {
    this.stopped = false;
    this.log.info(xcLine("longlink.hub", "start", { note: "connect() scheduled, abort listener registered" }));
    this.connect();
    this.abortSignal.addEventListener(
      "abort",
      () => {
        this.log.warn(xcLine("longlink.hub", "abort_signal", { action: "stop()" }));
        this.stop();
      },
      { once: true },
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.log.info(xcLine("longlink.hub", "stop.cleared_reconnect_timer", {}));
    }
    if (this.ws) {
      try {
        const rs = this.ws.readyState;
        this.log.info(xcLine("longlink.hub", "stop.closing_ws", { readyState: rs }));
        this.ws.close();
      } catch (e) {
        this.log.warn(xcLine("longlink.hub", "stop.ws_close_error", { err: String(e) }));
      }
      this.ws = null;
    }
    this.log.info(xcLine("longlink.hub", "stop.complete", { meaning: "no more reconnects until start()" }));
    this.rejectAllAckWaiters(new Error("xcclawith_longlink_stopped"));
  }

  private rejectAllAckWaiters(err: Error): void {
    for (const w of this.userDmAckWaiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    for (const w of this.peerAckWaiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  /**
   * Match outbound `sendUserDmAwaitAck` waiters. Clawith may omit `target_user_id` on `user_dm_ok`
   * (payload only `source` + `conversation_id`); then we match by `conversation_id` and use the waiter's user id.
   * @returns settled users.id (lowercase) if a waiter was resolved, else null
   */
  private settleUserDmAckSuccess(cidRaw: string, uidFromPayload?: string): string | null {
    const cid = cidRaw.trim().toLowerCase();
    let idx = -1;
    if (uidFromPayload?.trim()) {
      const uid = uidFromPayload.trim().toLowerCase();
      idx = this.userDmAckWaiters.findIndex(
        (w) => w.targetUserId === uid && w.conversationId === cid,
      );
    }
    if (idx < 0) {
      idx = this.userDmAckWaiters.findIndex((w) => w.conversationId === cid);
    }
    if (idx < 0) return null;
    const w = this.userDmAckWaiters.splice(idx, 1)[0]!;
    clearTimeout(w.timer);
    const uidMem = uidFromPayload?.trim()
      ? uidFromPayload.trim().toLowerCase()
      : w.targetUserId;
    this.memory.setUserConversation(uidMem, cidRaw.trim());
    w.resolve({ conversationId: cidRaw.trim() });
    return uidMem;
  }

  private settleUserDmFailed(message: string, targetHint?: string, conversationHint?: string): void {
    if (this.userDmAckWaiters.length === 0) return;
    let idx = -1;
    if (targetHint) {
      const t = targetHint.trim().toLowerCase();
      idx = this.userDmAckWaiters.findIndex((w) => w.targetUserId === t);
    }
    if (idx < 0 && conversationHint?.trim()) {
      const c = conversationHint.trim().toLowerCase();
      idx = this.userDmAckWaiters.findIndex((w) => w.conversationId === c);
    }
    if (idx < 0) idx = 0;
    const w = this.userDmAckWaiters.splice(idx, 1)[0]!;
    clearTimeout(w.timer);
    w.reject(new Error(`xcclawith_user_dm_failed: ${message}`));
    if (this.userDmAckWaiters.length > 0) {
      this.log.warn(
        xcLine("longlink.ack", "user_dm_failed.fifo_used_with_pending", {
          remaining: this.userDmAckWaiters.length,
          meaning: "multiple user_dm in flight; confirm serial sends or match by target if server adds fields",
        }),
      );
    }
  }

  private settlePeerOk(aidRaw: string, cidRaw: string): void {
    const aid = aidRaw.trim().toLowerCase();
    const cid = cidRaw.trim();
    const idx = this.peerAckWaiters.findIndex((w) => w.targetAgentId === aid);
    if (idx >= 0) {
      const w = this.peerAckWaiters.splice(idx, 1)[0]!;
      clearTimeout(w.timer);
      w.resolve({ conversationId: cid });
    }
  }

  private settlePeerFailed(message: string, agentHint?: string): void {
    if (this.peerAckWaiters.length === 0) return;
    let idx = -1;
    if (agentHint) {
      const a = agentHint.trim().toLowerCase();
      idx = this.peerAckWaiters.findIndex((w) => w.targetAgentId === a);
    }
    if (idx < 0) idx = 0;
    const w = this.peerAckWaiters.splice(idx, 1)[0]!;
    clearTimeout(w.timer);
    w.reject(new Error(`xcclawith_peer_message_failed: ${message}`));
  }

  private scheduleReconnect(ms: number): void {
    if (this.stopped) {
      this.log.debug?.(xcLine("longlink.hub", "reconnect.skipped_stopped", { ms }));
      return;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.log.warn(
      xcLine("longlink.hub", "reconnect.scheduled", {
        delayMs: ms,
        reason: "socket closed or failed; will call connect() again",
      }),
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, ms);
  }

  private connect(): void {
    if (this.stopped) {
      this.log.debug?.(xcLine("longlink.hub", "connect.skipped_stopped", {}));
      return;
    }
    const url = buildLonglinkWsUrl(
      this.eff.host,
      this.eff.longlinkPort,
      this.eff.apiKey,
      this.eff.userId,
    );
    this.log.info(
      xcLine("longlink.ws", "connect.attempt", {
        scrubbedUrl: scrubUrl(url),
        meaning: "opening WebSocket to Clawith longlink",
      }),
    );

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => {
      this.log.info(
        xcLine("longlink.ws", "open", {
          readyState: ws.readyState,
          meaning: "TLS/WS handshake ok; can send clawith.user_dm / peer_message",
        }),
      );
    });

    ws.on("message", (data) => {
      const raw = String(data);
      this.log.debug?.(
        xcLine("longlink.ws", "message.raw", { chars: raw.length, preview: raw.slice(0, 120) }),
      );
      void this.handleRawMessage(raw);
    });

    ws.on("error", (err) => {
      this.log.error(
        xcLine("longlink.ws", "socket_error", {
          err: String(err),
          meaning: "network/TLS error; close event usually follows",
        }),
      );
    });

    ws.on("close", (code, reason) => {
      this.log.warn(
        xcLine("longlink.ws", "close", {
          code,
          reason: reason.toString(),
          stopped: this.stopped,
          meaning: this.stopped ? "expected after stop()" : "connection lost; scheduling reconnect",
        }),
      );
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect(3_000);
    });
  }

  private async handleRawMessage(raw: string): Promise<void> {
    let frame: DownFrame;
    try {
      frame = JSON.parse(raw) as DownFrame;
    } catch (e) {
      this.log.warn(
        xcLine("longlink.rx", "json_parse_error", {
          preview: raw.slice(0, 200),
          err: String(e),
          meaning: "server sent non-JSON; ignored",
        }),
      );
      return;
    }

    const t = frame.type;
    this.log.debug?.(
      xcLine("longlink.rx", "frame.parsed", {
        type: t,
        id: frame.id ?? null,
        ts: frame.ts ?? null,
      }),
    );

    if (t === "session.ready") {
      this.log.info(xcLine("longlink.rx", "session.ready.top_level", { frameId: frame.id ?? "" }));
      return;
    }

    if (t === "heartbeat" || t === "ping" || t === "pong" || t === "ack") {
      this.log.debug?.(xcLine("longlink.rx", "control_frame_ignored", { type: t }));
      return;
    }

    if (t !== "event") {
      this.log.warn(
        xcLine("longlink.rx", "unknown_frame_type", {
          type: t,
          id: frame.id,
          meaning: "not handled by xcclawith; check Clawith protocol version",
        }),
      );
      return;
    }

    if (frame.payload && typeof frame.payload === "object") {
      const src = frame.payload.source;
      const payloadKeys = Object.keys(frame.payload).join(",");
      this.log.info(
        xcLine("longlink.rx", "event", {
          source: String(src),
          eventFrameId: frame.id ?? "",
          payloadKeys,
        }),
      );

      if (src === "session.ready") {
        this.log.info(xcLine("longlink.rx", "session.ready.in_event", { frameId: frame.id ?? "" }));
        return;
      }

      const eventId = frame.id;
      if (typeof eventId !== "string" || !eventId) {
        this.log.warn(
          xcLine("longlink.rx", "event.missing_event_id", {
            source: String(src),
            meaning: "cannot correlate; gateway.task dispatch skipped",
          }),
        );
        return;
      }

      if (src === "gateway.task") {
        this.log.info(
          xcLine("longlink.rx", "gateway.task.dispatch_begin", {
            eventId,
            payloadKeys,
          }),
        );
        try {
          await this.onGatewayTask({ eventId, payload: frame.payload });
          this.log.info(
            xcLine("longlink.rx", "gateway.task.dispatch_end", { eventId, status: "ok" }),
          );
        } catch (e) {
          this.log.error(
            xcLine("longlink.rx", "gateway.task.dispatch_end", {
              eventId,
              status: "error",
              err: String(e),
              meaning: "handler threw; error logged, longlink stays up",
            }),
          );
        }
        return;
      }

      if (src === "clawith.user_dm_ok") {
        const cid = frame.payload.conversation_id;
        const uid = frame.payload.target_user_id;
        if (typeof cid === "string" && cid.trim()) {
          const uidStr = typeof uid === "string" && uid.trim() ? uid : undefined;
          const settledUid = this.settleUserDmAckSuccess(cid, uidStr);
          if (settledUid === null) {
            if (uidStr) {
              this.memory.setUserConversation(uidStr, cid);
            } else {
              const rev = this.memory.getUserIdForConversation(cid);
              if (rev) this.memory.setUserConversation(rev, cid);
            }
          }
          this.log.info(
            xcLine("longlink.rx", "user_dm_ok", {
              target_user_id: settledUid ?? uidStr ?? "(omitted_by_server; matched_by_conversation_or_memory)",
              conversation_id: cid,
              payloadKeys,
              meaning: "Clawith accepted outbound user_dm",
            }),
          );
        } else {
          this.log.warn(
            xcLine("longlink.rx", "user_dm_ok.malformed", {
              hasCid: typeof cid === "string" && cid.trim().length > 0,
              payloadKeys,
              meaning: "missing conversation_id",
            }),
          );
        }
        return;
      }

      if (src === "clawith.user_dm_failed") {
        const msg = String(frame.payload.message ?? "");
        const tid = frame.payload.target_user_id;
        const cid = frame.payload.conversation_id;
        this.log.warn(
          xcLine("longlink.rx", "user_dm_failed", {
            message: msg,
            target_user_id: typeof tid === "string" ? tid : null,
            conversation_id: typeof cid === "string" ? cid : null,
            payloadKeys,
            meaning:
              msg.includes("not found") || msg.includes("Not found")
                ? "users.id unknown to gateway or not visible to this bot"
                : "see message from Clawith",
          }),
        );
        this.settleUserDmFailed(
          msg,
          typeof tid === "string" ? tid : undefined,
          typeof cid === "string" ? cid : undefined,
        );
        return;
      }

      if (src === "clawith.peer_message_ok") {
        const cid = frame.payload.conversation_id;
        const aid = frame.payload.target_agent_id;
        if (typeof cid === "string" && typeof aid === "string") {
          this.memory.setPeerConversation(aid, cid);
          this.settlePeerOk(aid, cid);
          this.log.info(
            xcLine("longlink.rx", "peer_message_ok", {
              target_agent_id: aid,
              conversation_id: cid,
            }),
          );
        } else {
          this.log.warn(
            xcLine("longlink.rx", "peer_message_ok.malformed", { payloadKeys }),
          );
        }
        return;
      }

      if (src === "clawith.peer_message_failed") {
        const msg = String(frame.payload.message ?? "");
        const aid = frame.payload.target_agent_id;
        this.log.warn(
          xcLine("longlink.rx", "peer_message_failed", {
            message: msg,
            code: String(frame.payload.code),
            httpStatus: String(frame.payload.httpStatus),
            retry_after_seconds: String(frame.payload.retry_after_seconds),
            payloadKeys,
          }),
        );
        this.settlePeerFailed(msg, typeof aid === "string" ? aid : undefined);
        return;
      }

      this.log.warn(
        xcLine("longlink.rx", "event.unhandled_source", {
          source: String(src),
          eventId,
          payloadKeys,
          meaning: "add handler in longlink-hub if this source is expected",
        }),
      );
    } else {
      this.log.warn(
        xcLine("longlink.rx", "event.bad_payload", {
          type: t,
          meaning: "type=event but payload missing or not object",
        }),
      );
    }
  }

  /**
   * Wait until the current socket is OPEN (e.g. after {@link start} or reconnect).
   * Rejects if the socket is missing, errors, closes before open, or {@link timeoutMs} elapses.
   */
  waitForOpen(timeoutMs: number): Promise<void> {
    const ws = this.ws;
    if (!ws) {
      this.log.error(
        xcLine("longlink.ws", "waitForOpen.reject", {
          reason: "no_socket",
          meaning: "connect() not run yet or stop() cleared ws",
        }),
      );
      return Promise.reject(new Error("xcclawith_longlink_no_socket"));
    }
    if (ws.readyState === WebSocket.OPEN) {
      this.log.debug?.(
        xcLine("longlink.ws", "waitForOpen.already_open", { readyState: ws.readyState }),
      );
      return Promise.resolve();
    }

    this.log.info(
      xcLine("longlink.ws", "waitForOpen.blocking", {
        readyState: ws.readyState,
        timeoutMs,
        meaning: "0=CONNECTING 1=OPEN 2=CLOSING 3=CLOSED",
      }),
    );

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.removeListener("open", onOpen);
        ws.removeListener("error", onErr);
        ws.removeListener("close", onClose);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          this.log.error(
            xcLine("longlink.ws", "waitForOpen.timeout", {
              timeoutMs,
              readyState: ws.readyState,
            }),
          );
          reject(new Error(`xcclawith_longlink_connect_timeout_${timeoutMs}ms`));
        });
      }, timeoutMs);

      const onOpen = () =>
        finish(() => {
          this.log.info(xcLine("longlink.ws", "waitForOpen.resolved_open", {}));
          resolve();
        });
      const onErr = () =>
        finish(() => {
          this.log.error(xcLine("longlink.ws", "waitForOpen.resolved_error", {}));
          reject(new Error("xcclawith_longlink_ws_error"));
        });
      const onClose = () =>
        finish(() => {
          this.log.error(xcLine("longlink.ws", "waitForOpen.resolved_close_before_open", {}));
          reject(new Error("xcclawith_longlink_ws_closed_before_open"));
        });

      ws.on("open", onOpen);
      ws.on("error", onErr);
      ws.on("close", onClose);

      if (ws.readyState === WebSocket.OPEN) {
        finish(() => resolve());
      }
    });
  }

  send(obj: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log.warn(
        xcLine("longlink.tx", "send.skipped_not_open", {
          type: String(obj.type),
          hasWs: Boolean(this.ws),
          readyState: this.ws?.readyState ?? -1,
          meaning: "frame dropped; socket not OPEN",
        }),
      );
      return;
    }
    const json = JSON.stringify(obj);
    this.ws.send(json);
    this.log.info(
      xcLine("longlink.tx", "send.enqueued", {
        type: String(obj.type),
        jsonChars: json.length,
      }),
    );
  }

  sendReport(params: {
    messageId: string;
    result: string;
    requiresReply: boolean;
  }): void {
    this.send({
      type: "report",
      message_id: params.messageId,
      result: params.result,
      requires_reply: params.requiresReply,
    });
  }

  private transmitUserDm(params: {
    targetUserId: string;
    content: string;
    conversationId?: string;
    messageId?: string;
  }): void {
    this.log.info(
      xcLine("longlink.tx", "sendUserDm.build", {
        target_user_id: params.targetUserId,
        conversation_id: params.conversationId ?? null,
        message_id: params.messageId ?? null,
        content_len: params.content.length,
        meaning: "upstream clawith.user_dm; await user_dm_ok/failed on RX",
      }),
    );
    const body: Record<string, unknown> = {
      type: "clawith.user_dm",
      target_user_id: params.targetUserId,
      content: params.content,
    };
    if (params.conversationId) body.conversation_id = params.conversationId;
    if (params.messageId) body.message_id = params.messageId;
    this.send(body);
  }

  /** Fire-and-forget (no ack wait). Prefer {@link sendUserDmAwaitAck} for outbound tooling. */
  sendUserDm(params: {
    targetUserId: string;
    content: string;
    conversationId?: string;
    messageId?: string;
  }): void {
    this.transmitUserDm(params);
  }

  /**
   * Sends `clawith.user_dm` and resolves after `clawith.user_dm_ok`, or rejects on `user_dm_failed` / timeout.
   */
  sendUserDmAwaitAck(
    params: {
      targetUserId: string;
      content: string;
      conversationId?: string;
      messageId?: string;
    },
    timeoutMs: number = DEFAULT_LONGLINK_ACK_TIMEOUT_MS,
  ): Promise<{ conversationId: string }> {
    const uid = params.targetUserId.trim().toLowerCase();
    const cid = (params.conversationId ?? "").trim().toLowerCase();
    return new Promise((resolve, reject) => {
      let holder: UserDmAckWaiter;
      const timer = setTimeout(() => {
        const i = this.userDmAckWaiters.indexOf(holder);
        if (i >= 0) this.userDmAckWaiters.splice(i, 1);
        reject(new Error(`xcclawith_user_dm_ack_timeout ${timeoutMs}ms`));
      }, timeoutMs);
      holder = {
        targetUserId: uid,
        conversationId: cid,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
      };
      this.userDmAckWaiters.push(holder);
      this.transmitUserDm(params);
    });
  }

  private transmitPeerMessage(params: {
    targetAgentId: string;
    content: string;
    requiresReply: boolean;
    conversationId?: string;
    newSessionId?: string;
  }): void {
    this.log.info(
      xcLine("longlink.tx", "sendPeerMessage.build", {
        target_agent_id: params.targetAgentId,
        requires_reply: params.requiresReply,
        conversation_id: params.conversationId ?? null,
        new_session_id: params.newSessionId ?? null,
        content_len: params.content.length,
      }),
    );
    const body: Record<string, unknown> = {
      type: "clawith.peer_message",
      target_agent_id: params.targetAgentId,
      content: params.content,
      requires_reply: params.requiresReply,
    };
    if (params.conversationId) body.conversation_id = params.conversationId;
    if (params.newSessionId) body.new_session_id = params.newSessionId;
    this.send(body);
  }

  sendPeerMessage(params: {
    targetAgentId: string;
    content: string;
    requiresReply: boolean;
    conversationId?: string;
    newSessionId?: string;
  }): void {
    this.transmitPeerMessage(params);
  }

  /**
   * Sends `clawith.peer_message` and resolves after `peer_message_ok`, or rejects on failed / timeout.
   */
  sendPeerMessageAwaitAck(
    params: {
      targetAgentId: string;
      content: string;
      requiresReply: boolean;
      conversationId?: string;
      newSessionId?: string;
    },
    timeoutMs: number = DEFAULT_LONGLINK_ACK_TIMEOUT_MS,
  ): Promise<{ conversationId: string }> {
    const aid = params.targetAgentId.trim().toLowerCase();
    return new Promise((resolve, reject) => {
      let holder: PeerAckWaiter;
      const timer = setTimeout(() => {
        const i = this.peerAckWaiters.indexOf(holder);
        if (i >= 0) this.peerAckWaiters.splice(i, 1);
        reject(new Error(`xcclawith_peer_ack_timeout ${timeoutMs}ms`));
      }, timeoutMs);
      holder = {
        targetAgentId: aid,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
      };
      this.peerAckWaiters.push(holder);
      this.transmitPeerMessage(params);
    });
  }
}

function scrubUrl(u: string): string {
  try {
    const x = new URL(u);
    if (x.searchParams.has("apiKey")) x.searchParams.set("apiKey", "***");
    return x.toString();
  } catch {
    return "invalid-url";
  }
}

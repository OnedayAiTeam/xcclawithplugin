import WebSocket from "ws";
import { buildLonglinkWsUrl } from "./urls.js";
import type { ClawithMemoryState } from "./memory-state.js";
import type { XcclawithSection } from "./schema.js";
import { resolveEffectiveSection } from "./schema.js";

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

  constructor(
    _section: XcclawithSection,
    private readonly memory: ClawithMemoryState,
    private readonly log: LogSink,
    private readonly onGatewayTask: GatewayTaskHandler,
    private readonly abortSignal: AbortSignal,
  ) {
    this.eff = resolveEffectiveSection(_section);
  }

  start(): void {
    this.stopped = false;
    this.connect();
    this.abortSignal.addEventListener(
      "abort",
      () => {
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
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.log.info("longlink.stopped");
  }

  private scheduleReconnect(ms: number): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, ms);
  }

  private connect(): void {
    if (this.stopped) return;
    const url = buildLonglinkWsUrl(
      this.eff.host,
      this.eff.longlinkPort,
      this.eff.apiKey,
      this.eff.userId,
    );
    this.log.info(`longlink.connecting url=${scrubUrl(url)}`);

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => {
      this.log.info("longlink.open");
    });

    ws.on("message", (data) => {
      void this.handleRawMessage(String(data));
    });

    ws.on("error", (err) => {
      this.log.error(`longlink.ws_error ${String(err)}`);
    });

    ws.on("close", (code, reason) => {
      this.log.warn(`longlink.close code=${code} reason=${reason.toString()}`);
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect(3_000);
    });
  }

  private async handleRawMessage(raw: string): Promise<void> {
    let frame: DownFrame;
    try {
      frame = JSON.parse(raw) as DownFrame;
    } catch {
      this.log.warn(`longlink.json_parse_error preview=${raw.slice(0, 200)}`);
      return;
    }

    const t = frame.type;
    this.log.debug?.(`longlink.frame type=${t} id=${frame.id ?? ""}`);

    if (t === "session.ready") {
      this.log.info(`longlink.session_ready id=${frame.id ?? ""}`);
      return;
    }

    if (t === "heartbeat" || t === "ping" || t === "pong" || t === "ack") {
      return;
    }

    if (t === "event" && frame.payload && typeof frame.payload === "object") {
      const src = frame.payload.source;
      if (src === "session.ready") {
        this.log.info(`longlink.session_ready id=${frame.id ?? ""}`);
        return;
      }

      const eventId = frame.id;
      if (typeof eventId !== "string" || !eventId) {
        this.log.warn(`longlink.event_missing_id source=${String(src)}`);
        return;
      }

      if (src === "gateway.task") {
        await this.onGatewayTask({ eventId, payload: frame.payload });
        return;
      }

      if (src === "clawith.user_dm_ok") {
        const cid = frame.payload.conversation_id;
        const uid = frame.payload.target_user_id;
        if (typeof cid === "string" && typeof uid === "string") {
          this.memory.setUserConversation(uid, cid);
          this.log.debug?.(`longlink.user_dm_ok userId=${uid} conversationId=${cid}`);
        }
        return;
      }

      if (src === "clawith.user_dm_failed") {
        const msg = String(frame.payload.message ?? "");
        const tid = frame.payload.target_user_id;
        const cid = frame.payload.conversation_id;
        this.log.warn(
          `longlink.user_dm_failed message=${msg}` +
            (typeof tid === "string" ? ` target_user_id=${tid}` : "") +
            (typeof cid === "string" ? ` conversation_id=${cid}` : ""),
        );
        return;
      }

      if (src === "clawith.peer_message_ok") {
        const cid = frame.payload.conversation_id;
        const aid = frame.payload.target_agent_id;
        if (typeof cid === "string" && typeof aid === "string") {
          this.memory.setPeerConversation(aid, cid);
          this.log.debug?.(`longlink.peer_ok agentId=${aid} conversationId=${cid}`);
        }
        return;
      }

      if (src === "clawith.peer_message_failed") {
        this.log.warn(
          `longlink.peer_failed message=${String(frame.payload.message)} code=${String(frame.payload.code)} http=${String(frame.payload.httpStatus)} retry_after=${String(frame.payload.retry_after_seconds)}`,
        );
        return;
      }

    }
  }

  /**
   * Wait until the current socket is OPEN (e.g. after {@link start} or reconnect).
   * Rejects if the socket is missing, errors, closes before open, or {@link timeoutMs} elapses.
   */
  waitForOpen(timeoutMs: number): Promise<void> {
    const ws = this.ws;
    if (!ws) {
      return Promise.reject(new Error("xcclawith_longlink_no_socket"));
    }
    if (ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

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
        finish(() =>
          reject(new Error(`xcclawith_longlink_connect_timeout_${timeoutMs}ms`)),
        );
      }, timeoutMs);

      const onOpen = () => finish(() => resolve());
      const onErr = () => finish(() => reject(new Error("xcclawith_longlink_ws_error")));
      const onClose = () =>
        finish(() => reject(new Error("xcclawith_longlink_ws_closed_before_open")));

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
      this.log.warn(`longlink.send_skipped_not_open type=${String(obj.type)}`);
      return;
    }
    this.ws.send(JSON.stringify(obj));
    this.log.debug?.(`longlink.send type=${String(obj.type)}`);
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

  sendUserDm(params: {
    targetUserId: string;
    content: string;
    conversationId?: string;
    messageId?: string;
  }): void {
    const body: Record<string, unknown> = {
      type: "clawith.user_dm",
      target_user_id: params.targetUserId,
      content: params.content,
    };
    if (params.conversationId) body.conversation_id = params.conversationId;
    if (params.messageId) body.message_id = params.messageId;
    this.send(body);
  }

  sendPeerMessage(params: {
    targetAgentId: string;
    content: string;
    requiresReply: boolean;
    conversationId?: string;
    newSessionId?: string;
  }): void {
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

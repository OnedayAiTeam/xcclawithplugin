import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/channel-inbound";
import type { ChannelGatewayContext, OpenClawConfig } from "openclaw/plugin-sdk";
import type { RuntimeEnv } from "openclaw/plugin-sdk";
import type { ChatType } from "openclaw/plugin-sdk/channel-runtime";
import {
  createChannelPluginBase,
  createChatChannelPlugin,
} from "openclaw/plugin-sdk/core";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { CHANNEL_ID } from "./constants.js";
import {
  extractConversationIdFromTaskPayload,
  extractRequiresReplyFromTaskPayload,
  extractTaskText,
  extractTaskUserIdFromPayload,
  formatGatewayTaskDiagnostics,
} from "./gateway-payload.js";
import { postGatewayConverter } from "./converter-api.js";
import { fetchGatewayDirectory } from "./directory-api.js";
import { resolveOutboundTargetToUserId } from "./directory-resolve.js";
import { ensureXcclawithLonglinkHub } from "./ensure-longlink.js";
import { getMemory, removeHub, setHub } from "./hub-registry.js";
import { LonglinkHub } from "./longlink-hub.js";
import { isClawithUserIdShape } from "./clawith-target.js";
import { resolveEffectiveSection, xcclawithSectionSchema, channelConfigSchema } from "./schema.js";
import type { XcclawithSection } from "./schema.js";
import { sessionPeerFromConversationId } from "./session-keys.js";
import { xcBoth, xcConsole } from "./trace-log.js";

export type ResolvedXcclawith = XcclawithSection & { accountId: string };

/**
 * Core routing uses `cfg.session?.dmScope ?? "main"`, which maps every inbound DM to
 * `agent:<agentId>:main` and mixes all Clawith web users into one session.
 * When `session.dmScope` is **omitted**, we inject **`per-channel-peer`** so keys look like
 * `agent:<agentId>:xcclawith:direct:clawith-<conversation_id>` (channel id is {@link CHANNEL_ID}).
 * Any explicit `session.dmScope` in `openclaw.json` is left unchanged.
 */
function cfgWithXcclawithDmScopeDefault(cfg: OpenClawConfig): OpenClawConfig {
  if (cfg.session?.dmScope !== undefined) {
    return cfg;
  }
  return {
    ...cfg,
    session: {
      ...(cfg.session ?? {}),
      dmScope: "per-channel-peer",
    },
  };
}

function readSectionRaw(cfg: OpenClawConfig): unknown {
  return (cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID];
}

/** OpenClaw keeps the `startAccount` promise open until the channel stops; resolving too early triggers gateway auto-restart. */
function untilAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedXcclawith {
  const id = normalizeAccountId(accountId);
  const raw = readSectionRaw(cfg);
  const section = xcclawithSectionSchema.parse(raw ?? {});
  return { ...section, accountId: id };
}

const baseCreated = createChannelPluginBase<ResolvedXcclawith>({
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "Clawith",
    selectionLabel: "Clawith (Longlink)",
    docsPath: "/channels/clawith",
    blurb: "Clawith web chat and peer OpenClaw over Longlink.",
  },
  configSchema: channelConfigSchema,
  config: {
    listAccountIds: (cfg) => {
      const raw = readSectionRaw(cfg);
      const r = xcclawithSectionSchema.safeParse(raw);
      if (!r.success) return [];
      return [DEFAULT_ACCOUNT_ID];
    },
    resolveAccount,
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => Boolean(account.host?.trim() && account.apiKey),
    unconfiguredReason: (account) =>
      !account.host?.trim() || !account.apiKey ? "host_and_apikey_required" : "",
    inspectAccount: (cfg, accountId) => {
      const acc = resolveAccount(cfg, accountId);
      return {
        enabled: true,
        configured: Boolean(acc.host?.trim() && acc.apiKey),
        host: acc.host ? "set" : "missing",
        apiKey: acc.apiKey ? "set" : "missing",
      };
    },
  },
  setup: {
    applyAccountConfig: ({ cfg, accountId: _accountId, input }) => {
      const channels = {
        ...(cfg.channels as Record<string, unknown>),
      } as Record<string, unknown>;
      const cur = {
        ...(channels[CHANNEL_ID] as Record<string, unknown> | undefined),
      } as Record<string, unknown>;
      const bag = input as Record<string, unknown>;
      if (typeof bag.host === "string") cur.host = bag.host;
      if (typeof bag.apiKey === "string") cur.apiKey = bag.apiKey;
      if (input.token) cur.apiKey = input.token;
      if (typeof bag.directoryPort === "number") cur.directoryPort = bag.directoryPort;
      if (typeof bag.longlinkPort === "number") cur.longlinkPort = bag.longlinkPort;
      if (typeof bag.userId === "string") cur.userId = bag.userId;
      if (typeof input.userId === "string") cur.userId = input.userId;
      channels[CHANNEL_ID] = cur;
      return { ...cfg, channels } as OpenClawConfig;
    },
  },
});

const base = {
  ...baseCreated,
  capabilities: { chatTypes: ["direct" as ChatType] },
  config: baseCreated.config!,
};

const chatPlugin = createChatChannelPlugin<ResolvedXcclawith>({
  base,
  security: {
    dm: {
      channelKey: CHANNEL_ID,
      resolvePolicy: () => "open",
      resolveAllowFrom: () => ["*"],
      defaultPolicy: "open",
    },
  },
  threading: { topLevelReplyToMode: "off" },
  outbound: {
    base: {
      deliveryMode: "direct",
    },
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: async (params) => {
        const accountId = normalizeAccountId(params.accountId);
        xcConsole("info", "outbound.sendText", "step1.entry", {
          accountId,
          rawTo: params.to,
          openclawThreadId: params.threadId ?? null,
          note: "threadId ignored for Clawith routing; conversation_id is keyed by `to` only",
          textLen: (params.text ?? "").length,
        });
        xcConsole("info", "outbound.sendText", "step2.ensure_longlink", { accountId });
        const hub = await ensureXcclawithLonglinkHub({
          cfg: params.cfg,
          accountId,
          connectTimeoutMs: 25_000,
        });
        xcConsole("info", "outbound.sendText", "step3.hub_ready", { accountId });
        const memory = getMemory(accountId);
        const sectionParsed = xcclawithSectionSchema.safeParse(readSectionRaw(params.cfg));
        if (!sectionParsed.success) {
          xcConsole("error", "outbound.sendText", "step3b.config_invalid", {
            issues: sectionParsed.error.issues,
          });
          throw new Error(
            `xcclawith_config_invalid ${JSON.stringify(sectionParsed.error.issues)}`,
          );
        }
        xcConsole("info", "outbound.sendText", "step4.resolve_to", {
          note: "UUID or user:<uuid> fast path; else GET /api/gateway/directory q=needle (中文/拼音/@昵称等)",
        });
        const effSection = resolveEffectiveSection(sectionParsed.data);
        const targetUserId = await resolveOutboundTargetToUserId({
          rawTo: params.to,
          section: effSection,
        });
        const existing = memory.getUserConversation(targetUserId);
        const conversationId =
          existing ?? (await postGatewayConverter({ section: effSection, receiverId: targetUserId }));
        xcConsole("info", "outbound.sendText", "step5.conversation_chosen", {
          targetUserId,
          storedConversation: existing ?? null,
          chosenConversationId: conversationId,
          source: existing ? "memory_by_to_uuid" : "gateway_converter",
        });
        memory.setUserConversation2(targetUserId, conversationId);
        xcConsole("info", "outbound.sendText", "step6.memory_updated", { targetUserId, conversationId });
        xcConsole("info", "outbound.sendText", "step7.longlink_sendUserDm_await_ack", {
          note: "throws if user_dm_failed or ack timeout",
        });
        const ack = await hub.sendUserDmAwaitAck({
          targetUserId,
          content: params.text,
          conversationId,
        });
        const finalConv = ack.conversationId.trim();
        memory.setUserConversation(targetUserId, finalConv);
        const messageId = `xcclawith-dm-${Date.now()}`;
        xcConsole("info", "outbound.sendText", "step8.return_to_openclaw", {
          messageId,
          conversationId: finalConv,
          meaning: "Clawith returned user_dm_ok",
        });
        return { channel: CHANNEL_ID, messageId, conversationId: finalConv };
      },
    },
  },
});

export const xcclawithChannelPlugin = {
  ...chatPlugin,
  messaging: {
    targetResolver: {
      looksLikeId: (_raw: string, normalized?: string) => {
        const s = (normalized ?? _raw).trim();
        if (!s) return false;
        let x = s;
        if (x.toLowerCase().startsWith("user:")) x = x.slice(5).trim();
        if (x && isClawithUserIdShape(x.toLowerCase())) return true;
        return s.length > 0;
      },
      hint: "Clawith: `to` = UUID (user id or agent id per your platform; disjoint) or names via directory. Per-`to` conversation reuse uses plugin memory keyed by that UUID only — OpenClaw `threadId` is not used. Peer: xcclawith_peer_message + directory `online`.",
    },
  },
  agentPrompt: {
    messageToolHints: () => [
      "Clawith / xcclawith: Message `to` may be user:<uuid>, bare users.id, or 中文 / 拼音 / @昵称 / email — non-UUID is resolved via GET /api/gateway/directory. User DMs only succeed after the gateway returns user_dm_ok (failures surface as tool/channel errors).",
      "Clawith / xcclawith: xcclawith_directory rows include `online` for kind=openclaw (peer bot longlink connected). If online is false, do not call xcclawith_peer_message — it will be blocked. kind=user has no online requirement.",
      "Clawith / xcclawith: Peer OpenClaw: xcclawith_directory (kind=openclaw, check online) → xcclawith_peer_message; success only after peer_message_ok.",
      "Clawith / xcclawith: Web DM `conversation_id` is chosen per message `to` UUID (in-memory map); OpenClaw `threadId` is global to the process and intentionally ignored — do not rely on it for Clawith threading.",
      "Clawith / xcclawith: Inbound OpenClaw session peer id remains clawith-<conversation_id> from the gateway task; that is separate from outbound `threadId`.",
    ],
  },
  gateway: {
    startAccount: async (ctx: ChannelGatewayContext<ResolvedXcclawith>) => {
      const log = ctx.log;
      const sink = {
        info: (m: string) => log?.info?.(m) ?? console.info(m),
        warn: (m: string) => log?.warn?.(m) ?? console.warn(m),
        error: (m: string) => log?.error?.(m) ?? console.error(m),
        debug: (m: string) => log?.debug?.(m),
      };

      xcBoth(sink, "info", "gateway", "startAccount.entry", {
        accountId: ctx.accountId,
        channel: CHANNEL_ID,
      });

      let parsed: ReturnType<typeof xcclawithSectionSchema.safeParse>;
      try {
        parsed = xcclawithSectionSchema.safeParse(readSectionRaw(ctx.cfg));
      } catch (e) {
        xcBoth(sink, "warn", "gateway", "startAccount.config_parse_threw", { err: String(e) });
        return;
      }
      if (!parsed.success) {
        xcBoth(sink, "warn", "gateway", "startAccount.config_invalid", {
          issues: parsed.error.issues,
        });
        return;
      }

      const section = parsed.data;
      const eff = resolveEffectiveSection(section);
      xcBoth(sink, "info", "gateway", "startAccount.config_ok", {
        host: eff.host,
        longlinkPort: eff.longlinkPort,
        directoryPort: eff.directoryPort,
        userIdLen: eff.userId.length,
      });

      const memory = getMemory(ctx.accountId);
      xcBoth(sink, "info", "gateway", "startAccount.remove_old_hub", { accountId: ctx.accountId });
      removeHub(ctx.accountId);

      if (!ctx.channelRuntime) {
        xcBoth(sink, "warn", "gateway", "startAccount.channel_runtime_missing", {
          meaning: "cannot dispatch inbound DMs without channelRuntime",
        });
        return;
      }

      const rt = ctx.channelRuntime;
      xcBoth(sink, "info", "gateway", "startAccount.channel_runtime_ok", {});

      const hub = new LonglinkHub(section, memory, sink, async ({ eventId, payload }) => {
        const p =
          payload && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : ({} as Record<string, unknown>);
        const msg = p.message;
        xcBoth(sink, "info", "gateway.task", "received", {
          eventId,
          diagnostics: formatGatewayTaskDiagnostics(p),
        });
        const userId = extractTaskUserIdFromPayload(p);
        if (!userId) {
          const messageKeys =
            msg && typeof msg === "object" && !Array.isArray(msg)
              ? Object.keys(msg as Record<string, unknown>).join(",")
              : typeof msg;
          xcBoth(sink, "warn", "gateway.task", "missing_user_id", {
            eventId,
            payloadKeys: Object.keys(p).join(","),
            messageKeys,
            meaning: "extractTaskUserIdFromPayload found nothing; check Clawith payload shape",
          });
          return;
        }
        xcBoth(sink, "info", "gateway.task", "user_id_resolved", { eventId, userId });
        const text = extractTaskText(msg);
        xcBoth(sink, "info", "gateway.task", "text_extracted", {
          eventId,
          textLen: text.length,
          preview: text.slice(0, 120),
        });
        let conversationId = extractConversationIdFromTaskPayload(p, msg);
        if (!conversationId) {
          conversationId = await postGatewayConverter({ section, receiverId: userId });
          xcBoth(sink, "warn", "gateway.task", "conversation_id_synthesized", {
            eventId,
            userId,
            conversationId,
            meaning: "no converter/conversation on payload; new thread key for OpenClaw",
          });
        } else {
          conversationId = conversationId.trim().toLowerCase();
          xcBoth(sink, "info", "gateway.task", "conversation_id_from_payload", {
            eventId,
            conversationId,
          });
        }
        memory.setUserConversation(userId, conversationId);
        const sessionPeerId = sessionPeerFromConversationId(conversationId);
        const requiresReply = extractRequiresReplyFromTaskPayload(p, msg);
        xcBoth(sink, "info", "gateway.task", "session_mapping", {
          eventId,
          userId,
          conversationId,
          sessionPeerId,
          requiresReply,
        });
        if (requiresReply) {
          sink.debug?.(
            `[xcclawith][gateway.task] requires_reply=true eventId=${eventId} conversationId=${conversationId}`,
          );
        }

        let accumulated = "";

        xcBoth(sink, "info", "gateway.task", "dispatchInbound.begin", {
          eventId,
          sessionPeerId,
        });
        await dispatchInboundDirectDmWithRuntime({
          cfg: cfgWithXcclawithDmScopeDefault(ctx.cfg),
          // Gateway passes `channelRuntime` = PluginRuntime["channel"]; dispatch expects `{ channel: that }`.
          runtime: { channel: rt } as Parameters<
            typeof dispatchInboundDirectDmWithRuntime
          >[0]["runtime"],
          channel: CHANNEL_ID,
          channelLabel: "Clawith",
          accountId: ctx.accountId,
          peer: { kind: "direct", id: sessionPeerId },
          senderId: userId,
          senderAddress: userId,
          recipientAddress: "xcclawith",
          conversationLabel: `Clawith ${conversationId}`,
          rawBody: text,
          messageId: eventId,
          bodyForAgent: text,
          commandBody: text,
          provider: CHANNEL_ID,
          surface: CHANNEL_ID,
          originatingChannel: CHANNEL_ID,
          originatingTo: userId,
          deliver: async (out) => {
            const chunk = (out.text ?? "").trim();
            if (!chunk) {
              xcBoth(sink, "debug", "gateway.deliver", "skip_empty_chunk", { eventId });
              return;
            }
            accumulated = accumulated ? `${accumulated}\n${chunk}` : chunk;
            xcBoth(sink, "info", "gateway.deliver", "outbound_chunk", {
              eventId,
              userId,
              conversationId,
              chunkLen: chunk.length,
              accumulatedLen: accumulated.length,
            });
            try {
              await hub.sendUserDmAwaitAck({
                targetUserId: userId,
                content: chunk,
                conversationId,
                messageId: eventId,
              });
            } catch (e) {
              xcBoth(sink, "error", "gateway.deliver", "user_dm_ack_failed", {
                eventId,
                userId,
                err: String(e),
              });
            }
          },
          onRecordError: (err) => {
            xcBoth(sink, "error", "gateway.dispatch", "record_inbound_session_error", {
              err: String(err),
            });
          },
          onDispatchError: (err, info) => {
            xcBoth(sink, "error", "gateway.dispatch", "dispatch_error", {
              kind: info.kind,
              err: String(err),
            });
          },
        });
        xcBoth(sink, "info", "gateway.task", "dispatchInbound.end", {
          eventId,
          accumulatedLen: accumulated.length,
        });
      }, ctx.abortSignal);

      hub.start();
      setHub(ctx.accountId, hub);
      xcBoth(sink, "info", "gateway", "startAccount.longlink_started", {
        accountId: ctx.accountId,
        meaning: "blocking on abort signal",
      });

      await untilAbort(ctx.abortSignal);
      xcBoth(sink, "info", "gateway", "startAccount.abort_wait_done", { accountId: ctx.accountId });
    },
    stopAccount: async (ctx: ChannelGatewayContext<ResolvedXcclawith>) => {
      xcBoth(ctx.log, "info", "gateway", "stopAccount.entry", { accountId: ctx.accountId });
      removeHub(ctx.accountId);
      xcBoth(ctx.log, "info", "gateway", "stopAccount.hub_removed", { accountId: ctx.accountId });
    },
  },
  directory: {
    listPeersLive: async (params: {
      cfg: OpenClawConfig;
      accountId?: string | null;
      query?: string | null;
      limit?: number | null;
      runtime: RuntimeEnv;
    }) => {
      const { cfg, accountId, query, limit } = params;
      const acc = resolveAccount(cfg, accountId);
      const eff = resolveEffectiveSection(acc);
      xcConsole("info", "directory.listPeersLive", "request", {
        accountId: acc.accountId,
        q: query ?? null,
        limit: limit ?? null,
        host: eff.host,
      });
      const res = await fetchGatewayDirectory({
        section: eff,
        q: query ?? undefined,
        limit: limit ?? undefined,
        log: {
          info: (m) => console.info(m),
          debug: (m) => console.debug(m),
        },
      });
      xcConsole("info", "directory.listPeersLive", "mapped", {
        rows: res.items.length,
        users: res.items.filter((i) => i.kind === "user").length,
        openclaw: res.items.filter((i) => i.kind === "openclaw").length,
      });
      return res.items.map((it) => ({
        kind: it.kind === "openclaw" ? ("channel" as const) : ("user" as const),
        id: it.id,
        name: it.display_name,
        handle: it.username ?? undefined,
        raw: it,
      }));
    },
  },
};

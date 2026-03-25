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
import { fetchGatewayDirectory } from "./directory-api.js";
import { ensureXcclawithLonglinkHub } from "./ensure-longlink.js";
import { getMemory, removeHub, setHub } from "./hub-registry.js";
import { LonglinkHub } from "./longlink-hub.js";
import { assertStrictClawithUserDmTarget, isClawithUserIdShape } from "./clawith-target.js";
import { resolveEffectiveSection, xcclawithSectionSchema, channelConfigSchema } from "./schema.js";
import type { XcclawithSection } from "./schema.js";
import {
  parseConversationIdFromThreadOrPeer,
  sessionPeerFromConversationId,
} from "./session-keys.js";
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
          threadId: params.threadId ?? null,
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
        xcConsole("info", "outbound.sendText", "step4.assert_to", {
          note: "must be users.id UUID or user:<uuid>",
        });
        const targetUserId = assertStrictClawithUserDmTarget(params.to);
        const fromThread = parseConversationIdFromThreadOrPeer(params.threadId);
        const existing = memory.getUserConversation(targetUserId);
        const conversationId = fromThread ?? existing ?? crypto.randomUUID();
        xcConsole("info", "outbound.sendText", "step5.conversation_chosen", {
          targetUserId,
          fromThread: fromThread ?? null,
          storedConversation: existing ?? null,
          chosenConversationId: conversationId,
          source: fromThread ? "threadId" : existing ? "memory" : "new_random_uuid",
        });
        if (fromThread && existing && fromThread !== existing) {
          xcConsole("warn", "outbound.sendText", "step5b.thread_overrides_memory", {
            fromThread,
            existing,
            targetUserId,
          });
        }
        memory.setUserConversation(targetUserId, conversationId);
        xcConsole("info", "outbound.sendText", "step6.memory_updated", { targetUserId, conversationId });
        xcConsole("info", "outbound.sendText", "step7.longlink_sendUserDm", {
          note: "async ack: clawith.user_dm_ok or user_dm_failed on wire",
        });
        hub.sendUserDm({
          targetUserId,
          content: params.text,
          conversationId,
        });
        const messageId = `xcclawith-dm-${Date.now()}`;
        xcConsole("info", "outbound.sendText", "step8.return_to_openclaw", {
          messageId,
          conversationId,
          meaning: "OpenClaw may show success before Clawith ack arrives",
        });
        return { channel: CHANNEL_ID, messageId, conversationId };
      },
    },
  },
});

export const xcclawithChannelPlugin = {
  ...chatPlugin,
  messaging: {
    targetResolver: {
      looksLikeId: (_raw: string, normalized?: string) => {
        let s = (normalized ?? _raw).trim();
        if (s.toLowerCase().startsWith("user:")) s = s.slice(5).trim();
        return isClawithUserIdShape(s.toLowerCase());
      },
      hint: "Clawith: message `to` must be user:<uuid> or bare users.id only (from xcclawith_directory). threadId: conversation UUID or clawith-<uuid>. Peer bots: xcclawith_peer_message + agents.id UUID.",
    },
  },
  agentPrompt: {
    messageToolHints: () => [
      "Clawith / xcclawith — Before ANY user DM: call tool xcclawith_directory (GET /api/gateway/directory) with q or omit q to list; copy kind=user → id, then message with to=user:<id> or bare UUID. Names, @handles, emails are NOT accepted in `to` — the channel does not resolve them.",
      "Clawith / xcclawith: To reach another OpenClaw: xcclawith_directory (kind=openclaw) → xcclawith_peer_message with target_agent_id = that row's id (UUID only).",
      "Clawith / xcclawith: Session peer id is clawith-<conversation_id>. Reuse a thread via message tool threadId = that UUID (or clawith-<uuid>).",
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
          conversationId = crypto.randomUUID();
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
            hub.sendUserDm({
              targetUserId: userId,
              content: chunk,
              conversationId,
              messageId: eventId,
            });
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

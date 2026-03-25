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
} from "./gateway-payload.js";
import { fetchGatewayDirectory } from "./directory-api.js";
import { resolveOutboundTargetToUserId } from "./directory-resolve.js";
import { ensureXcclawithLonglinkHub } from "./ensure-longlink.js";
import { getMemory, removeHub, setHub } from "./hub-registry.js";
import { LonglinkHub } from "./longlink-hub.js";
import { resolveEffectiveSection, xcclawithSectionSchema, channelConfigSchema } from "./schema.js";
import type { XcclawithSection } from "./schema.js";
import {
  parseConversationIdFromThreadOrPeer,
  sessionPeerFromConversationId,
} from "./session-keys.js";

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
        const hub = await ensureXcclawithLonglinkHub({
          cfg: params.cfg,
          accountId,
          connectTimeoutMs: 25_000,
        });
        const memory = getMemory(accountId);
        const sectionParsed = xcclawithSectionSchema.safeParse(readSectionRaw(params.cfg));
        if (!sectionParsed.success) {
          throw new Error(
            `xcclawith_config_invalid ${JSON.stringify(sectionParsed.error.issues)}`,
          );
        }
        const targetUserId = await resolveOutboundTargetToUserId({
          rawTo: params.to,
          section: resolveEffectiveSection(sectionParsed.data),
        });
        const fromThread = parseConversationIdFromThreadOrPeer(params.threadId);
        const existing = memory.getUserConversation(targetUserId);
        const conversationId = fromThread ?? existing ?? crypto.randomUUID();
        if (fromThread && existing && fromThread !== existing) {
          console.warn(
            `[xcclawith] threadId conversation ${fromThread} overrides stored ${existing} for user ${targetUserId}`,
          );
        }
        memory.setUserConversation(targetUserId, conversationId);
        hub.sendUserDm({
          targetUserId,
          content: params.text,
          conversationId,
        });
        return { channel: CHANNEL_ID, messageId: `xcclawith-dm-${Date.now()}`, conversationId };
      },
    },
  },
});

export const xcclawithChannelPlugin = {
  ...chatPlugin,
  agentPrompt: {
    messageToolHints: () => [
      "Clawith / xcclawith: OpenClaw session peer id is clawith-<conversation_id> (same UUID as Clawith converter). Reuse a thread by passing message tool threadId = that conversation UUID (or clawith-<uuid>).",
      "Clawith / xcclawith: Message `to` may be user:<uuid>, bare users.id, or @username / email / display_name — resolved via directory exact match when not a UUID.",
      "Clawith / xcclawith: If directory q returns no exact match or multiple users match, use xcclawith_directory or user:<uuid>. For OpenClaw bots use xcclawith_peer_message (kind=openclaw).",
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

      let parsed: ReturnType<typeof xcclawithSectionSchema.safeParse>;
      try {
        parsed = xcclawithSectionSchema.safeParse(readSectionRaw(ctx.cfg));
      } catch {
        sink.warn("xcclawith.config_parse_error");
        return;
      }
      if (!parsed.success) {
        sink.warn(`xcclawith.config_invalid ${JSON.stringify(parsed.error.issues)}`);
        return;
      }

      const section = parsed.data;
      const memory = getMemory(ctx.accountId);
      removeHub(ctx.accountId);

      if (!ctx.channelRuntime) {
        sink.warn("xcclawith.channel_runtime_missing");
        return;
      }

      const rt = ctx.channelRuntime;

      const hub = new LonglinkHub(section, memory, sink, async ({ eventId, payload }) => {
        const p =
          payload && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : ({} as Record<string, unknown>);
        const msg = p.message;
        const userId = extractTaskUserIdFromPayload(p);
        if (!userId) {
          const messageKeys =
            msg && typeof msg === "object" && !Array.isArray(msg)
              ? Object.keys(msg as Record<string, unknown>).join(",")
              : typeof msg;
          sink.warn(
            `xcclawith.task_missing_user eventId=${eventId} payloadKeys=${Object.keys(p).join(",")} messageKeys=${messageKeys}`,
          );
          return;
        }
        const text = extractTaskText(msg);
        let conversationId = extractConversationIdFromTaskPayload(p, msg);
        if (!conversationId) {
          conversationId = crypto.randomUUID();
          sink.warn(
            `xcclawith.task_missing_conversation_id eventId=${eventId} userId=${userId} synthesized=${conversationId}`,
          );
        } else {
          conversationId = conversationId.trim().toLowerCase();
        }
        memory.setUserConversation(userId, conversationId);
        const sessionPeerId = sessionPeerFromConversationId(conversationId);
        const requiresReply = extractRequiresReplyFromTaskPayload(p, msg);
        if (requiresReply) {
          sink.debug?.(
            `xcclawith.task_requires_reply_true eventId=${eventId} conversationId=${conversationId}`,
          );
        }

        let accumulated = "";

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
            if (!chunk) return;
            accumulated = accumulated ? `${accumulated}\n${chunk}` : chunk;
            hub.sendUserDm({
              targetUserId: userId,
              content: chunk,
              conversationId,
              messageId: eventId,
            });
          },
          onRecordError: (err) => {
            sink.error(`xcclawith.record_inbound_session_error ${String(err)}`);
          },
          onDispatchError: (err, info) => {
            sink.error(`xcclawith.dispatch_error kind=${info.kind} ${String(err)}`);
          },
        });
      }, ctx.abortSignal);

      hub.start();
      setHub(ctx.accountId, hub);
      sink.info(`xcclawith.gateway_started accountId=${ctx.accountId}`);

      await untilAbort(ctx.abortSignal);
    },
    stopAccount: async (ctx: ChannelGatewayContext<ResolvedXcclawith>) => {
      removeHub(ctx.accountId);
      ctx.log?.info?.(`xcclawith.gateway_stopped accountId=${ctx.accountId}`);
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
      const res = await fetchGatewayDirectory({
        section: eff,
        q: query ?? undefined,
        limit: limit ?? undefined,
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

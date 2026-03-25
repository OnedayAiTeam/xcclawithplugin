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
  extractConversationId,
  extractRequiresReply,
  extractTaskText,
  extractTaskUserId,
} from "./gateway-payload.js";
import { fetchGatewayDirectory } from "./directory-api.js";
import { ensureXcclawithLonglinkHub } from "./ensure-longlink.js";
import { getMemory, removeHub, setHub } from "./hub-registry.js";
import { LonglinkHub } from "./longlink-hub.js";
import { resolveEffectiveSection, xcclawithSectionSchema, channelConfigSchema } from "./schema.js";
import type { XcclawithSection } from "./schema.js";

export type ResolvedXcclawith = XcclawithSection & { accountId: string };

/**
 * Core routing uses `cfg.session?.dmScope ?? "main"`, which maps every inbound DM to
 * `agent:<agentId>:main` and mixes all Clawith web users into one session.
 * When `session.dmScope` is **omitted**, we inject **`per-channel-peer`** so keys look like
 * `agent:<agentId>:xcclawith:direct:<peerId>` (channel id is {@link CHANNEL_ID}).
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

/** OpenClaw may pass `user:<uuid>`; Clawith `target_user_id` expects the bare users.id UUID. */
function clawithDmPeerId(to: string): string {
  const t = to.trim();
  if (t.toLowerCase().startsWith("user:")) return t.slice(5).trim();
  return t;
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
        const peerId = clawithDmPeerId(params.to);
        const existing = memory.getUserConversation(peerId);
        const conversationId = existing ?? crypto.randomUUID();
        if (!existing) {
          memory.setUserConversation(peerId, conversationId);
        }
        hub.sendUserDm({
          targetUserId: peerId,
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
      "Clawith / xcclawith: You cannot resolve people by display name alone. Before sending a user DM, call xcclawith_directory with q=name fragment, username, pinyin, or email part; use the returned kind=user id (UUID) as the message target.",
      "Clawith / xcclawith: To browse visible contacts, call xcclawith_directory with no q (or empty q) and limit 20–50; then pick the correct id.",
      "Clawith / xcclawith: For other OpenClaw bots use xcclawith_peer_message with target_agent_id from directory rows where kind is openclaw (shown as channel in some UIs).",
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
        const msg = payload.message;
        const userId = extractTaskUserId(msg);
        if (!userId) {
          sink.warn(
            `xcclawith.task_missing_user eventId=${eventId} payloadKeys=${Object.keys(payload).join(",")}`,
          );
          return;
        }
        const text = extractTaskText(msg);
        const convFromTask = extractConversationId(msg);
        if (convFromTask) memory.setUserConversation(userId, convFromTask);
        const requiresReply = extractRequiresReply(msg);

        let accumulated = "";

        await dispatchInboundDirectDmWithRuntime({
          cfg: cfgWithXcclawithDmScopeDefault(ctx.cfg),
          // OpenClaw injects the full channel runtime; types are narrower than DirectDmRuntime.
          runtime: rt as unknown as Parameters<typeof dispatchInboundDirectDmWithRuntime>[0]["runtime"],
          channel: CHANNEL_ID,
          channelLabel: "Clawith",
          accountId: ctx.accountId,
          peer: { kind: "direct", id: userId },
          senderId: userId,
          senderAddress: userId,
          recipientAddress: "xcclawith",
          conversationLabel: `Clawith ${userId}`,
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
            const conv = memory.getUserConversation(userId);
            hub.sendUserDm({
              targetUserId: userId,
              content: chunk,
              conversationId: conv,
              messageId: conv ? undefined : eventId,
            });
          },
          onRecordError: (err) => {
            sink.error(`xcclawith.record_inbound_session_error ${String(err)}`);
          },
          onDispatchError: (err, info) => {
            sink.error(`xcclawith.dispatch_error kind=${info.kind} ${String(err)}`);
          },
        });

        hub.sendReport({
          messageId: eventId,
          result: accumulated.trim() || " ",
          requiresReply,
        });
      }, ctx.abortSignal);

      hub.start();
      setHub(ctx.accountId, hub);
      sink.info(`xcclawith.gateway_started accountId=${ctx.accountId}`);
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

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { AnyAgentTool } from "openclaw/plugin-sdk";
import { CHANNEL_ID } from "./constants.js";
import { ensureXcclawithLonglinkHub } from "./ensure-longlink.js";
import { assertStrictClawithAgentId } from "./clawith-target.js";
import { assertPeerAgentOnlineOrThrow } from "./directory-peer-online.js";
import { fetchGatewayDirectory } from "./directory-api.js";
import { getMemory } from "./hub-registry.js";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { resolveEffectiveSection, xcclawithSectionSchema } from "./schema.js";
import { xcConsole } from "./trace-log.js";

function readEffectiveSection(api: OpenClawPluginApi) {
  const raw = (api.config.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID];
  xcConsole("debug", "tools", "readEffectiveSection.raw_present", {
    hasRaw: raw !== undefined && raw !== null,
  });
  const parsed = xcclawithSectionSchema.parse(raw ?? {});
  const eff = resolveEffectiveSection(parsed);
  xcConsole("info", "tools", "readEffectiveSection.resolved", {
    host: eff.host,
    directoryPort: eff.directoryPort,
    longlinkPort: eff.longlinkPort,
  });
  return eff;
}

export function registerXcclawithTools(api: OpenClawPluginApi): void {
  xcConsole("info", "tools", "register.begin", { channel: CHANNEL_ID });
  const directoryTool: AnyAgentTool = {
    name: "xcclawith_directory",
    label: "Clawith directory",
    description:
      "Calls GET /api/gateway/directory. Each row may include `online` (kind=openclaw only): false means peer bot is offline — do not xcclawith_peer_message. " +
      "kind=user has no online field / requirement. " +
      "The channel also resolves non-UUID message `to` via this API. " +
      "q optional; omit q to list visible rows (default 20, max 50). " +
      "kind=user → users.id for DMs; kind=openclaw → agents.id for xcclawith_peer_message.",
    parameters: Type.Object({
      q: Type.Optional(
        Type.String({
          description:
            "Fuzzy search; optional. Omit or leave empty to list visible entries. For a person known only by Chinese name, try one character or pinyin username.",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 50, description: "Max rows (default 20)." }),
      ),
    }),
    execute: async (toolCallId, params) => {
      xcConsole("info", "tools.directory", "execute.begin", {
        toolCallId,
        q: params.q ?? null,
        limit: params.limit ?? null,
      });
      const section = readEffectiveSection(api);
      api.logger.info?.(
        `[xcclawith] tool=xcclawith_directory q=${JSON.stringify(params.q ?? null)} limit=${params.limit ?? "default"}`,
      );
      const res = await fetchGatewayDirectory({
        section,
        q: params.q,
        limit: params.limit,
        log: {
          info: (m) => api.logger.info?.(m),
          debug: (m) => api.logger.debug?.(m),
        },
      });
      const lines = res.items.map((it) => ({
        kind: it.kind,
        id: it.id,
        display_name: it.display_name,
        username: it.username,
        online: it.kind === "openclaw" ? (it.online ?? null) : undefined,
      }));
      xcConsole("info", "tools.directory", "execute.rows", {
        toolCallId,
        rowCount: lines.length,
        idsPreview: lines.slice(0, 5).map((l) => ({ kind: l.kind, id: l.id })),
      });
      api.logger.info?.(
        `[xcclawith] tool=xcclawith_directory ok rows=${lines.length} kinds=${JSON.stringify(lines.map((l) => l.kind))}`,
      );
      let text = JSON.stringify(lines, null, 2);
      if (lines.length === 0) {
        xcConsole("warn", "tools.directory", "execute.empty_result", {
          toolCallId,
          hint: "visibility or q too strict",
        });
        text +=
          "\n\nNo rows: broaden q, try username/pinyin, or omit q to list visible contacts (check Clawith visibility rules).";
      } else {
        text +=
          "\n\nFor kind=openclaw check `online`: false = peer offline, do not send xcclawith_peer_message. " +
          "kind=user: use id as message `to` (user:<uuid> or bare UUID). " +
          "User DM and peer send only return success after Clawith longlink ack (user_dm_ok / peer_message_ok).";
      }
      xcConsole("info", "tools.directory", "execute.done", { toolCallId, rowCount: lines.length });
      return {
        content: [{ type: "text", text }],
        details: { items: lines },
      };
    },
  };

  const peerTool: AnyAgentTool = {
    name: "xcclawith_peer_message",
    label: "Clawith peer OpenClaw message",
    description:
      "Send to another OpenClaw via longlink (clawith.peer_message). target_agent_id = agents.id (kind=openclaw). " +
      "Plugin checks directory: if online=false, send is rejected. Success only after peer_message_ok.",
    parameters: Type.Object({
      target_agent_id: Type.String({
        description: "agents.id UUID from xcclawith_directory (kind=openclaw). Bare UUID only.",
      }),
      content: Type.String({ description: "Message body for the peer." }),
      requires_reply: Type.Optional(
        Type.Boolean({
          description:
            "If true, expect the peer to report; relaxes send-side throttling per Clawith rules.",
        }),
      ),
      conversation_id: Type.Optional(
        Type.String({ description: "Existing peer conversation id if continuing a thread." }),
      ),
      new_session_id: Type.Optional(
        Type.String({
          description: "UUID for a new peer thread; reuse the same value on retries.",
        }),
      ),
    }),
    execute: async (toolCallId, params) => {
      const accountId = normalizeAccountId(null);
      xcConsole("info", "tools.peer", "execute.begin", {
        toolCallId,
        accountId,
        contentLen: params.content.length,
      });
      let hub;
      try {
        xcConsole("info", "tools.peer", "ensureHub.before", { accountId });
        hub = await ensureXcclawithLonglinkHub({
          cfg: api.config,
          accountId,
          connectTimeoutMs: 25_000,
          log: {
            info: (m) => api.logger.info?.(m) ?? console.info(m),
            warn: (m) => api.logger.warn?.(m) ?? console.warn(m),
            error: (m) => api.logger.error?.(m) ?? console.error(m),
            debug: (m) => api.logger.debug?.(m),
          },
        });
        xcConsole("info", "tools.peer", "ensureHub.after", { accountId });
      } catch (e) {
        xcConsole("error", "tools.peer", "ensureHub.failed", { accountId, err: String(e) });
        return {
          content: [
            {
              type: "text",
              text: `Longlink not available: ${String(e)}. Check host/longlinkPort and that the Clawith WS is reachable.`,
            },
          ],
          details: { status: "failed" as const },
        };
      }
      const memory = getMemory(accountId);
      let agentId: string;
      try {
        agentId = assertStrictClawithAgentId(params.target_agent_id);
      } catch (e) {
        const msg = String(e);
        xcConsole("warn", "tools.peer", "agent_id_rejected", { toolCallId, msg });
        api.logger.warn?.(`[xcclawith] tool=xcclawith_peer_message reject ${msg}`);
        return {
          content: [{ type: "text", text: msg }],
          details: { status: "rejected" as const },
        };
      }
      api.logger.info?.(
        `[xcclawith] tool=xcclawith_peer_message send target_agent_id=${agentId} requires_reply=${params.requires_reply ?? false} content_len=${params.content.length}`,
      );
      const section = readEffectiveSection(api);
      try {
        await assertPeerAgentOnlineOrThrow({ section, agentId });
      } catch (e) {
        const msg = String(e);
        if (msg.includes("xcclawith_peer_offline")) {
          xcConsole("warn", "tools.peer", "blocked_offline", { toolCallId, agentId });
          return {
            content: [{ type: "text", text: msg }],
            details: { status: "rejected" as const, reason: "offline" as const },
          };
        }
        throw e;
      }
      const conv =
        params.conversation_id ?? memory.getPeerConversation(agentId) ?? undefined;
      let newSession = params.new_session_id ?? memory.getPeerNewSession(agentId);
      xcConsole("info", "tools.peer", "routing_state", {
        explicitConversationId: params.conversation_id ?? null,
        memoryConversationId: conv ?? null,
        explicitNewSession: params.new_session_id ?? null,
        memoryNewSession: newSession ?? null,
      });
      if (!conv && !newSession) {
        newSession = crypto.randomUUID();
        memory.setPeerNewSession(agentId, newSession);
        xcConsole("info", "tools.peer", "new_session_allocated", { agentId, newSession });
      }
      xcConsole("info", "tools.peer", "sendPeerMessage.calling", {
        agentId,
        requiresReply: params.requires_reply ?? false,
        conversationId: conv ?? null,
        newSessionId: newSession ?? null,
      });
      try {
        const ack = await hub.sendPeerMessageAwaitAck({
          targetAgentId: agentId,
          content: params.content,
          requiresReply: params.requires_reply ?? false,
          conversationId: conv,
          newSessionId: newSession,
        });
        xcConsole("info", "tools.peer", "execute.ok", {
          toolCallId,
          agentId,
          conversationId: ack.conversationId,
        });
        return {
          content: [
            {
              type: "text",
              text: `Peer message delivered (peer_message_ok). conversation_id=${ack.conversationId}`,
            },
          ],
          details: {
            status: "ok" as const,
            target_agent_id: agentId,
            conversation_id: ack.conversationId,
          },
        };
      } catch (e) {
        const msg = String(e);
        xcConsole("error", "tools.peer", "execute.ack_failed", { toolCallId, agentId, err: msg });
        return {
          content: [{ type: "text", text: `Peer message failed: ${msg}` }],
          details: { status: "failed" as const, target_agent_id: agentId },
        };
      }
    },
  };

  api.registerTool(directoryTool);
  api.registerTool(peerTool, { optional: true });
  xcConsole("info", "tools", "register.done", { tools: ["xcclawith_directory", "xcclawith_peer_message"] });
}

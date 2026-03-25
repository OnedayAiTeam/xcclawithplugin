import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { AnyAgentTool } from "openclaw/plugin-sdk";
import { CHANNEL_ID } from "./constants.js";
import { ensureXcclawithLonglinkHub } from "./ensure-longlink.js";
import { assertStrictClawithAgentId } from "./clawith-target.js";
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
      "MANDATORY before sending to a human or peer bot: calls GET /api/gateway/directory. " +
      "The message tool does NOT accept names — you must copy ids from here. " +
      "q is optional fuzzy search (display_name/username/email); omit q to list visible rows up to limit (default 20, max 50). " +
      "kind=user → field id is users.id: use as message `to` as user:<id> or bare UUID. " +
      "kind=openclaw → field id is agents.id: use xcclawith_peer_message.target_agent_id only (UUID).",
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
          "\n\nUse kind=user id as message `to` (user:<uuid> or bare UUID). Use kind=openclaw id only with xcclawith_peer_message.target_agent_id.";
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
      "Send to another OpenClaw via longlink (clawith.peer_message). target_agent_id MUST be agents.id UUID from xcclawith_directory (kind=openclaw). No names.",
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
      hub.sendPeerMessage({
        targetAgentId: agentId,
        content: params.content,
        requiresReply: params.requires_reply ?? false,
        conversationId: conv,
        newSessionId: newSession,
      });
      xcConsole("info", "tools.peer", "execute.queued", { toolCallId, agentId });
      return {
        content: [
          {
            type: "text",
            text: "Peer message sent on longlink (await clawith.peer_message_ok / failed on the wire).",
          },
        ],
        details: { status: "queued" as const, target_agent_id: agentId },
      };
    },
  };

  api.registerTool(directoryTool);
  api.registerTool(peerTool, { optional: true });
  xcConsole("info", "tools", "register.done", { tools: ["xcclawith_directory", "xcclawith_peer_message"] });
}

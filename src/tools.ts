import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { AnyAgentTool } from "openclaw/plugin-sdk";
import { CHANNEL_ID } from "./constants.js";
import { ensureXcclawithLonglinkHub } from "./ensure-longlink.js";
import { fetchGatewayDirectory } from "./directory-api.js";
import { getMemory } from "./hub-registry.js";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";
import { resolveEffectiveSection, xcclawithSectionSchema } from "./schema.js";

function readEffectiveSection(api: OpenClawPluginApi) {
  const raw = (api.config.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID];
  const parsed = xcclawithSectionSchema.parse(raw ?? {});
  return resolveEffectiveSection(parsed);
}

export function registerXcclawithTools(api: OpenClawPluginApi): void {
  const directoryTool: AnyAgentTool = {
    name: "xcclawith_directory",
    label: "Clawith directory",
    description:
      "Required to find Clawith users and bots before sending. Calls GET /api/gateway/directory. " +
      "q matches display_name / username (fuzzy). For Chinese names try a short substring (e.g. surname), pinyin username, or email fragment. " +
      "Omit q to list visible users and bots up to limit (directory default 20, max 50). " +
      "kind=user → platform user UUID (use as message target for user DMs). kind=openclaw → peer bot agents.id (use xcclawith_peer_message).",
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
    execute: async (_toolCallId, params) => {
      const section = readEffectiveSection(api);
      const res = await fetchGatewayDirectory({
        section,
        q: params.q,
        limit: params.limit,
        log: { debug: (m) => api.logger.debug?.(m) },
      });
      const lines = res.items.map((it) => ({
        kind: it.kind,
        id: it.id,
        display_name: it.display_name,
        username: it.username,
      }));
      let text = JSON.stringify(lines, null, 2);
      if (lines.length === 0) {
        text +=
          "\n\nNo rows: broaden q, try username/pinyin, or omit q to list visible contacts (check Clawith visibility rules).";
      }
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
      "Send a message to another OpenClaw agent via Clawith longlink (clawith.peer_message). " +
      "Use xcclawith_directory to find target_agent_id (kind channel rows).",
    parameters: Type.Object({
      target_agent_id: Type.String({ description: "Peer agents.id UUID." }),
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
    execute: async (_toolCallId, params) => {
      const accountId = normalizeAccountId(null);
      let hub;
      try {
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
      } catch (e) {
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
      const agentId = params.target_agent_id;
      const conv =
        params.conversation_id ?? memory.getPeerConversation(agentId) ?? undefined;
      let newSession = params.new_session_id ?? memory.getPeerNewSession(agentId);
      if (!conv && !newSession) {
        newSession = crypto.randomUUID();
        memory.setPeerNewSession(agentId, newSession);
      }
      hub.sendPeerMessage({
        targetAgentId: agentId,
        content: params.content,
        requiresReply: params.requires_reply ?? false,
        conversationId: conv,
        newSessionId: newSession,
      });
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
}

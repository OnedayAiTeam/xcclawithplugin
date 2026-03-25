import { isClawithUserIdShape } from "./clawith-target.js";
import { xcConsole } from "./trace-log.js";

/** OpenClaw direct peer id: `clawith-<conversation_id>` (Clawith converter UUID). */
export const CLAWITH_SESSION_PEER_PREFIX = "clawith-";

export function sessionPeerFromConversationId(conversationId: string): string {
  const c = conversationId.trim().toLowerCase();
  const peer = `${CLAWITH_SESSION_PEER_PREFIX}${c}`;
  xcConsole("debug", "sessionKeys", "sessionPeerFromConversationId", { conversationId: c, peer });
  return peer;
}

/** Parse `threadId` / `clawith-<uuid>` / bare UUID → conversation_id. */
export function parseConversationIdFromThreadOrPeer(
  raw: string | number | null | undefined,
): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const t = String(raw).trim();
  if (!t) return undefined;
  const lower = t.toLowerCase();
  if (lower.startsWith(CLAWITH_SESSION_PEER_PREFIX)) {
    const rest = t.slice(CLAWITH_SESSION_PEER_PREFIX.length).trim();
    if (isClawithUserIdShape(rest)) {
      const cid = rest.toLowerCase();
      xcConsole("info", "sessionKeys", "parseConversationId.from_clawith_prefix", { raw: t, conversationId: cid });
      return cid;
    }
    xcConsole("warn", "sessionKeys", "parseConversationId.prefix_bad_uuid", { raw: t, rest });
    return undefined;
  }
  if (isClawithUserIdShape(t)) {
    const cid = t.toLowerCase();
    xcConsole("info", "sessionKeys", "parseConversationId.bare_uuid", { conversationId: cid });
    return cid;
  }
  xcConsole("warn", "sessionKeys", "parseConversationId.unrecognized", { raw: t });
  return undefined;
}

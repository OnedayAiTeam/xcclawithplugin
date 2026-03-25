import { isClawithUserIdShape } from "./clawith-target.js";

/** OpenClaw direct peer id: `clawith-<conversation_id>` (Clawith converter UUID). */
export const CLAWITH_SESSION_PEER_PREFIX = "clawith-";

export function sessionPeerFromConversationId(conversationId: string): string {
  const c = conversationId.trim().toLowerCase();
  return `${CLAWITH_SESSION_PEER_PREFIX}${c}`;
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
    if (isClawithUserIdShape(rest)) return rest.toLowerCase();
    return undefined;
  }
  if (isClawithUserIdShape(t)) return t.toLowerCase();
  return undefined;
}

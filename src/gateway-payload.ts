/** Best-effort extraction from Clawith gateway.task payload.message (schema not fixed in repo). */

export function extractTaskText(message: unknown): string {
  if (message === null || message === undefined) return "";
  if (typeof message === "string") return message;
  if (typeof message !== "object") return String(message);
  const m = message as Record<string, unknown>;
  const candidates = [m.content, m.text, m.body, m.message];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  try {
    return JSON.stringify(message);
  } catch {
    return "";
  }
}

export function extractTaskUserId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const m = message as Record<string, unknown>;
  const directKeys = ["user_id", "userId", "sender_id", "senderId", "from_user_id", "fromUserId"];
  for (const k of directKeys) {
    const v = m[k];
    if (typeof v === "string" && v) return v;
  }
  const nested = m.user ?? m.sender;
  if (nested && typeof nested === "object") {
    const u = nested as Record<string, unknown>;
    const id = u.id;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}

export function extractConversationId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const m = message as Record<string, unknown>;
  const c = m.conversation_id ?? m.conversationId;
  return typeof c === "string" && c ? c : undefined;
}

export function extractRequiresReply(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as Record<string, unknown>;
  return m.requires_reply === true || m.requiresReply === true;
}

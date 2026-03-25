/** Best-effort extraction from Clawith gateway.task payload.message (schema not fixed in repo). */

function pickString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

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
  const direct = pickString(m, [
    "user_id",
    "userId",
    "sender_id",
    "senderId",
    "from_user_id",
    "fromUserId",
    "sender_user_id",
    "senderUserId",
    "author_id",
    "authorId",
    "from_id",
    "fromId",
    "participant_id",
    "participantId",
    "creator_id",
    "creatorId",
  ]);
  if (direct) return direct;

  const nested = m.user ?? m.sender ?? m.author ?? m.from ?? m.participant ?? m.contact;
  if (nested && typeof nested === "object") {
    const u = nested as Record<string, unknown>;
    const id = pickString(u, ["id", "user_id", "userId"]);
    if (id) return id;
  }

  for (const wrap of [m.meta, m.metadata, m.attributes, m.data]) {
    if (wrap && typeof wrap === "object") {
      const id = pickString(wrap as Record<string, unknown>, [
        "user_id",
        "userId",
        "sender_id",
        "senderId",
        "from_user_id",
        "fromUserId",
      ]);
      if (id) return id;
    }
  }

  return undefined;
}

/**
 * Resolve platform user id for a `gateway.task` frame: try `payload.message`, then `payload.relationships`,
 * then top-level payload (Clawith shapes vary by version).
 */
export function extractTaskUserIdFromPayload(payload: Record<string, unknown>): string | undefined {
  const fromMessage = extractTaskUserId(payload.message);
  if (fromMessage) return fromMessage;

  const rel = payload.relationships;
  if (Array.isArray(rel)) {
    const rows = rel.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    const kindOf = (o: Record<string, unknown>) =>
      String(o.kind ?? o.type ?? o.role ?? "").toLowerCase();
    for (const o of rows) {
      const k = kindOf(o);
      if (k !== "user" && k !== "users" && !k.endsWith("user")) continue;
      const id = pickString(o, ["id", "user_id", "userId", "uuid"]);
      if (id) return id;
      const nested = extractTaskUserId(o);
      if (nested) return nested;
    }
    for (const o of rows) {
      const id = pickString(o, ["id", "user_id", "userId", "uuid"]);
      if (id) return id;
      const nested = extractTaskUserId(o);
      if (nested) return nested;
    }
  }

  if (rel && typeof rel === "object" && !Array.isArray(rel)) {
    const r = rel as Record<string, unknown>;
    const single = r.user ?? r.sender ?? r.contact ?? r.participant ?? r.customer;
    if (single && typeof single === "object") {
      const id = pickString(single as Record<string, unknown>, ["id", "user_id", "userId"]);
      if (id) return id;
    }
    for (const v of Object.values(r)) {
      if (!Array.isArray(v)) continue;
      for (const item of v) {
        const id = extractTaskUserId(item);
        if (id) return id;
      }
    }
    const data = r.data;
    if (Array.isArray(data)) {
      for (const item of data) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const t = o.type;
        const id = pickString(o, ["id"]);
        if (id && (t === undefined || String(t).toLowerCase().includes("user"))) return id;
      }
    } else if (data && typeof data === "object") {
      const o = data as Record<string, unknown>;
      const id = pickString(o, ["id", "user_id", "userId"]);
      if (id) return id;
    }
  }

  return pickString(payload, [
    "user_id",
    "userId",
    "sender_user_id",
    "senderUserId",
    "from_user_id",
    "fromUserId",
  ]);
}

export function extractConversationId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const m = message as Record<string, unknown>;
  const c =
    m.conversation_id ??
    m.conversationId ??
    m.converter_id ??
    m.converterId ??
    m.converter_uuid ??
    m.converterUuid;
  return typeof c === "string" && c.trim() ? c.trim() : undefined;
}

/** Prefer `message`, then `gateway.task` payload root (converter / conversation). */
export function extractConversationIdFromTaskPayload(
  payload: Record<string, unknown>,
  message: unknown,
): string | undefined {
  const fromMsg = extractConversationId(message);
  if (fromMsg) return fromMsg;
  const c =
    payload.conversation_id ??
    payload.conversationId ??
    payload.converter_id ??
    payload.converterId ??
    payload.converter_uuid ??
    payload.converterUuid;
  return typeof c === "string" && c.trim() ? c.trim() : undefined;
}

export function extractRequiresReply(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as Record<string, unknown>;
  return m.requires_reply === true || m.requiresReply === true;
}

/** `gateway.task` payload: message body first, then payload root; default false. */
export function extractRequiresReplyFromTaskPayload(
  payload: Record<string, unknown>,
  message: unknown,
): boolean {
  if (payload.requires_reply === true || payload.requiresReply === true) return true;
  return extractRequiresReply(message);
}

/**
 * One-line summary for logs: what we could read from a `gateway.task` payload (for debugging missing user / conversation).
 */
export function formatGatewayTaskDiagnostics(payload: Record<string, unknown>): string {
  const msg = payload.message;
  const uid = extractTaskUserIdFromPayload(payload);
  const conv = extractConversationIdFromTaskPayload(payload, msg);
  const req = extractRequiresReplyFromTaskPayload(payload, msg);
  const txt = extractTaskText(msg);
  const rel = payload.relationships;
  const relHint =
    rel === undefined
      ? "absent"
      : Array.isArray(rel)
        ? `array(len=${rel.length})`
        : typeof rel === "object"
          ? `object(keys=${Object.keys(rel as object).join(",")})`
          : typeof rel;
  const msgKeys =
    msg && typeof msg === "object" && !Array.isArray(msg)
      ? Object.keys(msg as Record<string, unknown>).join(",")
      : typeof msg;
  return [
    `payloadKeys=${Object.keys(payload).join(",")}`,
    `relationships=${relHint}`,
    `messageKeys=${msgKeys}`,
    `resolvedUserId=${uid ?? "NONE"}`,
    `resolvedConversationId=${conv ?? "NONE"}`,
    `requiresReply=${req}`,
    `textLen=${txt.length}`,
  ].join(" | ");
}

/** Clawith `clawith.user_dm.target_user_id` must be `users.id` (RFC4122 UUID). */

import { xcConsole } from "./trace-log.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_GLOBAL =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

/**
 * Strip `user:` and, if the string embeds a session key, take the last UUID token
 * (e.g. `agent:main:xcclawith:direct:<uuid>` → `<uuid>`).
 */
export function normalizeClawithTargetUserId(raw: string): string {
  let s = raw.trim();
  if (s.toLowerCase().startsWith("user:")) s = s.slice(5).trim();
  const hits = s.match(UUID_GLOBAL);
  if (!hits?.length) return s;
  if (hits.length === 1) return hits[0]!.toLowerCase();
  return hits[hits.length - 1]!.toLowerCase();
}

export function isClawithUserIdShape(s: string): boolean {
  return UUID.test(s);
}

/**
 * Message tool `to` for `clawith.user_dm`: only `user:<uuid>` or a bare `users.id` UUID.
 * No directory resolution, no session-key embedding — forces agents to call xcclawith_directory first.
 */
export function assertStrictClawithUserDmTarget(raw: string): string {
  let s = (raw ?? "").trim();
  if (!s) {
    xcConsole("warn", "target", "assertUserDm.reject", { reason: "empty_to", raw: raw ?? null });
    throw new Error(
      "xcclawith_empty_target — message `to` is required: Clawith users.id as UUID or user:<uuid> from xcclawith_directory (kind=user).",
    );
  }
  const hadUserPrefix = s.toLowerCase().startsWith("user:");
  if (hadUserPrefix) s = s.slice(5).trim();
  if (!s) {
    xcConsole("warn", "target", "assertUserDm.reject", { reason: "empty_after_user_prefix", raw });
    throw new Error("xcclawith_empty_target_after_user_prefix");
  }
  const lower = s.toLowerCase();
  if (!isClawithUserIdShape(lower)) {
    xcConsole("warn", "target", "assertUserDm.reject", {
      reason: "not_rfc4122_uuid",
      raw,
      hadUserPrefix,
      afterStrip: s,
    });
    throw new Error(
      `xcclawith_to_must_be_users_id to=${JSON.stringify(raw)} — pass only bare users.id UUID or user:<uuid> from tool xcclawith_directory (kind=user, field id). Display names, @handles, and emails are not accepted. For another OpenClaw use xcclawith_peer_message with target_agent_id (agents.id from kind=openclaw).`,
    );
  }
  xcConsole("info", "target", "assertUserDm.ok", { userId: lower, hadUserPrefix });
  return lower;
}

/** Peer longlink `target_agent_id` must be a bare agents.id UUID (directory kind=openclaw). */
export function assertStrictClawithAgentId(raw: string): string {
  let s = (raw ?? "").trim();
  if (!s) {
    xcConsole("warn", "target", "assertAgentId.reject", { reason: "empty", raw: raw ?? null });
    throw new Error(
      "xcclawith_empty_target_agent_id — xcclawith_peer_message.target_agent_id is required (UUID from xcclawith_directory kind=openclaw).",
    );
  }
  const hadAgentPrefix = s.toLowerCase().startsWith("agent:");
  if (hadAgentPrefix) s = s.slice(6).trim();
  const lower = s.toLowerCase();
  if (!isClawithUserIdShape(lower)) {
    xcConsole("warn", "target", "assertAgentId.reject", {
      reason: "not_uuid",
      raw,
      hadAgentPrefix,
      afterStrip: s,
    });
    throw new Error(
      `xcclawith_target_agent_id_must_be_uuid got=${JSON.stringify(raw)} — use xcclawith_directory, take kind=openclaw row id as target_agent_id.`,
    );
  }
  xcConsole("info", "target", "assertAgentId.ok", { agentId: lower, hadAgentPrefix });
  return lower;
}

/** Clawith `clawith.user_dm.target_user_id` must be `users.id` (RFC4122 UUID). */

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

import { fetchGatewayDirectory, type DirectoryItem } from "./directory-api.js";
import type { XcclawithSection } from "./schema.js";
import { isClawithUserIdShape, normalizeClawithTargetUserId } from "./clawith-target.js";

function stripAtHandle(s: string): string {
  return s.trim().replace(/^@+/, "").trim();
}

/**
 * `kind=user` row matches `needle` when username, email, or display_name equals (case-insensitive).
 * Also: if `needle` has no `@`, email local-part equals `needle` (e.g. shiyu.li vs shiyu.li@corp.com).
 */
export function exactMatchUserRow(item: DirectoryItem, needleRaw: string): boolean {
  if (item.kind !== "user") return false;
  const needle = needleRaw.trim().toLowerCase();
  if (!needle) return false;

  const u = (item.username ?? "").trim().toLowerCase();
  if (u === needle) return true;

  const eFull = (item.email ?? "").trim().toLowerCase();
  if (eFull === needle) return true;
  if (!needle.includes("@") && eFull.includes("@")) {
    const local = eFull.split("@")[0] ?? "";
    if (local === needle) return true;
  }

  const d = (item.display_name ?? "").trim().toLowerCase();
  if (d === needle) return true;

  return false;
}

function pickExactUsers(items: DirectoryItem[], needle: string): DirectoryItem[] {
  return items.filter((i) => exactMatchUserRow(i, needle));
}

/**
 * Resolve `to` for outbound `clawith.user_dm`: bare/user: UUID passes through; otherwise
 * directory lookup + exact match on username / email / display_name (after stripping `@`).
 */
export async function resolveOutboundTargetToUserId(params: {
  rawTo: string;
  section: XcclawithSection;
  log?: { debug?: (m: string) => void };
}): Promise<string> {
  const normalized = normalizeClawithTargetUserId(params.rawTo);
  if (isClawithUserIdShape(normalized)) return normalized;

  const needle = stripAtHandle(params.rawTo);
  if (!needle) {
    throw new Error("xcclawith_empty_target");
  }

  const { items } = await fetchGatewayDirectory({
    section: params.section,
    q: needle,
    limit: 500,
    log: params.log,
  });
  const matches = pickExactUsers(items, needle);

  if (matches.length === 1) {
    return matches[0]!.id;
  }
  if (matches.length === 0) {
    throw new Error(
      `xcclawith_no_exact_directory_match to=${JSON.stringify(params.rawTo)} q=${JSON.stringify(needle)} — no kind=user row with exact username/email/display_name in directory results; use xcclawith_directory or user:<uuid>.`,
    );
  }
  throw new Error(
    `xcclawith_ambiguous_directory_match to=${JSON.stringify(params.rawTo)} count=${matches.length} — use user:<uuid>.`,
  );
}

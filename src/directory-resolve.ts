import { fetchGatewayDirectory, type DirectoryItem } from "./directory-api.js";
import type { XcclawithSection } from "./schema.js";
import { isClawithUserIdShape } from "./clawith-target.js";
import { xcConsole } from "./trace-log.js";

function stripAtHandle(s: string): string {
  return s.trim().replace(/^@+/, "").trim();
}

const HYPHEN_CLASS = /[-\u2010-\u2015\u2212\uff0d]/g;

/** Collapse spaces/hyphens so `李时禹 - 测试` matches `李时禹-测试`. */
export function normalizeTargetLabel(s: string): string {
  let t = s.trim().toLowerCase();
  t = t.replace(HYPHEN_CLASS, "-");
  t = t.replace(/\s*-\s*/g, "-");
  t = t.replace(/\s+/g, "");
  return t;
}

/**
 * `kind=user` row matches search needle: username, email, display_name (with loose spacing/hyphen on display).
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

  const dRaw = (item.display_name ?? "").trim();
  const d = dRaw.toLowerCase();
  if (d === needle) return true;

  const nn = normalizeTargetLabel(needleRaw);
  const nd = normalizeTargetLabel(dRaw);
  if (nd && nn === nd) return true;

  if (nd.length > 0 && nn.startsWith(nd) && nn.length > nd.length) {
    const rest = nn.slice(nd.length);
    if (rest.startsWith("-")) return true;
  }

  return false;
}

function pickExactUsers(items: DirectoryItem[], needle: string): DirectoryItem[] {
  return items.filter((i) => exactMatchUserRow(i, needle));
}

function tryBareUserUuid(rawTo: string): string | undefined {
  let s = stripAtHandle(rawTo);
  if (!s) return undefined;
  if (s.toLowerCase().startsWith("user:")) s = s.slice(5).trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  return isClawithUserIdShape(lower) ? lower : undefined;
}

/**
 * Resolve message `to`: bare / `user:` **users.id** UUID returns immediately; otherwise **GET /api/gateway/directory**
 * with `q=needle` and match username / email / display_name (Chinese, pinyin, @handle, etc.).
 */
export async function resolveOutboundTargetToUserId(params: {
  rawTo: string;
  section: XcclawithSection;
  log?: { debug?: (m: string) => void; info?: (m: string) => void };
}): Promise<string> {
  const fast = tryBareUserUuid(params.rawTo);
  if (fast) {
    xcConsole("info", "directory.resolve", "uuid_fast_path", {
      rawTo: params.rawTo,
      userId: fast,
    });
    return fast;
  }

  const needle = stripAtHandle(params.rawTo);
  if (!needle) {
    throw new Error("xcclawith_empty_target");
  }

  xcConsole("info", "directory.resolve", "directory_lookup.begin", {
    rawTo: params.rawTo,
    needle,
  });

  let items = (
    await fetchGatewayDirectory({
      section: params.section,
      q: needle,
      limit: 50,
      log: params.log,
    })
  ).items;

  let matches = pickExactUsers(items, needle);
  const countUsers = () => items.filter((i) => i.kind === "user").length;

  if (matches.length === 0 && countUsers() === 0 && !needle.includes("@")) {
    const short = needle.split(HYPHEN_CLASS)[0]?.trim() ?? "";
    if (short.length >= 1 && short !== needle) {
      xcConsole("info", "directory.resolve", "retry_q_shorter_segment", { short, fullNeedle: needle });
      items = (
        await fetchGatewayDirectory({
          section: params.section,
          q: short,
          limit: 50,
          log: params.log,
        })
      ).items;
      matches = pickExactUsers(items, needle);
    }
  }

  if (matches.length === 0 && countUsers() === 1) {
    const only = items.find((i) => i.kind === "user")!;
    matches = [only];
    xcConsole("warn", "directory.resolve", "single_user_row_fallback", {
      needle,
      pickedUserId: only.id,
      display_name: only.display_name,
      meaning: "directory returned one kind=user row; using it though label match was not exact",
    });
  }

  if (matches.length === 1) {
    const id = matches[0]!.id;
    xcConsole("info", "directory.resolve", "resolved", {
      rawTo: params.rawTo,
      needle,
      userId: id,
      via: "directory",
    });
    return id;
  }

  if (matches.length === 0) {
    throw new Error(
      `xcclawith_no_directory_match to=${JSON.stringify(params.rawTo)} q=${JSON.stringify(needle)} — no kind=user resolved; try xcclawith_directory, another q, or user:<uuid>.`,
    );
  }
  throw new Error(
    `xcclawith_ambiguous_directory_match to=${JSON.stringify(params.rawTo)} count=${matches.length} — use user:<uuid>.`,
  );
}

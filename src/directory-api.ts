import { buildDirectoryBaseUrl, resolvePorts } from "./urls.js";
import type { XcclawithSection } from "./schema.js";
import { xcConsole } from "./trace-log.js";

export type DirectoryItem = {
  kind: "user" | "openclaw";
  id: string;
  display_name: string;
  username?: string | null;
  email?: string | null;
  creator_user_id?: string | null;
  /** `kind=openclaw` only: whether the peer bot has longlink connected. Absent/unknown = not checked server-side. */
  online?: boolean | null;
};

export type DirectoryResponse = {
  items: DirectoryItem[];
};

function clampLimit(n: number | undefined): number {
  if (n === undefined || Number.isNaN(n)) return 20;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

export async function fetchGatewayDirectory(params: {
  section: XcclawithSection;
  q?: string;
  limit?: number;
  log?: { debug?: (m: string) => void; info?: (m: string) => void };
}): Promise<DirectoryResponse> {
  const { section } = params;
  const { directoryPort } = resolvePorts(section);
  const base = buildDirectoryBaseUrl(section.host, directoryPort);
  const url = new URL(base);
  const q = params.q?.trim();
  if (q) url.searchParams.set("q", q);
  const lim = clampLimit(params.limit);
  url.searchParams.set("limit", String(lim));

  params.log?.info?.(
    `directory.request host=${section.host} port=${directoryPort} hasQ=${Boolean(q)} qLen=${q?.length ?? 0} limit=${lim}`,
  );
  params.log?.debug?.(`directory.request url=${url.toString()}`);
  xcConsole("info", "directory.http", "fetch.begin", {
    host: section.host,
    port: directoryPort,
    hasQ: Boolean(q),
    limit: lim,
    apiKeyLen: section.apiKey?.length ?? 0,
  });

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-Api-Key": section.apiKey },
  });

  const text = await res.text();
  xcConsole("info", "directory.http", "fetch.response", {
    status: res.status,
    ok: res.ok,
    bodyChars: text.length,
  });
  if (!res.ok) {
    params.log?.debug?.(`directory.error status=${res.status} bodyPreview=${text.slice(0, 500)}`);
    xcConsole("error", "directory.http", "fetch.http_error", {
      status: res.status,
      bodyPreview: text.slice(0, 400),
      meaning: "Clawith directory HTTP rejected request; check host, directoryPort, X-Api-Key",
    });
    throw new Error(`directory_http_${res.status}: ${text.slice(0, 200)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (e) {
    xcConsole("error", "directory.http", "parse.json_failed", {
      bodyPreview: text.slice(0, 400),
      err: String(e),
    });
    throw new Error("directory_invalid_json");
  }

  const items = (parsed as DirectoryResponse)?.items;
  if (!Array.isArray(items)) {
    xcConsole("error", "directory.http", "parse.missing_items_array", {
      parsedTopKeys:
        parsed && typeof parsed === "object" ? Object.keys(parsed as object).join(",") : typeof parsed,
    });
    throw new Error("directory_missing_items");
  }

  const userN = (items as DirectoryItem[]).filter((i) => i.kind === "user").length;
  const botN = (items as DirectoryItem[]).filter((i) => i.kind === "openclaw").length;
  params.log?.info?.(`directory.ok total=${items.length} kind_user=${userN} kind_openclaw=${botN}`);
  params.log?.debug?.(`directory.ok count=${items.length}`);
  return { items: items as DirectoryItem[] };
}

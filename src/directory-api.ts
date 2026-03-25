import { buildDirectoryBaseUrl, resolvePorts } from "./urls.js";
import type { XcclawithSection } from "./schema.js";

export type DirectoryItem = {
  kind: "user" | "openclaw";
  id: string;
  display_name: string;
  username?: string | null;
  email?: string | null;
  creator_user_id?: string | null;
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
  log?: { debug?: (m: string) => void };
}): Promise<DirectoryResponse> {
  const { section } = params;
  const { directoryPort } = resolvePorts(section);
  const base = buildDirectoryBaseUrl(section.host, directoryPort);
  const url = new URL(base);
  const q = params.q?.trim();
  if (q) url.searchParams.set("q", q);
  url.searchParams.set("limit", String(clampLimit(params.limit)));

  params.log?.debug?.(`directory.request url=${url.toString()} hasQ=${Boolean(q)}`);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "X-Api-Key": section.apiKey },
  });

  const text = await res.text();
  if (!res.ok) {
    params.log?.debug?.(`directory.error status=${res.status} bodyPreview=${text.slice(0, 500)}`);
    throw new Error(`directory_http_${res.status}: ${text.slice(0, 200)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("directory_invalid_json");
  }

  const items = (parsed as DirectoryResponse)?.items;
  if (!Array.isArray(items)) {
    throw new Error("directory_missing_items");
  }

  params.log?.debug?.(`directory.ok count=${items.length}`);
  return { items: items as DirectoryItem[] };
}

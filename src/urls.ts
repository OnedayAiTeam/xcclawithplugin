import {
  DEFAULT_DIRECTORY_PORT,
  DEFAULT_LONGLINK_PORT,
  DIRECTORY_HTTP_PATH,
  LONGLINK_WS_PATH,
} from "./constants.js";

/**
 * Strip scheme; keep host (and optional port if present in URL).
 * Only http/ws family is accepted for stripping; result is used with http:// and ws://.
 */
export function normalizeHost(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const lower = t.toLowerCase();
  if (lower.startsWith("https://")) {
    return t.slice("https://".length).split("/")[0] ?? t;
  }
  if (lower.startsWith("http://")) {
    return t.slice("http://".length).split("/")[0] ?? t;
  }
  if (lower.startsWith("wss://")) {
    return t.slice("wss://".length).split("/")[0] ?? t;
  }
  if (lower.startsWith("ws://")) {
    return t.slice("ws://".length).split("/")[0] ?? t;
  }
  return t.split("/")[0] ?? t;
}

export function buildDirectoryBaseUrl(host: string, directoryPort: number): string {
  const h = normalizeHost(host);
  return `http://${h}:${directoryPort}${DIRECTORY_HTTP_PATH}`;
}

export function buildLonglinkWsUrl(
  host: string,
  longlinkPort: number,
  apiKey: string,
  userId: string,
): string {
  const h = normalizeHost(host);
  const q = new URLSearchParams({ apiKey, userId });
  return `ws://${h}:${longlinkPort}${LONGLINK_WS_PATH}?${q.toString()}`;
}

export function resolvePorts(section: {
  directoryPort?: number;
  longlinkPort?: number;
}): { directoryPort: number; longlinkPort: number } {
  return {
    directoryPort: section.directoryPort ?? DEFAULT_DIRECTORY_PORT,
    longlinkPort: section.longlinkPort ?? DEFAULT_LONGLINK_PORT,
  };
}

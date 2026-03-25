import {
  DEFAULT_DIRECTORY_PORT,
  DEFAULT_LONGLINK_PORT,
  DIRECTORY_HTTP_PATH,
  LONGLINK_WS_PATH,
} from "./constants.js";
import { xcConsole } from "./trace-log.js";

/**
 * Strip scheme; keep host (and optional port if present in URL).
 * Only http/ws family is accepted for stripping; result is used with http:// and ws://.
 */
export function normalizeHost(raw: string): string {
  const t = raw.trim();
  if (!t) {
    xcConsole("warn", "urls", "normalizeHost.empty_input", {});
    return t;
  }
  const lower = t.toLowerCase();
  if (lower.startsWith("https://")) {
    const out = t.slice("https://".length).split("/")[0] ?? t;
    xcConsole("debug", "urls", "normalizeHost.stripped_scheme", { scheme: "https", out });
    return out;
  }
  if (lower.startsWith("http://")) {
    const out = t.slice("http://".length).split("/")[0] ?? t;
    xcConsole("debug", "urls", "normalizeHost.stripped_scheme", { scheme: "http", out });
    return out;
  }
  if (lower.startsWith("wss://")) {
    const out = t.slice("wss://".length).split("/")[0] ?? t;
    xcConsole("debug", "urls", "normalizeHost.stripped_scheme", { scheme: "wss", out });
    return out;
  }
  if (lower.startsWith("ws://")) {
    const out = t.slice("ws://".length).split("/")[0] ?? t;
    xcConsole("debug", "urls", "normalizeHost.stripped_scheme", { scheme: "ws", out });
    return out;
  }
  const out = t.split("/")[0] ?? t;
  xcConsole("debug", "urls", "normalizeHost.no_scheme", { out });
  return out;
}

export function buildDirectoryBaseUrl(host: string, directoryPort: number): string {
  const h = normalizeHost(host);
  const url = `http://${h}:${directoryPort}${DIRECTORY_HTTP_PATH}`;
  xcConsole("info", "urls", "buildDirectoryBaseUrl", { hostNorm: h, directoryPort, path: DIRECTORY_HTTP_PATH });
  return url;
}

export function buildLonglinkWsUrl(
  host: string,
  longlinkPort: number,
  apiKey: string,
  userId: string,
): string {
  const h = normalizeHost(host);
  const q = new URLSearchParams({ apiKey, userId });
  const url = `ws://${h}:${longlinkPort}${LONGLINK_WS_PATH}?${q.toString()}`;
  xcConsole("info", "urls", "buildLonglinkWsUrl", {
    hostNorm: h,
    longlinkPort,
    path: LONGLINK_WS_PATH,
    userIdLen: userId.length,
    apiKeyLen: apiKey.length,
  });
  return url;
}

export function resolvePorts(section: {
  directoryPort?: number;
  longlinkPort?: number;
}): { directoryPort: number; longlinkPort: number } {
  const directoryPort = section.directoryPort ?? DEFAULT_DIRECTORY_PORT;
  const longlinkPort = section.longlinkPort ?? DEFAULT_LONGLINK_PORT;
  xcConsole("debug", "urls", "resolvePorts", {
    directoryPort,
    longlinkPort,
    fromSectionDir: section.directoryPort !== undefined,
    fromSectionLl: section.longlinkPort !== undefined,
  });
  return { directoryPort, longlinkPort };
}

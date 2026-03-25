import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { CHANNEL_ID } from "./constants.js";
import { getHub, getMemory, removeHub, setHub } from "./hub-registry.js";
import { LonglinkHub, type GatewayTaskHandler } from "./longlink-hub.js";
import { xcclawithSectionSchema } from "./schema.js";

function readSectionRaw(cfg: OpenClawConfig): unknown {
  return (cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID];
}

const defaultLog = {
  info: (m: string) => console.info(m),
  warn: (m: string) => console.warn(m),
  error: (m: string) => console.error(m),
  debug: (_m: string) => {},
};

/**
 * Returns the hub used for this account, creating a Longlink connection if needed
 * (e.g. `openclaw message send` runs outside the gateway process, so `startAccount` never ran).
 */
export async function ensureXcclawithLonglinkHub(params: {
  cfg: OpenClawConfig;
  accountId: string;
  /** When spinning up outbound-only longlink; gateway replaces with a full handler on startAccount. */
  onGatewayTask?: GatewayTaskHandler;
  log?: typeof defaultLog;
  connectTimeoutMs?: number;
}): Promise<LonglinkHub> {
  const timeoutMs = params.connectTimeoutMs ?? 25_000;
  const log = params.log ?? defaultLog;

  const existing = getHub(params.accountId);
  if (existing) {
    await existing.waitForOpen(timeoutMs);
    return existing;
  }

  const parsed = xcclawithSectionSchema.safeParse(readSectionRaw(params.cfg));
  if (!parsed.success) {
    throw new Error(`xcclawith_config_invalid ${JSON.stringify(parsed.error.issues)}`);
  }
  const section = parsed.data;
  if (!section.host?.trim() || !section.apiKey) {
    throw new Error("xcclawith_host_and_apikey_required");
  }

  const memory = getMemory(params.accountId);
  const ac = new AbortController();
  const hub = new LonglinkHub(
    section,
    memory,
    log,
    params.onGatewayTask ?? (async () => {}),
    ac.signal,
  );
  hub.start();
  setHub(params.accountId, hub);
  try {
    await hub.waitForOpen(timeoutMs);
  } catch (e) {
    removeHub(params.accountId);
    throw e instanceof Error ? e : new Error(String(e));
  }
  return hub;
}

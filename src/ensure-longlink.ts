import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { CHANNEL_ID } from "./constants.js";
import { getHub, getMemory, removeHub, setHub } from "./hub-registry.js";
import { LonglinkHub, type GatewayTaskHandler } from "./longlink-hub.js";
import { resolveEffectiveSection, xcclawithSectionSchema } from "./schema.js";
import { xcConsole } from "./trace-log.js";

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

  xcConsole("info", "ensureHub", "entry", {
    accountId: params.accountId,
    timeoutMs,
    hasCustomTaskHandler: Boolean(params.onGatewayTask),
  });

  const existing = getHub(params.accountId);
  if (existing) {
    xcConsole("info", "ensureHub", "reuse_existing_hub", { accountId: params.accountId });
    try {
      await existing.waitForOpen(timeoutMs);
      xcConsole("info", "ensureHub", "reuse.wait_open.ok", { accountId: params.accountId });
    } catch (e) {
      xcConsole("error", "ensureHub", "reuse.wait_open.failed", {
        accountId: params.accountId,
        err: String(e),
      });
      throw e instanceof Error ? e : new Error(String(e));
    }
    return existing;
  }

  xcConsole("info", "ensureHub", "no_cached_hub.creating", { accountId: params.accountId });

  const parsed = xcclawithSectionSchema.safeParse(readSectionRaw(params.cfg));
  if (!parsed.success) {
    xcConsole("error", "ensureHub", "config.parse_failed", {
      issues: parsed.error.issues,
      meaning: "channels.xcclawith in openclaw config failed Zod parse",
    });
    throw new Error(`xcclawith_config_invalid ${JSON.stringify(parsed.error.issues)}`);
  }
  const section = parsed.data;
  const eff = resolveEffectiveSection(section);
  xcConsole("info", "ensureHub", "config.ok", {
    host: eff.host,
    directoryPort: eff.directoryPort,
    longlinkPort: eff.longlinkPort,
    userIdLen: eff.userId.length,
    apiKeyLen: eff.apiKey.length,
  });
  if (!section.host?.trim() || !section.apiKey) {
    xcConsole("error", "ensureHub", "config.missing_host_or_key", {});
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
  xcConsole("info", "ensureHub", "hub.construct.start", { accountId: params.accountId });
  hub.start();
  setHub(params.accountId, hub);
  xcConsole("info", "ensureHub", "hub.start.registered", { accountId: params.accountId });
  try {
    await hub.waitForOpen(timeoutMs);
    xcConsole("info", "ensureHub", "wait_open.ok", { accountId: params.accountId });
  } catch (e) {
    xcConsole("error", "ensureHub", "wait_open.failed_cleanup", {
      accountId: params.accountId,
      err: String(e),
      meaning: "WS did not reach OPEN in time or errored; hub removed from registry",
    });
    removeHub(params.accountId);
    throw e instanceof Error ? e : new Error(String(e));
  }
  return hub;
}

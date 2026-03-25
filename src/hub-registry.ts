import type { LonglinkHub } from "./longlink-hub.js";
import { ClawithMemoryState } from "./memory-state.js";
import { xcConsole } from "./trace-log.js";

const hubs = new Map<string, LonglinkHub>();
const memories = new Map<string, ClawithMemoryState>();

export function hubKey(accountId: string): string {
  return accountId || "default";
}

export function getMemory(accountId: string): ClawithMemoryState {
  const k = hubKey(accountId);
  let m = memories.get(k);
  if (!m) {
    m = new ClawithMemoryState();
    memories.set(k, m);
    xcConsole("info", "registry", "memory.created", { key: k });
  }
  return m;
}

export function setHub(accountId: string, hub: LonglinkHub): void {
  const k = hubKey(accountId);
  xcConsole("info", "registry", "hub.register", { key: k });
  hubs.set(k, hub);
}

export function getHub(accountId: string): LonglinkHub | undefined {
  const k = hubKey(accountId);
  const h = hubs.get(k);
  xcConsole("info", "registry", "hub.get", { key: k, hit: h !== undefined });
  return h;
}

export function removeHub(accountId: string): void {
  const k = hubKey(accountId);
  const had = hubs.has(k);
  xcConsole("info", "registry", "hub.remove.begin", { key: k, hadHub: had });
  hubs.get(k)?.stop();
  hubs.delete(k);
  xcConsole("info", "registry", "hub.remove.done", { key: k });
}

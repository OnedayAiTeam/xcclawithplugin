import type { LonglinkHub } from "./longlink-hub.js";
import { ClawithMemoryState } from "./memory-state.js";

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
  }
  return m;
}

export function setHub(accountId: string, hub: LonglinkHub): void {
  hubs.set(hubKey(accountId), hub);
}

export function getHub(accountId: string): LonglinkHub | undefined {
  return hubs.get(hubKey(accountId));
}

export function removeHub(accountId: string): void {
  const k = hubKey(accountId);
  hubs.get(k)?.stop();
  hubs.delete(k);
}

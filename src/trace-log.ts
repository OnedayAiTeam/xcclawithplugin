/**
 * Structured xcclawith tracing: every line is `[xcclawith][phase] action | k=v ...`
 * so grepping logs shows which subsystem failed and with what inputs.
 */

export type XcSink = {
  info?: (m: string) => void;
  warn?: (m: string) => void;
  error?: (m: string) => void;
  debug?: (m: string) => void;
};

function fmt(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 800 ? `${s.slice(0, 800)}…(trunc)` : s;
  } catch {
    return String(v);
  }
}

export function xcLine(phase: string, action: string, fields?: Record<string, unknown>): string {
  if (!fields || !Object.keys(fields).length) {
    return `[xcclawith][${phase}] ${action}`;
  }
  const kv = Object.entries(fields)
    .map(([k, v]) => `${k}=${fmt(v)}`)
    .join(" ");
  return `[xcclawith][${phase}] ${action} | ${kv}`;
}

export function xcConsole(
  level: "debug" | "info" | "warn" | "error",
  phase: string,
  action: string,
  fields?: Record<string, unknown>,
): void {
  const line = xcLine(phase, action, fields);
  switch (level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

/** Emit to OpenClaw sink (if any) and always mirror to console — easier to correlate gateway + process logs. */
export function xcBoth(
  sink: XcSink | undefined,
  level: "debug" | "info" | "warn" | "error",
  phase: string,
  action: string,
  fields?: Record<string, unknown>,
): void {
  const line = xcLine(phase, action, fields);
  switch (level) {
    case "debug":
      sink?.debug?.(line);
      console.debug(line);
      break;
    case "info":
      sink?.info?.(line);
      console.info(line);
      break;
    case "warn":
      sink?.warn?.(line);
      console.warn(line);
      break;
    case "error":
      sink?.error?.(line);
      console.error(line);
      break;
  }
}

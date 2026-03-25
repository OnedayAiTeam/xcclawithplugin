import { buildConverterPostUrl, resolvePorts } from "./urls.js";
import type { XcclawithSection } from "./schema.js";

export async function postGatewayConverter(params: {
  section: XcclawithSection;
  receiverId: string;
}): Promise<string> {
  const { directoryPort } = resolvePorts(params.section);
  const url = buildConverterPostUrl(params.section.host, directoryPort);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Api-Key": params.section.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ receiver_id: params.receiverId.trim() }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`converter_http_${res.status}: ${text.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("converter_invalid_json");
  }
  const cid =
    parsed &&
    typeof parsed === "object" &&
    typeof (parsed as { converter_id?: unknown }).converter_id === "string"
      ? (parsed as { converter_id: string }).converter_id.trim()
      : "";
  if (!cid) {
    throw new Error("converter_missing_converter_id");
  }
  return cid.toLowerCase();
}

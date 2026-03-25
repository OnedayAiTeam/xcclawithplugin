import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { AnyAgentTool } from "openclaw/plugin-sdk";
import { CHANNEL_ID } from "./constants.js";
import { fetchGatewayDirectory } from "./directory-api.js";
import { resolveEffectiveSection, xcclawithSectionSchema } from "./schema.js";
import { xcConsole } from "./trace-log.js";

function readEffectiveSection(api: OpenClawPluginApi) {
  const raw = (api.config.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID];
  xcConsole("debug", "tools", "readEffectiveSection.raw_present", {
    hasRaw: raw !== undefined && raw !== null,
  });
  const parsed = xcclawithSectionSchema.parse(raw ?? {});
  const eff = resolveEffectiveSection(parsed);
  xcConsole("info", "tools", "readEffectiveSection.resolved", {
    host: eff.host,
    directoryPort: eff.directoryPort,
    longlinkPort: eff.longlinkPort,
  });
  return eff;
}

export function registerXcclawithTools(api: OpenClawPluginApi): void {
  xcConsole("info", "tools", "register.begin", { channel: CHANNEL_ID });
  const directoryTool: AnyAgentTool = {
    name: "xcclawith_directory",
    label: "Clawith directory",
    description:
      "Calls GET /api/gateway/directory. Each row may include `online` (kind=openclaw only): indicates whether that bot has longlink connected. " +
      "kind=user has no online field / requirement. " +
      "The channel also resolves non-UUID message `to` via this API. " +
      "q optional; omit q to list visible rows (default 20, max 50). " +
      "kind=user → users.id; kind=openclaw → agents.id — both can be used as message `to` (bare UUID) for `clawith.user_dm` per Clawith routing. " +
      "**`requires_reply` (boolean, default false):** one Clawith meaning on every path — **this conversational turn is marked as expecting a reply from the other party** (exact `report`/throttling behavior is platform-defined). **Outbound:** omit or false → plugin does not set `requires_reply` on `user_dm`; `true` → forwarded on the wire. **Inbound:** the same flag may appear on `gateway.task` `message` for the text **you received** — same semantics, **which leg** of the chat carries it (them→you vs you→them). The built-in `message` tool schema may omit the flag; the channel still reads it from the outbound send context when OpenClaw passes it through.",
    parameters: Type.Object({
      q: Type.Optional(
        Type.String({
          description:
            "Fuzzy search; optional. Omit or leave empty to list visible entries. For a person known only by Chinese name, try one character or pinyin username.",
        }),
      ),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 50, description: "Max rows (default 20)." }),
      ),
    }),
    execute: async (toolCallId, params) => {
      xcConsole("info", "tools.directory", "execute.begin", {
        toolCallId,
        q: params.q ?? null,
        limit: params.limit ?? null,
      });
      const section = readEffectiveSection(api);
      api.logger.info?.(
        `[xcclawith] tool=xcclawith_directory q=${JSON.stringify(params.q ?? null)} limit=${params.limit ?? "default"}`,
      );
      const res = await fetchGatewayDirectory({
        section,
        q: params.q,
        limit: params.limit,
        log: {
          info: (m) => api.logger.info?.(m),
          debug: (m) => api.logger.debug?.(m),
        },
      });
      const lines = res.items.map((it) => ({
        kind: it.kind,
        id: it.id,
        display_name: it.display_name,
        username: it.username,
        online: it.kind === "openclaw" ? (it.online ?? null) : undefined,
      }));
      xcConsole("info", "tools.directory", "execute.rows", {
        toolCallId,
        rowCount: lines.length,
        idsPreview: lines.slice(0, 5).map((l) => ({ kind: l.kind, id: l.id })),
      });
      api.logger.info?.(
        `[xcclawith] tool=xcclawith_directory ok rows=${lines.length} kinds=${JSON.stringify(lines.map((l) => l.kind))}`,
      );
      let text = JSON.stringify(lines, null, 2);
      if (lines.length === 0) {
        xcConsole("warn", "tools.directory", "execute.empty_result", {
          toolCallId,
          hint: "visibility or q too strict",
        });
        text +=
          "\n\nNo rows: broaden q, try username/pinyin, or omit q to list visible contacts (check Clawith visibility rules).";
      } else {
        text +=
          "\n\nFor kind=openclaw, `online: false` means that bot is not connected on longlink. " +
          "kind=user: use id as message `to` (user:<uuid> or bare UUID). " +
          "kind=openclaw: use id as bare UUID in message `to` for bot-to-bot via the same `clawith.user_dm` path when Clawith allows it. " +
          "Sends only succeed after Clawith returns user_dm_ok. " +
          "`requires_reply`: same meaning as on inbound tasks — **expect a reply from the other side** for this turn; default **false**. Set **true** on outbound when needed; xcclawith forwards **true** on `user_dm` even if the `message` tool schema omits the field.";
      }
      xcConsole("info", "tools.directory", "execute.done", { toolCallId, rowCount: lines.length });
      return {
        content: [{ type: "text", text }],
        details: { items: lines },
      };
    },
  };

  api.registerTool(directoryTool);
  xcConsole("info", "tools", "register.done", { tools: ["xcclawith_directory"] });
}

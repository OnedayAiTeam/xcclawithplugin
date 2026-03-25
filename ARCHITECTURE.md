# Architecture (Clawith Longlink plugin)

## Layers

1. **Config** — `channels.xcclawith` validated with Zod + `buildChannelConfigSchema`; URLs built only from `host`, ports, and fixed paths (`/ws`, `/api/gateway/directory`). Schemes: `ws://` + `http://` only.
2. **LonglinkHub** — `ws` client, reconnect on close, parses downlink frames, applies `user_dm_ok` into **in-memory** maps (legacy `peer_message_*` events are logged only).
3. **Inbound** — `gateway.task` → `dispatchInboundDirectDmWithRuntime` (OpenClaw direct-DM pipeline); `deliver` sends `clawith.user_dm`; after the run, sends `report` with the task root id. If `openclaw.json` omits `session.dmScope`, the plugin passes a merged config with **`dmScope: "per-channel-peer"`** so session keys include **`xcclawith`** and are per Clawith user (instead of core default `main` which would collapse to `agent:<id>:main`).
4. **Outbound** — Shared `message` tool path uses `attachedResults.sendText` → `clawith.user_dm` with stored or fresh `conversation_id`.
5. **Tools** — `xcclawith_directory` (HTTP directory). Outbound chat is the core `message` path → `clawith.user_dm`.

## Entry points

- `dist/index.js` — full plugin + tool registration.
- `dist/setup-entry.js` — `defineSetupPluginEntry` only.

## Types note

`ctx.channelRuntime` is asserted to `DirectDmRuntime` at the TypeScript level; at runtime OpenClaw supplies the expected channel helpers.

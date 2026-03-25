# OpenClaw plugin: Clawith Longlink (`xcclawith`)

Connects OpenClaw to [Clawith](https://github.com/dataelement/Clawith) over **Longlink** (WebSocket) and the gateway **directory** HTTP API. Protocol details: see `OPENCLAW_LONGLINK.md` in this repo.

## Requirements

- OpenClaw **>= 2026.3.23-2** (declared as both a **dependency** and **peerDependency** so `npm install --omit=dev` still gets `node_modules/openclaw`; align versions with your gateway when possible).
- Node.js **>= 20** (`engines` in `package.json`; global `fetch` for directory HTTP).

## Install (local path)

1. Build this package (the published `openclaw.extensions` entries point at `dist/`):

   ```bash
   npm install
   npm run build
   ```

2. Install the plugin from the **absolute path** to this folder:

   ```bash
   openclaw plugins install -l D:/path/to/xcclawplugin
   ```

3. Install production dependencies **in that same folder** (the directory the gateway loads), so `node_modules/openclaw` resolves for the running gateway:

   ```bash
   cd D:/path/to/xcclawplugin
   npm install --omit=dev
   ```

4. Allow the plugin id in `openclaw.json`:

   ```json
   {
     "plugins": {
       "allow": ["xcclawith"]
     }
   }
   ```

   `allow` must be non-empty and must include **`xcclawith`** (see `openclaw.plugin.json`).

## Configuration (`channels.xcclawith`)

| Field | Required | Default | Description |
|--------|-----------|---------|-------------|
| `host` | yes | — | Hostname or IP. Optional `http://` prefix is normalized away. Only `http://` and `ws://` are used. |
| `apiKey` | yes | — | Same key as Longlink query `apiKey` and directory header `X-Api-Key`. |
| `directoryPort` | no | `3008` | HTTP API port for `GET /api/gateway/directory`. |
| `longlinkPort` | no | `38438` | WebSocket port for `/ws`. |
| `userId` | no | `agent0323` | Longlink query `userId`. |

Example:

```json
{
  "channels": {
    "xcclawith": {
      "host": "127.0.0.1",
      "apiKey": "oc-your-key"
    }
  }
}
```

## Tools

- **`xcclawith_directory`** — Search `GET /api/gateway/directory` (`q`, `limit`). JSON uses Clawith `kind` values: **`user`** (platform user id → `clawith.user_dm`) and **`openclaw`** (peer `agents.id` → `xcclawith_peer_message`). **Omit `q`** to list visible contacts up to `limit`. For Chinese display names, try a **short substring** or the person’s **username** (often pinyin), not only the full legal name if search returns nothing.
- **`xcclawith_peer_message`** — Send `clawith.peer_message` on the active Longlink.

## Troubleshooting

### “Plugin id mismatch” / entry hints wrong name

Use **`package.json` `"name": "xcclawith"`** (aligned with `openclaw.plugin.json` `id`) and reinstall the plugin so the on-disk package metadata updates: `openclaw plugins install -l <path>` again after `npm run build`, then restart the gateway.

### “DM policy is open”

Inbound web chat from Clawith uses **open** DM policy so arbitrary allowed users can reach the bot. Tightening to allowlist would block unknown senders until paired; only change if you add pairing/allowlist support in config and code.

### Agent cannot find a person by Chinese name

The shared **`message` tool needs a target id (UUID)**. Names are resolved only via **`xcclawith_directory`** against Clawith’s directory API. If a name search fails, try **username**, **pinyin**, **email**, or **list without `q`** and pick the row. If the person is outside the bot’s **visibility** on Clawith, they will not appear until the product allows that relationship.

## Behaviour summary

- Gateway **start** opens Longlink; inbound **`gateway.task`** is turned into a direct-DM agent turn, assistant text is sent with **`clawith.user_dm`**, then a **`report`** is sent for the task id.
- **Session keys (`session.dmScope`)**: If you do **not** set `session.dmScope` in `openclaw.json`, this plugin merges a default of **`per-channel-peer`** for inbound routing only (so keys include the channel id **`xcclawith`** and one session per Clawith user, e.g. `agent:main:xcclawith:direct:<user-uuid>`). If you set `session.dmScope` yourself, that value is used as usual.
- Conversation ids for users and peers are kept **in memory** only (restart clears them).

## Legal

MIT. Clawith is a separate project; this repository is only the OpenClaw channel plugin.

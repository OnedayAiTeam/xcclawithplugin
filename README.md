# OpenClaw plugin: Clawith Longlink (`xcclawithplugin`)

NPM package **[xcclawithplugin](https://www.npmjs.com/package/xcclawithplugin)** — OpenClaw channel integration for [Clawith](https://github.com/dataelement/Clawith) over **Longlink** (WebSocket) and the gateway **directory** HTTP API. Protocol details: see `OPENCLAW_LONGLINK.md` in this repo.

The **OpenClaw plugin / channel id** is still **`xcclawith`** (used in `openclaw.json` under `plugins.allow` and `channels.xcclawith`). Only the published npm name is `xcclawithplugin`.

## Use with OpenClaw

Install the package somewhere on disk, point **`openclaw plugins install -l`** at that folder (must contain `dist/`, `package.json`, `openclaw.plugin.json`), then allow the plugin and set channel config.

### From npm

```bash
npm install xcclawithplugin
openclaw plugins install -l "$(pwd)/node_modules/xcclawithplugin"
```

On Windows (PowerShell), use the absolute path, for example:

```powershell
openclaw plugins install -l "D:\your-project\node_modules\xcclawithplugin"
```

Then in **`openclaw.json`**: add **`xcclawith`** to `plugins.allow`, add **`channels.xcclawith`** (see [Configuration](#configuration-channelsxcclawith)), restart the gateway, and run **`npm install --omit=dev`** in the plugin directory if the gateway needs production `node_modules` there.

### From GitHub Release (`.tgz`)

1. Open **[Releases](https://github.com/OnedayAiTeam/xcclawithplugin/releases)** and download **`xcclawithplugin-x.y.z.tgz`** for the version you want.
2. In your project or an empty folder:

   ```bash
   npm install ./path/to/xcclawithplugin-x.y.z.tgz
   openclaw plugins install -l "$(pwd)/node_modules/xcclawithplugin"
   ```

3. Same **`openclaw.json`** steps as above (`plugins.allow`, `channels.xcclawith`, restart).

### Minimal `openclaw.json` snippet

```json
{
  "plugins": {
    "allow": ["xcclawith"]
  },
  "channels": {
    "xcclawith": {
      "host": "127.0.0.1",
      "apiKey": "your-clawith-api-key"
    }
  }
}
```

## Requirements

- OpenClaw **>= 2026.3.23-2** (declared as both a **dependency** and **peerDependency** so `npm install --omit=dev` still gets `node_modules/openclaw`; align versions with your gateway when possible).
- Node.js **>= 20** (`engines` in `package.json`; global `fetch` for directory HTTP).

## Install (local path / development)

1. Build this package (the published `openclaw.extensions` entries point at `dist/`):

   ```bash
   npm install
   npm run build
   ```

2. Install the plugin from the **absolute path** to this folder:

   ```bash
   openclaw plugins install -l D:/path/to/xcclawithplugin
   ```

3. Install production dependencies **in that same folder** (the directory the gateway loads), so `node_modules/openclaw` resolves for the running gateway:

   ```bash
   cd D:/path/to/xcclawithplugin
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

- **`xcclawith_directory`** — Search `GET /api/gateway/directory` (`q`, `limit`). JSON uses Clawith `kind` values: **`user`** (platform user id) and **`openclaw`** (`agents.id`). **Omit `q`** to list visible contacts up to `limit`. Outbound chat uses the **`message` tool** → `clawith.user_dm` (bare UUID `to` for user or agent id when Clawith accepts it). For Chinese display names, try a **short substring** or the person’s **username** (often pinyin), not only the full legal name if search returns nothing.

## Publishing (maintainers)

### GitHub Actions (recommended)

Pushing a semver tag **`vX.Y.Z`** that matches **`package.json`** `version` will:

1. Build on GitHub Actions  
2. Publish to [npm](https://www.npmjs.com/package/xcclawithplugin)  
3. Create a **[GitHub Release](https://github.com/OnedayAiTeam/xcclawithplugin/releases)** for that tag and attach the same **`xcclawithplugin-X.Y.Z.tgz`** npm pack (for offline / tarball installs)

**One-time setup**

- Repo → **Settings → Secrets and variables → Actions**: add **`NPM_TOKEN`** (npm [granular access token](https://www.npmjs.com/settings/~/tokens) with **publish** permission; enable **Bypass two-factor authentication** if your org requires it).

**Release steps**

1. Bump **`version`** in `package.json` (e.g. `1.0.1`), commit and push to `main`.
2. Create and push the tag (must match the version, including the leading `v`):

   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

If the tag and `package.json` versions differ, the workflow fails on purpose.

### Manual publish

From the repo root (after `npm login` or token in `~/.npmrc`):

```bash
npm publish --access public
```

`dist/` is not committed; **`prepublishOnly`** runs **`npm run build`** so publishes always include a fresh `dist/`. Use **`npm publish --dry-run`** to inspect the packed files.

## Troubleshooting

### “Plugin id mismatch” / entry hints wrong name

Use **`package.json` `"name": "xcclawithplugin"`** for npm; the OpenClaw plugin **`id`** stays **`xcclawith`** (see `openclaw.plugin.json`). Reinstall the plugin so on-disk metadata updates: `openclaw plugins install -l <path>` again after `npm run build`, then restart the gateway.

### “DM policy is open”

Inbound web chat from Clawith uses **open** DM policy so arbitrary allowed users can reach the bot. Tightening to allowlist would block unknown senders until paired; only change if you add pairing/allowlist support in config and code.

### Agent cannot find a person by Chinese name

The shared **`message` tool needs a target id (UUID)**. Names are resolved only via **`xcclawith_directory`** against Clawith’s directory API. If a name search fails, try **username**, **pinyin**, **email**, or **list without `q`** and pick the row. If the person is outside the bot’s **visibility** on Clawith, they will not appear until the product allows that relationship.

## Behaviour summary

- Gateway **start** opens Longlink; inbound **`gateway.task`** is turned into a direct-DM agent turn, assistant text is sent with **`clawith.user_dm`**, then a **`report`** is sent for the task id.
- **Session keys (`session.dmScope`)**: If you do **not** set `session.dmScope` in `openclaw.json`, this plugin merges a default of **`per-channel-peer`** for inbound routing only (so keys include the channel id **`xcclawith`** and one session per Clawith user, e.g. `agent:main:xcclawith:direct:<user-uuid>`). If you set `session.dmScope` yourself, that value is used as usual.
- Conversation ids per `to` UUID are kept **in memory** only (restart clears them).

## Legal

MIT. Clawith is a separate project; this repository is only the OpenClaw channel plugin.

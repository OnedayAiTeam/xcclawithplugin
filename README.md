# OpenClaw plugin: Clawith Longlink (`xcclawithplugin`)

NPM package **[xcclawithplugin](https://www.npmjs.com/package/xcclawithplugin)** — OpenClaw channel integration for [Clawith](https://github.com/dataelement/Clawith) over **Longlink** (WebSocket) and the gateway **directory** HTTP API. Protocol details: see `OPENCLAW_LONGLINK.md` in this repo.

The **OpenClaw plugin / channel id** is still **`xcclawith`** (used in `openclaw.json` under `plugins.allow` and `channels.xcclawith`). Only the published npm name is `xcclawithplugin`.

## 简介（中文）

- **作用**：把 OpenClaw 接到 [Clawith](https://github.com/dataelement/Clawith)，走 Longlink（WebSocket）收发消息，并用网关的 **directory** HTTP 接口做联系人检索等。
- **命名**：在 [npm](https://www.npmjs.com/package/xcclawithplugin) 上安装包名是 **`xcclawithplugin`**；在 **`openclaw.json`** 里仍使用插件 id / 渠道键 **`xcclawith`**（例如 `plugins.allow`、`channels.xcclawith`、工具 **`xcclawith_directory`**）。
- **协议细节**：仓库内见 `OPENCLAW_LONGLINK.md`。

## Use with OpenClaw

**中文概要**：把包含 `dist/`、`package.json`、`openclaw.plugin.json` 的插件目录装到本机，执行 **`openclaw plugins install -l <绝对路径>`** 指向该目录；在 **`openclaw.json`** 里允许插件并配置 **`channels.xcclawith`**，重启网关。若网关从该目录加载且需要运行时依赖，可在插件目录执行 **`npm install --omit=dev`**。

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

**中文**：需要 OpenClaw **>= 2026.3.23-2**、Node **>= 20**；`package.json` 里把 `openclaw` 同时写在 `dependencies` 与 `peerDependencies`，以便生产安装时仍能解析到 `node_modules/openclaw`。

- OpenClaw **>= 2026.3.23-2** (declared as both a **dependency** and **peerDependency** so `npm install --omit=dev` still gets `node_modules/openclaw`; align versions with your gateway when possible).
- Node.js **>= 20** (`engines` in `package.json`; global `fetch` for directory HTTP).

## Install (local path / development)

**中文**：从源码开发时在本仓库执行 `npm install` 与 `npm run build`，再用 **`openclaw plugins install -l`** 指向本仓库根目录，并在该目录 **`npm install --omit=dev`** 供网关解析依赖。

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

**中文**：在 `openclaw.json` 的 `channels.xcclawith` 下填写 Clawith 网关地址与 API Key；`host` 可带或不带 `http://`；目录服务与 Longlink 端口可按需覆盖默认值。

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

**中文**：**`xcclawith_directory`** 查询 Clawith 通讯录接口；`kind=user` 对应平台用户、`kind=openclaw` 对应其他机器人。发消息仍走 OpenClaw 的 **`message`** 工具，目标需 UUID（可先搜人）。中文名搜不到时可试 **用户名、拼音片段、邮箱**，或不传 `q` 拉列表再选。

- **`xcclawith_directory`** — Search `GET /api/gateway/directory` (`q`, `limit`). JSON uses Clawith `kind` values: **`user`** (platform user id) and **`openclaw`** (`agents.id`). **Omit `q`** to list visible contacts up to `limit`. Outbound chat uses the **`message` tool** → `clawith.user_dm` (bare UUID `to` for user or agent id when Clawith accepts it). For Chinese display names, try a **short substring** or the person’s **username** (often pinyin), not only the full legal name if search returns nothing.

## Publishing (maintainers)

**中文（维护者）**：CI 会构建、发布 npm、打 **`vX.Y.Z`** 标签并上传 Release 资源包。仓库 **Secrets** 需配置 **`NPM_TOKEN`**。可 **推送 tag** 或在 GitHub **Actions 里手动 Run workflow**；填写的版本号须与 **`package.json` 的 `version` 一致**。标签指错提交时可勾选 **retag** 重建远程 tag（**不能**用同一版本重复发布到 npm，需升版本号）。

### GitHub Actions (recommended)

Each run **builds**, **publishes to [npm](https://www.npmjs.com/package/xcclawithplugin)**, **creates or updates a [GitHub Release](https://github.com/OnedayAiTeam/xcclawithplugin/releases)** for **`vX.Y.Z`**, and attaches **`xcclawithplugin-X.Y.Z.tgz`**.

**One-time setup**

- Repo → **Settings → Secrets and variables → Actions**: add **`NPM_TOKEN`** (npm [granular access token](https://www.npmjs.com/settings/~/tokens) with **publish** permission; enable **Bypass two-factor authentication** if your org requires it).

**Option A — Push a tag (CLI)**

1. Bump **`version`** in `package.json`, commit and push to the default branch (e.g. `main`).
2. Tag must match that version (with a leading `v`):

   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

If the tag and `package.json` versions differ, the workflow fails.

**Option B — Run from the GitHub website (no local tag)**

1. Bump **`version`** in `package.json`, commit and push to the default branch.
2. Open **Actions** → **Publish to npm and GitHub Release** → **Run workflow**.
3. Enter **`version`** (same as `package.json`, **without** `v`, e.g. `1.0.1`).
4. Optional: check **retag** if the remote **`v1.0.1`** tag already exists but pointed at the **wrong commit** — the workflow deletes that remote tag and recreates it on the commit that was checked out when you ran the workflow (after a successful npm publish).

**retag / wrong tag notes**

- **retag** only affects the **GitHub** tag, not npm. You cannot re-publish the same version to npm; if publish already succeeded, use a **new semver** in `package.json` for another release.
- If you run the manual workflow **without** retag and remote **`vX.Y.Z`** exists on another commit, the job **fails early** so you do not publish with a mismatched tag — either push the correct commit to the default branch or enable **retag**.

### Manual publish

From the repo root (after `npm login` or token in `~/.npmrc`):

```bash
npm publish --access public
```

`dist/` is not committed; **`prepublishOnly`** runs **`npm run build`** so publishes always include a fresh `dist/`. Use **`npm publish --dry-run`** to inspect the packed files.

## Troubleshooting

**中文**：常见问题包括插件 id 与 npm 包名不一致时的重装、入站 DM 策略为开放、以及中文姓名需通过 directory 工具解析等，详见各小节英文说明。

### “Plugin id mismatch” / entry hints wrong name

Use **`package.json` `"name": "xcclawithplugin"`** for npm; the OpenClaw plugin **`id`** stays **`xcclawith`** (see `openclaw.plugin.json`). Reinstall the plugin so on-disk metadata updates: `openclaw plugins install -l <path>` again after `npm run build`, then restart the gateway.

### “DM policy is open”

Inbound web chat from Clawith uses **open** DM policy so arbitrary allowed users can reach the bot. Tightening to allowlist would block unknown senders until paired; only change if you add pairing/allowlist support in config and code.

### Agent cannot find a person by Chinese name

The shared **`message` tool needs a target id (UUID)**. Names are resolved only via **`xcclawith_directory`** against Clawith’s directory API. If a name search fails, try **username**, **pinyin**, **email**, or **list without `q`** and pick the row. If the person is outside the bot’s **visibility** on Clawith, they will not appear until the product allows that relationship.

## Behaviour summary

**中文**：网关注册后建立 Longlink；入站任务走直连 DM，回复经 **`clawith.user_dm`** 发出并 **`report`**。未自定义 `session.dmScope` 时，入站侧会按 **`per-channel-peer`** 合并会话键（含渠道 id **`xcclawith`**）。按目标 UUID 维护的会话 id 仅存内存，重启丢失。

- Gateway **start** opens Longlink; inbound **`gateway.task`** is turned into a direct-DM agent turn, assistant text is sent with **`clawith.user_dm`**, then a **`report`** is sent for the task id.
- **Session keys (`session.dmScope`)**: If you do **not** set `session.dmScope` in `openclaw.json`, this plugin merges a default of **`per-channel-peer`** for inbound routing only (so keys include the channel id **`xcclawith`** and one session per Clawith user, e.g. `agent:main:xcclawith:direct:<user-uuid>`). If you set `session.dmScope` yourself, that value is used as usual.
- Conversation ids per `to` UUID are kept **in memory** only (restart clears them).

## Legal

MIT。Clawith 为独立项目；本仓库仅为 OpenClaw 渠道插件。

MIT. Clawith is a separate project; this repository is only the OpenClaw channel plugin.

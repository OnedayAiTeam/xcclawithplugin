# Clawith Longlink 扩展 — 需求说明

## 1. 依赖

- 运行时 `dependencies` 仅声明本扩展直接需要、且安装后仍无法由传递依赖满足的包。
- 不将其它产品（如 OpenClaw）的完整 `dependencies` 列表复制进本包。
- 在仅使用 npm、且非 monorepo 的安装场景下，`package.json` 不得包含 npm 无法解析的协议（例如 `workspace:*`）。

## 2. 构建与产物

- 发布或交付目录须包含可执行的 `dist`（含渠道入口与 setup 入口）、`package.json`、`openclaw.plugin.json`。

## 3. 安装说明文档

- 默认安装方式为：`openclaw plugins install -l <扩展根目录绝对路径>`。
- 须说明：在网关实际加载的扩展根目录安装生产依赖，以保证存在 `node_modules/openclaw`（或等价解析路径）。
- 须说明：`openclaw.json` 中 `plugins.allow` 须包含本插件 manifest 的 `id`，且 `allow` 不得为空数组。
- 文档中不出现字符串 `openclaw china` 与 `OpenClaw China`（含大小写组合）。

## 4. 配置（`channels.xcclawith`）

- 必填：`host`、`apiKey`。
- `host` 表示 Clawith 服务所在主机（主机名或 IP）；可无协议或带 `http://`，按实现约定归一。
- 目录 HTTP 与 longlink WebSocket 的访问地址**仅**由 `host`、`directoryPort`（默认 3008）、`longlinkPort`（默认 38438）及固定路径组合得出。

## 5. 配置模式与工具说明

- JSON Schema、插件内校验 schema、以及面向模型的工具/能力描述中，**不包含**已下线字段；已下线项从模式中删除，不保留「已废弃」「兼容」类说明。

## 6. devDependencies

- 保留构建与类型检查所需项（如 `typescript`、`tsup`、`@types/*`、用于打包进 `dist` 的 `ws` 等），与运行时 `dependencies` 区分清楚。

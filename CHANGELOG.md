# 更新记录

本项目沿用语义化版本。公开 Beta 仍可能有安装、兼容和行为调整。

## 0.1.0-beta.1 - 2026-10-26

> 2026-10-28：候选的 Windows x64 Desktop 与 Linux x64 CLI/Web 矩阵门禁已通过；macOS Apple Silicon Desktop 尚未运行。三平台人工发布授权仍未完成。

首个公开 Beta。用用户自己的 Grok `0.1.26` 接管 DSH 内置网页搜索；搜索失败明确报错，不自动回退官方搜索。

### 新增

- 原生 `grok-search` Web 搜索 provider，通过 stdio MCP 调用外部 `grok-search-rs`。
- 单包五个组件：搜索核心、接管控制、设置页、路由核验和启动恢复。
- 设置页「Grok 搜索接管」卡片，以及 owner 存活时的「停止接管并恢复原搜索」。
- 版本化控制记录、本地文件系统协作式 CAS、显式迁移和失败关闭。
- 释放事务：同步 invalidation、有界 drain、release CAS、路由恢复和独立验证。
- 基于 DSH canonical Session 事件类型的原始官方搜索派发计数。
- 上一进程未完成释放时的跨进程启动补完。
- 查询容量、总预算、结果字符数、单条 MCP 消息大小和进程回收边界。
- Windows x64 Desktop、macOS Apple Silicon Desktop、Linux x64 CLI/Web 的单包安装路径（macOS Apple Silicon 门禁仍待运行）。
- 面向用户的完整中文 README、FAQ、错误码、数据边界和 30 秒验收步骤。

### 变更

- 早期内部候选的 `dsh-grok-search-recovery` 并入 `dsh-grok-search`，公开 Beta 只发布一个插件。
- 依赖固定为 `@modelcontextprotocol/client@2.4.0`，修复已知 npm 审计问题。
- 包内 README 按用户安装路径重写，开发与验证细节移入独立文档。

### 验证

- Windows x64 Desktop `0.2.1-rc.2`/`rc.3`：同一 tarball 的安装、启用、停用、移除和重启，以及配置重载、真实设置页停止接管通过。
- Windows M0-04：多 Session、preset、PTC、重连和预算矩阵通过（夹具路由计数）。
- Windows 真实 Grok `0.1.26` 上游查询通过。
- Linux x64 CLI/Web `0.2.1-rc.3`/`rc.4`：官方 Grok `0.1.26` 二进制 MCP initialize、tools/list、查询、stdio EOF 退出、显式停止后真实官方 provider 的 canonical 派发计数、配置重载过渡无官方回退，以及 PluginManager 停用/重启/重新启用/移除生命周期通过。Web 设置页浏览器 DOM 未验证；HTTP 上游、模型和 fetch 为本地 stub，不等于真实付费上游验收。
- 白名单打包、复打包哈希一致、依赖审计和敏感信息扫描通过。

### 已知限制

- Windows x64 Desktop 与 Linux x64 CLI/Web 目标矩阵已通过隔离宿主门禁；macOS Apple Silicon Desktop 尚未运行门禁。不承诺 macOS Intel Desktop 或官方 Linux Desktop。
- 不支持源码 live HMR，停用、升级或移除后需要完整重启 DSH。
- 停止接管后没有「恢复接管」按钮。
- 卸载不清理 profile 内的 `control-intent.records`。
- 跨资源提交崩溃、完整在途事务和官方联网 fetch 未覆盖。
- 宿主没有 release 专属完成事件，释放按复合证据判定。

完整的安装、配置、失败行为和限制见 [README](./README.md)。

# 更新记录

本项目沿用语义化版本。公开 Beta 仍可能有安装、兼容和行为调整。

## 0.1.0-beta.1 - 待发布

首个公开版本采用完整可视化配置体验；早期手工配置候选不公开发布。
当前仍在最终同包门禁与维护者审核阶段。

### 新体验

- 一个裸包名聚合插件，自动注册程序管理、搜索、接管、设置、核验和恢复；
  不需要手填 patch、程序路径或配置路径。
- 已有 Grok 和共享配置自动复用；缺失才下载已验证最新平台程序到 profile
  私有缓存，不升级全局程序或创建第二份 Grok 凭据文件。
- 完整动态路由页：官方 logo、Harness/网关横排、来源纵排、六个配置弹窗、
  Hub、浅深主题、16px 状态条、拖放和键盘排序。
- 共享 TOML 安全读取/CAS 最小保存、显式 Key 查看/复制、清除确认及历史恢复；
  保存前历史可能含凭据，README 说明保护和卸载不自动清理。
- Grok 主搜可关闭；仅补充模式和 Grok 失败时按共享来源顺序返回真实结果，
  全部失败明确报错，不回退 DeepSeek 官方搜索。
- 全量已开启来源/全部 Tavily Key 可取消连通性诊断，GitHub 独立检测。
  失败保留准确短码、轻颤红边和简短提示，不伪造内部实时遥测。
- 受管 MCP 串行复用、身份变化有序重建、空闲五分钟退出；主搜和回退共用
  1 active/8 queued、总截止与共享 `response_max_chars`。
- 原生 PluginManager 热停用即时恢复，再启用即时接管；整包停用时配置页离场。
  无 HMR 的宿主如实提示需要重启，取消永久 released/删记录恢复的旧用户流程。

### 当前验证边界

2026-10-31，离线全套与生产 UI 浏览器回归通过；同一新体验包已通过 Windows
双版、macOS 双版与 Linux 三版自动化门禁，并补齐三个入口的宿主内自动下载、
默认共享配置保存和无需重启的首用路径。真实来源 Key/费用及人工验收尚未收齐。
本次包内说明更新后，重新打包和复验安装/详情，运行时证据按逐文件哈希复用。
下方历史 d6a0 证据只代表旧候选，不能替代新体验版。
正式发布将使用同一个经验证 tarball，npm `next`/`latest` 与 GitHub Pre-release
指向同一 Beta；未执行公开发布。

| 入口与范围 | 本轮新体验证据 |
|---|---|
| Windows x64 Desktop rc.2/rc.3 | 安装 `10-23-30.409Z-24092` 2/0；产品 `11-14-48.039Z-2228` 12/0；M0-04 `11-21-01.121Z-10488` 8/0；UX `10-05-12.989Z-32508` 6/0；Grok 合成上游 `10-35-52.413Z-38092` 6/0；详情 `11-46-48.174Z-30856` 双版各 36 项；首用 `12-02-35.351Z-33680` 2/0 |
| macOS arm64 Desktop rc.2/rc.3 | 完整 CI [41197248357](https://github.com/Lain-in-coding/dsh-grok-search-ci/actions/runs/41197248357)：安装 2/0、产品 12/0、M0-04 8/0、UX 6/0、Grok 合成上游 6/0、详情各 36 项；补测 CI [41198847555](https://github.com/Lain-in-coding/dsh-grok-search-ci/actions/runs/41198847555)：详情 2/0、首用 `11-58-31.911Z-15345` 2/0 |
| Linux x64 CLI/Web rc.2/rc.3/rc.4（WSL） | 各 177/0；首用/完整 Web 验证 rc.2 `20261031T115831123Z-rc2-7a58f775`、rc.3 `20261031T115615893Z-rc3-e39ba8b0`、rc.4 `20261031T115831195Z-rc4-292308fc` |

缩写 runId 前缀均为 `2026-10-31T`；日志和最初失败按各自 runId 保留，不随包上传。
真实宿主与真实 Grok 程序不等于真实付费供应商：上表自动查询使用合成 Key 和
loopback 上游。Windows 为官方 default_app/原始 ASAR 验证，不冒称 packaged
启动入口通过。恢复仍按复合证据，M0-04 路由计数仍为夹具，宿主专属回执不存在。

## 历史内部候选 d6a0 - 2026-10-29（未发布；已被新体验替代）

当时的内部 Beta 候选。以下功能和限制保留为历史，不适用于当前新体验。

### 新增

- 原生 `grok-search` Web 搜索 provider，通过 stdio MCP 调用外部 `grok-search-rs`。
- 单包五个组件：搜索核心、接管控制、设置页、路由核验和启动恢复。
- 设置页「Grok 搜索接管」卡片，以及 owner 存活时的「停止接管并恢复原搜索」。
- 版本化控制记录、本地文件系统协作式 CAS、显式迁移和失败关闭。
- 释放事务：同步 invalidation、有界 drain、release CAS、路由恢复和独立验证。
- 基于 DSH canonical Session 事件类型的原始官方搜索派发计数。
- 上一进程未完成释放时的跨进程启动补完。
- 查询容量、总预算、结果字符数、单条 MCP 消息大小和进程回收边界。
- Windows x64 Desktop、macOS Apple Silicon Desktop、Linux x64 CLI/Web 共用同一个插件包的安装路径。
- 面向用户的完整中文 README、FAQ、错误码、数据边界和 30 秒验收步骤。

### 变更

- 早期内部候选的 `dsh-grok-search-recovery` 并入 `dsh-grok-search`，公开 Beta 只发布一个插件。
- 依赖固定为 `@modelcontextprotocol/client@2.4.0`，修复已知 npm 审计问题。
- 包内 README 按用户安装路径重写，开发与验证细节移入独立文档。

### 验证

以下结果都针对同一个 tarball：`dsh-grok-search-0.1.0-beta.1.tgz`，SHA-256 `d6a0e8a108b96a7e85fabefa84d493d651f1c9c1de2c10a86c1240effa9dfeec`。

- Windows x64 Desktop `0.2.1-rc.2`/`rc.3`：
  - 干净安装 `2026-10-29T10-46-21.436Z-4216`，2/0；
  - PluginManager 安装、启用、停用、移除、重启和真实设置页停止接管（含界面 DOM）`2026-10-29T10-47-36.355Z-37792`，2/0；
  - 产品 Desktop（官方 provider 派发计数、配置重载过渡无官方回退、释放事务）`2026-10-29T10-51-23.657Z-37184`，12/0；
  - 多 Session、preset、PTC、重连和预算矩阵 `2026-10-29T11-01-24.146Z-30368`，8/0，路由计数为夹具；
  - 真实 Grok `0.1.26` 上游查询 `2026-10-28T12-20-06.168Z-237772`，4/0（每版一次真实查询）。这次运行用的是上一个候选包，和本包只差 `README.md` 与 `support-matrix.json`，其余 20 个文件逐字节相同。
- macOS Apple Silicon Desktop `0.2.1-rc.2`/`rc.3`，公开 CI [40859735044](https://github.com/Lain-in-coding/dsh-grok-search-ci/actions/runs/40859735044)（GitHub 托管 macOS 15 arm64 runner）：
  - 干净安装 `2026-10-29T10-58-09.803Z-17308`，2/0；
  - 产品 Desktop `2026-10-29T10-58-20.902Z-17523`，12/0；
  - 多 Session 矩阵 `2026-10-29T11-01-52.616Z-22223`，8/0，路由计数为夹具；
  - Grok `0.1.26` Darwin 程序对本机模拟上游的 MCP 查询 `2026-10-29T11-03-33.001Z-24650`，4/0，只用合成 Key；
  - PluginManager 与真实设置页停止接管（含界面 DOM）`2026-10-29T11-03-48.646Z-24916`，2/0。
- Linux x64 CLI/Web（WSL Ubuntu 22.04）`0.2.1-rc.2` `20261029T103154354Z-rc2-02a31428`、`rc.3` `20261029T103405266Z-rc3-16bd5f2c`、`rc.4` `20261029T103914454Z-rc4-01632517`，各 133/133：隔离安装与逐文件核对、搜索/fetch/聊天、官方 Grok `0.1.26` Linux 程序对本机模拟上游的 MCP 查询、配置重载过渡无官方回退、Web 设置页停止接管、PluginManager 停用/重启/重新启用/移除、官方 provider 派发计数与进程回收。
- 离线测试 `npm run test:all` 通过（Windows 上有 1 个 POSIX 符号链接用例按设计跳过）；白名单打包与复打包哈希一致；生产依赖审计 0 项；tarball 敏感信息扫描 0 命中。
- 宿主没有 release 专属完成事件。释放按复合证据判定，不冒充宿主回执。

### 已知限制

- 只承诺 README「支持范围」表里列出的系统、入口和 DSH 版本组合。不支持 macOS Intel、Windows ARM、官方 Linux Desktop、Windows/macOS 上的 CLI/Web 和 DSH alpha 版本。
- DSH 升级到插件版本范围以外后，DSH 启动时会跳过本插件，搜索按原设置回到 DSH 自带搜索，界面可能没有提示。
- 不支持源码 live HMR，停用、升级或移除后需要完整重启 DSH。
- 停止接管后没有「恢复接管」按钮。
- 卸载不清理 profile 内的 `control-intent.records`。
- 跨资源提交崩溃、完整在途事务、官方联网 fetch，以及 macOS/Linux 上的真实付费上游未覆盖。
- 宿主没有 release 专属完成事件，释放按复合证据判定。

完整的安装、配置、失败行为和限制见 [README](./README.md)。

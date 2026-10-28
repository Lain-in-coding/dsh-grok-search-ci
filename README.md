<div align="center">

# dsh-grok-search

**用你自己的 Grok 接管 DeepSeek Harness 的内置网页搜索。**

[![npm next](https://img.shields.io/npm/v/dsh-grok-search/next?logo=npm&label=npm%20next)](https://www.npmjs.com/package/dsh-grok-search/v/0.1.0-beta.1)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Lain-in-coding/dsh-grok-search/blob/main/LICENSE)
[![DSH 0.2.x](https://img.shields.io/badge/DSH-0.2.x-4F46E5)](https://github.com/deepseek-ai/deepseek-harness)
[![Windows · macOS · Linux](https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-0078D4)](https://github.com/Lain-in-coding/dsh-grok-search#支持范围)

</div>

DeepSeek Harness（DSH）的插件。启用后，模型仍然调用官方 `web_search`，实际查询交给你自己准备并配置的 [grok-search-rs](https://github.com/Episkey-G/GrokSearch-rs)（Grok）；原本的 `fetchProvider`、已有依赖和普通聊天保持不变。

这是 `0.1.0-beta.1` 公开 Beta，不是稳定版。整个插件只有一个包 `dsh-grok-search`，搜索、接管、设置、路由核验与恢复都在同一个 bundle 内。

> 搜索失败会明确报错，**不会自动切回 DSH 官方搜索**。这样你不会在不知情时产生另一种调用或费用。

## 为什么用它

| | DSH 内置 `deepseek-official` | 本插件 |
|---|---|---|
| 搜索来源 | DSH 自带的 DeepSeek 搜索通道 | 你安装并配置的 Grok `0.1.26` |
| 需要的凭据 | DeepSeek 官方搜索所需凭据 | 你自己的 xAI API Key 或 Grok OAuth 配置 |
| 搜索失败时 | 由官方通道返回错误 | 明确报错，保留原 `fetchProvider`，不回退官方搜索 |
| 普通聊天 | 正常 | 正常 |
| 网页抓取 | 使用原来的 `fetchProvider` | 继续使用原来的 `fetchProvider` |
| 数据落点 | 按 DSH 官方策略 | 插件自身不联网；Grok 读取你的配置并连接其上游 |
| 插件写入 | 不新增插件控制记录 | 只在所用 profile 写入自己的 `control-intent.records` |

它适合：

- 已经在用 Grok，希望 DSH 的网页搜索也走自己的 Grok 和额度。
- 需要明确知道搜索什么时候失败，不想悄悄回退到另一个搜索来源。
- 想保留现有网页抓取和普通聊天，只替换搜索这一条链。

它不适合：

- 不想安装、配置 Grok 的用户。
- 正在使用不受支持的 DSH 版本、macOS Intel Desktop 或官方尚未提供的 Linux Desktop。
- 希望插件自动申请 Key、自动安装 Grok 或修改共享 Grok 配置的用户。

## 快速开始

1. **准备 Grok `0.1.26`**：按当前系统安装程序，配置凭据，并确认所用的 `grok-search-rs --version` 输出 `0.1.26`。
2. **安装插件**：Desktop 用「插件」→「添加插件」；Linux CLI/Web 用 `dsh plugin --profile web add`。安装 `dsh-grok-search@0.1.0-beta.1`。
3. **填写程序路径**：在 Desktop 的 `desktop` profile，或 CLI/Web 使用的 profile 的 `cordis.patch.yml` 中，为 `grok-search-core` 写入 Grok 原生程序的绝对路径；`configPath` 可以按需填写。
4. **完整重启 DSH**：退出整个 DSH，再重新启动；只关窗口不算完整重启。

启动后，设置页里的「Grok 搜索接管」应显示「正在接管」。然后新建对话发起一次联网搜索，并确认普通网页抓取和聊天仍然正常。

更细的步骤、截图和验收方法见下方[安装与配置](#安装与配置)。

## 支持范围

| 项目 | Beta 支持范围 |
|---|---|
| 操作系统与入口 | Windows x64 Desktop（已验证）；macOS Apple Silicon Desktop（门禁待完成）；Linux x64 CLI/Web（隔离生命周期已验证，浏览器 DOM 未验证） |
| DSH 版本 | 各入口分别维护最新可用版本和一个前一已验证基线；以 [support-matrix.json](./support-matrix.json) 为准 |
| Grok | `grok-search-rs` `0.1.26` |
| 安装来源 | npm `next` 标签或 GitHub Pre-release 的同一个 `.tgz` |
| Profile | Desktop 默认使用 `desktop`；CLI/Web 使用你指定的 profile |

每个平台入口都使用同一个插件 tarball，但必须分别通过自己的宿主和版本门禁。完整目标与当前验证状态见 [support-matrix.json](./support-matrix.json)。不承诺 macOS Intel Desktop，也不承诺官方尚未提供的 Linux Desktop。

包的 `engines.dsh` 是这些入口版本的并集，不代表所有系统都支持其中每个版本；例如 `rc.4` 只列入 Linux CLI/Web 目标，不能由此推断 Desktop `rc.4` 已通过。

## 安装与配置

### 1. 准备 Grok `0.1.26`

插件只启动你已有的外部程序，不会下载或安装 Grok。先确认 DSH 入口和系统属于上面的支持范围，再按系统选择安装方式。

**方式 A：npm 全局安装**

```powershell
npm install -g grok-search-rs@0.1.26
$grokRoot = Join-Path (npm root -g) 'grok-search-rs'
$grokExe = Get-ChildItem -LiteralPath $grokRoot -Recurse -File |
  Where-Object { $_.Name -in @('grok-search-rs.exe', 'grok-search-rs') } |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $grokExe) { throw '未找到当前平台的 grok-search-rs 程序。' }
& $grokExe --version
```

最后一行应输出 `grok-search-rs 0.1.26`。记下 `$grokExe` 的完整路径。

macOS 或 Linux 使用同样的 npm 包；也可以直接下载上游 Release 对应的 `Darwin_universal`、`Linux_x86_64` 或其他与你的系统和架构匹配的资产。

**方式 B：使用上游 Release 资产**

从 [GrokSearch-rs Releases](https://github.com/Episkey-G/GrokSearch-rs/releases) 下载 `v0.1.26` 中与你的平台和架构匹配的资产以及 `SHA256SUMS`，解压到你自己的目录，并按上游说明核对哈希。Windows 示例：

```powershell
$grokExe = '<你解压出的目录>\grok-search-rs.exe'
& $grokExe --version
```

macOS/Linux 的路径示例：

```text
/Users/<你的用户名>/tools/grok-search-rs
/home/<你的用户名>/tools/grok-search-rs
```

输出应为 `grok-search-rs 0.1.26`。不要从第三方网盘或来源不明的镜像下载。

插件要求传入原生程序的绝对路径，不依赖 `PATH`，也不需要专用启动器。

### 2. 准备 Grok 配置和凭据

如果还没有配置文件，让上游程序生成模板；如果已经有配置，直接使用现有文件，不要重复初始化：

```powershell
& $grokExe --init
$grokConfig = Join-Path $env:USERPROFILE '.config\grok-search-rs\config.toml'
```

Windows 默认配置文件是 `%USERPROFILE%\.config\grok-search-rs\config.toml`；macOS/Linux 默认配置文件是 `$HOME/.config/grok-search-rs/config.toml`。也可以给 Grok 指定另一个配置路径，再把同一个绝对路径填给插件。

推荐 API Key 模式，最小配置如下：

```toml
grok_api_key = "<你的 xAI API Key>"
grok_model = "grok-4-1-fast-reasoning"
web_search_enabled = true

# 可选：额外来源和普通网页抓取。
# tavily_api_key = "<你的 Tavily API Key>"
# firecrawl_api_key = "<你的 Firecrawl API Key>"
```

注意事项：

- Grok 对配置做严格解析，一个未知字段就可能让整个文件失效。以 `--init` 生成的模板和上游文档为准。
- 上游也支持 OAuth。**上游文档提示 OAuth 模式可能违反 xAI 的服务条款**，是否使用由你自行判断和承担。API Key 模式是本文推荐方式。
- 插件不读取 Grok 配置文件的内容，也不会上传任何 Key；白名单内的上游环境变量（例如 `TAVILY_API_KEY`）会原样传给 Grok 子进程。不要把配置内容、Token 或设备路径贴到公开 Issue。
- 本插件不修改共享的 Grok 配置。请使用你明确授权给 DSH 的配置；需要隔离时，创建单独配置并在插件里指向它。
- `doctor` 是 Grok 的 MCP 工具，不是命令行子命令。需要时把 `grok-search-rs` 接入支持 MCP 的客户端再调用它；查询诊断显示的后备来源状态不等于主后端健康。

### 3. 在 DSH 中安装插件

打开 DSH 左侧「插件」，点右上角「添加插件」，输入下面的包名并安装：

```text
dsh-grok-search@0.1.0-beta.1
```

也可以从 GitHub Pre-release 下载 `.tgz`，然后在「添加插件」中粘贴该文件的绝对路径。安装对话框是文本输入，没有本地文件选择器。npm 与 GitHub Release 提供的是同一个 tarball。安装后先不要重启，继续完成下一步的路径配置，最后一次完整重启即可。

Linux CLI/Web 用户在要使用的 Web profile 中安装（需要 Node.js 22+ 和上述已验证的 DSH CLI 版本）：

```bash
dsh plugin --profile web add dsh-grok-search@0.1.0-beta.1
```

若使用 GitHub 的 `.tgz`，把命令末尾的包名换成该文件的绝对路径。先完成下一步配置，再运行 `dsh web`；无桌面环境时使用 `dsh web --no-open`，访问终端显示的本机授权链接（不要公开该链接）。不需要把 Web 服务暴露到外网。

默认配置文件为 `$HOME/.dsh/profiles/web/cordis.patch.yml`；显式设置 `DSH_HOME` 时改用 `$DSH_HOME/profiles/web/cordis.patch.yml`。CLI/Web profile 独立于 Desktop，不会自动沿用桌面插件配置。

![在 DSH PluginManager 中查看 dsh-grok-search](https://raw.githubusercontent.com/Lain-in-coding/dsh-grok-search/main/docs/images/plugin-detail.png)

包内包含五个组件，但用户只需要安装、启停和卸载一个插件 `dsh-grok-search`：

| 组件 | 作用 |
|---|---|
| `grok-search-core` | 把 `web_search` 查询交给外部 Grok |
| `grok-search-control` | 接管、停止与恢复路由 |
| `grok-search-settings-ui` | 设置页「Grok 搜索接管」 |
| `grok-search-route-verifier` | 核验路由与原始官方搜索计数 |
| `grok-search-recovery` | 补完上一次未完成的释放 |

早期内部候选曾有一个独立包 `dsh-grok-search-recovery`。它已经并入本包。如果你的 PluginManager 里仍留着这个旧包，请先停用、移除并完整重启 DSH，再安装本包。公开 Beta 不需要、也不会提供第二个插件。

### 4. 配置 Grok 程序路径

DSH Desktop 的 profile 由应用管理，`dsh plugin` 命令会提示 `managed exclusively by the Electron application`，因此请直接编辑**所用 profile** 的用户配置层。CLI/Web 使用你启动命令指定的 profile。

Windows Desktop 默认 profile 是 `%USERPROFILE%\.dsh\profiles\desktop`，macOS Desktop 默认是 `$HOME/.dsh/profiles/desktop`；Linux CLI/Web 默认是 `$HOME/.dsh/profiles/web`。指定 `DSH_HOME` 时以该目录为准。

```text
%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml
```

如果你明确使用另一个 profile，请替换成该 profile 的实际路径。把下面的条目加入 `cordis.patch.yml`，并把 `executable` 换成上一步得到的绝对路径：

```yaml
- id: grok-search-core
  config:
    executable: 'C:/Users/<你的用户名>/.../grok-search-rs.exe'
    configPath: 'C:/Users/<你的用户名>/.config/grok-search-rs/config.toml'
    budgetMs: 120000
```

macOS 使用 POSIX 路径，例如（Linux 把 `/Users/<你的用户名>` 换为实际 `/home/<你的用户名>`）：

```yaml
- id: grok-search-core
  config:
    executable: '/Users/<你的用户名>/tools/grok-search-rs'
    configPath: '/Users/<你的用户名>/.config/grok-search-rs/config.toml'
    budgetMs: 120000
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `executable` | 是 | 已有 Grok 原生程序的绝对路径 |
| `configPath` | 建议 | 已有 Grok 配置文件的绝对路径；留空时由 Grok 按自身规则读取 |
| `executableArgs` | 否 | 传给 Grok 的启动参数，不要放密钥 |
| `budgetMs` | 否 | 单次查询总预算，范围 30000 到 120000 毫秒，默认 120000 |

路径使用正斜杠可以避免 YAML 转义问题。不要在这里写 Key，也不要指向共享给其他程序的正式配置文件，除非你确认允许 DSH 使用。

修改后必须完整退出 DSH 并重启。重启后再次打开插件详情，确认 `dsh-grok-search` 已启用且没有加载错误。

`executable` 是必填路径；使用 Grok 默认配置时可以留空 `configPath`，如果显式填写则必须是绝对路径。如果 `executable` 未填写、不是绝对路径或文件不存在，插件仍会加载，但 `grok-search` provider 不会进入可用状态。DSH 会按自己的选择规则明确报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`，插件不会因此自动改用官方搜索。

如果 profile 的 `cordis.patch.yml` 只有 `[]`，请用上面的条目替换它；如果里面已经有相同 `id`，更新原条目，不要增加重复条目。已有其他 `- id:` 条目时，把这个新条目追加到列表末尾。

### 5. 完整重启并验收

先退出整个 DSH（包括托盘进程），再重新启动。然后点击侧栏底部的「设置」→「内置插件」→「Grok 搜索」，确认设置卡片：

![Grok 搜索接管设置卡片](https://raw.githubusercontent.com/Lain-in-coding/dsh-grok-search/main/docs/images/settings-card.png)

状态应为「正在接管」。「正在接管」只说明路由已经交给插件，不代表 Grok 程序和凭据一定可用；请继续按下面的「30 秒验收」实际搜索一次。

### 30 秒验收

1. 打开设置页，确认「当前状态」为「正在接管」。
2. 新建普通对话，发起一次需要联网搜索的问题，确认回答包含 Grok 返回的来源。
3. 发起一次普通网页抓取，确认原来的 `fetchProvider` 仍可用。
4. 发送一条不需要搜索的普通消息，确认聊天仍正常。
5. 完整重启 DSH，再重复第 1 步和第 2 步，确认接管状态与搜索都保持。

如果第 1 步已经失败，请先看下面的排查表，不要反复重装。重装不能替代配置修复。

## 停止、停用与卸载

### 停止接管

设置页「Grok 搜索接管」中点击「停止接管并恢复原搜索」。owner 存活时这是明确退出，会即时生效：

- 插件立即停止接受新的 Grok 查询，并取消正在执行的 Grok 查询。
- 在短暂的回收期限内等待这些查询结束；回收成功后再恢复原来的搜索设置。
- 核验原搜索路由、`fetchProvider` 和已有依赖。
- 记录释放完成与路由验证结果。

如果回收或 drain 失败，这次停止会明确报错，不会提交释放完成，也不会恢复原搜索路由；设置页会保持「释放未完成」。此时请保留错误码并完整重启 DSH。

停止状态会被记住。之后重启、停用再启用都不会自动重新接管。Beta 没有「恢复接管」按钮；需要重新接管时，先完整退出 DSH，删除所用 profile 下的 `control-intent.records` 文件夹，再启动 DSH。只删除这一个插件记录目录，不要删除 profile 里的其他内容。

### 停用插件

在 PluginManager 中停用 `dsh-grok-search`，然后**完整重启 DSH**。五个组件一起离场，DSH 按自身配置使用原来的搜索设置。

- 停用前没有点「停止接管」：重新启用后，插件按当前搜索选择重新接管。
- 停用前已经点「停止接管」：记录保持 released，重新启用后仍然不接管。

普通关闭窗口、插件 dispose、重启和依赖失效都不等于用户明确退出，也不会伪造释放完成。

### 卸载

建议先在设置页停止接管，再在 PluginManager 中停用、移除，并完整重启。卸载不会删除 profile 中的 `control-intent.records`；它不影响 DSH 的搜索或其他功能。完全退出 DSH 后可以手动删除，也可以保留。

## 搜索失败时会发生什么

搜索链路的错误会直接返回给模型和用户，保留错误码。插件不会把上游故障伪装成「没有结果」，也不会自动回退 `deepseek-official`。

- 普通聊天继续可用。
- 原来的 `fetchProvider` 继续可用。
- 其他插件的既有依赖不会被改写。
- 只有当你明确点击「停止接管」或在 PluginManager 停用并完整重启后，搜索才回到原来的设置。

常见错误码：

| 错误码 | 含义 | 先检查什么 |
|---|---|---|
| `GROK_SEARCH_FAILED` | 未分类的搜索失败 | 下方排查表，从程序路径和配置开始 |
| `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | DSH 已选择 `grok-search`，但插件认为 Grok 当前不可用 | `executable` 是否为存在的原生程序绝对路径；是否正在停止接管 |
| `GROK_PROGRAM_MISSING` | 直接调用 provider 时发现 Grok 程序路径无效；正常 DSH 搜索通常先由宿主报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | 重新确认 `executable` 是否仍存在，并完整重启 DSH |
| `GROK_PROCESS_ERROR` | 启动 Grok 进程失败 | 路径是否指向原生程序，而不是 `.cmd`、`.ps1` 或 npm shim；当前用户是否有执行权限 |
| `GROK_CONFIG_INVALID` | 插件配置无效，例如 `configPath` 不是绝对路径 | `configPath` 必须为空或绝对路径；配置内容本身的问题通常由 Grok 报出 |
| `GROK_MCP_ERROR` | 与 Grok 的 MCP 会话失败 | Grok 版本是否为 `0.1.26`，能否单独运行 |
| `GROK_CHILD_EXIT` | Grok 在查询结束前退出 | 上游配置、凭据和程序日志 |
| `GROK_TOOL_ERROR` | Grok 工具返回错误，常见于 Key、额度或上游服务问题 | 用 Grok 的 MCP 客户端调用 `doctor`，检查 Key、额度和网络 |
| `GROK_PROTOCOL_ERROR` / `GROK_INVALID_RESULT` | 配置的程序不是兼容的 stdio MCP 服务，或返回的消息、工具结果结构无效 | 确认 `executable` 指向原生 `grok-search-rs` `0.1.26` |
| `GROK_STDOUT_LIMIT` | Grok 单条 MCP 消息超过 1 MiB | 缩小查询范围或确认上游版本 |
| `GROK_TIMEOUT` | 插件自身预算到期，返回 `GROK_TIMEOUT` | 缩短查询或检查上游网络 |
| `TOOL_TIMEOUT` | DSH `web_search` 工具自身的超时策略到期 | DSH 内置 preset 默认 60 秒；插件预算大于 60000 也不会延长这个宿主上限 |
| `GROK_QUEUE_FULL` | 同时运行的查询太多 | 等待已有查询结束再试 |
| `GROK_SEARCH_STOPPING` | 插件正在停止，新查询被拒绝 | 等停止完成后重新搜索 |
| `GROK_PROCESS_REAP_FAILED` | 已取消的 Grok 进程未能及时回收 | 插件会暂停新查询；重启 DSH 并保留错误信息 |
| `CONTROL_ROUTE_UPDATE_TIMEOUT` | 路由更新超时 | 重启 DSH，检查 `control-intent.records` 是否有冲突 |
| `CONTROL_RELEASE_ROUTE_UNVERIFIED` | 释放后路由核验未通过 | 不要删除记录；保留错误信息，完整重启后查看设置页 |
| `CONTROL_SEARCH_SELECTION_CONFLICT` | 接管期间你在别处改了搜索设置 | 插件不覆盖你的新设置；需要重新接管时按「停止接管」一节处理 |

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 设置页显示「正在接管」，但搜索失败并报 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` | 「正在接管」只表示路由已接管；`executable` 未填、填错或文件不存在时 Grok 仍不可用 | 核对 `executable` 是否为存在的原生程序绝对路径；单独运行 `grok-search-rs --version`，再完整重启 DSH |
| 设置页显示「接管冲突」 | 接管期间你在别处改了搜索设置 | 插件不覆盖你的新设置；回到 DSH 原网页搜索设置确认选择 |
| 设置页显示「控制组件不可用」或「接管未完成」 | 控制组件没有加载，或接管/释放流程没有完成 | 保留错误码，完整重启 DSH；持续失败时提交 Issue |
| 搜索返回 `GROK_PROCESS_ERROR` | 程序路径在加载后失效，或路径不是可执行文件 | 使用原生 `grok-search-rs` 程序的绝对路径，不要用 `.cmd`、`.ps1` 或 npm shim |
| 搜索返回 `GROK_CONFIG_INVALID` | `configPath` 不是绝对路径 | 把 `configPath` 留空或改成绝对路径 |
| 搜索返回 `GROK_TOOL_ERROR`，或项目里说 Key 无效、额度不足 | Grok 自己的上游或凭据问题 | 用 Grok 的 MCP 客户端调用 `doctor`，检查 Key、额度和网络 |
| 搜索返回 `GROK_CHILD_EXIT` 或 `GROK_MCP_ERROR` | 凭据、网络或上游程序问题 | 用 Grok 的 MCP 客户端调用 `doctor` 和最小查询复现；再重试 DSH |
| 插入配置后没有生效 | 没有完整重启 DSH | 退出所有 DSH 进程后重新启动 |
| `dsh plugin` 报 `managed exclusively by the Electron application` | Desktop profile 由 Electron 应用独管 | 直接编辑该 profile 的 `cordis.patch.yml`，不要在桌面 profile 上使用 CLI 插件命令 |
| PluginManager 里出现两个插件 | 早期内部候选遗留了 `dsh-grok-search-recovery` | 停用并移除旧包，完整重启后只保留 `dsh-grok-search` |
| 停止后想重新接管却找不到按钮 | Beta 没有恢复按钮 | 完整退出 DSH，删除 profile 下的 `control-intent.records`，再启动 |
| 升级 DSH 后插件无法加载 | 新版本尚未验证 | 按 [support-matrix.json](./support-matrix.json) 检查对应入口的已验证版本；不要把其他平台的结果平移过来 |
| 卸载后仍看到控制记录 | 卸载有意不清理 profile 记录 | 完全退出 DSH 后可手动删除 `control-intent.records` |

更多实现细节和验证方法见[开发与验证](https://github.com/Lain-in-coding/dsh-grok-search/blob/main/docs/开发与验证.md)。

## 工作原理与数据边界

插件复用 DSH 公开的插件、Web 搜索和设置页接缝，不修改宿主或 ASAR，不使用永久 selector、产品专用启动器或全局 monkey-patch。

- 模型仍调用官方 `web_search`，插件把它转成对 Grok MCP 程序的查询。
- 插件自身不发起搜索网络请求。联网由你提供的外部 Grok 完成。
- 插件启动的唯一子进程是你配置的 Grok 程序，使用 `shell: false`，只继承系统、代理和已知上游变量。
- 插件不读取或上传 Grok 配置中的凭据；Grok 自己读取你指定的配置。
- 不保存 Grok 的 stderr 原文，避免把上游输出里的敏感信息写进日志。
- 插件只在所用 profile 写入自己的 `control-intent.records`，不改 profile 的其他配置、共享 Grok 配置、凭据或全局程序。
- 原始搜索计数只读取 DSH Session 的事件类型，不保留事件正文。它统计的是官方 `deepseek-official` provider 的**派发尝试**，不是网络成功，也不是宿主级 release 完成回执。
- 每个查询最多返回 45000 个序列化字符，单条 MCP 消息最多 1 MiB；最多 4 个查询同时运行，8 个排队。

## 已知限制

- Windows x64 Desktop 目标矩阵已通过；Linux x64 CLI/Web 已通过安装、查询、配置重载无回退、设置停止 RPC、PluginManager 停用/重启/重新启用/移除、canonical 派发计数与进程退出。Web 设置页的浏览器 DOM 仍未验证。macOS Apple Silicon Desktop 尚未在真机或 ARM runner 上运行，本候选仍未达到全部平台发布门槛。
- 支持入口为 Windows x64 Desktop、macOS Apple Silicon Desktop、Linux x64 CLI/Web；不承诺 macOS Intel Desktop 或官方 Linux Desktop。
- 各入口版本按 [support-matrix.json](./support-matrix.json) 的滚动矩阵单独验证，Grok 基线为 `0.1.26`。
- 插件不自动安装 Grok，不申请 Key，不修改正式 profile、共享配置或凭据。
- 不支持源码 live HMR。代码升级、停用、移除后都需要完整重启 DSH。
- 跨资源提交崩溃、完整在途事务和官方联网 `fetch` 验收未覆盖。
- 停止接管后没有「恢复接管」按钮，需要按上文删除记录后重启。
- 卸载不清理 `control-intent.records`。
- 宿主没有 release 专属完成事件。释放按「意图提交 + 路由恢复验证 + 相对原始搜索计数增量 + 完成 revision」的复合证据判定，不冒充宿主专属回执。
- 本项目不是 DSH 官方插件，也不代表 DeepSeek 或 xAI。

## 本版验证了什么

截至 2026-10-28，Windows x64 Desktop `0.2.1-rc.2`/`rc.3` 的隔离门禁，以及 Linux x64 CLI/Web `0.2.1-rc.3`/`rc.4` 的安装、查询和显式停止门禁已通过。macOS Apple Silicon 尚未运行宿主门禁，不能将当前包称为三平台验收完成。

- 所有已运行门禁均使用同一个候选 tarball；平台和入口的状态以 [support-matrix.json](./support-matrix.json) 为准。
- Windows Desktop：搜索、网页抓取、普通聊天、完整重启和配置重载，owner 存活时真实设置页点击「停止接管并恢复原搜索」。
- Windows Desktop：停用后五个组件离场、记录不被改写、PluginManager 操作和重启清理、真实 Grok `0.1.26` 查询及 canonical 原始官方搜索派发计数。
- Windows Desktop M0-04：多 Session、preset、PTC、配置重载、重启重连和预算矩阵；其中路由计数使用夹具。
- Linux CLI/Web：真实 Grok `0.1.26` Linux x64 二进制 MCP 握手、搜索接管/停止恢复、配置重载过渡无官方回退、PluginManager 停用与移除生命周期；官方 provider 请求由本机 loopback stub 接收。
- 白名单打包、复打包哈希一致、依赖审计与敏感信息扫描。

仍属于夹具、或未接线、或未覆盖的项，都在[开发与验证](https://github.com/Lain-in-coding/dsh-grok-search/blob/main/docs/开发与验证.md)里逐项列出。宿主没有 release 专属完成回执；释放使用复合证据判定，不冒充宿主专属回执。本版不等于稳定版，也不等于完整 B2/M0 通过。

## 反馈

请在 [GitHub Issues](https://github.com/Lain-in-coding/dsh-grok-search/issues) 反馈，并附上：

- DSH Desktop/runtime 版本与 Grok 版本。
- 设置页显示的原始错误码和错误文本。
- 可复现的最短步骤。
- 插件版本 `0.1.0-beta.1`。

请先对日志中的用户名、设备路径和内部地址脱敏。**永远不要上传 API Key、OAuth Token、完整 `config.toml` 或带凭据的截图。**

## 开发

实现结构、控制记录与 CAS 边界、释放事务、验证命令、证据范围和发布流程见[开发与验证](https://github.com/Lain-in-coding/dsh-grok-search/blob/main/docs/开发与验证.md)。版本历史见 [CHANGELOG](https://github.com/Lain-in-coding/dsh-grok-search/blob/main/CHANGELOG.md)。

## 许可证

[MIT](./LICENSE)

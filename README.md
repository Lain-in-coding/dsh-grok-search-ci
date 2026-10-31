<div align="center">

# dsh-grok-search

**把 DeepSeek Harness 的 `web_search` 交给 Grok，并在同一页管理补充来源。**

[![npm next](https://img.shields.io/npm/v/dsh-grok-search/next?logo=npm&label=npm%20next)](https://www.npmjs.com/package/dsh-grok-search)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.1%20rc.2%20%7C%20rc.3%20%7C%20rc.4-4F46E5)](./support-matrix.json)

</div>

`dsh-grok-search` 是一个单一聚合插件。安装后由设置页自动发现本机已有的
`grok-search-rs`；确实找不到时，只在插件自己的 profile 缓存中准备经过校验的
平台程序。你不需要编辑 `cordis.patch.yml`，也不需要填写程序或配置路径。
支持宿主的默认热重载开启时，安装、启用与停用即时生效；关闭热重载的宿主
会明确返回「需要重启」，插件不会替你改宿主配置或自动重启。

当前为待公开发布的 `0.1.0-beta.1` 候选；下面的 npm 安装入口将在正式发布后
生效。尚未发布时，请使用维护者提供的同版本 `.tgz`，不要把 npm 找不到包
误认为安装故障。

## 你会得到什么

- 一个插件、一个安装包：搜索接管、恢复、设置和诊断都在
  `dsh-grok-search` 内，没有需要单独安装的 recovery 插件。
- `DeepSeek Harness → Grok Search RS → Grok / Tavily / Exa / TinyFish /
  Firecrawl` 的动态路由界面；Grok 和每个补充来源都能单独开关。
- Grok 出错时，按你设置的顺序静默尝试可用补充来源；全部不可用才明确报错，
  不会偷偷回到 DeepSeek 官方搜索。
- 配置编辑直接写入同一份 Grok `config.toml`。保留注释和未知字段，并用
  revision/CAS 防止两个窗口互相覆盖。
- 插件开关是唯一的接管开关：关闭后即时恢复官方搜索，重新打开后即时接管。
- 一个 DSH 实例串行复用一个受管 MCP 会话，空闲五分钟后退出；不会每次搜索
  无限累积后台 Grok 进程。

## 支持范围

| 系统与入口 | 首发目标 DSH |
| --- | --- |
| Windows x64 Desktop | `0.2.1-rc.2`、`0.2.1-rc.3` |
| macOS arm64 Desktop | `0.2.1-rc.2`、`0.2.1-rc.3` |
| Linux x64 CLI/Web | `0.2.1-rc.2`、`0.2.1-rc.3`、`0.2.1-rc.4` |

所有组合共用同一个 tarball；DSH 会按 `engines.dsh` 检查宿主版本。表外组合
（例如 Linux Desktop、macOS Intel、Windows ARM）没有发布承诺。Grok 基线为
`grok-search-rs 0.1.26`；插件会优先复用兼容的已有版本，不会升级或覆盖你
全局安装的程序。新体验候选的各组合验收状态见
[支持矩阵](./support-matrix.json)；旧版测试通过不代表新候选已通过。

## 安装与首次使用

1. 打开 DSH「设置」→「插件」→「添加插件」，输入 `dsh-grok-search` 并安装、
   启用。首发后 npm `latest` 与 `next` 指向同一个 Beta，可用裸名安装；
   它不是额外的 stable 版本。使用 Release 安装包时，在添加页面选择/输入
   `.tgz` 的本机绝对路径。CLI/Web 可执行：

   ```shell
   dsh plugin --profile web add dsh-grok-search@0.1.0-beta.1
   ```

2. 在「已安装」列表打开 `dsh-grok-search` 详情。安装启用后会自动发现已有
   Grok；缺失时自动下载并校验当前平台的私有运行包。下载失败显示原因和重试
   入口，不更改全局 npm 源，不安装另一个 DSH 插件。
3. 点击 Grok 行，填 API Key 并「保存更改」。使用官方 xAI 服务时，默认地址
   已填好；使用第三方兼容网关时，在弹窗切换协议，填写该网关地址和 Key。
   已有共享配置自动读取，旧用户无需重填。只用补充来源也可以：关闭 Grok，
   配置并开启至少一个 Tavily、Exa、TinyFish 或 Firecrawl。
4. 点击「测试搜索」，确认额度提示后逐一检查所有已开启来源。每个来源显示成功、
   HTTP 状态码或网络错误；测试不会把一个成功来源误报成全部通过。
   然后在聊天中提出需要联网的问题，DSH 的原 `web_search` 会走本插件。

Key 默认遮蔽；在本机直连或 HTTPS 的设置页面中，可点击眼睛查看、点击复制。
无法确认安全传输的远程 HTTP 连接只显示脱敏状态，不允许明文查看、复制或
提交 Key，但仍可执行服务器端诊断。Key 不写入 profile 的组件配置、错误文本
或日志；共享配置文件和保存前历史备份本身会包含凭据，详见安全边界。

### 为什么还需要 Grok 程序？

`grok-search-rs` 负责实际搜索和网页内容处理，本插件负责把它接到 DSH 的原
`web_search`：自动准备程序、复用配置、可视化设置、主搜/补搜路由、错误诊断、
受管进程和即时恢复。只安装 MCP 并不自动接管 DSH 的原搜索工具。

你不需要再学习另一套安装流程。插件优先发现 PATH、npm 原生平台包和 Cargo
安装中的兼容程序，发现成功就复用；没有才下载到 profile 私有缓存，不改变
其他 Agent 的程序路径。它不会创建第二份 Grok 配置，也不影响其他客户端的
进程。上游 `latest` 必须在本插件已验证版本名单内才允许自动安装；当前基线
为 `0.1.26`。上游出现未经验证的新版本时，会明确拒绝，不盲目安装。

### 配置文件入口

页面底部的「Grok 共享配置」显示实际文件；文件/文件夹图标可打开该宿主的
配置文件或所在位置，不能打开时可复制路径。远程 Web 页面操作的是 DSH
服务器文件，不是浏览器所在电脑；不要把路径当作文件下载链接。

默认位置为用户目录下 `.config/grok-search-rs/config.toml`；
`GROK_SEARCH_CONFIG` 环境变量优先指定其他位置。所有字段以启动环境覆盖文件，
再取上游默认值。被环境覆盖的字段显示来源并只读，插件不改系统环境变量。

**保存会修改 Grok 共享配置，使用同一文件的其他 MCP 客户端也会受到影响。**
没有独立的第二份 DSH Key 配置。来源排序和开关也写这份文件；Grok 主搜索
开关及 GitHub 检测开关只对当前 DSH profile 生效，不删除共享凭据。
外部修改后页面重新读取 revision；同字段或 Key 冲突保留草稿，请点击
「读取最新配置」核对再保存。保存成功表示文件已写入，通常在下一次搜索
生效，不等于 Key 已验证有效或当前在途请求已经切换。

### 路由与补充来源

Grok 是主搜索。Tavily、Exa、TinyFish、Firecrawl 是补充来源，可以拖动或用
`Alt+↑/↓` 调整顺序。页面中的「补充来源数」与「回退来源数」仍表示结果条数，
不是供应商数量；「测试连通性」则会覆盖所有已开启供应商。

GitHub Token 仅用于专用链接抽取（Issue/PR/Release 等），不加入补充来源
搜索顺序，也不会枚举私有仓库。

Grok、Tavily、Exa、TinyFish、Firecrawl、GitHub 各有独立配置弹窗；TinyFish
分别展示搜索和抓取 BaseUrl，Tavily 可添加多个 Key。Hub 弹窗可调整补充条数、
超时、缓存和每查询回复字符上限；插件预算、程序位置和配置位置只读。

未配置是灰色，配置完整会点亮，但点亮不等于连通性通过。状态条的「未检查、
检查中、有效、无结果、失效」分别表示最近真实诊断；失败显示短码与简短提示，
不会一律当作 Key 错误。测试遍历全部开启来源和全部 Tavily Key，普通搜索则
在首个有结果的回退来源收敛。GitHub 只检测 Token/匿名额度，不是第五个搜索源。
原生 Grok 内部没有逐节点遥测时，只展示整体和已知最终路由，不虚构供应商
或具体 Key 的实时成功。

测试和搜索可能消耗供应商额度。原生 Grok 会并行预取补充来源，不能根据
主搜成功、补充条数为零或界面线条推断“没有备用请求”；取消也不能退回已被
上游接受的请求费用。

## 失败与恢复

- Grok 失败且补充来源实际返回结果：显示“已静默回退”，搜索继续返回结果。
- 主搜索和所有补充来源都失败：返回带错误码的明确错误，不回退官方搜索。
- 关闭 Grok：只对 DSH 关闭主搜索，自动使用已开启的补充来源。
- 关闭整个插件：当场停止接管并恢复 DeepSeek 官方搜索；普通 dispose、
  restart 或依赖失效不会被当成用户明确退出。
- 受管程序准备失败、配置解析失败、CAS 冲突和依赖失效均会在设置页显示
  可操作的错误，不会静默换用另一份全局程序或配置。

先看短码再处理：`401/403` 检查 Key/权限，`429` 检查限流或额度，`404`
检查 BaseUrl，`NETWORK/TIMEOUT` 检查网络/代理。`CONFIG_CONFLICT` 先读取最新
配置，`CONFIG_COMMIT_UNCERTAIN` 先回读确认，不能重复点击覆盖；
`CONFIG_BUSY/PREFERENCES_BUSY` 可能是并发保存或上次中断，插件不会抢占锁。
程序下载失败可重试；未经验证版本、缓存损坏、进程未回收则保持明确错误。

关闭整个插件会卸载配置界面，重新启用即可继续编辑和搜索；不需要删除记录。
依赖失效或 DSH 升级到声明范围外时，本包可能无法加载，设置页也可能不存在。
特别是范围外升级，DSH 自身会跳过插件并使用原搜索设置；这不是本插件失败
时的自动回退策略。请安装支持范围内的 DSH/插件组合，不强制放行未知版本。

## 数据与安全边界

- 不修改宿主程序、ASAR、全局程序或其他 Agent 配置。安装/开关由 DSH 原生
  PluginManager 管理；只有用户主动保存时才修改所选 Grok 共享文件。
- 私有下载包位于当前 profile 的运行缓存，下载前校验 npm integrity，解压后
  校验平台白名单和握手能力。
- 共享 `config.toml` 的保存是本地协作式 CAS：提供 revision、历史备份和
  恢复；不承诺网络文件系统锁、非协作写入者最后瞬间的修改或断电目录耐久。
  控制记录另用不可变 revision 与独占硬链接发布，记录提交不等于路由改变。
- 每个 DSH 实例最多一个活动查询、最多八个排队查询；进程回收失败会封锁
  新查询并给出错误，避免泄漏后台进程。
- 本项目不是 DeepSeek 或 xAI 官方产品。请不要在 Issue、截图或日志中上传
  API Key、OAuth Token、完整配置文件或未脱敏的本机路径。

数据位置（均在所用 DSH profile 内，卸载不会自动删除）：

| 位置 | 内容与处理 |
| --- | --- |
| `grok-search/runtime-cache/` | 私有原生程序与校验 receipt，不含用户 Key |
| `grok-search/preferences.json` | DSH 主搜/GitHub 检测开关，不保存 Key |
| `grok-search/config-history/<revision>.toml` | 保存前共享文件的完整历史，**可能含明文 Key/Token** |
| `control-intent.records/` | 接管/释放意图、revision 和路由验证证据 |

历史备份用 POSIX `0600` 创建，但 Windows 的这个 mode 不等于独立 ACL 或加密。
请保护 profile 目录及备份，勿提交到 Git、上传云盘或反馈附件。删除 Key
并不擦除历史中的旧 Key。你可在确认无需撤销后自行处理历史；删历史会失去
对应恢复能力。插件不自动清理、抢占遗留锁或承诺跨资源原子事务。

## 版本与发布

当前候选版本为 `0.1.0-beta.1`。获准首发后 npm `next`/`latest` 与 GitHub
Pre-release 使用同一版本、同一 tarball；Release 附件提供 SHA-256 校验。
Beta 不代表稳定版，DSH 新版本需要先加入支持矩阵后才会得到兼容承诺。
没有承诺支持任意源码 live HMR、跨资源提交崩溃、完整在途事务或未测平台。
宿主没有专属 release 完成事件，恢复按意图、路由验证、计数窗口及内部完成
revision 的复合证据判断，不冒充宿主完成回执。

## 开发

```powershell
npm run check
npm run build:client
npm run test:all
npm run pack:beta
```

需要先按 `package-lock.json` 准备开发依赖。`pack:beta` 是受白名单约束的打包
步骤，不替代构建和测试。自动测试使用隔离 profile 与合成 Key；真实付费
上游仅经维护者授权手动验证。完整证据/历史失败保留在本地 `artifacts/`，
不随 npm 包或公开仓库上传。

## 许可证

[MIT](./LICENSE)

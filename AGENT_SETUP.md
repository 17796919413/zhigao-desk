# 接通知稿全部功能

连接器版本 1.8.1。这是给用户自己的 AI Agent 使用的接入流程；前端原有手动教程仍可使用。用户提供知稿网址并要求接通功能后，执行下述流程。已有配置复用，只补缺项；中断后从检查继续。

## 入口与环境

以用户提供的工作台地址为基础，读取同目录 `setup-manifest.json`。正式地址为 `https://17796919413.github.io/zhigao-desk/`。下载同目录 `zhigao-connector.mjs` 到本机工作目录，文件名保持不变。它是单文件程序，不需要下载整个网站。

需要 Node.js 18+、能执行本机命令的 Agent、支持 MCP stdio 的审稿客户端。先运行 `node --version`。没有 Node.js 时按用户系统的常规安装方式处理；无法执行本机命令时，说明当前客户端不能代配置，并指向网站已有「连接与授权」教程。

示例下载（在 Agent 终端执行，不让用户逐条复制）：

```powershell
Invoke-WebRequest 'https://17796919413.github.io/zhigao-desk/zhigao-connector.mjs' -OutFile './zhigao-connector.mjs'
```

```sh
curl -fL 'https://17796919413.github.io/zhigao-desk/zhigao-connector.mjs' -o ./zhigao-connector.mjs
```

执行前核对来源与用户给定的网站一致。已有同名文件时先保留副本，或下载到新的工作目录。

## 1. 检查并配置当前 AI 客户端

```sh
node ./zhigao-connector.mjs doctor --json
node ./zhigao-connector.mjs setup --client codex --json
```

`--client` 换成正在帮助用户的客户端：`codex`、`claude`、`workbuddy`、`dsh`。不要配置所有检测到的客户端。如果不能确定当前客户端，只问一次；其他支持 MCP 的客户端使用 `manual`，依据返回的 `mcp.command` 和 `mcp.args` 添加名为 `zhigao` 的 stdio 服务。没有对应 CLI 的桌面客户端也用 manual。

setup 只安装或更新知稿连接器、配置指定客户端。相同配置不重复写入，连接器旧文件保留备份，不改其他 MCP 服务。遇到 `CLIENT_CONFIG_REVIEW`，先查看当前客户端中名为 zhigao 的配置；不要直接覆盖无法识别的配置文件。

DeepSeek Harness 返回 `patch_ready` 表示补丁已生成，还需按返回 note 的 `--patch` 参数加载；不等于客户端已连接。manual 返回参数也不等于已完成注册。

按当前客户端支持的方式重新加载 MCP；只有该客户端必须重启时才提示用户。打开返回的 `openUrl`（正式地址带 `?connect=1`）：网页会尝试连接本机，浏览器如出现本地网络权限提示，请用户允许。普通网址的手动连接行为保持不变。

工具可用后调用 `zhigao_setup_status`，再调用 `zhigao_status` 验证当前 Agent 能访问工作台。前一个工具无需网页连接就能检查本机；后一个工具成功才说明网页与当前客户端已接通。如果已注册的工具清单还是旧版，重新加载 MCP；不要重复安装其他客户端。

## 2. 飞书同步

调用 `zhigao_setup_status({"verifyFeishu":true})`，或：

```sh
node ./zhigao-connector.mjs doctor --verify-feishu --json
```

检查结果按下面处理：

- `missing`：缺少飞书 CLI。检查 `npm --version` 后安装 `npm install -g @larksuite/cli`，然后重新检测。遵循当前 Agent 的安装权限要求；不要为安装顺带升级其他全局工具。
- `config`：缺少应用配置。先看 `lark-cli config init --help`。已有公司应用就复用；没有应用时运行交互配置，按用户组织条件完成创建或绑定。需要管理员协助时说明具体缺项，其他渠道继续完成。
- `auth`：需要用户登录。
- `scope`：已登录但缺少权限，补充需要的业务域授权。
- `ready`：用户登录已验证，跳过重新登录。
- `error`：先处理网络或 CLI 执行问题，不把超时当成已授权。

发起登录（范围只覆盖知稿的表格、云空间和知识库功能）：

```sh
lark-cli auth login --domain sheets --domain drive --domain wiki --no-wait --json
```

从返回结果取本次 `verification_url` 和 `device_code`。把授权链接原样交给用户；用 `lark-cli auth qrcode "<verification_url>" --output "./feishu-authorization.png"` 生成并展示二维码。用户完成后，由 Agent 执行：

```sh
lark-cli auth login --device-code <本次device_code>
node ./zhigao-connector.mjs doctor --verify-feishu --json
```

不要在用户尚未看到链接时阻塞等待。过期后重新发起，不沿用旧链接或旧 device code。device code、token 和应用密钥不放进网站、聊天里的配置示例或公开日志；应用密钥按 CLI 的 stdin 方式传入。若后台未开通应用权限，需应用管理员开通；反复登录不能替代管理员配置。

登录就绪不代表有任意表格的编辑权限。用户已经提供具体表格时，用 `lark-cli sheets +workbook-info --url "<表格链接>" --as user --format json` 只读验证；需要额外权限就处理实际返回的 missing scopes。用户尚未提供表格时报告「飞书账号已连接，待关联表格」，不要为了验证而创建测试表或写业务数据。账号登录范围不等于所有飞书业务域授权。

## 3. 本地归档

调用 `zhigao_setup_status` 查看 `browser.project` 和 `browser.archive`。归档按浏览器、品牌项目分别设置，不读取其他项目资料。

- `granted`：已有文件夹写入授权，直接复用。
- `none`、`prompt`、`denied`：调用 `zhigao_open_setup({"section":"folder"})`，复用现有设置面板，请用户点击「选择文件夹」或「授权文件夹」。选择后再次调用状态工具，确认返回 granted。
- `unsupported`：当前浏览器不支持此方式，建议用桌面 Edge/Chrome；其他浏览器可使用原有下载导出。
- `waiting_for_user`：网页正在处理其他弹窗，请用户完成后再打开设置，不丢掉正在编辑的内容。

在终端创建目录并不等于浏览器已获得该目录的访问权限，不能把创建目录当作归档接通。已有归档文件夹的名字或路径不是账号口令，也不需要让用户发送私有文件来测试。

## 4. 完成与续接

重新调用 `zhigao_setup_status({"verifyFeishu":true})` 与 `zhigao_status`。只汇报三项短状态，例如：

> AI 已连接；飞书账号已连接，待关联表格；本地归档已授权。

只有有实际检查依据时才标记完成。不要把下载完成、MCP 条目存在或登录成功说成全部功能均已验收。未完成项只写具体缺项与所需操作；其他已经完成的渠道不重复配置。

用户同一台电脑换 Agent、换浏览器、换品牌或换电脑时，重新检查对应范围。网页版本与连接器补丁版本可以不同；以 `connector.runtimeState` 和实际功能验证为准，不用简单的版本不相等判失败。

### 中转更新与旧版迁移（后台处理）

1.8.1 起，中转提供经过本机认证的空闲交接。`setup` 更新文件后会尝试交接；新的 MCP 进程启动后也会检查版本。正在处理审稿或飞书请求时返回 `waiting_for_idle`，客户端心跳将在工作结束后重试。交接仅释放监听端口，已有客户端继续运行；不强制终止任务、不重新登录飞书、不重置浏览器数据。WorkBuddy 的工具探测不争抢中转，也不作为持续在线客户端上报。

`doctor` 为只读检查。需要主动恢复时运行：

```sh
node ./zhigao-connector.mjs repair --json
```

`current` / `restarted` 表示中转版本已经就绪，仍须运行 `doctor --verify-feishu --json` 并验证网页连接；`waiting_for_idle` 表示任务尚未完成，不可强制杀进程。

1.7 / 1.8.0 等旧进程没有交接接口，不能通过新版文件让已经运行的旧代码自动获得该能力。`legacy_restart_required` 时，停止重复安装、退出所有客户端或要求飞书重新授权。Windows 的 `repair` 会只读核对监听端口的进程；只有 Node 可执行文件匹配、脚本为本机已安装的知稿路径且参数严格为 `hub` 时才返回 `canRestart:true` 和 PID。

只有用户已确认当前没有进行中的审稿、提炼或飞书读写（或现有明确授权已覆盖该维护窗口），才运行一次：

```sh
node ./zhigao-connector.mjs repair --restart-legacy --confirm-idle --json
```

该命令再次核对端口、PID、进程创建时间、脚本路径和旧版健康状态，只替换此独立中转。不能确认空闲、`canRestart:false`、监听者是 MCP 客户端而非独立 hub、或非 Windows 环境时，不使用这组选项；按实际 PID 定位所属客户端，完成其正在进行的工作后只重新加载那个客户端。禁止按进程名批量结束 Node / AI 客户端。此显式迁移仅用于没有交接能力的旧版本；后续更新走空闲交接。

AI 在线列表只表示近期连接，不是配置清单。WorkBuddy 启动时可能只探测工具后断开，实际使用时再连接；用 `doctor --client workbuddy --json` 核对配置，并在用户要求时验证真实工具调用，不为让列表出现名字而制造假心跳。

无须在前端添加新的按钮或教学流程。所有自动接入入口都供 Agent 使用，必要的用户交互复用现有「连接与授权」面板。

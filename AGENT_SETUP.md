# 接通知稿全部功能

连接器版本 1.12.1。这是给用户自己的 AI Agent 使用的接入流程；前端原有手动教程仍可使用。用户提供知稿网址并要求接通功能后，执行下述流程。已有配置复用，只补缺项；中断后从检查继续。

## 入口与环境

以用户提供的工作台地址为基础，读取同目录 `setup-manifest.json`。正式地址为 `https://17796919413.github.io/zhigao-desk/`。下载同目录 `zhigao-connector.mjs` 到本机工作目录，文件名保持不变。基础连接器是单文件程序，不需要下载整个网站。视频功能由连接器按同版本清单自动获取 media-runtime.mjs 和 media-worker.py；安装前同时核对连接器内置摘要及清单的 SHA-256，不让用户手工拼装组件。

需要 Node.js 18+、能执行本机命令的 Agent、支持 MCP stdio 的审稿客户端。先运行 `node --version`。没有 Node.js 时按用户系统的常规安装方式处理；无法执行本机命令时，说明当前客户端不能代配置，并指向网站已有「连接与授权」教程。

Node 缺失时连接器无法自行运行 doctor；应先检查当前客户端实际使用的可执行文件路径。安装 Node、飞书 CLI 或视频依赖仍须遵循用户授权，不为了接通自动进行全局安装。基础文本与图片审稿不依赖飞书登录或视频运行时。下载遇到代理、证书、网络错误时保留已有安装，按当前环境配置代理或让用户提供从同一发布来源取得的完整文件；不得关闭证书验证，不把下载失败当成授权过期反复登录。

doctor 的 environment 仅报告当前 Node、系统和安装目录访问检查，不会通过写测试文件来证明目录可写。`foreign_listener` 表示端口上有其他或无法识别的服务；`INSTALL_PATH_CONFLICT`、`INSTALL_PERMISSION`、`INSTALL_STORAGE_FULL` 分别检查同名文件、目录权限和可用空间。不要为释放端口批量结束进程，也不要删除原有 .zhigao 文件来重试。

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

按当前客户端支持的方式重新加载 MCP；只有该客户端必须重启时才提示用户。打开返回的 `openUrl`（正式地址带 `?connect=1`）：网页会尝试连接本机，浏览器如出现本地网络权限提示，请用户允许。普通网址在用户未明确断开时也会自动检测本机连接器；已手动断开时仍须点“连接 AI”。回到网页后会自动刷新实际连接状态。

工具可用后调用 `zhigao_setup_status`，再调用 `zhigao_status` 验证当前 Agent 能访问工作台。前一个工具无需网页连接就能检查本机；后一个工具成功且返回的 currentProject 与用户当前网页选中项目一致，才说明这个网页与当前客户端已接通。只有安装成功、端口可访问或 doctor 显示本机就绪，不能回复“已连通”。若提示其他页面已连接，应关闭旧标签页并回到目标工作台验证，不得对另一浏览器里的品牌资料继续操作。如果已注册的工具清单还是旧版，重新加载 MCP；不要重复安装其他客户端。

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

### 网页检查更新与自动更新（1.8.2 起）

连接与授权面板始终提供“检查更新”。该操作并行检查线上版本清单和本机接口，不依赖 AI 审稿是否连接；显示网页、本机连接器和最新版本，有新版时出现“更新连接器”。网页落后时出现“刷新网页”，不会自动刷新丢失用户编辑。无法访问本机时明确显示“未读取”，网络失败不报告“已是最新”。

安装在标准路径的连接器启动后检查一次；持续运行每 6 小时检查一次，网络或校验失败至少隔 15 分钟重试。仅占用中转端口的进程访问发布服务器；WorkBuddy 工具探测不触发后台更新。用户手动检查不受间隔限制。“检查更新”只检查，点击“更新连接器”或后台定时检查发现新版后，空闲时才应用。

更新只从固定正式站点读取清单及连接器文件，禁止重定向、任意下载地址和版本降级；验证 SHA-256、文件内版本与 Node 语法后原子替换并保存备份。清单和文件不同步、下载超时或激活失败时保留/恢复原版。不会安装全局依赖、改飞书凭据或业务资料。

已有 1.8.2 MCP 会话在无工具调用进行时切换模块并发出工具列表变更通知，不需要退出所有客户端。正在审稿或同步时延后；前端轮询更新状态。首次从 1.7/1.8.0/1.8.1 升到 1.8.2，旧进程没有这一能力，仍需一次标准安装和旧会话重载，不能声称旧版可直接网页更新。

Windows 的 setup/install 同时为当前用户注册 `zhigao-desk` 启动入口，不需管理员权限、不添加开机任务。当本机连接器完全未启动时，网页提供“启动连接器”，浏览器可能要求用户确认打开外部应用，然后复查本机状态。入口只运行固定已安装脚本，不接收 URL 中的命令或参数，不改变系统脚本安全设置。注册失败或已有同名冲突时，在 setup 的 launcher 字段明确返回，禁止覆盖其他程序。非 Windows 当前需启动已配置的 AI 客户端或手动运行连接器；不能把不存在的本机进程显示为已更新。

发布前运行 `node tools/prepare-update-manifest.mjs`，提交连接器与清单同一批次；核对发布的 LF 文件字节 SHA-256 与清单一致。网站发布只提供更新源，不会使完全未启动的电脑自行更新。

## 5. 视频准备与当前品牌完整审核（1.12.0）

### 自动准备与换电脑

用户要求审视频时，先调用 `zhigao_video_runtime_status`。已有 FFmpeg、Python、OCR、转写模型就复用；`ready=false` 时由当前 Agent 调用 `zhigao_setup_video_runtime`，查询状态直到 `setupProgress.state=ready` 且运行检查 `ready=true`，随后自动继续视频准备。不要只返回安装说明后停止，不另开云端模型服务，不安装 Ollama。Windows x64 缺 Python 时，内置引导下载官方安装包并核验发布者签名，安装到知稿私有目录；其他平台缺 Python 时由 Agent 按本机允许的安装方式补齐，再从检查继续。需要权限或用户登录时才提示实际缺项。

模型参数通常省略，复用已缓存模型，无缓存默认 large-v3-turbo。用户明确指定另一个受支持模型时，即使当前运行环境 ready 也要完成切换；核对返回模型名称，不能把旧模型的 ready 当作切换成功。安装锁表示有另一进程正在准备，等待并重新检查，不并发安装同一环境。终端备用入口：

```sh
node ./zhigao-connector.mjs media doctor --json
node ./zhigao-connector.mjs media setup --json
```

附属组件以版本和摘要分目录保存。旧 helper 不会因为文件存在就被当作新版加载；下载两份文件并全部校验成功后才启用，旧版本保留。清单版本不匹配、摘要不符、下载失败或语法校验失败时，停止此次准备并报告未完成，不绕过校验，也不把已发布旧版本说成新版。已验证的配套组件支持离线复用；新模型和缺失依赖仍需下载。

换电脑后用交接包传递品牌资料和原件。资料仍存于各自浏览器，不是多人实时云端数据库。新电脑重新校验视频原件和处理结果，不能复用旧电脑的任务凭据。

### 完整处理与审核顺序

1. `zhigao_status` 确认网页连接和当前品牌；用 `zhigao_list_tasks` 取得准确 docId，不按模糊项目名跨品牌找稿。
2. `zhigao_prepare_video_review` 启动本机准备；查询 `zhigao_get_video_review_status` 到 complete。处理包含所有解码帧、仅像素完全相同的画面去重、每张唯一画面 OCR，以及所有音轨的每个声道独立完整转写，不混音、不按静音检测裁去转写内容。
3. `zhigao_get_review_brief` 领取凭据、basis 与 context 目录。调用 `zhigao_read_review_context` 读完 required=true 且 complete=false 的分区；部分已读从 brief 中的新 nextCursor 续读，到 null 为止。`json-fragment` 按 recordIndex/part 顺序拼接后 JSON.parse，还原完整条目；blocks 按同一 id 的 start/end 拼回全文。brief 不内嵌全部原文。优先 `zhigao_read_review_assets` 每批1至4项读取原生图像或原声音频；返回过大时减少批量，单项可用 `zhigao_read_review_asset`。不要为了提速重复领取凭据或编写回执脚本。所有声道连续原声均须听审；不得只读 OCR/ASR 或只抽几帧。
4. 按当前资料及口径审稿，提交 snapshot、basis、sourceChecks、ruleChecks、reviewedIds、mediaChecks。sourceChecks 提供完整相关原句、application、具体理由和稿件证据，superseded 须绑定当前有效 supersededBy；不采纳反馈不得作为修改依据。素材核对须包含本次 receipt 和具体意见。可用 `zhigao_record_review_checks` 分批保存检查，最终省略的检查字段从已存记录补入，显式数组完整替换该字段。长任务用 `zhigao_renew_review` 续租；可先 dryRun 校验。
5. 仅当 coverage.complete、assurance.complete 均为 true 且 needsSupplement 为 false，才算工具层覆盖完成；仍为待人工复核，不代表品牌已通过。批次必须核对 complete、success、partial、failed、interrupted、skipped；处理结束不能替代全部覆盖完成。

本机 complete 只表示素材准备完成。AI 不具备视觉或听审能力时，改用当前客户端支持这些输入的模型；能力仍不足则明确本稿未完成，不伪造“已看”“已听”或覆盖记录。图片/PDF/视频原件保持只读，输出审核意见报告；报告中的建议需要人工确认，不能当作已改好原片。

### 失败与恢复

- `failed` / `interrupted`：修复具体原因后调用 `zhigao_prepare_video_review({docId,retry:true})`。已验证的帧、OCR、音频检查点会复用；组件、模型或内容身份变化会使旧缓存失效。中断上传从已接收偏移继续。
- 页面或租约变化：用 retry:true 重新领取对应稿件指令。resume.restored=true 表示同品牌、同稿件、同轮次、同内容版本且完整性校验通过的检查点已恢复；complete 分区无需重传，部分分区使用新 nextCursor，旧游标与旧凭据作废。savedChecks 分区提供已保存的实际核对记录；回执本身不代表看过图，缺少实际核对记录及视觉上下文时仍须读取素材。主动释放、明确重审、旧版无校验记录或检查点损坏时不继承完成证明。
- 活动审稿自动续租，仍支持 renew_review；闲置任务不无限续租。BASIS_CHANGED 后不能提交旧结果。补漏用 reopen_review，完整替换结果并保留历史。
- 引用必须是所填 ID 对应原文的连续子串，保留换行空格。dryRun 的 validated=true 只表示结构可解析，不代表完整；查看 complete、assurance.diagnostics 和 needsSupplement，一次修正具体字段。
- PAGE_UNRESPONSIVE 表示没有收到心跳，不证明用户关了页面；CALL_QUEUE_TIMEOUT 表示未执行的排队请求已取消；CALL_EXECUTION_TIMEOUT / PAGE_BUSY 表示网页可能仍在执行，不要重复提交。恢复连接后核对批次或已保存结果。同 ID 结果回传可重试，不能把重新执行当作结果重传。
- 1.12.1 排队最多90秒，通常执行最多180秒；只有已完成的来源验证、解析或素材渲染等实际进展可延至最多240秒，排队加执行最多270秒。心跳不延长执行，120秒无页面响应停止等待；这些期限不保证外部客户端愿意等待同样时长。`CALL_TRANSPORT_UNCERTAIN` 表示中转响应丢失，操作是否完成尚不确定，连接器不会自动重做。回到网页核对已保存结果再决定后续操作。
- 后台/冻结页面仍有未确认执行时不允许另一页面抢占。页面完成或明确断开后可接续；浏览器进程崩溃且不能确认任务结束时可能保留占用，需先确认旧浏览器已退出、操作结果已核对，再按本机维护边界处理连接器。不能据此声称旧操作已被取消。
- `PAGE_TOOL_UNSUPPORTED` 表示当前网页声明的工具清单不支持所调用工具。在空闲时刷新网页并重新发现客户端工具；不要反复领取审稿凭据。doctor 分别报告 installedVersion、runningVersion、pageVersion（旧网页不提供时为空）。支持工具不同才阻断调用，不因补丁版本不同一律拒绝。
- 多素材响应被客户端拒绝或无法展示时，改用 `zhigao_read_review_asset` 逐项读取原清单；保留同一稿件、当前凭据、准确的素材与回执配对。不能把拿到回执当成实际看图/听审，也不静默跳过失败项。`PDF_CANVAS_LIMIT` / `PDF_RENDER_FAILED` 必须明确本页未读，处理超大页面或浏览器资源后重读。
- `BASIS_CHANGED`：`get_review_brief({docId,retry:true})` 领取新凭据，阅读 basisUpdate 摘要及 updates 分区，再完整读取当前必读资料并重新核对。previousChecks 只供参考，读取它不会继承完成状态；旧游标和旧凭据不可复用。分批保存失败时原进度仍可重试。已提交结果即使检查点清理失败仍返回 ok，同一凭据同一结果重交不会重复写入。
- 资料原件丢失、外链图/图表/SmartArt或其他不支持对象：具体列出阻断项，不能忽略后报完整。
- 长视频和动态画面会产生较多唯一画面与必听片段。继续按全部清单审核，不为减少成本偷偷抽帧；资源或传输限制应明确报未完成。

发布前须运行 `node tools/prepare-update-manifest.mjs`，同步生成两份 helper 的摘要和字节数、连接器内置摘要以及连接器自身摘要。将连接器、两份 helper 和清单作为同一发布批次。当前本地验收不代表无 Python 的新实体机或所有操作系统均已实测。

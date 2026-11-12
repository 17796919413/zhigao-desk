# 本地开发回归

`table_library_resilience_browser.py` 另覆盖12组真实浏览器故障场景：换链接与换品牌、读取乱序、配额失败、403/429/500与恢复、空文件、同名更新重复点击、导入期间并发编辑、损坏PPTX与长文件名、外部原件变化/缺失、25格分批写入中断及中途换链接。需指定新的 `ZHIGAO_VERIFY_OUT`；只使用隔离响应、合成文件与OPFS，不访问真实飞书或用户目录。`connector_runtime_test.py` 包含慢进程身份检查导致健康连接过期，以及身份真正改变时继续拒绝重启。`environment_browser.py` 会故意延迟新页连接，等就绪后验证检查点恢复。

单表与品牌资料回归：`node tests/table_library_test.mjs` 和 `python -X utf8 tests/table_library_browser.py`。后者使用随机端口、隔离 Edge、真实 stdio MCP、合成 Office/PDF/文本、隔离飞书 API 响应以及 OPFS 模拟目录授权；不会写真实飞书。视频验证复用 `_verify/assurance-20261110/fixtures/full-review-test.mp4` 与该目录的 `fresh-runtime` 私有测试环境，只算本机已有环境验证，不能冒称另一台空环境已通过。

`agent_connection_browser.py` 覆盖恢复前台、迟到的成功/失败响应、立即重试、主动断开、页面会话恢复、多标签页、实际浏览器断网与恢复、中转退出接替。使用隔离 Edge / MCP、短轮询和缩短的页面失联期限。暂停请求后触发 resume 只代表故障模拟，不代表数小时待机或操作系统休眠。当前 Edge 的 CDP 冻结命令虽返回成功，空白页计时器仍继续运行，因此新测试不以该命令作为冻结成功证据。`connector_connection_test.py` 覆盖响应截断、持续缓慢响应总期限和不重复执行。

普通用户运行基础连接器只需要 Node.js 18+ 和支持 MCP stdio 的客户端；以下是开发测试前提，不是普通用户安装要求。

完整套件当前需要 Git 历史（含1.11.0基线 `fb0c5b2b1748bf957b6bd7bf364c5444d56060d4` 和1.7.0发布）、Node、Python、Python Playwright 与本机 Edge。性能与版本矩阵固定读取上述1.11.0提交，不随新发布后的HEAD改变。部分历史测试仍以 Windows 为主要环境。不要为了测试擅自全局安装或替换正式连接器。

```powershell
$env:ZHIGAO_VERIFY_OUT='D:\指定的新证据目录'
python -X utf8 tests/verify_review_performance.py
python -X utf8 tests/version_matrix_browser.py
node tools/prepare-update-manifest.mjs
git diff --check
```

每轮设置新输出目录，保留失败记录；不要覆盖上一轮验收证据。套件运行合成数据、随机端口、隔离浏览器与连接器副本，关闭的只是夹具创建的进程。PDF/PNG 夹具由 `synthetic_fixtures.py` 用标准库生成，不再依赖开发者历史 `_verify` 附件。ZIP 代码包没有 Git 历史，需完整仓库才能运行涉及历史版本的测试。

浏览器夹具把 Python HTTP 服务连接队列设为128：Windows 上默认小队列曾在并发加载模块时出现 `ERR_CONNECTION_REFUSED`，表现为刷新空白。要同时保留控制台与失败请求证据，区分夹具故障、产品加载错误和数据保存失败。当前另有主动阻断模块并恢复的产品回归。

`connector_environment_test.py` 包含传输响应丢失、页面竞争、慢进度/假进度/硬期限、空目录、缺 CLI、中文空格路径、权限与空间故障注入。缺 Node 无法运行 JS，本轮只验证不支持版本的诊断分支，没有冒称在无 Node 的实体机上运行过连接器。

`environment_browser.py` 实际运行 PDF.js 和 stdio MCP，使用合成扫描/混合 PDF、4倍 CPU 限速、每素材600毫秒延迟、加速期限和 CDP 页面冻结。测试中的 JS 堆读数不包含整个浏览器、工作线程、画布和解码峰值；冻结不等于真实系统睡眠/最小化。`version_matrix_browser.py` 使用固定1.11.0提交的旧网页和旧连接器交叉验证。另一台电脑与真实 WorkBuddy 客户端仍须单独取证。


1.14.0新增检查：`node tests/task_runtime_test.mjs`（确认/取消/重连/重启恢复/模型绑定），`node tests/task_channels_test.mjs`（合成飞书授权/二维码/权限/身份变化和媒体模型），`python -X utf8 tests/task_panel_browser.py`（真实Edge弹窗/焦点/迟到响应），`node tests/office_transport_test.mjs`（真实Office分片/恢复/并发；设置ZHIGAO_TEST_DOC为合成DOC及ZHIGAO_VERIFY_OUT）。

`tests/task_channels_browser.py`生成真实DOC/XLS/PPT，从正常审稿入口验证自动转换、处理中刷新、原批次续办、brief和交接包，同时确认界面保留原文件名且无新增转换按钮。原有网页读表按钮也验证缺授权后的同表续办。测试服务使用HTTP/1.1连接复用并替换回环地址及AGENT_PORT为随机端口，禁止接入正式中转。可选ZHIGAO_TEST_MEDIA_HOME指定确实缺依赖的隔离虚拟环境，从正常get_review_brief触发确认、真实私有准备及完整视频处理；可复用既有模型并记录。设ZHIGAO_TEST_MEDIA_MODE=existing可验收已准备环境的复用，两类证据不得混称。缺项模式最多等待15分钟安装和5分钟视频处理，不把仅doctor通过计作完整准备。

刷新夹具在实际 Office begin 响应到达后暂停前端接收，核对持久记录仍是 preparation，再刷新并验证同一转换 job 被复用。另在审稿凭据生成后、结果回传前暂停，核对 original 检查点再刷新：原调用重试、recover、resume、cancel 均不能抹去 uncertain 或再次派发。不要用 resuming 状态或固定睡眠代替这两个精确边界。渠道单元检查另覆盖相同场景的执行超时，核对原调用次数始终为一次。

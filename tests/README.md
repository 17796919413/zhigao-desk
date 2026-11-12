# 本地开发回归

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

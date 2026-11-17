# 本地开发回归

刷新连接回归：`python -X utf8 tests/agent_connection_browser.py` 使用新的 `ZHIGAO_VERIFY_OUT`，覆盖真实 MCP 调用后的刷新恢复、品牌隔离、主动断开、网络恢复、同名客户端会话更换以及四个主页面移除活动栏。测试使用隔离 Edge、随机端口与合成品牌，将心跳和会话过期时间缩短；不代表实际系统休眠或 Mac 客户端验收。刷新可以恢复仍在线客户端的既有验证，首次接入和新客户端会话仍需一次真实状态调用。

同步后返回原表：`python -X utf8 tests/source_grid_browser.py`新增核对已知云表版本变化后的重返与编辑。只有同一表的已知版本高于当前缓存时才刷新，复用既有表格和状态，不新增操作；原有草稿、断网恢复及迟到响应场景继续覆盖。

checkpoint-25关键实表验收见`tests/critical_feishu_live_browser.py`及唯一交接7.28：使用专用测试工作簿中新建的`知稿关键验收-1117-CP25`子表，经隔离连接器和真实Edge核对单稿同步、其他活动/品牌通过保护、自动保存、类型/公式及行列移动后的定位。须明确设置`ZHIGAO_GRID_LIVE=1`、`ZHIGAO_LIVE_STATE`和新的`ZHIGAO_VERIFY_OUT`；这是绑定该合成夹具的分段实测入口，现有夹具已完成写入，不直接重跑初始化或整段入口。只在核对当前云表和已有证据后使用对应续验段；禁止改成正式业务表。checkpoint-25已删除的仅是本批新插入且核对为空的行列，子表及合成数据保留。

真实布局契约：`node tests/grid_layout_contract_test.mjs`（可加`--embedded`）覆盖实际CLI返回的`frozen_rows/frozen_columns`和零基数值`hidden_rows`，与既有一基范围格式兼容。初读、冻结补读和浮图几何补读都先归一化，再按原表行列显示；冲突或越界值拒绝读取，避免猜测隐藏位置。

`python -X utf8 tests/source_grid_live_layout_browser.py`是显式启用的真实只读验证，必须同时设置`ZHIGAO_GRID_LIVE=1`和新的`ZHIGAO_VERIFY_OUT`。固定只读此前已授权的CP7合成子表`ez1Kvd`，使用内嵌grid模块、真实CLI与隔离Edge，核对冻结、隐藏第39行/B列、`B39:D43`跨页合并及已有两类图片；不创建夹具、不写入、不使用个人浏览器配置。checkpoint-24已完成夹具准备，revision为83；不要重跑证据目录的`live_setup.py`。本入口没有验证飞书网页原表并排、全部复杂布局、其他客户端或结构编辑。

原表浮动图片：`node tests/grid_floating_test.mjs`（可加`--embedded`）与`python -X utf8 tests/source_grid_floating_browser.py`。浏览器须指定新的`ZHIGAO_VERIFY_OUT`，仅使用隔离Edge、合成表格API和PNG；核对当前页延伸图片、冻结分片、隐藏行列、图片迟到期间的输入保持、失权提示和普通格保存。文字与单元格图先展示，再只读获取浮图位置；离页锚点不按缺失尺寸猜位置。临时地址仅在快照内存中，图片失败状态不因进入编辑框而消失。没有新增常驻按钮、面板或授权步骤。

checkpoint-23另在已授权的CP7合成子表`ez1Kvd`完成真实图片读取：准备阶段只给H76加单元格图、D76加240×120浮动图、第76行设120px高度，原有6个业务子表未写入；随后使用隔离服务、当前内嵌grid模块、真实CLI和下载接口，在实际Edge中核对解码与桌面/390px画面。证据为`../_verify`同级实施目录中的`implementation-20261117/checkpoint-23`（完整入口见唯一交接）。这不是飞书网页原表并排验收，也不证明复杂浮图重叠顺序、裁剪/旋转、真实隐藏/冻结语义或其他客户端已通过。该证据目录的`live_setup.py`已经执行，不要重跑写入。

原表单元格图片：`node tests/grid_images_test.mjs`、同入口加`--embedded`及`python -X utf8 tests/source_grid_images_browser.py`须使用新的`ZHIGAO_VERIFY_OUT`。读取保留富文本和原始单元格中的图片引用，当前页文字先显示，再分批获取临时图片地址；图片格继续只读，图片失败不阻断普通格保存。前端不保存临时地址到localStorage，连接器结构快照不保存图片或签名链接。浏览器入口使用真实Edge解码合成PNG，验证合并/分页/冻结位置、缺图与权限失败、在输入时图片到达、切表迟到响应、桌面和390px。飞书读写与下载地址是合成接口，不等于真实云表图片、浮动图或飞书原表并排验收。`--embedded`验证当前生成连接器中的同一模块；不得替换正式连接器来运行测试。

自动备份的写入边界已于2026-11-17由用户确认：同一项目只由一个浏览器配置写入，恢复副本独立保存。浏览器持久身份不进入恢复数据；目录中的持久声明阻止其他配置接管原项目。首次迁移旧目录时，先创建唯一声明再检查其他声明；并发争用不能双方都获得写入归属。原配置刷新或重启后沿用身份；丢失配置或遇到外来声明时从既有恢复入口另存副本，不自动抢占。恢复即使在空浏览器中也使用新的项目身份和独立备份目录，源备份保持。

`node tests/backup_writer_test.mjs`覆盖5组真实Windows目录与独立Node子进程场景：拒绝外来配置、同身份重启、双进程同时恢复、暂存期间真实进程退出、旧目录首次并发归属。它使用File System Access适配器，不代表已完成浏览器外部目录选择/撤权、真实断电或另一台设备验收。

`node tests/backup_read_consistency_test.mjs`覆盖6组读取与提交/清理交错、索引变化时有限重读、持续变化、同长度同时间戳损坏及旧索引恢复；`python -X utf8 tests/backup_read_browser.py`覆盖5组实际Edge/OPFS原件和意见单在后续清理后的可读性、刷新后身份沿用，以及最新索引File在读取前被替换的竞争。恢复逐个校验并复制4MiB以内的数据块，返回的Blob/File不再依赖随后可能被清理的原备份块；读取期间版本变化最多重新取得3轮，稳定损坏不跳过校验。两个入口均须使用新的`ZHIGAO_VERIFY_OUT`。这没有证明百份大视频的总进程内存上限。

自动项目备份：`node tests/project_backup_test.mjs`（12组块存储、失败提交、校验与105份记录）、`node tests/backup_restore_test.mjs`（6组身份重映射、历史轮次与未完成上传）及 `python -X utf8 tests/project_backup_browser.py`。浏览器入口必须指定新的`ZHIGAO_VERIFY_OUT`，使用实际Edge/IndexedDB/OPFS，合成项目、5MiB媒体字节和注入的空间/权限故障；将备份目录内容复制到全新浏览器上下文后，从现有选文件夹入口恢复，验证事务回滚、结果文件重开、待确认上传去重和另一标签已保存内容。合成媒体字节不等于可播放长视频，不是实际系统满盘、断电、Mac或外部目录授权验收。

恢复续办：`node tests/backup_restore_edges_test.mjs`（7组）及 `python -X utf8 tests/backup_restore_resume_browser.py`（10组）均须指定新的`ZHIGAO_VERIFY_OUT`目录。覆盖相同项目/任务/稿件身份冲突、嵌套历史轮次与反馈关联、结果批次关联、待上传的指定任务和归属表单、刷新后从原入口确认/重新解析并续入第三与第四轮，以及续办后的备份回读。浏览器使用实际Edge/IndexedDB/OPFS，并调用真实删除事务生成合成记录的删除标记，验证删后恢复另建身份、保留删除保护；不删除用户文件、不写真实飞书。历史媒体运行状态清除是恢复规划边界检查，不是视频处理验收。此入口不证明外部目录授权、跨进程争用、另一台设备或真实模型审阅质量。

`project-backup.js`按4MiB块保存二进制，以摘要去重；先校验暂存与块，再更新`latest.json`。写入期间的`last-good.json`只用于失败恢复；提交后清理过期块，不提供日期历史快照。后台调度复用既有目录，持续显示最新时间或未更新，不新增常驻操作。记录读取使用同一数据库只读事务，并用已提交变更标记、记录键和设置版本作写前/写后检查；这不是跨浏览器、跨进程文件系统的原子事务承诺。多次恢复会新建副本而不会覆盖已有品牌。恢复后重新连接飞书、重取审核凭据，保留旧检查仅供参考；目录身份、原件块或Office转换摘要不符则停止。备份中不保存运行凭据或登录会话。

`node tests/grid_access_test.mjs`与`python -X utf8 tests/grid_access_browser.py`覆盖新版原表的登录准备续办。浏览器入口要求新的`ZHIGAO_VERIFY_OUT`目录，使用真实Edge、隔离连接器HTTP/MCP、持久任务与grid模块；CLI/扫码/表格数据由`tests/grid_access_lark.mjs`合成，不访问真实飞书。覆盖初次读表、读权限补充、保存前读表和派发时登录失效、刷新后复用准备、已确认插行、非授权错误及跨品牌阻断。单元检查另外覆盖活动/链接/子表切换、续办失败和存储故障。授权后仍走原有版本检查及操作记录恢复，不重做结果不明的写入。

保持现有简洁界面，不新增常驻按钮或面板。仅在缺本人登录/授权时打开现有准备弹窗；提示直接说明需做什么，校验和重放保护在后台。`grid_access_browser.py`另覆盖明确缺写scope后的单元格保存和插行刷新恢复，以及登录/写scope准备期间真实重启隔离连接器、原表版本变化和无回执行列操作的人工核对。只有CLI明确返回`ok:false`、`error.type:missing_scope`和缺失scope清单时，写请求才记为明确拒绝；模糊错误、超时和响应丢失继续按结果不明处理。上述平台授权和读写响应均由合成CLI提供，不等于真实飞书授权验收。两份旧表格浏览器夹具已迁移，边界见下文。

`node tests/grid_snapshot_test.mjs`和`node tests/grid_snapshot_test.mjs --embedded`验证结构快照跨连接器重启续办。读取时仅在连接器私有`grid-snapshots`目录保存工作簿/子表身份、版本、行列边界及时间，不保存格内容、样式、评论或表名；缓存最多32份、有效期30分钟，不是项目备份或操作成功记录。恢复结构操作仍检查原操作标识、当前工作簿、版本和边界；过期、缺失、损坏或存储失败时拒绝写入。持久快照不能用于旧单元格写入。无回执的操作继续保留不确定状态，人工核对仅记录`acknowledged`、不伪称已执行。两个入口覆盖实际运行时和连接器内嵌模块；浏览器入口另外验证实际进程退出/重启、网页刷新与同一准备任务续办，不替换正式连接器。

人工核对未执行或完成行列核对后，只清除当前归属和动作对应的授权续办标识；正常授权续办尚未返回时不提前清除。`grid_access_test.mjs`覆盖其他动作、品牌、活动、链接和子表的记录保护；`grid_access_browser.py`连续验证原表冲突、人工确认未执行、新操作回执丢失及再次重启，防止残留旧准备任务遮住当前恢复提示。

`python -X utf8 tests/sync_access_browser.py`须指定新的`ZHIGAO_VERIFY_OUT`，运行实际Edge、隔离连接器HTTP/MCP、任务准备与写入历史，CLI与表格为合成数据。验证单稿同步登录失效、写scope、准备期间刷新、跨品牌/活动/链接、依据更新、新审核结果、项目结束、覆盖缺口及归属变化，以及响应丢失后只读核对。只续办用户点击的原稿当前阶段，不把普通同步差异准备变成自动全表同步。续办索引只存身份与摘要，不存稿件正文；重复授权不代替写后回读。真实飞书授权与全表差异仍需另验。

`node tests/feishu_activity_test.mjs`与`python -X utf8 tests/activity_sync_browser.py`验证活动行匹配及单稿同步。浏览器入口须指定新的`ZHIGAO_VERIFY_OUT`；使用真实Edge、实际前端和从当前连接器提取的匹配/写前复核/写入/持久历史函数，读表和CLI响应为合成数据，不调用真实飞书。识别“活动”“活动名称”“项目活动”“campaign”的明确表头；按当前品牌中的唯一活动名称或ID匹配。活动为空、未知、重名或列重复时不自动猜测。无活动列旧表保持原三字段键，跨活动争用仍阻断；已有绑定经“匹配稿件”或同步重新读取后更新。

`node tests/feishu_activity_mapping_test.mjs`及`python -X utf8 tests/activity_mapping_browser.py`验证自定义活动列。出现同名跨活动歧义或原选择失效时，复用“匹配稿件”打开必要的选列弹窗；不猜列、不加常驻按钮。明确选择绑定子表和表头，列移动可重定位，改名/删除/规范化重名需重新选择；连接器独立回读列和行身份。浏览器覆盖刷新、取消、未选择、完整表差异、列移动、远端改头、切活动、换链接、配额失败、双标签和同步中映射变化，以及桌面/390px画面。每次指定新的`ZHIGAO_VERIFY_OUT`，强制合成远端；真实平台写入和授权能力不由本入口证明。

同步只写当前稿件阶段格，活动加入行键和连接器写入历史；列移动/插行后重新定位，旧客户端漏传活动时拒绝写入。测试比对整个合成表，验证档期/发布/反馈及其他活动保持，并覆盖响应丢失、空响应、切活动、新一轮、新审核、依据更新和旧响应不覆盖新结果。18组浏览器通过不等于真实飞书全表差异验收；自定义活动列映射、真实授权续办、复杂布局及多环境验收仍需补齐。

`node tests/grid_structure_test.mjs`、`node tests/grid_structure_test.mjs --embedded`与`python -X utf8 tests/source_grid_structure_browser.py`覆盖原表行列操作。浏览器入口须使用新的`ZHIGAO_VERIFY_OUT`，强制合成接口；点击行号/列标选择插入或删除，删除前显示具体范围。覆盖行列移位、类型保持、旧映射失效、刷新恢复、回执丢失、人工核对期间版本变化、存储失败、待保存输入、连续提交、双标签、切表和末页删除。`--embedded`直接加载生成连接器中的grid模块并验证重启后的持久操作记录，不等于真实客户端HTTP/CLI验收。

结构操作收到成功回执但回读中断时可只读恢复；未收到执行回执时不能仅凭行列数认定成功，也不自动重试。必须核对飞书原表后明确继续；核对绑定当时读取的版本，记录为`acknowledged`，不伪称已执行成功。结构变更使同链接旧快照失效，单稿同步仍须重新读取并按身份匹配。本入口不写真实飞书，未验证真实平台结构操作、合并/公式随结构移动、活动行映射或单稿同步全表差异。

原表显示与编辑新增入口：`node tests/grid_runtime_test.mjs`、`node tests/source_grid_test.mjs`、`python -X utf8 tests/source_grid_browser.py`。浏览器入口必须指定新的 `ZHIGAO_VERIFY_OUT`；使用真实 Edge、隔离数据与私有 Node 测试服务，测试服务执行实际 `grid-runtime.mjs`，默认飞书响应为合成数据。覆盖格式化显示和原始类型分离、原行列/合并/样式、分页、自动保存、响应丢失后刷新恢复、版本冲突确认、存储故障、保存途中继续输入和切表迟到响应。不是客户端模型语义测试。

`python -X utf8 tests/source_grid_layout_browser.py`另验证隐藏行列/隐藏合并起点、跨页合并补读和原始起点编辑、富文本只读、覆盖格保护、响应丢失恢复、补读版本冲突，以及390px窄屏下横纵滚动位置保持。必须指定新的`ZHIGAO_VERIFY_OUT`，强制使用合成接口；实际运行Edge与grid运行时，不写真实飞书。截图与单元格几何测量保存在输出目录。运行时补读的合并起点与分页数据必须同revision，写入只允许原始起点；隐藏行列不计入可见跨度。真实飞书冻结区域、图片/浮动对象及原表并排核对仍未完成，不能用本入口替代。

`python -X utf8 tests/source_grid_freeze_browser.py`验证冻结行列显示：后续页补读冻结原行、跨冻结边界合并格的分区裁切与唯一编辑框、原格写回、隐藏行列偏移、桌面/390px窄屏滚动、超大冻结范围的可滚动降级与窗口尺寸恢复、补读版本变化和切表。需新的`ZHIGAO_VERIFY_OUT`；强制合成接口、不写真实飞书。冻结补读按50行分批，页面行号不含额外冻结行；超过视窗时保留全部内容供滚动查看并显示简短提示，不修改源表冻结设置。当前测试没有验证真实飞书非零冻结字段的返回、原表截图一致性或所有浏览器；不能用合成场景声称完整M4验收。

仅在继续使用已授权的 CP7 专用合成子表时，设置 `ZHIGAO_GRID_LIVE=1` 运行上述浏览器测试；写入边界固定为测试工作簿内 `ez1Kvd`，不能改成其他真实业务子表。真实模式对85行8列做前后对比，保留数字/布尔/文本编号类型，验证关联公式自然重算；原业务子表不写入。`python -X utf8 tests/grid_connector_live.py`另验证实际连接器副本内嵌模块、HTTP、CLI、持久操作记录和进程重启，不替换正式连接器。它只修改该合成子表A5，并保留证据，不负责删除合成子表。

`table_library_browser.py` / `table_library_resilience_browser.py` 已迁移到现行原表入口；每次必须指定新的 `ZHIGAO_VERIFY_OUT`，不得复用旧证据目录。前者验证源表表头、40行分页至末行、子表切换、稿件旁手动同步后整表逐格差异，以及资料、真实本机媒体准备、原件归档与手动交接包。可设置 `ZHIGAO_TEST_IDS=bundle-reparse` 仅跑原件文件名恢复和重新解析；报告必须注明为选定项，不能算完整入口通过。移除的搜索/全表同步按钮不恢复；旧搜索算法仍由 `table_library_test.mjs` 覆盖。后者验证实际原表错误恢复、乱序与跨品牌隔离，以及资料存储故障。旧快照读写和25格分批中断场景通过仅存在于测试HTTP响应中的 `window.probe` 调用保留的兼容动作，核对持久结果；它们不是现行用户入口或真实平台验收。`table_grid_fixture.py` 仅模拟原表响应契约，实际grid运行时由 `source_grid_browser.py` 覆盖。单稿同步仍需手动，编辑单元格不会触发审核进度同步。源表图片/复杂对象、冻结区域和跨页合并的真实平台验证、行列结构操作和完整活动行映射仍需补齐验收。

业务一致性回归：`node tests/business_consistency_test.mjs`、`python -X utf8 tests/business_consistency_browser.py`、`python -X utf8 tests/business_edges_browser.py`。每个浏览器入口指定不同的新 `ZHIGAO_VERIFY_OUT`，防止结果同名覆盖。覆盖双标签版本冲突和草稿恢复、删除保护、导入整批提交与中断恢复、导入结构与截图校验、内容归属选择、当前轮次、审核失效、Excel类型/公式只读与旧数据升级、跨年日期、长段补丁，以及保扩展名的真实OPFS归档。`ZHIGAO_TEST_IDS` 可用逗号分隔指定对应测试ID；最终汇总须注明是否只跑了选定项。

新的提炼记录带 `rowId`，复核可改产品字段，但须保持行标识、达人、平台。历史记录在读取时补稳定行标识。Excel数字、布尔、日期和公式缓存参与审阅，原生导出保留其类型；缺公式缓存、错误值和无法可靠呈现的格式须保留阻断。交接包预检要求稿件有有效任务归属，合成夹具也必须构造对应的 `items`。不能删掉这些断言来迁就旧夹具。

`table_library_resilience_browser.py` 另覆盖16组真实浏览器故障场景：换链接与换品牌、读取乱序、配额失败、403/429/500与恢复、空文件、同名更新重复点击、导入期间并发编辑、损坏PPTX与长文件名、外部原件变化/缺失、25格分批写入中断及中途换链接。需指定新的 `ZHIGAO_VERIFY_OUT`；只使用隔离响应、合成文件与OPFS，不访问真实飞书或用户目录。`connector_runtime_test.py` 包含慢进程身份检查导致健康连接过期，以及身份真正改变时继续拒绝重启。`environment_browser.py` 会故意延迟新页连接，等就绪后验证检查点恢复。

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

资料替换清理回归：`node tests/library_cleanup_test.mjs` 与 `python -X utf8 tests/library_cleanup_browser.py`。浏览器测试必须提供新的 `ZHIGAO_VERIFY_OUT`（目录不可已存在），使用隔离 Edge、合成资料及真实 IndexedDB，不读个人资料、不访问真实飞书。覆盖清理故障后刷新恢复、事务中断回滚、确认队列失败重放、共享原件与其他活动保护、已完成结果和稿件旧轮次保留，以及真实网页审稿工具重新领取新依据、旧凭据拒绝。ZIP 验证只证明现有手动备份排除失效缓存，不等于自动完整备份和独立全项目恢复验收。

上传归属回归：`node tests/upload_assignment_test.mjs`、`python -X utf8 tests/upload_assignment_browser.py`，后者需新的`ZHIGAO_VERIFY_OUT`目录。未知平台/形式/阶段不再用默认值；待确认与失败文件持久保存，确认后才加入批次。测试覆盖刷新恢复、集中确认、活动切换、双标签迟到写入、存储失败和收到新版保留原记录。既有夹具若需直接入库，必须在合成文件名或明确标签中提供真实测试元数据，不得为兼容夹具恢复静默默认值。

`python -X utf8 tests/mixed_delivery_browser.py`使用合成Word/Excel/PDF/PNG、FFmpeg生成的一秒视频及坏文件，共10份；验证批次计数、失败/部分完成续审、直接出稿、OPFS归档、Office重解析与逐字标红、媒体复制和报告一致性。视频故意保持未完成；测试断言是合成协议验收，不是连接模型语义质量、原生Word/Excel渲染或5—6分钟视频验收。

`python -X utf8 tests/office_native_browser.py`要求新的`ZHIGAO_VERIFY_OUT`目录，以及本机已安装的Microsoft Word/Excel、Python COM、python-docx、openpyxl、Pillow和PyMuPDF；不自动安装。只创建合成原件并使用独立COM实例，不附着用户正在编辑的文档。浏览器走真实解析/审稿服务/导出/OPFS归档，模型核对结果为合成输入。覆盖图片、链接只读保护、页眉页脚、两页Word、两张工作表、合并格、日期、数值/布尔/公式缓存、原色与加粗；修改稿由Word/Excel原生重开并导出PDF/PNG，需另实际查看画面。还验证仅可选优化的详情计数/不改稿，以及旧媒体意见复制、报告与归档一致。未知数字格式仍阻断；Excel自动保存的转义日期分隔符已有专项断言。此测试不等于任意复杂Office、长视频或真实模型语义验收。

`workbench_feedback_browser.py`连接验收区分“客户端在线 · 待验证”和“AI 可用”：先等待实际在线状态，再通过真实stdio MCP读取明确项目ID并核对网页凭据。不能等待旧“已连接”文案，也不能把异步import返回的Promise当状态判断。`workbench_extra_browser.py`另覆盖独立浏览器争用与12万字全文保存。两个夹具均禁用URI注册，不改正式连接器。

连接器资料清理：`node tests/connector_cleanup_test.mjs`与`python -X utf8 tests/connector_cleanup_browser.py`均指定新的`ZHIGAO_VERIFY_OUT`。前者检查私有目录清理、共享原件、旧作业兼容、删除失败重放、迟到上传、忙碌/超时保护、目录联接与准备结果失效；后者使用真实Edge、stdio MCP和已有LibreOffice，在隔离目录生成两版DOC，验证转换、替换、断线刷新、恢复连接后自动清理与新版重新准备。媒体目录是合成控制面夹具，不是长视频或语义审核验收。后台队列不新增前端按钮或缓存审计说明；浏览器保存后处理失败仅沿用简短提示与已有重试操作。媒体组件测试副本必须同时包含`cache-cleanup.mjs`，并验证发布清单摘要；不访问正式连接器或真实业务缓存。

历史归档恢复：`node tests/backup_history_test.mjs`与`python -X utf8 tests/backup_history_browser.py`使用新的`ZHIGAO_VERIFY_OUT`。9组Node检查覆盖历史文件引用、旧备份兼容、所属记录路径校验、恢复身份与原件标识；11组真实Edge检查使用隔离IndexedDB/OPFS、双活动同名达人、首审/复审、嵌套旧轮、反馈附件和11份合成归档文件（12处记录引用）。从备份目录恢复后逐份重开，验证再次备份、连续恢复、源目录SHA-256保持，以及恢复事务与回执清理中断后的重开续办。只凭已写文件不算完成；记录关联和完成标记须同事务提交。

旧备份没有`recordPath`时仍恢复到当前稿；新备份按旧轮或历史审核记录保留所属关系。修复不能补回旧备份从未收录且现已丢失的历史文件。上述检查不等于真实浏览器外部目录授权、现有业务项目迁移、真实满盘/断电、跨设备或真实模型审核验收。

目录权限恢复：`python -X utf8 tests/backup_permission_browser.py`要求新的`ZHIGAO_VERIFY_OUT`。9组实际Edge/IndexedDB/OPFS检查中，权限响应及写中失权明确为合成。覆盖备份失权后原有授权入口可用、最后可用索引保留、重授补存、返回页面只读查询、迟到查询不影响新句柄，以及笔记和其他弹窗输入保持。未调用后台授权，不把这些检查称为实际浏览器权限撤销。

真实外部目录：`tests/backup_external_browser.py`以可见的独立Edge配置打开正常目录入口；必须本人完成Windows目录选择与Edge编辑授权。仅使用脚本新建的合成目录，原生句柄、权限API和磁盘均不替换。`tests/backup_external_restore_browser.py`另以全新Edge进程及配置读取`ZHIGAO_EXTERNAL_DIRECTORY`指向的这份合成备份，验证另存新项目、原件实际重开及源目录摘要保持。两者均需新的`ZHIGAO_VERIFY_OUT`，后者先保存既有项目的现行迁移基线再作完整比较；打开品牌页增加空资料库和旧表配置迁移字段，不是恢复覆盖业务资料。

checkpoint-21的外部目录恢复为分段证据：首次真实恢复后，旧基线断言失败；修正基线口径后，从已实际恢复的新配置续验，逐份重开Windows文件、独立备份、源摘要和刷新继续保存全部通过。不能将其写成新版独立恢复主入口完整重跑。同期上传恢复夹具已改为等待实际UI完成并核对持久上传完成标记，不能只凭稿件入库数量判断归档及页面刷新均已结束。`取消关联`移除知稿的目录关系，不能充当Edge撤销权限；实际权限撤销仍待单独验收。可见浏览器会在测试结束时关闭，失败或完成必须核对结果文件；本轮用户已要求不再反复手动点击，后续续接不要重跑这些本人操作。

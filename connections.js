// 接入引导：状态来自实际连接或显式检查，教程按需展开。
import {folderSupported} from './folder.js';
import {WEB_VERSION,newer,checkUpdates,localUpdate} from './connector-updates.js';

export const FEISHU_COMMANDS = {
  install: 'npm install -g @larksuite/cli',
  config: 'lark-cli config init',
  login: 'lark-cli auth login --domain sheets --domain drive --domain wiki',
};

export function feishuIssue(code) {
  return ({
    FEISHU_CLI_MISSING: ['missing', '未安装飞书 CLI', '安装飞书 CLI 后，登录你的飞书账号。'],
    FEISHU_CONFIG: ['config', '待配置应用', '打开终端完成应用配置，再登录飞书。'],
    FEISHU_AUTH: ['auth', '待登录飞书', '登录飞书账号，完成表格与云空间授权。'],
    FEISHU_SCOPE: ['scope', '待补充授权', '补充表格与云空间权限后重试。'],
    FEISHU_ACCESS: ['access', '表格访问受限', '用已登录的账号打开这张表，向表格所有者申请相应访问权限。'],
    CONNECTOR_OFFLINE: ['connector', '连接器未运行', '启动已接入知稿的 AI 客户端，再检查连接。'],
    CONNECTOR_ORIGIN: ['origin', '当前网址未接入', '请从正式工作台打开；本地部署需配置连接器的网页来源。'],
    CONNECTOR_UPDATE: ['update', '连接器待更新', '点击上方“检查更新”，核对本机连接器版本。'],
  })[code] || ['error', '检查未完成', '确认网络可用后，重新检查。'];
}

export function createConnections(ctx) {
  const esc = ctx.esc;
  let expanded = '', feishu = {state: 'unknown'}, checking = false;
  let update=null,updateBusy=false,updatePoll=0;
  const button = (action, text, attrs = '') => ctx.btn(action, text, 'small', attrs);
  const command = (key, value) => `<div class="connect-command"><textarea id="connect-cmd-${key}" aria-label="${esc(key === 'login' ? '飞书授权命令' : '设置命令')}" readonly rows="2">${esc(value)}</textarea>${button('connect-copy', '复制', `data-key="${key}"`)}</div>`;
  const aiInfo = () => ({
    off: ['未连接', '连接 AI 客户端，完成审稿与资料提炼。'],
    connecting: ['连接中', '正在连接这台电脑上的知稿连接器。'],
    reconnecting: ['正在恢复连接', '连接暂时中断，正在自动重试。'],
    offline: ['暂时无法连接', '正在自动重试。请确认 AI 客户端已接通知稿、浏览器允许本地网络访问；也可点击“重新连接”。'],
    waiting: ['网页已连接 · 等待 AI', '网页已接通本机连接器。请在 AI 客户端调用一次知稿状态工具；有些客户端会在空闲时断开。'],
    online: ['已连接', ctx.agent.clients.join('、')],
    'other-tab': ['其他页面已连接', '另一个知稿标签页或浏览器正在连接。关闭旧页面后，这里会自动接入。'],
  })[ctx.agent.state] || ['未连接', '连接 AI 客户端，完成审稿与资料提炼。'];

  function aiGuide() {
    return `<p>也可把本工作台网址发给能执行本机命令的 Agent，说“帮我接通知稿”，由它按<a href="./AGENT_SETUP.md" target="_blank" rel="noopener">接入说明</a>配置当前客户端。</p><ol class="connect-steps"><li>在电脑安装 Node.js，再打开 PowerShell。<a href="https://nodejs.org/zh-cn" target="_blank" rel="noopener">获取 Node.js ↗</a></li><li>复制并运行连接器安装命令。${command('connector', ctx.installCommand())}</li><li>在目标客户端重新加载知稿 MCP（必要时重启客户端），再点击“连接 AI”。浏览器询问本地网络访问时，选择允许。</li></ol>
      <p class="connect-note">模型在 AI 客户端中选择；审稿时保持工作台页面打开。</p>
      <details class="connect-more"><summary>其他客户端与 Mac</summary><p>支持 MCP 的客户端可手动添加 stdio 服务：命令填 <code>node</code>，参数填连接器的完整路径。</p><a href="./zhigao-connector.mjs" download="zhigao-connector.mjs">下载连接器</a><p>Mac：在终端运行以下命令，再重启客户端。</p>${command('mac', ctx.macCommand())}</details>
      <details class="connect-more"><summary>连接后仍无法使用</summary><p>客户端找不到知稿工具：重启客户端或重新加载 MCP。连接器未运行：重新执行安装命令。浏览器拦截本地网络：在网站设置中允许本地网络访问，再刷新页面。</p></details>
      <div class="connect-actions">${button('agent-on', ctx.agent.state === 'online' ? '重新连接' : '连接 AI')}${ctx.agent.state !== 'off' ? button('agent-off', '断开 AI') : ''}</div>`;
  }
  function feishuGuide() {
    const needsInstall = ['unknown', 'missing', 'config'].includes(feishu.state);
    return `<p>在电脑的 PowerShell 或终端中完成设置。</p>
      <details class="connect-more" ${needsInstall ? 'open' : ''}><summary>首次使用：安装与配置</summary><ol class="connect-steps"><li>安装飞书 CLI（需先安装 Node.js）。${command('install', FEISHU_COMMANDS.install)}</li><li>配置飞书应用，按终端提示完成；已有应用可直接绑定。${command('config', FEISHU_COMMANDS.config)}</li></ol><p>如果公司限制创建应用，请联系飞书管理员协助配置。</p></details>
      <ol class="connect-steps"><li>运行授权命令，在打开的飞书页面登录并确认。${command('login', FEISHU_COMMANDS.login)}</li><li>终端提示登录成功后，回到这里点击“检查连接”。</li></ol>
      <details class="connect-more"><summary>已登录，仍不能同步</summary><p>提示缺少权限：重新运行授权命令；若应用权限未开通，请管理员在飞书应用后台开通。表格打不开：请所有者给当前账号查看或编辑权限。知稿支持飞书电子表格及其知识库链接。</p><p>更换电脑或登录过期时，重新完成登录即可。</p></details>
      <p class="connect-note">暂不接入也可在飞书同步页粘贴表格，后续再连接。</p>`;
  }
  function row(key, title, label, description, action, guide) {
    const open = expanded === key;
    return `<section class="connect-row" data-connection="${key}"><div class="connect-row-head"><div class="connect-copy"><h3>${title}<span class="connect-status" data-status="${key}" role="status">${esc(label)}</span></h3><p>${esc(description)}</p></div><div class="connect-actions">${action}${button('connect-expand', open ? '收起' : '设置', `data-section="${key}" aria-expanded="${open}" aria-controls="connect-guide-${key}"`)}</div></div><div id="connect-guide-${key}" class="connect-guide" ${open ? '' : 'hidden'}>${guide}</div></section>`;
  }
  function updatePanel() {
    if(!update)return '';
    const labels={checking:'正在检查版本…',available:'有新版连接器可用。',current:'连接器已是最新版本。',waiting_for_idle:'正在处理任务，完成后自动更新。',downloading:'正在下载并校验更新…',updating_elsewhere:'本机另一个客户端正在更新…',offline:'未检测到本机连接器。请启动后再检查；首次使用需安装一次。',waking:'正在等待本机连接器启动…',legacy:'此旧版还没有网页更新能力，需要先安装一次新版。',origin:'当前网址未获本机连接器允许，请从正式知稿网址打开。',network_error:'无法获取最新版本，请检查网络后重试。',error:'检查或更新未完成，现有版本继续可用。'};
    const runtimeOld=update.installedVersion&&update.runningVersion&&newer(update.installedVersion,update.runningVersion);
    let message=labels[update.state]||'检查尚未完成。';
    if(update.state==='current'&&runtimeOld)message='新版已安装，运行中的旧连接正在等待切换。';
    if(['UPDATE_INTEGRITY','UPDATE_SYNTAX'].includes(update.error))message='更新文件未通过校验，已保留现有版本。稍后重试。';
    const available=update.state==='available'&&newer(update.latestVersion,update.installedVersion);
    return `<section class="connect-update" aria-live="polite" aria-label="更新检查结果"><p data-update-status>${esc(message)}</p><p class="connect-note">网页 ${WEB_VERSION} · 本机连接器 ${esc(update.installedVersion||'未读取')} · 最新 ${esc(update.latestVersion||'未获取')}${runtimeOld||(!update.installedVersion&&update.runningVersion)?` · 正在运行 ${esc(update.runningVersion)}`:''}</p><div class="connect-actions">${available?button('connect-update-apply','更新连接器',updateBusy?'disabled':''):''}${['offline','waking'].includes(update.state)?button('connect-update-wake','启动连接器',update.state==='waking'?'disabled':''):''}${['offline','legacy'].includes(update.state)?button('connect-expand','安装 / 升级','data-section="ai"'):''}${update.webUpdate?button('connect-update-refresh','刷新网页'):''}</div><p class="connect-note">启动后检查一次，运行期间每 6 小时检查；网络失败后 15 分钟重试。有新版时在任务空闲后更新。</p></section>`;
  }
  function body() {
    const p = ctx.project(), folder = ctx.folder(p.id), folderState = ctx.folderState(p.id), [aiLabel, aiDesc] = aiInfo();
    const issue = feishu.code ? feishuIssue(feishu.code) : null;
    const fsLabel = checking ? '检查中…' : feishu.state === 'ready' ? '已登录' : issue?.[1] || '未检查';
    const fsDesc = feishu.state === 'ready' ? '飞书账号已就绪，关联表格后即可读取与同步。' : issue?.[2] || '连接飞书账号，读取表格并同步审稿进度。';
    const folderLabel = !folderSupported() ? '使用下载' : folderState === 'granted' ? '已关联' : folder ? '待授权' : '未设置';
    const folderDesc = folder ? folder.name : '按当前品牌保存原件、标红稿和意见单。';
    return `<div class="connect-intro-row"><p class="connect-intro">按需连接，用到时再设置。</p>${button('connect-update-check',updateBusy?(update?.state==='downloading'?'更新中…':'检查中…'):'检查更新',updateBusy?'disabled':'')}</div>` +updatePanel()+
      row('ai', 'AI 审稿', aiLabel, aiDesc, ['off','offline','reconnecting','waiting'].includes(ctx.agent.state) ? button('agent-on',ctx.agent.state==='off'?'连接 AI':'重新连接') : '', aiGuide()) +
      row('feishu', '飞书同步', fsLabel, fsDesc, button('connect-check', checking ? '检查中…' : '检查连接', checking ? 'disabled' : ''), feishuGuide() + (['connector','update','origin'].includes(feishu.state) ? button('connect-expand', '设置连接器', 'data-section="ai"') : '')) +
      row('folder', '本地归档', folderLabel, folderDesc, folderSupported() && p.id ? button(folder && folderState !== 'granted' ? 'connect-folder-grant' : 'connect-folder-pick', folder ? folderState === 'granted' ? '更换文件夹' : '授权文件夹' : '选择文件夹', `data-pid="${esc(p.id)}"`) : '', `<p>为“${esc(p.name)}”选择一个文件夹，并在浏览器提示中允许保存。审稿完成后会自动归档。</p><p>浏览器再次询问时，点击“授权文件夹”。暂不设置时，可从稿件列表导出文件。</p><p>本地归档请使用桌面版 Edge 或 Chrome；其他浏览器可下载导出文件。</p>`) +
      `<details class="connect-more connect-basics"><summary>其他功能怎么使用</summary><p>上传稿件、品牌资料、口径、批注和导出文件，直接在工作台操作。AI 审稿和反馈提取需要连接 AI；飞书提炼还需登录飞书。</p><p>Word、Excel 和文字稿可审核并导出修改稿；图片、PDF、扫描页和视频可由具备相应看图、听审能力的 AI 审核，输出意见，原件保持不变。视频首次使用需准备本机媒体组件。</p><p>使用 AI：上传稿件 → 复制审稿提示词 → 粘贴到已连接的客户端 → 返回工作台查看结果。</p></details>`;
  }
  function refresh() {
    const host = document.querySelector('#connections-body');
    if (!host) return;
    const focused = document.activeElement, selection = getSelection();
    if (focused?.tagName === 'TEXTAREA' && host.contains(focused) || selection && !selection.isCollapsed && host.contains(selection.anchorNode)) return;
    const key = focused?.dataset?.key, action = focused?.dataset?.action, section = focused?.dataset?.section;
    const opened = [...host.querySelectorAll('details')].map(d => d.getClientRects().length ? d.open : null), scroll = host.parentElement.scrollTop;
    host.innerHTML = body();
    host.querySelectorAll('details').forEach((d,i) => { if (opened[i] != null) d.open = opened[i]; });
    if (action) [...host.querySelectorAll('[data-action]')].find(b => b.dataset.action === action && b.dataset.key === key && b.dataset.section === section)?.focus({preventScroll:true});
    host.parentElement.scrollTop = scroll;
  }
  function open(section = '') {
    expanded = section;
    ctx.modal('连接与授权', `<div id="connections-body">${body()}</div>`, ctx.btn('close-modal', '完成', 'primary'));
  }
  async function check() {
    if (checking) return;
    checking = true; refresh();
    try { feishu = await ctx.checkFeishu(); }
    catch (e) { const issue = feishuIssue(e.code); feishu = {state:issue[0], code:e.code || 'FEISHU_NETWORK'}; }
    finally { checking = false; refresh(); }
  }
  async function checkVersion() {
    if(updateBusy)return;updateBusy=true;update={...update,state:'checking'};refresh();
    try{update=await checkUpdates();}catch{update={...update,state:'error'};}
    finally{updateBusy=false;refresh();}
  }
  function mergeUpdate(next) {
    const latest=newer(update?.latestVersion,next.latestVersion)?update.latestVersion:next.latestVersion;
    update={...update,...next,latestVersion:latest};
    if(update.state==='current'&&newer(latest,update.installedVersion))update.state='available';
  }
  async function watchUpdate(token,attempt=0) {
    if(token!==updatePoll||!document.querySelector('#connections-body')||attempt>=40)return;
    try{
      const next=await localUpdate();mergeUpdate(next);refresh();
      if(!['waiting_for_idle','downloading','updating_elsewhere'].includes(next.state)&&!(next.state==='current'&&newer(next.installedVersion,next.runningVersion)))return;
    }catch{}
    setTimeout(()=>watchUpdate(token,attempt+1),1500);
  }
  function showIssue(e) {
    if (!/^(FEISHU_|CONNECTOR_)/.test(e.code || '')) return false;
    feishu = {state:feishuIssue(e.code)[0], code:e.code}; open('feishu'); return true;
  }
  async function handle(action, b) {
    if (!action?.startsWith('connect-')) return false;
    if (action === 'connect-open') open(b.dataset.section || '');
    if (action === 'connect-expand') { expanded = expanded === b.dataset.section ? '' : b.dataset.section; refresh(); }
    if (action === 'connect-check') await check();
    if(action==='connect-update-check')await checkVersion();
    if(action==='connect-update-apply'){
      if(updateBusy)return true;updateBusy=true;update={...update,state:'downloading'};refresh();
      try{mergeUpdate(await localUpdate('apply'));}catch{update={...update,state:'error'};}
      finally{updateBusy=false;refresh();}
      if(['waiting_for_idle','downloading','updating_elsewhere'].includes(update.state)||(update.state==='current'&&newer(update.installedVersion,update.runningVersion)))watchUpdate(++updatePoll);
    }
    if(action==='connect-update-wake'){
      update={...update,state:'waking'};refresh();location.href='zhigao-desk://check-updates';
      const token=++updatePoll;
      const poll=async n=>{if(token!==updatePoll||!document.querySelector('#connections-body'))return;try{const status=await localUpdate();update={...update,...status};await checkVersion();return;}catch{}if(n<10)setTimeout(()=>poll(n+1),1500);else{update={...update,state:'offline'};refresh();}};
      setTimeout(()=>poll(0),1500);
    }
    if(action==='connect-update-refresh')location.reload();
    if (action === 'connect-copy') {
      const field = document.getElementById('connect-cmd-' + b.dataset.key);
      try { await navigator.clipboard.writeText(field.value); ctx.toast('已复制，在终端粘贴并运行。'); }
      catch { field.focus(); field.select(); ctx.toast('请复制已选中的命令。'); }
    }
    if (action === 'connect-folder-pick' || action === 'connect-folder-grant') { await ctx.folderAction(action.endsWith('pick') ? 'folder-pick' : 'folder-grant', b); refresh(); }
    return true;
  }
  function updateFeishu(status) {
    if (!status || !['ready','missing','config','auth','scope','access','error'].includes(status.state)) return;
    feishu = {state:status.state, ...(status.code ? {code:status.code} : {})}; refresh();
  }
  return {open, refresh, handle, showIssue, updateFeishu};
}

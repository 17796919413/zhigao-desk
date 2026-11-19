// 接入引导：状态来自实际连接或显式检查，教程按需展开。
import {folderSupported} from './folder.js';
import {WEB_VERSION,newer,checkUpdates,localUpdate} from './connector-updates.js';
import {connectionPrompt,verifiedConnection} from './connection-status.js';

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
    CONNECTOR_OFFLINE: ['connector', '网页未连到连接器', '检查客户端是否已启动，以及此网页是否获准访问本地网络。'],
    CONNECTOR_ORIGIN: ['origin', '当前网址未接入', '请从正式工作台打开；本地部署需配置连接器的网页来源。'],
    CONNECTOR_UPDATE: ['update', '连接器待更新', '点击上方“检查更新”，核对本机连接器版本。'],
  })[code] || ['error', '检查未完成', '确认网络可用后，重新检查。'];
}

export function createConnections(ctx) {
  const esc = ctx.esc;
  let expanded = '', feishu = {state: 'unknown'}, checking = false;
  let checkedAt=0,checkGeneration=0;
  let update=null,updateBusy=false,updatePoll=0;
  const button = (action, text, attrs = '') => ctx.btn(action, text, 'small', attrs);
  const command = (key, value) => `<div class="connect-command"><textarea id="connect-cmd-${key}" aria-label="${esc(key === 'login' ? '飞书授权命令' : '设置命令')}" readonly rows="2">${esc(value)}</textarea>${button('connect-copy', '复制', `data-key="${key}"`)}</div>`;
  const aiInfo = () => ({
    off: ['未连接', '复制接入指令，发给你的 AI。'],
    connecting: ['连接中', ''],
    reconnecting: ['正在重连', '正在重试网页与本机连接器的通信。'],
    offline: [ctx.agent.lastConfirmedAt?'连接已中断':'网页未连到连接器', '请检查本机连接器后点击重新连接。'],
    waiting: ctx.agent.lastConfirmedAt?['AI 会话未连接','网页与连接器正常。请打开 AI 客户端。']:['等待 AI', '把接入指令发给你的 AI。'],
    online: verifiedConnection(ctx.agent,ctx.project().id) ? ['AI 已连接', ctx.agent.verification.client+' · 客户端连接，不代表某段对话已接手稿件。'] : ['等待接入', '把接入指令发给你的 AI。'],
    'other-tab': ['其他页面已连接', '另一页面正在连接。空闲时可切换到此浏览器。'],
  })[ctx.agent.state] || ['未连接', '连接 AI 客户端，完成审稿与资料提炼。'];

  function aiGuide() {
    return `<div class="connect-actions">${button('agent-on', ctx.agent.state === 'online' ? '重新连接' : '连接 AI')}${ctx.agent.state !== 'off' ? button('agent-off', '断开 AI') : ''}</div>`;
  }
  function invitation(p){
    const prompt=connectionPrompt(location.href,p);
    return update?.state==='legacy'?'当前客户端的知稿连接器过旧，不支持网页升级。先按正式站更新清单升级当前客户端的连接器，校验文件并确认运行版本；不要改其他客户端配置。然后按下文验证原网页。\n'+prompt:prompt;
  }
  function feishuGuide() {
    const needsInstall = ['unknown', 'missing', 'config'].includes(feishu.state);
    return `<p>按提示登录飞书即可。</p><details><summary>手动设置方式</summary><p>在电脑的 PowerShell 或终端中完成设置。</p>
      <details class="connect-more" ${needsInstall ? 'open' : ''}><summary>首次使用：安装与配置</summary><ol class="connect-steps"><li>安装飞书 CLI（需先安装 Node.js）。${command('install', FEISHU_COMMANDS.install)}</li><li>配置飞书应用，按终端提示完成；已有应用可直接绑定。${command('config', FEISHU_COMMANDS.config)}</li></ol><p>如果公司限制创建应用，请联系飞书管理员协助配置。</p></details>
      <ol class="connect-steps"><li>运行授权命令，在打开的飞书页面登录并确认。${command('login', FEISHU_COMMANDS.login)}</li><li>终端提示登录成功后，回到这里点击“检查连接”。</li></ol>
      <details class="connect-more"><summary>已登录，仍不能同步</summary><p>提示缺少权限：重新运行授权命令；若应用权限未开通，请管理员在飞书应用后台开通。表格打不开：请所有者给当前账号查看或编辑权限。知稿支持飞书电子表格及其知识库链接。</p><p>更换电脑或登录过期时，重新完成登录即可。</p></details>
      </details>`;
  }
  function row(key, title, label, description, action, guide) {
    const open = expanded === key;
    return `<section class="connect-row" data-connection="${key}"><div class="connect-row-head"><div class="connect-copy"><h3>${title}<span class="connect-status" data-status="${key}" role="status">${esc(label)}</span></h3>${description?`<p>${esc(description)}</p>`:''}</div><div class="connect-actions">${action}${button('connect-expand', open ? '收起' : '设置', `data-section="${key}" aria-expanded="${open}" aria-controls="connect-guide-${key}"`)}</div></div><div id="connect-guide-${key}" class="connect-guide" ${open ? '' : 'hidden'}>${guide}</div></section>`;
  }
  function updatePanel() {
    if(!update)return '';
    const labels={checking:'正在检查版本…',available:'有新版连接器可用。',current:'连接器已是最新版本。',waiting_for_idle:'正在处理任务，完成后自动更新。',downloading:'正在更新…',updating_elsewhere:'本机另一个客户端正在更新…',offline:'未能读取本机版本。请打开 AI 客户端，将上方接入指令发给它。',legacy:'当前连接器不支持网页升级。请将上方接入指令发给 AI 完成升级。',origin:'当前网址未获本机连接器允许，请从正式知稿网址打开。',network_error:'无法获取最新版本，请检查网络后重试。',error:'未能确认更新结果，请重新检查。'};
    const runtimeOld=update.installedVersion&&update.runningVersion&&newer(update.installedVersion,update.runningVersion);
    let message=labels[update.state]||'检查尚未完成。';
    if(update.state==='current'&&runtimeOld)message='新版已安装，运行中的旧连接正在等待切换。';
    else if(update.state==='current'&&(!update.remoteChecked||!update.latestVersion||update.installedVersion!==update.latestVersion||update.runningVersion!==update.latestVersion))message='未能确认正在运行的版本，请重新检查。';
    if(['UPDATE_INTEGRITY','UPDATE_SYNTAX'].includes(update.error))message='更新文件未通过校验，已保留现有版本。稍后重试。';
    const available=update.state==='available'&&newer(update.latestVersion,update.installedVersion);
    return `<section class="connect-update" aria-live="polite" aria-label="更新检查结果"><p data-update-status>${esc(message)}</p><p class="connect-note">网页 ${WEB_VERSION} · 本机连接器 ${esc(update.installedVersion||'未读取')} · 最新 ${esc(update.latestVersion||'未获取')}${runtimeOld||(!update.installedVersion&&update.runningVersion)?` · 正在运行 ${esc(update.runningVersion)}`:''}</p><div class="connect-actions">${available?button('connect-update-apply','升级到 '+esc(update.latestVersion),updateBusy?'disabled':''):''}${update.webUpdate?button('connect-update-refresh','刷新网页'):''}</div></section>`;
  }
  function body() {
    const p = ctx.project(), folder = ctx.folder(p.id), folderState = ctx.folderState(p.id), [aiLabel, aiDesc] = aiInfo();
    const issue = feishu.code ? feishuIssue(feishu.code) : null;
    const fsLabel = checking ? '检查中…' : feishu.state === 'ready' ? '已登录' : issue?.[1] || '未检查';
    const fsDesc = checking || feishu.state === 'ready' ? '' : issue?.[2] || '登录后可读取和同步审核表。';
    const folderLabel = !folderSupported() ? '使用下载' : folderState === 'granted' ? '已关联' : folder ? '待授权' : '未设置';
    const folderDesc = folder ? folder.name : '选择文件夹，自动保存审稿文件。';
    return `<section class="connect-start" aria-label="让 AI 帮你接入"><p>复制指令，发给你正在使用的 AI。</p><div class="connect-actions">${ctx.btn('connect-copy-invitation','复制接入指令','primary')}</div><details class="connect-more"><summary>查看接入指令</summary><textarea id="connect-invitation" aria-label="接入指令" readonly rows="7">${esc(invitation(p))}</textarea></details></section><div class="connect-intro-row"><p class="connect-intro">当前品牌：${esc(p.name||'未选择')}</p>${button('connect-update-check',updateBusy?(update?.state==='downloading'?'更新中…':'检查中…'):'检查更新',updateBusy?'disabled':'')}</div>` +updatePanel()+
      row('ai', 'AI 审稿', aiLabel, [aiDesc,ctx.agent.lastConfirmedAt?'上次确认：'+new Date(ctx.agent.lastConfirmedAt).toLocaleTimeString('zh-CN',{hour12:false}):''].filter(Boolean).join(' · '), ctx.agent.state==='other-tab'?button('agent-on','在此浏览器接入'):['off','offline','reconnecting','waiting'].includes(ctx.agent.state) ? button('agent-on',ctx.agent.state==='off'?'连接 AI':'重新连接') : '', aiGuide()) +
      row('feishu', '飞书同步', fsLabel, fsDesc, button('connect-check', checking ? '检查中…' : '检查连接', checking ? 'disabled' : ''), feishuGuide() + (['connector','update','origin'].includes(feishu.state) ? button('connect-expand', '设置连接器', 'data-section="ai"') : '')) +
      row('folder', '本地归档', folderLabel, folderDesc, folderSupported() && p.id ? button(folder && folderState !== 'granted' ? 'connect-folder-grant' : 'connect-folder-pick', folder ? folderState === 'granted' ? '更换文件夹' : '授权文件夹' : '选择文件夹', `data-pid="${esc(p.id)}"`) : '', `<p>选择文件夹并允许保存。未设置时，可直接下载审稿文件。</p>`) +
      '';
  }
  function refresh() {
    const host = document.querySelector('#connections-body');
    if (!host) return;
    const focused = document.activeElement, selection = getSelection();
    if (focused?.tagName === 'TEXTAREA' && host.contains(focused) || selection && !selection.isCollapsed && host.contains(selection.anchorNode)) {
      // Keep the selected instruction intact, but do not freeze unrelated status rows.
      const fresh=document.createElement('template');fresh.innerHTML=body();
      for(const selector of ['.connect-update',...['ai','feishu','folder'].map(k=>`[data-connection="${k}"] .connect-row-head`)]){
        const old=host.querySelector(selector),next=fresh.content.querySelector(selector);
        if(old&&next&&!old.contains(focused)&&!old.contains(selection?.anchorNode)&&old.innerHTML!==next.innerHTML)old.replaceWith(next);
      }
      return;
    }
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
    autoCheck();
  }
  async function check() {
    if (checking) return;
    checking = true;const generation=++checkGeneration;checkedAt=Date.now();refresh();
    try { const result=await ctx.checkFeishu();if(generation===checkGeneration)feishu=result; }
    catch (e) { if(generation===checkGeneration){const issue = feishuIssue(e.code); feishu = {state:issue[0], code:e.code || 'FEISHU_NETWORK'};} }
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
    if (action === 'connect-task-feishu') await ctx.prepareTask({operation:'feishu_read',projectId:ctx.project().id});
    if(action==='connect-update-check')await checkVersion();
    if(action==='connect-update-apply'){
      if(updateBusy)return true;updateBusy=true;update={...update,state:'downloading'};refresh();
      try{mergeUpdate(await localUpdate('apply'));}catch{update={...update,state:'error'};}
      finally{updateBusy=false;refresh();}
      if(['waiting_for_idle','downloading','updating_elsewhere'].includes(update.state)||(update.state==='current'&&newer(update.installedVersion,update.runningVersion)))watchUpdate(++updatePoll);
    }
    if(action==='connect-update-refresh')location.reload();
    if(action==='connect-copy-invitation'){
      const value=invitation(ctx.project());
      if(!['online','waiting'].includes(ctx.agent.state))void ctx.startAgent({takeOver:true});
      try{await navigator.clipboard.writeText(value);ctx.toast('已复制，粘贴到你的 AI 客户端并发送。');}
      catch{const field=document.getElementById('connect-invitation');field.closest('details').open=true;field.value=value;field.focus();field.select();ctx.toast('请复制已选中的接入指令，粘贴到你的 AI 客户端。');}
    }
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
    checkGeneration++;checkedAt=Date.now();
    feishu = {state:status.state, ...(status.code ? {code:status.code} : {})}; refresh();
  }
  let reachable=false;
  function autoCheck(force=false){
    if(reachable&&!document.hidden&&!checking&&(force||!checkedAt||Date.now()-checkedAt>=300000))void check();
  }
  function connectionChanged(){
    const now=['online','waiting'].includes(ctx.agent.state),recovered=now&&!reachable;reachable=now;
    if(recovered&&['offline','waking'].includes(update?.state)&&!updateBusy)void checkVersion();
    if(!now){checkGeneration++;checkedAt=0;feishu={state:'connector',code:'CONNECTOR_OFFLINE'};}
    autoCheck(recovered);
    refresh();
  }
  window.addEventListener('focus',()=>autoCheck());
  document.addEventListener('visibilitychange',()=>autoCheck());
  return {open, refresh, connectionChanged, handle, showIssue, updateFeishu};
}

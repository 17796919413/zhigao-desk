export function createTaskPanel(ctx) {
  let task = null, busy = false, polling = 0;
  const running = () => task && ['preparing', 'verifying', 'resuming', 'cancelling'].includes(task.state);
  const labels = {awaiting_confirmation: '需要准备', preparing: '正在准备', verifying: '正在检查', ready: '可以继续', waiting_for_user: '待你操作', resuming: '正在继续', continued: '已继续', declined: '暂不准备', cancelling: '正在停止', cancelled: '已停止', failed: '准备未完成', interrupted: '准备中断', uncertain: '结果待确认'};
  async function request(action, args) {
    const r = await fetch('http://127.0.0.1:47821/page/tasks', {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify({action, args}), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000)});
    const value = await r.json(); if (!r.ok || !value.ok) throw Error(value.error || '请连接本机 AI 后重试。'); return value.data;
  }
  function body() {
    const esc = ctx.esc;
    const errors={CONVERSION_CHECKPOINT_UNSAVED:'处理结果未保存，请检查磁盘空间后继续。',ENOSPC:'磁盘空间不足，请清理后继续。',EACCES:'无法保存，请检查文件夹权限。',EPERM:'无法保存，请检查文件夹权限。',EBUSY:'文件被占用，请关闭相关程序后继续。'};
    const message=task.confirmation?.message || (task.recovery?.requiresRestart?'请重启电脑后继续。':errors[task.error?.code]||(task.state==='uncertain'?'请先查看稿件的处理结果。':task.error?.message||task.userAction?.message||''));
    const notes=[...new Set(task.requirements.filter(r=>r.state!=='ready').map(r=>r.message||r.userAction?.message||'').filter(s=>s&&!message.includes(s)))];
    return `<div id="task-preparation-panel" aria-live="polite"><p class="connect-intro">${esc(labels[task.state] || '检查条件')}</p>${message?`<p>${esc(message)}</p>`:''}${notes.map(s=>`<p class="connect-note">${esc(s)}</p>`).join('')}${task.userAction?.url ? `<p><a href="${esc(task.userAction.url)}" target="_blank" rel="noopener">打开授权页面 ↗</a></p>` : ''}${task.userAction?.image ? `<img src="data:image/png;base64,${task.userAction.image}" alt="当前授权二维码" style="max-width:220px;width:100%">` : ''}${task.progress?.received ? `<p>已下载 ${Math.round(task.progress.received / 1024 / 1024)} MB${task.progress.total ? ' / ' + Math.ceil(task.progress.total / 1024 / 1024) + ' MB' : ''}</p>` : ''}</div>`;
  }
  function show() {
    if (!task) return;
    const b = ctx.btn, disabled = busy ? 'disabled' : '';
    let actions = b('close-modal', '关闭');
    if (task.state === 'awaiting_confirmation') actions += b('task-decline', '暂不准备', '', disabled) + b('task-approve', '准备并继续', 'primary', disabled);
    if (['interrupted','uncertain'].includes(task.state)) actions += b('task-recover','检查进度','',disabled);
    if (['ready', 'waiting_for_user', 'failed', 'interrupted'].includes(task.state)) actions += b('task-resume', task.state === 'waiting_for_user' ? '已完成，继续' : '继续', 'primary', disabled);
    if (['preparing', 'verifying', 'resuming'].includes(task.state)) actions += b('task-cancel', '停止', '', disabled);
    const panel = document.querySelector('#task-preparation-panel');
    if (panel) {
      const dialog = panel.closest('.modal'), focused = document.activeElement?.dataset?.action;
      panel.outerHTML = body();
      const footer = dialog.querySelector('.modal-footer');
      if (footer && footer.innerHTML !== actions) {
        footer.innerHTML = actions;
        if (focused) dialog.querySelector(`[data-action="${focused}"]:not(:disabled)`)?.focus({preventScroll:true});
      }
    } else ctx.modal('准备任务条件', body(), actions);
  }
  async function watch(token) {
    if (token !== polling || !document.querySelector('#task-preparation-panel') || !task) return;
    const id = task.taskId, panel = document.querySelector('#task-preparation-panel');
    try {
      const next = await request('status', {taskId: id});
      if (token !== polling || task?.taskId !== id || document.querySelector('#task-preparation-panel') !== panel) return;
      task = next; show();
    } catch (e) { if (token === polling && document.querySelector('#task-preparation-panel')) ctx.toast(e.message); return; }
    if (running()) setTimeout(() => watch(token), 1500);
  }
  async function open(args) {
    if (busy) return; busy = true; task = null; const token = ++polling;
    try { await ctx.connect(); let next = await request('plan', args); if(next.state==='ready')next=await request('resume',{taskId:next.taskId});if(token === polling) task = next; }
    finally { busy = false; if (token === polling && task) show(); }
    if (token === polling && running()) setTimeout(() => watch(token), 500);
  }
  async function handle(action) {
    if (action === 'close-modal') { polling++; return false; }
    if (!['task-approve', 'task-decline', 'task-resume', 'task-cancel', 'task-recover'].includes(action)) return false;
    if (busy || !task) return true;
    busy = true; const token = ++polling; show();
    try {
      const next = await request(action === 'task-recover' ? 'recover' : action === 'task-resume' ? 'resume' : action === 'task-cancel' ? 'cancel' : 'confirm', {taskId: task.taskId, ...(action === 'task-approve' || action === 'task-decline' ? {revision: task.revision, decision: action === 'task-approve' ? 'approve' : 'decline'} : {})});
      if (token === polling && document.querySelector('#task-preparation-panel')) task = next;
    } finally { busy = false; if (token === polling && document.querySelector('#task-preparation-panel')) show(); }
    if (token === polling && running()) setTimeout(() => watch(token), 500);
    return true;
  }
  return {open, handle};
}

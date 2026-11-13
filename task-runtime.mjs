// Persistent capability plans. This module is embedded in the standalone connector at build time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message) => Object.assign(Error(message), {code});
const idPattern = /^[a-f0-9-]{36}$/;
const runningStates = new Set(['preparing', 'verifying', 'resuming', 'cancelling']);
function originalIdentity(call){
 const name=call.name==='zhigao_reopen_review'?'zhigao_get_review_brief':call.name;
 const args=Object.entries(call.args||{}).filter(([key])=>!['retry','rereview','batchId'].includes(key)).sort(([a],[b])=>a.localeCompare(b));
 return hash([name,args]);
}
function sameOperation(a,b){return a.originalCall&&b.originalCall?originalIdentity(a.originalCall)===originalIdentity(b.originalCall):hash(a)===hash(b);}
function sameOriginal(a,b){return a?.operationFingerprint&&b?.operationFingerprint?a.operationFingerprint===b.operationFingerprint:a?.fingerprint===b?.fingerprint;}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const messages = {
  ENOSPC: '本机空间不足。释放空间后重新检查；原任务与已验证组件保留。',
  EACCES: '当前用户无法写入知稿私有目录，请检查目录权限。',
  EPERM: '系统阻止了本次准备，请检查目录权限或安全软件提示。',
  NETWORK: '下载或服务连接中断，请恢复网络或代理后重新检查。',
  INTEGRITY: '下载文件校验未通过，未启用该组件。',
  PREPARATION_BUSY: '本机已有准备任务，请等待它结束后继续。',
  TASK_CHANGED: '原任务、品牌、原件或环境已经变化，请重新检查并确认新方案。',
  TASK_UNCERTAIN: '上一步结果尚未确认，请核对原任务状态；不会自动重复执行。',
  MEDIA_PREPARATION_FAILED: '视频准备未完成。核对原视频状态后，用 prepare_video_review 或 prepare_library_assets 的 retry:true 续办同一原件；不能计为已审。',
  CONVERSION_FAILED: '原件转换未完成，已保留原件和作业。请核对文件是否损坏、加密或包含不支持对象，以及转换器状态。',
  CONVERSION_CHECKPOINT_UNSAVED: '转换结果已保留，但检查点尚未保存。恢复本机存储后调用 recover_task；续办会先核对已有输出，不会重复转换。',
  PAGE_SESSION_CHANGED: '页面已刷新或切换，已保留准备进度。恢复原品牌连接后继续同一任务。',
  PAGE_UNRESPONSIVE: '暂时无法确认工作台响应。连接恢复后继续同一任务，已完成的准备会复用。',
  PROCESS_TIMEOUT: '本机组件超时，子进程结果尚未确认。准备锁已保留，请核对中断状态后恢复；不会自动重复安装。',
  PREPARATION_TRANSPORT: '准备阶段连接中断，已保留作业。恢复原品牌连接后调用 recover_task 核对并续办。',
};
export function taskError(e) {
  const code = typeof e?.code === 'string' && /^[A-Z_0-9]{1,60}$/.test(e.code) ? e.code : 'PREPARATION_FAILED';
  return {code, message: messages[code] || (e?.publicMessage || '准备未完成。请检查该渠道状态后重新检测；原任务已保留。')};
}

export function createTaskRuntime({root, version, inspect, prepare, verify, resume, userAction, now = Date.now, bootTime = () => Date.now() - os.uptime()*1000}) {
  const jobs = path.join(root, 'tasks'), writer = path.join(root, 'preparation.lock');
  const operations = new Map(), resumptions = new Map(), unsaved = new Map();
  function save(p) {
    fs.mkdirSync(jobs, {recursive: true});
    p.updatedAt = now();
    const file = path.join(jobs, p.id + '.json'), tmp = file + '.' + crypto.randomUUID() + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(p), {flag: 'wx', mode: 0o600}); fs.renameSync(tmp, file); unsaved.delete(p.id); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
    return p;
  }
  function read(id) {
    if (!idPattern.test(id || '')) throw fail('TASK_NOT_FOUND', '准备任务标识无效。');
    if(unsaved.has(id))return structuredClone(unsaved.get(id));
    let p; try { p = JSON.parse(fs.readFileSync(path.join(jobs, id + '.json'), 'utf8')); }
    catch { throw fail('TASK_NOT_FOUND', '准备任务不存在或记录不可读，请从原任务重新检查。'); }
    if (p.id !== id || p.schema !== 1 || !p.request) throw fail('TASK_NOT_FOUND', '准备任务记录不完整。');
    if (runningStates.has(p.state) && !operations.has(p.id) && !alive(p.pid)) {
      p.state = p.stage === 'resume' ? 'uncertain' : 'interrupted';
      p.error = taskError(fail('TASK_UNCERTAIN')); save(p);
    }
    return p;
  }
  function view(p) {
    const unknownOriginal=p.state==='uncertain'&&p.resumeCheckpoint==='original';
    return {taskId: p.id, revision: p.revision, state: p.state, stage: p.stage,
      operation: p.request.operation, binding: p.binding, requirements: p.requirements,
      confirmation: p.state === 'awaiting_confirmation' ? {planId: p.id, revision: p.revision, expiresAt: p.expiresAt,
        message: p.requirements.filter(r => r.state === 'needs_confirmation').map(r => r.message).join(' '),
        scope: '仅准备本任务所需渠道；不包含云端业务写入、采纳、通过或外发。'} : null,
      ...(p.error ? {error: unknownOriginal?{...p.error,message:'原任务调用已发出，但结果尚未确认。请核对已保存的稿件与审稿进度；停止后续步骤不会撤销已执行的操作，不会自动重做。'}:p.error} : {}), ...(p.result ? {result: p.result} : {}),
      ...(p.userAction ? {userAction: p.userAction} : {}),
      cancelRequested: !!p.cancelRequested, createdAt: p.createdAt, updatedAt: p.updatedAt,
      ...(p.progress ? {progress: p.progress} : {}),
      next: runningStates.has(p.state) ? {tool: 'zhigao_task_status', args: {taskId: p.id}}
        : p.state === 'awaiting_confirmation' ? {tool: 'zhigao_confirm_task', args: {taskId: p.id, revision: p.revision, decision: 'approve'}, requiresUserReply: true}
        : ['ready', 'waiting_for_user', 'failed', 'interrupted'].includes(p.state) ? {tool: 'zhigao_resume_task', args: {taskId: p.id}}
        : p.state === 'continued' ? p.continuation : p.state==='uncertain'?{tool:'zhigao_status',args:{},requiresUserReview:true,message:'先核对原步骤的已保存结果与进程；不要新建同任务绕过未确认结果。'}:{tool: 'zhigao_plan_task', args: p.request},
      taskComplete: false};
  }
  function signature(report) { return hash({binding: report.binding, environment: report.environment, version}); }
  function guardsChanged(p,report){return Object.entries(p.guards||{}).some(([key,value])=>report.guards?.[key]!==value);}
  function requirementsSignature(requirements) {
    return hash(requirements.filter(r => r.state !== 'ready').map(({id, state, action, fingerprint}) => ({id, state, action, fingerprint})));
  }
  function applyReport(p, report) {
    p.version=version;
    p.binding = report.binding; p.environment = report.environment; p.signature = signature(report);
    p.guards = report.guards || {};
    p.requirements = report.requirements; p.planSignature = requirementsSignature(report.requirements);
    p.revision = crypto.randomUUID(); p.expiresAt = now() + 30 * 60 * 1000;
    p.state = report.requirements.some(r => r.state === 'needs_confirmation') ? 'awaiting_confirmation'
      : report.requirements.some(r => r.state !== 'ready') ? 'waiting_for_user' : 'ready';
    p.userAction = report.requirements.find(r => r.state !== 'ready' && r.state !== 'needs_confirmation')?.userAction;
    delete p.error; delete p.result; delete p.continuation; delete p.consent;
    p.cancelRequested = false; p.stage = 'checked'; return save(p);
  }
  async function plan(request) {
    if (!request || !['review', 'library', 'office', 'feishu_read', 'feishu_sync', 'archive', 'connection'].includes(request.operation))
      throw fail('INVALID_TASK', '请选择支持的原任务类型。');
    // Only identifiers/capability declarations enter the journal, never manuscript text or arbitrary commands.
    const safe = {operation: request.operation};
    if (request.mediaModel !== undefined) {
      if (!['large-v3-turbo','large-v3','medium','small','tiny'].includes(request.mediaModel)) throw fail('INVALID_TASK', '转写模型无效。');
      safe.mediaModel = request.mediaModel;
    }
    if(request.originalCall){
      const allowed={zhigao_get_review_brief:['docId','batchId','retry','rereview'],zhigao_reopen_review:['docId','batchId'],zhigao_prepare_video_review:['docId','retry'],zhigao_prepare_library_assets:['libraryId','retry'],zhigao_extract_feishu:['url','title','createDocument'],zhigao_read_feishu_table:['url'],zhigao_prepare_feishu_sync:[]};
      const fields=allowed[request.originalCall.name];if(!fields)throw fail('INVALID_TASK','原任务入口无效。');
      const args={};for(const field of fields){const value=request.originalCall.args?.[field];if(value===undefined)continue;if(['retry','rereview','createDocument'].includes(field)){if(typeof value!=='boolean'||field==='createDocument'&&value)throw fail('INVALID_TASK');}else if(typeof value!=='string'||value.length>2000)throw fail('INVALID_TASK');args[field]=value;}
      const operation={zhigao_get_review_brief:'office',zhigao_reopen_review:'office',zhigao_prepare_video_review:'office',zhigao_prepare_library_assets:'library',zhigao_extract_feishu:'feishu_read',zhigao_read_feishu_table:'feishu_read',zhigao_prepare_feishu_sync:'feishu_sync'}[request.originalCall.name];
      if(request.operation!==operation)throw fail('INVALID_TASK','原调用与准备类型不一致。');
      for(const key of ['docId','libraryId'])if(args[key]!==request[key])throw fail('INVALID_TASK','原调用与准备对象不一致。');
      if(['zhigao_get_review_brief','zhigao_reopen_review','zhigao_prepare_video_review'].includes(request.originalCall.name)&&!args.docId)throw fail('INVALID_TASK','原调用缺少稿件标识。');
      safe.originalCall={name:request.originalCall.name,args};
    }
    for (const key of ['projectId', 'docId', 'libraryId']) if (request[key] !== undefined) {
      if (typeof request[key] !== 'string' || !request[key] || request[key].length > 200) throw fail('INVALID_TASK', '任务标识无效。');
      safe[key] = request[key];
    }
    if (request.clientCapabilities !== undefined) {
      safe.clientCapabilities = {};
      for (const key of ['images', 'audio', 'tools']) if (typeof request.clientCapabilities[key] === 'boolean') safe.clientCapabilities[key] = request.clientCapabilities[key];
    }
    const report = await inspect(safe);
    // Repeated checks reuse an active identical plan and do not extend its confirmation deadline.
    if (fs.existsSync(jobs)) for (const name of fs.readdirSync(jobs)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      let p; try { p = read(name.slice(0, -5)); } catch { continue; }
      if(p.binding?.projectId===report.binding?.projectId&&sameOperation(p.request,safe)
        &&(runningStates.has(p.state)||sameOriginal(p.binding,report.binding)&&['uncertain','interrupted'].includes(p.state)))return view(p);
      if(hash(p.request)===hash(safe)&&runningStates.has(p.state))return view(p);
      if(hash(p.request)===hash(safe)&&p.signature===signature(report)&&['uncertain','interrupted'].includes(p.state))return view(p);
      if (hash(p.request) === hash(safe) && p.signature === signature(report) && !guardsChanged(p,report) && p.planSignature === requirementsSignature(report.requirements)
        && p.version === version && p.expiresAt > now() && ['awaiting_confirmation', 'ready', 'waiting_for_user', ...runningStates].includes(p.state)) return view(p);
    }
    const p = {schema: 1, id: crypto.randomUUID(), version, request: safe, createdAt: now()};
    return view(applyReport(p, report));
  }
  function acquire(p) {
    fs.mkdirSync(root, {recursive: true});
    if (fs.existsSync(writer)) {
      let old; try { old = JSON.parse(fs.readFileSync(writer, 'utf8')); } catch { throw fail('PREPARATION_BUSY'); }
      // A crashed worker may have surviving installer children. Never reclaim this lock automatically.
      if (!alive(old.pid)) throw fail('TASK_UNCERTAIN');
      throw fail('PREPARATION_BUSY');
    }
    const fd = fs.openSync(writer, 'wx'), key = crypto.randomUUID();
    fs.writeFileSync(fd, JSON.stringify({pid: process.pid, taskId: p.id, key})); fs.closeSync(fd);
    return () => { try { if (JSON.parse(fs.readFileSync(writer, 'utf8')).key === key) fs.unlinkSync(writer); } catch {} };
  }
  function cancelled(id) { return read(id).cancelRequested; }
  async function run(id) {
    let p = read(id), release;
    try {
      release = acquire(p);
      for (const requirement of p.requirements.filter(r => r.state === 'needs_confirmation')) {
        p = read(id); if (p.cancelRequested) break;
        if (p.expiresAt <= now()) { applyReport(p, await inspect(p.request)); return; }
        p.stage = requirement.id; p.state = 'preparing'; save(p);
        const result = await prepare(requirement, p, update => {
          const current = read(id); current.progress = update; save(current);
        });
        p = read(id);
        if(p.cancelRequested){p.state='cancelled';save(p);return;}
        if (result?.userAction) { p.state = 'waiting_for_user'; p.userAction = result.userAction; save(p); return; }
      }
      p = read(id);
      if (p.cancelRequested) { p.state = 'cancelled'; save(p); return; }
      p.stage = 'verify'; p.state = 'verifying'; save(p);
      const report = await inspect(p.request);
      if (signature(report) !== p.signature || guardsChanged(p,report)) throw fail('TASK_CHANGED');
      const pending = report.requirements.filter(r => r.state !== 'ready');
      if (pending.length) { applyReport(p, report); return; }
      p.guards=report.guards||{};save(p);
      const proof = await verify(p);
      p = read(id); p.proof = proof;
      if (p.cancelRequested) { p.state = 'cancelled'; save(p); return; }
      p.state = 'verifying'; p.stage = 'verified'; save(p);
      await continueTask(p);
    } catch (e) { if(e.mayStillRun)release=null;p = read(id); p.state = e.code === 'TASK_CANCELLED' ? 'cancelled' : p.stage === 'resume' || e.code === 'TASK_UNCERTAIN' || e.mayStillRun ? 'uncertain' : 'failed'; p.error = taskError(e); save(p); }
    finally { release?.(); }
  }
  async function continueTask(p) {
    const fresh = await inspect(p.request);
    if (signature(fresh) !== p.signature || guardsChanged(p,fresh)) throw fail('TASK_CHANGED');
    if (fresh.requirements.some(r => r.state !== 'ready')) return applyReport(p, fresh);
    p = read(p.id); if (p.cancelRequested) { p.state = 'cancelled'; return save(p); }
    p.state = 'resuming'; p.stage = 'resume'; p.pid = process.pid; save(p);
    const result = await resume(p, checkpoint => {const current=read(p.id);current.resumeCheckpoint=checkpoint;save(current);});
    p = read(p.id); p.state = p.cancelRequested && p.resumeCheckpoint!=='original' ? 'cancelled' : 'continued'; p.result = result.result; p.continuation = result.next;
    p.stage = 'original_task'; return save(p);
  }
  function launch(p) {
    p.state = 'preparing'; p.stage = 'preparing'; p.pid = process.pid; save(p);
    const promise = run(p.id).catch(e=>{
      // A full/read-only disk must not crash the connector with an unhandled
      // rejection or report a checkpoint as saved. Preserve a volatile stop state.
      let current;try{current=read(p.id);}catch{current=p;}
      current.state='uncertain';current.error=taskError(e);current.error.persisted=false;
      unsaved.set(p.id,current);
    }).finally(() => operations.delete(p.id)); operations.set(p.id, promise);
    return view(p);
  }
  async function confirm({taskId, revision, decision}) {
    let p = read(taskId);
    if (revision !== p.revision) throw fail('PLAN_CHANGED', '确认方案已变化，请重新展示当前方案。');
    if (!['approve', 'decline'].includes(decision)) throw fail('INVALID_DECISION', '确认值无效。');
    if (decision === 'decline') {
      if(p.state==='declined')return view(p);
      if(p.state!=='awaiting_confirmation')throw fail('INVALID_TASK_STATE','当前任务不在等待确认状态；拒绝不能撤销已发出的操作。');
      p.state = 'declined'; delete p.consent; return view(save(p));
    }
    if (runningStates.has(p.state) || p.state === 'continued') return view(p);
    if (p.state !== 'awaiting_confirmation' || p.expiresAt <= now()) throw fail('CONFIRMATION_REQUIRED', '请重新检查并展示当前准备方案，再取得用户同意。');
    const report = await inspect(p.request); p = read(taskId);
    if (runningStates.has(p.state) || p.state === 'continued') return view(p);
    if (p.state !== 'awaiting_confirmation' || revision !== p.revision) throw fail('PLAN_CHANGED', '方案已取消或变化。');
    if (p.expiresAt <= now()) return view(applyReport(p, report));
    if (p.version !== version || signature(report) !== p.signature || guardsChanged(p,report) || requirementsSignature(report.requirements) !== p.planSignature) return view(applyReport(p, report));
    p.consent = {revision, at: now()}; return launch(p);
  }
  async function resumeInternal({taskId}) {
    let p = read(taskId);
    if (runningStates.has(p.state) || p.state === 'continued') return view(p);
    if (['uncertain', 'cancelled', 'declined', 'awaiting_confirmation'].includes(p.state)) return view(p);
    if (p.state === 'waiting_for_user' && p.consent && userAction) {
      // Only an explicit resume after the human step completes may finish this same login transaction.
      const current = await inspect(p.request);
      if (signature(current) !== p.signature || guardsChanged(p,current)) return view(applyReport(p, current));
      if(p.expiresAt<=now()&&current.requirements.some(r=>r.state!=='ready'))return view(applyReport(p,current));
      const action = await userAction(p);
      p = read(taskId);
      if (p.cancelRequested || ['cancelled','declined'].includes(p.state)) return view(p);
      if (action?.userAction) { p.userAction = action.userAction; return view(save(p)); }
    }
    const report = await inspect(p.request);
    p = read(taskId);
    if (runningStates.has(p.state) || ['continued','cancelled','declined'].includes(p.state)) return view(p);
    if (p.version !== version || signature(report) !== p.signature || guardsChanged(p,report)) return view(applyReport(p, report));
    if(report.requirements.some(r=>r.state!=='ready')){
      const remaining=report.requirements.filter(r=>r.state!=='ready');
      const alreadyApproved=p.consent&&p.expiresAt>now()&&remaining.every(r=>r.state==='needs_confirmation'&&p.requirements.some(old=>old.id===r.id&&old.action===r.action&&old.fingerprint===r.fingerprint));
      if(alreadyApproved){p.requirements=report.requirements;delete p.userAction;return launch(p);}
      return view(applyReport(p, report));
    }
    // An explicit resume checks the old operation, it never reuses consent to install new components.
    p.requirements=report.requirements;delete p.userAction;
    return launch(p);
  }
  function resumeTask(args) {
    if (resumptions.has(args.taskId)) return resumptions.get(args.taskId);
    const pending = resumeInternal(args).finally(()=>resumptions.delete(args.taskId));
    resumptions.set(args.taskId,pending); return pending;
  }
  function cancel({taskId}) {
    const p = read(taskId); if (p.state === 'continued') return view(p);
    // Cancellation cannot prove that an already dispatched operation was undone.
    // Keep the unresolved journal visible to findOriginal so retry cannot bypass it.
    if(p.state==='uncertain'||p.stage==='resume'&&!runningStates.has(p.state)){p.state='uncertain';p.cancelRequested=true;return view(save(p));}
    p.cancelRequested = true; p.state = runningStates.has(p.state) ? 'cancelling' : 'cancelled';
    delete p.consent; return view(save(p));
  }
  async function recover({taskId}) {
    let p=read(taskId);
    if(operations.has(taskId)||!['interrupted','uncertain','failed'].includes(p.state))return view(p);
    if(fs.existsSync(writer)) {
      const raw=fs.readFileSync(writer,'utf8');let lock;
      try{lock=JSON.parse(raw);}catch{throw fail('TASK_UNCERTAIN','准备锁记录损坏，请保留记录并联系维护人员。');}
      const written=Number(lock.createdAt)||fs.statSync(writer).mtimeMs;
      // A reboot is the portable proof that untracked installer descendants cannot still write.
      if(written+5000>=bootTime())return {...view(p),recovery:{safe:false,requiresRestart:true,message:'旧准备进程可能仍有子进程。保存其他工作并重启电脑后，再调用 recover_task；不会强停进程或删除组件。'}};
      if(fs.readFileSync(writer,'utf8')!==raw)throw fail('PREPARATION_BUSY');
      fs.renameSync(writer,writer+'.recovered-'+crypto.randomUUID());
    }
    const sourceOnly=p.resumeCheckpoint==='preparation'&&['zhigao_get_review_brief','zhigao_reopen_review','zhigao_prepare_video_review','zhigao_prepare_library_assets'].includes(p.request.originalCall?.name)
      &&['PREPARATION_TRANSPORT','PAGE_SESSION_CHANGED','PAGE_UNRESPONSIVE','CALL_QUEUE_TIMEOUT','MEDIA_PREPARATION_FAILED','CONVERSION_CHECKPOINT_UNSAVED','ENOSPC','EACCES','EPERM','EBUSY'].includes(p.error?.code);
    if(p.stage==='resume'&&!sourceOnly)return {...view(p),recovery:{safe:false,requiresUserReview:true,message:'渠道准备锁已核对；原任务步骤结果仍需核对。请检查已保存的稿件/转换结果，再重新检查当前任务。'}};
    if(sourceOnly){const report=await inspect(p.request);if(signature(report)!==p.signature||guardsChanged(p,report))return {...view(p),recovery:{safe:false,requiresUserReview:true,message:'原件或环境已变化，请核对已保存结果；不继续旧准备。'}};}
    p=applyReport(p,await inspect(p.request));
    return {...view(p),recovery:{safe:true,message:'已核对中断现场并重新检测；缺项将生成新的具体方案，已有组件复用。'}};
  }
  function findOriginal(originalCall,projectId,binding){
    if(!projectId||!fs.existsSync(jobs))return null;
    for(const name of fs.readdirSync(jobs)){
      if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;
      let p;try{p=read(name.slice(0,-5));}catch{continue;}
      if(p.request.originalCall&&p.binding?.projectId===projectId&&originalIdentity(p.request.originalCall)===originalIdentity(originalCall)
        &&(runningStates.has(p.state)||sameOriginal(p.binding,binding)&&['uncertain','interrupted','failed'].includes(p.state)))return view(p);
    }
    return null;
  }
  return {plan, confirm, resume: resumeTask, recover, cancel, findOriginal, status: ({taskId}) => view(read(taskId)),
    busy: () => operations.size > 0, wait: id => operations.get(id)};
}

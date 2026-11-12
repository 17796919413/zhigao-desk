import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

export function createTaskChannels(host, {createTaskRuntime, createChannelRuntime, LARK_HASHES, LARK_VERSION, OFFICE_PACKAGE, runPrivate}) {
  const root = path.join(host.home, 'task-runtime'), channels = createChannelRuntime({root});
  const environment = {platform: process.platform, arch: process.arch, node: process.versions.node, version: host.version, root};
  const configJobs = new Map();
  const issue = (id, code, message, userAction) => ({id, code, state: 'waiting_for_user', message, userAction: userAction || {kind: id, message}});
  const need = (id, action, message, fingerprint) => ({id, state: 'needs_confirmation', action, message, fingerprint});
  const authFile = id => path.join(root, 'auth', id + '.json');
  async function inspect(request) {
    let browser;
    try { browser = await host.pageCall('zhigao_task_context', request); }
    catch (e) {
      return {binding: {projectId: request.projectId || null, fingerprint: 'page-unavailable'}, environment,
        requirements: [/^(PROJECT|SOURCE|TASK)_/.test(e.code||'')?issue('task',e.code,e.publicMessage||'原任务或原件条件不满足，请回到当前品牌核对。'):issue('connection', e.code || 'PAGE_UNAVAILABLE', '先恢复工作台连接，原任务已保留。', {kind: 'page', url: host.site + '?connect=1', message: '打开工作台并连接当前 AI；旧客户端请刷新工具清单。'})]};
    }
    const requirements = [], guards = {};
    for (const r of browser.requirements) {
      if (r.state !== 'check_runtime') { requirements.push(r); continue; }
      if (r.id === 'media') {
        const status = await host.mediaStatus();
        if(status.ready&&(!request.mediaModel||status.model===request.mediaModel))guards.media=JSON.stringify([status.python,status.model,status.modelPath,status.workerHash]);
        requirements.push(status.ready && (!request.mediaModel || status.model === request.mediaModel) ? {id: 'media', state: 'ready'} : need('media', 'prepare_media', '本任务需要补齐本机视频组件和转写模型'+(request.mediaModel?'（'+request.mediaModel+'）':'')+'。安装到知稿私有目录，已有组件复用；完成后继续处理原视频。要现在准备吗？', 'media-' + host.version + '-' + (request.mediaModel || 'reuse')));
      }
      if (r.id === 'office') {
        const status = await channels.officeStatus();
        if(status.ready)guards.office=JSON.stringify([status.command,status.version]);
        requirements.push(status.ready ? {id: 'office', state: 'ready'} : status.supportedSetup
          ? need('office', 'prepare_office', `处理这份旧 Office 文件需要本机转换器。将在知稿私有目录解压 LibreOffice ${OFFICE_PACKAGE.version}（下载 ${OFFICE_PACKAGE.bytes} 字节），保留原件；若系统要求额外许可会停下提示。要现在准备并继续转换吗？`, OFFICE_PACKAGE.sha256)
          : issue('office', 'UNSUPPORTED_PLATFORM', '当前系统没有已验证的自动安装转换器路径。', {kind: 'install', url: 'https://www.libreoffice.org/download/download-libreoffice/', message: '安装官方 LibreOffice 后，在同一任务继续；无需重新导入原件。'}));
      }
      if (r.id === 'feishu') {
        const status = await host.feishuStatus();
        if(status.state==='ready')guards.feishu=JSON.stringify([host.larkCommand().file,status.accountFingerprint||null]);
        if (status.state === 'ready') {
          try { await host.inspectTable(browser.tableUrl); requirements.push({id: 'feishu', state: 'ready', verified: 'target-workbook-read'}); }
          catch (e) {
            if(e.code==='FEISHU_SCOPE')requirements.push({...need('feishu','authorize_feishu','当前账号尚未授予目标表所需权限。要发起补充授权，并在完成后继续吗？','lark-scopes-'+JSON.stringify(e.details?.missingScopes||[])),scopes:e.details?.missingScopes||[]});
            else requirements.push(issue('feishu', e.code || 'FEISHU_ACCESS', '当前账号无法读取目标表。请检查链接、表格权限和网络。', {kind: 'table-access', url: browser.tableUrl, message: '请用当前账号打开目标表；缺权限请向所有者申请，链接失效请重新关联。'}));
          }
        } else if (['missing', 'config', 'auth', 'scope'].includes(status.state) && LARK_HASHES[process.platform + '-' + process.arch]) {
          requirements.push(need('feishu', 'prepare_feishu', '读取本任务的飞书表需要准备连接组件、应用配置及用户授权。缺失组件将放入知稿私有目录，登录或管理员许可由你在飞书完成；随后回读目标表并继续，不会自动写表。要现在准备吗？', 'lark-' + LARK_VERSION));
        } else requirements.push(issue('feishu', status.code || 'FEISHU_UNAVAILABLE', '飞书渠道暂不可用，请检查网络、应用或系统支持情况。'));
      }
    }
    return {binding: browser.binding, environment, requirements, guards, browser};
  }
  function verifiedUrl(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && /(^|\.)(feishu\.cn|larksuite\.com)$/.test(u.hostname) ? value : null; } catch { return null; }
  }
  async function qr(url, id) {
    const dir = path.join(root, 'auth'); fs.mkdirSync(dir, {recursive: true});
    const command = host.larkCommand();
    await runPrivate(command.file, [...command.prefix, 'auth', 'qrcode', url, '--output', id + '.png'], {cwd: dir, timeout: 15000});
    return fs.readFileSync(path.join(dir, id + '.png')).toString('base64');
  }
  async function beginConfig(p) {
    const bounded = promise => new Promise((resolve,reject) => {
      const timer=setTimeout(()=>resolve({userAction:{kind:'feishu-config',message:'飞书应用配置仍在等待响应，请稍后继续检查；不会重复创建配置流程。'}}),15000);
      promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
    });
    if (configJobs.has(p.id)) return bounded(configJobs.get(p.id).promise);
    if (configJobs.size) throw Object.assign(Error('另一个任务正在配置飞书，请等待该步骤完成。'),{code:'PREPARATION_BUSY'});
    const command = host.larkCommand();
    let child, finish;
    const promise = new Promise(resolve => { finish = resolve; });
    const job = {promise, child: null}; configJobs.set(p.id, job);
    child = spawn(command.file, [...command.prefix, 'config', 'init', '--new'], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1'}}); job.child = child;
    let buffer = '', sent = false;
    const timer = setTimeout(() => child.kill(), 300000);
    const collect = chunk => {
      buffer = (buffer + chunk.toString()).slice(-16384);
      const url = (buffer.match(/https:\/\/[^\s<>"\x1b]+/g) || []).map(verifiedUrl).find(Boolean);
      if (url && !sent) { sent = true; qr(url, p.id).then(image => finish({userAction: {kind: 'feishu-config', url, image, message: '请在飞书完成应用配置或请管理员协助，然后告诉 AI 已完成，以继续原任务。'}})).catch(() => finish({userAction: {kind: 'feishu-config', url, message: '请打开飞书应用配置页面完成授权，再继续同一任务。二维码生成未成功。'}})); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', () => { clearTimeout(timer); finish({userAction: {kind: 'feishu-config', message: '应用配置无法启动，请检查组件与系统权限。'}}); configJobs.delete(p.id); });
    child.on('close', () => { clearTimeout(timer); configJobs.delete(p.id); if (!sent) finish({userAction: {kind: 'feishu-config', message: '请检查飞书应用配置结果后继续。配置未确认成功。'}}); });
    // Bounded wait: clients receive a pending state even if CLI emits no authorization URL.
    return bounded(promise);
  }
  async function prepareFeishu(p, progress, scopes = null) {
    let status = await host.feishuStatus();
    if (status.state === 'missing') { await channels.installLark(progress); status = await host.feishuStatus(); }
    if (status.state === 'config') return beginConfig(p);
    if (scopes || ['auth', 'scope'].includes(status.state)) {
      const selected=scopes?.filter(s=>typeof s==='string'&&/^[a-z][a-z0-9_:.]+$/.test(s));
      const scopeArgs=selected?.length?['--scope',selected.join(' ')]:['--domain','sheets','--domain','drive','--domain','wiki'];
      const response = await host.larkJson(['auth', 'login', ...scopeArgs, '--no-wait', '--json']);
      const data = response.data || response, url = verifiedUrl(data.verification_url || data.verification_uri_complete);
      if (!url || typeof data.device_code !== 'string') throw Object.assign(Error('授权入口尚未生成。'), {code: 'FEISHU_AUTH'});
      fs.mkdirSync(path.dirname(authFile(p.id)), {recursive: true});
      // Device code stays private and never enters MCP responses or the task journal.
      fs.writeFileSync(authFile(p.id), JSON.stringify({deviceCode: data.device_code, scopes, expiresAt: Date.now() + Math.min(Number(data.expires_in) || 600, 1800) * 1000}), {mode: 0o600});
      let image; try { image = await qr(url, p.id); } catch { /* The same verified URL remains usable. */ }
      return {userAction: {kind: 'feishu-login', url, image, message: '请打开链接或扫描二维码，在飞书完成本任务所需授权，然后告诉 AI 已完成。'}};
    }
    if (status.state !== 'ready') throw Object.assign(Error('飞书尚未就绪。'), {code: status.code || 'FEISHU_UNAVAILABLE'});
    return {ready: true};
  }
  async function prepare(requirement, p, progress) {
    if (requirement.action === 'prepare_media') return host.prepareMedia(p.request.mediaModel ? {model:p.request.mediaModel} : {});
    if (requirement.action === 'prepare_office') return channels.installOffice(progress);
    if (requirement.action === 'prepare_feishu') return prepareFeishu(p, progress);
    if (requirement.action === 'authorize_feishu') return prepareFeishu(p,progress,requirement.scopes||[]);
    throw Object.assign(Error('未知准备动作。'), {code: 'INVALID_ACTION'});
  }
  async function userAction(p) {
    if (p.userAction?.kind === 'feishu-login') {
      let auth; try { auth = JSON.parse(fs.readFileSync(authFile(p.id), 'utf8')); } catch { return prepareFeishu(p, () => {}); }
      if (auth.expiresAt <= Date.now()) { fs.unlinkSync(authFile(p.id)); return prepareFeishu(p, () => {},auth.scopes); }
      await host.larkJson(['auth', 'login', '--device-code', auth.deviceCode]); fs.unlinkSync(authFile(p.id));
    }
    if (p.userAction?.kind === 'feishu-config') {
      if (configJobs.has(p.id)) return beginConfig(p);
      return prepareFeishu(p, () => {});
    }
    return null;
  }
  async function verify(p) {
    const report = await inspect(p.request), proof = {};
    if (report.requirements.some(r => r.state !== 'ready')) throw Object.assign(Error('条件仍未满足。'), {code: 'NOT_READY'});
    if (report.requirements.some(r => r.id === 'office')) proof.office = await channels.officeSmoke((await channels.officeStatus()).command);
    if (report.requirements.some(r => r.id === 'media')) proof.media = {runtimeReady: true, actualInputVerification: 'Original task prepare_video_review/get_video_review_status must reach complete; never mark semantic review complete.'};
    if (report.requirements.some(r => r.id === 'feishu')) proof.feishu = {verified: 'actual-target-workbook-read', businessWrite: false};
    return proof;
  }
  async function resume(p,checkpoint=()=>{}){
    const sourceOnly=['zhigao_get_review_brief','zhigao_reopen_review','zhigao_prepare_video_review','zhigao_prepare_library_assets'].includes(p.request.originalCall?.name);
    // Retry only the idempotent source preparation, never a dispatched original
    // business operation or an execution timeout whose result remains unknown.
    const recoverable=new Set(['PAGE_SESSION_CHANGED','PAGE_UNRESPONSIVE','CALL_QUEUE_TIMEOUT','PREPARATION_TRANSPORT']);
    async function sourceCall(name,args){
      for(let attempt=0;;attempt++){
        if(tasks.status({taskId:p.id}).cancelRequested)throw Object.assign(Error('已停止后续步骤。'),{code:'TASK_CANCELLED'});
        try{return await host.pageCall(name,args);}catch(e){
          if(!sourceOnly||!recoverable.has(e.code)||attempt>=2)throw e;
          await new Promise(r=>setTimeout(r,1500));
        }
      }
    }
    checkpoint('preparation');
    const context=await sourceCall('zhigao_task_context',p.request);
    const prepared=await (sourceOnly?sourceCall:host.pageCall)('zhigao_resume_prepared_task',{request:p.request,binding:p.binding,preparationId:p.id});
    if(!p.request.originalCall)return prepared;
    const original=p.request.originalCall;
    if(['zhigao_extract_feishu','zhigao_read_feishu_table','zhigao_prepare_feishu_sync'].includes(original.name))return {result:{originalTool:original.name,originalResult:prepared.result},next:{tool:'zhigao_status',args:{},instruction:'原读取或差异检查已续办，使用result.originalResult继续原任务。'}};
    const waits=context.mediaIds.map(id=>({name:'zhigao_get_library_asset_status',args:{libraryId:id}}));
    if(context.videoDocId)waits.push({name:'zhigao_get_video_review_status',args:{docId:context.videoDocId}});
    for(const item of waits){
      const deadline=Date.now()+24*3600000;
      while(true){
        if(tasks.status({taskId:p.id}).cancelRequested)throw Object.assign(Error('已停止后续步骤。'),{code:'TASK_CANCELLED'});
        const status=await sourceCall(item.name,item.args);
        if(status.state==='complete')break;
        if(['failed','interrupted','setup_required'].includes(status.state)||Date.now()>deadline)throw Object.assign(Error('原视频尚未准备完整，请核对已保存进度。'),{code:'MEDIA_PREPARATION_FAILED'});
        await new Promise(r=>setTimeout(r,1500));
      }
    }
    if(tasks.status({taskId:p.id}).cancelRequested)throw Object.assign(Error('已停止后续步骤。'),{code:'TASK_CANCELLED'});
    const fresh=await sourceCall('zhigao_task_context',p.request);
    if(fresh.binding.projectId!==p.binding.projectId||fresh.binding.fingerprint!==p.binding.fingerprint)throw Object.assign(Error('准备期间原稿件或品牌资料已变化。'),{code:'TASK_CHANGED'});
    checkpoint('original');
    // Preparation already started these operations. Return their verified status instead of replaying retry.
    const result=original.name==='zhigao_prepare_video_review'
      ?await host.pageCall('zhigao_get_video_review_status',{docId:original.args.docId})
      :original.name==='zhigao_prepare_library_assets'
        ?{...prepared.result,materials:await Promise.all(context.mediaIds.map(async libraryId=>({libraryId,...await host.pageCall('zhigao_get_library_asset_status',{libraryId})})))}
        :await host.pageCall(original.name,original.args);
    const isBrief=['zhigao_get_review_brief','zhigao_reopen_review'].includes(original.name);
    return {result:{originalTool:original.name,originalResult:result},next:{tool:isBrief?'zhigao_read_review_context':'zhigao_status',args:isBrief?{docId:original.args.docId,...(original.args.batchId?{batchId:original.args.batchId}:{}),reviewToken:result.reviewToken}:{},instruction:'已自动补齐并执行原调用。请直接使用result.originalResult继续，勿重复领取审稿凭据。'}};
  }
  const tasks=createTaskRuntime({root,version:host.version,inspect,prepare,verify,userAction,resume});
  async function automatic(name,args={}){
    const operations={zhigao_get_review_brief:'office',zhigao_reopen_review:'office',zhigao_prepare_video_review:'office',zhigao_prepare_library_assets:'library',zhigao_extract_feishu:'feishu_read',zhigao_prepare_feishu_sync:'feishu_sync'};
    if(!operations[name]||name==='zhigao_extract_feishu'&&args.createDocument)return null;
    const request={operation:operations[name],...(args.docId?{docId:args.docId}:{}),...(args.libraryId?{libraryId:args.libraryId}:{}),originalCall:{name,args}};
    const report=await inspect(request);
    if(report.binding?.projectId)request.projectId=report.binding.projectId;
    const existing=tasks.findOriginal(request.originalCall,request.projectId,report.binding);
    if(!existing&&!report.browser?.needsPreparation&&!report.requirements.some(r=>['office','media','feishu','connection'].includes(r.id)&&r.state!=='ready'))return null;
    let state=existing||await tasks.plan(request);if(state.state==='ready')state=await tasks.resume({taskId:state.taskId});
    return {preparation:state,complete:false,message:state.confirmation?.message||state.userAction?.message||'正在自动准备本次任务，完成后会接回原步骤。',next:state.next,instruction:'这是原任务的自动恢复流程。只在需要安装或授权时向使用者询问一次；其余查询状态并使用最终originalResult继续，不要求用户转换、重新上传或切换文件。'};
  }
  return {tasks,channels,automatic,busy:()=>tasks.busy()||channels.busy()||configJobs.size>0};
}

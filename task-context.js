import {digest, stableJSON} from './review-knowledge.js';
import {parseLibraryFile} from './library-import.js';
import {parseFeishuUrl} from './feishu.js';

const problem = (code, message) => Object.assign(Error(message), {code});
async function officeRequest(body) {
  let r,value;
  try{r = await fetch('http://127.0.0.1:47821/page/office', {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000)});value=await r.json();}
  catch{throw problem('PREPARATION_TRANSPORT','准备过程连接中断，正在核对已有作业。');}
  if (!r.ok || !value.ok) throw problem(value.code || 'CONVERSION_FAILED', value.error || '原件转换未完成。'); return value.data;
}
export function createTaskBridge(ctx, tools) {
  const current = () => ctx.state().settings.projects.find(p => p.id === ctx.state().settings.selected);
  async function context(request) {
    const p = current(); if (!p || p.status === 'ended' || request.projectId && request.projectId !== p.id) throw problem('PROJECT_MISMATCH', '请先切换到原任务所属的有效品牌。');
    const t = request.docId && ctx.state().tasks.find(t => t.id === request.docId && t.projectId === p.id);
    if (request.docId && !t) throw problem('TASK_NOT_FOUND', '当前品牌找不到原稿件。');
    if (request.operation === 'review' && !t) throw problem('TASK_NOT_FOUND', '请先取得待审稿件的 docId。');
    const list = request.libraryId ? (p.library || []).filter(d => d.id === request.libraryId) : (p.library || []).filter(d => d.active !== false);
    if (request.libraryId && !list.length) throw problem('TASK_NOT_FOUND', '当前品牌找不到该资料。');
    const requirements = [], originals = [], officeIds = [], mediaIds = [];let pendingMedia=false;
    const tableUrl=['zhigao_extract_feishu','zhigao_read_feishu_table'].includes(request.originalCall?.name)&&request.originalCall.args?.url || p.feishu?.refined?.url || p.feishu?.source?.url;
    if(request.clientCapabilities?.tools===false)requirements.push({id:'client:tools',state:'waiting_for_user',code:'CLIENT_CAPABILITY',userAction:{kind:'client',message:'当前客户端声明不支持工具调用，请切换到可使用知稿工具的客户端后继续。'}});
    const inspectSources = ['review', 'library', 'office'].includes(request.operation);
    for (const d of inspectSources ? list : []) {
      const g = d.ingestion;
      if (!g?.assetKey) { originals.push({id: d.id, active: d.active, text: await digest(d.text || '')}); continue; }
      let file; try { file = await ctx.getLibraryFile(g.assetKey); } catch { throw problem('SOURCE_CHANGED', '原件已移动、变动或失去授权，请在资料库重新关联。'); }
      if (!file?.originalFile) throw problem('SOURCE_MISSING', '资料库原件缺失，请重新关联该资料。');
      const sourceHash = await digest(await file.originalFile.arrayBuffer());
      originals.push({id: d.id, sourceHash, revision: file.mediaRevision, active: d.active});
      const ext = g.filename?.split('.').pop().toLowerCase();
      if (['ppt', 'doc', 'xls'].includes(ext) && !file.conversion) officeIds.push(d.id);
      else if (g.format === 'video') {mediaIds.push(d.id);if(file.videoPreparation?.state!=='complete'||!file.videoAnalysis)pendingMedia=true;}
      else if (g.blockers?.length) requirements.push({id: 'source:' + d.id, state: 'waiting_for_user', code: 'SOURCE_UNSUPPORTED',
        message: '资料尚未完整解析：' + d.title, userAction: {kind: 'source', libraryId: d.id, message: g.blockers.join('；')}});
    }
    if (officeIds.length || t?.fmt==='office-pending') requirements.push({id: 'office', state: 'check_runtime'});
    if (mediaIds.length || t?.fmt === 'video') requirements.push({id: 'media', state: 'check_runtime'});
    if (['feishu_read', 'feishu_sync'].includes(request.operation)) {
      if (!tableUrl) requirements.push({id: 'table', state: 'waiting_for_user', code: 'RESOURCE_MISSING', userAction: {kind: 'table', message: '请在飞书同步页保存本任务的表格链接。'}});
      else if(parseFeishuUrl(tableUrl)?.error||!['sheets','wiki'].includes(parseFeishuUrl(tableUrl)?.type))requirements.push({id:'table',state:'waiting_for_user',code:'INVALID_TABLE_URL',userAction:{kind:'table',message:'请提供有效的飞书电子表格或表格知识库链接。'}});
      else requirements.push({id: 'feishu', state: 'check_runtime'});
    }
    if (request.operation === 'archive') {
      const status = await ctx.setupStatus();
      if (status.archive.state !== 'granted') requirements.push({id: 'archive', state: 'waiting_for_user', code: status.archive.state === 'unsupported' ? 'BROWSER_UNSUPPORTED' : 'FOLDER_PERMISSION', userAction: {kind: 'folder', message: '在连接与授权中选择或授权本品牌文件夹；不支持时可使用文件下载。', tool: 'zhigao_open_setup', args: {section: 'folder'}}});
    }
    if (request.operation === 'review') {
      const visuals = t?.fmt && t.fmt !== 'text' || list.some(d => d.ingestion && !['text', 'attachment'].includes(d.ingestion.format));
      for (const [capability, needed] of [['images', visuals], ['audio', t?.fmt === 'video' || mediaIds.length]]) {
        if (needed && request.clientCapabilities?.[capability] !== true) requirements.push({id: 'client:' + capability, state: 'waiting_for_user', code: 'CLIENT_CAPABILITY',
          userAction: {kind: 'client', message: `当前客户端须确认支持${capability === 'images' ? '看图' : '听音'}；不支持时切换具备该能力的模型，并重新检查。`}});
      }
    }
    // Conversion and media preparation may change derived text/revisions. Bind the
    // original bytes and actual user edits so refreshing halfway can resume safely.
    let target=null;
    if(t){
      const original=t.officeOriginal?.buffer||t.buffer;
      const hash=original?await digest(original):t.originalFile instanceof Blob?await digest(await t.originalFile.arrayBuffer()):null;
      const cells=t.officeOriginal?(t.cells||[]).filter(c=>c.current!==t.base?.[c.id]||c.note):['office-pending','video'].includes(t.fmt)?[]:t.cells;
      target={id:t.id,round:t.flow?.round,hash,cells};
    }
    const binding = {projectId: p.id, docId: t?.id || null, libraryId: request.libraryId || null,
      operationFingerprint:await digest(stableJSON({projectId:p.id,target:target?{id:target.id,hash:target.hash,cells:target.cells}:null,originals:target?null:originals,table:['feishu_read','feishu_sync'].includes(request.operation)?tableUrl:null})),
      fingerprint: await digest(stableJSON({projectId: p.id, target, originals, notes: p.notes, rules: p.rules, table: ['feishu_read', 'feishu_sync'].includes(request.operation) ? tableUrl : null}))};
    if (current()?.id !== p.id) throw problem('PROJECT_MISMATCH', '检查期间品牌已切换，请重新检查。');
    return {binding, requirements, officeIds, mediaIds,needsPreparation:!!(officeIds.length||t?.fmt==='office-pending'||pendingMedia||t?.fmt==='video'&&(t.videoPreparation?.state!=='complete'||!t.videoAnalysis)),officeDocId:t?.fmt==='office-pending'?t.id:null, videoDocId: t?.fmt === 'video' ? t.id : null,
      tableUrl: ['feishu_read', 'feishu_sync'].includes(request.operation) ? tableUrl : undefined};
  }
  async function convertLibrary(id, binding, docId=null, guard=async()=>{}) {
    await guard();
    const p = current(),draft=docId&&ctx.state().tasks.find(t=>t.id===docId&&t.projectId===p?.id), d = draft?{ingestion:{filename:draft.filename}}:p?.library?.find(d => d.id === id);
    if (p?.id !== binding.projectId || !draft&&!d?.ingestion?.assetKey) throw problem('PROJECT_MISMATCH', '原品牌或资料已变化。');
    const file = draft?{...draft,originalFile:draft.originalFile||new File([draft.buffer],draft.filename)}:await ctx.getLibraryFile(d.ingestion.assetKey); if (file.conversion) return {libraryId: id, state: 'ready', reused: true};
    const source = file.originalFile, sourceHash = await digest(await source.arrayBuffer()), extension = d.ingestion.filename.split('.').pop().toLowerCase();
    const started = await officeRequest({action: 'begin', projectId: p.id, sourceHash, extension, size: source.size});
    const token = {jobId: started.jobId, token: started.token, projectId: p.id, sourceHash};
    for (let offset = started.received || 0; started.state === 'uploading' && offset < source.size;) {
      await guard();
      if (current()?.id !== p.id) throw problem('PROJECT_MISMATCH', '品牌已切换，停止后续转换传输。');
      const bytes = new Uint8Array(await source.slice(offset, offset + 512 * 1024).arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const next = await officeRequest({action: 'chunk', ...token, offset, data: btoa(binary)}); offset = next.received;
    }
    await guard();
    await officeRequest({action: 'finish', ...token}); let result;
    for (let i = 0; i < 210; i++) {
      await guard();
      result = await officeRequest({action: 'status', ...token});
      if (['complete', 'failed', 'interrupted','checkpoint_unsaved'].includes(result.state)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if(result.state==='checkpoint_unsaved')throw problem('CONVERSION_CHECKPOINT_UNSAVED','转换结果已保留，但检查点未保存。请恢复本机存储后继续，系统会先核对已有结果。');
    if (result.state !== 'complete') throw problem('CONVERSION_FAILED', '转换未完成；原件保留，请查询转换器状态。');
    const chunks = []; let offset = 0;
    while (offset < result.size) {
      await guard();
      const chunk = await officeRequest({action: 'read', ...token, offset});
      if (chunk.nextOffset <= offset) throw problem('CONVERSION_FAILED', '转换副本传输未前进。');
      chunks.push(Uint8Array.from(atob(chunk.data), c => c.charCodeAt(0))); offset = chunk.nextOffset;
    }
    const name = d.ingestion.filename.replace(/\.[^.]+$/, '.' + result.format), converted = new File(chunks, name), buffer = await converted.arrayBuffer();
    if (await digest(buffer) !== result.sha256) throw problem('SOURCE_CHANGED', '转换副本校验失败。');
    const parsed = await parseLibraryFile(converted);
    parsed.ingestion.blockers.push(...(result.originalInventory?.blockers||[]));
    if(parsed.ingestion.blockers.length)parsed.ingestion.state='blocked';
    const latest=draft?ctx.state().tasks.find(t=>t.id===docId):await ctx.getLibraryFile(d.ingestion.assetKey);
    const original=latest?.originalFile||latest?.buffer&&new File([latest.buffer],latest.filename);
    if (current()?.id !== p.id || !original || await digest(await original.arrayBuffer()) !== sourceHash) throw problem('SOURCE_CHANGED', '转换期间原件或品牌已变化。');
    const proof={sourceHash, convertedHash: result.sha256, format: result.format, jobId: started.jobId,originalInventory:result.originalInventory};
    await guard();
    if(draft)await ctx.saveDraftConversion(draft,converted,parsed,proof);
    else await ctx.saveLibraryConversion(p.id, id, d.ingestion.assetKey, file, parsed, proof);
    return {...(draft?{docId}:{libraryId:id}), state: parsed.ingestion.state, blockers: parsed.ingestion.blockers, originalPreserved: true};
  }
  async function resume({request, binding, preparationId}) {
    const guard = async () => {
      if (current()?.id !== binding.projectId) throw problem('PROJECT_MISMATCH', '品牌已切换，已停止后续步骤。');
      if (!preparationId) return;
      let response,value;
      try{response = await fetch('http://127.0.0.1:47821/page/tasks', {method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action:'status',args:{taskId:preparationId}}),signal:AbortSignal.timeout(15000),credentials:'omit',redirect:'error'});value=await response.json();}
      catch{throw problem('PREPARATION_TRANSPORT','准备状态读取中断，恢复连接后核对同一作业。');}
      if (!response.ok || !value.ok) throw problem('TASK_UNCERTAIN', '准备任务状态无法确认，已停止后续步骤。');
      if (value.data.cancelRequested || ['cancelled','declined'].includes(value.data.state)) throw problem('TASK_CANCELLED', '已停止后续步骤；已完成的结果保留。');
    };
    await guard();
    const report = await context(request);
    if (report.binding.fingerprint !== binding.fingerprint || report.binding.projectId !== binding.projectId) throw problem('TASK_CHANGED', '原任务已变化，请重新检查。');
    const converted = [];
    for (const id of report.officeIds) converted.push(await convertLibrary(id, binding, null, guard));
    if(report.officeDocId)converted.push(await convertLibrary(null,binding,report.officeDocId,guard));
    let result = {converted};
    await guard();
    if (report.mediaIds.length) {
      result.library=[];
      for(const id of report.mediaIds){await guard();result.library.push(await tools.zhigao_prepare_library_assets({libraryId:id,retry:request.originalCall?.args?.retry===true}));}
    }
    await guard();
    if (request.operation === 'review' || ['zhigao_get_review_brief','zhigao_reopen_review','zhigao_prepare_video_review'].includes(request.originalCall?.name)) {
      if (report.videoDocId) result.video = await tools.zhigao_prepare_video_review({docId: report.videoDocId,retry:request.originalCall?.args?.retry===true});
      return {result, next: {tool: report.videoDocId ? 'zhigao_get_video_review_status' : 'zhigao_get_review_brief', args: {docId: request.docId}, instruction: '资料准备状态 complete 后，继续原稿的完整审阅。转换件的剩余阻断项不可跳过。'}};
    }
    if (request.operation === 'feishu_read') result = request.originalCall?.name==='zhigao_read_feishu_table'
      ?await tools.zhigao_read_feishu_table({url:report.tableUrl})
      :await tools.zhigao_extract_feishu({...request.originalCall?.args,url: report.tableUrl,createDocument:false});
    if (request.operation === 'feishu_sync') result = await tools.zhigao_prepare_feishu_sync();
    if (request.operation === 'archive') result = await ctx.openSetup({section: 'folder'});
    return {result, next: {tool: 'zhigao_status', args: {}, instruction: '本步骤已续办。按原任务继续核对结果；配置准备不代表业务完成。'}};
  }
  return {context, resume};
}

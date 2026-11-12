// The Agent prepares missing local components; the page transfers only the selected video to localhost.
const ENDPOINT='http://127.0.0.1:47821/page/media';
async function request(body){const response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store'}),value=await response.json();if(!response.ok||!value.ok)throw Object.assign(Error(value.error||'本机视频组件未响应。'),{code:value.code||'MEDIA_ERROR'});return value.data;}
const b64=buffer=>{const a=new Uint8Array(buffer);let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s);};
export function createVideoProcessor(ctx){
 const pending=new Map(),canonical=new Map(),get=id=>ctx.state().tasks.find(t=>t.id===id);
 const selected=id=>{const t=get(id);if(!t||t.projectId!==ctx.state().settings.selected)throw Object.assign(Error('请切换到视频所属品牌。'),{code:'PROJECT_MISMATCH'});if(t.fmt!=='video')throw Error('这份稿件不是视频。');return t;};
 const binding=t=>({docId:t.id,projectId:t.projectId,revision:t.mediaRevision,...t.videoPreparation?.job});
 async function save(t,patch){const current=get(t.id);if(!current||current.projectId!==t.projectId||current.mediaRevision!==t.mediaRevision)throw Error('视频原件或品牌已变化，旧准备结果不会写回。');await ctx.save({...current,...patch});}
 async function status(t){if(!t.videoPreparation?.job)return {state:'not_started',next:'调用 zhigao_prepare_video_review。'};const result=await request({action:'status',...binding(t)});
  if(result.state==='complete'&&(!t.videoAnalysis||t.videoAnalysis.reportHash!==result.reportHash)){
   const report=await request({action:'result',...binding(t)});await save(t,{videoAnalysis:report,videoPreparation:{...t.videoPreparation,state:'complete',progress:result}});
  }else if(result.state!==t.videoPreparation.state||result.stage!==t.videoPreparation.progress?.stage)await save(t,{videoPreparation:{...t.videoPreparation,state:result.state,progress:result}});
  return {...result,semanticReview:'pending-agent-review',next:result.state==='complete'?'原件准备完整；现在获取审稿指令，审核全部转写、OCR、画面与必听原声，提交逐项结果。':['failed','interrupted'].includes(result.state)?'处理失败，不能算已审；修复错误后调用 prepare_video_review({retry:true})。':'处理仍在进行，继续查询状态；不要先提交审核完成。'};
 }
 async function prepare({docId,retry=false}){let t=selected(docId);const health=await request({action:'doctor'});if(!health.ready)return {state:'setup_required',runtime:health,next:'调用 zhigao_plan_task 绑定原视频任务；展示准备方案并取得用户同意后 confirm_task，按任务状态续办。'};
  if(!t.mediaRevision){t={...t,mediaRevision:crypto.randomUUID()};await ctx.save(t);}
  if(pending.has(t.id))return {state:'processing',next:'查询 zhigao_get_video_review_status。'};
  if(t.videoPreparation?.job){const current=await status(t);if(current.state==='complete')return current;if(['failed','interrupted'].includes(current.state)){if(!retry)return current;await request({action:'retry',...binding(t)});return {state:'queued'};}if(current.state!=='uploading')return current;}
  const blob=await ctx.getMediaFile(t.id)||t.originalFile;if(!(blob instanceof Blob))throw Error('本机没有该视频原件，请在工作台重新关联原视频。');
  if(!t.videoPreparation?.job){const started=await request({action:'begin',docId:t.id,projectId:t.projectId,revision:t.mediaRevision,size:blob.size});if(started.state==='setup_required')return started;await save(t,{videoPreparation:{state:'uploading',job:{jobId:started.jobId,jobToken:started.jobToken}}});t=get(t.id);}
  const original=t;
  const operation=(async()=>{let progress=await request({action:'status',...binding(original)}),offset=progress.received||0;
   while(offset<blob.size){const bytes=await blob.slice(offset,offset+512*1024).arrayBuffer(),result=await request({action:'chunk',...binding(original),offset,data:b64(bytes)});offset=result.received;}
   await request({action:'start',...binding(original)});await save(original,{videoPreparation:{...get(t.id).videoPreparation,state:'processing'}});
   while(true){const result=await status(get(t.id));if(['complete','failed','interrupted'].includes(result.state))break;await new Promise(resolve=>setTimeout(resolve,2000));}
  })().catch(async e=>{try{await save(original,{videoPreparation:{...get(t.id)?.videoPreparation,state:'failed',progress:{state:'failed',error:e.message}}});}catch{}}).finally(()=>pending.delete(t.id));pending.set(t.id,operation);
  return {state:'uploading',docId,next:'原件正在交给本机组件，随后自动完整转写和逐帧处理；查询 zhigao_get_video_review_status。'};
 }
 async function analysis(t){if(!t.videoPreparation?.job||t.videoPreparation.state!=='complete'||!t.videoAnalysis)throw Object.assign(Error('请先调用 zhigao_prepare_video_review 准备视频，并查询状态直到完整转写与逐帧处理成功。'),{code:'VIDEO_PREPARATION_REQUIRED'});const result=await request({action:'verify',...binding(t)});if(result.reportHash!==t.videoAnalysis.reportHash||result.sourceHash!==t.videoAnalysis.sourceHash)throw Error('视频处理报告版本已变化，请重新准备。');const key=t.id+'|'+result.reportHash;if(!canonical.has(key)){if(canonical.size>4)canonical.delete(canonical.keys().next().value);canonical.set(key,await request({action:'result',...binding(t)}));}return canonical.get(key);}
 return {prepare,status:({docId})=>status(selected(docId)),analysis,readAsset:(t,assetId)=>request({action:'asset',...binding(t),assetId})};
}

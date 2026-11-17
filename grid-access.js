// Preparation journals contain only operation identity; cell drafts stay in the editor.
export function createGridAccess({request,storage,context,prepare,resume,onError}){
 const prefix='zhigao-grid-access:';let opening=false,resuming=false,resumeId='';
 const fail=()=>Object.assign(Error('原品牌、活动或表格已变化，请回到原表继续。'),{code:'TASK_CHANGED'});
 const same=(a,b)=>['projectId','activityId','url'].every(k=>a[k]===b[k])&&(!a.sheetId||a.sheetId===b.sheetId);
 function pending(id){
  const c=context(),p=JSON.parse(storage.getItem(prefix+c.projectId+':'+c.url)||'null');
  if(!p||p.id!==id||!same(p,c))throw fail();return p;
 }
 function restore(){
  const c=context(),p=JSON.parse(storage.getItem(prefix+c.projectId+':'+c.url)||'null');
  if(!p||!same(p,c)||!prepare)return false;
  if(!opening){opening=true;setTimeout(()=>Promise.resolve().then(()=>{pending(p.id);return prepare({operation:'feishu_read',projectId:c.projectId,originalCall:{name:'zhigao_read_feishu_table',args:{url:c.url,continuationId:p.id}}});}).catch(onError).finally(()=>{opening=false;}),0);}
  return true;
 }
 async function call(action,body,intent=action){
  const c=context();
  if(resuming)pending(resumeId);
  try{return await request(action,body);}catch(e){
   const allowed=['FEISHU_CLI_MISSING','FEISHU_CONFIG','FEISHU_AUTH'].includes(e.code)||e.code==='FEISHU_SCOPE'&&(action==='gridRead'||e.details?.definitelyNotExecuted===true);
   if(allowed&&!resuming&&prepare&&same(c,context())&&body.url===c.url){
    try{
     const key=prefix+c.projectId+':'+c.url,old=JSON.parse(storage.getItem(key)||'null');
     const p=old&&same(old,c)?old:{...c,id:crypto.randomUUID(),action:intent};
     // A refresh must not downgrade an already pending write.
     if(intent!=='gridRead')p.action=intent;
     if(e.code==='FEISHU_SCOPE'){
      const scopes=[...new Set((e.details?.missingScopes||[]).filter(s=>typeof s==='string'&&/^[a-z][a-z0-9_:.]{1,150}$/.test(s)))].slice(0,20);
      if(scopes.length)p.scopeRequest={id:crypto.randomUUID(),scopes};
     }
     storage.setItem(key,JSON.stringify(p));
     restore();
    }catch(error){onError(error);}
   }
   throw e;
  }
 }
 async function continueTask(id){
  const p=pending(id);resuming=true;resumeId=id;
  try{await resume(p);pending(id);storage.removeItem(prefix+p.projectId+':'+p.url);return {ok:true,operation:p.action};}
  finally{resuming=false;resumeId='';}
 }
 function settle(action){
  if(resuming)return;
  const c=context(),key=prefix+c.projectId+':'+c.url,p=JSON.parse(storage.getItem(key)||'null');
  if(p&&p.action===action&&same(p,c))storage.removeItem(key);
 }
 return {request:call,pending,restore,resume:continueTask,settle};
}

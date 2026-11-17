import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createChannelRuntime} from '../channel-runtime.mjs';
import {createTaskRuntime} from '../task-runtime.mjs';
import {cleanupManifest,removeCacheJob} from '../cache-cleanup.mjs';
import {planConnectorCleanup,libraryIdentity,connectorCleanupManifest} from '../library-cleanup.js';

const out=process.env.ZHIGAO_VERIFY_OUT;if(!out)throw Error('Set a fresh isolated ZHIGAO_VERIFY_OUT');fs.mkdirSync(out,{recursive:true});
const checks=[],check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex'),oldHash=hash('old'),newHash=hash('new');
const manifest={id:'change-1',projectId:'p',scopes:[{activityId:'a',identity:newHash}],sources:[{libraryId:'lib',assetKey:'old',sourceHash:oldHash,mediaRevision:'r1'}],protectedKeys:['shared','new'],protectedHashes:[newHash]};
const root=path.join(out,'channels'),runtime=createChannelRuntime({root,systemDiscovery:false});
function conversion(options={}){
 const id=crypto.randomUUID(),dir=path.join(root,'conversions',id);fs.mkdirSync(path.join(dir,'out'),{recursive:true});
 const meta={id,token:crypto.randomUUID(),projectId:'p',sourceHash:oldHash,libraryAssetKey:'old',state:'complete',extension:'doc',size:3,...options};
 fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify(meta));fs.writeFileSync(path.join(dir,'source.doc'),'OLD SOURCE');fs.writeFileSync(path.join(dir,'out','source.docx'),'OLD CONVERSION');return {id,dir,meta};
}
await check('Office cleanup removes only unreferenced old source and output; protects other brands, current assets and legacy shared draft hashes',async()=>{
 const old=conversion(),legacyOld=conversion({libraryAssetKey:undefined}),other=conversion({projectId:'other'}),shared=conversion({libraryAssetKey:'shared'}),current=conversion({libraryAssetKey:'new'}),legacy=conversion({libraryAssetKey:undefined,sourceHash:newHash});
 assert.deepEqual(new Set((await runtime.cleanupLibrary(manifest)).removed),new Set([old.id,legacyOld.id]));assert(!fs.existsSync(old.dir));assert(!fs.existsSync(legacyOld.dir));for(const x of [other,shared,current,legacy])assert(fs.existsSync(path.join(x.dir,'source.doc')));
});
await check('Busy jobs stay intact; retirement persists and rejects late uploads after restart; cleanup retries once the job ends',async()=>{
 const job=conversion({state:'converting',pid:process.pid});await assert.rejects(runtime.cleanupLibrary(manifest),{code:'CLEANUP_BUSY'});assert(fs.existsSync(job.dir));
 const restart=createChannelRuntime({root,systemDiscovery:false});await assert.rejects(restart.officeAction({action:'begin',projectId:'p',libraryAssetKey:'old',sourceHash:oldHash,extension:'doc',size:3}),{code:'SOURCE_RETIRED'});
 fs.writeFileSync(path.join(job.dir,'meta.json'),JSON.stringify({...job.meta,state:'complete'}));assert((await restart.cleanupLibrary(manifest)).removed.includes(job.id));assert(!fs.existsSync(job.dir));
});
await check('Partial disk deletion is retryable and never exposes retired output',async()=>{
 const job=conversion(),unlink=fs.unlinkSync;
 try{fs.unlinkSync=file=>{if(file===path.join(job.dir,'source.doc'))throw Object.assign(Error('injected denial'),{code:'EACCES'});return unlink(file);};await assert.rejects(runtime.cleanupLibrary(manifest),{code:'EACCES'});}finally{fs.unlinkSync=unlink;}
 assert(JSON.parse(fs.readFileSync(path.join(job.dir,'meta.json'))).retired);await assert.rejects(runtime.officeAction({action:'status',jobId:job.id,token:job.meta.token,projectId:'p',sourceHash:oldHash}),{code:'SOURCE_RETIRED'});
 await runtime.cleanupLibrary(manifest);assert(!fs.existsSync(job.dir));assert.deepEqual((await runtime.cleanupLibrary(manifest)).removed,[]);
});
await check('Timed-out converters retain their files because surviving children are not proved stopped',async()=>{
 const job=conversion({state:'failed',error:'PROCESS_TIMEOUT'});await assert.rejects(runtime.cleanupLibrary(manifest),{code:'CLEANUP_BUSY'});assert(fs.existsSync(path.join(job.dir,'source.doc')));
 // Test-controlled completion, not a production recovery assertion.
 fs.writeFileSync(path.join(job.dir,'meta.json'),JSON.stringify({...job.meta,error:undefined,state:'complete'}));await runtime.cleanupLibrary(manifest);
});
await check('Junctions and path traversal cannot delete outside the cache',()=>{
 const base=path.join(out,'path-test'),outside=path.join(out,'preserved');fs.mkdirSync(base);fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'KEEP');
 const id=crypto.randomUUID();fs.symlinkSync(outside,path.join(base,id),'junction');assert.throws(()=>removeCacheJob(base,id),{code:'CLEANUP_PATH'});assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'KEEP');assert.throws(()=>removeCacheJob(base,'../preserved'),{code:'CLEANUP_PATH'});
 fs.unlinkSync(path.join(base,id));assert.throws(()=>cleanupManifest({...manifest,sources:[{libraryId:'x',sourceHash:'invalid'}]}),{code:'CLEANUP_INPUT'});
});
await check('Preparation cleanup erases old returned content, protects new/other-activity results and preserves uncertain operation identity',()=>{
 const taskRoot=path.join(out,'tasks'),jobs=path.join(taskRoot,'tasks');fs.mkdirSync(jobs,{recursive:true});
 const seed=(options={})=>{const id=crypto.randomUUID(),p={schema:1,id,revision:crypto.randomUUID(),state:'continued',stage:'original_task',request:{operation:'office',projectId:'p',docId:'draft',originalCall:{name:'zhigao_get_review_brief',args:{docId:'draft'}}},binding:{projectId:'p',activityId:'a',libraryIdentity:oldHash,operationFingerprint:'original'},requirements:[],result:{originalResult:{text:'OLD SECRET TEXT'}},proof:{quote:'OLD SECRET TEXT'},...options};fs.writeFileSync(path.join(jobs,id+'.json'),JSON.stringify(p));return p;};
 const old=seed(),fresh=seed({binding:{projectId:'p',activityId:'a',libraryIdentity:newHash}}),other=seed({binding:{projectId:'p',activityId:'b'}}),unknown=seed({state:'uncertain',stage:'resume',resumeCheckpoint:'original'});
 const tasks=createTaskRuntime({root:taskRoot,version:'test'});const result=tasks.cleanupLibrary(manifest);assert.equal(result.cleared.length,2);
 for(const p of [old,unknown])assert(!fs.readFileSync(path.join(jobs,p.id+'.json'),'utf8').includes('OLD SECRET TEXT'));
 assert(tasks.status({taskId:fresh.id}).result);assert(tasks.status({taskId:other.id}).result);assert.equal(tasks.status({taskId:unknown.id}).state,'uncertain');assert(tasks.findOriginal(unknown.request.originalCall,'p',unknown.binding));
 const active=seed({state:'preparing',pid:process.pid});assert.throws(()=>tasks.cleanupLibrary(manifest),{code:'CLEANUP_BUSY'});assert(tasks.status({taskId:active.id}).result);
});
await check('Media retirement removes original, transcript, frames and audio; busy worker remains untouched and retries',async()=>{
 process.env.ZHIGAO_MEDIA_HOME=path.join(out,'media');const module=await import('../media-runtime.mjs');
 const seed=(active=false,extra={})=>{const id=crypto.randomUUID(),dir=path.join(process.env.ZHIGAO_MEDIA_HOME,'jobs',id);fs.mkdirSync(path.join(dir,'audio'),{recursive:true});fs.mkdirSync(path.join(dir,'frames'));const meta={id,token:'t',projectId:'p',docId:'lib',revision:'r1',libraryAssetKey:'old',...extra};fs.writeFileSync(path.join(dir,'meta.json'),JSON.stringify(meta));for(const n of ['source.media','report.json','audio/old.wav','frames/old.png'])fs.writeFileSync(path.join(dir,n),'OLD PAYLOAD');if(active)fs.writeFileSync(path.join(dir,'process.lock'),JSON.stringify({pid:process.pid}));return {id,dir};};
 const old=seed(),legacy=seed(false,{libraryAssetKey:undefined}),shared=seed(false,{libraryAssetKey:'shared'});assert.deepEqual(new Set(module.cleanupLibraryMedia(manifest).removed),new Set([old.id,legacy.id]));assert(!fs.existsSync(old.dir));assert(!fs.existsSync(legacy.dir));assert(fs.existsSync(shared.dir));
 const busy=seed(true);assert.throws(()=>module.cleanupLibraryMedia(manifest),{code:'CLEANUP_BUSY'});assert(fs.existsSync(path.join(busy.dir,'source.media')));
 await assert.rejects(module.mediaAction({action:'begin',projectId:'p',libraryAssetKey:'old',docId:'lib',revision:'r1',size:1}),{code:'SOURCE_RETIRED'});
 fs.unlinkSync(path.join(busy.dir,'process.lock'));module.cleanupLibraryMedia(manifest);assert(!fs.existsSync(busy.dir));
});
await check('Source identity ignores derived preparation and invalidates scope/text changes; pending cleanup protects currently referenced assets',async()=>{
 const p={id:'p',activities:[{id:'a'},{id:'b'}],library:[{id:'lib',activityId:'a',text:'preview',ingestion:{assetKey:'old',state:'pending'}}]};
 const derived=structuredClone(p);derived.library[0].ingestion.state='complete';derived.library[0].text='converted';assert.equal(planConnectorCleanup(p,derived),null);assert.equal(await libraryIdentity(p,'a'),await libraryIdentity(derived,'a'));
 const next=structuredClone(p);next.library[0].activityId='*';assert.deepEqual(planConnectorCleanup(p,next).activityIds,['legacy','a','b']);
 const notes=structuredClone(p);notes.activities[0].notes='新活动要求';assert.deepEqual(planConnectorCleanup(p,notes).activityIds,['a']);assert.notEqual(await libraryIdentity(p,'a'),await libraryIdentity(notes,'a'));assert.equal(await libraryIdentity(p,'b'),await libraryIdentity(notes,'b'));
 const cleared={...p,library:[]},job=planConnectorCleanup(p,cleared),settings={projects:[cleared,{id:'other',library:[{id:'shared',ingestion:{assetKey:'old'}}]}]};
 const body=await connectorCleanupManifest(job,settings,async()=>({conversion:{sourceHash:oldHash}}),[{officeConversion:{sourceHash:newHash}}]);assert(body.protectedKeys.includes('old'));assert(body.protectedHashes.includes(oldHash));assert(body.protectedHashes.includes(newHash));
});
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,mode:'isolated synthetic filesystem/control-plane; no global cache touched'},null,2));

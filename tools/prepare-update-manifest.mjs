// Run before publishing. Hash exactly the LF bytes Git publishes, never a stale local checksum.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const connector=path.join(root,'zhigao-connector.mjs');
let data=fs.readFileSync(connector,'utf8').replaceAll('\r\n','\n');
const version=data.match(/const VERSION = '([^']+)'/)?.[1];
if(!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('Invalid connector version');
const web=path.join(root,'connector-updates.js');
fs.writeFileSync(web,fs.readFileSync(web,'utf8').replace(/export const WEB_VERSION='[^']+';/,"export const WEB_VERSION='"+version+"';").replaceAll('\r\n','\n'));
const file=path.join(root,'setup-manifest.json');
const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
const files={};
const taskModules={};
const channelPath=path.join(root,'channel-runtime.mjs'),extractSource=fs.readFileSync(path.join(root,'tools','extract-office.ps1'),'utf8').replaceAll('\r\n','\n');
fs.writeFileSync(channelPath,fs.readFileSync(channelPath,'utf8').replace(/^const OFFICE_EXTRACT_SCRIPT = .*;$/m,()=>"const OFFICE_EXTRACT_SCRIPT = '"+Buffer.from(extractSource).toString('base64')+"';").replaceAll('\r\n','\n'));
for(const name of ['task-runtime.mjs','channel-runtime.mjs','task-channels.mjs']){
 const text=fs.readFileSync(path.join(root,name),'utf8').replaceAll('\r\n','\n');
 taskModules[name]=Buffer.from(text).toString('base64');
}
if(!/^const TASK_MODULES = .*;$/m.test(data))throw Error('Missing task module anchor');
data=data.replace(/^const TASK_MODULES = .*;$/m,'const TASK_MODULES = '+JSON.stringify(taskModules)+';');
manifest.taskPreparation={protocol:1,guide:'./TASK_CHANNELS.md',tools:['zhigao_plan_task','zhigao_confirm_task','zhigao_task_status','zhigao_resume_task','zhigao_cancel_task','zhigao_recover_task'],entry:'Existing read/review tools automatically check prerequisites. Poll preparation.taskId; after continuation consume result.originalResult instead of repeating the original call.',confirmation:'Exact task, revision, environment and current user reply; configuration never authorizes business writes.',modules:Object.fromEntries(Object.entries(taskModules).map(([name,base64])=>[name,{sha256:crypto.createHash('sha256').update(Buffer.from(base64,'base64')).digest('hex')}]))};
for(const name of ['media-runtime.mjs','media-worker.py']){
 const target=path.join(root,name),text=fs.readFileSync(target,'utf8').replaceAll('\r\n','\n');
 fs.writeFileSync(target,text);
 files[name]={sha256:crypto.createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)};
}
if(!/^const MEDIA_FILES = .*;$/m.test(data))throw Error('Missing helper hash anchor');
data=data.replace(/^const MEDIA_FILES = .*;$/m,'const MEDIA_FILES = '+JSON.stringify(files)+';');
fs.writeFileSync(connector,data);
manifest.version=version;
manifest.media={protocol:1,version,files,defaultModel:'large-v3-turbo',installScope:'private-local',semanticReview:'current-connected-agent'};
manifest.commands.mediaInspect=['node','zhigao-connector.mjs','media','doctor','--json'];
manifest.commands.mediaSetup=['node','zhigao-connector.mjs','media','setup','--json'];
Object.assign(manifest.mcpTools,{videoRuntimeStatus:'zhigao_video_runtime_status',setupVideoRuntime:'zhigao_setup_video_runtime',prepareVideo:'zhigao_prepare_video_review',videoStatus:'zhigao_get_video_review_status',readAsset:'zhigao_read_review_asset'});
Object.assign(manifest.mcpTools,{readContext:'zhigao_read_review_context',recordChecks:'zhigao_record_review_checks',readAssets:'zhigao_read_review_assets'});
Object.assign(manifest.mcpTools,{prepareLibraryAssets:'zhigao_prepare_library_assets',libraryAssetStatus:'zhigao_get_library_asset_status'});
manifest.brandMaterials={guide:'./BRAND_MATERIALS.md',storage:'original files; authorized folder streamed with File System Access, otherwise IndexedDB Blob; complete extracted text in IndexedDB',limits:'No fixed upload-byte or text-character cap; actual disk, browser quota and parser resources apply.',video:'Reuse video_runtime_status/setup_video_runtime, then prepare_library_assets and get_library_asset_status until complete. Read all current-brand sources and assets before review completion.',unsupported:'Keep originals; block complete review until converted and verified. Never treat saved as parsed.'};
manifest.review={protocolVersion:version,context:'Read each required brief.context section through nextCursor=null; reconstruct json-fragment records and block slices without truncation.',checkpoint:'record_review_checks saves checks without completing review. Final explicit arrays replace saved arrays.',basisChanges:'BASIS_CHANGED requires retry:true, updates pages and a fresh full review. Previous checks are advisory only.',sourceCache:'Original parsed sources only; project and current source hashes verified; never writes derived policy to brand library.'};
Object.assign(manifest.review,{resume:'retry:true can restore verified checkpoints only for unchanged identity and round; use resume.restored and new context cursors. savedChecks are actual saved records, receipts alone do not establish visual review.',assets:'read_review_assets returns 1-4 native images/audio with independent receipts; reduce batch on ASSET_BATCH_TOO_LARGE.',connection:'Independent heartbeat, bounded queue and execution deadlines; timed-out execution is not assumed cancelled.',lease:'Active work renews automatically; explicit renew_review remains available. Idle work is not renewed indefinitely.'});
Object.assign(manifest.review,{connection:'Queue 90s; execution 180s, extended only by completed-work progress up to 240s; queue plus execution max 270s. Heartbeats do not extend work. Transport uncertainty never auto-reexecutes a call. A stale executing page retains ownership until completion/disconnect.',compatibility:'New pages advertise tools and version. Unsupported tools fail before queueing. Old pages keep legacy single-asset support; inspect installed/running/page versions separately and reload client tool discovery when idle.',resourceLimits:'PDF canvas allocation is rejected above 40 million pixels or 32767 per dimension; no silent downscaling. This is not a total process memory limit.'});
manifest.completion.video='all frames and audio channels prepared; current brand basis, text, images and required audio reviewed; coverage.complete and assurance.complete true; human confirmation remains';
manifest.autoUpdate={protocol:1,sha256:crypto.createHash('sha256').update(data).digest('hex'),startup:true,intervalHours:6,retryMinutes:15,applyWhen:'idle',launcherScheme:'zhigao-desk'};
fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({version,sha256:manifest.autoUpdate.sha256,media:files}));

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
manifest.completion.video='all frames and audio channels prepared; current brand basis, text, images and required audio reviewed; coverage.complete and assurance.complete true; human confirmation remains';
manifest.autoUpdate={protocol:1,sha256:crypto.createHash('sha256').update(data).digest('hex'),startup:true,intervalHours:6,retryMinutes:15,applyWhen:'idle',launcherScheme:'zhigao-desk'};
fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({version,sha256:manifest.autoUpdate.sha256,media:files}));

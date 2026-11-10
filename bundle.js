// 交接 / 备份包：一个 .zip，里面是 manifest.json（项目、任务、稿件记录）和 files/ 下的原件。
// 只在本机生成和读取，不上传任何地方。
import {digest,stableJSON} from './review-assurance.js';
export const BUNDLE_KIND='zhigao-bundle',BUNDLE_VERSION=2;
const MANIFEST='manifest.json';
// 稿件里的 ArrayBuffer（原件、历史轮次原件）单独存为文件，manifest 只记路径。
function stripBuffers(doc,files){const d=structuredClone({...doc,buffer:null,rounds:[]});delete d.videoPreparation;delete d.originalFile;if(doc.buffer){const p=`files/${doc.id}/current`;files.push([p,doc.buffer]);d.bufferPath=p;}d.rounds=(doc.rounds||[]).map((r,i)=>{const x={...r,buffer:null};if(r.buffer){const p=`files/${doc.id}/round-${i+1}`;files.push([p,r.buffer]);x.bufferPath=p;}return x;});return d;}
export async function makeBundle({projects,items,docs,media,note,libraryAssets=[]}){
 const zip=new globalThis.JSZip(),files=[],out={kind:BUNDLE_KIND,version:BUNDLE_VERSION,created:new Date().toISOString(),note:note||'',projects:structuredClone(projects),items:structuredClone(items),docs:docs.map(d=>stripBuffers(d,files)),media:[],libraryAssets:[],projectHashes:{}};
 for(const p of projects)out.projectHashes[p.id]=await digest(stableJSON(p));
 for(const a of libraryAssets){const path=`library/${a.id}/original`;zip.file(path,a.file.buffer);out.libraryAssets.push({id:a.id,file:{...a.file,buffer:null},path,hash:await digest(a.file.buffer)});}
 for(const [p,buf] of files)zip.file(p,buf);
 for(const m of media){const p=`files/${m.id}/video-${m.name||'video'}`;zip.file(p,m.blob,{compression:'STORE'});out.media.push({id:m.id,path:p,type:m.blob.type||'video/mp4'});}
 zip.file(MANIFEST,JSON.stringify(out,null,1));
 return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6},mimeType:'application/zip'});
}
export async function readBundle(file){
 let zip;try{zip=await globalThis.JSZip.loadAsync(file);}catch{throw Error('这不是有效的交接包（.zip 无法打开）。');}
 const m=zip.file(MANIFEST);if(!m)throw Error('这不是知稿的交接包：缺少 manifest.json。');
 let data;try{data=JSON.parse(await m.async('string'));}catch{throw Error('交接包里的 manifest.json 已损坏。');}
 if(data.kind!==BUNDLE_KIND)throw Error('这不是知稿的交接包。');
 if(data.version>BUNDLE_VERSION)throw Error('这个交接包来自更新版本的工作台，请先更新工作台再导入。');
 for(const key of ['projects','items','docs'])if(!Array.isArray(data[key]))throw Error('交接包结构不完整：'+key);
 const projectIds=new Set(data.projects.map(p=>p.id));if(projectIds.size!==data.projects.length||data.projects.some(p=>typeof p.id!=='string'||!p.id||typeof p.name!=='string')||data.docs.some(d=>!projectIds.has(d.projectId)))throw Error('交接包品牌归属不完整。');
 if(data.version>=2)for(const p of data.projects)if(await digest(stableJSON(p))!==data.projectHashes?.[p.id])throw Error('交接包品牌资料版本校验失败。');
 const get=async p=>{const f=p&&zip.file(p);if(!f)throw Error(`交接包缺少文件：${p}`);return f.async('arraybuffer');};
 for(const d of data.docs){if(d.bufferPath){d.buffer=await get(d.bufferPath);delete d.bufferPath;}for(const r of d.rounds||[])if(r.bufferPath){r.buffer=await get(r.bufferPath);delete r.bufferPath;}}
 const media=[];for(const x of data.media||[]){const f=zip.file(x.path);if(f)media.push({id:x.id,blob:new Blob([await f.async('blob')],{type:x.type})});}
 const libraryAssets=[];for(const x of data.libraryAssets||[]){const buffer=await get(x.path);if(await digest(buffer)!==x.hash)throw Error('品牌资料原件校验失败。');libraryAssets.push({id:x.id,file:{...x.file,buffer}});}
 for(const p of data.projects)for(const d of p.library||[])if(d.ingestion?.assetKey&&!libraryAssets.some(a=>a.id===d.ingestion.assetKey))throw Error('交接包缺少品牌资料原件：'+d.title);
 return{...data,media,libraryAssets};
}
// 原站（旧版工作台）浏览器数据导出脚本：用户在原站页面按 F12 → Console 粘贴运行，下载 JSON 后再导入这里。
export const LEGACY_SCRIPT=`(async()=>{const s=JSON.parse(localStorage.getItem('zhigao-settings-v1')||'null');const db=await new Promise((ok,no)=>{const r=indexedDB.open('zhigao-desk');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});const names=[...db.objectStoreNames];const all=n=>new Promise((ok,no)=>{const q=db.transaction(n).objectStore(n).getAll();q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});const b64=b=>{const u=new Uint8Array(b);let x='';for(let i=0;i<u.length;i+=32768)x+=String.fromCharCode(...u.subarray(i,i+32768));return btoa(x);};const tasks=names.includes('tasks')?await all('tasks'):[];for(const t of tasks){if(t.buffer instanceof ArrayBuffer)t.buffer={b64:b64(t.buffer)};for(const r of t.rounds||[])if(r.buffer instanceof ArrayBuffer)r.buffer={b64:b64(r.buffer)};}const out={kind:'zhigao-legacy',exported:new Date().toISOString(),origin:location.origin,settings:s,tasks};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out)],{type:'application/json'}));a.download='知稿旧数据-'+new Date().toISOString().slice(0,10)+'.json';a.click();console.log('已导出 '+tasks.length+' 份稿件');})();`;
const unb64=s=>{const bin=atob(s),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u.buffer;};
export async function readLegacy(file){
 let data;try{data=JSON.parse(await file.text());}catch{throw Error('无法读取这个文件，请确认是从原站导出的 JSON。');}
 if(data?.kind!=='zhigao-legacy')throw Error('这不是原站导出的旧数据文件。');
 const fix=b=>b&&typeof b==='object'&&typeof b.b64==='string'?unb64(b.b64):null;
 for(const t of data.tasks||[]){t.buffer=fix(t.buffer);for(const r of t.rounds||[])r.buffer=fix(r.buffer);}
 return data;
}

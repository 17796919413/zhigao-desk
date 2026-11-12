// 交接 / 备份包：一个 .zip，里面是 manifest.json（项目、任务、稿件记录）和 files/ 下的原件。
// 只在本机生成和读取，不上传任何地方。
import {digest,stableJSON} from './review-assurance.js';
export const BUNDLE_KIND='zhigao-bundle',BUNDLE_VERSION=2;
const MANIFEST='manifest.json';
// 稿件里的 ArrayBuffer（原件、历史轮次原件）单独存为文件，manifest 只记路径。
function stripBuffers(doc,files){const d=structuredClone({...doc,buffer:null,rounds:[]});delete d.videoPreparation;delete d.originalFile;if(d.officeConversion)delete d.officeConversion.jobId;if(doc.officeOriginal?.buffer){const p=`files/${doc.id}/office-original`;files.push([p,doc.officeOriginal.buffer]);d.officeOriginal={...doc.officeOriginal,buffer:null,bufferPath:p};}
 d.brandFeedback=(doc.brandFeedback||[]).map((f,i)=>{const x={...f};if(f.originalAsset?.buffer){const p=`files/${doc.id}/feedback-${i}`;files.push([p,f.originalAsset.buffer]);x.originalAsset={...f.originalAsset,buffer:null,bufferPath:p};}return x;});if(doc.buffer){const p=`files/${doc.id}/current`;files.push([p,doc.buffer]);d.bufferPath=p;}d.rounds=(doc.rounds||[]).map((r,i)=>stripBuffers({...r,id:doc.id+'/round-'+(i+1),rounds:[]},files));return d;}
async function verifyOffice(d){if(d.officeConversion&&(!d.officeOriginal?.buffer||!d.buffer||await digest(d.officeOriginal.buffer)!==d.officeConversion.sourceHash||await digest(d.buffer)!==d.officeConversion.convertedHash))throw Error('稿件 Office 原件与转换副本校验失败。');for(const r of d.rounds||[])await verifyOffice(r);}
export async function makeBundle({projects,items,docs,media,note,libraryAssets=[]}){
 for(const d of docs)await verifyOffice(d);
 const zip=new globalThis.JSZip(),files=[],out={kind:BUNDLE_KIND,version:BUNDLE_VERSION,created:new Date().toISOString(),note:note||'',projects:structuredClone(projects),items:structuredClone(items),docs:docs.map(d=>stripBuffers(d,files)),media:[],libraryAssets:[],projectHashes:{}};
 for(const p of projects)out.projectHashes[p.id]=await digest(stableJSON(p));
 for(const a of libraryAssets){const path=`library/${a.id}/original`,file={...a.file},original=file.fileHandle?await file.fileHandle.getFile():file.originalFile,bytes=original instanceof Blob?await original.arrayBuffer():file.buffer;if(!bytes)throw Error('品牌资料原件缺失。');if(file.originalStamp&&(original.size!==file.originalStamp.size||original.lastModified!==file.originalStamp.lastModified))throw Error('本地品牌资料原件已变化，请重新导入后备份。');zip.file(path,bytes);if(file.conversion){const c={...file.conversion},convertedPath=`library/${a.id}/converted`;if(!c.buffer||await digest(c.buffer)!==c.convertedHash)throw Error('转换副本校验失败。');zip.file(convertedPath,c.buffer);delete c.buffer;delete c.jobId;file.conversion={...c,bufferPath:convertedPath};}delete file.originalFile;delete file.fileHandle;delete file.originalStamp;delete file.buffer;delete file.videoPreparation;delete file.videoAnalysis;out.libraryAssets.push({id:a.id,file,path,hash:await digest(bytes)});}
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
 async function restore(d){if(d.officeOriginal?.bufferPath){d.officeOriginal.buffer=await get(d.officeOriginal.bufferPath);delete d.officeOriginal.bufferPath;d.originalFile=new File([d.officeOriginal.buffer],d.officeOriginal.filename);}for(const f of d.brandFeedback||[])if(f.originalAsset?.bufferPath){f.originalAsset.buffer=await get(f.originalAsset.bufferPath);delete f.originalAsset.bufferPath;}if(d.bufferPath){d.buffer=await get(d.bufferPath);delete d.bufferPath;}for(const r of d.rounds||[])await restore(r);}
 for(const d of data.docs){await restore(d);await verifyOffice(d);}
 const media=[];for(const x of data.media||[]){const f=zip.file(x.path);if(f)media.push({id:x.id,blob:new Blob([await f.async('blob')],{type:x.type})});}
 const libraryAssets=[];for(const x of data.libraryAssets||[]){const buffer=await get(x.path);if(await digest(buffer)!==x.hash)throw Error('品牌资料原件校验失败。');if(x.file.conversion){const c=x.file.conversion;c.buffer=await get(c.bufferPath);delete c.bufferPath;if(await digest(c.buffer)!==c.convertedHash||await digest(buffer)!==c.sourceHash)throw Error('交接包转换件与原件不一致。');}libraryAssets.push({id:x.id,file:{...x.file,originalFile:new File([buffer],x.file.filename||'原件'),...(!['video','attachment','text'].includes(x.file.fmt)?{buffer}:{})}});}
 for(const p of data.projects)for(const d of p.library||[])if(d.ingestion?.format==='video'){d.ingestion.state='pending';d.ingestion.blockers=['交接后的本机需重新准备视频资料'];}
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

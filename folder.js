// 本地项目文件夹：用户亲自选一个文件夹，工作台在里面按“任务 / 阶段 / 用途”归档原件和输出。
// 浏览器只能写进用户授权过的文件夹；不支持的浏览器（如 Firefox）退回为普通下载。
export const folderSupported=()=>typeof globalThis.showDirectoryPicker==='function';
// Windows 文件名不允许的字符和保留名都替换掉；结尾的点和空格也去掉。
export function safeName(s,max=60){let v=String(s??'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').trim().slice(0,max);if(!v||/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(v))v=(v||'未命名')+'_';return v;}
export const SUB={orig:'01-达人原件',out:'02-审稿输出',notes:'03-意见单'};
export function stageDir(item,stage){return[safeName(`${item.author||'未填写达人'}-${item.platform}-${item.title||item.kind}`),safeName(stage)];}
export async function pickFolder(){return globalThis.showDirectoryPicker({id:'zhigao-project',mode:'readwrite'});}
// 权限：读状态不弹窗；要写入时只能在用户点击里申请。
export async function folderState(h){if(!h)return'none';try{return await h.queryPermission({mode:'readwrite'});}catch{return'denied';}}
export async function askFolder(h){try{return(await h.requestPermission({mode:'readwrite'}))==='granted';}catch{return false;}}
async function dirAt(root,parts){let d=root;for(const p of parts)d=await d.getDirectoryHandle(p,{create:true});return d;}
async function exists(dir,name){try{await dir.getFileHandle(name);return true;}catch{return false;}}
// 同名文件不覆盖：自动加“(2)”“(3)”，原件和已有输出都保留。
async function freeName(dir,name){if(!await exists(dir,name))return name;const m=name.match(/^(.*?)(\.[^.]*)?$/),base=m[1],ext=m[2]||'';for(let i=2;i<1000;i++){const n=`${base} (${i})${ext}`;if(!await exists(dir,n))return n;}throw Error('同名文件过多，请先整理文件夹。');}
const writers=new WeakMap();
export async function saveToFolder(root,parts,name,blob){
 const run=(writers.get(root)||Promise.resolve()).then(async()=>{
  const dir=await dirAt(root,parts),fn=await freeName(dir,safeName(name,120));let w;
  // fn is newly allocated by this writer; cleanup must never touch an existing user file.
  const fh=await dir.getFileHandle(fn,{create:true});
  try{w=await fh.createWritable();await w.write(blob);await w.close();}
  catch(e){try{await w?.abort?.();}catch{}try{await dir.removeEntry(fn);}catch{}throw e;}
  return [...parts,fn].join('/');
 });
 writers.set(root,run.catch(()=>{}));return run;
}
export async function readFromFolder(root,path){let d=root;const parts=path.split('/'),fn=parts.pop();for(const p of parts)d=await d.getDirectoryHandle(p);return(await d.getFileHandle(fn)).getFile();}

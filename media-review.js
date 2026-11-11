import {digest} from './review-assurance.js';
import {readPdf,renderPdfPage} from './pdf.js';
import {seekTo} from './video.js';
export const MEDIA_VERSION='1.9.0';
export const IMAGE_EXT=/\.(png|jpe?g|webp|bmp|gif|svg|tiff?|emf|wmf)$/i;
const mimeFor=p=>({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',bmp:'image/bmp',gif:'image/gif',svg:'image/svg+xml'}[p.split('.').pop().toLowerCase()]||'application/octet-stream');
const safeImage=p=>/\.(png|jpe?g|webp|bmp)$/i.test(p);
const xml=s=>{const d=new DOMParser().parseFromString(s,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('素材关系XML损坏');return d;};
const all=(d,n)=>Array.from(d.getElementsByTagNameNS('*',n));
const norm=(base,target)=>{const parts=target.startsWith('/')?[]:base.split('/').slice(0,-1);for(const p of target.split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return parts.join('/');};
function ownerFor(rels){return rels.replace('/_rels/','/').replace(/\.rels$/,'');}
function item(id,type,location,extra={}){return {id,type,location,required:true,readable:true,coverage:'full',...extra};}
export async function inspectReviewMedia(task){
 const assets=[],blockers=[],supplementalText=[];let sourceHash='text-only';
 const fmt=task.fmt||(task.buffer?'xlsx':'text');
 if(task.buffer)sourceHash=await digest(task.buffer);
 if(['docx','xlsx','pptx'].includes(fmt)){
  if(!task.buffer)throw Error('稿件原文件缺失，不能确认图片覆盖。');
  const zip=await globalThis.JSZip.loadAsync(task.buffer),prefix=fmt==='docx'?'word/':fmt==='pptx'?'ppt/':'xl/',paths=Object.keys(zip.files).filter(p=>p.startsWith(prefix)&&!zip.files[p].dir),locations=new Map(),referenced=new Set();
  for(const path of paths.filter(p=>p.endsWith('.rels'))){const d=xml(await zip.file(path).async('string')),owner=ownerFor(path);
   for(const r of all(d,'Relationship')){const type=r.getAttribute('Type')||'',target=r.getAttribute('Target')||'';
    if(!/(image|oleObject|chart|diagram|package|audio|video)$/.test(type))continue;
    if(r.getAttribute('TargetMode')==='External'){blockers.push(`外链素材未下载：${owner}（请将素材嵌入文件）`);continue;}
    const p=norm(owner,target);referenced.add(p);locations.set(p,[...(locations.get(p)||[]),owner]);
    if(!zip.file(p))blockers.push(`缺少关联素材：${p}`);
    else if(!type.endsWith('/image'))blockers.push(`尚不能完整呈现图表、SmartArt或嵌入对象：${p}`);
   }
  }
  const images=paths.filter(p=>p.includes('/media/')||referenced.has(p)&&IMAGE_EXT.test(p));
  for(const path of images){const readable=safeImage(path);assets.push(item('file:'+path,'image',(locations.get(path)||[path]).join('；'),{path,mimeType:mimeFor(path),readable,coverage:readable?'full':'unsupported'}));if(!readable)blockers.push(`图片格式或动画尚不支持完整审核：${path}`);}
  if(fmt==='pptx'){
   for(const path of paths.filter(p=>/^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(p)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){
    const d=xml(await zip.file(path).async('string')),text=all(d,'p').map(p=>all(p,'t').map(t=>t.textContent).join('')).filter(Boolean).join('\n');
    if(text.trim())supplementalText.push({id:'ppt:'+path,address:path,original:text,current:text,note:'品牌反馈附件，只读'});
   }
  }
  if(fmt==='docx'){
   for(const path of paths.filter(p=>/\.xml$/.test(p)&&(/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(p)))){
    const d=xml(await zip.file(path).async('string'));
    for(const [i,p] of all(d,'p').entries()){
     let textbox=false;for(let n=p.parentElement;n;n=n.parentElement)if(n.localName==='txbxContent')textbox=true;
     if(path==='word/document.xml'&&!textbox)continue;
     const text=all(p,'t').map(t=>t.textContent).join('');if(text.trim())supplementalText.push({id:`extra:${path}:${i}`,address:`${path} · ${textbox?'文本框':'补充文字'} ${i+1}`,original:text,current:text,note:'只读补充内容，修改建议请写入 warnings'});
    }
   }
  }
 }else if(fmt==='pdf'){
  if(!task.buffer)throw Error('PDF原件缺失。');const pages=task.pages||(await readPdf(task.buffer)).pages;
  for(const p of pages){assets.push(item('page:'+p.n,'pdf-page',`PDF第${p.n}页`,{page:p.n,mimeType:'image/png'}));if(p.text)supplementalText.push({id:'pdf-text:'+p.n,address:`PDF第${p.n}页文字`,original:p.text,current:p.text,note:'PDF只读，修改建议请写入 warnings'});}
 }else if(fmt==='image'){
  const readable=safeImage(task.filename);assets.push(item('image:original','image','图片原件',{mimeType:mimeFor(task.filename),readable,coverage:readable?'full':'unsupported'}));if(!readable)blockers.push('当前图片格式或动画尚不能完整审核，请提供静态 PNG/JPG/WebP。');
 }else if(fmt==='video'){
  sourceHash=await digest(JSON.stringify({name:task.filename,size:task.size,duration:task.duration,revision:task.mediaRevision||task.updated}));
  assets.push(item('video:visual','video-frame','视频画面（按时间抽检）',{coverage:'sampled',duration:task.duration}));
  if(task.duration>0&&task.duration<=1800&&task.size<=100*1024*1024){for(let start=0;start<task.duration;start+=45)assets.push(item('video:audio:'+start,'audio',`视频音轨 ${start}–${Math.min(start+45,task.duration)} 秒`,{start,end:Math.min(start+45,task.duration)}));}
  else{assets.push(item('video:audio','audio','视频音轨',{coverage:'unsupported',readable:false}));blockers.push('视频音轨自动读取支持100MB以内、30分钟以内且时长可识别的文件。');}
  blockers.push('视频画面目前仅支持按时间抽检，不能证明全片逐帧覆盖；完整成片仍需人工播放复核。');
 }
 return {version:MEDIA_VERSION,sourceHash,assets,supplementalText,blockers:[...new Set(blockers)],status:blockers.length?'blocked':'ready'};
}
const dataURL=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('无法读取图片'));r.readAsDataURL(blob);});
async function staticImage(blob){
 if(blob.size>12*1024*1024)throw Error('图片超过12MB，无法完整传给客户端；请提供可读的分图，不得标记已审。');
 const bitmap=await createImageBitmap(blob);if(bitmap.width*bitmap.height>40000000){bitmap.close();throw Error('图片像素过大，请分图后审阅。');}
 if(blob.type==='image/bmp'){const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return c.toDataURL('image/png');}bitmap.close();
 return dataURL(blob);
}
async function audioSegment(blob,asset){
 if(!(blob instanceof Blob)||blob.size>100*1024*1024)throw Error('音轨原件缺失或超过本地解码大小限制。');
 const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)throw Error('浏览器不支持音轨解码。');
 const context=new Audio();let decoded;try{decoded=await context.decodeAudioData(await blob.arrayBuffer());}catch{throw Error('浏览器无法解码该音轨，请提供独立WAV音轨；不能标记已听审。');}finally{await context.close();}
 if(decoded.numberOfChannels>2)throw Error('多声道音轨尚不支持完整审核。');
 const duration=asset.end-asset.start;if(decoded.duration+0.15<asset.end)throw Error('实际音轨长度不足，需核对是否为静音尾段，不能自动放行。');
 const rate=16000,channels=decoded.numberOfChannels,offline=new OfflineAudioContext(channels,Math.ceil(duration*rate),rate),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start(0,asset.start,duration);const samples=await offline.startRendering(),length=samples.length,buf=new ArrayBuffer(44+length*channels*2),v=new DataView(buf),put=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
 put(0,'RIFF');v.setUint32(4,buf.byteLength-8,true);put(8,'WAVE');put(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,rate,true);v.setUint32(28,rate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,buf.byteLength-44,true);
 const streams=Array.from({length:channels},(_,i)=>samples.getChannelData(i));let at=44;for(let i=0;i<length;i++)for(const channel of streams){const s=Math.max(-1,Math.min(1,channel[i]));v.setInt16(at,Math.round(s*(s<0?32768:32767)),true);at+=2;}
 const url=await dataURL(new Blob([buf],{type:'audio/wav'}));return {assetId:asset.id,type:'audio',mimeType:'audio/wav',data:url.split(',')[1],coverage:'full',location:asset.location,start:asset.start,end:asset.end,notice:'原视频的这一段音轨；请听审并报告口播及声音问题，不代表其他音轨段或画面已审。'};
}
export async function readReviewAsset(task,asset,options={}){
 if(!asset.readable)throw Error('该素材暂无完整读取能力，不能标记已审。');let url;
 if(asset.type==='audio')return audioSegment(options.blob||task.originalFile,asset);
 if(asset.type==='pdf-page')url=await renderPdfPage(task.buffer,asset.page,1600);
 else if(asset.type==='video-frame'){
  const time=Number(options.time);if(!Number.isFinite(time)||time<0||time>(task.duration||0))throw Error('请指定视频有效时间 time（秒）。');
  const blob=options.blob||task.originalFile;if(!(blob instanceof Blob))throw Error('视频原文件缺失，请在工作台重新关联。');
  const v=document.createElement('video'),src=URL.createObjectURL(blob);v.muted=true;v.preload='auto';
  try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('视频加载超时')),12000);v.onloadeddata=()=>{clearTimeout(timer);resolve();};v.onerror=()=>{clearTimeout(timer);reject(Error('视频编码无法读取'));};v.src=src;});if(!await seekTo(v,time))throw Error('视频定位失败。');const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);url=c.toDataURL('image/jpeg',0.94);}finally{v.removeAttribute('src');v.load();URL.revokeObjectURL(src);}
 }else if(asset.path){const zip=await globalThis.JSZip.loadAsync(task.buffer),f=zip.file(asset.path);if(!f)throw Error('图片已丢失。');url=await staticImage(new Blob([await f.async('uint8array')],{type:asset.mimeType}));}
 else url=await staticImage(new Blob([task.buffer],{type:asset.mimeType}));
 if(url.length>17*1024*1024)throw Error('图片响应过大，未完整传输；请分图后重审。');
 const match=url.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);if(!match)throw Error('图片编码失败。');
 return {assetId:asset.id,type:'image',mimeType:match[1],data:match[2],coverage:asset.coverage,location:asset.location,...(asset.type==='video-frame'?{time:options.time,notice:'仅此时刻画面，不能代表全片或音轨'}:{})};
}

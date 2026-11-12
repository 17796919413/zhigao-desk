// PDF 只读审核：逐页渲染和抽取文字，意见按页记录。工作台不修改 PDF 原件，改稿另出意见单。
const BASE=new URL('./vendor/pdfjs/',import.meta.url).href;
const NL=String.fromCharCode(10);
const documents=new Map(),images=new Map();
const MAX_DOCUMENT_BYTES=96*1024*1024,MAX_IMAGE_BYTES=24*1024*1024;
let imageBytes=0;
export const pdfCacheStats={opens:0,documentHits:0,renders:0,imageHits:0};
async function contentKey(buffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function evict(key,entry){if(entry.users)return;documents.delete(key);clearTimeout(entry.timer);entry.task.destroy().catch(()=>{});}
function trimDocuments(){let size=[...documents.values()].reduce((n,e)=>n+e.bytes,0);for(const [key,e] of documents){if(documents.size<=3&&size<=MAX_DOCUMENT_BYTES)break;if(!e.users){size-=e.bytes;evict(key,e);}}}
export function clearPdfCache(){images.clear();imageBytes=0;for(const [key,e] of documents){e.discard=true;evict(key,e);}}
let lib=null;
async function pdfjs(){if(!lib){lib=await import('./vendor/pdfjs/build/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc=BASE+'build/pdf.worker.min.mjs';}return lib;}
// pdf.js 6.x：destroy() 在加载任务上，文档对象只有 cleanup()。
async function withPdf(buffer,fn){
 // Always hash current bytes: replacement or in-place mutation cannot hit an old document.
 const key=await contentKey(buffer),library=await pdfjs();let entry=documents.get(key);
 if(!entry){const task=library.getDocument({data:new Uint8Array(buffer.slice(0)),cMapUrl:BASE+'cmaps/',cMapPacked:true,standardFontDataUrl:BASE+'standard_fonts/',wasmUrl:BASE+'wasm/',isEvalSupported:false});entry={task,bytes:buffer.byteLength,users:0,queue:Promise.resolve()};documents.set(key,entry);pdfCacheStats.opens++;}else{pdfCacheStats.documentHits++;documents.delete(key);documents.set(key,entry);}
 clearTimeout(entry.timer);entry.users++;
 const run=entry.queue.then(async()=>fn(await entry.task.promise,key));entry.queue=run.catch(()=>{});
 try{return await run;}catch(error){entry.discard=true;throw error;}finally{entry.users--;if(entry.discard)evict(key,entry);else{entry.timer=setTimeout(()=>evict(key,entry),60000);entry.timer.unref?.();trimDocuments();}}
}
function pageText(content){let s='';for(const it of content.items){if(typeof it.str!=='string')continue;s+=it.str;if(it.hasEOL)s+=NL;}return s.split(NL).map(x=>x.trim()).filter(Boolean).join(NL);}
function pageCanvas(viewport){
 const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>32767||height>32767||width*height>40000000)
  throw Object.assign(Error('PDF 页面渲染尺寸超过安全预算，请拆分超大页面后重新导入；本页未读取，不能计作已审。'),{code:'PDF_CANVAS_LIMIT',details:{width,height,maxPixels:40000000,maxDimension:32767}});
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;
}
function pageImage(canvas){const data=canvas.toDataURL('image/png');if(!data.startsWith('data:image/png;base64,'))throw Object.assign(Error('PDF 页面图像生成失败，请检查浏览器资源并重新读取；本页未发放回执。'),{code:'PDF_RENDER_FAILED'});return data;}
export async function readPdf(buffer,onProgress=()=>{}){
 try{
  return await withPdf(buffer,async doc=>{
   const pages=[];for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n),v=p.getViewport({scale:1});pages.push({n,text:pageText(await p.getTextContent()),w:Math.round(v.width),h:Math.round(v.height)});p.cleanup();onProgress('pdf-page-read');}
   return {pages,textless:pages.every(p=>!p.text)};
  });
 }catch(e){if(e?.message?.startsWith('PDF 超过'))throw e;throw Error(e?.name==='PasswordException'?'这个 PDF 设有密码，请先解除密码再导入。':'无法读取这个 PDF，请确认文件未损坏。');}
}
// 逐页渲染成图片地址交给 onPage；页面重绘时直接用已渲染的图片，不再重新解析 PDF。
export function renderPdfImages(buffer,width,onPage){
 return withPdf(buffer,async doc=>{const ratio=Math.min(2,Math.max(1.5,globalThis.devicePixelRatio||1));for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n);let canvas;try{const base=p.getViewport({scale:1}),vp=p.getViewport({scale:width/base.width*ratio});canvas=pageCanvas(vp);await p.render({canvas,canvasContext:canvas.getContext('2d'),viewport:vp}).promise;onPage(n,pageImage(canvas));}finally{p.cleanup();if(canvas)canvas.width=canvas.height=0;}}});
}
// Agent reads one complete page at a time; no text-only substitute for visual review.
export function renderPdfPage(buffer,pageNumber,width=1600){return withPdf(buffer,async(doc,hash)=>{
 if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>doc.numPages)throw Error('PDF页码无效。');
 const key=hash+':'+pageNumber+':'+width,cached=images.get(key);if(cached){images.delete(key);images.set(key,cached);pdfCacheStats.imageHits++;return cached;}
 const page=await doc.getPage(pageNumber),base=page.getViewport({scale:1}),vp=page.getViewport({scale:Math.min(3,width/base.width)});let canvas;
 try{canvas=pageCanvas(vp);await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport:vp}).promise;const data=pageImage(canvas);pdfCacheStats.renders++;
  if(data.length*2<=MAX_IMAGE_BYTES){images.set(key,data);imageBytes+=data.length*2;while(images.size>12||imageBytes>MAX_IMAGE_BYTES){const first=images.keys().next().value;imageBytes-=images.get(first).length*2;images.delete(first);}}return data;
 }finally{page.cleanup();if(canvas)canvas.width=canvas.height=0;}
});}

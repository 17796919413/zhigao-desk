// PDF 只读审核：逐页渲染和抽取文字，意见按页记录。工作台不修改 PDF 原件，改稿另出意见单。
const BASE=new URL('./vendor/pdfjs/',import.meta.url).href;
const NL=String.fromCharCode(10);
let lib=null;
async function pdfjs(){if(!lib){lib=await import('./vendor/pdfjs/build/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc=BASE+'build/pdf.worker.min.mjs';}return lib;}
// pdf.js 6.x：destroy() 在加载任务上，文档对象只有 cleanup()。
async function withPdf(buffer,fn){
 const task=(await pdfjs()).getDocument({data:new Uint8Array(buffer.slice(0)),cMapUrl:BASE+'cmaps/',cMapPacked:true,standardFontDataUrl:BASE+'standard_fonts/',wasmUrl:BASE+'wasm/',isEvalSupported:false});
 try{return await fn(await task.promise);}finally{await task.destroy();}
}
function pageText(content){let s='';for(const it of content.items){if(typeof it.str!=='string')continue;s+=it.str;if(it.hasEOL)s+=NL;}return s.split(NL).map(x=>x.trim()).filter(Boolean).join(NL);}
export async function readPdf(buffer){
 try{
  return await withPdf(buffer,async doc=>{
   if(doc.numPages>200)throw Error('PDF 超过 200 页，请拆分后再导入。');
   const pages=[];for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n),v=p.getViewport({scale:1});pages.push({n,text:pageText(await p.getTextContent()),w:Math.round(v.width),h:Math.round(v.height)});p.cleanup();}
   return {pages,textless:pages.every(p=>!p.text)};
  });
 }catch(e){if(e?.message?.startsWith('PDF 超过'))throw e;throw Error(e?.name==='PasswordException'?'这个 PDF 设有密码，请先解除密码再导入。':'无法读取这个 PDF，请确认文件未损坏。');}
}
// 逐页渲染成图片地址交给 onPage；页面重绘时直接用已渲染的图片，不再重新解析 PDF。
export function renderPdfImages(buffer,width,onPage){
 return withPdf(buffer,async doc=>{const ratio=Math.min(2,Math.max(1.5,globalThis.devicePixelRatio||1));for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n),base=p.getViewport({scale:1}),vp=p.getViewport({scale:width/base.width*ratio}),canvas=document.createElement('canvas');canvas.width=Math.floor(vp.width);canvas.height=Math.floor(vp.height);await p.render({canvas,canvasContext:canvas.getContext('2d'),viewport:vp}).promise;p.cleanup();onPage(n,canvas.toDataURL('image/png'));canvas.width=canvas.height=0;}});
}

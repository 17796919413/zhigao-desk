import {readDocx} from './docx.js';
import {readPdf} from './pdf.js';
import {readWorkbook,workbookCells} from './xlsx.js';
import {inspectReviewMedia,IMAGE_EXT} from './media-review.js';
export const LIBRARY_VIDEO_EXT=/\.(mp4|mov|m4v|webm|mkv|avi|wmv|mpeg|mpg)$/i;

export function inferLibraryKind(title,text){
  for(const source of [title,text.slice(0,800)]){
    if(/口径|禁用|禁词|硬性要求|审稿规范/.test(source))return '口径与禁用词';
    if(/反馈|修改意见/.test(source))return '品牌反馈汇总';
    if(/brief|需求简报/i.test(source))return 'Brief';
    if(/产品|参数|面料|规格|卖点/.test(source))return '产品资料';
  }
  return '其他';
}
export async function parseLibraryFile(file,{feedback=false}={}){
 if(!file.size)throw Error('文件为空。');
 const ext=file.name.split('.').pop().toLowerCase();
 const fmt=LIBRARY_VIDEO_EXT.test(file.name)?'video':IMAGE_EXT.test(file.name)?'image':['docx','pdf','pptx','xlsx'].includes(ext)?ext:['txt','md','csv','json','srt','vtt','log'].includes(ext)?'text':'attachment';
 let text='',inventory={version:'library-v3',sourceHash:null,assets:[],blockers:[]};
 const originalAsset={filename:file.name,fmt,originalFile:file,size:file.size,cells:[],mediaRevision:crypto.randomUUID()};
 try{
  if(fmt==='text')text=await file.text();
  else if(fmt==='video'){text='音视频资料，等待本机完整解析。';inventory.blockers=['待本机准备完整转写、画面和原声'];}
  else if(fmt==='attachment'){text='原件已保存，等待格式转换。';inventory.blockers=[['ppt','doc','xls'].includes(ext)?'原件已保存，连接 AI 读取资料或审稿时会自动处理格式；需要安装组件时再确认，完成后继续原任务。':'此格式尚无完整解析器，请由本机 AI 转换为 PDF、图片或文本后导入；不能当作已读取。'];}
  else{
   originalAsset.buffer=await file.arrayBuffer();
   if(fmt==='docx')text=(await readDocx(originalAsset.buffer)).cells.map(c=>c.original??c.current??'').join('\n\n');
   if(fmt==='xlsx')text=workbookCells(await readWorkbook(originalAsset.buffer)).map(c=>c.original??c.current??'').join('\n\n');
   if(fmt==='pdf'){const d=await readPdf(originalAsset.buffer);originalAsset.pages=d.pages;text=d.pages.map(p=>p.text||'').join('\n\n');}
   inventory=await inspectReviewMedia(originalAsset);
   if(['docx','pptx'].includes(fmt))text=[text,...inventory.supplementalText.map(c=>c.current)].filter(Boolean).join('\n\n');
   if(!text.trim())text=fmt==='pdf'?'扫描资料':fmt==='pptx'?'演示文稿图片资料':'图片资料';
  }
 }catch(e){if(feedback)throw e;const message=/end of central directory|corrupt zip|invalid zip/i.test(e.message)?'文件结构不完整或已损坏，请用原软件打开并另存后重新导入':e.message;inventory.blockers=['解析失败：'+message+'。原件已保留，可重新解析。'];text='原件已保存，解析未完成。';}
 if(feedback&&fmt==='attachment')throw Error(inventory.blockers[0]);
 const title=file.name.replace(/\.[^.]+$/,'');
 return {title,kind:inferLibraryKind(title,text),text,source:'',active:true,...(feedback&&fmt==='text'?{}:{originalAsset,ingestion:{version:inventory.version,format:fmt,filename:file.name,size:file.size,sourceHash:inventory.sourceHash,assets:inventory.assets.length,blockers:inventory.blockers,state:fmt==='video'?'pending':inventory.blockers.length?'blocked':'ready'}})};
}

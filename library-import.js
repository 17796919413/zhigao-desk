import {readDocx} from './docx.js';
import {readPdf} from './pdf.js';
import {inspectReviewMedia,IMAGE_EXT} from './media-review.js';

export function inferLibraryKind(title,text){
  for(const source of [title,text.slice(0,800)]){
    if(/口径|禁用|禁词|硬性要求|审稿规范/.test(source))return '口径与禁用词';
    if(/反馈|修改意见/.test(source))return '品牌反馈汇总';
    if(/brief|需求简报/i.test(source))return 'Brief';
    if(/产品|参数|面料|规格|卖点/.test(source))return '产品资料';
  }
  return '其他';
}
export async function parseLibraryFile(file){
  if(!/\.(txt|md|docx|pdf)$/i.test(file.name)&&!IMAGE_EXT.test(file.name))throw Error('支持 Word、PDF、图片、TXT、Markdown。');
  if(file.size>15*1024*1024)throw Error('文件超过15 MB，请拆分后导入。');
  let text,originalAsset=null,inventory=null;
  if(/\.docx$/i.test(file.name)){
    const buffer=await file.arrayBuffer(),d=await readDocx(buffer);text=d.cells.map(c=>c.original??c.current??'').join('\n\n');originalAsset={filename:file.name,fmt:'docx',buffer,cells:[]};
  }else if(/\.pdf$/i.test(file.name)){
    const buffer=await file.arrayBuffer(),d=await readPdf(buffer);text=d.pages.map(p=>p.text||'').join('\n\n');originalAsset={filename:file.name,fmt:'pdf',buffer,pages:d.pages,cells:[]};
  }else if(IMAGE_EXT.test(file.name)){
    text='';originalAsset={filename:file.name,fmt:'image',buffer:await file.arrayBuffer(),cells:[]};
  }else text=await file.text();
  if(originalAsset){inventory=await inspectReviewMedia(originalAsset);if(originalAsset.fmt==='docx')text=[text,...inventory.supplementalText.map(c=>c.current)].filter(Boolean).join('\n\n');if(!text.trim()&&inventory.assets.length)text=originalAsset.fmt==='pdf'?'扫描资料':'图片资料';}
  if(!text.trim())throw Error('文件内容为空。');
  if(text.length>200000)throw Error('正文超过20万字，请拆分后导入。');
  const title=file.name.replace(/\.[^.]+$/,'');
  return {title,kind:inferLibraryKind(title,text),text,source:'',active:true,...(originalAsset?{originalAsset,ingestion:{version:inventory.version,format:originalAsset.fmt,sourceHash:inventory.sourceHash,assets:inventory.assets.length,blockers:inventory.blockers}}:{})};
}

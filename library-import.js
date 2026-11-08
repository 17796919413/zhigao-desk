import {readDocx} from './docx.js';
import {readPdf} from './pdf.js';

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
  if(!/\.(txt|md|docx|pdf)$/i.test(file.name))throw Error('支持 Word、PDF、TXT、Markdown。');
  if(file.size>15*1024*1024)throw Error('文件超过15 MB，请拆分后导入。');
  let text;
  if(/\.docx$/i.test(file.name)){
    const d=await readDocx(await file.arrayBuffer());text=d.cells.map(c=>c.original??c.current??'').join('\n\n');
  }else if(/\.pdf$/i.test(file.name)){
    const d=await readPdf(await file.arrayBuffer());text=d.pages.map(p=>p.text||'').join('\n\n');
    if(!text.trim())throw Error('PDF没有可提取文字，请使用文字版。');
  }else text=await file.text();
  if(!text.trim())throw Error('文件内容为空。');
  if(text.length>200000)throw Error('正文超过20万字，请拆分后导入。');
  const title=file.name.replace(/\.[^.]+$/,'');
  return {title,kind:inferLibraryKind(title,text),text,source:'',active:true};
}

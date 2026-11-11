import {parseLibraryFile} from './library-import.js';
import {inspectReviewMedia} from './media-review.js';

// Identity, not creator name, determines which draft can use an attachment.
export const feedbackFor=t=>(t.brandFeedback||[]).filter(f=>f.projectId===t.projectId&&f.docId===t.id&&f.round===(t.flow?.round||1));
export function feedbackRecord(t,data){return {...data,id:crypto.randomUUID(),projectId:t.projectId,docId:t.id,round:t.flow?.round||1,created:new Date().toISOString()};}
export async function parseFeedbackFile(file){
 if(/\.ppt$/i.test(file.name))throw Error('旧版 .ppt 请另存为 .pptx 或 PDF 后添加，原文和截图都能一起审核。');
 if(/\.pptx$/i.test(file.name)){
  const buffer=await file.arrayBuffer(),originalAsset={fmt:'pptx',filename:file.name,buffer,cells:[]};
  const inventory=await inspectReviewMedia(originalAsset),text=inventory.supplementalText.map(c=>c.current).join('\n\n');
  if(!text.trim()&&!inventory.assets.length)throw Error('演示文稿没有可读取的文字或图片。');
  return {title:file.name,text:text||'演示文稿图片反馈',originalAsset,ingestion:{sourceHash:inventory.sourceHash,blockers:inventory.blockers}};
 }
 const parsed=await parseLibraryFile(file,{feedback:true});
 return {...parsed,title:file.name};
}

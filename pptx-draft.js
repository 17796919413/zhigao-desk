import {diffChars} from './engine.js';

const A='http://schemas.openxmlformats.org/drawingml/2006/main';
const parts=zip=>Object.keys(zip.files).filter(p=>/^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(p)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
async function paragraphs(zip,path){const doc=new DOMParser().parseFromString(await zip.file(path).async('string'),'application/xml');if(doc.querySelector('parsererror'))throw Error('演示文稿 XML 损坏：'+path);return {doc,ps:[...doc.getElementsByTagNameNS(A,'p')]};}
const nodes=p=>[...p.getElementsByTagNameNS(A,'t')];
export async function readSlideCells(buffer){const zip=await JSZip.loadAsync(buffer),cells=[];
 for(const path of parts(zip)){const {ps}=await paragraphs(zip,path);ps.forEach((p,i)=>{const text=nodes(p).map(n=>n.textContent).join('');if(text.trim())cells.push({id:`${path}#${i}`,address:(path.includes('notesSlide')?'备注 ':'幻灯片 ')+path.match(/(\d+)\.xml$/)[1]+` · 段落 ${i+1}`,original:text,current:text,...([...p.children].some(c=>!['r','pPr','endParaRPr'].includes(c.localName))?{note:'含动态字段或换行，只读'}:{})});});}return cells;
}
export async function writeSlideDraft(buffer,cells){const zip=await JSZip.loadAsync(buffer),changed=new Map();
 for(const c of cells.filter(c=>c.current!==c.original)){const [path,index]=c.id.split('#');if(!parts(zip).includes(path)||c.note)throw Error('不能定位幻灯片文字：'+c.address);
  if(!changed.has(path))changed.set(path,await paragraphs(zip,path));const {doc,ps}=changed.get(path),p=ps[Number(index)],ts=p&&nodes(p);
  if(!ts?.length||ts.map(t=>t.textContent).join('')!==c.original)throw Error('原始幻灯片文字已变更：'+c.address);
  const chars=ts.flatMap(t=>Array.from(t.textContent,()=>t.parentNode)),groups=[];let pos=0;
  for(const {type,text} of diffChars(c.original,c.current)){for(const ch of text){const run=chars[Math.min(pos,chars.length-1)];if(type!=='add')pos++;if(type==='delete')continue;const last=groups.at(-1);if(last?.run===run&&last.type===type)last.text+=ch;else groups.push({run,type,text:ch});}}
  for(const {run,type,text} of groups){const copy=run.cloneNode(true);copy.getElementsByTagNameNS(A,'t')[0].textContent=text;if(type==='add'){let pr=copy.getElementsByTagNameNS(A,'rPr')[0];if(!pr){pr=doc.createElementNS(A,'a:rPr');copy.prepend(pr);}for(const el of [...pr.children])if(['noFill','solidFill','gradFill','blipFill','pattFill','grpFill'].includes(el.localName))el.remove();const fill=doc.createElementNS(A,'a:solidFill'),rgb=doc.createElementNS(A,'a:srgbClr');rgb.setAttribute('val','FF0000');fill.append(rgb);pr.insertBefore(fill,[...pr.children].find(el=>el.localName!=='ln')||null);}p.insertBefore(copy,ts[0].parentNode);}for(const run of new Set(ts.map(t=>t.parentNode)))run.remove();
 }for(const [path,{doc}] of changed)zip.file(path,new XMLSerializer().serializeToString(doc));return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
}

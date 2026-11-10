// Word (.docx) 按段落读写。只改 word/document.xml，其余部分原样保留；新增、替换的字标红。
import {diffChars} from './engine.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS='http://www.w3.org/XML/1998/namespace';
const TAB=String.fromCharCode(9),NL=String.fromCharCode(10);
const kids=e=>Array.from(e.childNodes).filter(x=>x.nodeType===1);
const isW=(e,name)=>e.namespaceURI===W&&e.localName===name;
const firstW=(e,name)=>kids(e).find(x=>isW(x,name))||null;
const wAll=(e,name)=>Array.from(e.getElementsByTagNameNS(W,name));
const ser=n=>new XMLSerializer().serializeToString(n);
function parse(text){const d=new DOMParser().parseFromString(text,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('Word 文档 XML 无法解析。');return d;}
function inside(node,name){for(let p=node.parentNode;p;p=p.parentNode)if(p.namespaceURI===W&&p.localName===name)return true;return false;}
const PARA_OK=new Set(['pPr','r','bookmarkStart','bookmarkEnd','proofErr','commentRangeStart','commentRangeEnd','permStart','permEnd']);
const RUN_OK=new Set(['rPr','t','tab','br','cr','lastRenderedPageBreak']);
const AFTER_COLOR=new Set(['spacing','w','kern','position','sz','szCs','highlight','u','effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','oMath']);
function runText(r){let s='';for(const c of kids(r)){if(c.namespaceURI!==W)continue;if(c.localName==='t')s+=c.textContent;else if(c.localName==='tab')s+=TAB;else if(c.localName==='br'||c.localName==='cr')s+=NL;}return s;}
function runLocked(r){return kids(r).some(c=>c.namespaceURI!==W||!RUN_OK.has(c.localName)||(c.localName==='br'&&!['','textWrapping'].includes(c.getAttributeNS(W,'type')||'')));}
const paragraphs=doc=>wAll(doc,'p').filter(p=>!inside(p,'txbxContent'));
function analyse(p){let locked=kids(p).some(c=>c.namespaceURI!==W||!PARA_OK.has(c.localName)),text='';for(const r of wAll(p,'r')){if(inside(r,'txbxContent'))continue;text+=runText(r);if(runLocked(r))locked=true;}return {text,locked,inTable:inside(p,'tc')};}
export async function readDocx(buffer){
 let zip;try{zip=await globalThis.JSZip.loadAsync(buffer);}catch{throw Error('无法读取这个 .docx，请确认文件未加密、未损坏。');}
 let size=0;for(const entry of Object.values(zip.files))size+=entry._data?.uncompressedSize||0;
 if(size>60000000)throw Error('文档展开后超过 60 MB，请精简图片或拆分文件。');
 const file=zip.file('word/document.xml');if(!file)throw Error('这不是有效的 .docx：缺少 word/document.xml。');
 const doc=parse(await file.async('string'));
 if(['ins','del','moveFrom','moveTo'].some(n=>wAll(doc,n).length))throw Error('文档含修订痕迹。请先在 Word 中接受或拒绝全部修订，另存后再导入。');
 const cells=[];let k=0;
 paragraphs(doc).forEach((p,i)=>{const a=analyse(p);if(!a.text.trim())return;k++;cells.push({id:`p${i}`,address:`${a.inTable?'表格内 · ':''}段落 ${String(k).padStart(2,'0')}`,original:a.text,current:a.text,...(a.locked?{note:'含链接/图片/域，不能自动改写'}:{})});});
  if(!cells.length&&!wAll(doc,'drawing').length&&!wAll(doc,'pict').length&&!wAll(doc,'txbxContent').length)throw Error('没有读到可审校的文字或图片。');
 if(cells.reduce((n,c)=>n+c.original.length,0)>100000)throw Error('正文超过 10 万字，请分批审稿。');
 return {zip,cells};
}
// 红字：去掉原有颜色和 WPS 的 w14:textFill（它会盖过 w:color），并把 w:color 放在 rPr 的合法位置。
function redProps(doc,base){
 const n=base?base.cloneNode(true):doc.createElementNS(W,'w:rPr');
 for(const c of kids(n))if(isW(c,'color')||c.localName==='textFill')n.removeChild(c);
 const color=doc.createElementNS(W,'w:color');color.setAttributeNS(W,'w:val','FF0000');
 n.insertBefore(color,kids(n).find(c=>c.namespaceURI!==W||AFTER_COLOR.has(c.localName))||null);
 return n;
}
function newRun(doc,props,text){
 const r=doc.createElementNS(W,'w:r');if(props)r.appendChild(props.cloneNode(true));
 let buf='';const flush=()=>{if(!buf)return;const t=doc.createElementNS(W,'w:t');t.setAttributeNS(XML_NS,'xml:space','preserve');t.textContent=buf;r.appendChild(t);buf='';};
 for(const ch of text){if(ch===TAB){flush();r.appendChild(doc.createElementNS(W,'w:tab'));}else if(ch===NL){flush();r.appendChild(doc.createElementNS(W,'w:br'));}else buf+=ch;}
 flush();return r;
}
function rewrite(doc,p,original,current){
 const runs=kids(p).filter(c=>isW(c,'r')),chars=[];
 for(const r of runs){const rp=firstW(r,'rPr');for(const ch of Array.from(runText(r)))chars.push(rp);}
 if(chars.length!==Array.from(original).length)throw Error('段落内容与读取时不一致，请重新导入原文件。');
 const keys=new Map(),reds=new Map(),groups=[];
 const keyOf=n=>{if(!n)return '';if(!keys.has(n))keys.set(n,ser(n));return keys.get(n);};
 const red=b=>{if(!reds.has(b))reds.set(b,redProps(doc,b));return reds.get(b);};
 const emit=(ch,props)=>{const key=keyOf(props),last=groups.at(-1);if(last&&last.key===key)last.text+=ch;else groups.push({key,props,text:ch});};
 let pos=0;
 for(const part of diffChars(original,current)){
  const list=Array.from(part.text);
  if(part.type==='delete'){pos+=list.length;continue;}
  for(const ch of list){if(part.type==='same'){emit(ch,chars[pos]||null);pos++;}else emit(ch,red(chars[Math.min(pos,chars.length-1)]||null));}
 }
 const ref=runs[0];
 for(const g of groups)p.insertBefore(newRun(doc,g.props,g.text),ref);
 for(const r of runs)p.removeChild(r);
}
export async function writeDocx(d,cells){
 // 每次从上传的原件重新解析，重复导出不会累积修改。
 const zip=await globalThis.JSZip.loadAsync(await d.zip.generateAsync({type:'uint8array'}));
 const doc=parse(await zip.file('word/document.xml').async('string')),ps=paragraphs(doc);
 for(const c of cells){
  if(c.current===c.original)continue;
  const p=ps[Number(c.id.slice(1))];if(!p)throw Error(`未找到 ${c.address}，请重新导入原文件。`);
  const a=analyse(p);
  if(a.text!==c.original)throw Error(`${c.address} 与原文件内容不一致，请重新导入原文件。`);
  if(a.locked)throw Error(`${c.address} 含超链接、图片或域，工作台不能安全改写。请在这一段点“手动修订”改回原文，再导出，并在 Word 里手动修改这一处。`);
  rewrite(doc,p,c.original,c.current);
 }
 zip.file('word/document.xml',`<?xml version='1.0' encoding='UTF-8' standalone='yes'?>`+ser(doc.documentElement),{createFolders:false});
 return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',compression:'DEFLATE'});
}

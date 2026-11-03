import {diffChars} from './engine.js';
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const children=(e,name)=>Array.from(e?.childNodes||[]).filter(x=>x.nodeType===1&&x.localName===name);
const first=(e,name)=>children(e,name)[0];
function xml(text){const d=new DOMParser().parseFromString(text,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('表格 XML 无法解析。');return d;}
function textOf(e){return children(e,'t').map(t=>t.textContent).join('')+children(e,'r').map(r=>first(r,'t')?.textContent||'').join('');}
function path(base,target){if(target.startsWith('/'))return target.slice(1);const parts=base.split('/');parts.pop();for(const p of target.split('/')){if(p==='..')parts.pop();else if(p!=='.')parts.push(p);}return parts.join('/');}
export async function readWorkbook(buffer){
 const zip=await globalThis.JSZip.loadAsync(buffer);let size=0;for(const entry of Object.values(zip.files))size+=entry._data?.uncompressedSize||0;if(size>60000000)throw Error('工作簿展开后超过 60 MB，请精简图片或拆分文件。');
 if(zip.file('xl/vbaProject.bin'))throw Error('暂不支持含宏的文件，请另存为 .xlsx 后导入。');
 const get=async p=>{const f=zip.file(p);if(!f)throw Error('缺少工作簿内容：'+p);return xml(await f.async('string'));};
 const workbook=await get('xl/workbook.xml'),rels=await get('xl/_rels/workbook.xml.rels');
 const relations=Object.fromEntries(Array.from(rels.documentElement.childNodes).filter(x=>x.nodeType===1).map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
 const strings=zip.file('xl/sharedStrings.xml')?children((await get('xl/sharedStrings.xml')).documentElement,'si'):[];
 const styles=zip.file('xl/styles.xml')?await get('xl/styles.xml'):null;
 const sheets=[];
 for(const sh of children(first(workbook.documentElement,'sheets'),'sheet')){
  const target=relations[sh.getAttribute('r:id')||sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')];if(!target)continue;
  const sheetPath=path('xl/workbook.xml',target),doc=await get(sheetPath),cells=[];
  for(const row of children(first(doc.documentElement,'sheetData'),'row'))for(const c of children(row,'c')){
   if(first(c,'f'))continue;const t=c.getAttribute('t'),v=first(c,'v')?.textContent;const src=t==='s'?strings[Number(v)]:t==='inlineStr'?first(c,'is'):null;
   const value=src?textOf(src):t==='str'?v||'':'';if(!value.trim())continue;
   const address=c.getAttribute('r');if(!/^[A-Z]+[0-9]+$/.test(address))continue;
   cells.push({id:`${sh.getAttribute('sheetId')}!${address}`,address,column:address.replace(/\d/g,''),row:Number(address.replace(/\D/g,'')),original:value,current:value,style:c.getAttribute('s')||'0',source:src,element:c});
  }
  if(cells.length>10000)throw Error('单个工作表超过 10000 个文本单元格，请拆分后导入。');
  sheets.push({id:sh.getAttribute('sheetId'),name:sh.getAttribute('name'),path:sheetPath,cells,doc});
 }
 if(!sheets.length)throw Error('未找到可读取的工作表。');return {zip,sheets,styles};
}
export function suggestScope(book){
 for(const s of book.sheets)for(const c of s.cells)if(c.row<=20&&/^(台词|口播|口播文案|文案|脚本台词|正文|口播内容|口播台词字幕|口播台词|台词字幕)$/.test(c.original.trim())){const rows=new Set(s.cells.filter(x=>x.column===c.column&&x.row>c.row).map(x=>x.row));let end=c.row;while(rows.has(end+1))end++;return {sheetId:s.id,column:c.column,start:c.row+1,end:Math.max(c.row+1,end)};}
 const s=book.sheets.find(s=>s.cells.length)||book.sheets[0];return {sheetId:s.id,column:'',start:1,end:Math.max(1,...s.cells.map(c=>c.row))};
}
export function scopeCells(book,scope){return(book.sheets.find(s=>s.id===scope.sheetId)?.cells||[]).filter(c=>c.column===scope.column&&c.row>=Number(scope.start)&&c.row<=Number(scope.end)).map(({source,element,...c})=>({...c}));}
function baseProps(book,c,doc){
 const props=doc.createElementNS(NS,'rPr'),root=book.styles?.documentElement;
 const xf=children(first(root,'cellXfs'),'xf')[Number(c.style)],font=children(first(root,'fonts'),'font')[Number(xf?.getAttribute('fontId')||0)];
 for(const p of Array.from(font?.childNodes||[]).filter(x=>x.nodeType===1)){const n=doc.createElementNS(NS,p.localName==='name'?'rFont':p.localName);for(const a of Array.from(p.attributes||[]))n.setAttribute(a.name,a.value);props.appendChild(n);}return props;
}
function sourceProps(book,c,doc){const base=baseProps(book,c,doc),out=[];const runs=children(c.source,'r');if(runs.length){for(const run of runs){const p=first(run,'rPr')||base;for(const char of Array.from(first(run,'t')?.textContent||''))out.push(p);}}else for(const char of Array.from(c.original))out.push(base);return{base,chars:out};}
export async function writeWorkbook(book,changed){
 // Reload archive so repeated exports always start from the uploaded original.
 const zip=await globalThis.JSZip.loadAsync(await book.zip.generateAsync({type:'uint8array'}));
 for(const sheet of book.sheets){
  const edits=changed.filter(c=>c.current!==c.original&&sheet.cells.some(s=>s.id===c.id));if(!edits.length)continue;
  let source=await zip.file(sheet.path).async('string');
  for(const edited of edits){
   const c=sheet.cells.find(c=>c.id===edited.id),node=c.element.cloneNode(true),doc=node.ownerDocument;
   node.setAttribute('t','inlineStr');for(const child of [...children(node,'v'),...children(node,'is')])node.removeChild(child);
   const inline=doc.createElementNS(NS,'is'),props=sourceProps(book,c,doc);let pos=0,lastKey=null,lastText=null;
   for(const part of diffChars(c.original,edited.current)){
    if(part.type==='delete'){pos+=Array.from(part.text).length;continue;}
    for(const ch of Array.from(part.text)){
     const p=(props.chars[Math.min(pos,props.chars.length-1)]||props.base).cloneNode(true);
     if(part.type==='add'){for(const color of children(p,'color'))p.removeChild(color);const red=doc.createElementNS(NS,'color');red.setAttribute('rgb','FFFF0000');p.appendChild(red);}else pos++;
     const key=new XMLSerializer().serializeToString(p);
     if(key===lastKey){lastText.textContent+=ch;}else{const r=doc.createElementNS(NS,'r'),t=doc.createElementNS(NS,'t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=ch;r.appendChild(p);r.appendChild(t);inline.appendChild(r);lastKey=key;lastText=t;}
    }
   }
   const ext=first(node,'extLst');node.insertBefore(inline,ext||null);
   const serialized=new XMLSerializer().serializeToString(node);
   const re=new RegExp(`<((?:[A-Za-z_][\\w.-]*:)?c)\\b(?=[^>]*\\br=["']${c.address}["'])[^>]*(?:\\/>|>[\\s\\S]*?<\\/\\1>)`);
   if(!re.test(source))throw Error('未定位到待修改单元格 '+c.address);source=source.replace(re,()=>serialized);
  }
  zip.file(sheet.path,source);
 }
 return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',compression:'DEFLATE'});
}

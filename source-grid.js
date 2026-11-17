import {esc} from './engine.js';

export const columnIndex=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
export const columnName=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
export function gridCells(data){const out=new Map();for(const b of data?.ranges||[])for(let i=0;i<b.row_indices.length;i++)for(let j=0;j<b.col_indices.length;j++)out.set(b.col_indices[j]+b.row_indices[i],b.cells?.[i]?.[j]||{});return out;}
export function cellEditable(c){return !c.rich_text?.length&&!c.multiple_values?.length&&!(c.rawValue!==null&&typeof c.rawValue==='object');}
export function editText(c){if(c.formula)return c.formula;return String(c.value??c.rawValue??'');}
export function editValue(text,c){
 if(text.startsWith('='))return {formula:text};
 if(text==='')return {value:''};
 if(typeof c.rawValue==='boolean'){if(!/^(true|false)$/i.test(text))throw Error('此格为布尔值，请输入 TRUE 或 FALSE。');return {value:text.toLowerCase()==='true'};}
 if(typeof c.rawValue==='number'){
  if(/[yd]/i.test(c.cell_styles?.number_format||'')){
   const m=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)throw Error('日期请使用 YYYY-MM-DD。');
   const d=new Date(text+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==text)throw Error('日期无效。');return {value:(+d-Date.UTC(1899,11,30))/86400000};
  }
  const clean=text.replace(/,/g,'');if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(clean))throw Error('此格为数值，请输入有效数字。');
  const value=Number(clean.replace(/%$/,''))/(clean.endsWith('%')?100:1);if(!Number.isFinite(value))throw Error('数值超出范围。');return {value};
 }
 return {value:text};
}
const color=s=>/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(s||'')?s:'';
export function cellStyle(c){
 const s=c.cell_styles||{},out=[],put=(p,v)=>{if(v!==undefined&&v!=='')out.push(`${p}:${v}`);};
 put('background-color',color(s.background_color));put('color',color(s.font_color));
 if(Number.isFinite(s.font_size)&&s.font_size>0&&s.font_size<200)put('font-size',s.font_size+'px');
 if(/^[\p{L}\p{N}\s,._-]{1,100}$/u.test(s.font_family||''))put('font-family',s.font_family);
 if(['bold','normal'].includes(s.font_weight))put('font-weight',s.font_weight);
 if(['italic','normal'].includes(s.font_style))put('font-style',s.font_style);
 if(['none','underline','line-through'].includes(s.font_line))put('text-decoration',s.font_line);
 if(['left','center','right'].includes(s.horizontal_alignment))put('text-align',s.horizontal_alignment);
 if(['top','middle','bottom'].includes(s.vertical_alignment))put('vertical-align',s.vertical_alignment);
 if(s.vertical_alignment)put('--grid-valign',{top:'flex-start',middle:'center',bottom:'flex-end'}[s.vertical_alignment]);
 for(const side of ['top','bottom','left','right']){const b=c.border_styles?.[side];if(b&&['solid','dashed','dotted','double','none'].includes(b.style))put('border-'+side,`${{thin:1,medium:2,thick:3}[b.weight]||1}px ${b.style} ${color(b.color)||'#d8d8d8'}`);}
 return out.join(';');
}
export function imageContent(ref,images={}){
 const image=images[ref.id];let url='';
 if(image?.state==='ready')try{const u=new URL(image.url);if(u.protocol==='https:'&&!u.username&&!u.password)url=u.href;}catch{}
 const content=url?`<img src="${esc(url)}" alt="${esc(ref.alt||'原表图片')}" referrerpolicy="no-referrer" decoding="async">`:`<span class="grid-image-placeholder">${image?'图片未加载，刷新表格重试':'图片加载中…'}</span>`;
 return `<span class="grid-image" data-grid-image="${esc(ref.id)}" data-grid-image-state="${url?'ready':image?'unavailable':'loading'}">${content}</span>`;
}
export function cellContent(c,images={}){
 const renderRun=(r,index,origin)=>{
  if(['embed-image','image'].includes(r?.type)){const ref=c.imageRefs?.find(x=>x.origin===origin&&x.index===index);return ref?imageContent(ref,images):'<span class="muted">图片（在飞书查看）</span>';}
  if(r?.type==='link'&&/^https?:\/\//i.test(r.link||''))return `<a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${esc(r.text)}</a>`;
  return `<span style="${esc(cellStyle({cell_styles:r?.style}))}">${esc(r?.text||r?.attachment_name||'')}</span>`;
 };
 if(c.rich_text?.length){const html=c.rich_text.map((r,i)=>renderRun(r,i,'rich_text')).join('');return html+(c.imageRefs||[]).filter(r=>r.origin==='rawValue').map(r=>imageContent(r,images)).join('');}
 if(c.imageRefs?.length){const runs=Array.isArray(c.rawValue)?c.rawValue:[c.rawValue];return runs.map((r,i)=>renderRun(r,i,'rawValue')).join('');}
 if(c.multiple_values?.length)return c.multiple_values.map(x=>esc(x.value)).join('、');
 return esc(c.value??(typeof c.rawValue==='boolean'?(c.rawValue?'TRUE':'FALSE'):c.rawValue)??'');
}
export function gridTable(data,drafts={},editing='',editingPosition='',images={}){
 if(!data)return '<div class="empty">点击“刷新表格”读取原表。</div>';
 const cells=gridCells(data),layout=data.layout||{},frozen=data.frozen||{rows:0,columns:0},cols=Array.from({length:data.meta.column_count},(_,i)=>columnName(i));
 const rows=[...new Set([...Array.from({length:frozen.rows},(_,i)=>i+1),...Array.from({length:data.endRow-data.startRow+1},(_,i)=>data.startRow+i)])].sort((a,b)=>a-b);
 const inRange=(v,range,convert=Number)=>{const a=String(range).split(':'),lo=convert(a[0]),hi=convert(a[1]||a[0]);return v>=lo&&v<=hi;};
 const width=c=>layout.column_widths?.find(x=>inRange(columnIndex(c),x.cols,columnIndex))?.width||105;
 const height=r=>layout.row_heights?.find(x=>inRange(r,x.rows))?.height||27;
 const hiddenCol=c=>layout.hidden_columns?.some(x=>inRange(columnIndex(c),typeof x==='string'?x:x.cols,columnIndex));
 const hiddenRow=r=>layout.hidden_rows?.some(x=>inRange(r,typeof x==='string'?x:x.rows));
 const merges=(layout.merged_cells||[]).map(x=>String(x.range).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)).filter(Boolean).map(m=>({c1:columnIndex(m[1]),r1:+m[2],c2:columnIndex(m[3]),r2:+m[4],address:m[1]+m[2]}));
 const visibleCols=cols.filter(c=>!hiddenCol(c)),visibleRows=rows.filter(r=>!hiddenRow(r));
 const pinnedRow=r=>r<=frozen.rows,pinnedCol=c=>columnIndex(c)<frozen.columns,tops=new Map(),lefts=new Map();
 let frozenHeight=0,frozenWidth=0;
 for(const r of visibleRows)if(pinnedRow(r)){tops.set(r,28+frozenHeight);frozenHeight+=height(r);}
 for(const c of visibleCols)if(pinnedCol(c)){lefts.set(c,44+frozenWidth);frozenWidth+=width(c);}
 // Render a merge at its first visible position, while retaining its true
 // address for drafts, formulas, and writes. Hidden rows do not count in spans.
 const visibleMerges=merges.map(m=>{const shown=visibleRows.filter(r=>r>=m.r1&&r<=m.r2);return {...m,rows:shown,geometryRows:m.r1<=frozen.rows&&m.r2>frozen.rows?Array.from({length:m.r2-m.r1+1},(_,i)=>m.r1+i).filter(r=>!hiddenRow(r)):shown,cols:visibleCols.filter(c=>columnIndex(c)>=m.c1&&columnIndex(c)<=m.c2)};});
 const floating=data.floatingImages||[],floatLayout=data.floatingLayout||layout;
 const floatHeights=(floatLayout.row_heights||[]).map(x=>({...x,bounds:String(x.rows).split(':').map(Number)}));
 const floatHidden=(floatLayout.hidden_rows||[]).map(x=>String(typeof x==='string'?x:x.rows).split(':').map(Number));
 const rowOffsets=new Map();
 const rowOffset=r=>{
  if(rowOffsets.has(r))return rowOffsets.get(r);
  const points=new Set([1,r]);
  for(const [a,b=a] of [...floatHeights.map(x=>x.bounds),...floatHidden]){if(a>1&&a<r)points.add(a);if(b+1>1&&b+1<r)points.add(b+1);}
  const sorted=[...points].sort((a,b)=>a-b);let total=0;
  for(let i=0;i<sorted.length-1;i++){const from=sorted[i];if(!floatHidden.some(([a,b=a])=>from>=a&&from<=b))total+=(sorted[i+1]-from)*(floatHeights.find(x=>from>=x.bounds[0]&&from<=(x.bounds[1]??x.bounds[0]))?.height||27);}
  rowOffsets.set(r,total);return total;
 };
 const colOffsets=new Map();let colTotal=0;
 for(const c of cols){colOffsets.set(c,colTotal);if(!hiddenCol(c))colTotal+=width(c);}
 const pictures=floating.filter(ref=>ref.row<=Math.max(data.endRow,frozen.rows)).map(ref=>({...ref,x:colOffsets.get(columnName(ref.column))+ref.offsetX,y:rowOffset(ref.row)+ref.offsetY}));
 const fragments=(r,c,w,h)=>pictures.map(ref=>{
  const cellX=colOffsets.get(c),cellY=rowOffset(r),x=Math.max(cellX,ref.x),y=Math.max(cellY,ref.y),right=Math.min(cellX+w,ref.x+ref.width),bottom=Math.min(cellY+h,ref.y+ref.height);
  if(right<=x||bottom<=y)return '';
  return `<div class="grid-float-fragment" data-grid-floating="${esc(ref.id)}" style="left:${x-cellX}px;top:${y-cellY}px;width:${right-x}px;height:${bottom-y}px"><div class="grid-float-image" style="left:${ref.x-x}px;top:${ref.y-y}px;width:${ref.width}px;height:${ref.height}px">${imageContent(ref,images)}</div></div>`;
 }).join('');
 let editorPlaced=false;
 return `<div class="source-grid-scroll" tabindex="0" aria-label="原表，可左右滚动" data-grid-frozen-height="${frozenHeight}" data-grid-frozen-width="${frozenWidth}"><table class="source-grid" style="width:${44+visibleCols.reduce((n,c)=>n+width(c),0)}px"><colgroup><col style="width:44px">${visibleCols.map(c=>`<col style="width:${width(c)}px">`).join('')}</colgroup><thead><tr><th class="grid-corner"></th>${visibleCols.map(c=>`<th scope="col" class="${pinnedCol(c)?'grid-frozen-col':''}" style="${pinnedCol(c)?'--grid-left:'+lefts.get(c)+'px':''}"><button class="grid-axis" data-grid-dimension="column" data-grid-index="${columnIndex(c)+1}" aria-label="${c} 列，增删列">${c}</button></th>`).join('')}</tr></thead><tbody>${visibleRows.map(r=>`<tr style="height:${height(r)}px"><th scope="row" class="${pinnedRow(r)?'grid-frozen-row':''}" style="${pinnedRow(r)?'--grid-top:'+tops.get(r)+'px':''}"><button class="grid-axis" data-grid-dimension="row" data-grid-index="${r}" aria-label="第 ${r} 行，增删行">${r}</button></th>${visibleCols.map(c=>{
  const ci=columnIndex(c),merge=visibleMerges.find(m=>r>=m.r1&&r<=m.r2&&ci>=m.c1&&ci<=m.c2),address=merge?.address||c+r;
  // A merged cell crossing the freeze boundary is clipped into panes. All
  // fragments keep one source address, but each has its own visible position.
  const partRows=merge?merge.rows.filter(k=>pinnedRow(k)===pinnedRow(r)):[r],partCols=merge?merge.cols.filter(k=>pinnedCol(k)===pinnedCol(c)):[c];
  if(merge&&(r!==partRows[0]||c!==partCols[0]))return '';
  const cell=cells.get(address)||{},draft=drafts[data.sheetId+'!'+address],text=draft?.text??editText(cell),available=cells.has(address),editable=available&&cellEditable(cell);
  const rs=partRows.length,cs=partCols.length,h=partRows.reduce((n,k)=>n+height(k),0),fullHeight=merge?merge.geometryRows.reduce((n,k)=>n+height(k),0):h;
  const split=merge&&(rs!==merge.geometryRows.length||cs!==merge.cols.length),fullWidth=merge?merge.cols.reduce((n,k)=>n+width(k),0):width(c);
  const offsetY=merge?merge.geometryRows.filter(k=>k<r).reduce((n,k)=>n+height(k),0):0,offsetX=merge?merge.cols.filter(k=>columnIndex(k)<ci).reduce((n,k)=>n+width(k),0):0;
  const showEditor=editing===address&&editable&&!editorPlaced&&(!editingPosition||editingPosition===c+r);if(showEditor)editorPlaced=true;
  const classes=[draft?'grid-pending':'',pinnedRow(r)?'grid-frozen-row':'',pinnedCol(c)?'grid-frozen-col':''];
  const style=[cellStyle(cell),pinnedRow(r)?'--grid-top:'+tops.get(r)+'px':'',pinnedCol(c)?'--grid-left:'+lefts.get(c)+'px':''].filter(Boolean).join(';');
  const content=`<div class="source-cell ${cell.cell_styles?.word_wrap==='word-clip'?'grid-clip':''} ${cell.imageRefs?.length?'grid-image-cell':''}" style="height:${Math.max(1,fullHeight-1)}px${split?`;width:${fullWidth}px;left:-${offsetX}px;top:-${offsetY}px`:''}" title="${cell.imageRefs?.length?'':esc(editText(cell))}"><div>${!available?'<span class="muted">内容未完整读取，请刷新表格。</span>':draft?esc(draft.text):cellContent(cell,images)}</div></div>`;
  return `<td data-grid-cell="${address}" data-grid-position="${c+r}" data-grid-editable="${editable}" tabindex="0" aria-label="${address}${editable?'，双击或按 Enter 编辑':''}" rowspan="${rs}" colspan="${cs}" class="${classes.join(' ')}" style="${esc(style)}">${showEditor?`<textarea class="grid-cell-editor" data-grid-input="${address}" data-grid-position="${c+r}" aria-label="编辑 ${address}" style="height:${Math.max(40,h)}px">${esc(text)}</textarea>`:split?`<div class="source-merge-window" style="height:${Math.max(1,h-1)}px">${content}</div>`:content}${fragments(r,c,partCols.reduce((n,k)=>n+width(k),0),h)}</td>`;
 }).join('')}</tr>`).join('')}</tbody></table></div><p class="source-grid-note" data-grid-freeze-note hidden>冻结区域超出当前视窗，已完整保留并可滚动查看。</p>`;
}

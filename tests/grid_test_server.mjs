// Private test server: synthetic state by default; live mode only writes the
// explicitly designated synthetic sheet. It never uses the installed connector.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createGridRuntime,columnName} from '../grid-runtime.mjs';
const home=process.env.ZHIGAO_VERIFY_OUT;fs.mkdirSync(home,{recursive:true});
const live=process.env.ZHIGAO_GRID_LIVE==='1',url='https://scnplp5q8x3t.feishu.cn/sheets/RdEzsaU5NhFpKStfQ3xcGgHdnab',allowed='ez1Kvd';
let rev=1,writes=0,lost=false,fail=false,delay=0,readDelay=0;
let structureLost=false,readbackFail=false,readbackPending=false;
const freezeCase=process.env.ZHIGAO_GRID_FREEZE==='1';
const layoutCase=process.env.ZHIGAO_GRID_LAYOUT==='1'||freezeCase;
if(layoutCase&&live)throw Error('Layout fixtures must remain synthetic');
let anchorChanged=false;
let frozenRows=freezeCase?3:0,frozenCols=freezeCase?3:0,frozenChanged=false;
const sheets=[{sheet_id:'s',title:'颜色与公式',resource_type:'sheet',row_count:85,column_count:8},{sheet_id:'other',title:'另一张表',resource_type:'sheet',row_count:8,column_count:3}];
const store={s:{A1:{value:'原表标题（合成）',rawValue:'原表标题（合成）',cell_styles:{background_color:'#173c36',font_color:'#ffffff',font_weight:'bold',font_size:18}},A2:{value:'达人',rawValue:'达人'},B2:{value:'数量',rawValue:'数量'},A3:{value:'合成甲',rawValue:'合成甲',cell_styles:{font_color:'#2459a6',font_weight:'bold'}},B3:{value:'7',rawValue:7},C3:{value:8,rawValue:8,formula:'=B3+1'},D3:{value:'2026-11-16',rawValue:46342,cell_styles:{number_format:'yyyy-mm-dd'}},E3:{value:'TRUE',rawValue:true},F3:{value:'001',rawValue:'001',cell_styles:{number_format:'@'}},G3:{value:'链接',rawValue:[],rich_text:[{type:'link',text:'飞书开放平台',link:'https://open.feishu.cn'}]},H3:{value:'用于检查换行的长文本。保持原表内容和位置，保留宽列与行高。',rawValue:'用于检查换行的长文本。保持原表内容和位置，保留宽列与行高。',cell_styles:{background_color:'#f4eccf',word_wrap:'auto-wrap'}},A5:{value:'空行之后',rawValue:'空行之后'}},other:{A1:{value:'其他表不受影响',rawValue:'其他表不受影响'}}};
if(layoutCase)Object.assign(store.s,{
 A8:{value:'隐藏起点仍可见',rawValue:'隐藏起点仍可见',cell_styles:{background_color:'#f4eccf',font_color:'#2459a6',font_weight:'bold'}},
 A15:{value:'完全隐藏的合并格',rawValue:'完全隐藏的合并格'},
 A39:{value:'跨页合并正文',rawValue:'跨页合并正文',cell_styles:{background_color:'#f4eccf',font_color:'#2459a6',font_weight:'bold'}},
 D39:{value:'合并链接',rawValue:[],rich_text:[{type:'link',text:'合并链接',link:'https://open.feishu.cn'}]},
 H65:{value:'滚动后编辑',rawValue:'滚动后编辑'}
});
if(freezeCase){store.s.B3={value:'冻结交界合并正文',rawValue:'冻结交界合并正文',cell_styles:{background_color:'#e4eee8',font_color:'#173c36',font_size:16,horizontal_alignment:'center',vertical_alignment:'middle'}};delete store.s.C3;delete store.s.D3;}
const index=c=>[...c].reduce((n,x)=>n*26+x.charCodeAt(0)-64,0)-1;
const bounds=r=>{const m=r.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);return {rows:Array.from({length:+(m[4]||m[2])-m[2]+1},(_,i)=>+m[2]+i),cols:Array.from({length:index(m[3]||m[1])-index(m[1])+1},(_,i)=>columnName(index(m[1])+i))};};
const larkJson=async(args,input)=>{
 if(live){
  if(!args.includes(url)&&!args.some(a=>a.startsWith('/open-apis/sheets/v2/spreadsheets/RdEzsaU5NhFpKStfQ3xcGgHdnab/values/')))throw Error('Test workbook boundary');
  if(args[1]==='+cells-set'&&args[args.indexOf('--sheet-id')+1]!==allowed)throw Error('Test sheet boundary');
  if(!['+workbook-info','+sheet-info','+cells-get','+cells-set','GET'].includes(args[1]))throw Error('Test read/write whitelist');
  return await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['C:/Users/lenovo/AppData/Roaming/npm/node_modules/@larksuite/cli/scripts/run.js',...args],{windowsHide:true});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>{if(code)return reject(Error(err));try{const r=JSON.parse(out);if(!r.ok)throw Error('CLI failed');resolve(r);}catch(e){reject(e);}});p.stdin.end(input||'');});
 }
 const get=k=>args[args.indexOf(k)+1],cmd=args[1];
 if(args[0]==='api'&&args[2].endsWith('/float_images/query'))return {data:{items:[]}};
 if(cmd==='+workbook-info'){if(readbackPending){readbackPending=false;throw Error('Simulated readback failure');}return {data:{token:'book',revision:rev,title:'源表验收',sheets:structuredClone(sheets)}};}
 if(cmd==='+sheet-info'){
  const special=layoutCase&&get('--sheet-id')==='s',b=bounds(get('--range'));
  const merges=get('--sheet-id')==='s'?['A1:H1',...(special?['A8:C11','A15:A17','A39:C43','D39:E43']:[]),...(freezeCase&&special?['B3:D5']:[])]:[];
  const hidden=special?['8:8','10:10','42:42',...(freezeCase?['2:2']:[])]:[];
  return {data:{revision:rev,frozen_row_count:special?frozenRows:0,frozen_column_count:special?frozenCols:0,merged_cells:merges.filter(range=>{const r=bounds(range).rows;return r[0]<=b.rows.at(-1)&&r.at(-1)>=b.rows[0];}).map(range=>({range})),row_heights:freezeCase?b.rows.map(r=>({rows:`${r}:${r}`,height:r===3?65:r===4?45:r===5?35:27})):[{rows:'1:2',height:27},{rows:'3:3',height:65},{rows:'4:85',height:27}],column_widths:[{cols:'A:G',width:105},{cols:'H:H',width:300}],hidden_rows:freezeCase?hidden.filter(x=>{const [a,z]=x.split(':').map(Number);return a<=b.rows.at(-1)&&z>=b.rows[0];}):hidden,hidden_columns:special?[{cols:'A:A'}]:[]}};
 }
 if(cmd==='+cells-get'){const range=get('--range'),b=bounds(range),s=store[get('--sheet-id')];if(anchorChanged&&range==='A39'){anchorChanged=false;rev++;}if(frozenChanged&&range==='A1:H3'){frozenChanged=false;rev++;}return {data:{revision:rev,ranges:[{actual_range:range,row_indices:b.rows,col_indices:b.cols,cells:b.rows.map(r=>b.cols.map(c=>{const v={...s[c+r]};delete v.rawValue;return v;}))}],has_more:false}};}
 if(args[0]==='api'){const [sid,range]=decodeURIComponent(args[2].split('/').at(-1)).split('!'),b=bounds(range);return {data:{revision:rev,valueRange:{range:sid+'!'+range,majorDimension:'ROWS',values:b.rows.map(r=>b.cols.map(c=>store[sid][c+r]?.rawValue??null))}}};}
 if(cmd==='+cells-set'){if(delay)await new Promise(r=>setTimeout(r,delay));if(fail)throw Error('Simulated write failure');writes++;const v=JSON.parse(input)[0][0],sid=get('--sheet-id'),address=get('--range'),previous=store[sid][address]||{};store[sid][address]={...previous,...v,rawValue:v.value??42,value:v.formula?42:typeof v.value==='boolean'?String(v.value).toUpperCase():String(v.value)};if(!v.formula)delete store[sid][address].formula;rev++;return {data:{revision:rev}};}
 if(['+dim-insert','+dim-delete'].includes(cmd)){
  if(args.includes('--dry-run'))return {data:{dry_run:true}};
  if(delay)await new Promise(r=>setTimeout(r,delay));if(fail)throw Error('Simulated structure failure');
  const insert=cmd==='+dim-insert',ref=get(insert?'--position':'--range').split(':'),row=/^\d+$/.test(ref[0]),pos=row?Number(ref[0]):index(ref[0])+1,count=insert?Number(get('--count')):(row?Number(ref[1]||ref[0]):index(ref[1]||ref[0])+1)-pos+1,sid=get('--sheet-id'),sheet=sheets.find(s=>s.sheet_id===sid);
  const shifted={};for(const [a,v] of Object.entries(store[sid])){const m=a.match(/^([A-Z]+)(\d+)$/),old=row?+m[2]:index(m[1])+1;if(!insert&&old>=pos&&old<pos+count)continue;const n=old>=pos?old+(insert?count:-count):old;shifted[row?m[1]+n:columnName(n-1)+m[2]]=v;}
  store[sid]=shifted;sheet[row?'row_count':'column_count']+=insert?count:-count;writes++;rev++;
  if(structureLost){structureLost=false;throw Error('Simulated structure response loss');}if(readbackFail){readbackFail=false;readbackPending=true;}return {data:{revision:rev}};
 }
 throw Error('Unexpected '+cmd);
};
const workbookInfo=u=>larkJson(['sheets','+workbook-info','--url',u,'--as','user','--format','json']);
const sheetInfo=(info,id)=>{const m=info.data.sheets.find(s=>s.sheet_id===id);if(!m)throw Error('Sheet missing');return m;};
const runtime=createGridRuntime({larkJson,workbookInfo,sheetInfo,home});
const server=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;try{const b=JSON.parse(text||'{}');if(req.url==='/control'){if(b.bump)rev++;if(b.structureLost!==undefined)structureLost=b.structureLost;if(b.readbackFail!==undefined)readbackFail=b.readbackFail;if(b.lost!==undefined)lost=b.lost;if(b.delay!==undefined)delay=b.delay;if(b.readDelay!==undefined)readDelay=b.readDelay;if(b.fail!==undefined)fail=b.fail;if(b.anchorChanged!==undefined)anchorChanged=b.anchorChanged;if(b.frozenChanged!==undefined)frozenChanged=b.frozenChanged;if(b.frozenRows!==undefined){frozenRows=b.frozenRows;rev++;}if(b.frozenCols!==undefined){frozenCols=b.frozenCols;rev++;}res.end(JSON.stringify({writes,rev,store,sheets}));return;}
 if(readDelay&&b.action==='gridRead'&&b.sheetId==='s')await new Promise(r=>setTimeout(r,readDelay));
 const data=await runtime(b);if(['gridWrite','gridStructure'].includes(b.action)){if(live)writes++;if(lost){lost=false;throw Error('Simulated response loss after commit');}}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data}));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:e.message,code:e.code}));}});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port,live})));

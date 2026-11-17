// Synthetic image API and table. Never invokes the CLI or a real workspace.
import {createGridRuntime,columnName} from '../grid-runtime.mjs';

export function imageFixture(home,runtimeFactory=createGridRuntime,{floating=false}={}){
 let revision=1,requests=[],writes=0,mode='ready',waiter=null,floatReads=0,hidden=false;
 const image=(token,width=160,height=90)=>({type:'embed-image',image_token:token,width,height});
 const rows={
  A1:{value:'图片与文字原表',rawValue:'图片与文字原表',cell_styles:{background_color:'#173c36',font_color:'#ffffff',font_size:18}},
  A3:{value:'原表配图',rawValue:'原表配图'}, B3:{value:'照片',rawValue:[{type:'embed-image',fileToken:'red',width:240,height:120}]},
  D3:{value:'说明与图片',rawValue:[],rich_text:[{type:'text',text:'图片前说明'},image('blue'),{type:'text',text:'图片后说明'}]},
  F3:{value:'同图引用',rawValue:[],rich_text:[image('red')]},
  B6:{value:'不可用图片',rawValue:[],rich_text:[image('missing')]},
  D6:{value:'加载失败图片',rawValue:[],rich_text:[image('broken')]},
  F6:{value:'输入保持',rawValue:'输入保持',cell_styles:{font_color:'#2459a6'}},
  B9:{rawValue:{type:'embed-image',fileToken:'green',width:160,height:90}},
  D9:{value:'额外图片',rawValue:[],rich_text:[image('purple')]},
  F9:{value:'非法图片来源',rawValue:[],rich_text:[image('unsafe')]},
  A39:{rawValue:[{type:'embed-image',fileToken:'wide',width:300,height:120}]},
  H70:{value:'第三张图',rawValue:[],rich_text:[image('last')]}
 };
 const meta={sheet_id:'s',title:'配图表',resource_type:'sheet',row_count:85,column_count:8};
 const other={sheet_id:'other',title:'其他表',resource_type:'sheet',row_count:8,column_count:3};
 const info=()=>({data:{token:'book',title:'原表图片验收',revision,sheets:[meta,other]}});
 const bounds=range=>{const m=range.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/),ci=c=>[...c].reduce((n,x)=>n*26+x.charCodeAt(0)-64,0)-1;return {rows:Array.from({length:+(m[4]||m[2])-m[2]+1},(_,i)=>+m[2]+i),cols:Array.from({length:ci(m[3]||m[1])-ci(m[1])+1},(_,i)=>columnName(ci(m[1])+i))};};
 const larkJson=async(args,input)=>{
  const get=k=>args[args.indexOf(k)+1],cmd=args[1];
  if(args[0]==='api'&&args[2].endsWith('/float_images/query')){
   floatReads++;
   if(mode==='float-denied')throw Object.assign(Error('Forbidden'),{code:'FEISHU_ACCESS'});
   if(mode==='float-changed')revision++;
   const items=floating&&args[2].includes('/sheets/s/')?[
    {float_image_id:'banner',float_image_token:'red',range:'s!A1:A1',width:280,height:95,offset_x:72,offset_y:10},
    {float_image_id:'page',float_image_token:'wide',range:'s!B39:B39',width:180,height:160,offset_x:15,offset_y:15},
    {float_image_id:'missing',float_image_token:'missing',range:'s!F12:F12',width:160,height:80,offset_x:0,offset_y:0}
   ]:[];
   if(mode==='float-invalid')items.push({float_image_id:'bad',range:'other!A1:A1',width:NaN,height:20});
   return {data:{items}};
  }
  if(args[0]==='api'&&args[2].includes('/medias/batch_get_tmp_download_url')){
   const tokens=JSON.parse(get('--params')).file_tokens;requests.push(tokens);
   if(mode==='hold')await new Promise(resolve=>waiter=resolve);
   if(mode==='denied')throw Object.assign(Error('Forbidden'),{code:'FEISHU_ACCESS'});
   if(mode==='changed')revision++;
   return {data:{tmp_download_urls:tokens.filter(t=>t!=='missing').map(t=>({file_token:t,tmp_download_url:t==='unsafe'?'javascript:alert(1)':`https://images.synthetic.test/${t}.png`}))}};
  }
  if(cmd==='+workbook-info')return info();
  if(cmd==='+sheet-info')return {data:{revision,frozen_row_count:hidden?3:1,frozen_column_count:hidden?3:1,merged_cells:get('--sheet-id')==='s'?[{range:'A1:H1'},{range:'B3:C5'},{range:'D3:E5'},{range:'F3:G5'},{range:'B6:C8'},{range:'D6:E8'},{range:'B9:C11'},{range:'D9:E11'},{range:'F9:G11'},{range:'A39:C43'}]:[],row_heights:[{rows:'3:11',height:32},{rows:'39:43',height:30}],column_widths:[{cols:'A:H',width:112}],hidden_rows:hidden?[{rows:'2:2'},{rows:'42:42'}]:[],hidden_columns:hidden?[{cols:'B:B'}]:[]}};
  if(args[0]==='api'){
   const [sheetId,range]=decodeURIComponent(args[2].split('/').at(-1)).split('!'),b=bounds(range);
   return {data:{revision,valueRange:{majorDimension:'ROWS',range:sheetId+'!'+range,values:b.rows.map(r=>b.cols.map(c=>sheetId!=='s'?null:get('--params')&&get('--params').includes('UnformattedValue')?rows[c+r]?.rawValue??null:rows[c+r]?.value??null))}}};
  }
  if(cmd==='+cells-get'){
   const b=bounds(get('--range'));return {data:{revision,ranges:[{row_indices:b.rows,col_indices:b.cols,cells:b.rows.map(r=>b.cols.map(c=>structuredClone(get('--sheet-id')==='s'?rows[c+r]||{}:{})))}]}};
  }
  if(cmd==='+cells-set'){const address=get('--range'),value=JSON.parse(get('--cells')==='-'?input:get('--cells'))[0][0];rows[address]={...rows[address],...value,rawValue:value.value};writes++;revision++;return {data:{revision}};}
  throw Error('Unexpected synthetic command: '+cmd);
 };
 const runtime=runtimeFactory({larkJson,workbookInfo:info,sheetInfo:(i,id)=>{const found=i.data.sheets.find(s=>s.sheet_id===id);if(!found)throw Error('Sheet missing');return found;},home});
 return {runtime,state:()=>({revision,requests,writes,rows,floatReads}),control(v){if(v.mode)mode=v.mode;if(v.hidden!==undefined){hidden=v.hidden;revision++;}if(v.bump)revision++;if(v.release&&waiter){mode=v.mode||'ready';waiter();waiter=null;}return this.state();}};
}

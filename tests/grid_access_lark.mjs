// Synthetic CLI for the isolated connector test. Never contacts Feishu.
import fs from 'node:fs';
import path from 'node:path';
const root=process.env.ZHIGAO_ACCESS_FIXTURE;if(!root)throw Error('Missing fixture directory');
const args=process.argv.slice(2),file=path.join(root,'table.json'),s=JSON.parse(fs.readFileSync(file)),get=k=>args[args.indexOf(k)+1];
const ok=data=>console.log(JSON.stringify({ok:true,identity:'user',data}));
const save=()=>fs.writeFileSync(file,JSON.stringify(s));
fs.appendFileSync(path.join(root,'calls.jsonl'),JSON.stringify(args.map((v,i)=>args[i-1]==='--device-code'?'REDACTED':v))+'\n');
const auth=path.join(root,'authorized');
if(args[0]==='auth'){
 if(args[1]==='status')console.log(JSON.stringify({identity:'user',verified:fs.existsSync(auth),identities:{user:{status:'ready',tokenStatus:fs.existsSync(auth)?'valid':'invalid'}}}));
 else if(args[1]==='qrcode'){fs.copyFileSync(path.join(root,'qr.png'),get('--output'));ok({});}
 else if(args[1]==='login'){
  if(args.includes('--device-code')){fs.writeFileSync(auth,'synthetic');s.scope=false;s.writeScope=false;save();ok({});}
  else ok({device_code:'SYNTHETIC_PRIVATE',verification_url:'https://accounts.feishu.cn/synthetic-test-only',expires_in:600});
 }else throw Error('Unexpected auth command');
}else{
 if(s.scope){console.log(JSON.stringify({ok:false,error:{type:'missing_scope',missing_scopes:['sheets:spreadsheet:readonly']}}));process.exit(0);}
 const col=n=>String.fromCharCode(65+n),index=c=>c.charCodeAt(0)-65;
 const bounds=r=>{const m=r.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);return {rows:Array.from({length:+(m[4]||m[2])-m[2]+1},(_,i)=>+m[2]+i),cols:Array.from({length:index(m[3]||m[1])-index(m[1])+1},(_,i)=>col(index(m[1])+i))};};
 const cmd=args[1];
 if(s.writeScope&&['+cells-set','+dim-insert'].includes(cmd)){console.log(JSON.stringify({ok:false,error:{type:'missing_scope',missing_scopes:['sheets:spreadsheet']}}));process.exit(0);}
 if(cmd==='+workbook-info')ok({token:'Synthetic',revision:s.revision,title:'授权续办合成表',sheets:(s.sync?['s']:['s','other']).map(id=>({sheet_id:id,title:'原表',sheet_name:'原表',resource_type:'sheet',row_count:s.rows,column_count:s.sync?8:3}))});
 else if(cmd==='+table-get')ok({sheets:[{sheet_id:'s',name:'原表',range:'A1:H'+s.rows,columns:Array.from({length:8},(_,i)=>s.cells[col(i)+'1']||''),data:Array.from({length:s.rows-1},(_,i)=>Array.from({length:8},(_,j)=>s.cells[col(j)+(i+2)]||''))}]});
 else if(cmd==='+sheet-info')ok({revision:s.revision,merged_cells:[],row_heights:[],column_widths:[],hidden_rows:[],hidden_columns:[]});
 else if(cmd==='+cells-get'){const range=get('--range'),b=bounds(range);ok({revision:s.revision,ranges:[{actual_range:range,row_indices:b.rows,col_indices:b.cols,cells:b.rows.map(r=>b.cols.map(c=>({value:String(s.cells[c+r]??'')})))}],has_more:false});}
 else if(args[0]==='api'){const range=decodeURIComponent(args[2].split('/').at(-1)),b=bounds(range.split('!')[1]);ok({revision:s.revision,valueRange:{range,majorDimension:'ROWS',values:b.rows.map(r=>b.cols.map(c=>s.cells[c+r]??null))}});}
 else if(cmd==='+cells-set'){let input=get('--cells');if(input==='-'){input='';for await(const c of process.stdin)input+=c;}s.cells[get('--range')]=JSON.parse(input)[0][0].value;s.writes++;s.revision++;save();if(s.lost){console.log('incomplete synthetic response');process.exit(1);}ok({revision:s.revision});}
 else if(cmd==='+dim-insert'){const pos=Number(get('--position')),count=Number(get('--count')),next={};for(const [a,v] of Object.entries(s.cells)){const n=Number(a.slice(1));next[a[0]+(n>=pos?n+count:n)]=v;}s.cells=next;s.rows+=count;s.writes++;s.revision++;const lost=s.structureLost;s.structureLost=false;save();if(lost){console.log('incomplete synthetic structure response');process.exit(1);}ok({revision:s.revision});}
 else throw Error('Unexpected synthetic command: '+cmd);
}

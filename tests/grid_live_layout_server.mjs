// Read-only bridge to the previously authorized CP7 synthetic worksheet.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

if(process.env.ZHIGAO_GRID_LIVE!=='1'||!process.env.ZHIGAO_VERIFY_OUT)throw Error('Explicit live-test output required');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source=fs.readFileSync(path.join(root,'zhigao-connector.mjs'),'utf8');
const modules=JSON.parse(source.match(/^const TASK_MODULES = (.*);$/m)[1]);
const {createGridRuntime}=process.argv.includes('--source')?await import('../grid-runtime.mjs'):await import('data:text/javascript;base64,'+modules['grid-runtime.mjs']);
const cli=path.join(process.env.APPDATA,'npm/node_modules/@larksuite/cli/scripts/run.js');
const home=path.join(process.env.ZHIGAO_VERIFY_OUT,'private-home');
fs.mkdirSync(home,{recursive:true});
const url='https://scnplp5q8x3t.feishu.cn/sheets/RdEzsaU5NhFpKStfQ3xcGgHdnab',sid='ez1Kvd';
const run=promisify(execFile);
const log=[];
async function larkJson(args){
 if(args[0]==='api'){
  if(args[1]!=='GET'||![/^\/open-apis\/sheets\/v2\/spreadsheets\/RdEzsaU5NhFpKStfQ3xcGgHdnab\/values\/ez1Kvd!/,/^\/open-apis\/sheets\/v3\/spreadsheets\/RdEzsaU5NhFpKStfQ3xcGgHdnab\/sheets\/ez1Kvd\/float_images\/query$/, /^\/open-apis\/drive\/v1\/medias\/batch_get_tmp_download_url$/].some(x=>x.test(decodeURIComponent(args[2]))))throw Error('Read-only API boundary');
 }else if(args[0]!=='sheets'||!['+workbook-info','+sheet-info','+cells-get'].includes(args[1])||args[args.indexOf('--url')+1]!==url||args.includes('--sheet-id')&&args[args.indexOf('--sheet-id')+1]!==sid)throw Error('Read-only sheet boundary');
 const result=await run(process.execPath,[cli,...args],{windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024});
 const value=JSON.parse(result.stdout);if(value.ok!==true)throw Error('CLI did not return success');
 log.push({command:args[0]==='api'?args[2]:args[1],range:args.includes('--range')?args[args.indexOf('--range')+1]:null});
 // Keep short-lived download URLs out of evidence files.
 if(args[1]==='+sheet-info')fs.writeFileSync(path.join(process.env.ZHIGAO_VERIFY_OUT,'layout-'+log.length+'.json'),JSON.stringify(value.data,null,2));
 return value;
}
const workbookInfo=u=>larkJson(['sheets','+workbook-info','--url',u,'--as','user','--format','json']);
const runtime=createGridRuntime({home,larkJson,workbookInfo,sheetInfo:(i,id)=>{const s=i.data.sheets.find(s=>s.sheet_id===id);if(!s)throw Error('Sheet missing');return s;}});
const server=http.createServer(async(req,res)=>{
 try{
  let text='';for await(const chunk of req)text+=chunk;
  const input=JSON.parse(text);
  if(!['gridRead','gridFloating','gridImages'].includes(input.action)||input.url!==url||input.sheetId&&input.sheetId!==sid)throw Error('Read-only request boundary');
  input.sheetId=sid;const data=await runtime(input);
  fs.writeFileSync(path.join(process.env.ZHIGAO_VERIFY_OUT,'read-calls.json'),JSON.stringify(log,null,2));
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data}));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:String(e.message).slice(0,500),code:e.code}));}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));

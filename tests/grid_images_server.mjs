import http from 'node:http';
import fs from 'node:fs';
import {imageFixture} from './grid_images_fixture.mjs';
const home=process.env.ZHIGAO_VERIFY_OUT;
if(!home)throw Error('A new verification directory is required');
fs.mkdirSync(home,{recursive:true});
const fixture=imageFixture(home,undefined,{floating:process.env.ZHIGAO_GRID_FLOATING==='1'});
const server=http.createServer(async(req,res)=>{
 try{
  let text='';for await(const chunk of req)text+=chunk;
  const body=JSON.parse(text||'{}');
  const data=req.url==='/control'?fixture.control(body):await fixture.runtime(body);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data}));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:e.message,code:e.code}));}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));

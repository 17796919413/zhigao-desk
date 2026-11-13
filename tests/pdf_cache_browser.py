"""Actual PDF.js rendering: cache hits, current-byte identity and LRU eviction."""
from pathlib import Path
import functools,http.server,threading,json,os
from playwright.sync_api import sync_playwright
http.server.ThreadingHTTPServer.request_queue_size=128
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('ZHIGAO_VERIFY_OUT',str(ROOT.parent/'_verify'/'workbuddy-performance-20261112')));OUT.mkdir(parents=True,exist_ok=True)
from synthetic_fixtures import pdf_bytes
fixture=pdf_bytes(2)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);context=browser.new_context();context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')");page=context.new_page();page.goto(f'http://127.0.0.1:{server.server_port}');page.wait_for_selector('#app')
  result=page.evaluate('''async raw=>{
   const m=await import('/pdf.js'),checks=[],assert=(v,s)=>{if(!v)throw Error(s);checks.push(s);};m.clearPdfCache();
   const bytes=new Uint8Array(raw.length+1);bytes.set(raw);bytes[raw.length]=10;const buffer=bytes.buffer;
   const first=await m.renderPdfPage(buffer,1),opens=m.pdfCacheStats.opens,hits=m.pdfCacheStats.imageHits;
   assert(first.startsWith('data:image/png;'),'actual PDF page renders to PNG');
   const copy=await m.renderPdfPage(buffer.slice(0),1);assert(copy===first&&m.pdfCacheStats.opens===opens&&m.pdfCacheStats.imageHits===hits+1,'identical cloned bytes reuse document and rendered image');
   bytes[raw.length]=32;await m.renderPdfPage(buffer,1);assert(m.pdfCacheStats.opens===opens+1,'in-place buffer mutation uses a new content identity');
   m.clearPdfCache();const variants=[];for(let i=1;i<=4;i++){const b=new Uint8Array(raw.length+i);b.set(raw);b.fill(32,raw.length);variants.push(b.buffer);await m.renderPdfPage(b.buffer,1);}
   const before=m.pdfCacheStats.opens;await m.renderPdfPage(variants[0],1);assert(m.pdfCacheStats.opens===before+1,'document cache evicts the least recent fourth document');
   let rejected=false;try{await m.renderPdfPage(buffer,999);}catch{rejected=true;}assert(rejected,'invalid page never returns a cached unrelated image');
   m.clearPdfCache();return {count:checks.length,checks};
  }''',list(fixture))
  (OUT/'pdf-cache.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result),flush=True);browser.close()
finally:server.shutdown()

"""Real Edge, synthetic data, isolated DB and blocked connector; no business writes."""
from pathlib import Path
import os,json,functools,http.server,threading,traceback,platform
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
class Handler(http.server.SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/agent.js':
   data=((ROOT/'agent.js').read_text(encoding='utf-8')+'\nwindow.agentProbe=tools;').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  if self.path.split('?')[0]=='/app.js':
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.probe={state:()=>({tasks,items,settings,batches,libraryImports}),persist:commitWorkbench,render,db:()=>db,dbOp,project,loadFile,actions,update:commitAgentProject,cleanup:flushLibraryCleanup,workbench,loadFile,setTask:id=>{task=tasks.find(t=>t.id===id)}};').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
checks=[];errors=[];environment={'system':platform.platform(),'python':platform.python_version(),'mode':'isolated Edge; synthetic data; no real Feishu'}
def passed(name):checks.append(name);print('PASS '+name,flush=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);environment['browser']=browser.version
  context=browser.new_context(viewport={'width':1440,'height':1000});context.route('http://127.0.0.1:47821/**',lambda r:r.abort())
  context.add_init_script("""if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-agent-v1','off');localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'p',projects:[{id:'p',name:'上传验收品牌',date:'v1',status:'active',selectedActivity:'a',activities:[{id:'a',name:'秋季'},{id:'b',name:'冬季'}],rules:[],library:[]}]}));localStorage.setItem('seed','1');}""")
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe')
  def upload(name,text='合成原稿'):
   page.locator('#file-input').set_input_files({'name':name,'mimeType':'text/plain','buffer':text.encode()})
  files=[{'name':n,'mimeType':'text/plain','buffer':t.encode()} for n,t in [('未署名.txt','未标注平台或阶段'),('坏文件.bin','broken'),('【小乙】小红书图文大纲.txt','正文'),('待归属.txt','达人：小丙')]]
  page.locator('#file-input').set_input_files(files)
  page.wait_for_function("probe.state().tasks.length===3&&document.querySelector('[data-action=wb-upload-retry]')")
  assert page.locator('[data-upload-field]').count()==0 and page.locator('[data-batch-doc]').count()==3
  page.reload();page.wait_for_function('window.probe && probe.state().tasks.length===3')
  assert page.evaluate("JSON.stringify([probe.state().tasks.find(t=>t.filename==='未署名.txt').platform,probe.state().tasks.find(t=>t.filename==='未署名.txt').stage])")=='["",""]'
  page.screenshot(path=str(OUT/'assignment-desktop.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'assignment-narrow.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  passed('混合投稿无归属表单、三份进入待审，坏件单独重试；刷新保留未知字段')
  ppt=page.evaluate("""async()=>{const {readSlideCells,writeSlideDraft}=await import('./pptx-draft.js'),z=new JSZip(),path='ppt/slides/slide1.xml';z.file(path,'<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:rPr b="1"/><a:t>容量5</a:t></a:r><a:r><a:t>00毫升</a:t></a:r></a:p>');z.file('ppt/media/a.png','untouched');const buf=await z.generateAsync({type:'arraybuffer'}),cells=await readSlideCells(buf);cells[0].current='容量300毫升';const bytes=await(await writeSlideDraft(buf,cells)).arrayBuffer(),out=await JSZip.loadAsync(bytes);return [(await readSlideCells(bytes))[0].current,await out.file(path).async('string'),await out.file('ppt/media/a.png').async('string')]}""")
  assert ppt[0]=='容量300毫升' and 'FF0000' in ppt[1] and ppt[2]=='untouched'
  passed('PPTX 两段不同格式的文字回写重读、变化标红，内嵌附件字节不变')
  assert not errors,errors;browser.close()
except Exception:
 errors.append(traceback.format_exc());print(errors[-1],flush=True)
finally:
 server.shutdown();server.server_close();(OUT/'result.json').write_text(json.dumps({'checks':checks,'errors':errors,'environment':environment,'passed':not errors},ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(1 if errors else 0)

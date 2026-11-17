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
   data=((ROOT/'app.js').read_text(encoding='utf-8')+'\nwindow.probe={state:()=>({tasks,items,settings,batches,libraryImports}),persist:commitWorkbench,render,db:()=>db,dbOp,project,loadFile,actions,update:commitAgentProject,cleanup:flushLibraryCleanup,workbench,delivery,saveBatch:saveAgentBatch,commitReview:commitAgentReview,build:aiDraftBlob,loadFile,setTask:id=>{task=tasks.find(t=>t.id===id)}};').encode()
   self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  super().do_GET()
http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
checks=[];errors=[];environment={'system':platform.platform(),'python':platform.python_version(),'mode':'isolated Edge; synthetic data; no real Feishu'}
def passed(name):checks.append(name);print('PASS '+name,flush=True)
import io,zipfile,base64,subprocess,xml.etree.ElementTree as ET
from synthetic_fixtures import png_bytes,pdf_bytes

def zipped(files):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w') as z:
  for name,value in files.items():z.writestr(name,value)
 return b.getvalue()
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
DOCX=zipped({'word/document.xml':f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:rPr><w:color w:val="0055AA"/><w:b/></w:rPr><w:t>合成稿件：星河杯容量为500毫升。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格原文保持不变。</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>'})
XLSX=zipped({'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="参数" sheetId="1" r:id="r1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="50" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><rPr><color rgb="FF0055AA"/><b/></rPr><t>合成稿件：星河杯容量为500毫升。</t></r></is></c><c r="B1"><v>7</v></c><c r="C1"><f>B1+1</f><v>8</v></c></row></sheetData></worksheet>'})
video=OUT/'合成短片.mp4'
subprocess.run(['ffmpeg','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x100:r=10','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',str(video)],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='msedge',headless=True);environment['browser']=browser.version;environment['boundary']='Synthetic protocol and file regression, including a one-second video intentionally left incomplete; not semantic model certification or long-video acceptance.'
  context=browser.new_context(viewport={'width':1440,'height':1000});context.route('http://127.0.0.1:47821/**',lambda r:r.abort())
  context.add_init_script("""if(!localStorage.getItem('seed')){localStorage.setItem('zhigao-agent-v1','off');localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'p',projects:[{id:'p',name:'混合格式合成测试',date:'v1',status:'active',rules:[],library:[{id:'brief',title:'合成验收规则',kind:'Brief',text:'本次合成材料中的星河杯容量标注应为300毫升。其他表格数字及公式保持原样，蓝色图片和PDF页面不直接修改。'}]}]}));localStorage.setItem('seed','1');}""")
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('!!window.probe')
  page.evaluate('window.showDirectoryPicker=async()=>await navigator.storage.getDirectory()');page.locator('[data-action=folder-pick]').first.click();page.wait_for_function("document.querySelector('.wb-setup').textContent.includes('更换')")
  files=[]
  for ext,data in [('docx',DOCX),('xlsx',XLSX),('pdf',pdf_bytes(1)),('png',png_bytes())]:
   for i in range(2):files.append({'name':f'【{ext}作者{i}】小红书图文初稿.{ext}','mimeType':'application/octet-stream','buffer':data})
  files += [{'name':'【视频作者】抖音视频初稿.mp4','mimeType':'video/mp4','buffer':video.read_bytes()},{'name':'【坏稿】小红书图文大纲.bin','mimeType':'application/octet-stream','buffer':b'broken'}]
  page.locator('#file-input').set_input_files(files);page.wait_for_function("probe.state().tasks.length===9&&document.querySelector('[data-action=wb-upload-retry]')",timeout=60000)
  assert sorted(set(t['fmt'] for t in page.evaluate('probe.state().tasks')))==['docx','image','pdf','video','xlsx'];passed('10份五类混合上传：9份保存、1份解析失败，失败件不计入待审批次')
  page.evaluate("""async()=>{const {createReviewService}=await import('./review-service.js');window.service=createReviewService({state:()=>probe.state(),saveBatch:probe.saveBatch,commitReview:probe.commitReview,saveAIDraft:t=>probe.delivery.draft(t),getMediaFile:async id=>(await probe.dbOp('get',id,'media'))?.blob});window.batch=await service.zhigao_create_review_batch();window.mediaImages=[];window.outcomes=[];
   window.reviewOne=async(id,mode='complete',retry=false)=>{const t=probe.state().tasks.find(t=>t.id===id),b=mode==='resumePartial'?await service.zhigao_reopen_review({docId:id,batchId:batch.id}):await service.zhigao_get_review_brief({docId:id,batchId:batch.id,retry}),args={docId:id,batchId:batch.id,reviewToken:b.reviewToken};const sections={};
    for(const [section,meta] of Object.entries(b.context))if(meta.required){sections[section]=[];let cursor;do{const r=await service.zhigao_read_review_context({...args,section,cursor});sections[section].push(...r.items);cursor=r.nextCursor}while(cursor)}
    if(mode==='fail'){await service.zhigao_fail_review({...args,reason:'合成故障：客户端本次审核中断'});return {failed:true}}
    const {buildBasisManifest}=await import('./review-assurance.js'),{inspectReviewMedia}=await import('./media-review.js');const manifest=await buildBasisManifest(t,probe.project()),media=await inspectReviewMedia(t);if(t.fmt==='video'){await service.zhigao_fail_review({...args,reason:'此短片未做完整逐帧和音频准备，保持未完成'});return {failed:true}}
    const mediaChecks=[];for(const a of media.assets){const read=await service.zhigao_read_review_asset({...args,assetId:a.id});mediaImages.push({docId:id,assetId:a.id,mime:read.mimeType,data:read.data});mediaChecks.push({assetId:a.id,receipt:read.receipt,coverage:'full',status:'reviewed',summary:t.fmt==='pdf'?'白底页面上方显示Synthetic PDF page 1及下一行完整英文句子。':'整张160乘100的蓝色矩形图片，没有文字或产品标注。',findings:[]});}
    const view=[...t.cells,...media.supplementalText],evidence=view.length?[{blockId:view[0].id,quote:view[0].current}]:[{assetId:media.assets[0].id,detail:'合成蓝色矩形原件，没有产品文字和容量标注'}];
    const changes=t.cells.filter(c=>!c.note&&c.current.includes('500')).map(c=>({id:c.id,original:c.current,revised:c.current.replace('500','300'),reason:'按合成Brief将容量500毫升改为300毫升'}));
    const result={snapshot:b.snapshot,basis:b.basis,reviewedIds:view.filter(c=>String(c.current).trim()).map(c=>c.id),changes,warnings:[],ruleChecks:[],sourceChecks:mode==='partial'?[]:manifest.sources.map(s=>({id:s.id,status:'checked',application:'applies',quote:s.text,reason:'逐项对照合成材料中的容量字段与只读媒体要求，其他内容保留',evidence})),mediaChecks,optionalSuggestions:t.cells.length?[{id:t.cells[0].id,suggestion:'可选：进一步压缩开头',reason:'表达选择，不属于必改'}]:[],mediaOpinions:t.fmt==='image'?[{assetId:media.assets[0].id,problem:'画面为纯蓝色，未出现产品主体。'}]:[]};
    const out=await service.zhigao_submit_review({...args,result});outcomes.push({id,fmt:t.fmt,status:out.status,complete:out.assurance.complete,diagnostics:out.assurance.diagnostics});return out;
   };
  }""")
  tasks=page.evaluate('probe.state().tasks');word=[t for t in tasks if t['fmt']=='docx'];excel=[t for t in tasks if t['fmt']=='xlsx']
  for t in tasks:
   mode='fail' if t['id']==word[0]['id'] else 'partial' if t['id']==excel[0]['id'] else 'complete'
   page.evaluate('([id,mode])=>reviewOne(id,mode)',[t['id'],mode])
  initial=page.evaluate('service.zhigao_get_review_batch({batchId:batch.id})');assert initial['success']==6 and initial['partial']==1 and initial['failed']==2,initial
  before=page.evaluate("Object.fromEntries(probe.state().tasks.filter(t=>t.ai?.assurance.complete).map(t=>[t.id,t.ai.at]))")
  retried=page.evaluate("id=>reviewOne(id,'complete',true)",word[0]['id']);assert retried['assurance']['complete'],retried
  resumed=page.evaluate("id=>reviewOne(id,'resumePartial')",excel[0]['id']);assert resumed['assurance']['complete'],resumed
  final=page.evaluate('service.zhigao_get_review_batch({batchId:batch.id})');assert final['success']==8 and final['failed']==1 and not final['complete'],final
  after=page.evaluate("Object.fromEntries(probe.state().tasks.filter(t=>t.ai?.assurance.complete).map(t=>[t.id,t.ai.at]))");assert all(after[k]==v for k,v in before.items())
  (OUT/'batch-summary.json').write_text(json.dumps({'initial':initial,'final':final,'outcomes':page.evaluate('outcomes')},ensure_ascii=False,indent=2),encoding='utf-8')
  passed('失败与部分完成分开计数，续审只补两份；未完整准备的视频保持失败，8份完成不能报整批完成')
  # Read back generated Office bytes, verify exact changed glyph/color and stable formulas.
  outputs=page.evaluate("""async()=>{const results=[];for(const t of probe.state().tasks.filter(t=>['docx','xlsx'].includes(t.fmt))){const d=await probe.build(t),buffer=await d.blob.arrayBuffer(),zip=await JSZip.loadAsync(buffer),path=t.fmt==='docx'?'word/document.xml':'xl/worksheets/sheet1.xml',xml=await zip.file(path).async('string');const parsed=t.fmt==='docx'?await (await import('./docx.js')).readDocx(buffer):await (await import('./xlsx.js')).readWorkbook(buffer),cells=t.fmt==='docx'?parsed.cells:(await import('./xlsx.js')).workbookCells(parsed);let binary='';for(const byte of new Uint8Array(buffer))binary+=String.fromCharCode(byte);results.push({id:t.id,fmt:t.fmt,base64:btoa(binary),xml,cells:cells.map(c=>({id:c.id,current:c.current,note:c.note})),archive:t.ai.archive,statuses:t.ai.changes.map(c=>c.status)});}return results;}""")
  for i,r in enumerate(outputs):
   (OUT/f'modified-{i}.{r["fmt"]}').write_bytes(base64.b64decode(r.pop('base64')))
   assert all(s=='pending' for s in r['statuses']);assert any('300' in c['current'] for c in r['cells']);assert r['archive']['state']=='saved',r['archive']
   assert 'FF0000' in r['xml'].upper() and '0055AA' in r['xml'].upper()
   red=[]
   for run in ET.fromstring(r['xml']).iter():
    if run.tag.split('}')[-1]!='r':continue
    if any(el.tag.split('}')[-1]=='color' and any(v.upper().endswith('FF0000') for v in el.attrib.values()) for el in run.iter()):red.append(''.join(el.text or '' for el in run.iter() if el.tag.split('}')[-1]=='t'))
   assert ''.join(red)=='3',red

   if r['fmt']=='xlsx':assert '<f>B1+1</f>' in r['xml'] and '<v>7</v>' in r['xml'] and '<v>8</v>' in r['xml']
  (OUT/'office-reopen.json').write_text(json.dumps(outputs,ensure_ascii=False,indent=2),encoding='utf-8')
  passed('无需点击采纳即生成Office修改稿，重新解析含300毫升，原蓝色和公式数值保留，自动归档完成')
  for i,asset in enumerate(page.evaluate('mediaImages')):(OUT/f'media-read-{i}.png').write_bytes(base64.b64decode(asset['data']))
  for fmt in ['docx','xlsx']:
   t=next(t for t in tasks if t['fmt']==fmt);page.locator(f'[data-doc-id="{t["id"]}"] [data-action=wb-detail]').click();page.wait_for_function("document.querySelector('[data-preview-id] iframe')?.srcdoc?.length>100")
   host=page.locator(f'[data-doc-id="{t["id"]}"] [data-preview-id]');host.screenshot(path=str(OUT/f'{fmt}-comparison.png'))
   page.locator(f'[data-doc-id="{t["id"]}"] [data-action=wb-detail]').click()
  media_doc=next(t for t in tasks if t['fmt']=='image')
  page.evaluate("()=>{navigator.clipboard.writeText=async text=>window.copiedOpinion=text}")
  page.locator(f'[data-doc-id="{media_doc["id"]}"] [data-action=wb-detail]').click();page.locator(f'[data-doc-id="{media_doc["id"]}"] [data-action=wb-copy-opinions]').click()
  report=page.evaluate("""async id=>{const t=probe.state().tasks.find(t=>t.id===id),read=async path=>{let dir=await navigator.storage.getDirectory();const parts=path.split('/');for(const p of parts.slice(0,-1))dir=await dir.getDirectoryHandle(p);return (await (await dir.getFileHandle(parts.at(-1))).getFile()).text()};return {copied:copiedOpinion,output:await read(t.ai.archive.output),notes:await read(t.ai.archive.notes)}}""",media_doc['id'])
  assert report['copied']=='图片原件：画面为纯蓝色，未出现产品主体。';assert '画面为纯蓝色，未出现产品主体。' in report['output'] and '画面为纯蓝色，未出现产品主体。' in report['notes'];assert '未发现需要修改' not in report['notes']
  (OUT/'media-opinion-report.html').write_text(report['output'],encoding='utf-8')
  report_page=context.new_page();report_page.set_content(report['output']);report_page.screenshot(path=str(OUT/'media-opinion-report.png'),full_page=True);report_page.close()
  passed('媒体复制内容、归档报告和意见单一致；仅变化的数字3标红，未改的00保留原蓝色')
  page.screenshot(path=str(OUT/'mixed-batch-result.png'),full_page=True)
  assert not errors,errors;browser.close()
except Exception:
 errors.append(traceback.format_exc());print(errors[-1],flush=True)
finally:
 server.shutdown();server.server_close();(OUT/'result.json').write_text(json.dumps({'checks':checks,'errors':errors,'environment':environment,'passed':not errors},ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(1 if errors else 0)

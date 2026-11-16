from pathlib import Path
exec((Path(__file__).parent/'business_consistency_browser.py').read_text(encoding='utf-8').split('try:\n with sync_playwright()')[0])

def feedback_retry(c,p):
 upload(p);q=c.new_page();q.goto(origin);q.wait_for_function('!!window.probe')
 for page,text in [(p,'甲反馈'),(q,'乙反馈')]:
  page.locator('.wb-feedback summary').click();page.locator('[data-feedback-text]').fill(text);page.locator('[data-action=wb-feedback-save]').click();page.wait_for_timeout(150)
 assert [f['text'] for f in p.evaluate(READ,'tasks')[0]['brandFeedback']]==['甲反馈']
 q.reload();q.wait_for_function('!!window.probe');assert q.locator('[data-feedback-text]').input_value()=='乙反馈'
 q.locator('[data-action=wb-feedback-save]').click();q.wait_for_function('document.querySelectorAll(".wb-feedback-entry").length===2')
 assert q.locator('[data-feedback-text]').input_value()==''
 q.reload();q.wait_for_function('!!window.probe');assert q.locator('[data-feedback-text]').input_value()==''
def aborted_import(c,p):
 p.evaluate("""()=>{window.put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,...args){const q=put.call(this,v,...args);if(this.name==='tasks'){q.addEventListener('success',()=>this.transaction.abort())}return q}}""")
 r=p.evaluate("""async m=>{try{await probe.applyBundle(m);return 'unexpected success'}catch(e){return e.message}}""",bundle())
 assert r!='unexpected success';assert not p.evaluate(READ,'tasks');assert not p.evaluate(READ,'items')
 assert 'transfer' not in p.evaluate("JSON.parse(localStorage.getItem('zhigao-settings-v1')).projects.map(p=>p.id)")
 p.evaluate('()=>{IDBObjectStore.prototype.put=put}');p.reload();p.wait_for_function('!!window.probe');assert not p.evaluate(READ,'tasks')
def journal(c,p,committed):
 p.evaluate("""async committed=>{const before=localStorage.getItem('zhigao-settings-v1'),s=JSON.parse(before);s.projects.push({id:'recover',name:'恢复测试',rules:[],library:[]});const after=JSON.stringify(s);await new Promise((ok,no)=>{const tx=probe.db().transaction('integrations','readwrite');tx.objectStore('integrations').put({id:'synthetic-journal',kind:'bundle-import',state:committed?'committed':'prepared',before,after});tx.oncomplete=ok;tx.onerror=()=>no(tx.error)});if(!committed)localStorage.setItem('zhigao-settings-v1',after)}""",committed)
 p.reload();p.wait_for_function('!!window.probe');assert ('recover' in p.evaluate('probe.state().settings.projects.map(p=>p.id)'))==committed
 assert not [j for j in p.evaluate(READ,'integrations') if j.get('kind')=='bundle-import']
def repeat_bundle(c,p):
 m=bundle();m['docs'][0]['remarks']=[{'id':'s','status':'open','t':0,'text':'合法截图','shot':p.evaluate("()=>{const c=document.createElement('canvas');c.width=c.height=2;return c.toDataURL('image/png')}")}]
 for _ in range(2):assert p.evaluate('async m=>await probe.applyBundle(m)',m)==1
 records=p.evaluate(READ,'tasks');assert len(records)==2;assert len(set(x['id'] for x in records))==2
 # Deleting original IDs cannot let an old page recreate them; importing instead remaps them.
 p.evaluate("async()=>{const m=await import('/content-delete.js');await m.deleteContentRecords(probe.db(),{docIds:['td']})}")
 assert p.evaluate('async m=>await probe.applyBundle(m)',m)==1
 rows=p.evaluate(READ,'tasks');assert len(rows)==2;assert all(r['id']!='td' for r in rows)
def original_reuse(c,p):
 r=p.evaluate("""async m=>{m.libraryAssets=[{id:'asset',file:{filename:'原文.txt',fmt:'text',originalFile:new File(['原文'],'原文.txt')}}];await probe.applyBundle(m);await probe.applyBundle(m);let blocked=false;try{m.libraryAssets[0].file.originalFile=new File(['不同原文'],'原文.txt');await probe.applyBundle(m)}catch{blocked=true}return blocked}""",bundle());assert r
 assert len(p.evaluate(READ,'tasks'))==2;assert len(p.evaluate(READ,'media'))==1
def schema(c,p):
 variants=[]
 for kind in ['orphan','duplicate','duration','state','image']:
  m=bundle()
  if kind=='orphan':m['docs'][0]['itemId']='missing'
  if kind=='duplicate':m['docs'].append(m['docs'][0].copy())
  if kind=='duration':m['docs'][0]['width']='<img src=x onerror=alert(1)>'
  if kind=='state':m['docs'][0]['flow']['state']='unknown'
  if kind=='image':m['docs'][0]['remarks']=[{'text':'bad','shot':'data:image/svg+xml;base64,PHN2Zz4='}]
  variants.append(m)
 assert p.evaluate("""async list=>{const {validateBundle}=await import('/bundle-validation.js');return list.every(m=>{try{validateBundle(m);return false}catch{return true}})}""",variants)
def assignment(c,p):
 upload(p,'【合成达人】小红书图文大纲-产品甲.txt')
 upload(p,'【合成达人】小红书图文大纲-产品乙.txt')
 assert len(p.evaluate(READ,'items'))==2
 p.locator('#file-input').set_input_files({'name':'【合成达人】小红书图文初稿.txt','mimeType':'text/plain','buffer':'无明确标题的初稿'.encode()})
 p.wait_for_selector('[data-action=wb-upload-assign]');p.screenshot(path=str(OUT/'assignment-desktop.png'),full_page=True)
 p.set_viewport_size({'width':390,'height':844});assert p.evaluate('document.documentElement.scrollWidth<=innerWidth');p.screenshot(path=str(OUT/'assignment-mobile.png'),full_page=True)
 p.locator('[data-upload-choice]').select_option('0');p.locator('[data-action=wb-upload-assign]').click();p.wait_for_function('probe.state().tasks.length===3');assert len(p.evaluate(READ,'items'))==2
def workbook_types(c,p):
 r=p.evaluate("""async()=>{const z=new JSZip();z.file('xl/workbook.xml','<workbook xmlns:r="r"><sheets><sheet name="全类型" sheetId="1" r:id="r1"/></sheets></workbook>');z.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');z.file('xl/styles.xml','<styleSheet><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="10"/><xf numFmtId="14"/></cellXfs></styleSheet>');const xml='<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>原文</t></is></c><c r="B1" s="1"><v>0.125</v></c><c r="C1" t="b"><v>0</v></c><c r="D1" s="2"><v>1</v></c><c r="E1"><f>1+1</f><v>2</v></c><c r="F1" t="e"><v>#DIV/0!</v></c><c r="G1" t="d"><v>2026-02-31</v></c><c r="H1" s="9"><v>1</v></c></row></sheetData></worksheet>';z.file('xl/worksheets/sheet1.xml',xml);const buffer=await z.generateAsync({type:'arraybuffer'});const x=await import('/xlsx.js'),m=await import('/media-review.js');const b=await x.readWorkbook(buffer),cells=x.workbookCells(b);let rejected=false;try{await x.writeWorkbook(b,cells.map(c=>c.address==='E1'?{...c,current:'3'}:c))}catch{rejected=true}const changed=cells.map(c=>c.address==='A1'?{...c,current:'改文'}:c),out=await x.writeWorkbook(b,changed),zip=await JSZip.loadAsync(await out.arrayBuffer()),after=await zip.file('xl/worksheets/sheet1.xml').async('string');const inspect=m.createMediaInspector(),first=await inspect({fmt:'xlsx',buffer,cells:[]}),second=await inspect({fmt:'xlsx',buffer,cells});return {values:Object.fromEntries(cells.map(c=>[c.address,c.current])),blocked:b.blockers.length,rejected,formulaPreserved:after.includes('<c r="E1"><f>1+1</f><v>2</v></c>'),supplements:[first.supplementalText.length,second.supplementalText.length]}}""")
 assert r['values']=={'A1':'原文','B1':'12.50%','C1':'FALSE','D1':'01-01-00','E1':'2','F1':'#DIV/0!','G1':'2026-02-31','H1':'1'},r
 assert r['rejected'] and r['blocked']==3 and r['formulaPreserved'];assert r['supplements']==[8,0],r
def stored_tests(c,p):assert len(p.evaluate("async()=>await (await import('/tests/review_storage_browser.mjs')).run()"))==4
def archive_names(c,p):
 r=p.evaluate("""async()=>{const {saveToFolder}=await import('/folder.js'),root=await navigator.storage.getDirectory(),name='😀中文'.repeat(50)+'.docx',paths=[];for(const text of ['first','second'])paths.push(await saveToFolder(root,['synthetic'],name,new Blob([text])));const dir=await root.getDirectoryHandle('synthetic');return {names:paths.map(p=>p.split('/').pop()),values:await Promise.all(paths.map(async p=>await (await (await dir.getFileHandle(p.split('/').pop())).getFile()).text()))}}""")
 assert r['values']==['first','second'];assert len(set(r['names']))==2
 assert all(n.endswith('.docx') and len(n.encode('utf-16-le'))//2<=120 for n in r['names'])
def old_workbook(c,p):
 upload(p)
 p.evaluate("""async()=>{const z=new JSZip();z.file('xl/workbook.xml','<workbook xmlns:r="r"><sheets><sheet name="表" sheetId="1" r:id="r"/></sheets></workbook>');z.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r" Target="worksheets/sheet1.xml"/></Relationships>');z.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>原文</t></is></c><c r="B1"><v>999</v></c></row></sheetData></worksheet>');const t=structuredClone(probe.state().tasks[0]);delete t.revision;Object.assign(t,{fmt:'xlsx',filename:'旧数据.xlsx',buffer:await z.generateAsync({type:'arraybuffer'}),scope:{mode:'full'},cells:[{id:'1!A1',address:'A1',original:'原文',current:'已人工修改'}],ai:{changes:[],assurance:{complete:true},needsSupplement:false}});await new Promise((r,j)=>{const tx=probe.db().transaction('tasks','readwrite');tx.objectStore('tasks').put(t);tx.oncomplete=r;tx.onerror=()=>j(tx.error)})}""")
 p.reload();p.wait_for_function('!!window.probe');t=p.evaluate(READ,'tasks')[0]
 assert t['cells'][0]['current']=='已人工修改';assert t['cells'][1]['current']=='999';assert t['fullReviewPending'] and t['scope']['valueCoverage']==2
 rev=t['revision'];p.reload();p.wait_for_function('!!window.probe');assert p.evaluate(READ,'tasks')[0]['revision']==rev
def sync_validity(c,p):
 upload(p)
 values=p.evaluate("""async()=>{const {autoMap,rowKey}=await import('/feishu.js'),s=probe.state(),p=s.settings.projects[0],it=s.items[0],t=s.tasks[0],url='https://example.invalid/sheets/test',sheet={id:'s',remoteId:'s',live:true,sourceUrl:url,headers:['达人','发布平台','合作产品','大纲'],rows:[[it.author,it.platform,it.title,'']]};sheet.map=autoMap(sheet.headers);p.date='new';p.feishu={refined:{url},sheets:[sheet]};it.feishu={sheetId:'s',key:rowKey(sheet,0)};t.ai={changes:[],needsSupplement:false,assurance:{complete:true,projectRevision:'old'}};let values=[probe.fsLiveWrites(p).map(x=>x.c.ours)];t.ai.assurance.projectRevision='new';t.fullReviewPending=true;values.push(probe.fsLiveWrites(p).map(x=>x.c.ours));return values.flat()}""")
 assert len(values)==2 and all('审核未完成' in v and 'AI已审' not in v for v in values),values
def legacy_image(c,p):
 upload(p)
 p.evaluate("""async()=>{const t=probe.state().tasks[0];await probe.persist([['tasks',{...t,fmt:'video',filename:'旧数据.mp4',duration:1,width:1,height:1,size:1,cells:[],remarks:[{id:'x',t:0,status:'open',cat:'画面',text:'旧数据',shot:'x" onerror="document.body.dataset.injected=1" data-x="'}]}]]);probe.render()}""")
 p.locator('.wb-meta summary').click();p.locator('[data-action=open-task]').click();p.wait_for_timeout(150)
 assert p.evaluate('!document.body.dataset.injected');assert not p.locator('img.v-shot').count()
 html=p.evaluate('()=>probe.videoNotesHtml(probe.state().tasks[0])');q=c.new_page();q.set_content(html);q.wait_for_timeout(100);assert q.evaluate('!document.body.dataset.injected')
 p.screenshot(path=str(OUT/'legacy-image-safe.png'),full_page=True)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(channel='msedge',headless=True)
  for name,fn in [('feedback-conflict-retry',feedback_retry),('import-async-abort',aborted_import),('import-recover-prepared',lambda c,p:journal(c,p,False)),('import-recover-committed',lambda c,p:journal(c,p,True)),('import-repeat-and-deleted-ids',repeat_bundle),('import-original-reuse',original_reuse),('bundle-schema',schema),('upload-assignment',assignment),('xlsx-types-roundtrip-cache',workbook_types),('existing-indexeddb-suite',stored_tests),('archive-long-duplicate-names',archive_names),('legacy-xlsx-migration',old_workbook),('sync-plan-validity',sync_validity),('legacy-image-render',legacy_image)]:run(name,fn,b)
  b.close()
finally:server.shutdown();server.server_close()
if any(not r['passed'] for r in results):raise SystemExit(1)

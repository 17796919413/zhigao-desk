"""Synthetic browser exports reopened by native Word/Excel; no model quality claim."""
from pathlib import Path
import base64
import functools
import http.server
import json
import os
import platform
import threading
import traceback
from playwright.sync_api import sync_playwright
from office_native_fixture import create_fixtures, verify_native

ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
checks=[];errors=[];environment={'system':platform.platform(),'python':platform.python_version(),
    'mode':'Synthetic protocol checks; isolated Edge and OPFS; native Office; no external business writes'}

class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def do_GET(self):
        if self.path.split('?')[0]=='/app.js':
            data=((ROOT/'app.js').read_text(encoding='utf-8')+'''\nwindow.probe={state:()=>({tasks,items,settings,batches}),
                dbOp,project,render,delivery,build:aiDraftBlob,saveBatch:saveAgentBatch,commitReview:commitAgentReview};''').encode()
            self.send_response(200);self.send_header('Content-Type','text/javascript')
            self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        super().do_GET()

def passed(name):checks.append(name);print('PASS '+name,flush=True)

http.server.ThreadingHTTPServer.request_queue_size=128
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    word,excel=create_fixtures(OUT)
    passed('创建含图片、链接、页眉页脚、分页、表格及跨表公式的合成原件；Excel原生计算缓存')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True)
        environment['browser']=browser.version
        context=browser.new_context(viewport={'width':1440,'height':1050})
        context.route('http://127.0.0.1:47821/**',lambda route:route.abort())
        context.add_init_script('''if(!localStorage.getItem('seed')){
          localStorage.setItem('zhigao-agent-v1','off');
          localStorage.setItem('zhigao-settings-v1',JSON.stringify({selected:'p',projects:[{id:'p',name:'复杂Office合成验收',date:'v1',status:'active',rules:[],library:[{id:'brief',title:'合成规则',text:'星河杯容量为300毫升。不可改写链接中的500毫升为专门的保护测试样本，保留原文并明确提醒。'}]}]}));localStorage.setItem('seed','1');}''')
        page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}');page.wait_for_function('!!window.probe')
        page.evaluate('window.showDirectoryPicker=async()=>navigator.storage.getDirectory()')
        page.locator('[data-action=folder-pick]').first.click()
        page.wait_for_function("document.querySelector('.wb-setup').textContent.includes('更换')")
        page.locator('#file-input').set_input_files([
            {'name':'【Word作者】小红书图文大纲.docx','mimeType':'application/octet-stream','buffer':word.read_bytes()},
            {'name':'【Excel作者】小红书图文大纲.xlsx','mimeType':'application/octet-stream','buffer':excel.read_bytes()},
            {'name':'【可选作者】小红书图文大纲.txt','mimeType':'text/plain','buffer':'星河杯容量为300毫升。'.encode()}])
        page.wait_for_function('probe.state().tasks.length===3',timeout=60000)
        outputs=page.evaluate('''async()=>{
          const {createReviewService}=await import('/review-service.js'),{inspectReviewMedia}=await import('/media-review.js');
          const service=createReviewService({state:()=>probe.state(),saveBatch:probe.saveBatch,commitReview:probe.commitReview,saveAIDraft:t=>probe.delivery.draft(t)});
          const results=[];
          for(const t of probe.state().tasks){
            const brief=await service.zhigao_get_review_brief({docId:t.id}),args={docId:t.id,reviewToken:brief.reviewToken},sections={};
            for(const [name,meta] of Object.entries(brief.context))if(meta.required){sections[name]=[];let cursor;do{const part=await service.zhigao_read_review_context({...args,section:name,cursor});sections[name].push(...part.items);cursor=part.nextCursor;}while(cursor);}
            const media=await inspectReviewMedia(t),view=[...t.cells,...media.supplementalText],checks=[];
            for(const asset of media.assets){const read=await service.zhigao_read_review_asset({...args,assetId:asset.id});checks.push({assetId:asset.id,receipt:read.receipt,status:'reviewed',coverage:'full',summary:'合成图片为蓝色横向矩形，中央有白色矩形，没有文字或容量参数。',findings:[]});}
            const changes=t.cells.filter(c=>!c.note&&c.current.includes('500')).map(c=>({id:c.id,original:c.current,revised:c.current.replace('500','300'),reason:'合成规则容量为300毫升'}));
            const locked=t.cells.find(c=>c.note&&c.current.includes('500'));
            const result={snapshot:brief.snapshot,basis:brief.basis,reviewedIds:view.filter(c=>c.current.trim()).map(c=>c.id),changes,
              warnings:locked?['内部链接所在段落不可安全改写，已保留500毫升原文。']:[],ruleChecks:[],mediaChecks:checks,
              sourceChecks:(sections.sources||[]).map(s=>({id:s.id,status:'checked',application:'applies',quote:s.text,reason:'逐项核对容量；不可改写链接保持原样并提醒',evidence:[{blockId:t.cells[0].id,quote:t.cells[0].current}]})),
              optionalSuggestions:t.fmt==='text'?[{id:t.cells[0].id,suggestion:'可选缩短开头',reason:'仅风格选择'}]:[]};
            if(locked){let denied=false;try{await service.zhigao_submit_review({...args,dryRun:true,result:{...result,changes:[...changes,{id:locked.id,original:locked.current,revised:locked.current.replace('500','300'),reason:'故意触发只读保护'}]}});}catch(error){denied=error.code==='BLOCK_READ_ONLY';}if(!denied)throw Error('Locked cell was not rejected');}
            const submitted=await service.zhigao_submit_review({...args,result});if(!submitted.assurance.complete)throw Error(JSON.stringify(submitted.assurance));
            const saved=probe.state().tasks.find(d=>d.id===t.id),draft=await probe.build(saved),bytes=new Uint8Array(await draft.blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
            results.push({id:t.id,fmt:t.fmt,base64:btoa(binary),changes:saved.ai.changes,archive:saved.ai.archive});
          }return results;
        }''')
        for result in outputs:
            if result['fmt'] in ['docx','xlsx']:
                (OUT/('modified.'+result['fmt'])).write_bytes(base64.b64decode(result.pop('base64')))
            else:result.pop('base64')
            assert result['archive']['state']=='saved',result
            assert all(c['status']=='pending' for c in result['changes'])
        (OUT/'browser-exports.json').write_text(json.dumps(outputs,ensure_ascii=False,indent=2),encoding='utf-8')
        passed('复杂Office完整读取及真实素材回执；只读链接改写拒绝；必改无需采纳即可出稿并归档')
        optional=next(r for r in outputs if r['fmt']=='text')
        row=page.locator(f'[data-doc-id="{optional["id"]}"]')
        row.locator('[data-action=wb-detail]').click();row.locator('.wb-reasons summary').click()
        assert '· 1' in row.locator('.wb-reasons summary').inner_text()
        assert '暂无修改意见' not in row.locator('.wb-reasons').inner_text()
        assert '未写入修改稿' in row.locator('.wb-reasons').inner_text()
        assert '1 条可选优化' in row.locator('.wb-state').inner_text()
        page.wait_for_function("!document.querySelector('#toast.show')")
        row.screenshot(path=str(OUT/'optional-desktop.png'))
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        row.screenshot(path=str(OUT/'optional-narrow.png'))
        page.set_viewport_size({'width':1440,'height':1050})
        passed('仅可选优化时显示1条，不再误报暂无意见；桌面与390px页面无横向溢出')
        legacy=page.evaluate('''async()=>{const {mediaOpinionsText,reviewReportHtml}=await import('/review-summary.js');
          const t={...probe.state().tasks.find(t=>t.fmt==='text'),id:'legacy-image',fmt:'image',filename:'合成旧结果.png',ai:{at:'legacy-v1',changes:[],warnings:['图片原件：未展示产品主体。'],assurance:{complete:true,mediaChecks:[{assetId:'image:original',receipt:'historic-receipt',status:'reviewed',findings:['未展示产品主体。']}]}}},written={};
          const {createDelivery}=await import('/review-delivery.js');let current=t;
          const delivery=createDelivery({get:()=>current,all:()=>[current],available:()=>true,save:async value=>current=value,refresh:()=>{},name:(t,ext,label)=>label+'.'+ext,write:async(t,kind,name,blob)=>{written[kind]=await blob.text();return name;},build:async t=>({blob:new Blob([reviewReportHtml(t,probe.project())]),ext:'html',skipped:0})});
          await delivery.draft(t);return {copied:mediaOpinionsText(t),written};}''')
        assert legacy['copied']=='图片原件：未展示产品主体。'
        assert all('未展示产品主体。' in legacy['written'][key] for key in ['out','notes'])
        assert '未发现需要修改' not in legacy['written']['notes']
        assert legacy['written']['out'].count('未展示产品主体。')==1
        (OUT/'legacy-media-report.html').write_text(legacy['written']['out'],encoding='utf-8')
        report=context.new_page();report.set_content(legacy['written']['out']);report.screenshot(path=str(OUT/'legacy-media-report.png'));report.close()
        passed('旧媒体结果恢复确切位置；复制、输出报告、归档意见单一致且不误报无问题')
        assert not errors,errors
        browser.close()
    native=verify_native(OUT)
    environment.update({k:native[k] for k in ['wordVersion','excelVersion']})
    passed('Microsoft Word/Excel原生重开与PDF导出；只将数字3标红，原色/粗体/公式/日期/链接/图片/多表/布局保留')
except Exception:
    errors.append(traceback.format_exc());print(errors[-1],flush=True)
finally:
    server.shutdown();server.server_close()
    (OUT/'result.json').write_text(json.dumps({'passed':not errors,'checks':checks,'errors':errors,'environment':environment},ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(1 if errors else 0)

"""Real Edge/OPFS: backup reads remain usable through later compaction."""
from pathlib import Path
import functools, http.server, json, os, threading, traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['ZHIGAO_VERIFY_OUT'])
OUT.mkdir(parents=True, exist_ok=False)

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
checks = []
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context()
        context.add_init_script("localStorage.setItem('zhigao-agent-v1','off')")
        page = context.new_page()
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function("!!document.querySelector('.navbtn')")
        result = page.evaluate("""async()=>{
            const m=await import('./project-backup.js'),root=await navigator.storage.getDirectory();
            const snapshot=text=>({projects:[{id:'read-synthetic',name:'读取稳定性合成项目',rules:[],library:[]}],items:[{id:'i',projectId:'read-synthetic',kind:'图文'}],docs:[{id:'d',projectId:'read-synthetic',itemId:'i',fmt:'text',cells:[]}],batches:[],integrations:[{id:'upload:u',kind:'pending-upload',projectId:'read-synthetic',file:new File([text],'待上传.txt')}],media:[],libraryAssets:[],artifacts:[{docId:'d',path:'意见单.html',blob:new Blob([text])}]});
            await m.saveProjectBackup(root,snapshot('原始备份内容'));
            const dir=await root.getDirectoryHandle(await m.backupDirectoryName('read-synthetic'));
            const read=await m.readProjectBackup(dir);
            await m.saveProjectBackup(root,snapshot('新版备份内容'));
            const result={};
            for(const [name,blob]of [['pending',read.data.integrations[0].file],['artifact',read.data.artifacts[0].blob]]){
                try{result[name]={text:await blob.text()};}catch(e){result[name]={error:e.name+': '+e.message};}
            }
            result.latest=(await m.readProjectBackup(dir)).data.integrations[0].file;
            result.latestText=await result.latest.text();delete result.latest;
            return result;
        }""")
        (OUT / 'observed.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        assert result['pending'].get('text') == '原始备份内容', result
        checks.append('读取所得待上传原件在后续备份清理后仍可读取')
        assert result['artifact'].get('text') == '原始备份内容', result
        checks.append('读取所得意见单在后续备份清理后仍可读取')
        assert result['latestText'] == '新版备份内容', result
        checks.append('最新备份回读为新内容，旧块清理不影响已读取副本')
        identity = page.evaluate("localStorage.getItem('zhigao-backup-writer-v1')")
        page.reload()
        page.wait_for_function("!!document.querySelector('.navbtn')")
        resumed = page.evaluate("""async()=>{const m=await import('./project-backup.js'),root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle(await m.backupDirectoryName('read-synthetic')),r=await m.readProjectBackup(dir);r.data.projects[0].notes='刷新后继续';const saved=await m.saveProjectBackup(root,r.data);const names=[];for await(const [name]of dir.entries())if(name.startsWith('writer-'))names.push(name);return{state:saved.state,names,identity:localStorage.getItem('zhigao-backup-writer-v1')};}""")
        assert resumed['state'] == 'saved' and resumed['identity'] == identity and len(resumed['names']) == 1, resumed
        checks.append('真实浏览器刷新后沿用持久写入身份，原项目可继续保存且不新增身份声明')
        replaced = page.evaluate("""async()=>{const m=await import('./project-backup.js'),root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle(await m.backupDirectoryName('read-synthetic'));let changed=false;const wrapper={getDirectoryHandle:(...args)=>dir.getDirectoryHandle(...args),getFileHandle:async(name,...args)=>{const h=await dir.getFileHandle(name,...args);if(name!=='latest.json')return h;return{getFile:async()=>{const file=await h.getFile();if(!changed){changed=true;const read=await m.readProjectBackup(dir);read.data.projects[0].notes='索引读取中更新';await m.saveProjectBackup(root,read.data);}return file;}};}};try{const read=await m.readProjectBackup(wrapper);return{notes:read.data.projects[0].notes};}catch(e){return{error:e.name+': '+e.message};}}""")
        (OUT / 'replaced-manifest.json').write_text(json.dumps(replaced, ensure_ascii=False, indent=2), encoding='utf-8')
        assert replaced.get('notes') == '索引读取中更新', replaced
        checks.append('最新索引File句柄在读取前被替换时，重新取得当前索引并完成读取')
        (OUT / 'result.json').write_text(json.dumps({'ok': True, 'checks': checks, 'browser': browser.version, 'externalDirectory': False, 'realRemoteWrites': 0}, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'ok': True, 'checks': checks}, ensure_ascii=False))
        browser.close()
except Exception:
    (OUT / 'failure.json').write_text(json.dumps({'ok': False, 'checks': checks, 'traceback': traceback.format_exc()}, ensure_ascii=False, indent=2), encoding='utf-8')
    raise
finally:
    server.shutdown()

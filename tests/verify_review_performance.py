"""Run independent local regressions with retained logs, then browser checks."""
from pathlib import Path
import concurrent.futures,json,os,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[1]
OUT=Path(os.environ.get('ZHIGAO_VERIFY_OUT',str(ROOT.parent/'_verify'/'workbuddy-performance-20261112')))
OUT.mkdir(parents=True,exist_ok=True)
commands={
 'connector-connection':[sys.executable,'-X','utf8','-m','unittest','discover','-s','tests','-p','connector_connection_test.py'],
 'connector-environment':[sys.executable,'-X','utf8','-m','unittest','discover','-s','tests','-p','connector_environment_test.py'],
 'context':['node','tests/review_context_test.mjs'],
 'assurance':['node','tests/review_assurance_test.mjs'],
 'feedback-unit':['node','tests/workbench_feedback_test.mjs'],
 'report':['node','tests/review_report_test.mjs'],
 'media-edge':['node','tests/media_runtime_edge_test.mjs'],
 'connector-runtime':[sys.executable,'-X','utf8','-m','unittest','discover','-s','tests','-p','connector_runtime_test.py'],
 'connector-updates':[sys.executable,'-X','utf8','-m','unittest','discover','-s','tests','-p','connector_updates_test.py'],
}
def run(name,command,subdir=None):
 started=time.monotonic();env={**os.environ,'PYTHONIOENCODING':'utf-8'}
 env['ZHIGAO_VERIFY_OUT']=str(OUT/subdir if subdir else OUT)
 with (OUT/(name+'.log')).open('w',encoding='utf-8') as log:
  result=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
 data={'name':name,'exitCode':result.returncode,'seconds':round(time.monotonic()-started,2),'log':str(OUT/(name+'.log'))}
 print(json.dumps(data),flush=True);return data
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for future in concurrent.futures.as_completed([pool.submit(run,k,v) for k,v in commands.items()]):results.append(future.result())
for name,script,subdir in [('agent-connection-browser','agent_connection_browser.py',None),('feedback-browser','workbench_feedback_browser.py','feedback'),('extra-browser','workbench_extra_browser.py','extra'),('performance-browser','review_performance_browser.py',None),('pdf-cache-browser','pdf_cache_browser.py',None),('environment-browser','environment_browser.py',None)]:
 results.append(run(name,[sys.executable,'-X','utf8','tests/'+script],subdir))
summary={'checks':results,'passed':all(x['exitCode']==0 for x in results)}
(OUT/'suite.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
raise SystemExit(0 if summary['passed'] else 1)

"""Opt-in live test: only CP7 synthetic sheet, isolated connector copy/home/port."""
from pathlib import Path
import os,json,socket,subprocess,urllib.request,urllib.error,time,uuid,traceback
assert os.environ.get('ZHIGAO_GRID_LIVE')=='1','Requires explicit live-test opt-in'
ROOT=Path(__file__).resolve().parents[1];OUT=Path(os.environ['ZHIGAO_VERIFY_OUT']);OUT.mkdir(parents=True,exist_ok=False)
URL='https://scnplp5q8x3t.feishu.cn/sheets/RdEzsaU5NhFpKStfQ3xcGgHdnab';SID='ez1Kvd';origin='http://127.0.0.1:18947'
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
home=OUT/'isolated-home';home.mkdir();connector=OUT/'zhigao-connector.mjs';connector.write_text((ROOT/'zhigao-connector.mjs').read_text(encoding='utf-8').replace('os.homedir()',json.dumps(str(home))),encoding='utf-8')
env=dict(os.environ,ZHIGAO_PORT=str(port),ZHIGAO_ORIGINS=origin,ZHIGAO_AUTO_UPDATE='0',ZHIGAO_REGISTER_URI='0')
log=(OUT/'connector.log').open('w',encoding='utf-8');process=None;checks=[]
def start():
 global process
 process=subprocess.Popen(['node',str(connector),'hub'],env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
 for i in range(100):
  try:
   with socket.create_connection(('127.0.0.1',port),timeout=.2):return
  except OSError:time.sleep(.1)
 raise RuntimeError('Private hub did not start')
def call(action,**kw):
 body={'url':URL,'sheetId':SID,**kw,'action':action};request=urllib.request.Request(f'http://127.0.0.1:{port}/page/feishu',json.dumps(body).encode(),{'Origin':origin,'Content-Type':'text/plain'})
 with urllib.request.urlopen(request,timeout=90) as r:data=json.load(r)
 assert data['ok'],data;return data['data']
def cells(v):return {c+str(r):block['cells'][i][j] for block in v['ranges'] for i,r in enumerate(block['row_indices']) for j,c in enumerate(block['col_indices'])}
try:
 start();before=call('gridRead',startRow=1,pageSize=40);assert before['sheetId']==SID
 body={'token':before['token'],'address':'A5','cell':{'value':'空行保留 · 连接器链路验收'},'operationId':str(uuid.uuid4())}
 result=call('gridWrite',**body);assert result['state']=='saved';after=call('gridRead',startRow=1,pageSize=40)
 a,b=cells(before),cells(after);assert [k for k in a if a[k]!=b[k]]==['A5'];assert b['A5']['rawValue']==body['cell']['value'];checks.append('隔离连接器内嵌模块经真实HTTP和CLI写回，40×8范围仅A5变化')
 process.terminate();process.wait(timeout=10);start();recovered=call('gridRecover',**body);assert recovered==result
 repeated=call('gridWrite',**body);assert repeated==result;final=call('gridRead',startRow=1,pageSize=40);assert final['revision']==after['revision'];checks.append('连接器重启后gridRecover和重复gridWrite返回既有结果，云表revision不再增加')
 for name,value in [('before',before),('after',after),('result',{'ok':True,'checks':checks,'write':result,'recovered':recovered})]:(OUT/(name+'.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'ok':True,'checks':checks},ensure_ascii=False))
except Exception:
 (OUT/'failure.json').write_text(json.dumps({'ok':False,'checks':checks,'traceback':traceback.format_exc()},ensure_ascii=False,indent=2),encoding='utf-8');raise
finally:
 if process:process.terminate();process.wait(timeout=10)
 log.close()

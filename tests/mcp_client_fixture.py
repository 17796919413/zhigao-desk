"""Actual stdio MCP client used only against the isolated test connector."""
import json,queue,threading,subprocess,os,time
class MCP:
 def __init__(self,script,env,log,page=None):
  self.page=page
  self.p=subprocess.Popen(['node',str(script)],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0);self.q=queue.Queue();self.n=0
  def read():
   for line in self.p.stdout:
    try:self.q.put(json.loads(line))
    except ValueError:pass
  threading.Thread(target=read,daemon=True).start()
  self.rpc('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'isolated-review-test','version':'1'}})
  self.p.stdin.write(json.dumps({'jsonrpc':'2.0','method':'notifications/initialized'})+'\n');self.p.stdin.flush()
 def rpc(self,method,params):
  self.n+=1;self.p.stdin.write(json.dumps({'jsonrpc':'2.0','id':self.n,'method':method,'params':params},ensure_ascii=False)+'\n');self.p.stdin.flush()
  started=time.monotonic()
  while True:
   try:value=self.q.get(timeout=.05)
   except queue.Empty:
    if time.monotonic()-started>90:raise TimeoutError('MCP fixture response timed out')
    if self.page:self.page.wait_for_timeout(50)
    continue
   if value.get('id')==self.n:
    if 'error' in value:raise RuntimeError(value['error'])
    return value['result']
 def call(self,name,args=None):return self.rpc('tools/call',{'name':name,'arguments':args or {}})
 def close(self):self.p.terminate();self.p.wait(timeout=15)

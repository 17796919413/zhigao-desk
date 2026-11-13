export const WEB_VERSION='1.14.1';
const HUB='http://127.0.0.1:47821';
export function newer(a,b){
  if(!/^\d+\.\d+\.\d+$/.test(a||'')||!/^\d+\.\d+\.\d+$/.test(b||''))return false;
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;
}
export async function localUpdate(action='status') {
  let r;
  try{r=await fetch(HUB+'/page/update',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(action==='apply'?45000:20000)});}
  catch{throw Object.assign(Error('未检测到本机连接器'),{code:'offline'});}
  if(r.status===404){
    if(action==='check'||action==='status'){
      try{const h=await(await fetch(HUB+'/health',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(3000)})).json();if(h.app==='zhigao'&&/^\d+\.\d+\.\d+$/.test(h.version))return {state:'legacy',runningVersion:h.version,installedVersion:null};}catch{}
    }
    throw Object.assign(Error('旧版连接器尚不支持网页更新'),{code:'legacy'});
  }
  if(r.status===403)throw Object.assign(Error('当前网址未获本机连接器允许'),{code:'origin'});
  const p=await r.json();if(!r.ok||!p.ok)throw Object.assign(Error('本机检查暂未完成'),{code:'error'});return p.data;
}
export async function checkUpdates() {
  const results=await Promise.allSettled([
    fetch('./setup-manifest.json?updates='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)}).then(async r=>{if(!r.ok)throw Error();const m=await r.json();if(m.name!=='zhigao'||!/^\d+\.\d+\.\d+$/.test(m.version))throw Error();return m;}),
    localUpdate('check')
  ]);
  const [remote,local]=results;
  const manifest=remote.status==='fulfilled'?remote.value:null;
  const status=local.status==='fulfilled'?local.value:{state:local.reason.code||'error'};
  const state=manifest&&['current','available'].includes(status.state)&&newer(manifest.version,status.installedVersion)?'available':status.state;
  return {...status,latestVersion:manifest?.version||status.latestVersion||null,remoteChecked:!!manifest,webVersion:WEB_VERSION,
    webUpdate:!!manifest&&newer(manifest.version,WEB_VERSION),
    state:!manifest&&local.status==='fulfilled'?'network_error':state};
}

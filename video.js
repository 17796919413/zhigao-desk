// 视频只读审核的工具函数：读取元数据、时间码换算、按时间截取画面。不剪辑、不改动原视频。
export const VIDEO_EXT=/\.(mp4|mov|m4v|webm)$/i;
export const VIDEO_MAX=2*1024*1024*1024;
// 按 0.1 秒取整后再拆分，避免出现 00:60.0 这样的进位错误。
export function fmtTime(sec){const d=Math.round(Math.max(0,Number(sec)||0)*10),h=Math.floor(d/36000),m=Math.floor(d%36000/600),s=((d%600)/10).toFixed(1).padStart(4,'0');return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${String(m).padStart(2,'0')}:${s}`;}
// 接受 83、1:23、1:23.5、1:02:03；格式不对返回 NaN。
export function parseTime(v){const s=String(v??'').trim().replace(/：/g,':');if(!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s))return NaN;return s.split(':').map(Number).reduce((a,b)=>a*60+b,0);}
// 只有读到画面尺寸才算能播放；HEVC 等浏览器不支持的编码常常只有声音、没有画面。
export function probeVideo(file){return new Promise(resolve=>{const v=document.createElement('video'),url=URL.createObjectURL(file);let done=false;const fin=r=>{if(done)return;done=true;clearTimeout(timer);v.removeAttribute('src');v.load();URL.revokeObjectURL(url);resolve(r);},fail={playable:false,duration:0,width:0,height:0},timer=setTimeout(()=>fin(fail),10000);v.preload='metadata';v.muted=true;v.onloadedmetadata=()=>fin({playable:v.videoWidth>0,duration:Number.isFinite(v.duration)?v.duration:0,width:v.videoWidth,height:v.videoHeight});v.onerror=()=>fin(fail);v.src=url;});}
export function frameOf(v,width=320){if(!v||v.readyState<2||!v.videoWidth)return null;try{const c=document.createElement('canvas');c.width=width;c.height=Math.round(width*v.videoHeight/v.videoWidth);c.getContext('2d').drawImage(v,0,0,c.width,c.height);return c.toDataURL('image/jpeg',0.72);}catch{return null;}}
export function seekTo(v,sec){return new Promise(resolve=>{if(!v||v.readyState<1)return resolve(false);const target=Math.min(Math.max(0,sec),Math.max(0,(v.duration||sec)-0.05));if(Math.abs(v.currentTime-target)<0.04&&v.readyState>=2)return resolve(true);const done=ok=>{v.removeEventListener('seeked',on);clearTimeout(timer);resolve(ok);},on=()=>done(true),timer=setTimeout(()=>done(false),4000);v.addEventListener('seeked',on);v.currentTime=target;});}

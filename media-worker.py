"""Local-only full-media preparation. No cloud models, credentials, or business uploads."""
import argparse, hashlib, importlib.util, importlib.metadata, json, os, shutil, subprocess, sys, time, uuid, wave
from contextlib import contextmanager
from pathlib import Path
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN']='1'
if hasattr(sys.stdout,'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
MODELS=['large-v3-turbo','large-v3','medium','small','tiny']
PROCESSING_VERSION='full-media-v2-channel-audio'
AUDIO_CHUNK_SECONDS=45
AUDIO_CHUNK_MAX_BYTES=6*1024*1024
class WorkerBusyError(RuntimeError):pass
def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def put(path,data):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
 try:
  with tmp.open('w',encoding='utf-8') as f:json.dump(data,f,ensure_ascii=False,allow_nan=False);f.flush();os.fsync(f.fileno())
  os.replace(tmp,path)
 finally:
  if tmp.exists():tmp.unlink()
def read_json(path):
 try:
  value=json.loads(Path(path).read_text(encoding='utf-8'))
  return value if isinstance(value,dict) else None
 except (OSError,ValueError):return None
@contextmanager
def processing_lock(out):
 """OS locks release on a crash; a stale lock file never means a live owner."""
 path=Path(out)/'worker.lock';f=path.open('a+b');locked=False
 try:
  f.seek(0)
  try:
   if os.name=='nt':
    import msvcrt
    msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
   else:
    import fcntl
    fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
   locked=True
  except OSError as e:raise WorkerBusyError('另一个进程正在准备同一视频；请等待，不覆盖其进度。') from e
  yield
 finally:
  if locked:
   f.seek(0)
   if os.name=='nt':msvcrt.locking(f.fileno(),msvcrt.LK_UNLCK,1)
   else:fcntl.flock(f.fileno(),fcntl.LOCK_UN)
  f.close()
def processing_identity(source_hash,model_path,model_name):
 model_dir=Path(model_path).resolve() if model_path else None
 files=[{'file':p.relative_to(model_dir).as_posix(),'sha256':sha(p)} for p in sorted(model_dir.rglob('*')) if p.is_file()] if model_dir and model_dir.is_dir() else []
 model={'name':model_name,'path':str(model_dir) if model_dir else None,'files':files}
 model_id=hashlib.sha256(json.dumps(model,sort_keys=True).encode()).hexdigest()
 deps={}
 for name in ['faster-whisper','ctranslate2','rapidocr-onnxruntime','onnxruntime','av','Pillow']:
  try:deps[name]=importlib.metadata.version(name)
  except importlib.metadata.PackageNotFoundError:deps[name]=None
 processing={'version':PROCESSING_VERSION,'workerHash':sha(__file__),'modelIdentity':model_id,'dependencies':deps,'audio':{'channels':'separate','sampleRate':'source','beamSize':5,'wordTimestamps':True,'vadFilter':False,'conditionOnPreviousText':False,'chunkSeconds':AUDIO_CHUNK_SECONDS,'chunkMaxBytes':AUDIO_CHUNK_MAX_BYTES}}
 fingerprint=hashlib.sha256(json.dumps({'sourceHash':source_hash,**processing},sort_keys=True).encode()).hexdigest()
 return {'processingVersion':PROCESSING_VERSION,'processingFingerprint':fingerprint,'workerHash':processing['workerHash'],'modelIdentity':model_id,'processing':processing}
def valid_file(out,name,digest):
 try:
  p=(Path(out)/name).resolve();p.relative_to(Path(out).resolve())
  return p.is_file() and sha(p)==digest
 except (OSError,ValueError,TypeError):return False
def valid_decoded(value,out):
 try:
  frames=value['frames'];assets=value['assets'];ids={a['id'] for a in assets}
  return bool(frames and assets) and value['decodedFrames']==len(frames) and all(f['index']==i and f['assetId'] in ids and isinstance(f['time'],(int,float)) for i,f in enumerate(frames)) and all(isinstance(a['frameIndexes'],list) and a['frameIndexes'] and all(frames[i]['assetId']==a['id'] for i in a['frameIndexes']) and valid_file(out,a['file'],a['sha256']) for a in assets)
 except (KeyError,IndexError,TypeError,ValueError):return False
def valid_transcript(value,out):
 try:
  return value['processedEntireAudio'] is True and isinstance(value['segments'],list) and value['duration']>0 and all(k in value for k in ['track','streamIndex','channel','channelLabel','startTime']) and valid_file(out,value['audioFile'],value['audioSha256']) and all(all(k in s for k in ['id','start','end','text','avgLogprob','noSpeechProbability','words','lowConfidence']) and isinstance(s['words'],list) for s in value['segments'])
 except (KeyError,TypeError,ValueError):return False
def listening_assets(out,track_result):
 """Every channel is heard in contiguous chunks, including ASR omissions/silence."""
 assets=[];out=Path(out);folder=out/'audio';folder.mkdir(exist_ok=True)
 with wave.open(str(out/track_result['audioFile']),'rb') as reader:
  rate=reader.getframerate();width=reader.getsampwidth();channels=reader.getnchannels();total=reader.getnframes()
  chunk_frames=min(AUDIO_CHUNK_SECONDS*rate,(AUDIO_CHUNK_MAX_BYTES-128)//(width*channels));offset=0
  while offset<total:
   count=min(chunk_frames,total-offset);data=reader.readframes(count)
   if len(data)!=count*width*channels:raise RuntimeError('原声音频分段不完整，不能计作全部听审素材。')
   start=track_result['startTime']+offset/rate;end=track_result['startTime']+(offset+count)/rate
   rows=[s for s in track_result['segments'] if s['end']>start and s['start']<end]
   reasons=['full-channel-listening-required']
   if any(s.get('lowConfidence') for s in rows):reasons.append('low-confidence-transcript')
   if not rows:reasons.append('no-transcript-in-interval')
   tmp=folder/(uuid.uuid4().hex+'.tmp')
   try:
    with wave.open(str(tmp),'wb') as writer:
     writer.setnchannels(channels);writer.setsampwidth(width);writer.setframerate(rate);writer.writeframes(data)
    digest=sha(tmp);file=folder/(digest+'.wav');os.replace(tmp,file)
   finally:
    if tmp.exists():tmp.unlink()
   track=track_result['track'];channel=track_result['channel'];asset_id=f'audio:{track}:{channel}:{offset}:{offset+count}:{digest}'
   assets.append({'id':asset_id,'type':'prepared-video-audio','file':'audio/'+file.name,'sha256':digest,'mimeType':'audio/wav','track':track,'streamIndex':track_result['streamIndex'],'channel':channel,'channelLabel':track_result['channelLabel'],'start':start,'end':end,'duration':count/rate,'sampleRate':rate,'sampleStart':offset,'sampleEnd':offset+count,'location':f'原声音轨{track+1} · 声道{channel+1}（{track_result["channelLabel"]}） · {start:.3f}–{end:.3f}秒','required':True,'readable':True,'coverage':'full','reviewReasons':reasons,'segmentIds':[s['id'] for s in rows]})
   offset+=count
 return assets
def ffmpeg():
 value=shutil.which('ffmpeg')
 if value:return value
 if importlib.util.find_spec('imageio_ffmpeg'):
  import imageio_ffmpeg
  return imageio_ffmpeg.get_ffmpeg_exe()
 return None
def cached_model(name):
 try:
  from faster_whisper.utils import download_model
  return download_model(name,local_files_only=True)
 except Exception:return None
def doctor(model=None):
 deps={n:bool(importlib.util.find_spec(n)) for n in ['faster_whisper','rapidocr_onnxruntime','av','PIL']}
 chosen=None;model_path=None
 if deps['faster_whisper']:
  for name in ([model] if model else MODELS):
   model_path=cached_model(name)
   if model_path:chosen=name;break
 exe=ffmpeg()
 return {'ready':all(deps.values()) and bool(exe) and bool(model_path),'processingVersion':PROCESSING_VERSION,'workerHash':sha(__file__),'dependencies':deps,'ffmpeg':exe,'model':chosen,'modelPath':model_path,'python':sys.executable,'missing':[n for n,v in deps.items() if not v]+([] if exe else ['ffmpeg'])+([] if model_path else ['speech-model'])}
def download(model,cache):
 from faster_whisper.utils import download_model
 current=cached_model(model)
 return current or download_model(model,output_dir=str(Path(cache)/model))
def process(input_path,out_dir,model_path,model_name):
 out=Path(out_dir).resolve();out.mkdir(parents=True,exist_ok=True)
 with processing_lock(out):
  put(out/'progress.json',{'state':'running','stage':'fingerprint','pid':os.getpid()})
  try:return process_locked(input_path,out,model_path,model_name)
  except Exception as e:
   put(out/'progress.json',{'state':'failed','error':str(e),'stage':'failed'});raise
def process_locked(input_path,out_dir,model_path,model_name):
 import av
 import numpy as np
 from rapidocr_onnxruntime import RapidOCR
 from faster_whisper import WhisperModel
 src=Path(input_path).resolve();out=Path(out_dir).resolve();out.mkdir(parents=True,exist_ok=True)
 started=time.time();source_hash=sha(src);identity=processing_identity(source_hash,model_path,model_name)
 def progress(stage,**kw):put(out/'progress.json',{'state':'running','stage':stage,'pid':os.getpid(),'sourceHash':source_hash,'processingFingerprint':identity['processingFingerprint'],'elapsed':round(time.time()-started,1),**kw})
 def checkpoint(name,fn,validator):
  p=out/name
  value=read_json(p)
  if value and value.get('sourceHash')==source_hash and value.get('processingFingerprint')==identity['processingFingerprint'] and validator(value,out):return value
  value=fn();value.update({'sourceHash':source_hash,**identity});put(p,value);return value
 progress('probe')
 with av.open(str(src)) as c:
  videos=list(c.streams.video);audios=list(c.streams.audio)
  if len(videos)!=1:raise RuntimeError('必须有且仅有一条可识别的视频画面轨；多画面轨请分别导入。')
  v=videos[0];expected=v.frames or None;advertised=float(c.duration/av.time_base) if c.duration else None
  audio_meta=[{'index':a.index,'channels':a.codec_context.channels,'channelLabels':[x.name for x in a.codec_context.layout.channels],'sampleRate':a.codec_context.sample_rate,'startTime':float(a.start_time*a.time_base) if a.start_time is not None else 0.,'duration':float(a.duration*a.time_base) if a.duration is not None else None} for a in audios]
  if any(not a['channels'] or len(a['channelLabels'])!=a['channels'] for a in audio_meta):raise RuntimeError('音轨声道信息不完整，不能静默混音。')
  if expected and expected>100000:raise RuntimeError('视频超过本地单次处理的10万帧上限，请按时间连续拆分；本稿未审完。')
 def decode():
  frames=[];unique={};previous=-1.;images=out/'frames';images.mkdir(exist_ok=True)
  with av.open(str(src)) as c:
   stream=c.streams.video[0]
   for i,frame in enumerate(c.decode(stream)):
    if i>=100000:raise RuntimeError('超过帧数上限；不能计作全片完成。')
    if frame.pts is None:raise RuntimeError('视频帧缺少时间戳，不能验证全时间轴覆盖。')
    at=float(frame.pts*frame.time_base)
    if at<previous:raise RuntimeError('视频时间戳倒序，无法验证覆盖。')
    previous=at;rgb=frame.to_ndarray(format='rgb24');key=hashlib.sha256(rgb.tobytes()).hexdigest();asset='frame:'+key
    if key not in unique:
     file=images/(key+'.png');tmp=images/(uuid.uuid4().hex+'.tmp');frame.to_image().save(tmp,format='PNG');os.replace(tmp,file)
     unique[key]={'id':asset,'file':'frames/'+file.name,'sha256':sha(file),'width':frame.width,'height':frame.height,'firstTime':at,'frameIndexes':[]}
    unique[key]['frameIndexes'].append(i);frames.append({'index':i,'time':at,'assetId':asset})
    if i%30==0:progress('decode',decodedFrames=i+1,expectedFrames=expected,uniqueFrames=len(unique))
  if not frames:raise RuntimeError('没有解码出画面。')
  if expected and expected!=len(frames):raise RuntimeError(f'帧数不完整：应有{expected}，实际{len(frames)}。')
  return {'frames':frames,'assets':list(unique.values()),'decodedFrames':len(frames),'advertisedDuration':advertised,'audioTracks':audio_meta}
 decoded=checkpoint('decoded.json',decode,valid_decoded);ocr=RapidOCR(intra_op_num_threads=min(2,os.cpu_count() or 1),inter_op_num_threads=1);observations=[];blocks=[]
 for i,a in enumerate(decoded['assets']):
  path=out/a['file'];cache=out/'ocr'/(a['sha256']+'.json')
  if not path.exists() or sha(path)!=a['sha256']:raise RuntimeError('已解码画面文件缺失或被改变，请重新准备。')
  entry=read_json(cache)
  if not entry or entry.get('processingFingerprint')!=identity['processingFingerprint'] or entry.get('assetId')!=a['id'] or not isinstance(entry.get('lines'),list) or not all(isinstance(line,dict) and all(k in line for k in ['box','text','confidence']) for line in entry['lines']):
   lines,elapsed=ocr(str(path));entry={'assetId':a['id'],'processingFingerprint':identity['processingFingerprint'],'lines':[{'box':box,'text':text,'confidence':float(confidence)} for box,text,confidence in (lines or [])]};put(cache,entry)
  observations.append(entry)
  if entry['lines']:
   text='\n'.join(x['text'] for x in entry['lines']);blocks.append({'id':'ocr:'+a['id'],'address':f"画面文字 · 首次出现 {a['firstTime']:.3f} 秒",'original':text,'current':text,'note':'视频画面只读；请将修改意见写明时间点，不直接改写OCR记录。','assetId':a['id']})
  progress('ocr',processedFrames=i+1,totalUniqueFrames=len(decoded['assets']),decodedFrames=decoded['decodedFrames'])
 speech=[];warnings=[];audio_assets=[]
 if audio_meta:
  if not Path(model_path).is_dir():raise RuntimeError('转写模型不存在。')
  model=None
  for n,track in enumerate(audio_meta):
   for channel in range(track['channels']):
    def transcribe():
     nonlocal model
     wav=out/f'audio-{n}-{channel}.wav';tmp=out/f'audio-{n}-{channel}.{uuid.uuid4().hex}.tmp.wav'
     command=[ffmpeg(),'-hide_banner','-loglevel','error','-nostdin','-y','-i',str(src),'-map',f'0:{track["index"]}','-vn','-af',f'pan=mono|c0=c{channel}','-c:a','pcm_s16le',str(tmp)]
     try:
      result=subprocess.run(command,capture_output=True,timeout=1800)
      if result.returncode:raise RuntimeError('FFmpeg音轨声道提取失败：'+result.stderr.decode('utf-8','replace')[-1000:])
      with wave.open(str(tmp),'rb') as w:
       duration=w.getnframes()/w.getframerate()
       if w.getnchannels()!=1 or not duration:raise RuntimeError('提取声道为空或不是独立单声道。')
      if track['duration'] and abs(duration-track['duration'])>1:raise RuntimeError('提取音轨时长与源文件不符。')
      os.replace(tmp,wav)
     finally:
      if tmp.exists():tmp.unlink()
     if model is None:model=WhisperModel(model_path,device='cpu',compute_type='int8',cpu_threads=min(8,max(2,(os.cpu_count() or 4)//2)),local_files_only=True)
     segments,info=model.transcribe(str(wav),beam_size=5,word_timestamps=True,vad_filter=False,condition_on_previous_text=False)
     rows=[];offset=track['startTime']
     for seg in segments:
      words=[{'start':w.start+offset,'end':w.end+offset,'word':w.word,'probability':w.probability} for w in (seg.words or [])]
      low=seg.avg_logprob<-0.8 or seg.no_speech_prob>0.6 or any(w['probability']<0.5 for w in words)
      rows.append({'id':f'asr:{n}:{channel}:{len(rows)}','start':seg.start+offset,'end':seg.end+offset,'text':seg.text,'avgLogprob':seg.avg_logprob,'noSpeechProbability':seg.no_speech_prob,'words':words,'lowConfidence':low})
      progress('transcribe',audioTrack=n+1,audioChannel=channel+1,totalAudioTracks=len(audio_meta),totalAudioChannels=sum(a['channels'] for a in audio_meta),transcribedUntil=seg.end+offset,audioDuration=duration)
     if abs(info.duration-duration)>0.5:raise RuntimeError('转写读取时长不足，不能计作全音轨完成。')
     return {'track':n,'streamIndex':track['index'],'channel':channel,'channelLabel':track['channelLabels'][channel],'startTime':offset,'duration':duration,'language':info.language,'segments':rows,'processedEntireAudio':True,'model':model_name,'audioFile':wav.name,'audioSha256':sha(wav)}
    track_result=checkpoint(f'transcript-{n}-{channel}.json',transcribe,valid_transcript);speech.append(track_result)
    audio_assets.extend(listening_assets(out,track_result))
    if not any(s['text'].strip() for s in track_result['segments']):warnings.append(f'音轨{n+1} 声道{channel+1}没有转写文字，仍须完整听审原声；不能据此判定没有口播。')
    for s in track_result['segments']:
     text=s['text'].strip()
     if text:blocks.append({'id':s['id'],'address':f"音轨{n+1} · 声道{channel+1}（{track_result['channelLabel']}） · {s['start']:.3f}–{s['end']:.3f}秒",'original':text,'current':text,'note':'独立声道完整转写；必须读取并听审关联原声音频，品牌名、数字、否定词及低置信词须核对，修改意见注明时间点。','audioAssetIds':[a['id'] for a in audio_assets if s['id'] in a['segmentIds']]})
     if s['lowConfidence']:warnings.append(f"音轨{n+1} 声道{channel+1} {s['start']:.2f}–{s['end']:.2f}秒含低置信转写；关联原声音频为必听审项。")
  del model
 assets=[{**a,'type':'prepared-video-frame','location':f"视频画面 · 首次{a['firstTime']:.3f}秒 · 对应{len(a['frameIndexes'])}个逐帧解码位置",'readable':True,'coverage':'full','mimeType':'image/png','required':True} for a in decoded['assets']]
 if sha(src)!=source_hash:raise RuntimeError('视频原件在处理过程中改变，报告无效；请重新准备。')
 report={'version':'1.9.0','state':'complete','sourceHash':source_hash,**identity,'decodedFrames':decoded['decodedFrames'],'uniqueFrames':len(assets),'frames':decoded['frames'],'assets':assets+audio_assets,'audioAssets':len(audio_assets),'audioTracks':audio_meta,'ocr':observations,'transcripts':speech,'supplementalText':blocks,'warnings':warnings,'blockers':[],
  'coverage':{'frameDecoding':'all','deduplication':'identical-decoded-RGB-only','ocr':'every-unique-frame','audio':'all-audio-streams-all-channels-no-vad-trimming','audioListening':'every-channel-contiguous-chunks','semanticReview':'pending-agent-review'},'model':model_name,'elapsed':round(time.time()-started,1)}
 put(out/'report.json',report);put(out/'progress.json',{'state':'complete','stage':'prepared','decodedFrames':report['decodedFrames'],'uniqueFrames':len(assets),'audioTracks':len(audio_meta),'audioChannels':len(speech),'audioAssets':len(audio_assets),'reportHash':sha(out/'report.json'),'sourceHash':source_hash,'processingFingerprint':identity['processingFingerprint'],'elapsed':report['elapsed']});return report
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=['doctor','download','process']);p.add_argument('--model',choices=MODELS);p.add_argument('--model-path');p.add_argument('--cache');p.add_argument('--input');p.add_argument('--out');args=p.parse_args()
 if args.command=='doctor':print(json.dumps(doctor(args.model),ensure_ascii=False));return
 if args.command=='download':print(json.dumps({'model':args.model or 'large-v3-turbo','modelPath':download(args.model or 'large-v3-turbo',args.cache)}));return
 try:report=process(args.input,args.out,args.model_path,args.model);print(json.dumps({'ok':True,'decodedFrames':report['decodedFrames'],'uniqueFrames':report['uniqueFrames']}))
 except Exception as e:
  print(json.dumps({'ok':False,'error':str(e)},ensure_ascii=False));sys.exit(1)
if __name__=='__main__':main()

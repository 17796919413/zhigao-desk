"""Synthetic 95-second dynamic video. Full processing, no sparse frame substitute."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--python',required=True)
    p.add_argument('--ffmpeg',required=True)
    p.add_argument('--model-path',required=True)
    p.add_argument('--out',required=True)
    args=p.parse_args()
    out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    fixture=out/'dynamic-95s.mp4'
    if not fixture.exists():
        subprocess.run([args.ffmpeg,'-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','testsrc2=size=320x180:rate=2:duration=95','-f','lavfi','-i','anullsrc=r=16000:cl=mono:d=95','-map','0:v','-map','1:a','-c:v','libx264','-crf','28','-c:a','aac','-shortest',str(fixture)],check=True,timeout=60)
    started=time.monotonic()
    r=subprocess.run([args.python,'-X','utf8',str(ROOT/'media-worker.py'),'process','--input',str(fixture),'--out',str(out/'processed'),'--model','large-v3-turbo','--model-path',args.model_path],env={**os.environ,'PYTHONUTF8':'1','HF_HUB_DISABLE_IMPLICIT_TOKEN':'1'},capture_output=True,text=True,encoding='utf-8',timeout=600)
    (out/'worker.log').write_text(r.stdout+'\n'+r.stderr,encoding='utf-8')
    if r.returncode:raise RuntimeError(r.stdout[-2000:]+r.stderr[-2000:])
    report_file=out/'processed'/'report.json';report=json.loads(report_file.read_text(encoding='utf-8'))
    assert report['decodedFrames']==190
    assert len(report['frames'])==190
    assert report['uniqueFrames']==190
    assert len(report['ocr'])==190
    assert report['frames'][-1]['time']>=94.5
    audio=[a for a in report['assets'] if a['type']=='prepared-video-audio']
    assert len(audio)>=3
    assert all(a['required'] and a['duration']<=45 for a in audio)
    assert audio[0]['sampleStart']==0
    assert all(a['sampleEnd']==b['sampleStart'] for a,b in zip(audio,audio[1:]))
    assert audio[-1]['end']>=95
    assert report['transcripts'][0]['processedEntireAudio']
    assert report['transcripts'][0]['duration']>=95
    result={'synthetic':True,'decodedFrames':190,'uniqueFrames':190,'ocrFrames':190,'audioChunks':len(audio),'audioDuration':report['transcripts'][0]['duration'],'reportBytes':report_file.stat().st_size,'wallSeconds':round(time.monotonic()-started,2),'reportSha256':hashlib.sha256(report_file.read_bytes()).hexdigest(),'limit':'95秒/2fps合成动态片；不能外推真实长片耗时或语言识别准确率。'}
    (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()

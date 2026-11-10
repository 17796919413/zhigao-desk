"""Isolated synthetic media checks; no downloads, cloud calls, or business data.

Run with the private media Python. --real-model additionally exercises cached
large-v3-turbo and RapidOCR on locally synthesized speech; it never downloads.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '_verify' / 'assurance-closeout-20261110' / 'worker'
SPEC = importlib.util.spec_from_file_location('media_worker', ROOT / 'media-worker.py')
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def run(command):
    result = subprocess.run(command, capture_output=True, timeout=180)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', 'replace')[-2000:])
    return result


def write_wav(path, values, rate=16000):
    values = np.asarray(values, dtype='<i2')
    with wave.open(str(path), 'wb') as f:
        f.setnchannels(1 if values.ndim == 1 else values.shape[1])
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(values.tobytes())


def wav_pcm(path):
    with wave.open(str(path), 'rb') as f:
        return f.getparams(), f.readframes(f.getnframes())


def fixture(folder):
    folder.mkdir(parents=True, exist_ok=True)
    t = np.arange(32000) / 16000
    left = np.round(10000 * np.sin(2 * np.pi * 440 * t)).astype('<i2')
    right = -left
    other = np.round(8000 * np.sin(2 * np.pi * 880 * t)).astype('<i2')
    write_wav(folder / 'stereo.wav', np.column_stack([left, right]))
    write_wav(folder / 'other.wav', other)
    source = folder / 'opposite-channels-and-two-tracks.mkv'
    run([worker.ffmpeg(), '-hide_banner', '-loglevel', 'error', '-y',
         '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=24:d=2',
         '-i', str(folder / 'stereo.wav'), '-i', str(folder / 'other.wav'),
         '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='eq(n,17)',drawbox=x=0:y=0:w=iw:h=ih:color=green:t=fill:enable='eq(n,47)'",
         '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'ffv1',
         '-c:a', 'pcm_s16le', '-shortest', str(source)])
    model = folder / 'fake-model'
    model.mkdir(exist_ok=True)
    (model / 'model.bin').write_bytes(b'synthetic model fixture v1')
    return source, model, [left, right, other]


class FakeOCR:
    calls = []

    def __init__(self, **kwargs):
        assert 1 <= kwargs["intra_op_num_threads"] <= 2
        assert kwargs["inter_op_num_threads"] == 1

    def __call__(self, path):
        self.calls.append(path)
        return [], 0


class FakeWhisper:
    calls = []
    fail_channel = None

    def __init__(self, *args, **kwargs):
        pass

    def transcribe(self, filename, **kwargs):
        name = Path(filename).name
        self.calls.append(name)
        if self.fail_channel == name:
            raise RuntimeError('synthetic interruption')
        assert kwargs['vad_filter'] is False
        assert kwargs['word_timestamps'] is True
        with wave.open(filename, 'rb') as f:
            duration = f.getnframes() / f.getframerate()
        info = SimpleNamespace(duration=duration, language='zh')
        if name == 'audio-1-0.wav':
            return iter([]), info
        low = name == 'audio-0-0.wav'
        text = '左声道尾部' if low else '右声道尾部'
        segment = SimpleNamespace(start=max(0, duration - .25), end=duration,
                                  text=text, avg_logprob=-1.1 if low else -.1,
                                  no_speech_prob=.01,
                                  words=[SimpleNamespace(start=duration-.25,
                                                         end=duration,
                                                         word=text,
                                                         probability=.3 if low else .95)])
        return iter([segment]), info


class WorkerBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        OUT.mkdir(parents=True, exist_ok=True)
        cls.run_dir = OUT / ('boundary-' + str(time.time_ns()))
        cls.source, cls.model, cls.signals = fixture(cls.run_dir)

    def setUp(self):
        FakeWhisper.calls = []
        FakeWhisper.fail_channel = None
        FakeOCR.calls = []
        self.job = self.run_dir / hashlib.sha256(self._testMethodName.encode()).hexdigest()[:12]
        self.job.mkdir()
        self.patches = [patch('faster_whisper.WhisperModel', FakeWhisper),
                        patch('rapidocr_onnxruntime.RapidOCR', FakeOCR)]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def prepare(self, model_name='synthetic'):
        return worker.process(self.source, self.job, self.model, model_name)

    def test_channels_never_mix_and_all_frames_are_preserved(self):
        report = self.prepare()
        self.assertEqual(report['decodedFrames'], 48)
        self.assertEqual(report['uniqueFrames'], 3)
        frame = report['frames'][17]
        asset = next(a for a in report['assets'] if a['id'] == frame['assetId'])
        self.assertEqual(asset['frameIndexes'], [17])
        self.assertEqual(len(report['audioTracks']), 2)
        self.assertEqual(len(report['transcripts']), 3)
        self.assertEqual(FakeWhisper.calls, ['audio-0-0.wav', 'audio-0-1.wav', 'audio-1-0.wav'])
        for result, expected in zip(report['transcripts'], self.signals):
            params, pcm = wav_pcm(self.job / result['audioFile'])
            self.assertEqual(params.nchannels, 1)
            np.testing.assert_array_equal(np.frombuffer(pcm, dtype='<i2'), expected)
            self.assertTrue(result['processedEntireAudio'])
        self.assertEqual(report['transcripts'][0]['segments'][0]['end'], 2.)
        self.assertEqual(report['transcripts'][1]['segments'][0]['text'], '右声道尾部')

    def test_low_confidence_and_empty_asr_have_required_original_audio(self):
        report = self.prepare()
        assets = [a for a in report['assets'] if a['type'] == 'prepared-video-audio']
        self.assertEqual(len(assets), 3)
        self.assertTrue(all(a['required'] and a['readable'] and a['coverage'] == 'full' for a in assets))
        self.assertIn('low-confidence-transcript', assets[0]['reviewReasons'])
        self.assertIn('no-transcript-in-interval', assets[2]['reviewReasons'])
        self.assertTrue(any('没有转写文字' in w for w in report['warnings']))
        for transcript, asset in zip(report['transcripts'], assets):
            self.assertEqual(wav_pcm(self.job / transcript['audioFile']), wav_pcm(self.job / asset['file']))
            self.assertEqual(worker.sha(self.job / asset['file']), asset['sha256'])
        blocks = [b for b in report['supplementalText'] if b['id'].startswith('asr:')]
        self.assertTrue(all(b['audioAssetIds'] for b in blocks))

    def test_chunk_boundaries_are_contiguous_and_byte_exact(self):
        rate = 192000
        values = np.arange(rate * 47 + 317, dtype=np.int32).astype('<i2')
        write_wav(self.job / 'long.wav', values, rate)
        transcript = {'audioFile': 'long.wav', 'track': 0, 'streamIndex': 1,
                      'channel': 0, 'channelLabel': 'FL', 'startTime': 3.25,
                      'segments': []}
        assets = worker.listening_assets(self.job, transcript)
        self.assertGreater(len(assets), 2)
        expected_start = 3.25
        chunks = []
        for asset in assets:
            self.assertEqual(asset['start'], expected_start)
            expected_start = asset['end']
            self.assertLessEqual(asset['duration'], 45)
            self.assertLessEqual((self.job / asset['file']).stat().st_size, worker.AUDIO_CHUNK_MAX_BYTES)
            chunks.append(wav_pcm(self.job / asset['file'])[1])
        self.assertEqual(b''.join(chunks), values.tobytes())
        self.assertAlmostEqual(assets[-1]['end'], 3.25 + len(values)/rate)

    def test_cache_reuses_only_same_model_content_and_processing_version(self):
        first = self.prepare()
        FakeWhisper.calls = []
        self.prepare()
        self.assertEqual(FakeWhisper.calls, [])
        second = self.prepare('different-model-name')
        self.assertEqual(len(FakeWhisper.calls), 3)
        self.assertNotEqual(first['processingFingerprint'], second['processingFingerprint'])
        FakeWhisper.calls = []
        with patch.object(worker, 'PROCESSING_VERSION', 'synthetic-new-worker-version'):
            third = self.prepare('different-model-name')
        self.assertEqual(len(FakeWhisper.calls), 3)
        self.assertNotEqual(second['processingFingerprint'], third['processingFingerprint'])
        model_file = self.model / 'model.bin'
        old = model_file.read_bytes()
        stamp = model_file.stat()
        try:
            model_file.write_bytes(old.replace(b'v1', b'v2'))
            os.utime(model_file, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
            changed = worker.processing_identity(worker.sha(self.source), self.model, 'synthetic')
            self.assertNotEqual(first['modelIdentity'], changed['modelIdentity'])
        finally:
            model_file.write_bytes(old)

    def test_partial_checkpoint_recovers_without_retranscribing_completed_channels(self):
        FakeWhisper.fail_channel = 'audio-0-1.wav'
        with self.assertRaisesRegex(RuntimeError, 'synthetic interruption'):
            self.prepare()
        self.assertTrue((self.job / 'transcript-0-0.json').is_file())
        self.assertFalse((self.job / 'report.json').exists())
        FakeWhisper.fail_channel = None
        FakeWhisper.calls = []
        report = self.prepare()
        self.assertEqual(FakeWhisper.calls, ['audio-0-1.wav', 'audio-1-0.wav'])
        self.assertEqual(len(report['transcripts']), 3)
        self.assertEqual(worker.read_json(self.job / 'progress.json')['state'], 'complete')

    def test_corrupt_checkpoint_and_missing_assets_are_repaired(self):
        report = self.prepare()
        (self.job / 'transcript-0-1.json').write_text('{', encoding='utf-8')
        FakeWhisper.calls = []
        self.prepare()
        self.assertEqual(FakeWhisper.calls, ['audio-0-1.wav'])
        (self.job / 'audio-0-0.wav').write_bytes(b'truncated')
        FakeWhisper.calls = []
        self.prepare()
        self.assertEqual(FakeWhisper.calls, ['audio-0-0.wav'])
        frame = next(a for a in report['assets'] if a['type'] == 'prepared-video-frame')
        (self.job / frame['file']).write_bytes(b'corrupt image')
        audio = next(a for a in report['assets'] if a['type'] == 'prepared-video-audio')
        (self.job / audio['file']).unlink()
        restored = self.prepare()
        self.assertEqual(restored['decodedFrames'], 48)
        self.assertEqual(worker.sha(self.job / frame['file']), frame['sha256'])
        self.assertEqual(worker.sha(self.job / audio['file']), audio['sha256'])

    def test_concurrent_worker_does_not_clobber_active_progress(self):
        sentinel = {'state': 'running', 'stage': 'sentinel', 'pid': os.getpid()}
        worker.put(self.job / 'progress.json', sentinel)
        with worker.processing_lock(self.job):
            result = subprocess.run([sys.executable, str(ROOT / 'media-worker.py'), 'process',
                                     '--input', str(self.source), '--out', str(self.job),
                                     '--model', 'tiny', '--model-path', str(self.model)],
                                    capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(worker.read_json(self.job / 'progress.json'), sentinel)

    def test_os_lock_is_released_after_killed_process(self):
        child = subprocess.Popen([sys.executable, str(Path(__file__)), '--hold-lock', str(self.job)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 10
            while not (self.job / 'lock-ready').exists() and time.monotonic() < deadline:
                time.sleep(.05)
            self.assertTrue((self.job / 'lock-ready').exists())
            with self.assertRaises(worker.WorkerBusyError):
                with worker.processing_lock(self.job):
                    pass
            child.kill()
            child.wait(timeout=5)
            with worker.processing_lock(self.job):
                pass
        finally:
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=5)


def real_model_smoke():
    """Actual SAPI speech + FFmpeg + Whisper + OCR; cached model only."""
    folder = OUT / ('real-' + str(time.time_ns()))
    folder.mkdir(parents=True)
    phrases = ['左边的包装是蓝色。结尾是冬季限定。', '右边的数量是三十五。结尾是请勿食用。', '第二音轨只作测试。结尾是保留原声。']
    files = []
    for i, phrase in enumerate(phrases):
        path = folder / f'speech-{i}.wav'
        qpath = str(path).replace("'", "''")
        script = ("$v=New-Object -ComObject SAPI.SpVoice;"
                  "$v.Voice=($v.GetVoices() | Where-Object {$_.GetDescription() -like '*Huihui*'} | Select-Object -First 1);"
                  "$s=New-Object -ComObject SAPI.SpFileStream;"
                  f"$s.Open('{qpath}',3);$v.AudioOutputStream=$s;"
                  f"[void]$v.Speak('{phrase}');$s.Close()")
        run(['powershell.exe', '-NoProfile', '-Command', script])
        files.append(path)
    source = folder / 'two-tracks-three-channels.mkv'
    run([worker.ffmpeg(), '-hide_banner', '-loglevel', 'error', '-y',
         '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=24:d=10',
         '-i', str(files[0]), '-i', str(files[1]), '-i', str(files[2]),
         '-filter_complex', '[1:a]apad=whole_dur=10[l];[2:a]apad=whole_dur=10[r];[l][r]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR[st];[3:a]apad=whole_dur=10[other]',
         '-map', '0:v', '-map', '[st]', '-map', '[other]', '-t', '10', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', str(source)])
    config = json.loads((Path.home() / '.zhigao' / 'media' / 'runtime.json').read_text(encoding='utf-8'))
    report = worker.process(source, folder / 'job', config['modelPath'], config['model'])
    assert len(report['transcripts']) == 3
    texts = [''.join(s['text'] for s in t['segments']) for t in report['transcripts']]
    tails = ['冬季限定', '请勿食用', '保留原声']
    exact_matches = [phrase in text for text, phrase in zip(texts, tails)]
    for text, marker in zip(texts, ['冬季限定', '请勿', '保留原声']):
        assert marker in text, (marker, text)
    assert report['decodedFrames'] == 240
    assert all(t['duration'] == 10. for t in report['transcripts'])
    audio_assets = [a for a in report['assets'] if a['type'] == 'prepared-video-audio']
    assert len(audio_assets) == 3
    assert all(a['required'] and a['start'] == 0. and a['end'] == 10. for a in audio_assets)
    for i, exact in enumerate(exact_matches):
        if not exact:
            # Recognition is probabilistic; any mismatch must stay audible and visible.
            assert 'low-confidence-transcript' in audio_assets[i]['reviewReasons']
            assert audio_assets[i]['required'] and audio_assets[i]['readable']
    evidence = {'passed': True, 'report': str(folder / 'job' / 'report.json'),
                'decodedFrames': report['decodedFrames'], 'transcripts': texts,
                'model': report['model'], 'elapsed': report['elapsed'],
                'expectedTails': tails, 'exactTailMatches': exact_matches,
                'limitation': 'Exact transcription is not guaranteed; original channel audio is mandatory, including detected low-confidence homophones.',
                'processingFingerprint': report['processingFingerprint']}
    worker.put(OUT / 'real-model-result.json', evidence)
    print(json.dumps(evidence, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--real-model', action='store_true')
    parser.add_argument('--hold-lock')
    args = parser.parse_args()
    if args.hold_lock:
        with worker.processing_lock(args.hold_lock):
            (Path(args.hold_lock) / 'lock-ready').write_text('ready')
            time.sleep(30)
        sys.exit(0)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(WorkerBoundaryTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    evidence = {'testsRun': result.testsRun, 'failures': len(result.failures),
                'errors': len(result.errors), 'passed': result.wasSuccessful(),
                'artifactDirectory': str(WorkerBoundaryTests.run_dir),
                'tests': [name for name in dir(WorkerBoundaryTests) if name.startswith('test_')]}
    worker.put(OUT / 'boundary-result.json', evidence)
    if not result.wasSuccessful():
        sys.exit(1)
    if args.real_model:
        real_model_smoke()

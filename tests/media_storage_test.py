"""Bounded atomic checkpoint persistence, using only standard-library fixtures."""
from pathlib import Path
import errno,importlib.util,json,tempfile,unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('worker_storage',Path(__file__).resolve().parents[1]/'media-worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

class StorageTests(unittest.TestCase):
 @unittest.skipUnless(worker.os.name=='nt','Windows atomic-replacement contention')
 def test_transient_replacement_preserves_old_until_success(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'progress.json';worker.put(p,{'step':'old'})
   real=worker.os.replace;calls=[]
   def replace(source,target):
    calls.append(1)
    if len(calls)<3:
     self.assertEqual(json.loads(p.read_text())['step'],'old')
     raise PermissionError(errno.EACCES,'synthetic sharing contention')
    return real(source,target)
   with patch.object(worker.os,'replace',replace),patch.object(worker.time,'sleep'):
    worker.put(p,{'step':'new'})
   self.assertEqual(len(calls),3);self.assertEqual(json.loads(p.read_text())['step'],'new');self.assertFalse(list(Path(tmp).glob('*.tmp')))

 def test_permanent_permission_failure_is_bounded_and_keeps_old(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'progress.json';worker.put(p,{'step':'old'})
   with patch.object(worker.os,'replace',side_effect=PermissionError(errno.EACCES,'synthetic permission denial')) as replace,patch.object(worker.time,'sleep'):
    with self.assertRaises(PermissionError):worker.put(p,{'step':'new'})
   self.assertEqual(replace.call_count,7 if worker.os.name=='nt' else 1)
   self.assertEqual(json.loads(p.read_text())['step'],'old')

 def test_disk_full_does_not_retry_or_destroy_checkpoint(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'progress.json';worker.put(p,{'step':'old'})
   with patch.object(worker.os,'replace',side_effect=OSError(errno.ENOSPC,'synthetic disk full')) as replace:
    with self.assertRaises(OSError):worker.put(p,{'step':'new'})
   self.assertEqual(replace.call_count,1);self.assertEqual(json.loads(p.read_text())['step'],'old')

if __name__=='__main__':unittest.main()

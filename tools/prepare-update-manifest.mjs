// Run before publishing. Hash exactly the LF bytes Git publishes, never a stale local checksum.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data=fs.readFileSync(path.join(root,'zhigao-connector.mjs'),'utf8').replaceAll('\r\n','\n');
const version=data.match(/const VERSION = '([^']+)'/)?.[1];
if(!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('Invalid connector version');
const file=path.join(root,'setup-manifest.json');
const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
manifest.version=version;
manifest.autoUpdate={protocol:1,sha256:crypto.createHash('sha256').update(data).digest('hex'),startup:true,intervalHours:6,retryMinutes:15,applyWhen:'idle',launcherScheme:'zhigao-desk'};
fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({version,sha256:manifest.autoUpdate.sha256}));

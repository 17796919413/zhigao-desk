// Private preparation adapters. Only fixed sources/commands are accepted; documents stay local.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const failure = (code, publicMessage) => Object.assign(Error(publicMessage || code), {code, publicMessage});
// Generated from tools/extract-office.ps1; shipped inside the standalone connector.
const OFFICE_EXTRACT_SCRIPT = 'IyBSZWFkIGEgdmVyaWZpZWQgTVNJIGFzIGEgZGF0YWJhc2UgYW5kIGV4dHJhY3QgaXRzIGZpbGVzLiBOZXZlciBleGVjdXRlIGluc3RhbGxlciBhY3Rpb25zLgpwYXJhbShbUGFyYW1ldGVyKE1hbmRhdG9yeT0kdHJ1ZSldW3N0cmluZ10kUGFja2FnZSxbUGFyYW1ldGVyKE1hbmRhdG9yeT0kdHJ1ZSldW3N0cmluZ10kRGVzdGluYXRpb24pCiRFcnJvckFjdGlvblByZWZlcmVuY2U9J1N0b3AnCkFkZC1UeXBlIC1UeXBlRGVmaW5pdGlvbiBAJwp1c2luZyBTeXN0ZW07CnVzaW5nIFN5c3RlbS5JTzsKdXNpbmcgU3lzdGVtLlRleHQ7CnVzaW5nIFN5c3RlbS5Db2xsZWN0aW9ucy5HZW5lcmljOwp1c2luZyBTeXN0ZW0uUnVudGltZS5JbnRlcm9wU2VydmljZXM7CnB1YmxpYyBzdGF0aWMgY2xhc3MgWmhpZ2FvTXNpIHsKIFtEbGxJbXBvcnQoIm1zaS5kbGwiLENoYXJTZXQ9Q2hhclNldC5Vbmljb2RlKV0gc3RhdGljIGV4dGVybiB1aW50IE1zaU9wZW5EYXRhYmFzZVcoc3RyaW5nIHBhdGgsSW50UHRyIG1vZGUsb3V0IHVpbnQgZGIpOwogW0RsbEltcG9ydCgibXNpLmRsbCIsQ2hhclNldD1DaGFyU2V0LlVuaWNvZGUpXSBzdGF0aWMgZXh0ZXJuIHVpbnQgTXNpRGF0YWJhc2VPcGVuVmlld1codWludCBkYixzdHJpbmcgcXVlcnksb3V0IHVpbnQgdmlldyk7CiBbRGxsSW1wb3J0KCJtc2kuZGxsIildIHN0YXRpYyBleHRlcm4gdWludCBNc2lWaWV3RXhlY3V0ZSh1aW50IHZpZXcsdWludCByZWNvcmQpOwogW0RsbEltcG9ydCgibXNpLmRsbCIpXSBzdGF0aWMgZXh0ZXJuIHVpbnQgTXNpVmlld0ZldGNoKHVpbnQgdmlldyxvdXQgdWludCByZWNvcmQpOwogW0RsbEltcG9ydCgibXNpLmRsbCIpXSBzdGF0aWMgZXh0ZXJuIHVpbnQgTXNpQ2xvc2VIYW5kbGUodWludCBoYW5kbGUpOwogW0RsbEltcG9ydCgibXNpLmRsbCIsQ2hhclNldD1DaGFyU2V0LlVuaWNvZGUpXSBzdGF0aWMgZXh0ZXJuIHVpbnQgTXNpUmVjb3JkR2V0U3RyaW5nVyh1aW50IHJlY29yZCx1aW50IGZpZWxkLFN0cmluZ0J1aWxkZXIgdmFsdWUscmVmIHVpbnQgc2l6ZSk7CiBbRGxsSW1wb3J0KCJtc2kuZGxsIildIHN0YXRpYyBleHRlcm4gdWludCBNc2lSZWNvcmRSZWFkU3RyZWFtKHVpbnQgcmVjb3JkLHVpbnQgZmllbGQsYnl0ZVtdIGJ1ZmZlcixyZWYgdWludCBzaXplKTsKIHN0YXRpYyB2b2lkIENoZWNrKHVpbnQgY29kZSl7aWYoY29kZSE9MCl0aHJvdyBuZXcgSU9FeGNlcHRpb24oIk1TSSByZWFkIGZhaWxlZDogIitjb2RlKTt9CiBzdGF0aWMgc3RyaW5nIFRleHQodWludCByZWNvcmQsdWludCBmaWVsZCl7dWludCBzaXplPTMyNzY4O3ZhciB2YWx1ZT1uZXcgU3RyaW5nQnVpbGRlcigoaW50KXNpemUpO0NoZWNrKE1zaVJlY29yZEdldFN0cmluZ1cocmVjb3JkLGZpZWxkLHZhbHVlLHJlZiBzaXplKSk7cmV0dXJuIHZhbHVlLlRvU3RyaW5nKCk7fQogcHVibGljIHN0YXRpYyB1aW50IE9wZW4oc3RyaW5nIHBhY2thZ2Upe3VpbnQgZGI7Q2hlY2soTXNpT3BlbkRhdGFiYXNlVyhwYWNrYWdlLEludFB0ci5aZXJvLG91dCBkYikpO3JldHVybiBkYjt9CiBwdWJsaWMgc3RhdGljIHZvaWQgQ2xvc2UodWludCBkYil7TXNpQ2xvc2VIYW5kbGUoZGIpO30KIHB1YmxpYyBzdGF0aWMgc3RyaW5nW11bXSBSb3dzKHVpbnQgZGIsc3RyaW5nIHF1ZXJ5LGludCBmaWVsZHMpewogIHVpbnQgdmlldztDaGVjayhNc2lEYXRhYmFzZU9wZW5WaWV3VyhkYixxdWVyeSxvdXQgdmlldykpO3ZhciByb3dzPW5ldyBMaXN0PHN0cmluZ1tdPigpOwogIHRyeXtDaGVjayhNc2lWaWV3RXhlY3V0ZSh2aWV3LDApKTt1aW50IHJlY29yZDt1aW50IGNvZGU7CiAgIHdoaWxlKChjb2RlPU1zaVZpZXdGZXRjaCh2aWV3LG91dCByZWNvcmQpKT09MCl7dHJ5e3ZhciByb3c9bmV3IHN0cmluZ1tmaWVsZHNdO2ZvcihpbnQgaT0wO2k8ZmllbGRzO2krKylyb3dbaV09VGV4dChyZWNvcmQsKHVpbnQpaSsxKTtyb3dzLkFkZChyb3cpO31maW5hbGx5e01zaUNsb3NlSGFuZGxlKHJlY29yZCk7fX0KICAgaWYoY29kZSE9MjU5KUNoZWNrKGNvZGUpO3JldHVybiByb3dzLlRvQXJyYXkoKTsKICB9ZmluYWxseXtNc2lDbG9zZUhhbmRsZSh2aWV3KTt9CiB9CiBwdWJsaWMgc3RhdGljIHZvaWQgU3RyZWFtKHVpbnQgZGIsc3RyaW5nIG5hbWUsc3RyaW5nIGZpbGUpewogIHVpbnQgdmlldztDaGVjayhNc2lEYXRhYmFzZU9wZW5WaWV3VyhkYiwiU0VMRUNUIGBEYXRhYCBGUk9NIGBfU3RyZWFtc2AgV0hFUkUgYE5hbWVgPSciK25hbWUuUmVwbGFjZSgiJyIsIicnIikrIiciLG91dCB2aWV3KSk7CiAgdHJ5e0NoZWNrKE1zaVZpZXdFeGVjdXRlKHZpZXcsMCkpO3VpbnQgcmVjb3JkO0NoZWNrKE1zaVZpZXdGZXRjaCh2aWV3LG91dCByZWNvcmQpKTt0cnl7CiAgIHVzaW5nKHZhciBvdXRwdXQ9bmV3IEZpbGVTdHJlYW0oZmlsZSxGaWxlTW9kZS5DcmVhdGVOZXcpKXtieXRlW10gYnVmZmVyPW5ldyBieXRlWzY1NTM2XTt3aGlsZSh0cnVlKXt1aW50IHNpemU9KHVpbnQpYnVmZmVyLkxlbmd0aDtDaGVjayhNc2lSZWNvcmRSZWFkU3RyZWFtKHJlY29yZCwxLGJ1ZmZlcixyZWYgc2l6ZSkpO2lmKHNpemU9PTApYnJlYWs7b3V0cHV0LldyaXRlKGJ1ZmZlciwwLChpbnQpc2l6ZSk7fX0KICB9ZmluYWxseXtNc2lDbG9zZUhhbmRsZShyZWNvcmQpO319ZmluYWxseXtNc2lDbG9zZUhhbmRsZSh2aWV3KTt9CiB9Cn0KJ0AKJGRlc3RSb290PVtJTy5QYXRoXTo6R2V0RnVsbFBhdGgoJERlc3RpbmF0aW9uKQppZihUZXN0LVBhdGggLUxpdGVyYWxQYXRoICRkZXN0Um9vdCl7dGhyb3cgJ0V4dHJhY3Rpb24gZGVzdGluYXRpb24gbXVzdCBiZSBuZXcuJ30KW0lPLkRpcmVjdG9yeV06OkNyZWF0ZURpcmVjdG9yeSgkZGVzdFJvb3QpIHwgT3V0LU51bGwKJGNhYlJvb3Q9Sm9pbi1QYXRoICRkZXN0Um9vdCAnX2NhYmluZXRzJwpbSU8uRGlyZWN0b3J5XTo6Q3JlYXRlRGlyZWN0b3J5KCRjYWJSb290KSB8IE91dC1OdWxsCiRkYj1bWmhpZ2FvTXNpXTo6T3BlbihbSU8uUGF0aF06OkdldEZ1bGxQYXRoKCRQYWNrYWdlKSkKdHJ5IHsKICRkaXJzPUB7fQogZm9yZWFjaCgkcm93IGluIFtaaGlnYW9Nc2ldOjpSb3dzKCRkYiwnU0VMRUNUIGBEaXJlY3RvcnlgLGBEaXJlY3RvcnlfUGFyZW50YCxgRGVmYXVsdERpcmAgRlJPTSBgRGlyZWN0b3J5YCcsMykpeyRkaXJzWyRyb3dbMF1dPUAoJHJvd1sxXSwkcm93WzJdKX0KICRjb21wb25lbnRzPUB7fQogZm9yZWFjaCgkcm93IGluIFtaaGlnYW9Nc2ldOjpSb3dzKCRkYiwnU0VMRUNUIGBDb21wb25lbnRgLGBEaXJlY3RvcnlfYCBGUk9NIGBDb21wb25lbnRgJywyKSl7JGNvbXBvbmVudHNbJHJvd1swXV09JHJvd1sxXX0KIGZ1bmN0aW9uIFJlc29sdmUtUHJpdmF0ZURpcmVjdG9yeShbc3RyaW5nXSRLZXkpewogICRzZWdtZW50cz1bQ29sbGVjdGlvbnMuR2VuZXJpYy5MaXN0W3N0cmluZ11dOjpuZXcoKTskdmlzaXRlZD1bQ29sbGVjdGlvbnMuR2VuZXJpYy5IYXNoU2V0W3N0cmluZ11dOjpuZXcoKQogIHdoaWxlKCRLZXkgLWFuZCAkS2V5IC1uZSAnVEFSR0VURElSJyl7CiAgIGlmKCEkdmlzaXRlZC5BZGQoJEtleSkgLW9yICEkZGlycy5Db250YWluc0tleSgkS2V5KSl7dGhyb3cgJ0ludmFsaWQgZGlyZWN0b3J5IHRyZWUnfQogICAkcj0kZGlyc1skS2V5XTskbmFtZT0oJHJbMV0uU3BsaXQoJzonKVswXS5TcGxpdCgnfCcpIHwgU2VsZWN0LU9iamVjdCAtTGFzdCAxKQogICBpZigkbmFtZSAtYW5kICRuYW1lIC1uZSAnLicgLWFuZCAkbmFtZSAtbmUgJ1NvdXJjZURpcicpeyRzZWdtZW50cy5JbnNlcnQoMCwkbmFtZSl9CiAgICRLZXk9JHJbMF0KICB9CiAgJHJlbGF0aXZlPVtzdHJpbmddOjpKb2luKFtJTy5QYXRoXTo6RGlyZWN0b3J5U2VwYXJhdG9yQ2hhciwkc2VnbWVudHMpCiAgJHJlc29sdmVkPVtJTy5QYXRoXTo6R2V0RnVsbFBhdGgoKEpvaW4tUGF0aCAkZGVzdFJvb3QgJHJlbGF0aXZlKSkKICBpZigkcmVzb2x2ZWQgLW5lICRkZXN0Um9vdCAtYW5kICEkcmVzb2x2ZWQuU3RhcnRzV2l0aCgkZGVzdFJvb3QrW0lPLlBhdGhdOjpEaXJlY3RvcnlTZXBhcmF0b3JDaGFyLFtTdHJpbmdDb21wYXJpc29uXTo6T3JkaW5hbElnbm9yZUNhc2UpKXt0aHJvdyAnRGlyZWN0b3J5IGVzY2FwZXMgcHJpdmF0ZSByb290J30KICByZXR1cm4gJHJlc29sdmVkCiB9CiAkaW5kZXg9MAogZm9yZWFjaCgkcm93IGluIFtaaGlnYW9Nc2ldOjpSb3dzKCRkYiwnU0VMRUNUIGBDYWJpbmV0YCBGUk9NIGBNZWRpYWAnLDEpKXsKICBpZighJHJvd1swXSl7Y29udGludWV9CiAgaWYoISRyb3dbMF0uU3RhcnRzV2l0aCgnIycpKXt0aHJvdyAnRXh0ZXJuYWwgY2FiaW5ldCBpcyB1bnN1cHBvcnRlZCd9CiAgJGNhYj1Kb2luLVBhdGggJGNhYlJvb3QgKCJkYXRhLSIrJGluZGV4KyIuY2FiIik7JGluZGV4KysKICBbWmhpZ2FvTXNpXTo6U3RyZWFtKCRkYiwkcm93WzBdLlN1YnN0cmluZygxKSwkY2FiKQogICYgIiRlbnY6U3lzdGVtUm9vdFxTeXN0ZW0zMlxleHBhbmQuZXhlIiAnLUY6KicgJGNhYiAkY2FiUm9vdCB8IE91dC1OdWxsCiAgaWYoJExBU1RFWElUQ09ERSAtbmUgMCl7dGhyb3cgJ0NhYmluZXQgZXh0cmFjdGlvbiBmYWlsZWQnfQogfQogJGNvdW50PTAKIGZvcmVhY2goJHJvdyBpbiBbWmhpZ2FvTXNpXTo6Um93cygkZGIsJ1NFTEVDVCBgRmlsZWAsYENvbXBvbmVudF9gLGBGaWxlTmFtZWAgRlJPTSBgRmlsZWAnLDMpKXsKICAjIFRoaXMgcGlubmVkIHBhY2thZ2UgaXMgdXNlZCBvbmx5IG9uIFdpbmRvd3MgeDY0OyBpdHMgYnVuZGxlZCByZWRpc3RyaWJ1dGFibGUgYWxzbyBpbmNsdWRlcyBvdGhlciBhcmNoaXRlY3R1cmVzLgogIGlmKCRyb3dbMF0gLW1hdGNoICdfKGFybTY0fHg4NilcLicpIHtjb250aW51ZX0KICAkZGlyPVJlc29sdmUtUHJpdmF0ZURpcmVjdG9yeSAkY29tcG9uZW50c1skcm93WzFdXQogICRmaWxlbmFtZT0oJHJvd1syXS5TcGxpdCgnfCcpIHwgU2VsZWN0LU9iamVjdCAtTGFzdCAxKQogIGlmKFtJTy5QYXRoXTo6R2V0RmlsZU5hbWUoJGZpbGVuYW1lKSAtbmUgJGZpbGVuYW1lIC1vciBbSU8uUGF0aF06OkdldEZpbGVOYW1lKCRyb3dbMF0pIC1uZSAkcm93WzBdKXt0aHJvdyAnSW52YWxpZCBmaWxlIG5hbWUnfQogIFtJTy5EaXJlY3RvcnldOjpDcmVhdGVEaXJlY3RvcnkoJGRpcikgfCBPdXQtTnVsbAogICRzb3VyY2U9Sm9pbi1QYXRoICRjYWJSb290ICRyb3dbMF07JHRhcmdldD1Kb2luLVBhdGggJGRpciAkZmlsZW5hbWUKICBpZighKFRlc3QtUGF0aCAtTGl0ZXJhbFBhdGggJHNvdXJjZSAtUGF0aFR5cGUgTGVhZikpe3Rocm93ICdNaXNzaW5nIGNhYmluZXQgbWVtYmVyJ30KICBpZihUZXN0LVBhdGggLUxpdGVyYWxQYXRoICR0YXJnZXQpewogICBpZigoR2V0LUZpbGVIYXNoIC1MaXRlcmFsUGF0aCAkc291cmNlIC1BbGdvcml0aG0gU0hBMjU2KS5IYXNoIC1uZSAoR2V0LUZpbGVIYXNoIC1MaXRlcmFsUGF0aCAkdGFyZ2V0IC1BbGdvcml0aG0gU0hBMjU2KS5IYXNoKXt0aHJvdyAnQ29uZmxpY3RpbmcgcGFja2FnZSBmaWxlcyd9CiAgfSBlbHNlIHtbSU8uRmlsZV06OkNvcHkoJHNvdXJjZSwkdGFyZ2V0LCRmYWxzZSl9CiAgaWYoJHJvd1swXSAtbWF0Y2ggJ19hbWQ2NFwuJyAtYW5kICRmaWxlbmFtZSAtbWF0Y2ggJ14odmNydW50aW1lfG1zdmNwfGNvbmNydHx2Y29tcCkuKlwuZGxsJCcpewogICAkcHJvZ3JhbT1Kb2luLVBhdGggJGRlc3RSb290ICdMaWJyZU9mZmljZVxwcm9ncmFtJztbSU8uRGlyZWN0b3J5XTo6Q3JlYXRlRGlyZWN0b3J5KCRwcm9ncmFtKSB8IE91dC1OdWxsCiAgIFtJTy5GaWxlXTo6Q29weSgkc291cmNlLChKb2luLVBhdGggJHByb2dyYW0gJGZpbGVuYW1lKSwkZmFsc2UpCiAgfQogICRjb3VudCsrCiB9CiBAe2ZpbGVzPSRjb3VudDtkZXN0aW5hdGlvbj0kZGVzdFJvb3Q7bW9kZT0nZGF0YWJhc2UtZXh0cmFjdGlvbi1uby1pbnN0YWxsZXItYWN0aW9ucyd9IHwgQ29udmVydFRvLUpzb24gLUNvbXByZXNzCn0gZmluYWxseSB7W1poaWdhb01zaV06OkNsb3NlKCRkYil9Cg==';
export const LARK_VERSION = '1.0.100';
export const LARK_HASHES = {
  'darwin-x64': '7f5d442e5da3ae62b03a5b552880b651637b16b2eed91b588afaca6d72a6643a',
  'darwin-arm64': 'd068a27f608335016a8a7fb1b3cd1fccfb96bda92075a027e2bf1c4c23134e30',
  'linux-x64': 'cd7363f731c9e5dd2becd909837922cffea8aad229d581a84eb13c6aa0ce6808',
  'linux-arm64': '166e95ffaec34f82123f50316480250329884c09e71a6f92313047e2c5c3fa5d',
  'linux-riscv64': '44ac87c24dab31c840abf0c7fe7cd7ad5b88b5b72b876c5fac866527b0d48022',
  'win32-x64': '93118ca1992b4e5f1a40c14301f6fbde703d5e9160a9113099e409b4bd1c1d8d',
  'win32-arm64': '69bdaad4925567165086109b2ee02352dc81dc6b90e994095b14638e5cb8709e',
};
export const OFFICE_PACKAGE = {version: '26.2.7', bytes: 373121024,
  sha256: '480fecf759fc6393bd614fbf43753eb95a8198fc1a065d41b727e3b664cd1e59',
  url: 'https://download.documentfoundation.org/libreoffice/stable/26.2.7/win/x86_64/LibreOffice_26.2.7_Win_x86-64.msi'};
export async function fileHash(file) {
  const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
export function legacyObjectInventory(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length<512||bytes.subarray(0,8).toString('hex')!=='d0cf11e0a1b11ae1')return {blockers:['旧格式原件不是可验证的 Office 复合文档。']};
  const shift=bytes.readUInt16LE(30),sector=2**shift;
  if(![512,4096].includes(sector))return {blockers:['旧格式原件的扇区结构不支持。']};
  const block=id=>{const offset=(id+1)*sector;if(id>=0xfffffffa||offset+sector>bytes.length)throw Error('invalid sector');return bytes.subarray(offset,offset+sector);};
  try{
    const fatIds=[];for(let i=0;i<109;i++){const id=bytes.readUInt32LE(76+i*4);if(id<0xfffffffa)fatIds.push(id);}
    let difat=bytes.readUInt32LE(68);const seenD=new Set();
    while(difat<0xfffffffa){if(seenD.has(difat)||seenD.size>bytes.length/sector)throw Error('cycle');seenD.add(difat);const b=block(difat);for(let i=0;i<sector/4-1;i++){const id=b.readUInt32LE(i*4);if(id<0xfffffffa)fatIds.push(id);}difat=b.readUInt32LE(sector-4);}
    if(fatIds.length!==bytes.readUInt32LE(44))throw Error('fat mismatch');
    const fat=Buffer.concat(fatIds.map(block)),names=[],seen=new Set();let id=bytes.readUInt32LE(48);
    while(id<0xfffffffa){
      if(seen.has(id)||id*4+4>fat.length)throw Error('cycle');seen.add(id);const b=block(id);
      for(let i=0;i<sector;i+=128){const type=b[i+66],len=b.readUInt16LE(i+64);if(type&&len>=2&&len<=64&&len%2===0)names.push(b.subarray(i,i+len-2).toString('utf16le'));}
      id=fat.readUInt32LE(id*4);
    }
    const complex=names.filter(name=>/ObjectPool|VBA|Macros|ActiveX|Ole10Native|^MBD|Embedded|Ctls|LinkInfo|ExternalLink/i.test(name));
    return {streams:names,blockers:complex.length?['旧版原件含宏、链接或嵌入对象，转换副本不能证明这些内容完整：'+complex.slice(0,12).join('、')]:[],scope:'compound-storage inventory; conversion is not semantic or layout validation'};
  }catch{return {blockers:['旧格式目录结构不完整，无法确认嵌入内容；请用原软件检查原件。']};}
}
export function runPrivate(command, args, {cwd, env, timeout = 120000} = {}) {
  return new Promise((resolve, reject) => {
    let out = '', failed = false, timedOut = false, settled=false;
    const child = spawn(command, args, {cwd, env: {...process.env, ...env}, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    const stop=code=>{if(settled)return;settled=true;clearTimeout(timer);const error=failure(code,'本机组件未成功完成，请检查组件状态与系统权限。');if(code==='PROCESS_TIMEOUT')error.mayStillRun=true;reject(error);};
    const timer = setTimeout(() => { timedOut = true; child.kill(); stop('PROCESS_TIMEOUT'); }, timeout);
    child.on('error', () => { failed = true; stop('PROCESS_FAILED'); });
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 2 * 1024 * 1024) { failed = true; child.kill(); } });
    // Never echo raw process output on failure: authentication tools may contain credentials.
    child.stderr.on('data', () => {});
    child.on('close', code => { if(settled)return;clearTimeout(timer);if(failed||timedOut||code)stop(timedOut?'PROCESS_TIMEOUT':'PROCESS_FAILED');else {settled=true;resolve(out);} });
  });
}
export async function downloadPinned({url, sha256, bytes}, file, progress = () => {}) {
  if (!/^[a-f0-9]{64}$/.test(sha256) || new URL(url).protocol !== 'https:') throw failure('INTEGRITY');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  if (fs.existsSync(file) && await fileHash(file) === sha256) return file;
  const partial = file + '.part'; let offset = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
  if (bytes && offset > bytes) { fs.truncateSync(partial); offset = 0; }
  let response;
  try { response = await fetch(url, {headers: offset ? {Range: `bytes=${offset}-`} : {}, signal: AbortSignal.timeout(600000)}); }
  catch { throw failure('NETWORK'); }
  if (!response.ok) throw failure('NETWORK');
  if (response.status === 206 && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) throw failure('INTEGRITY');
  if (response.status !== 206) offset = 0;
  const fd = fs.openSync(partial, offset ? 'a' : 'w'); let received = offset, last = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > (bytes || 200 * 1024 * 1024)) throw failure('INTEGRITY');
      fs.writeSync(fd, chunk);
      if (Date.now() - last > 1000) { progress({stage: 'downloading', received, total: bytes || null}); last = Date.now(); }
    }
  } catch (e) { if (['ENOSPC', 'INTEGRITY'].includes(e.code)) throw e; throw failure('NETWORK'); }
  finally { fs.closeSync(fd); }
  if (bytes && received !== bytes || await fileHash(partial) !== sha256) { fs.truncateSync(partial); throw failure('INTEGRITY'); }
  fs.renameSync(partial, file); return file;
}

export function createChannelRuntime({root, platform = process.platform, arch = process.arch, systemDiscovery = true}) {
  const bin = path.join(root, 'lark', LARK_VERSION, 'lark-cli' + (platform === 'win32' ? '.exe' : ''));
  function officeCandidates() {
    const local = path.join(root, 'office', OFFICE_PACKAGE.version, 'program', platform === 'win32' ? 'soffice.exe' : 'soffice');
    const candidates = [local];
    if(!systemDiscovery)return candidates.map(file=>platform==='win32'?file.replace(/\.exe$/i,'.com'):file);
    if (process.env.ZHIGAO_OFFICE) candidates.push(process.env.ZHIGAO_OFFICE);
    if (platform === 'win32') {
      for (const base of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) candidates.push(path.join(base, 'LibreOffice', 'program', 'soffice.exe'));
    } else if (platform === 'darwin') candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
    const found = spawnSync(platform === 'win32' ? 'where.exe' : 'which', ['soffice'], {encoding: 'utf8', timeout: 5000, windowsHide: true});
    candidates.push(...(found.stdout || '').split(/\r?\n/).filter(Boolean));
    return [...new Set(candidates.map(file=>platform==='win32'&&/\.exe$/i.test(file)&&fs.existsSync(file.replace(/\.exe$/i,'.com'))?file.replace(/\.exe$/i,'.com'):file))];
  }
  async function officeStatus() {
    for (const command of officeCandidates()) {
      if (!fs.existsSync(command)) continue;
      try { const version = (await runPrivate(command, ['--version'], {timeout: 15000})).trim(); if (/LibreOffice \d/.test(version)) return {ready: true, command, version}; } catch {}
    }
    return {ready: false, supportedSetup: platform === 'win32' && arch === 'x64', code: 'OFFICE_MISSING'};
  }
  async function installLark(progress) {
    const sha256 = LARK_HASHES[platform + '-' + arch]; if (!sha256) throw failure('UNSUPPORTED_PLATFORM', '此系统或架构没有已核验的飞书组件包，请使用受支持的本机客户端。');
    if (fs.existsSync(bin)) { await runPrivate(bin, ['--version']); return {command: bin}; }
    const name = `lark-cli-${LARK_VERSION}-${platform === 'win32' ? 'windows' : platform}-${({x64: 'amd64'})[arch] || arch}${platform === 'win32' ? '.zip' : '.tar.gz'}`;
    const archive = path.join(root, 'downloads', name);
    try { await downloadPinned({url: `https://github.com/larksuite/cli/releases/download/v${LARK_VERSION}/${name}`, sha256}, archive, progress); }
    catch (e) {
      if(e.code!=='NETWORK')throw e;
      // This is the mirror declared by the publisher's pinned npm installer, with the SAME pinned digest.
      await downloadPinned({url:`https://registry.npmmirror.com/-/binary/lark-cli/v${LARK_VERSION}/${name}`,sha256},archive,progress);
    }
    const stage = fs.mkdtempSync(path.join(path.dirname(archive), 'lark-'));
    try {
      if (platform === 'win32') await runPrivate('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:ZG_ARCHIVE); try {$e=$z.GetEntry('lark-cli.exe'); if(!$e){throw 'Missing binary'}; [IO.Compression.ZipFileExtensions]::ExtractToFile($e,(Join-Path $env:ZG_STAGE 'lark-cli.exe'))} finally {$z.Dispose()}"], {env: {ZG_ARCHIVE: archive, ZG_STAGE: stage}});
      else await runPrivate('tar', ['-xzf', archive, '-C', stage, 'lark-cli']);
      const executable = path.join(stage, path.basename(bin)); fs.chmodSync(executable, 0o700);
      const version = await runPrivate(executable, ['--version']); if (!version.includes(LARK_VERSION)) throw failure('INTEGRITY');
      fs.mkdirSync(path.dirname(bin), {recursive: true}); fs.copyFileSync(executable, bin, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(bin, 0o700); return {command: bin, version: version.trim(), verified: 'native-version-execution'};
    } finally { fs.rmSync(stage, {recursive: true, force: true}); }
  }
  async function installOffice(progress) {
    const prior = await officeStatus(); if (prior.ready) return prior;
    if (platform !== 'win32' || arch !== 'x64') throw failure('UNSUPPORTED_PLATFORM', '此系统暂不提供自动安装转换器。请安装官方 LibreOffice，再回到同一任务继续。');
    const archive = await downloadPinned(OFFICE_PACKAGE, path.join(root, 'downloads', path.basename(OFFICE_PACKAGE.url)), progress);
    const target = path.join(root, 'office', OFFICE_PACKAGE.version);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    progress({stage: 'extracting-private-office'});
    const source=Buffer.from(OFFICE_EXTRACT_SCRIPT,'base64');if(source.length<1000)throw failure('OFFICE_EXTRACTOR_MISSING');
    const script=path.join(root,'downloads','office-extract-'+crypto.createHash('sha256').update(source).digest('hex').slice(0,16)+'.ps1');
    if(!fs.existsSync(script))fs.writeFileSync(script,source,{flag:'wx',mode:0o600});
    if(await fileHash(script)!==crypto.createHash('sha256').update(source).digest('hex'))throw failure('INTEGRITY');
    const stage=target+'.prepare-'+crypto.randomUUID();
    await runPrivate('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Package',archive,'-Destination',stage],{timeout:600000});
    const product=path.join(stage,'LibreOffice');
    await officeSmoke(path.join(product,'program','soffice.com'));
    if(fs.existsSync(target))fs.renameSync(target,target+'.incomplete-'+crypto.randomUUID());
    fs.renameSync(product,target);
    fs.rmSync(stage,{recursive:true,force:true});
    const result = await officeStatus(); if (!result.ready) throw failure('OFFICE_NOT_READY', '转换器未就绪。可能需要系统许可；不会改为全局安装。');
    await officeSmoke(result.command); return result;
  }
  function profile(dir) {
    const user = path.join(dir, 'profile', 'user'); fs.mkdirSync(user, {recursive: true});
    fs.writeFileSync(path.join(user, 'registrymodifications.xcu'), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop></item></oor:items>');
    return '-env:UserInstallation=' + pathToFileURL(path.dirname(user)).href;
  }
  async function convert(command, input, output, format) {
    fs.mkdirSync(output, {recursive: true});
    // LibreOffice's nested extension registry exceeds Windows path limits long
    // before the source path does. Keep only its disposable profile short.
    const profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'zg-office-'));
    await runPrivate(command, [profile(profileDir), '--headless', '--norestore', '--nodefault', '--nolockcheck', '--convert-to', format, '--outdir', output, input], {timeout: 180000});
    const result = path.join(output, path.basename(input, path.extname(input)) + '.' + format.split(':')[0]);
    if (!fs.existsSync(result) || fs.statSync(result).size < 32) throw failure('CONVERSION_FAILED', '原件无法转换，可能损坏、加密或格式不支持。原件已保留。');
    try{fs.rmSync(profileDir,{recursive:true,force:true});}catch{ /* Retain a busy private profile; never touch another process. */ }
    return result;
  }
  async function officeSmoke(command) {
    fs.mkdirSync(path.join(root, 'probes'), {recursive: true});
    const dir = fs.mkdtempSync(path.join(root, 'probes', 'office-'));
    try {
      const source = path.join(dir, 'probe.txt'); fs.writeFileSync(source, 'Zhigao conversion verification 2026');
      const result = await convert(command, source, path.join(dir, 'out'), 'pdf');
      if (!fs.readFileSync(result).subarray(0, 5).equals(Buffer.from('%PDF-'))) throw failure('CONVERSION_FAILED');
      return {verified: true, method: 'real-text-to-pdf', sha256: await fileHash(result)};
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  }
  // Chunked conversion transport, scoped to a single page/project/source. No arbitrary filesystem paths.
  const conversions = path.join(root, 'conversions'), pending = new Map(), starts = new Map(), finishing = new Map(), unsavedConversions=new Map();
  function saveConversion(dir,meta){const tmp=path.join(dir,'meta.tmp');fs.writeFileSync(tmp,JSON.stringify(meta),{mode:0o600});fs.renameSync(tmp,path.join(dir,'meta.json'));unsavedConversions.delete(meta.id);}
  async function recoverConversion(dir,meta){
    if(pending.has(meta.id))return meta;
    const volatile=unsavedConversions.get(meta.id);let recovered=false;
    if(volatile)meta={...volatile};
    if(meta.state==='converting'){
      // A surviving converter may still be writing. Only a completion receipt or
      // a dead owner allows examination of the existing result after restart.
      let receipt;try{receipt=JSON.parse(fs.readFileSync(path.join(dir,'completed.json'),'utf8'));}catch{}
      let alive=false;try{process.kill(meta.pid,0);alive=true;}catch(e){alive=e.code==='EPERM';}
      if(alive&&!receipt)return meta;
      const output=path.join(dir,'out','source.'+meta.format);
      try{
        const bytes=fs.readFileSync(output),end=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
        if(bytes.subarray(0,2).toString()!=='PK'||end<0||end+22>bytes.length||end+22+bytes.readUInt16LE(end+20)!==bytes.length)return meta;
        if(await fileHash(path.join(dir,'source.'+meta.extension))!==meta.sourceHash)return meta;
        const outputHash=await fileHash(output);
        if(receipt&&(receipt.sourceHash!==meta.sourceHash||receipt.outputHash!==outputHash||receipt.outputSize!==bytes.length))return meta;
        Object.assign(meta,{state:'complete',output:path.basename(output),outputHash,outputSize:bytes.length});recovered=true;
      }catch{return meta;}
    }
    if(volatile||recovered){
      try{
        if(meta.state==='complete'&&(await fileHash(path.join(dir,'out',meta.output))!==meta.outputHash||await fileHash(path.join(dir,'source.'+meta.extension))!==meta.sourceHash))throw failure('INTEGRITY');
        delete meta.checkpointError;saveConversion(dir,meta);
      }catch(e){meta.checkpointError=e.code||'CHECKPOINT_WRITE_FAILED';unsavedConversions.set(meta.id,{...meta});}
    }
    return meta;
  }
  function conversion(body) {
    if (!/^[a-f0-9-]{36}$/.test(body.jobId || '')) throw failure('CONVERSION_BINDING');
    const dir = path.join(conversions, body.jobId), meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    if (meta.token !== body.token || meta.projectId !== body.projectId || meta.sourceHash !== body.sourceHash) throw failure('CONVERSION_BINDING');
    return {dir, meta};
  }
  async function officeAction(body) {
    if (body.action === 'begin') {
      const format = ({ppt: 'pptx', doc: 'docx', xls: 'xlsx'})[body.extension];
      if (!format || !/^[a-f0-9]{64}$/.test(body.sourceHash || '') || typeof body.projectId !== 'string' || !Number.isSafeInteger(body.size) || body.size <= 0) throw failure('CONVERSION_INPUT');
      if (body.size > 512 * 1024 * 1024) throw failure('CONVERSION_SIZE', '当前转换支持不超过512MB的单个原件；请在原软件拆分后导入，原件保留。');
      const key = JSON.stringify([body.projectId, body.sourceHash, body.extension, body.size]);
      if (starts.has(key)) return starts.get(key);
      const start = (async () => {
      if (fs.existsSync(conversions)) for (const entry of fs.readdirSync(conversions)) {
        if (!/^[a-f0-9-]{36}$/.test(entry)) continue;
        let old; try { old = JSON.parse(fs.readFileSync(path.join(conversions, entry, 'meta.json'), 'utf8')); } catch { continue; }
        if (old.projectId === body.projectId && old.sourceHash === body.sourceHash && old.extension === body.extension && old.size === body.size) {
          old=await recoverConversion(path.join(conversions,entry),old);
          if(old.checkpointError)throw failure(old.checkpointError,'转换检查点尚未保存；原件和结果保留，存储恢复后将先核对结果。');
          if (old.state === 'converting' && !pending.has(old.id)) throw failure('CONVERSION_UNCERTAIN', '旧转换进程结果尚未确认，请核对原作业；不会重新转换。');
          if (old.state === 'failed') throw failure(old.error || 'CONVERSION_FAILED', '原转换未完成，请核对原文件或转换器；不会重复启动结果不明的操作。');
          return {jobId: old.id, token: old.token, state: old.state, received: fs.statSync(path.join(conversions, entry, 'source.' + old.extension)).size, reused: true};
        }
      }
      const runtime = await officeStatus(); if (!runtime.ready) throw failure('OFFICE_MISSING', '缺少转换器，请让连接 AI 调用 zhigao_plan_task，准备后继续当前资料。');
      const id = crypto.randomUUID(), dir = path.join(conversions, id); fs.mkdirSync(dir, {recursive: true});
      const meta = {id, token: crypto.randomUUID(), projectId: body.projectId, sourceHash: body.sourceHash, size: body.size, format, extension: body.extension, state: 'uploading', received: 0};
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta), {mode: 0o600}); fs.writeFileSync(path.join(dir, 'source.' + meta.extension), '');
      return {jobId: id, token: meta.token, state: meta.state, received: 0};
      })().finally(() => starts.delete(key)); starts.set(key, start); return start;
    }
    const bound=conversion(body),dir=bound.dir,meta=await recoverConversion(dir,bound.meta),source=path.join(dir,'source.'+meta.extension);
    const save = () => saveConversion(dir,meta);
    if(meta.checkpointError&&body.action!=='status')throw failure(meta.checkpointError,'转换检查点尚未保存，请恢复存储后重试；不会重复转换。');
    if (body.action === 'chunk') {
      if (meta.state !== 'uploading' || !Number.isSafeInteger(body.offset) || body.offset < 0 || typeof body.data !== 'string' || body.data.length > 800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) throw failure('CONVERSION_OFFSET');
      const data = Buffer.from(body.data, 'base64'); if (!data.length || data.length + body.offset > meta.size) throw failure('CONVERSION_SIZE');
      const received = fs.statSync(source).size;
      if (body.offset < received && body.offset + data.length <= received) {
        const previous = Buffer.alloc(data.length), fd = fs.openSync(source, 'r');
        try { fs.readSync(fd, previous, 0, previous.length, body.offset); } finally { fs.closeSync(fd); }
        if (!previous.equals(data)) throw failure('INTEGRITY');
        return {received, reused: true};
      }
      if (body.offset !== received) throw failure('CONVERSION_OFFSET');
      fs.appendFileSync(source, data); meta.received = fs.statSync(source).size; save(); return {received: meta.received};
    }
    if (body.action === 'finish') {
      if (meta.state === 'complete' || pending.has(meta.id)) return {state: meta.state};
      if (finishing.has(meta.id)) return finishing.get(meta.id);
      const finish = (async () => {
      if (meta.state !== 'uploading' || fs.statSync(source).size !== meta.size || await fileHash(source) !== meta.sourceHash) throw failure('INTEGRITY');
      const runtime = await officeStatus(); if (!runtime.ready) throw failure('OFFICE_MISSING');
      meta.originalInventory=legacyObjectInventory(fs.readFileSync(source));
      meta.state = 'converting'; meta.pid = process.pid; save();
      const job = (async () => {
        try {
          const output = await convert(runtime.command, source, path.join(dir, 'out'), meta.format);
          if (fs.readFileSync(output).subarray(0, 2).toString() !== 'PK') throw failure('CONVERSION_FAILED');
          meta.output = path.basename(output); meta.outputHash = await fileHash(output); meta.outputSize = fs.statSync(output).size; meta.state = 'complete';
        } catch (e) { meta.state = 'failed'; meta.error = e.code || 'CONVERSION_FAILED'; }
        if(meta.state==='complete')try{fs.writeFileSync(path.join(dir,'completed.json'),JSON.stringify({sourceHash:meta.sourceHash,outputHash:meta.outputHash,outputSize:meta.outputSize}),{mode:0o600});}catch{/* The output can still be verified after the owner exits. */}
        save();
      })().catch(e=>{meta.checkpointError=e.code||'CHECKPOINT_WRITE_FAILED';unsavedConversions.set(meta.id,{...meta});}).finally(() => pending.delete(meta.id)); pending.set(meta.id, job);
      return {state: 'converting'};
      })().finally(() => finishing.delete(meta.id)); finishing.set(meta.id, finish); return finish;
    }
    if (body.action === 'status') return {state: meta.checkpointError?'checkpoint_unsaved':meta.state === 'converting' && !pending.has(meta.id) ? 'interrupted' : meta.state,
      persisted:!meta.checkpointError,conversionComplete:meta.state==='complete',received: fs.statSync(source).size, format: meta.format, size: meta.outputSize, sha256: meta.outputHash, error: meta.checkpointError||meta.error,originalInventory:meta.originalInventory};
    if (body.action === 'read') {
      if (meta.state !== 'complete' || !Number.isSafeInteger(body.offset) || body.offset < 0 || body.offset >= meta.outputSize) throw failure('CONVERSION_OFFSET');
      const output = path.join(dir, 'out', meta.output);
      if (await fileHash(output) !== meta.outputHash) throw failure('INTEGRITY');
      const data = Buffer.alloc(Math.min(512 * 1024, meta.outputSize - body.offset)), fd = fs.openSync(output, 'r');
      try { fs.readSync(fd, data, 0, data.length, body.offset); } finally { fs.closeSync(fd); }
      return {data: data.toString('base64'), offset: body.offset, nextOffset: body.offset + data.length};
    }
    throw failure('INVALID_ACTION');
  }
  return {larkBinary: bin, installLark, officeStatus, installOffice, officeSmoke, officeAction, busy: () => pending.size > 0 || starts.size > 0 || finishing.size > 0};
}

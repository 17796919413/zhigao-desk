import assert from 'node:assert/strict';
import {selectClientOwner} from '../zhigao-connector.mjs';
const row=(pid,name,entry='')=>({pid,name,entry,startedAt:'2026-11-18T01:00:00Z'});
const cases=[
  ['codex-mcp-client',[row(3,'cmd.exe'),row(2,'codex.exe')],'codex',2],
  ['Claude Code',[row(3,'node.exe','@anthropic-ai/claude-code')],'claude',3],
  ['WorkBuddy',[row(4,'WorkBuddy.exe'),row(2,'WorkBuddy.exe')],'workbuddy',2],
  ['@deepseek-ai/dsh-mcp-client',[row(3,'node','@deepseek-ai/dsh')],'dsh',3],
  ['DeepSeek Harness',[row(3,'dsh.exe')],'dsh',3],
  ['Claude Code',[row(3,'claude')],'claude',3],
  ['codex-mcp-client',[row(4,'codex.exe'),row(3,'python.exe'),row(2,'codex.exe')],'codex',4],
];
for(const [name,rows,family,pid] of cases)assert.deepEqual(selectClientOwner(rows,name),{pid,startedAt:rows[0].startedAt,family});
for(const name of ['codex-mcp-client','Claude Code','WorkBuddy','DeepSeek Harness','unknown'])assert.equal(selectClientOwner([row(3,'powershell.exe'),row(2,'explorer.exe')],name),null);
assert.equal(selectClientOwner([row(2,'WorkBuddy.exe')],'codex-mcp-client'),null);
for(const [family,exe] of [['codex','codex.exe'],['claude','claude.exe'],['workbuddy','WorkBuddy.exe'],['dsh','dsh.exe']]){
  assert.equal(selectClientOwner([row(3,'cmd.exe'),row(2,exe)],'zhigao')?.family,family);
}
assert.equal(selectClientOwner([row(3,'claude.exe'),row(2,'codex.exe')],'codex-mcp-client'),null);
assert.equal(selectClientOwner([row(3,'third-party.exe'),row(2,'codex.exe')],'zhigao'),null);
assert.equal(selectClientOwner([row(3,'claude.exe'),row(2,'codex.exe')],'zhigao')?.pid,3);
console.log(JSON.stringify({passed:true,checks:20,scope:'owner selection only; includes generic name and nested hosts'}));

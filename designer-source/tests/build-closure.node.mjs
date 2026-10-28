import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// A deterministic compiler check, not a native/child fixture. Its only child is
// the fixed esbuild compiler service already declared in the execution scope.
test('regeneration refuses an undeclared stale generated output instead of reporting exact match',async()=>{
 const extra=new URL('../../src/studio/designer/undeclared-output.fixture',import.meta.url);
 const argv=process.argv.slice();
 fs.writeFileSync(extra,'OWNED NONSECRET OUTPUT-SET FIXTURE\n',{flag:'wx'});
 try{
  process.argv.push('--check');
  await assert.rejects(import('../build.mjs'),/Unexpected generated output/);
 }finally{
  process.argv.splice(0,process.argv.length,...argv);
  fs.unlinkSync(extra);
 }
});

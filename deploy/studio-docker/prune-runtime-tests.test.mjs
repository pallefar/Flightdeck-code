import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
test('source pruning removes tests while retaining runtime modules and conformance fixtures',()=>{
 const root=mkdtempSync(join(tmpdir(),'studio-source-prune-'));
 try{
  for(const file of ['server/index.ts','server/__tests__/support.ts','packages/providers/src/client.test.ts','packages/conformance/src/fixtures/subapp.ts']){
   const path=join(root,file);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,'export {};');
  }
  const result=spawnSync(process.execPath,[new URL('prune-runtime-tests.mjs',import.meta.url).pathname,root],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.ok(existsSync(join(root,'server/index.ts')));
  assert.ok(existsSync(join(root,'packages/conformance/src/fixtures/subapp.ts')));
  assert.equal(existsSync(join(root,'server/__tests__')),false);
  assert.equal(existsSync(join(root,'packages/providers/src/client.test.ts')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

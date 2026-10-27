import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('invalid operator boot fails with a constant message and no secret',()=>{
 const state=mkdtempSync(join(tmpdir(),'studio-boot-'));
 try {
  const result=spawnSync(process.execPath,['--import','tsx','deploy/studio-docker/bootstrap.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,STUDIO_STATE_DIR:state,STUDIO_OPERATOR:'service',STUDIO_OPERATOR_TOKEN:'test-token-not-for-production-1234567890'}});
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.equal(result.stderr,'studio: startup refused (check private configuration)\n');
 } finally {rmSync(state,{recursive:true,force:true});}
});

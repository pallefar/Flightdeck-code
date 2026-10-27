import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,stat,chmod,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('bootstrap creates a private strong stable operator token without output', async () => {
 const {loadSecrets} = await import('./secrets.mjs');
 const dir = await mkdtemp(join(await (await import('node:fs/promises')).realpath(tmpdir()),'studio-secrets-'));
 try {
  const first=await loadSecrets({},dir); const again=await loadSecrets({},dir);
  assert.match(first.STUDIO_OPERATOR_TOKEN,/^[a-f0-9]{64}$/);
  assert.equal(first.STUDIO_OPERATOR_TOKEN,again.STUDIO_OPERATOR_TOKEN);
  assert.equal((await stat(join(dir,'operator-token'))).mode & 0o777,0o600);
  assert.equal(first.ANTHROPIC_API_KEY,undefined);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('resource configuration path is forwarded unchanged, not read as a secret', async () => {
 const {loadSecrets}=await import('./secrets.mjs');
 const dir=await mkdtemp(join(await (await import('node:fs/promises')).realpath(tmpdir()),'studio-resources-config-'));
 try {
  const configPath=join(dir,'resources.json');
  await writeFile(configPath,JSON.stringify({version:1,projects:[],network:{allowedOrigins:[]},functions:[]}),{mode:0o600});
  const loaded=await loadSecrets({STUDIO_RESOURCE_CONFIG_FILE:configPath},dir);
  assert.equal(loaded.STUDIO_RESOURCE_CONFIG_FILE,configPath);
  assert.equal(loaded.STUDIO_RESOURCE_CONFIG,undefined);
  assert.equal(loaded.ANTHROPIC_API_KEY,undefined);
  await assert.rejects(loadSecrets({UNKNOWN_RESOURCE_FILE:configPath},dir));
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('secret-file whitelist loads private files and rejects unsafe inputs without echo', async () => {
 const {loadSecrets}=await import('./secrets.mjs');
 const dir=await mkdtemp(join(await (await import('node:fs/promises')).realpath(tmpdir()),'studio-secrets-'));
 const secret=join(dir,'key'); const marker='test-only-private-content';
 try {
  await writeFile(secret,marker+'\n',{mode:0o600});
  const loaded=await loadSecrets({ANTHROPIC_API_KEY_FILE:secret},dir);
  assert.equal(loaded.ANTHROPIC_API_KEY,marker);
  assert.equal(loaded.ANTHROPIC_API_KEY_FILE,undefined);
  for(const mode of [0o644,0o660]) {
   await chmod(secret,mode);
   await assert.rejects(loadSecrets({ANTHROPIC_API_KEY_FILE:secret},dir),e=>!e.message.includes(marker)&&!e.message.includes(secret));
  }
  await chmod(secret,0o600);
  const link=join(dir,'link');await symlink(secret,link);
  const parentLink=join(dir,'parent-link');await symlink(dir,parentLink);
  for(const path of [link,dir,join(dir,'missing'),join(parentLink,'key')]) await assert.rejects(loadSecrets({ANTHROPIC_API_KEY_FILE:path},dir));
  for(const content of ['', 'secret\nsecond', 'x'.repeat(8193)]) {
   await writeFile(secret,content); await assert.rejects(loadSecrets({ANTHROPIC_API_KEY_FILE:secret},dir));
  }
  await writeFile(secret,marker);
  await assert.rejects(loadSecrets({ANTHROPIC_API_KEY:marker,ANTHROPIC_API_KEY_FILE:secret},dir));
  await assert.rejects(loadSecrets({UNTRUSTED_FILE:secret},dir));
  const supplied=await loadSecrets({STUDIO_OPERATOR_TOKEN_FILE:secret},dir);
  assert.equal(supplied.STUDIO_OPERATOR_TOKEN,marker);
  await chmod(join(dir,'operator-token'),0o644);
  await assert.rejects(loadSecrets({},dir));
 } finally {await rm(dir,{recursive:true,force:true});}
});

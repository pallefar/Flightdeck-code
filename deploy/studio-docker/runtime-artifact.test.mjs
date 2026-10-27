import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
// Controlled structural fixtures, NOT audit results or evidence of a real image.
for(const kind of ['production','dev-only','forbidden','mismatched','unlocked','test-source'])test(`physical artifact verifier: ${kind}`,()=>{
 const root=mkdtempSync(join(tmpdir(),'studio-artifact-fixture-'));
 try{
  const name=kind==='forbidden'?'vitest':'runtime-fixture';
  const put=(p,value)=>{const full=join(root,p);mkdirSync(join(full,'..'),{recursive:true});writeFileSync(full,typeof value==='string'?value:JSON.stringify(value));};
  put('package.json',{name:'artifact-test-fixture',version:'0.0.0',dependencies:{[name]:'1.0.0'}});
  const key='node_modules/'+name;
  const entry={version:kind==='mismatched'?'2.0.0':'1.0.0',...(kind==='dev-only'?{dev:true}:{})};
  put('package-lock.json',{lockfileVersion:3,packages:{'':{dependencies:{[name]:'1.0.0'}},...(kind==='unlocked'?{}:{[key]:entry})}});
  put(key+'/package.json',{name,version:'1.0.0'});
  put('server/index.ts','export {};');put('packages/example/index.ts','export {};');
  if(kind==='test-source')put('server/index.test.ts','export {};');
  const result=spawnSync(process.execPath,[new URL('verify-runtime-artifact.mjs',import.meta.url).pathname],{cwd:root,encoding:'utf8'});
  if(kind==='production'){
   assert.equal(result.status,0,result.stderr);
   const report=JSON.parse(result.stdout);assert.equal(report.installedCount,1);assert.equal(report.installedGraphValid,true);
  }else{
   assert.notEqual(result.status,0);
   const errors={'dev-only':'dev-only lock entry physically installed',forbidden:'development package installed',mismatched:'installed/lock mismatch',unlocked:'unlocked installed package','test-source':'test source in runtime'};
   assert.ok(result.stderr.includes(errors[kind]),result.stderr);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});

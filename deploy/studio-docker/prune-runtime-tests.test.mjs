import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
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

const runtimeModules=[
 'server/index.ts',
 'packages/authoring-harness/src/index.ts',
 'packages/workflow/graph.ts',
 'packages/subapp-workspace/schema.ts',
 'packages/conformance/src/fixtures/subapp.ts',
 'packages/codegen/src/index.ts',
 'packages/codegen/src/testing/readEmittedManifest.ts',
 'packages/codegen/src/testing/readHostManifestMetadata.ts',
];
function assertPruned(removed,retained,absentDirectories=[]){
 const parent=mkdtempSync(join(tmpdir(),'studio-runtime-prune-'));
 const root=join(parent,'build');
 const sibling=join(parent,'untouched');
 const bytes=new Map([...runtimeModules,...retained].map(file=>[file,Buffer.from(`// retained ${file}\r\nexport const marker = '✓';\r\n`)]));
 const sentinel=Buffer.from('owned sibling must remain byte-identical\r\n');
 function write(base,file,contents){const path=join(base,file);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,contents);}
 try{
  for(const [file,contents] of Object.entries(removed)){
   write(root,file,contents);write(sibling,file,sentinel);
   assert.ok(existsSync(join(root,file)),`fixture missing: ${file}`);
  }
  for(const [file,contents] of bytes)write(root,file,contents);
  for(let run=0;run<2;run++){
   const result=spawnSync(process.execPath,[new URL('prune-runtime-tests.mjs',import.meta.url).pathname,root],{cwd:sibling,encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
   for(const file of [...Object.keys(removed),...absentDirectories])assert.equal(existsSync(join(root,file)),false,`test-only source remains: ${file}`);
   for(const [file,contents] of bytes)assert.deepEqual(readFileSync(join(root,file)),contents,`runtime bytes changed: ${file}`);
   for(const file of Object.keys(removed))assert.deepEqual(readFileSync(join(sibling,file)),sentinel,`pruned outside explicit build target: ${file}`);
  }
 }finally{rmSync(parent,{recursive:true,force:true});}
}

test('source pruning removes only the authoring-harness test-support directory',()=>{
 assertPruned({
  'packages/authoring-harness/tests/fixtures.ts':'export const fixture = true;\n',
  'packages/authoring-harness/tests/nested/support.ts':'export const support = true;\n',
 },[
  'packages/authoring-harness/tests-runtime/fixtures.ts',
  'packages/authoring-harness/src/tests/fixtures.ts',
  'packages/other/tests/fixtures.ts',
 ],['packages/authoring-harness/tests']);
});

test('source pruning removes only the workflow test helper',()=>{
 assertPruned({
  'packages/workflow/test-helpers.ts':'export const fixture = true;\n',
 },[
  'packages/other/test-helpers.ts',
  'packages/workflow/src/test-helpers.ts',
  'packages/workflow/test-helpers-runtime.ts',
 ]);
});

test('source pruning removes the subapp-workspace helper and its test-only process entrypoint together',()=>{
 assertPruned({
  'packages/subapp-workspace/testing.ts':'export const snapshotFixture = () => ({});\n',
  'packages/subapp-workspace/process-fixture.ts':"import {snapshotFixture} from './testing';\nsnapshotFixture();\n",
 },[
  'packages/other/testing.ts',
  'packages/other/process-fixture.ts',
  'packages/subapp-workspace/src/testing.ts',
  'packages/subapp-workspace/testing-runtime.ts',
  'packages/subapp-workspace/process-fixture-runtime.ts',
 ]);
});

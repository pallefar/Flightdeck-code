import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const root=fileURLToPath(new URL('../../src/studio/designer/',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const load=async p=>import(pathToFileURL(path.join(root,p)).href).catch(()=>null);
export const cases=[
 ['source-built editor retains both public controller callbacks and source-derived sample disclosures',async()=>{
   const bundle=await load('AppDesigner.js');
   assert.equal(typeof bundle?.AppDesigner,'function','Latest editable source has not been packaged to the repository destination');
   const handles=[];
   const html=renderToStaticMarkup(createElement(bundle.AppDesigner,{embedded:true,onCreatePageRequestHandle:h=>handles.push(h),onDocumentHandle:h=>handles.push(h)}));
   assert.deepEqual(handles,[],'SSR must not grant client handles');
   for(const s of ['not connected to Flightdeck OS','Sample data','SAMPLE DATA','92%','Workflow modules','SDK sub-app pages','Companion pages'])assert.ok(html.includes(s),s);
   assert.ok(!html.includes('data-standalone-chrome'));
   const declaration=read('types/app/AppDesigner.d.ts');
   for(const s of ['onCreatePageRequestHandle?','onDocumentHandle?'])assert.ok(declaration.includes(s),s);
   assert.ok(read('types/app/public.d.ts').includes('DesignerDocumentHandle'));
 }],
 ['packaged portable model edits actual PageDoc and round-trips shared history and exact local save',async()=>{
   const m=await load('model.js');assert.equal(typeof m?.openDoc,'function','Missing portable model build');
   const original=m.initialDoc();const before=JSON.stringify(original);let s=m.openDoc(original);
   s=m.edit(s,['meta','title','en'],'Packaged page');assert.equal(s.doc.meta.title.en,'Packaged page');assert.equal(JSON.stringify(original),before);
   s=m.step(s,'undo');assert.equal(JSON.stringify(s.doc),before);s=m.step(s,'redo');assert.equal(s.doc.meta.title.en,'Packaged page');
   let raw=null;const store={setItem:(_k,v)=>{raw=v},getItem:()=>raw};
   const value={doc:s.doc,notes:'local fixture',appearance:'light',preview:'desktop',sample:'mixed'};
   assert.equal(m.saveLocal(store,value),raw);assert.deepEqual(m.readLocal(store),value);
   assert.throws(()=>m.saveLocal({setItem(){},getItem(){return '{}'}},value),/readback/i);
   assert.throws(()=>m.openDoc({...original,untrusted:true}),/Invalid/);
 }],
 ['source pins and generated runtime/declaration Zod boundary are exact and do not use ambient schemas',async()=>{
   assert.ok(fs.existsSync(path.join(root,'build-manifest.json')),'Missing reproducible source/build manifest');
   const m=JSON.parse(read('build-manifest.json'));
   assert.equal(m.zod.version,'3.25.76');assert.equal(m.reactExternal,true);assert.equal(m.strict,true);assert.equal(m.skipLibCheck,false);
   for(const o of m.outputs){const bytes=fs.readFileSync(path.join(root,o.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),o.sha256,o.path);}
   assert.ok(m.runtimeInputs.every(x=>!x.includes('/reference/')&&!x.includes('/fixtures/')&&!x.includes('contracts/studio')));
   assert.ok(m.runtimeInputs.some(x=>x.endsWith('StatTile.tsx')));assert.ok(m.runtimeInputs.some(x=>x.includes('editor-core/history.ts')));
   assert.ok(m.zod.declarationFiles>0);assert.ok(read('NOTICE.md').includes('Colin McDonnell'));
   for(const p of m.declarations){assert.ok(!/(?:from\s*|import\()['"]zod(?:\/|['"])/.test(read(p)),p+' leaks ambient Zod');}
 }],
 ['native package retains uncertain-write refusal and exact actor/target/revision reconciliation',async()=>{
   const n=await load('native.js');assert.equal(typeof n?.createNativeSession,'function','Missing native contract build');
   const m=await load('model.js'),doc=m.initialDoc();const context={workspaceId:'nonsecret-workspace',projectId:'nonsecret-project',actorId:'fixture+actor@example.invalid',epoch:'epoch-1'};
   const target={kind:'os-project',pageId:'11111111-1111-4111-8111-111111111111'};let writes=0,back;
   const s=n.createNativeSession({context,target,baseRev:4,adapter:{async write(a){writes++;back={context:a.context,target:a.target,doc:a.doc,rev:5,by:context.actorId};throw Error('synthetic lost response')},async read(){return structuredClone(back)}}});
   assert.equal((await s.save(doc)).status,'uncertain');assert.equal((await s.save(doc)).status,'refused');assert.equal(writes,1);
   back.by='wrong';assert.equal((await s.reconcile()).status,'uncertain');back.by=context.actorId;
   assert.equal((await s.reconcile()).status,'saved');assert.equal(writes,1);assert.equal(s.snapshot().baseRev,5);
 }],
 ['default committed runner includes the pure designer family without replacing Vitest or Docker',async()=>{
   const runner=await import('../../scripts/test-all.mjs');
   const commands=runner.createTestCommands(['literal-filter']);
   assert.equal(commands.length,3,'Designer ordinary tests are absent from the default committed runner');
   assert.deepEqual(commands[0][1].slice(1),['run','literal-filter']);
   assert.deepEqual(commands[1][1],['--test','deploy/studio-docker/*.test.mjs']);
   assert.deepEqual(commands[2][1],[fileURLToPath(new URL('../tests/run.mjs',import.meta.url))]);
 }],
 ['source tests and generated editor share the same peer React instance',async()=>{
   const source=createRequire(import.meta.url).resolve('react');
   const generated=createRequire(new URL('../../src/studio/designer/AppDesigner.js',import.meta.url)).resolve('react');
   assert.equal(source,generated,'A nested source dependency mirror would create two React dispatchers');
 }],
];

import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/studio/designer/model.js';
const draft=s=>({doc:s.doc,notes:'local only',appearance:'light',preview:'desktop',sample:'mixed'});
const memory=()=>{let raw=null;return {getItem:k=>{assert.equal(k,M.STORAGE_KEY);return raw;},setItem:(k,v)=>{assert.equal(k,M.STORAGE_KEY);raw=v;}};};
// Only this synchronous model fixture replaces performance; no browser, RAF or driver clock is changed.
const clock=fn=>{const old=Object.getOwnPropertyDescriptor(globalThis,'performance');let now=1000;Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}});try{return fn(value=>{now=value;});}finally{Object.defineProperty(globalThis,'performance',old);}};
const spacing=s=>s.doc.sections[0].spacing;
// The UI regression independently invokes the actual mounted Save button; this tests the unchanged native boundary API deterministically.
test('successful exact save boundary retains identity and full past while isolating quick same-field undo',()=>clock(time=>{
 let s=M.openDoc(M.initialDoc());s={...s,selected:'headingintro01'};
 s=M.edit(s,['meta','title','en'],'Earlier title');const earlier=s;
 time(1100);s=M.edit(s,['sectionintro01','spacing'],'normal');const beforeSave=s;
 const store=memory(),raw=M.saveLocal(store,draft(s));
 assert.equal(raw,JSON.stringify(draft(s)));assert.equal(store.getItem(M.STORAGE_KEY),raw);assert.deepEqual(M.readLocal(store),draft(s));
 s={...s,history:M.markSaved(s.history)};
 assert.equal(s.doc,beforeSave.doc);assert.equal(s.selected,beforeSave.selected);assert.equal(s.history.past,beforeSave.history.past);assert.equal(s.history.future,beforeSave.history.future);assert.equal(s.history.floor,beforeSave.history.floor);assert.equal(s.history.nextSeq,beforeSave.history.nextSeq);assert.equal(s.history.sealed,true);
 time(1101);s=M.edit(s,['sectionintro01','spacing'],'spacious');assert.equal(s.history.past.length,3);
 s=M.step(s,'undo');assert.equal(spacing(s),'normal');assert.equal(JSON.stringify(draft(s)),raw);
 s=M.step(s,'undo');assert.deepEqual(s.doc,earlier.doc);
 s=M.step(s,'undo');assert.deepEqual(s.doc,M.openDoc(M.initialDoc()).doc);
 s=M.step(s,'redo');assert.deepEqual(s.doc,earlier.doc);s=M.step(s,'redo');assert.equal(JSON.stringify(draft(s)),raw);s=M.step(s,'redo');assert.equal(spacing(s),'spacious');assert.equal(store.getItem(M.STORAGE_KEY),raw);
}));
test('saving after Undo keeps the entire Redo stack and next real edit follows branch semantics',()=>clock(time=>{
 let s=M.openDoc(M.initialDoc());s=M.edit(s,['sectionintro01','spacing'],'normal');time(2000);s=M.edit(s,['sectionintro01','spacing'],'spacious');
 s=M.step(s,'undo');const before=s;assert.equal(s.history.future.length,1);const raw=M.saveLocal(memory(),draft(s));s={...s,history:M.markSaved(s.history)};
 assert.equal(s.doc,before.doc);assert.equal(s.selected,before.selected);assert.equal(s.history.past,before.history.past);assert.equal(s.history.future,before.history.future);assert.equal(JSON.stringify(draft(s)),raw);
 const redone=M.step(s,'redo');assert.equal(spacing(redone),'spacious');assert.equal(redone.history.future.length,0);
 time(2001);const branch=M.edit(s,['sectionintro01','spacing'],'compact');assert.equal(branch.history.future.length,0);assert.equal(spacing(M.step(branch,'undo')),'normal');
}));
test('storage write and both exact and validation readback failures leave the unsealed model untouched',()=>clock(time=>{
 let s=M.openDoc(M.initialDoc());s=M.edit(s,['sectionintro01','spacing'],'normal');
 for(const mode of ['write','exact-throw','exact-mismatch','validation-throw','validation-mismatch']){
  let raw=null,reads=0;const before=JSON.stringify(s);const store={setItem(k,v){if(mode==='write')throw Error('quota');raw=v;},getItem(){reads++;if((mode==='exact-throw'&&reads===1)||(mode==='validation-throw'&&reads===2))throw Error('read');if(mode==='exact-mismatch'&&reads===1)return 'wrong';if(mode==='validation-mismatch'&&reads===2)return '{}';return raw;}};
  assert.throws(()=>M.saveLocal(store,draft(s)),/save|read|invalid/i);assert.equal(JSON.stringify(s),before);assert.equal(s.history.sealed,false);
  time(1001);assert.equal(spacing(M.step(M.edit(s,['sectionintro01','spacing'],'spacious'),'undo')),'compact');
 }
}));

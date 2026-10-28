import test from 'node:test';
import assert from 'node:assert/strict';
const load=async()=>{const m=await import('../../src/studio/designer/model.js').catch(()=>null);assert.ok(m,'PageDoc placement adapter is not implemented');return m;};
test('palette placement inserts a real PageDoc widget at an addressed column without mutation',async()=>{
 const m=await load();const doc=m.initialDoc();const before=JSON.stringify(doc);const s=m.openDoc(doc);const next=m.insert(s,'eval-score',doc.sections[1].columns[1].id,0);
 assert.equal(JSON.stringify(doc),before);assert.equal(next.doc.sections[1].columns[1].blocks[0].widgetId,'eval-score');assert.equal(next.doc.schemaVersion,2);assert.equal(next.history.past.length,1);assert.equal(m.validateDoc(next.doc).ok,true);
 assert.throws(()=>m.insert(s,'brain-ask',doc.sections[1].columns[1].id,0),/unavailable/i);
});
test('inspector edits content and section layout through validated shared commands',async()=>{
 const m=await load();assert.equal(typeof m.edit,'function','Inspector command adapter is missing');let s=m.openDoc(m.initialDoc());
 s=m.edit(s,['headingintro01','content','en'],[{type:'heading',level:2,content:[{type:'text',text:'Edited overview'}]}]);assert.equal(s.doc.sections[0].columns[0].blocks[0].content.en[0].content[0].text,'Edited overview');
 s=m.layout(s,'sectionbody001','1-1');assert.equal(s.doc.sections[1].layout,'1-1');assert.equal(s.history.past.length,2);
 assert.throws(()=>m.edit(s,['meta','title','en'],' '),/refused/);assert.throws(()=>m.edit(s,['widgeteval001','config'],{url:'https://example.test'}),/unavailable/i);
});
test('move reorders real blocks and shared inverse history round-trips exactly',async()=>{
 const m=await load();assert.equal(typeof m.move,'function','Move/history adapter is missing');let s=m.openDoc(m.initialDoc());const before=JSON.stringify(s.doc);
 s=m.move(s,'widgeteval001','columnbody0001',1);assert.equal(s.doc.sections[1].columns[0].blocks[1].id,'widgeteval001');const moved=JSON.stringify(s.doc);
 s=m.step(s,'undo');assert.equal(JSON.stringify(s.doc),before);s=m.step(s,'redo');assert.equal(JSON.stringify(s.doc),moved);
 s=m.remove(s,'widgeteval001');assert.equal(s.doc.sections[1].columns[0].blocks.some(b=>b.id==='widgeteval001'),false);s=m.step(s,'undo');assert.equal(JSON.stringify(s.doc),moved);
});
test('local draft validates, reads back exact bytes, reopens and refuses corruption and storage failure',async()=>{
 const m=await load();assert.equal(typeof m.saveLocal,'function','Explicit local-save adapter is missing');const value={doc:m.initialDoc(),notes:'Local only',appearance:'light',preview:'desktop',sample:'mixed'};
 let raw=null;const store={getItem:()=>raw,setItem:(_k,v)=>{raw=v;}};
 const saved=m.saveLocal(store,value);assert.equal(saved,raw);assert.deepEqual(m.readLocal(store),value);
 raw='{"schemaVersion":2}';assert.throws(()=>m.readLocal(store),/invalid/i);
 assert.throws(()=>m.saveLocal({setItem(){throw Error('quota');},getItem(){return null;}},value),/could not save/i);
 assert.throws(()=>m.saveLocal({setItem(){},getItem(){return 'wrong';}},value),/exact readback/i);
 assert.throws(()=>m.saveLocal(store,{...value,projectId:'pretend'}),/invalid/i);
});
test('Create page produces fresh editable native page identity, not another sample reveal',async()=>{
 const m=await load();assert.equal(typeof m.createPage,'function','New page creation is missing');const a=m.createPage('Team page');const b=m.createPage('Another page');
 assert.equal(a.doc.meta.title.en,'Team page');assert.equal(a.doc.sections[0].columns[0].blocks.length,0);assert.notEqual(a.doc.sections[0].id,b.doc.sections[0].id);
 const edited=m.insert(a,'text',a.doc.sections[0].columns[0].id,0);assert.equal(edited.doc.sections[0].columns[0].blocks.length,1);assert.throws(()=>m.createPage(' '),/invalid/i);
});
test('named composable editor renders native page, source StatTile, sandbox disclosures and optional host chrome',async()=>{
 const ui=await import('./editor-ssr.mjs').catch(()=>null);assert.ok(ui,'Named AppDesigner renderer is not implemented');
 const html=ui.renderEditor(false);assert.match(html,/data-pd-widget="eval-score"/);assert.match(html,/data-widget-outcome="value"/);assert.match(html,/92%/);assert.match(html,/not connected to Flightdeck OS/);assert.match(html,/Create page/);assert.match(html,/Workflow modules/);assert.match(html,/Companion/);assert.doesNotMatch(html,/<input[^>]+type="password"/);
 assert.match(html,/data-standalone-chrome/);assert.doesNotMatch(ui.renderEditor(true),/data-standalone-chrome/);
 const {AppDesigner}=await import('../../src/studio/designer/AppDesigner.js');const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');assert.equal(typeof AppDesigner,'function');const embedded=renderToStaticMarkup(createElement(AppDesigner,{embedded:true}));assert.match(embedded,/data-pd-widget="eval-score"/);assert.doesNotMatch(embedded,/data-standalone-chrome/);
});

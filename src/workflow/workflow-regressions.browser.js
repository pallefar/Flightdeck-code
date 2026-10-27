// Live UI regression: typed settings -> undo/redo -> local execution.
(async()=>{
 const results=[];window.workflowRegressionResults=results;
 const pause=()=>new Promise(r=>setTimeout(r,60));
 const q=label=>document.querySelector(`[aria-label="${label}"]`);
 const check=(value,message)=>{if(!value)throw new Error(message);};
 const click=async label=>{const b=[...document.querySelectorAll('.wf-editor button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);check(b,`Missing ${label}`);const disclosure=b.closest('details');if(disclosure)disclosure.open=true;const confirm=window.confirm;try{if(label==='New workflow'||label.endsWith(' template'))window.confirm=()=>true;b.click();}finally{window.confirm=confirm;}await pause();};
 const change=async(element,value)=>{check(element,'Missing input');const proto=element instanceof HTMLSelectElement?HTMLSelectElement.prototype:element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new Event(element instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();};
 const exportGraph=async()=>{await click('Export JSON');const g=JSON.parse(q('Draft JSON').value);await click('Close');return g;};
 const add=async type=>{[...document.querySelectorAll('.wf-palette-item')].find(b=>b.querySelector('code').textContent===type).click();await pause();};
 await click('New workflow');await change(q('Filter block category'),'All');await change(q('Search blocks'),'');await add('manual');await add('set');await add('output');
 await click('Select and drag Set fields');await click('Add field');
 await change(q('Field 1 name'),'approved');await change(q('Field 1 type'),'boolean');await change(q('Field 1 value'),'true');await click('Apply settings');
 let g=await exportGraph();const set=g.nodes.find(n=>n.type==='set');check(set.config.fields.approved===true,'Typed boolean did not save');
 await click('Undo');check(!q('Field 1 name'),'Undo did not synchronize typed rows');await click('Redo');check(q('Field 1 value').value==='true','Redo did not synchronize typed rows');
 await change(q('Field 1 type'),'number');await change(q('Field 1 value'),'invalid');await click('Apply settings');
 check(document.querySelector('.wf-inspector').innerText.includes('Invalid settings'),'Invalid form accepted');
 await change(q('Block display'),'compact');check(q('Field 1 value').value==='invalid'&&document.querySelector('.wf-inspector').innerText.includes('Invalid settings'),'Display discarded unsaved form/error');
 await change(q('Field 1 type'),'boolean');await change(q('Field 1 value'),'true');await click('Apply settings');
 g=await exportGraph();const manual=g.nodes.find(n=>n.type==='manual'),output=g.nodes.find(n=>n.type==='output');
 for(const [source,target] of [[manual.id,set.id],[set.id,output.id]]){await change(q('Connection source'),source);await change(q('Connection target'),target);await click('Connect blocks');}
 document.querySelector('.wf-run').open=true;await change(q('Local input JSON'),'{}');await click('Run locally');
 check(document.querySelector('.wf-run').innerText.includes('COMPLETED'),'Set run failed');check(JSON.parse(document.querySelector('.wf-run pre').textContent).approved===true,'Typed settings did not affect actual output');
 results.push({test:'typed boolean -> save -> undo/redo -> invalid form preserved across Compact -> connected local execution',output:JSON.parse(document.querySelector('.wf-run pre').textContent),status:'PASS'});
 await click('Condition routing template');await click('Select and drag Route request');await change(q('Condition field'),'ready');await change(q('Condition value JSON'),'true');await click('Apply settings');document.querySelector('.wf-run').open=true;
 for(const [value,target] of [[true,'node2'],[false,'node3']]){await change(q('Local input JSON'),JSON.stringify({ready:value}));await click('Run locally');const trace=document.querySelector('.wf-run').innerText;check(trace.includes('COMPLETED')&&trace.includes(`${target} · completed`),`Branch ${value} did not route`);}
 results.push({test:'typed condition field edit routes true/false in actual local execution',status:'PASS'});
 return results;
})()

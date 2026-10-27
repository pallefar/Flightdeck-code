// Run in the live /demo browser with Runtime.evaluate(awaitPromise:true).
// Native DOM DragEvent/DataTransfer exercise React handlers, not store mocks.
(async()=>{
 const results=[];window.workflowBrowserResults=results;
 const pause=()=>new Promise(resolve=>setTimeout(resolve,60));
 const q=label=>document.querySelector(`[aria-label="${label}"]`);
 const button=text=>[...document.querySelectorAll('.wf-editor button')].find(b=>b.textContent===text||b.getAttribute('aria-label')===text);
 const check=(condition,message)=>{if(!condition)throw new Error(message);};
 const click=async text=>{const b=button(text);check(b,`Missing button ${text}`);const disclosure=b.closest('details');if(disclosure)disclosure.open=true;b.click();await pause();};
 const change=async (element,value)=>{check(element,'Missing control');const proto=element instanceof HTMLSelectElement?HTMLSelectElement.prototype:element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new Event(element instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();};
 const exportGraph=async()=>{await click('Export JSON');const graph=JSON.parse(q('Draft JSON').value);await click('Close');return graph;};
 const nodes=()=>[...document.querySelectorAll('.wf-node')];
 const drop=async(type,raw=undefined,start=true)=>{
  const palette=[...document.querySelectorAll('.wf-palette-item')].find(b=>b.querySelector('code').textContent===type);
  check(palette,`Missing palette source ${type}`);const data=new DataTransfer();
  if(start)palette.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
  if(raw!==undefined)data.setData('application/x-flightdeck-workflow-block',raw);
  const viewport=q('Scrollable workflow canvas'),rect=viewport.getBoundingClientRect();
  // DragEvent client coordinates are integer CSS pixels in Chromium.
  const x=Math.round(rect.left+viewport.clientLeft+150),y=Math.round(rect.top+viewport.clientTop+90);
  const zoom=parseFloat(document.querySelector('.wf-stage').style.transform.slice(6));
  const expected={x:(x-rect.left-viewport.clientLeft+viewport.scrollLeft)/zoom,y:(y-rect.top-viewport.clientTop+viewport.scrollTop)/zoom};
  viewport.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data,clientX:x,clientY:y}));
  viewport.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data,clientX:x,clientY:y}));
  palette.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));await pause();return expected;
 };
 await click('Add or search blocks');await click('Reset zoom to 100 percent');
 check(q('Block display').value==='expanded','Initial display not Expanded');
 const before=await exportGraph(),expanded=nodes()[0].getBoundingClientRect(),path=document.querySelector('.wf-edges path').getAttribute('d');
 await change(q('Block display'),'compact');
 const compact=nodes()[0].getBoundingClientRect();
 check(expanded.width===220&&expanded.height===144&&compact.width===176&&compact.height===88,'Display dimensions differ');
 check(document.querySelector('.wf-edges path').getAttribute('d')!==path,'Edges did not adjust');
 check(JSON.stringify(await exportGraph())===JSON.stringify(before),'Display changed exported graph');
 check(button('Undo').disabled,'Display created undo entry');
 check(document.querySelectorAll('.wf-node .wf-ports button').length===9,'Compact lost ports');
 await change(q('Block display'),'expanded');results.push({test:'display and edges, export and undo preservation',expanded:{width:expanded.width,height:expanded.height},compact:{width:compact.width,height:compact.height},status:'PASS'});
 await change(q('Filter block category'),'Connectors / AI');
 check(document.querySelectorAll('.wf-palette-item').length===3,'Connector category must include HTTP, resource and LLM');
 await change(q('Search blocks'),'llm');check(document.querySelectorAll('.wf-palette-item').length===1,'Search incorrect');
 await change(q('Search blocks'),'');await change(q('Filter block category'),'All');results.push({test:'category and search filter',status:'PASS'});
 await click('New workflow');await click('Zoom out');await click('Zoom out');
 const viewport=q('Scrollable workflow canvas');viewport.scrollLeft=240;viewport.scrollTop=120;
 check(viewport.scrollLeft>0&&viewport.scrollTop>0,'Scrolled drop regression needs actual overflowing canvas at 1280×577');
 const expected=await drop('set');let graph=await exportGraph();
 check(graph.nodes.length===1&&Math.abs(graph.nodes[0].position.x-expected.x)<.001&&Math.abs(graph.nodes[0].position.y-expected.y)<.001,'Scrolled/zoomed drop coordinate incorrect');
 await click('Undo');check(nodes().length===0&&button('Undo').disabled,'Drop not single undo');await click('Redo');check(nodes().length===1,'Drop redo failed');
 results.push({test:'builtin HTML5 drop at scroll + 80% zoom, one-action undo/redo',position:graph.nodes[0].position,scroll:{x:viewport.scrollLeft,y:viewport.scrollTop},status:'PASS'});
 for(const invalid of ['foreign',JSON.stringify({type:'set',config:{fields:{a:1}}}),'set'.repeat(100)])await drop('set',invalid);
 await drop('set','set',false);check(nodes().length===1,'Invalid or foreign payload inserted a node');results.push({test:'malformed/config-bearing/oversized/foreign drops fail closed',status:'PASS'});
 await click('Custom block');await change(q('Custom block JSON'),JSON.stringify({id:'reviewedSet',label:'Reviewed reusable set',baseType:'set',defaults:{fields:{ready:true}},description:'Reviewed data defaults'}));
 document.querySelector('.wf-checkbox input').click();await pause();await click('Add reviewed reusable block');
 await change(q('Filter block category'),'Reusable blocks');check(document.querySelectorAll('.wf-palette-item').length===1,'Reusable category missing');
 await drop('reviewedSet');graph=await exportGraph();check(graph.nodes.length===2&&graph.nodes[1].type==='reviewedSet'&&graph.nodes[1].config.fields.ready===true,'Reusable drop lost defaults');
 results.push({test:'reviewed reusable palette category and HTML5 drop',status:'PASS'});
 window.workflowBrowserResults=results;return results;
})()

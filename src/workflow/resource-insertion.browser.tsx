import {createRoot} from 'react-dom/client';
import {createRef} from 'react';
import {flushSync} from 'react-dom';
import {WorkflowEditor,type WorkflowEditorHandle} from './WorkflowEditor';
import {StudioApp} from '../studio/StudioApp';
import type {Graph} from '../../packages/workflow/graph';
const ref={resourceId:'ba9acba0-752e-4c44-8c4a-603754b44a18',revision:2,functionId:'measure',parameters:{label:'reviewed literal'}};
function check(ok:unknown,message:string):asserts ok {if(!ok)throw new Error(message);}
const settle=()=>new Promise(resolve=>setTimeout(resolve,40));
function button(container:Element,text:string){const b=Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.trim()===text);check(b,`Missing button: ${text}`);return b;}
export async function editorInsertionBrowserTest(){
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);const handle=createRef<WorkflowEditorHandle>();let graph:Graph|undefined;
 flushSync(()=>root.render(<WorkflowEditor ref={handle} onChange={g=>{graph=g;}}/>));await settle();
 check(handle.current,'Editor insertion handle absent');
 button(container,'Add manual trigger').click();await settle();const before=JSON.stringify(graph);
 const outcome=flushSync(()=>handle.current!.insertResource(ref));await settle();
 check(outcome?.ok,'Insertion failed');check(graph?.nodes.length===2,'Configured node absent');
 check(container.querySelector('dialog')?.open,'Inserted node settings not focused');check(container.textContent?.includes('Connect this block before execution'),'Missing disconnected insertion notice');
 button(container,'Close ×').click();await settle();button(container,'Undo').click();await settle();check(JSON.stringify(graph)===before,'One undo did not restore exact prior graph');check(!container.textContent?.includes('Connect this block before execution'),'Undone insertion left a misleading connection notice');
 button(container,'Redo').click();await settle();check(graph?.nodes.length===2,'Redo failed');
 const snapshot=JSON.stringify(graph);const failedOutcome=flushSync(()=>handle.current!.insertResource({...ref,parameters:{headers:{accept:'json'}}}));await settle();
 check(!failedOutcome.ok,'Unsafe insertion accepted');check(JSON.stringify(graph)===snapshot,'Failed insertion changed graph');check(container.querySelector('[role=alert]'),'Failed insertion not visible');
 root.unmount();container.remove();return {oneUndo:true,redo:true,atomicFailure:true,focus:true};
}
export async function studioSelectionBrowserTest(defaultTransport=false){
 // DEVELOPMENT contract only: public test sentinel, never a production credential.
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);const calls:string[]=[];
 const fetcher:typeof fetch=async(input,init)=>{calls.push(`${init?.method??'GET'} ${String(input)}`);return fetch(input,init);};
 flushSync(()=>root.render(<StudioApp {...(defaultTransport?{}:{fetcher})}/>));await settle();
 const editor=container.querySelector('[aria-label="Workflow graph editor"]'),workspace=container.querySelector('[aria-label="Workflow workspace"]'),library=container.querySelector('[aria-label="Resource library"]');
 check(editor&&workspace&&library,'Retained Studio areas absent');
 const name=container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')!;
 function change(input:HTMLInputElement,value:string){const props=Object.keys(input).find(k=>k.startsWith('__reactProps$'));check(props,'React input handler absent');(input as unknown as Record<string,{onChange:(e:{target:{value:string}})=>void}>)[props]!.onChange({target:{value}});}
 flushSync(()=>change(name,'Retained prior graph'));await settle();
 const inputs=Array.from(container.querySelectorAll<HTMLInputElement>('.studio-connection input'));
 flushSync(()=>{change(inputs[0]!,'resource-insertion-public-development-token');change(inputs[1]!,'insertion-test');});await settle();
 button(container,'Save as new draft').click();await settle();await settle();
 const currentDraft=()=>Array.from(workspace.querySelectorAll('p')).find(p=>p.textContent?.startsWith('Current draft:'));
 const savedId=currentDraft()?.querySelector('code')?.textContent;check(savedId,'Development workspace save failed');
 button(container,'Resources').click();await settle();button(container,'Refresh resources').click();await settle();await settle();
 const row=container.querySelector<HTMLButtonElement>('.resource-row');check(row,'Real DEVELOPMENT route resource absent');row.click();await settle();await settle();
 const use=button(container,'Use resource function');check(use.disabled,'Invalid required parameter did not disable Use');
 const parameter=Array.from(library.querySelectorAll<HTMLInputElement>('input')).find(i=>i.parentElement?.textContent?.includes('label (required)'));check(parameter,'Schema-bound parameter absent');
 flushSync(()=>change(parameter,'reviewed literal'));await settle();check(!use.disabled,'Active valid resource still disabled');
 use.click();await settle();check(editor===container.querySelector('[aria-label="Workflow graph editor"]'),'Insertion remounted editor');check(workspace===container.querySelector('[aria-label="Workflow workspace"]'),'Insertion remounted workspace');check(library===container.querySelector('[aria-label="Resource library"]'),'Insertion remounted library');
 check(name.value==='Retained prior graph','Prior graph edit lost');check(currentDraft()?.querySelector('code')?.textContent===savedId,'Saved identity lost on insertion');check(workspace.textContent?.includes('Unsaved changes'),'Insertion did not mark saved draft dirty');check(editor.querySelectorAll('.wf-node').length===1,'Expected one inserted reference node');check(editor.querySelector('dialog')?.open&&editor.querySelector('dialog')?.contains(document.activeElement),'Selection did not focus settings');
 const functionDraft=editor.querySelector<HTMLInputElement>('[aria-label="Function ID"]')!;
 flushSync(()=>change(functionDraft,'unapplied-function-draft'));await settle();button(container,'Close ×').click();await settle();
 button(container,'Resources').click();await settle();button(container,'Workflow editor & demo').click();await settle();
 check(functionDraft===editor.querySelector('[aria-label="Function ID"]')&&functionDraft.value==='unapplied-function-draft','Unrelated library navigation discarded typed parameter draft');
 editor.querySelector('.wf-node')!.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await settle();check(functionDraft.value==='unapplied-function-draft','Reopening modal discarded typed parameter draft');
 check(!calls.some(c=>/execute|\/runs/.test(c)),'Selection automatically executed');
 button(container,'Close ×').click();await settle();button(container,'Undo').click();await settle();check(editor.querySelectorAll('.wf-node').length===0,'Selection required more than one undo');check(name.value==='Retained prior graph','Undo lost prior graph');
 button(container,'Redo').click();await settle();button(container,'Export JSON').click();await settle();
 const exported=JSON.parse(container.querySelector<HTMLTextAreaElement>('[aria-label="Draft JSON"]')!.value) as Graph;
 check(exported.nodes[0]?.type==='resource','Not a real resource block');check(Object.keys(exported.nodes[0]!.config).sort().join(',')==='functionId,resourceId,revision','Leaked endpoint config');
 check(JSON.stringify(exported.nodes[0]?.inputMappings)==='[{"target":"label","source":{"kind":"literal","value":"reviewed literal"}}]','Wrong literal mapping');
 button(container,'Close').click();await settle();
 const saveRevision=workspace.querySelector<HTMLButtonElement>('[aria-label="Save new revision"]')!;check(!saveRevision.disabled,'Saved identity no longer supports new revision');saveRevision.click();await settle();await settle();
 check(currentDraft()?.querySelector('code')?.textContent===savedId&&currentDraft()?.textContent?.includes('revision 2'),'Insertion saved under a new identity instead of prior draft revision');
 const persisted=await fetch(`/api/studio/workspaces/insertion-test/workflows/${savedId}`,{headers:{authorization:'Bearer resource-insertion-public-development-token'}}).then(r=>r.json());
 check(JSON.stringify(persisted.draft.graph)===JSON.stringify(exported),'Exact saved readback differs');
 const history=await fetch(`/api/studio/workspaces/insertion-test/workflows/${savedId}/runs`,{headers:{authorization:'Bearer resource-insertion-public-development-token'}}).then(r=>r.json());check(history.runs.length===0,'Automatic execution recorded');
 button(container,'Refresh drafts').click();await settle();await settle();container.querySelector<HTMLButtonElement>(`[aria-label="Load draft ${savedId}"]`)!.click();await settle();await settle();
 const loadedEditor=container.querySelector('[aria-label="Workflow graph editor"]')!;check(loadedEditor!==editor,'Expected explicit workspace load remount');check(loadedEditor.querySelectorAll('.wf-node').length===1,'Insertion replayed on workspace load');
 button(container,'Resources').click();await settle();
 const choose=library.querySelector<HTMLSelectElement>('[aria-label="Resource function"]')??Array.from(library.querySelectorAll('select')).find(s=>s.parentElement?.textContent?.startsWith('Resource function'))!;
 const chooseProps=Object.keys(choose).find(k=>k.startsWith('__reactProps$'))!;(choose as unknown as Record<string,{onChange:(e:{target:{value:string}})=>void}>)[chooseProps]!.onChange({target:{value:'empty'}});await settle();button(container,'Use resource function').click();await settle();check(loadedEditor.querySelectorAll('.wf-node').length===2,'Empty-parameter function not inserted');
 button(container,'Close ×').click();await settle();button(container,'Export JSON').click();await settle();const emptyExport=JSON.parse(container.querySelector<HTMLTextAreaElement>('[aria-label="Draft JSON"]')!.value) as Graph;check(JSON.stringify(emptyExport.nodes[1]?.inputMappings)==='[]','Empty function inherited incoming input');button(container,'Close').click();await settle();button(container,'Undo').click();await settle();check(loadedEditor.querySelectorAll('.wf-node').length===1,'Empty function insertion not atomic');
 button(container,'Import JSON').click();await settle();const importBox=container.querySelector<HTMLTextAreaElement>('[aria-label="Draft JSON"]')!;
 const fullGraph={...exported,nodes:[...exported.nodes,...Array.from({length:99},(_,i)=>({id:`capacity${i}`,type:'output',label:'Capacity fixture',position:{x:0,y:0},config:{}}))]};
 flushSync(()=>change(importBox as unknown as HTMLInputElement,JSON.stringify(fullGraph)));await settle();button(container,'Apply imported draft').click();await settle();
 button(container,'Resources').click();await settle();button(container,'Use resource function').click();await settle();
 check(!container.querySelector('[aria-label="Resources area"]')?.hasAttribute('hidden'),'Failed insertion hid library error');check(library.parentElement?.querySelector('[role="alert"]')?.textContent?.includes('100-block'),'Graph capacity failure lost in parent');check(loadedEditor.querySelectorAll('.wf-node').length===100,'Failed insertion changed full graph');
 button(container,'Undo').click();await settle();check(loadedEditor.querySelectorAll('.wf-node').length===1,'Failed insertion changed undo history');
 const revision=library.querySelector<HTMLSelectElement>('select')!;
 const revisionProps=Object.keys(revision).find(k=>k.startsWith('__reactProps$'))!;(revision as unknown as Record<string,{onChange:(e:{target:{value:string}})=>void}>)[revisionProps]!.onChange({target:{value:'1'}});await settle();check(button(container,'Use resource function').disabled,'Draft revision remained insertable');
 flushSync(()=>change(inputs[1]!,'foreign'));await settle();check(!library.querySelector('.resource-row'),'Wrong scope exposed old selected resource');check(loadedEditor.querySelectorAll('.wf-node').length===1,'Scope change replayed insertion');
 root.unmount();container.remove();return {retainedEditor:true,retainedWorkspace:true,retainedLibrary:true,retainedParameterDraft:true,savedIdentity:savedId,exactReadback:true,noReplayOnLoad:true,scopeMasked:true,draftDisabled:true,oneUndo:true,noExecution:true,graph:exported};
}

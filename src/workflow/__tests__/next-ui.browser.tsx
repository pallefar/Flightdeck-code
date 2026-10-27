// Browser-only DEVELOPMENT fixtures: received graphs, no vendor/host calls.
import {createRoot} from 'react-dom/client';
import {createRef} from 'react';
import {flushSync} from 'react-dom';
import {WorkflowEditor,createWorkflowTemplate,type WorkflowEditorHandle,type BlockRequest} from '../WorkflowEditor';
import type {Graph} from '../../../packages/workflow/graph';
const wait=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
function check(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
export function button(root:Element,text:string){const result=[...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===text||node.getAttribute('aria-label')===text);check(result,`Missing ${text}`);return result;}
function type(element:HTMLInputElement|HTMLTextAreaElement,value:string){Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));}
const light={bg:'#f3f6f7',surface:'#fff',surface2:'#f8fafb',ink:'#253d4b',muted:'#586e7c',line:'#d5dfe5',te:'#e98300',green:'#367956',amber:'#806620',red:'#aa3122'};
const dark={bg:'#0e1720',surface:'#17242f',surface2:'#182833',ink:'#eef2f7',muted:'#a7b6c3',line:'#304553',te:'#e98300',green:'#87c3a7',amber:'#c9b687',red:'#ff807d'};
export function fixture({theme='light',reveal=false,request,active=true,initialGraph=createWorkflowTemplate('branch')}:{theme?:'light'|'dark';reveal?:boolean;active?:boolean;initialGraph?:Graph;request?:(value:BlockRequest)=>Promise<unknown>}={}){
 const container=document.createElement('section');container.dataset.fixture='DEVELOPMENT workflow only';container.style.setProperty('--workflow-canvas-height','340px');document.body.append(container);
 function setTheme(theme:'light'|'dark'){for(const [key,value] of Object.entries(theme==='dark'?dark:light))container.style.setProperty(`--${key}`,value);container.style.colorScheme=theme;container.dataset.theme=theme;document.body.style.background=(theme==='dark'?dark:light).bg;}
 setTheme(theme);
 const root=createRoot(container),handle=createRef<WorkflowEditorHandle>();let graph=initialGraph;
 const render=()=>flushSync(()=>root.render(<WorkflowEditor initialGraph={initialGraph} active={active} ref={handle} buildReveal={reveal} onChange={next=>graph=next} {...(request?{onRequestBlock:request}:{})}/>));render();
 return {container,handle,setTheme,setActive(value:boolean){active=value;render();},get graph(){return graph;},dispose(){flushSync(()=>root.unmount());container.remove();}};
}
export async function wrapperReview(){
 const calls:BlockRequest[]=[];const wrapper={id:'reviewedNormalize',label:'Reviewed normalizer',baseType:'set',defaults:{fields:{ready:true}},description:'DEVELOPMENT reviewed declarative defaults'};
 const f=fixture({request:async value=>{calls.push(value);return wrapper;}}),c=f.container;await wait();
 try{
  button(c,'Add or search blocks').click();await wait();const opener=button(c,'Custom block');opener.focus();opener.click();await wait();
  const review=c.querySelector<HTMLDialogElement>('[aria-label="Review custom block"]');check(review&&review.matches(':modal'),'Wrapper review must open a native modal, not below the canvas');
  check(review.contains(document.activeElement),'Wrapper review did not receive focus');check(calls.length===0,'Opening local review called a model');
  check(review.textContent?.includes('Graph-local definition only'),'Wrapper approval is confused with library activation');
  const json=review.querySelector<HTMLTextAreaElement>('[aria-label="Custom block JSON"]')!;type(json,JSON.stringify(wrapper));await wait();
  check(review.querySelector('[aria-label="Wrapper preview"]')?.textContent?.includes('1 field · ready:boolean'),'Typed preview did not describe actual wrapper defaults');
  check(button(review,'Add reviewed reusable block').disabled,'Unchecked wrapper could be added');
  const before=JSON.stringify(f.graph);button(review,'Cancel').click();await wait();check(document.activeElement===opener,'Review close did not return focus');check(JSON.stringify(f.graph)===before,'Cancelling wrapper changed document');
  opener.click();await wait();check(c.querySelector<HTMLTextAreaElement>('[aria-label="Custom block JSON"]')!.value===JSON.stringify(wrapper),'Review lost retained definition draft');
  c.querySelector<HTMLInputElement>('.wf-checkbox input')!.click();await wait();button(c,'Add reviewed reusable block').click();await wait();
  check(f.graph.customBlocks.length===1&&f.graph.nodes.length===4,'Reviewed definition auto-inserted or failed');
  const card=[...c.querySelectorAll<HTMLButtonElement>('.wf-palette-item')].find(node=>node.querySelector('code')?.textContent==='reviewedNormalize')!;check(card.dataset.blockOrigin==='local-wrapper'&&card.textContent?.includes('0 in graph'),'Local wrapper provenance/usage absent');
  card.click();await wait();check(f.graph.nodes.at(-1)?.config.fields&&f.graph.nodes.at(-1)?.type==='reviewedNormalize','Insertion did not reuse actual defaults');
  button(c,'Undo').click();await wait();check(f.graph.nodes.length===4&&f.graph.customBlocks.length===1,'Insertion was not one undo');button(c,'Undo').click();await wait();check(JSON.stringify(f.graph)===before,'Definition did not undo independently');
  return {nativeReviewModal:true,focusReturn:true,retainedDraft:true,typedDefaultsPreview:true,checkboxRequired:true,localDefinitionOnly:true,oneUndoPerEdit:true,adapterOrModelCalls:calls.length};
 }finally{f.dispose();}
}
export async function premiumLayout(theme:'light'|'dark'='light'){
 const f=fixture({theme}),c=f.container;await wait();
 try{
  const editor=c.querySelector<HTMLElement>('.wf-editor')!,viewport=c.querySelector<HTMLElement>('.wf-scroll')!,toolbar=c.querySelector<HTMLElement>('.wf-toolbar')!;
  const chrome=viewport.getBoundingClientRect().top-editor.getBoundingClientRect().top;
  check(chrome<=(innerWidth>760?100:170),`Workspace chrome crowds canvas: ${chrome}px`);
  check(getComputedStyle(editor).color===getComputedStyle(toolbar.querySelector('input')!).color,'Workspace stopped inheriting host ink');
  check(getComputedStyle(c.querySelector('.wf-run-action')!).backgroundColor!=='rgb(233, 131, 0)','Solid orange run button loses contrast in inherited Night');
  const before=JSON.stringify(f.graph);button(c,'Add or search blocks').click();await wait();
  const composer=c.querySelector<HTMLElement>('.wf-palette')!,search=c.querySelector<HTMLInputElement>('[aria-label="Search blocks"]')!;
  check(search.getBoundingClientRect().top<innerHeight-44,'Block search is below the canvas instead of at hand');
  if(innerWidth>760){const rect=composer.getBoundingClientRect();check([...composer.querySelectorAll('.wf-palette-item')].filter(node=>{const bounds=node.getBoundingClientRect();return bounds.top>=rect.top&&bounds.bottom<=Math.min(rect.bottom,innerHeight);}).length>=2,'Wrapper help crowds actual builtin reuse out of the composer');}
  button(c,'Close block composer').click();await wait();check(composer.hidden,'Composer close did not retain/hide panel');check(document.activeElement===button(c,'Add or search blocks'),'Composer close stranded focus');
  check(JSON.stringify(f.graph)===before&&button(c,'Undo').disabled,'Composer/view controls mutated graph');
  button(c,'Add or search blocks').click();await wait();button(c,'Custom block').click();await wait();
  const dialog=c.querySelector<HTMLDialogElement>('.wf-wrapper-dialog')!,rect=dialog.getBoundingClientRect();
  check(rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight,'Review modal is outside viewport');
  check(getComputedStyle(dialog).color===getComputedStyle(editor).color,'Native dialog did not inherit host ink');
  check(document.documentElement.scrollWidth<=innerWidth,'Workflow causes horizontal document overflow');
  button(dialog,'Cancel').click();await wait();
  return {theme,width:innerWidth,height:innerHeight,chromePx:chrome,hostInk:getComputedStyle(editor).color,reviewContained:true,composerAtHand:true,closeReturnsFocus:true,viewHistoryUnchanged:true};
 }finally{f.dispose();}
}
export async function inactiveFit(){
 const f=fixture({active:false}),c=f.container;await wait();
 try{
  const stage=c.querySelector<HTMLElement>('.wf-stage')!,before=JSON.stringify(f.graph);
  check(stage.style.transform==='scale(1)','Inactive editor fitted before its first active view');
  check(button(c,'Fit to graph').disabled,'Inactive editor exposes an active Fit command');
  f.setActive(true);await wait();await wait();check(stage.style.transform!=='scale(1)','First active view failed to fit');
  button(c,'Zoom in').click();await wait();const zoom=stage.style.transform;
  f.setActive(false);await wait();f.setActive(true);await wait();check(stage.style.transform===zoom,'Returning to the retained editor reset zoom');
  check(JSON.stringify(f.graph)===before&&button(c,'Undo').disabled,'Active-only Fit changed graph or history');
  return {inactiveNoFit:true,firstActiveFit:true,returnZoomRetained:true,graphAndHistoryUnchanged:true};
 }finally{f.dispose();}
}
Object.assign(window,{nextUiTests:{fixture,wrapperReview,premiumLayout,inactiveFit,button,type,wait}});

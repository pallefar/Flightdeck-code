import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {isValidElement,type ReactElement} from 'react';
import {StudioApp} from '../StudioApp';
import {StudioDesignerApp} from '../StudioDesignerApp';
import {StudioController} from '../controller';
import {ConnectionSettingsPanel} from '../ConnectionSettingsPanel';
import {AnthropicConnectionSetup,type AnthropicConnectionSetupProps} from '../AnthropicConnectionSetup';
import {ReusePicker} from '../ReusePicker';

// Controlled hook dispatcher over the real composition/StudioSession closures.
// Not a React DOM mount, native dialog/focus/keyboard test, provider or browser.
const hooks=vi.hoisted(()=>{
 type Cell={value:unknown;deps?:readonly unknown[];cleanup?:()=>void};
 type Scope={cells:Cell[];cursor:number;effects:(()=>void)[]};
 const scopes=new Map<string,Scope>();let active:Scope|null=null;
 const slot=(initial:()=>unknown)=>{if(!active)throw Error('No controlled render scope');const index=active.cursor++;return active.cells[index]??(active.cells[index]={value:initial()});};
 const changed=(old:readonly unknown[]|undefined,next:readonly unknown[]|undefined)=>!old||!next||old.length!==next.length||old.some((v,i)=>!Object.is(v,next[i]));
 return {
  useState(initial:unknown){const cell=slot(()=>typeof initial==='function'?(initial as ()=>unknown)():initial);return [cell.value,(next:unknown)=>{cell.value=typeof next==='function'?(next as (value:unknown)=>unknown)(cell.value):next;}];},
  useRef(initial:unknown){return slot(()=>({current:initial})).value;},
  useMemo(factory:()=>unknown,deps:readonly unknown[]){const cell=slot(()=>undefined);if(changed(cell.deps,deps)){cell.value=factory();cell.deps=deps;}return cell.value;},
  useCallback(callback:unknown,deps:readonly unknown[]){const cell=slot(()=>undefined);if(changed(cell.deps,deps)){cell.value=callback;cell.deps=deps;}return cell.value;},
  useLayoutEffect(effect:()=>void|(()=>void),deps?:readonly unknown[]){const scope=active!,cell=slot(()=>undefined);if(changed(cell.deps,deps)){if(deps)cell.deps=deps;else delete cell.deps;scope.effects.push(()=>{cell.cleanup?.();const cleanup=effect();if(typeof cleanup==='function')cell.cleanup=cleanup;else delete cell.cleanup;});}},
  useEffect(){/* passive DOM/media/navigation lifecycle is outside this proof */},
  useSyncExternalStore(_subscribe:unknown,get:()=>unknown){return get();},
  render<T>(name:string,render:()=>T):T{const scope=scopes.get(name)??{cells:[],cursor:0,effects:[]};scopes.set(name,scope);scope.cursor=0;scope.effects=[];active=scope;let result:T;try{result=render();}finally{active=null;}for(const effect of scope.effects)effect();return result;},
  reset(){for(const scope of scopes.values())for(const cell of scope.cells)cell.cleanup?.();scopes.clear();},
 };
});
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),useState:hooks.useState,useRef:hooks.useRef,useMemo:hooks.useMemo,useCallback:hooks.useCallback,useLayoutEffect:hooks.useLayoutEffect,useEffect:hooks.useEffect,useSyncExternalStore:hooks.useSyncExternalStore}));
vi.mock('../../voice',async importOriginal=>({...await importOriginal<typeof import('../../voice')>(),useVoice:()=>({enabled:false,stop:()=>{},speak:()=>{}})}));
type Element=ReactElement<Record<string,unknown>>;
function elements(value:unknown):Element[]{
 if(Array.isArray(value))return value.flatMap(elements);
 if(!isValidElement(value))return [];
 const node=value as Element;return [node,...elements(node.props.children)];
}
function one(tree:unknown,predicate:(node:Element)=>boolean){const matches=elements(tree).filter(predicate);expect(matches).toHaveLength(1);return matches[0]!;}
function prop<T>(node:Element,name:string){return node.props[name] as T;}
function invoke(node:Element,name:string,event:unknown={}){return prop<(event:unknown)=>unknown>(node,name)(event);}
function byClass(tree:unknown,name:string){return one(tree,n=>String(n.props.className??'').split(/\s+/).includes(name));}
function make(fetcher:typeof fetch){
 const controller=new StudioController(fetcher);
 const dispatch=vi.spyOn(controller,'submit').mockResolvedValue(undefined);
 let tree:Element;
 function render(){
  const composed=hooks.render('designer',()=>StudioDesignerApp({controller,fetcher}));
  expect(composed.type).toBe(StudioApp);
  const provider=hooks.render('app',()=>StudioApp(composed.props));
  const session=provider.props.children as Element;
  tree=hooks.render('session',()=>(session.type as (props:unknown)=>Element)(session.props));
  return {tree,composed};
 }
 render();
 const form=()=>one(tree,n=>n.type==='form'&&elements(n.props.children).some(c=>c.type==='textarea'));
 const textarea=()=>one(tree,n=>n.type==='textarea'&&'placeholder'in n.props);
 const settings=()=>one(tree,n=>n.type===ConnectionSettingsPanel);
 const setup=()=>one(tree,n=>n.type===AnthropicConnectionSetup);
 return {controller,dispatch,render,get tree(){return tree;},form,textarea,settings,setup,
  type(text:string){invoke(textarea(),'onChange',{target:{value:text}});render();},
  submit(){invoke(form(),'onSubmit',{preventDefault(){}});render();},
  close(){prop<()=>void>(settings(),'onClose')();render();},
 };
}
beforeEach(()=>vi.stubGlobal('document',{visibilityState:'visible',addEventListener:vi.fn(),removeEventListener:vi.fn()}));
afterEach(()=>{hooks.reset();vi.unstubAllGlobals();});

it.each(['form','primary','shortcut'] as const)('default nonempty %s entry opens private masked setup with the exact unsent prompt and zero generation/effects',kind=>{
 const fetcher=vi.fn<typeof fetch>(async()=>{throw Error('No transport authorized in this controlled regression');});
 const app=make(fetcher);
 expect(app.settings().props.open).toBe(false);
 app.type('Exact unsent request \u2014 review first');
 // Typing deliberately revokes any prior send review. Snapshot after that
 // intentional invalidation so opening setup itself must preserve exact state.
 const before=app.controller.getState(),workbench=app.controller.workbench.getState();
 if(kind==='form')app.submit();
 if(kind==='primary'){const button=one(byClass(app.tree,'studio-send-row'),n=>n.type==='button'&&n.props['data-primary-action']==='true');expect(button.props.disabled).not.toBe(true);invoke(button,'onClick');app.render();}
 if(kind==='shortcut'){invoke(app.textarea(),'onKeyDown',{ctrlKey:true,metaKey:false,key:'Enter',preventDefault(){}});app.render();}
 expect(app.settings().props.open).toBe(true);
 expect(app.settings().props.focusSelector).toBe('[aria-label="Operator token"]');
 expect(app.setup().props.active).toBe(true);
 const operator=one(app.tree,n=>n.type==='input'&&n.props['aria-label']==='Operator token');expect(operator.props.type).toBe('password');
 expect(app.textarea().props.value).toBe('Exact unsent request \u2014 review first');
 expect(app.controller.getState()).toBe(before);expect(app.controller.workbench.getState()).toBe(workbench);
 app.close();expect(app.settings().props.open).toBe(false);
 expect(app.textarea().props.value).toBe('Exact unsent request \u2014 review first');
 expect(app.dispatch).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it('does not open or generate on an empty form submission',()=>{
 const fetcher=vi.fn<typeof fetch>();const app=make(fetcher);app.submit();
 expect(app.settings().props.open).toBe(false);expect(app.dispatch).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it('confirmed setup metadata never selects or submits; the retained request next guides explicit selection',()=>{
 const fetcher=vi.fn<typeof fetch>();const app=make(fetcher);app.type('Retain after setup');app.submit();
 invoke(one(app.tree,n=>n.type==='input'&&n.props['aria-label']==='Operator token'),'onChange',{target:{value:'NONSECRET_CONTROLLED_OPERATOR'}});app.render();
 // Parent callback boundary only: no key is entered and no save/provider is invoked.
 prop<AnthropicConnectionSetupProps['onChanged']>(app.setup(),'onChanged')({status:'configured',available:true,persistence:'server-memory',model:'unit-anthropic',revision:'00000000-0000-4000-8000-000000000001'});
 app.render();app.close();app.submit();
 expect(app.settings().props.focusSelector).toBe('[aria-label="Model connection"]');
 expect(one(app.tree,n=>n.type==='select'&&n.props['aria-label']==='Model connection').props.value).toBe('');
 expect(app.textarea().props.value).toBe('Retain after setup');expect(app.dispatch).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it('only an explicit configuration check, choice, close and fresh submit dispatches the reviewed selected destination',async()=>{
 const ids=['codex-chatgpt','flightdeck','local','anthropic'];
 const dto={
  '/api/studio/health':{ok:true,selectedId:null,model:null,modelStatus:'unselected',verification:'not-probed'},
  '/api/studio/model-connections':{selectedId:null,connections:ids.map(id=>({id,label:`Unit ${id}`,model:id==='local'?'unit-local':null,status:id==='local'?'configured':'unavailable',verification:'not-probed'}))},
  '/api/studio/projects/project-a/skills':{projectId:'project-a',skillSourceState:'empty',skillSources:[]},
 };
 const fetcher=vi.fn<typeof fetch>(async url=>{const key=String(url) as keyof typeof dto;if(!(key in dto))throw Error('No generation/provider route authorized');return new Response(JSON.stringify(dto[key]),{headers:{'content-type':'application/json'}});});
 const app=make(fetcher);app.type('Exact selected local request');app.submit();
 invoke(one(app.tree,n=>n.type==='input'&&n.props['aria-label']==='Operator token'),'onChange',{target:{value:'NONSECRET_CONTROLLED_OPERATOR'}});app.render();
 invoke(one(app.tree,n=>n.type==='input'&&n.props.placeholder==='For project skills and page suggestions'),'onChange',{target:{value:'project-a'}});app.render();
 expect(fetcher).not.toHaveBeenCalled();expect(app.dispatch).not.toHaveBeenCalled();
 const check=one(app.tree,n=>n.type==='button'&&n.props.children==='Check connection & project skills');
 await invoke(check,'onClick');app.render();
 expect(fetcher.mock.calls.map(call=>String(call[0]))).toEqual(Object.keys(dto));
 expect(app.dispatch).not.toHaveBeenCalled();
 const select=one(app.tree,n=>n.type==='select'&&n.props['aria-label']==='Model connection');expect(select.props.value).toBe('');
 invoke(select,'onChange',{target:{value:'local'}});app.render();expect(app.dispatch).not.toHaveBeenCalled();
 app.close();expect(app.setup().props.active).toBe(false);
 const create=one(byClass(app.tree,'studio-send-row'),n=>n.type==='button'&&n.props.type==='submit');
 expect(create.props.hidden).toBe(false);expect(create.props.disabled).toBe(false);
 expect(app.dispatch).not.toHaveBeenCalled();app.submit();
 expect(app.dispatch).toHaveBeenCalledExactlyOnceWith({connectionId:'local',prompt:'Exact selected local request',projectId:'project-a'},'NONSECRET_CONTROLLED_OPERATOR');
 expect(fetcher).toHaveBeenCalledTimes(3);expect(app.settings().props.open).toBe(false);
});
it('real composition retains its editor element and callable creation handle across ordinary rerenders',()=>{
 const app=make(vi.fn<typeof fetch>());const first=app.render().composed.props.pageWorkspace!;
 const requestCreatePage=vi.fn();const receive=prop<(handle:unknown)=>void>(first.workspace as Element,'onCreatePageRequestHandle');
 receive({requestCreatePage});first.createPage();expect(requestCreatePage).toHaveBeenCalledTimes(1);
 const second=app.render().composed.props.pageWorkspace!;expect(second).toBe(first);expect(second.workspace).toBe(first.workspace);
 expect(prop<boolean>(second.workspace as Element,'embedded')).toBe(true);
 receive(null);expect(()=>second.createPage()).toThrow('Page designer request is unavailable.');
 expect(app.dispatch).not.toHaveBeenCalled();
});
it('the real reuse entry remains active and outside setup at idle without selecting a model',()=>{
 const app=make(vi.fn<typeof fetch>());const picker=one(app.tree,n=>n.type===ReusePicker);
 expect(picker.props.active).toBe(true);expect(app.settings().props.open).toBe(false);
 app.type('Reuse does not authorize a send');app.submit();expect(one(app.tree,n=>n.type===ReusePicker).props.active).toBe(false);
 expect(app.dispatch).not.toHaveBeenCalled();
});

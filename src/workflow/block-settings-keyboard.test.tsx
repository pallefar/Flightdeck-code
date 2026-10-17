import {createElement,type KeyboardEvent} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {WorkflowEditor,createWorkflowTemplate} from './WorkflowEditor';

// Observe the real rendered dialog's listener without a browser/DOM dependency.
// DOM layout/focus below are bounded unit fixtures, not native-keyboard evidence.
const captured=vi.hoisted(()=>({dialog:undefined as undefined|{onKeyDown?:(event:KeyboardEvent<HTMLDialogElement>)=>void}}));
vi.mock('react/jsx-runtime',async importOriginal=>{
 const runtime=await importOriginal<typeof import('react/jsx-runtime')>();
 function observe(type:unknown,props:unknown){if(type==='dialog'&&(props as {id?:string}).id==='workflow-inspector')captured.dialog=props as NonNullable<typeof captured.dialog>;}
 return {...runtime,
  jsx:(...args:Parameters<typeof runtime.jsx>)=>{observe(args[0],args[1]);return runtime.jsx(...args);},
  jsxs:(...args:Parameters<typeof runtime.jsxs>)=>{observe(args[0],args[1]);return runtime.jsxs(...args);},
 };
});
vi.mock('react/jsx-dev-runtime',async importOriginal=>{
 const runtime=await importOriginal<typeof import('react/jsx-dev-runtime')>();
 return {...runtime,jsxDEV:(...args:Parameters<typeof runtime.jsxDEV>)=>{
  const [type,props]=args;if(type==='dialog'&&(props as {id?:string}).id==='workflow-inspector')captured.dialog=props as NonNullable<typeof captured.dialog>;
  return runtime.jsxDEV(...args);
 }};
});

type Control={tabIndex:number;disabled:boolean;hidden:boolean;inert:boolean;rects:number;visibility:string;focus:ReturnType<typeof vi.fn>;matches:(selector:string)=>boolean;closest:(selector:string)=>object|null;getClientRects:()=>object[]};
function fixture(){
 const document={activeElement:null as Control|null};
 vi.stubGlobal('document',document);
 vi.stubGlobal('getComputedStyle',(element:Control)=>({visibility:element.visibility}));
 function control(options:Partial<Pick<Control,'tabIndex'|'disabled'|'hidden'|'inert'|'rects'|'visibility'>>={}):Control{
  const element:Control={tabIndex:0,disabled:false,hidden:false,inert:false,rects:1,visibility:'visible',...options,
   focus:vi.fn(()=>{document.activeElement=element;}),
   matches:selector=>selector===':disabled'&&element.disabled,
   closest:selector=>(selector.includes('[hidden]')&&element.hidden||selector.includes('[inert]')&&element.inert)?{}:null,
   getClientRects:()=>Array.from({length:element.rects},()=>({})),
  };return element;
 }
 const first=control(),last=control();
 const dialog={open:true,querySelectorAll:vi.fn(()=>[first,last])};
 function press(shiftKey=false,key='Tab'){
  const event={key,code:key,shiftKey,currentTarget:dialog,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
  captured.dialog?.onKeyDown?.(event as unknown as KeyboardEvent<HTMLDialogElement>);
  return event;
 }
 return {document,control,first,last,dialog,press};
}

beforeEach(()=>{
 captured.dialog=undefined;
 renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:createWorkflowTemplate('branch')}));
 expect(captured.dialog,'the actual retained inspector dialog was rendered').toBeDefined();
});
afterEach(()=>vi.unstubAllGlobals());

describe('open block settings Tab boundaries',()=>{
 it.each([false,true])('prevents boundary Tab and wraps focus (shift=%s)',shift=>{
  const {document,first,last,press}=fixture();
  document.activeElement=shift?first:last;
  expect(press(shift).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(shift?last:first);
  expect((shift?last:first).focus).toHaveBeenCalledOnce();
 });
 it.each([
  ['disabled',{disabled:true}],['negative tab index',{tabIndex:-1}],
  ['no layout boxes',{rects:0}],['hidden ancestor',{hidden:true}],['inert ancestor',{inert:true}],
  ['invisible',{visibility:'hidden'}],['collapsed',{visibility:'collapse'}],
 ] as const)('excludes %s controls from both live boundaries',(_name,options)=>{
  const {document,control,first,last,dialog,press}=fixture();
  const before=control(options),after=control(options);
  dialog.querySelectorAll.mockReturnValue([before,first,last,after]);
  for(const shift of [false,true]){
   document.activeElement=shift?first:last;
   expect(press(shift).defaultPrevented).toBe(true);
   expect(document.activeElement).toBe(shift?last:first);
  }
  expect(before.focus).not.toHaveBeenCalled();expect(after.focus).not.toHaveBeenCalled();
 });
 it('keeps the only remaining enabled control focused in either direction',()=>{
  const {document,first,dialog,press}=fixture();dialog.querySelectorAll.mockReturnValue([first]);
  for(const shift of [false,true]){
   document.activeElement=first;expect(press(shift).defaultPrevented).toBe(true);expect(document.activeElement).toBe(first);
  }
  expect(first.focus).toHaveBeenCalledTimes(2);
 });
 it('prevents Tab escape when no tabbable controls remain',()=>{
  const {document,first,last,dialog,press}=fixture();first.disabled=true;last.disabled=true;
  for(const shift of [false,true])expect(press(shift).defaultPrevented).toBe(true);
  expect(document.activeElement).toBeNull();expect(first.focus).not.toHaveBeenCalled();expect(last.focus).not.toHaveBeenCalled();
 });
 it('leaves inline inspector Tab traversal native',()=>{
  const {document,first,last,dialog,press}=fixture();dialog.open=false;
  for(const shift of [false,true]){
   document.activeElement=shift?first:last;expect(press(shift).defaultPrevented).toBe(false);expect(document.activeElement).toBe(shift?first:last);
  }
  expect(dialog.querySelectorAll).not.toHaveBeenCalled();expect(first.focus).not.toHaveBeenCalled();expect(last.focus).not.toHaveBeenCalled();
 });
 it('does not trap the retained inactive editor',()=>{
  renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:createWorkflowTemplate('branch'),active:false}));
  const {document,first,last,dialog,press}=fixture();
  for(const shift of [false,true]){
   document.activeElement=shift?first:last;expect(press(shift).defaultPrevented).toBe(false);expect(document.activeElement).toBe(shift?first:last);
  }
  expect(dialog.querySelectorAll).not.toHaveBeenCalled();expect(first.focus).not.toHaveBeenCalled();expect(last.focus).not.toHaveBeenCalled();
 });
 it('leaves interior Tab traversal native',()=>{
  const {document,control,first,last,dialog,press}=fixture(),middle=control();dialog.querySelectorAll.mockReturnValue([first,middle,last]);
  document.activeElement=middle;
  for(const shift of [false,true])expect(press(shift).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(middle);expect(first.focus).not.toHaveBeenCalled();expect(last.focus).not.toHaveBeenCalled();
 });
 it('does not intercept Escape or settings editing keys',()=>{
  const {document,first,last,dialog,press}=fixture();document.activeElement=last;
  for(const key of ['Escape','ArrowRight','Enter'])expect(press(false,key).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(last);expect(dialog.querySelectorAll).not.toHaveBeenCalled();expect(first.focus).not.toHaveBeenCalled();
 });
});

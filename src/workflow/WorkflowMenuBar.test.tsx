import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import * as appMenus from './WorkflowMenuBar';
import type {WorkflowAppMenu} from './WorkflowMenuBar';

const menus:WorkflowAppMenu[]=[
 {id:'file',label:'File',items:[{id:'new',label:'New workflow',onSelect:()=>{}}]},
 {id:'view',label:'View',items:[{id:'canvas',label:'Canvas',onSelect:()=>{}}]},
];

// No DOM test environment is installed. These exercise real SSR and the same
// pure keyboard/placement helpers used by the component, not mocked React hooks.
// Mounted focus, native key synthesis and actual geometry remain browser QA.
describe('editor-local menu placement',()=>{
 const editor={left:40,top:120,right:400,bottom:580};
 const viewport={left:0,top:0,right:390,bottom:600};
 const trigger={left:320,top:145,right:380,bottom:177};
 it('clamps horizontally inside both the editor and viewport at mobile sizes',()=>{
  const result=appMenus.placeWorkflowMenu({editor,viewport,trigger,width:286,height:180});
  expect(result.left).toBe(60);
  expect(result.width).toBe(286);
  expect(result.top).toBe(60);
  expect(result.placement).toBe('below');
  expect(editor.left+result.left+result.width).toBeLessThanOrEqual(viewport.right-4);
 });
 it.each([360,390])('bounds long menus with internal scrolling at %spx',width=>{
  const bounds={left:0,top:10,right:width,bottom:300};
  const result=appMenus.placeWorkflowMenu({editor:bounds,viewport:{...bounds,top:0,bottom:360},trigger:{left:width-50,top:15,right:width-4,bottom:47},width:500,height:900});
  expect(result.width).toBe(width-8);
  expect(result.left).toBe(4);
  expect(result.top+result.maxHeight).toBeLessThanOrEqual(286);
  expect(result.maxHeight).toBeLessThan(900);
 });
 it('flips above when the trigger is near the visible bottom',()=>{
  const result=appMenus.placeWorkflowMenu({editor,viewport,trigger:{left:90,top:520,right:150,bottom:552},width:286,height:180});
  expect(result.placement).toBe('above');
  expect(result.top).toBe(217);
  expect(result.maxHeight).toBeGreaterThanOrEqual(180);
 });
 it('uses only the viewport-visible part of a scrolled editor',()=>{
  const result=appMenus.placeWorkflowMenu({editor:{left:20,top:-300,right:380,bottom:560},viewport:{left:0,top:30,right:360,bottom:400},trigger:{left:25,top:40,right:70,bottom:72},width:286,height:900});
  expect(result.top).toBe(375);
  expect(result.maxHeight).toBe(321);
  expect(result.left).toBeGreaterThanOrEqual(4);
  expect(result.left+result.width).toBeLessThanOrEqual(336);
 });
 it('never returns negative dimensions when the editor is not visible',()=>{
  const result=appMenus.placeWorkflowMenu({editor:{left:0,top:800,right:360,bottom:900},viewport:{left:0,top:0,right:360,bottom:600},trigger:{left:10,top:805,right:50,bottom:837},width:286,height:180});
  expect(result.width).toBeGreaterThanOrEqual(0);
  expect(result.maxHeight).toBe(0);
  expect(result.top).toBeGreaterThanOrEqual(0);
 });
 it('ships scoped host-token CSS with absolute scrollable panels, not viewport-fixed overlays',()=>{
  const html=renderToStaticMarkup(createElement(appMenus.WorkflowMenuBar,{menus}));
  expect(html).toContain('<style>');
  expect(html).toContain('.wf-app-menu-panel');
  expect(html).toContain('position:absolute');
  expect(html).toContain('overflow-y:auto');
  expect(html).toContain('--wf-panel');
  expect(html).not.toContain('position:fixed');
  expect(html).not.toContain('overflow:hidden');
 });
});

describe('WorkflowMenuBar semantics',()=>{
 it('renders named application menu triggers with scoped menu relationships',()=>{
  expect(appMenus.WorkflowMenuBar).toBeTypeOf('function');
  const html=renderToStaticMarkup(createElement(appMenus.WorkflowMenuBar,{menus}));
  expect(html).toContain('role="menubar" aria-label="Workflow application menu"');
  for(const label of ['File','View']){
   expect(html).toMatch(new RegExp(`role="menuitem"[^>]*aria-label="${label} menu"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"`));
  }
  const controls=[...html.matchAll(/aria-controls="([^"]+)"/g)].map(match=>match[1]!);
  expect(controls).toHaveLength(2);
  for(const id of controls)expect(html).toContain(`id="${id}" role="menu"`);
 });
 it('renders checked, disabled and grouped command entries without invoking them',()=>{
  let calls=0;
  const view:WorkflowAppMenu={id:'view',label:'View',items:[
   {id:'canvas',label:'Canvas',kind:'radio',checked:true,group:'Layout',onSelect:()=>{calls++;}},
   {id:'stacked',label:'Stacked',kind:'radio',checked:false,group:'Layout',onSelect:()=>{calls++;}},
   {id:'palette',label:'Block palette',kind:'checkbox',checked:true,group:'Panels',onSelect:()=>{calls++;}},
   {id:'fit',label:'Fit to workflow',disabled:true,group:'Zoom',onSelect:()=>{calls++;}},
  ]};
  const html=renderToStaticMarkup(createElement(appMenus.WorkflowMenuBar,{menus:[view]}));
  expect(html).toMatch(/role="menuitemradio"[^>]*aria-checked="true"[^>]*>[\s\S]*?Canvas/);
  expect(html).toMatch(/role="menuitemradio"[^>]*aria-checked="false"[^>]*>[\s\S]*?Stacked/);
  expect(html).toMatch(/role="menuitemcheckbox"[^>]*aria-checked="true"[^>]*>[\s\S]*?Block palette/);
  expect(html).toMatch(/role="menuitem"[^>]*aria-disabled="true"[^>]*disabled=""[^>]*>[\s\S]*?Fit to workflow/);
  for(const group of ['Layout','Panels','Zoom'])expect(html).toContain(`>${group}</div>`);
  expect(html.match(/>Layout<\/div>/g)).toHaveLength(1);
  expect(calls).toBe(0);
 });
 it('uses unique instance IDs and removes inactive triggers from tab order',()=>{
  const html=renderToStaticMarkup(createElement('div',{},
   createElement(appMenus.WorkflowMenuBar,{menus}),createElement(appMenus.WorkflowMenuBar,{menus,active:false})));
  const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]!);
  expect(new Set(ids).size).toBe(ids.length);
  const inactive=html.slice(html.lastIndexOf('class="wf-app-menus"'));
  expect(inactive.match(/aria-haspopup="menu"[^>]*disabled="" tabindex="-1"/g)).toHaveLength(2);
  expect(inactive).not.toContain('aria-expanded="true"');
 });
});

describe('application menu keyboard transitions',()=>{
 const closed={menuId:null,itemId:null};
 it.each([
  ['ArrowRight','file','view'],['ArrowRight','view','file'],
  ['ArrowLeft','file','view'],['ArrowLeft','view','file'],
  ['Home','view','file'],['End','file','view'],
 ])('%s moves between persistent top triggers from %s to %s',(key,from,to)=>{
  const result=appMenus.workflowMenuKey(menus,closed,{menuId:from},key);
  expect(result).toEqual({state:closed,preventDefault:true,focus:{menuId:to},activation:null});
 });
 it.each(['ArrowDown','ArrowUp','Enter',' '])('%s opens the current top menu without a command',key=>{
  const result=appMenus.workflowMenuKey(menus,closed,{menuId:'view'},key);
  expect(result).toEqual({state:{menuId:'view',itemId:'canvas'},preventDefault:true,focus:{menuId:'view',itemId:'canvas'},activation:null});
 });
 const entries:WorkflowAppMenu[]=[{id:'file',label:'File',items:[
  {id:'disabled-first',label:'Disabled',disabled:true,onSelect:()=>{throw Error('navigation invoked action');}},
  {id:'first',label:'First',onSelect:()=>{throw Error('navigation invoked action');}},
  {id:'disabled-middle',label:'Disabled',disabled:true,onSelect:()=>{}},
  {id:'last',label:'Last',onSelect:()=>{}},
  {id:'disabled-last',label:'Disabled',disabled:true,onSelect:()=>{}},
 ]},menus[1]!];
 it.each([
  ['ArrowDown','first','last'],['ArrowDown','last','first'],
  ['ArrowUp','first','last'],['ArrowUp','last','first'],
  ['Home','last','first'],['End','first','last'],
 ])('%s navigates only enabled entries from %s to %s',(key,from,to)=>{
  const result=appMenus.workflowMenuKey(entries,{menuId:'file',itemId:from},{menuId:'file',itemId:from},key);
  expect(result).toEqual({state:{menuId:'file',itemId:to},preventDefault:true,focus:{menuId:'file',itemId:to},activation:null});
 });
 it.each([['ArrowDown','first'],['ArrowUp','last']])('%s opens at enabled %s',(key,id)=>{
  expect(appMenus.workflowMenuKey(entries,closed,{menuId:'file'},key).state).toEqual({menuId:'file',itemId:id});
 });
 it.each(['ArrowLeft','ArrowRight'])('%s switches an already open menu without activation',key=>{
  const result=appMenus.workflowMenuKey(entries,{menuId:'file',itemId:'last'},{menuId:'file',itemId:'last'},key);
  expect(result).toEqual({state:{menuId:'view',itemId:'canvas'},preventDefault:true,focus:{menuId:'view',itemId:'canvas'},activation:null});
 });
 it('Escape closes and returns the actual current menu opener',()=>{
  const result=appMenus.workflowMenuKey(entries,{menuId:'view',itemId:'canvas'},{menuId:'view',itemId:'canvas'},'Escape');
  expect(result).toEqual({state:closed,preventDefault:true,focus:{menuId:'view'},activation:null});
 });
 it('Tab closes while preserving native traversal rather than trapping',()=>{
  const result=appMenus.workflowMenuKey(entries,{menuId:'file',itemId:'last'},{menuId:'file',itemId:'last'},'Tab');
  expect(result).toEqual({state:closed,preventDefault:false,focus:{menuId:'file'},activation:null});
 });
 it('empty or entirely disabled menus remain dismissible without actions',()=>{
  for(const items of [[],[entries[0]!.items[0]!]]){
   const empty=[{id:'empty',label:'Empty',items}];
   const result=appMenus.workflowMenuKey(empty,closed,{menuId:'empty'},'ArrowDown');
   expect(result.state).toEqual({menuId:'empty',itemId:null});
   expect(result.activation).toBeNull();
   expect(appMenus.workflowMenuKey(empty,result.state,{menuId:'empty'},'Escape').state).toEqual(closed);
  }
 });
 it.each(['Enter',' ','ArrowDown','ArrowRight','Escape','Tab'])('inactive %s closes without requesting focus or activation',key=>{
  const result=appMenus.workflowMenuKey(entries,{menuId:'file',itemId:'first'},{menuId:'file',itemId:'first'},key,false);
  expect(result).toEqual({state:closed,preventDefault:false,focus:null,activation:null});
 });
 it('unrelated keys and missing menus do not change focus or invoke commands',()=>{
  for(const source of [{menuId:'file'},{menuId:'missing'}]){
   expect(appMenus.workflowMenuKey(entries,closed,source,'x')).toEqual({state:closed,preventDefault:false,focus:null,activation:null});
  }
 });
});

describe('command activation handoff',()=>{
 it.each(['Enter',' '])('%s requests activation once but never invokes from keyboard-state calculation',key=>{
  let calls=0;
  const commands:WorkflowAppMenu[]=[{id:'file',label:'File',items:[{id:'open',label:'Open',onSelect:()=>{calls++;}}]}];
  const open={menuId:'file',itemId:'open'},target={menuId:'file',itemId:'open'};
  const result=appMenus.workflowMenuKey(commands,open,target,key);
  expect(result.preventDefault).toBe(true);
  expect(result.activation).toEqual(target);
  expect(calls).toBe(0);
  expect(appMenus.workflowMenuKey(commands,open,target,key,true,true).activation).toBeNull();
  expect(appMenus.workflowMenuKey(commands,{menuId:null,itemId:null},target,key).activation).toBeNull();
 });
 it('consumes the open menu then focuses its persistent trigger before a single callback',()=>{
  const log:string[]=[];
  let state:appMenus.WorkflowMenuState={menuId:'file',itemId:'open'};
  let focused='item';
  const commands:WorkflowAppMenu[]=[{id:'file',label:'File',items:[{id:'open',label:'Open',onSelect:()=>{
   expect(state).toEqual({menuId:null,itemId:null});expect(focused).toBe('file');log.push('callback');
  }}]}];
  const read=()=>({menus:commands,state,active:true});
  const close=()=>{state={menuId:null,itemId:null};log.push('close');};
  const focus=(menuId:string)=>{focused=menuId;log.push('focus');return true;};
  expect(appMenus.activateWorkflowMenuItem(read,{menuId:'file',itemId:'open'},close,focus)).toBe(true);
  expect(appMenus.activateWorkflowMenuItem(read,{menuId:'file',itemId:'open'},close,focus)).toBe(false);
  expect(log).toEqual(['close','focus','callback']);
 });
 it.each(['inactive','disabled','missing','closed','wrong-menu','no-opener','deactivated-on-focus','disabled-on-focus'])('refuses %s activation',condition=>{
  let active=condition!=='inactive',calls=0;
  const item={id:'open',label:'Open',disabled:condition==='disabled',onSelect:()=>{calls++;}};
  let state:appMenus.WorkflowMenuState=condition==='closed'?{menuId:null,itemId:null}:{menuId:'file',itemId:'open'};
  const commands:WorkflowAppMenu[]=[{id:'file',label:'File',items:[item]}];
  const read=()=>({menus:commands,state,active});
  const target={menuId:condition==='wrong-menu'?'view':'file',itemId:condition==='missing'?'unknown':'open'};
  const close=()=>{state={menuId:null,itemId:null};};
  const focus=()=>{if(condition==='deactivated-on-focus')active=false;if(condition==='disabled-on-focus')item.disabled=true;return condition!=='no-opener';};
  expect(appMenus.activateWorkflowMenuItem(read,target,close,focus)).toBe(false);
  expect(calls).toBe(0);
 });
});

describe('pointer and retained-state decisions',()=>{
 const closed={menuId:null,itemId:null};
 const open={menuId:'file',itemId:'new'};
 it('click opens a top menu, another click closes it and hover alone never opens',()=>{
  expect(appMenus.workflowMenuPointer(menus,closed,{menuId:'file'},'hover').state).toEqual(closed);
  const opened=appMenus.workflowMenuPointer(menus,closed,{menuId:'file'},'click');
  expect(opened.state).toEqual(open);
  expect(opened.activation).toBeNull();
  expect(appMenus.workflowMenuPointer(menus,opened.state,{menuId:'file'},'click')).toEqual({state:closed,preventDefault:false,focus:{menuId:'file'},activation:null});
 });
 it('switches an open menu on pointer hover without invoking commands',()=>{
  const result=appMenus.workflowMenuPointer(menus,open,{menuId:'view'},'hover');
  expect(result.state).toEqual({menuId:'view',itemId:'canvas'});
  expect(result.focus).toEqual({menuId:'view',itemId:'canvas'});
  expect(result.activation).toBeNull();
 });
 it('hover only focuses an enabled entry; click alone requests activation',()=>{
  const target={menuId:'file',itemId:'new'};
  expect(appMenus.workflowMenuPointer(menus,open,target,'hover')).toEqual({state:open,preventDefault:false,focus:target,activation:null});
  expect(appMenus.workflowMenuPointer(menus,open,target,'click').activation).toEqual(target);
  const disabled=[{...menus[0]!,items:[{...menus[0]!.items[0]!,disabled:true}]}];
  expect(appMenus.workflowMenuPointer(disabled,open,target,'hover').focus).toBeNull();
  expect(appMenus.workflowMenuPointer(disabled,open,target,'click').activation).toBeNull();
 });
 it.each(['outside','focus-out'] as const)('%s closes without stealing external focus',phase=>{
  expect(appMenus.workflowMenuPointer(menus,open,null,phase)).toEqual({state:closed,preventDefault:false,focus:null,activation:null});
 });
 it('inactive input closes but cannot request focus or callbacks',()=>{
  expect(appMenus.workflowMenuPointer(menus,open,{menuId:'file',itemId:'new'},'click',false)).toEqual({state:closed,preventDefault:false,focus:null,activation:null});
 });
 it('ordinary fresh menu objects retain the exact state while inactive or removed menus close',()=>{
  const rerender=menus.map(menu=>({...menu,items:menu.items.map(item=>({...item}))}));
  expect(appMenus.reconcileWorkflowMenuState(rerender,open,true)).toBe(open);
  expect(appMenus.reconcileWorkflowMenuState(rerender,open,false)).toEqual(closed);
  expect(appMenus.reconcileWorkflowMenuState([],open,true)).toEqual(closed);
 });
});

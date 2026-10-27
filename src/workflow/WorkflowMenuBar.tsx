import {Fragment,useEffect,useId,useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import {flushSync} from 'react-dom';

export interface WorkflowMenuItem {
 id:string;
 label:string;
 kind?:'action'|'checkbox'|'radio';
 checked?:boolean;
 disabled?:boolean;
 group?:string;
 onSelect:()=>void;
}
export interface WorkflowAppMenu {id:string;label:string;items:WorkflowMenuItem[]}
export interface WorkflowMenuBarProps {menus:WorkflowAppMenu[];active?:boolean}

export interface WorkflowMenuState {menuId:string|null;itemId:string|null}
export interface WorkflowMenuTarget {menuId:string;itemId?:string}
export interface WorkflowMenuKeyResult {
 state:WorkflowMenuState;
 preventDefault:boolean;
 focus:WorkflowMenuTarget|null;
 activation:WorkflowMenuTarget|null;
}
const CLOSED:WorkflowMenuState={menuId:null,itemId:null};

/** The component and Node unit tests share these real navigation decisions. */
export function workflowMenuKey(menus:WorkflowAppMenu[],state:WorkflowMenuState,source:WorkflowMenuTarget,key:string,active=true,repeat=false):WorkflowMenuKeyResult {
 const unchanged:WorkflowMenuKeyResult={state,preventDefault:false,focus:null,activation:null};
 if(!active)return {...unchanged,state:CLOSED};
 const index=menus.findIndex(menu=>menu.id===source.menuId),menu=menus[index];
 if(!menu)return unchanged;
 if((key==='Escape'||key==='Tab')&&state.menuId!==null){
  return {state:CLOSED,preventDefault:key==='Escape',focus:{menuId:state.menuId},activation:null};
 }
 const enabled=menu.items.filter(item=>!item.disabled);
 if(key==='Enter'||key===' '){
  if(repeat)return {...unchanged,preventDefault:true};
  if(source.itemId!==undefined){
   const item=enabled.find(item=>item.id===source.itemId);
   return {...unchanged,preventDefault:true,activation:state.menuId===menu.id&&item?source:null};
  }
 }
 if(key==='ArrowLeft'||key==='ArrowRight'||(source.itemId===undefined&&(key==='Home'||key==='End'))){
  const nextIndex=key==='Home'?0:key==='End'?menus.length-1:(index+(key==='ArrowRight'?1:-1)+menus.length)%menus.length;
  const target=menus[nextIndex]!;
  if(state.menuId!==null){
   const item=target.items.find(item=>!item.disabled);
   return {state:{menuId:target.id,itemId:item?.id??null},preventDefault:true,
    focus:item?{menuId:target.id,itemId:item.id}:{menuId:target.id},activation:null};
  }
  return {state,preventDefault:true,focus:{menuId:target.id},activation:null};
 }
 if(source.itemId===undefined&&['ArrowDown','ArrowUp','Enter',' '].includes(key)){
  const item=key==='ArrowUp'?enabled.at(-1):enabled[0];
  return {state:{menuId:menu.id,itemId:item?.id??null},preventDefault:true,
   focus:item?{menuId:menu.id,itemId:item.id}:{menuId:menu.id},activation:null};
 }
 if(source.itemId!==undefined&&state.menuId===menu.id&&['ArrowDown','ArrowUp','Home','End'].includes(key)){
  const itemIndex=enabled.findIndex(item=>item.id===source.itemId);
  const nextIndex=key==='Home'?0:key==='End'?enabled.length-1:
   itemIndex<0?(key==='ArrowUp'?enabled.length-1:0):(itemIndex+(key==='ArrowDown'?1:-1)+enabled.length)%enabled.length;
  const item=enabled[nextIndex];
  return {state:{menuId:menu.id,itemId:item?.id??null},preventDefault:true,
   focus:item?{menuId:menu.id,itemId:item.id}:{menuId:menu.id},activation:null};
 }
 return unchanged;
}

export function reconcileWorkflowMenuState(menus:WorkflowAppMenu[],state:WorkflowMenuState,active=true):WorkflowMenuState {
 if(!active||state.menuId!==null&&!menus.some(menu=>menu.id===state.menuId))return CLOSED;
 return state;
}

export function workflowMenuPointer(menus:WorkflowAppMenu[],state:WorkflowMenuState,target:WorkflowMenuTarget|null,phase:'click'|'hover'|'outside'|'focus-out',active=true):WorkflowMenuKeyResult {
 const unchanged:WorkflowMenuKeyResult={state,preventDefault:false,focus:null,activation:null};
 if(!active||phase==='outside'||phase==='focus-out')return {...unchanged,state:CLOSED};
 if(!target)return unchanged;
 const menu=menus.find(menu=>menu.id===target.menuId);
 if(!menu)return unchanged;
 if(target.itemId!==undefined){
  const item=menu.items.find(item=>item.id===target.itemId);
  if(state.menuId!==menu.id||!item||item.disabled)return unchanged;
  return phase==='click'?{...unchanged,activation:target}:
   {...unchanged,state:{menuId:menu.id,itemId:item.id},focus:target};
 }
 if(phase==='hover'&&(state.menuId===null||state.menuId===menu.id))return unchanged;
 if(phase==='click'&&state.menuId===menu.id)return {...unchanged,state:CLOSED,focus:target};
 return {...workflowMenuKey(menus,state,target,'ArrowDown'),preventDefault:false};
}

export interface WorkflowMenuActivationContext {menus:WorkflowAppMenu[];state:WorkflowMenuState;active:boolean}

/** Consume first, restore a persistent opener, then hand control to the app. */
export function activateWorkflowMenuItem(read:()=>WorkflowMenuActivationContext,target:WorkflowMenuTarget,close:()=>void,focusTrigger:(menuId:string)=>boolean):boolean {
 const before=read(),item=before.menus.find(menu=>menu.id===target.menuId)?.items.find(item=>item.id===target.itemId);
 if(!before.active||before.state.menuId!==target.menuId||!item||item.disabled)return false;
 close();
 if(!focusTrigger(target.menuId))return false;
 // Focus/flush can synchronously change parent props. Never invoke a stale command.
 const after=read(),current=after.menus.find(menu=>menu.id===target.menuId)?.items.find(item=>item.id===target.itemId);
 if(!after.active||!current||current.disabled)return false;
 current.onSelect();
 return true;
}

export interface WorkflowMenuRect {left:number;top:number;right:number;bottom:number}
export interface WorkflowMenuPlacementInput {
 editor:WorkflowMenuRect;viewport:WorkflowMenuRect;trigger:WorkflowMenuRect;width:number;height:number;
}

/** Return editor-local coordinates in the intersection with the visible viewport. */
export function placeWorkflowMenu({editor,viewport,trigger,width,height}:WorkflowMenuPlacementInput){
 const left=Math.max(editor.left+4,viewport.left+4),right=Math.max(left,Math.min(editor.right-4,viewport.right-4));
 const top=Math.max(editor.top+4,viewport.top+4),bottom=Math.max(top,Math.min(editor.bottom-4,viewport.bottom-4));
 const boundedWidth=Math.max(0,Math.min(width,right-left));
 const x=Math.max(left,Math.min(trigger.left,right-boundedWidth));
 const belowStart=Math.max(top,Math.min(trigger.bottom+3,bottom)),aboveEnd=Math.max(top,Math.min(trigger.top-3,bottom));
 const below=bottom-belowStart,above=aboveEnd-top;
 const placement=below<Math.min(height,460)&&above>below?'above':'below';
 const maxHeight=Math.max(0,Math.min(460,placement==='above'?above:below));
 const y=placement==='above'?aboveEnd-Math.min(height,maxHeight):belowStart;
 return {left:x-editor.left,top:y-editor.top,width:boundedWidth,maxHeight,placement};
}

const MENU_CSS=`
.wf-editor:has(.wf-app-menus){position:relative}
.wf-app-menus{position:static;display:flex;align-items:center;gap:1px;flex:none;min-width:0;font-family:Arial,Helvetica,sans-serif;color:var(--wf-text,var(--ink,#253d4b))}
.wf-app-menus,.wf-app-menus *{box-sizing:border-box}
.wf-app-menus.wf-app-menus .wf-app-menu-trigger{flex:none;min-height:30px;padding:4px 9px;border:1px solid transparent;border-radius:4px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:20px;white-space:nowrap;cursor:pointer}
.wf-app-menus.wf-app-menus .wf-app-menu-trigger:is(:hover,[aria-expanded="true"]){border-color:var(--wf-border,var(--line,#d5dfe5));background:var(--wf-surface2,var(--surface2,#f8fafb))}
.wf-app-menus .wf-app-menu-panel{position:absolute;z-index:30;left:0;top:100%;width:286px;min-width:0;max-width:calc(100% - 8px);max-height:460px;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:4px;border:1px solid var(--wf-border,var(--line,#d5dfe5));border-radius:6px;background:var(--wf-panel,var(--surface,#fff));color:var(--wf-text,var(--ink,#253d4b));box-shadow:0 10px 30px color-mix(in srgb,var(--wf-text,var(--ink,#253d4b)) 20%,transparent)}
.wf-app-menus .wf-app-menu-panel[hidden]{display:none!important}
.wf-app-menus.wf-app-menus .wf-app-menu-entry{display:flex;align-items:center;gap:8px;width:100%;min-width:0;min-height:32px;padding:5px 9px;border:1px solid transparent;border-radius:3px;background:transparent;color:inherit;text-align:left;font:inherit;font-size:12px;line-height:20px;white-space:normal;overflow-wrap:anywhere;cursor:pointer}
.wf-app-menus.wf-app-menus .wf-app-menu-entry:not(:disabled):is(:hover,:focus){outline:0;border-color:var(--wf-accent,var(--te,#e98300));background:color-mix(in srgb,var(--wf-accent,var(--te,#e98300)) 12%,var(--wf-panel,var(--surface,#fff)))}
.wf-app-menus .wf-app-menu-trigger:focus-visible{outline:2px solid var(--wf-accent,var(--te,#e98300));outline-offset:1px}
.wf-app-menus.wf-app-menus button:disabled{opacity:.45;cursor:not-allowed}
.wf-app-menus .wf-app-menu-mark{display:inline-grid;place-items:center;width:14px;flex:none;font-size:12px;color:var(--wf-accent,var(--te,#e98300))}
.wf-app-menus .wf-app-menu-heading{margin:4px 4px 2px;padding:5px 5px 2px;border-top:1px solid var(--wf-border,var(--line,#d5dfe5));color:var(--wf-muted,var(--muted,#586e7c));font-size:10px;font-weight:700;letter-spacing:.04em}
.wf-app-menus .wf-app-menu-heading:first-child{border-top:0;margin-top:0}
@media(max-width:420px){.wf-app-menus.wf-app-menus .wf-app-menu-trigger{padding-inline:7px}}
`;

/** Render inside a bounded .wf-editor. Menus/items need stable, sibling-unique IDs. */
export function WorkflowMenuBar({menus,active=true}:WorkflowMenuBarProps){
 const scope=useId(),root=useRef<HTMLDivElement>(null);
 const [state,setState]=useState<WorkflowMenuState>(CLOSED),stateRef=useRef(state);
 const [tabStop,setTabStop]=useState(menus[0]?.id);
 const props=useRef({menus,active});props.current={menus,active};
 const triggers=useRef(new Map<string,HTMLButtonElement>()),items=useRef(new Map<string,HTMLButtonElement>());
 const panels=useRef(new Map<string,HTMLDivElement>());
 function focus(target:WorkflowMenuTarget){
  const element=target.itemId===undefined?triggers.current.get(target.menuId):items.current.get(JSON.stringify([target.menuId,target.itemId]));
  element?.focus({preventScroll:true});
  if(element&&target.itemId!==undefined){
   const panel=panels.current.get(target.menuId);
   if(panel){
    const entryRect=element.getBoundingClientRect(),panelRect=panel.getBoundingClientRect();
    const top=panelRect.top+panel.clientTop,bottom=top+panel.clientHeight;
    if(entryRect.top<top)panel.scrollTop+=entryRect.top-top;
    else if(entryRect.bottom>bottom)panel.scrollTop+=entryRect.bottom-bottom;
   }
  }
  return Boolean(element&&element.ownerDocument.activeElement===element);
 }
 function close(){
  stateRef.current=CLOSED;
  flushSync(()=>setState(CLOSED));
 }
 function select(target:WorkflowMenuTarget){
  activateWorkflowMenuItem(()=>({...props.current,state:stateRef.current}),target,close,menuId=>focus({menuId}));
 }
 function apply(result:WorkflowMenuKeyResult){
  if(result.activation){select(result.activation);return;}
  stateRef.current=result.state;
  flushSync(()=>{setState(result.state);if(result.focus)setTabStop(result.focus.menuId);});
  if(result.focus)focus(result.focus);
 }
 function key(event:KeyboardEvent<HTMLElement>,source:WorkflowMenuTarget){
  const result=workflowMenuKey(menus,stateRef.current,source,event.key,active,event.repeat);
  if(result.preventDefault)event.preventDefault();
  apply(result);
 }
 function pointer(target:WorkflowMenuTarget|null,phase:'click'|'hover'|'outside'|'focus-out'){
  apply(workflowMenuPointer(props.current.menus,stateRef.current,target,phase,props.current.active));
 }
 useLayoutEffect(()=>{
  const next=reconcileWorkflowMenuState(menus,stateRef.current,active);
  if(next!==stateRef.current){stateRef.current=next;setState(next);}
 },[menus,active]);
 useEffect(()=>{
  if(!active||state.menuId===null)return;
  const element=root.current,document=element?.ownerDocument;
  if(!element||!document)return;
  const outside=(event:Event)=>{
   if(event.target&&!element.contains(event.target as Node))pointer(null,event.type==='pointerdown'?'outside':'focus-out');
  };
  const blur=()=>pointer(null,'focus-out');
  let listening=true;
  const focusOut=()=>queueMicrotask(()=>{
   // Allow a synchronous in-menu focus handoff to finish before interpreting a
   // null relatedTarget (including an explicit blur to document.body).
   if(listening&&!element.contains(document.activeElement))pointer(null,'focus-out');
  });
  document.addEventListener('pointerdown',outside,true);
  document.addEventListener('focusin',outside,true);
  element.addEventListener('focusout',focusOut);
  document.defaultView?.addEventListener('blur',blur);
  return ()=>{
   listening=false;
   document.removeEventListener('pointerdown',outside,true);
   document.removeEventListener('focusin',outside,true);
   element.removeEventListener('focusout',focusOut);
   document.defaultView?.removeEventListener('blur',blur);
  };
 },[active,state.menuId]);
 useLayoutEffect(()=>{
  if(!active||state.menuId===null)return;
  const element=root.current,trigger=triggers.current.get(state.menuId),panel=panels.current.get(state.menuId);
  const editor=element?.closest<HTMLElement>('.wf-editor')??element?.parentElement;
  const view=element?.ownerDocument.defaultView;
  if(!editor||!trigger||!panel||!view)return;
  let frame=0;
  const measure=()=>{
   frame=0;
   if(panel.hidden)return;
   const editorRect=editor.getBoundingClientRect(),triggerRect=trigger.getBoundingClientRect(),visual=view.visualViewport;
   const viewport={left:visual?.offsetLeft??0,top:visual?.offsetTop??0,
    right:(visual?.offsetLeft??0)+(visual?.width??view.innerWidth),bottom:(visual?.offsetTop??0)+(visual?.height??view.innerHeight)};
   const input={editor:editorRect,trigger:triggerRect,viewport,width:286,height:0};
   panel.style.width=`${placeWorkflowMenu(input).width}px`;
   const placement=placeWorkflowMenu({...input,height:panel.scrollHeight+panel.offsetHeight-panel.clientHeight});
   // Account for an intermediate positioned toolbar without using a portal or
   // viewport-fixed coordinates; bounds still belong to this editor instance.
   const parent=panel.offsetParent as HTMLElement|null,parentRect=parent?.getBoundingClientRect();
   const left=editorRect.left+placement.left-(parentRect?.left??0)-(parent?.clientLeft??0)+(parent?.scrollLeft??0);
   const top=editorRect.top+placement.top-(parentRect?.top??0)-(parent?.clientTop??0)+(parent?.scrollTop??0);
   panel.style.left=`${left}px`;panel.style.top=`${top}px`;panel.style.maxHeight=`${placement.maxHeight}px`;
   panel.dataset.placement=placement.placement;
  };
  const schedule=()=>{if(!frame)frame=view.requestAnimationFrame(measure);};
  measure();
  view.addEventListener('resize',schedule);
  view.addEventListener('scroll',schedule,true);
  view.visualViewport?.addEventListener('resize',schedule);
  view.visualViewport?.addEventListener('scroll',schedule);
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
  observer?.observe(editor);observer?.observe(trigger);
  return ()=>{
   if(frame)view.cancelAnimationFrame(frame);
   observer?.disconnect();
   view.removeEventListener('resize',schedule);
   view.removeEventListener('scroll',schedule,true);
   view.visualViewport?.removeEventListener('resize',schedule);
   view.visualViewport?.removeEventListener('scroll',schedule);
  };
 },[active,state.menuId,menus]);
 return <><style>{MENU_CSS}</style><div ref={root} className="wf-app-menus" role="menubar" aria-label="Workflow application menu">
  {menus.map((menu,index)=><button key={menu.id} ref={element=>{if(element)triggers.current.set(menu.id,element);else triggers.current.delete(menu.id);}}
   type="button" className="wf-app-menu-trigger" id={`${scope}-trigger-${index}`} role="menuitem"
   aria-label={`${menu.label} menu`} aria-haspopup="menu" aria-expanded={active&&state.menuId===menu.id} aria-controls={`${scope}-menu-${index}`}
   disabled={!active} tabIndex={active&&menu.id===(menus.some(menu=>menu.id===tabStop)?tabStop:menus[0]?.id)?0:-1}
   onFocus={()=>setTabStop(menu.id)} onKeyDown={event=>key(event,{menuId:menu.id})}
   onClick={()=>pointer({menuId:menu.id},'click')} onPointerEnter={event=>{if(event.pointerType!=='touch')pointer({menuId:menu.id},'hover');}}>{menu.label}</button>)}
  {menus.map((menu,index)=><div key={menu.id} ref={element=>{if(element)panels.current.set(menu.id,element);else panels.current.delete(menu.id);}}
   className="wf-app-menu-panel" id={`${scope}-menu-${index}`} role="menu" aria-labelledby={`${scope}-trigger-${index}`} hidden={!active||state.menuId!==menu.id} tabIndex={-1}>
   {menu.items.map((item,itemIndex)=><Fragment key={item.id}>
    {item.group&&item.group!==menu.items[itemIndex-1]?.group&&<div className="wf-app-menu-heading" role="presentation">{item.group}</div>}
    <button ref={element=>{const id=JSON.stringify([menu.id,item.id]);if(element)items.current.set(id,element);else items.current.delete(id);}}
     className="wf-app-menu-entry" type="button" role={item.kind==='radio'?'menuitemradio':item.kind==='checkbox'?'menuitemcheckbox':'menuitem'}
     aria-checked={item.kind==='radio'||item.kind==='checkbox'?Boolean(item.checked):undefined}
     aria-disabled={Boolean(item.disabled)} disabled={!active||item.disabled} tabIndex={-1}
     onKeyDown={event=>key(event,{menuId:menu.id,itemId:item.id})}
     onClick={()=>pointer({menuId:menu.id,itemId:item.id},'click')}
     onPointerEnter={event=>{if(event.pointerType!=='touch')pointer({menuId:menu.id,itemId:item.id},'hover');}}>
     <span className="wf-app-menu-mark" aria-hidden="true">{item.checked?(item.kind==='radio'?'●':item.kind==='checkbox'?'✓':''):''}</span>
     <span>{item.label}</span>
    </button>
   </Fragment>)}
  </div>)}
 </div></>;
}

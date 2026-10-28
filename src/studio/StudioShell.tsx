import {useEffect,useRef,useState,type KeyboardEvent,type ReactNode} from 'react';
import './StudioShell.css';

export type StudioAppearance='inherit'|'day'|'night';
export type StudioArea='studio'|'process'|'editor'|'ide'|'pages'|'resources'|'approvals';
const BUILDERS:ReadonlyArray<{id:StudioArea;label:string}>=[
 {id:'studio',label:'AI builder'},
 {id:'process',label:'Process discovery'},
 {id:'editor',label:'Workflow builder'},
 {id:'ide',label:'Sub-app IDE'},
 {id:'pages',label:'Pages'},
];
const AREA_LABELS:Record<StudioArea,string>={studio:'AI builder',process:'Process discovery',editor:'Workflow builder',ide:'Sub-app IDE',pages:'Pages',resources:'Resources',approvals:'Approvals'};

/** Standalone Studio chrome, not an OS sidebar, identity source or permission grant.
 * The parent owns routing and the same retained children remain in one stable slot.
 */
export function StudioShell({area,onNavigate,onConnectionSettings,onAnthropicSetup,project,model,graphName,children,motion=true,voiceTools,appearance='inherit',onAppearance,onMotion}:{area:StudioArea;onNavigate:(area:StudioArea)=>void;onConnectionSettings:()=>void;onAnthropicSetup?:()=>void;project:string;model:string;graphName:string;children:ReactNode;motion?:boolean;voiceTools?:ReactNode;appearance?:StudioAppearance;onAppearance?:(appearance:StudioAppearance)=>void;onMotion?:()=>void}){
 const main=useRef<HTMLElement>(null),tools=useRef<HTMLDetailsElement>(null),sidebar=useRef<HTMLElement>(null),navigationToggle=useRef<HTMLButtonElement>(null);
 const navigationDialog=useRef<HTMLDialogElement>(null),navigationOpener=useRef<HTMLButtonElement|null>(null),navigationActive=useRef(false);
 const [navigationOpen,setNavigationOpen]=useState(false);
 function closeNavigation(returnTarget:HTMLElement|null=navigationOpener.current){
  if(!navigationActive.current)return;
  navigationActive.current=false;
  if(navigationDialog.current?.open)navigationDialog.current.close();
  setNavigationOpen(false);
  returnTarget?.focus({preventScroll:true});
 }
 useEffect(()=>{
  if(typeof window==='undefined'||!window.matchMedia)return;
  const query=window.matchMedia('(max-width:850px)');
  function syncNavigation(){
   if(!query.matches&&navigationActive.current){
    closeNavigation(sidebar.current?.querySelector<HTMLElement>('[aria-current="page"]')??tools.current?.querySelector<HTMLElement>('summary')??main.current);
   }else if(query.matches&&sidebar.current?.contains(document.activeElement))navigationToggle.current?.focus({preventScroll:true});
  }
  syncNavigation();query.addEventListener('change',syncNavigation);
  return()=>query.removeEventListener('change',syncNavigation);
 },[]);
 // Parent-owned handoffs can change area without a shell button. Release
 // modality before the parent's own workspace-focus effect runs.
 useEffect(()=>{closeNavigation(main.current);},[area]);
 function openNavigation(opener:HTMLButtonElement){
  const dialog=navigationDialog.current;if(!dialog||dialog.open)return;
  navigationOpener.current=opener;
  dialog.showModal();navigationActive.current=true;setNavigationOpen(true);
  (dialog.querySelector<HTMLButtonElement>('[aria-current="page"]')??dialog.querySelector<HTMLButtonElement>('button'))?.focus({preventScroll:true});
 }
 function navigationKeyDown(event:KeyboardEvent<HTMLDialogElement>){
  if(event.key!=='Tab'||!event.currentTarget.open)return;
  const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex]')).filter(control=>{
   const visibility=getComputedStyle(control).visibility;
   return control.tabIndex>=0&&!control.matches(':disabled')&&!control.closest('[hidden],[inert]')&&control.getClientRects().length>0&&visibility!=='hidden'&&visibility!=='collapse';
  });
  const first=controls[0],last=controls.at(-1),active=document.activeElement;
  if(!first||!last){event.preventDefault();return;}
  if(!controls.includes(active as HTMLElement)||active===(event.shiftKey?first:last)){
   event.preventDefault();(event.shiftKey?last:first).focus({preventScroll:true});
  }
 }
 function disclosureKeyDown(event:KeyboardEvent<HTMLDetailsElement>){
  if(event.key!=='Escape'||!event.currentTarget.open)return;
  event.preventDefault();event.stopPropagation();event.currentTarget.open=false;
  event.currentTarget.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});
 }
 function navigate(next:StudioArea){if(tools.current)tools.current.open=false;closeNavigation();onNavigate(next);}
 function navigation(label:string){return <nav aria-label={label} className="studio-navigation">{BUILDERS.map(item=><button key={item.id} type="button" aria-pressed={area===item.id} aria-current={area===item.id?'page':undefined} onClick={()=>navigate(item.id)}>{item.label}</button>)}</nav>;}
 return <div className="studio studio-shell" data-motion={motion?'on':'off'} data-appearance={appearance} data-area={area} aria-label="Flightdeck Studio workspace">
  <a className="studio-skip" href="#studio-main" onClick={event=>{event.preventDefault();main.current?.focus();}}>Skip to workspace</a>
  <aside className="studio-sidebar" ref={sidebar}>
   <div className="studio-brand"><strong>Flightdeck<span>Studio</span></strong></div>
   <span className="studio-workspace-label">WORKSPACE</span>
   {navigation('Studio areas')}
   <div className="studio-sidebar-bottom"><span>Authoring workspace</span><small>Drafts require review</small></div>
  </aside>
  <header className="studio-appbar">
   <button type="button" ref={navigationToggle} className="studio-navigation-toggle" aria-label="Open Studio navigation" aria-expanded={navigationOpen} aria-controls="studio-navigation-dialog" onClick={event=>openNavigation(event.currentTarget)}><span aria-hidden="true">☰</span></button>
   <div className="studio-breadcrumbs" aria-label="Studio breadcrumb"><span>Studio</span><span aria-hidden="true">/</span><strong>{AREA_LABELS[area]}</strong></div>
   <div className="studio-shell-actions">{voiceTools}{onAnthropicSetup&&<button type="button" className="studio-ai-setup-button" onClick={onAnthropicSetup}>Add Anthropic API key</button>}<button type="button" className="studio-settings-button" onClick={onConnectionSettings}>Connection settings</button>
    <details ref={tools} className="studio-tools" aria-label="Studio tools" onKeyDown={disclosureKeyDown}><summary>Tools</summary><div className="studio-tools-panel"><span className="studio-tool-label">Review &amp; reuse</span>{(['resources','approvals'] as const).map(id=><button key={id} type="button" aria-current={area===id?'page':undefined} onClick={()=>navigate(id)}>{AREA_LABELS[id]}</button>)}{onMotion&&<button type="button" className="studio-motion" aria-pressed={motion} onClick={onMotion}>Motion {motion?'on':'off'}</button>}{onAppearance&&<label className="studio-appearance">Appearance<select aria-label="Studio appearance" value={appearance} onChange={event=>onAppearance(event.target.value as StudioAppearance)}><option value="inherit">Follow host</option><option value="day">Day</option><option value="night">Night</option></select></label>}</div></details>
   </div>
  </header>
  <div className="studio-context" aria-label="Authoring context"><span className="studio-context-project" title={project||'Not selected'}>Project: {project||'Not selected'}</span><span className="studio-model-context" title={model||'Not selected'}>Model: {model||'Not selected'}</span><details className="studio-context-details" hidden={area!=='editor'} onKeyDown={disclosureKeyDown}><summary>Draft context</summary><div><p>Graph draft: {graphName}</p><p>Server save &amp; run: Workflow workspace</p></div></details><span className="studio-context-status">Draft — not deployed</span></div>
  <main id="studio-main" tabIndex={-1} ref={main} className="studio-main">{children}</main>
  <dialog id="studio-navigation-dialog" ref={navigationDialog} className="studio-navigation-dialog" aria-label="Studio navigation" onKeyDown={navigationKeyDown} onCancel={event=>{event.preventDefault();closeNavigation();}} onClose={()=>{if(!navigationDialog.current?.open)closeNavigation();}}>
   <div className="studio-navigation-dialog-header"><strong>Studio workspace</strong><button type="button" aria-label="Close Studio navigation" onClick={()=>closeNavigation()}>Close</button></div>
   {navigation('Mobile Studio areas')}
  </dialog>
 </div>;
}

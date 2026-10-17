import {useRef,type ReactNode} from 'react';
import './StudioShell.css';

export type StudioAppearance='inherit'|'day'|'night';
export type StudioArea='studio'|'editor'|'ide'|'resources'|'approvals';
const BUILDERS:ReadonlyArray<{id:StudioArea;label:string}>=[{id:'studio',label:'AI builder'},{id:'editor',label:'Workflow builder'},{id:'ide',label:'Sub-app IDE'}];

/** Local authoring chrome only; no host scope, persistence or authentication authority. */
export function StudioShell({area,onNavigate,onConnectionSettings,project,model,graphName,children,motion=true,voiceTools,appearance='inherit',onAppearance,onMotion}:{area:StudioArea;onNavigate:(area:StudioArea)=>void;onConnectionSettings:()=>void;project:string;model:string;graphName:string;children:ReactNode;motion?:boolean;voiceTools?:ReactNode;appearance?:StudioAppearance;onAppearance?:(appearance:StudioAppearance)=>void;onMotion?:()=>void}){
 const main=useRef<HTMLElement>(null),tools=useRef<HTMLDetailsElement>(null);
 function navigate(next:StudioArea){if(tools.current)tools.current.open=false;onNavigate(next);}
 return <div className="studio studio-shell" data-motion={motion?'on':'off'} data-appearance={appearance} data-area={area} aria-label="Flightdeck Studio workspace">
  <a className="studio-skip" href="#studio-main" onClick={event=>{event.preventDefault();main.current?.focus();}}>Skip to workspace</a>
  <header className="studio-appbar">
   <div className="studio-brand"><span className="studio-brand-mark" aria-hidden="true">F</span><strong>Flightdeck <span>Studio</span></strong></div>
   <nav aria-label="Studio areas" className="studio-navigation">{BUILDERS.map(item=><button key={item.id} type="button" aria-pressed={area===item.id} aria-current={area===item.id?'page':undefined} onClick={()=>navigate(item.id)}>{item.label}</button>)}</nav>
   <div className="studio-shell-actions">{voiceTools}<button type="button" className="studio-settings-button" onClick={onConnectionSettings}>Connection settings</button>
    <details ref={tools} className="studio-tools" aria-label="Studio tools"><summary>Tools</summary><div className="studio-tools-panel"><span className="studio-tool-label">Review &amp; reuse</span>{(['resources','approvals'] as const).map(id=><button key={id} type="button" aria-current={area===id?'page':undefined} onClick={()=>navigate(id)}>{id==='resources'?'Resources':'Approvals'}</button>)}{onMotion&&<button type="button" className="studio-motion" aria-pressed={motion} onClick={onMotion}>Motion {motion?'on':'off'}</button>}{onAppearance&&<label className="studio-appearance">Appearance<select aria-label="Studio appearance" value={appearance} onChange={event=>onAppearance(event.target.value as StudioAppearance)}><option value="inherit">Follow host</option><option value="day">Day</option><option value="night">Night</option></select></label>}</div></details>
   </div>
  </header>
  <div className="studio-context" aria-label="Authoring context"><span className="studio-context-project">Project: {project||'Not selected'}</span><span className="studio-model-context" title={model||'Not selected'}>Model: {model||'Not selected'}</span><details className="studio-context-details" hidden={area!=='editor'}><summary>Draft context</summary><div><p>Graph draft: {graphName}</p><p>Server save &amp; run: Workflow workspace</p></div></details><span className="studio-context-status">Draft — not deployed</span></div>
  <main id="studio-main" tabIndex={-1} ref={main} className="studio-main">{children}</main>
 </div>;
}

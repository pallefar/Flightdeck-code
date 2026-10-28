import {useRef,type ReactNode} from 'react';

/** Presentation only: the original save/controller controls stay mounted. */
export function StudioSourceHeader({children}:{children:ReactNode}){
 const help=useRef<HTMLDetailsElement>(null),actions=useRef<HTMLDetailsElement>(null);
 const closeActions=()=>{if(actions.current){actions.current.open=false;actions.current.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});}};
 return <div className="studio-workspace-heading">
  <div><span className="studio-eyebrow">WORKSPACE / SUB-APP IDE</span><details ref={help} className="studio-ide-help" onToggle={event=>{if(event.currentTarget.open&&actions.current)actions.current.open=false;}} onKeyDown={event=>{if(event.key==='Escape'&&event.currentTarget.open){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});}}}><summary>Draft · scriptless preview</summary><p className="studio-ide-boundary">Draft — not deployed. The preview is scriptless; generated source is not evaluated. In-session Save applies an editor buffer; use Saved sub-app to Save draft and reopen durable source separately.</p></details></div>
  <details ref={actions} className="studio-ide-actions" onToggle={event=>{if(event.currentTarget.open&&help.current)help.current.open=false;}} onKeyDown={event=>{if(event.key==='Escape'&&event.currentTarget.open&&!(event.target as HTMLElement).closest('dialog')){event.preventDefault();event.stopPropagation();closeActions();}}}>
   <summary>Draft actions</summary><div className="studio-ide-action-panel"><button type="button" className="studio-close-draft-actions" onClick={closeActions}>Close draft actions</button><div className="studio-workspace-actions" onClick={event=>{const target=(event.target as HTMLElement).closest('button');if(target&&!target.closest('.fd-subapp-workspace'))closeActions();}}>{children}</div></div>
  </details>
 </div>;
}

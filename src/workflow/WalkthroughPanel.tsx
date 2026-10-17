import type {WorkflowWalkthrough} from './useWorkflowWalkthrough';
export function CreationReplay({tour}:{tour:WorkflowWalkthrough}){
 if(tour.state.mode!=='creation')return null;
 return <div className="wf-creation-bar" aria-label="Received graph creation replay"><div><strong>Draft received · assembling the view</strong><span>Actual graph · {tour.plan.counts.nodes} blocks · {tour.plan.counts.connections} connections · not executed</span></div><button onClick={()=>tour.command(tour.state.playing?tour.player.pause:tour.player.resume)}>{tour.state.playing?'Pause creation':'Resume creation'}</button><button onClick={()=>tour.command(tour.player.skip)}>Skip to final</button></div>;
}
export function WalkthroughPanel({tour,onOpenNode}:{tour:WorkflowWalkthrough;onOpenNode:(id:string)=>void}){
 const {step,state,plan}=tour;
 return <aside id={`${tour.id}-panel`} ref={tour.panelRef} hidden={!tour.open} className="wf-walkthrough" aria-label="Workflow design walkthrough" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();tour.close();}}}>
  <header><div><span className="wf-kicker">EXPLAIN WORKFLOW</span><p>{plan.boundary}</p></div><button aria-label="Close walkthrough" title="Close walkthrough" onClick={tour.close}>×</button></header>
  <div className="wf-walkthrough-scroll">
   <p className="wf-tour-boundary">Explanation route · no execution or approval.</p>
   <div id={`${tour.id}-step`} aria-live={tour.announce?'polite':'off'} aria-atomic="true"><h3 data-walkthrough-heading tabIndex={-1}>{step?step.title:'Actual graph overview'}</h3>{step?<><p>{step.explanation}</p><p className="wf-tour-tip"><strong>Tip</strong> {step.tip}</p><details><summary>Input mapping shapes · values omitted</summary><ul>{step.mappings.map((mapping,index)=><li key={index}>{mapping}</li>)}</ul></details></>:<p>{plan.counts.nodes} blocks · {plan.counts.connections} connections · {plan.counts.reusableWrappers} reusable wrapper instances · {plan.counts.resourceReferences} resource references · {plan.counts.mappings} mappings. Explanation stopped; no execution has been requested.</p>}</div>
   {plan.notices.length>0&&<details className="wf-tour-notices"><summary>Actual execution constraints ({plan.notices.length})</summary><ul>{plan.notices.map(notice=><li key={notice}>{notice}</li>)}</ul></details>}
   {step&&<button onClick={()=>{tour.interrupt();onOpenNode(step.nodeId);}}>Open current block settings</button>}
   <p>Play advances explanations every 2 seconds, not model progress. Narration is explicit and pauses playback so it is not cut short.</p>
   <button disabled={!step||!tour.narrationEnabled} onClick={tour.narrate}>Narrate current step</button>{!tour.narrationEnabled&&<p>Enable voice feedback in the shared voice controls to narrate. Labels, literal values, destinations and reviewer identities are not read aloud.</p>}
   <label className="wf-tour-checkbox"><input type="checkbox" checked={tour.motionOn} onChange={event=>tour.setMotionOn(event.target.checked)}/>Presentation motion</label>
   {tour.reduced&&<p>Reduced motion: creation is shown in full immediately. Use Previous / Next for the manual walkthrough.</p>}
   <label className="wf-tour-checkbox"><input type="checkbox" checked={tour.announce} onChange={event=>tour.setAnnounce(event.target.checked)}/>Announce walkthrough steps to screen readers</label>
  </div>
  <footer className="wf-tour-footer">
   <div className="wf-tour-navigation" role="group" aria-label="Walkthrough navigation"><button disabled={!step||state.index<=0} onClick={()=>tour.command(tour.player.previous)}>Previous</button><span>{step?`${state.index+1} / ${plan.steps.length}`:'Overview'}</span><button disabled={!step||state.index>=plan.steps.length-1} onClick={()=>tour.command(tour.player.next)}>Next</button></div>
   <div className="wf-tour-controls" role="group" aria-label="Presentation playback controls"><button disabled={!step||(!state.playing&&!tour.motionEnabled)} onClick={()=>tour.command(state.playing?tour.player.pause:tour.player.resume)}>{state.playing?'Pause walkthrough':'Play walkthrough'}</button><button onClick={()=>tour.command(tour.player.stop)}>Stop</button><button disabled={!plan.steps.length} onClick={()=>tour.command(tour.player.startTour)}>Replay walkthrough</button><button onClick={()=>tour.command(tour.player.skip)}>Skip to final</button><button disabled={!plan.steps.length} onClick={()=>tour.command(tour.player.replayCreation)}>Replay creation</button></div>
  </footer>
 </aside>;
}

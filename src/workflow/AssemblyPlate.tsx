import {useState} from 'react';
export type AssemblyPhase='queued'|'arriving'|'locked';
/** A noninteractive faceplate. Remount this decoration, never the editor controls. */
export function AssemblyPlate({phase,playing,durationMs}:{phase:AssemblyPhase;playing:boolean;durationMs:number}){
 const [settled,setSettled]=useState(false);
 return <span className="wf-assembly-plate" aria-hidden="true" data-assembly-phase={phase==='arriving'&&settled?'locked':phase} style={{animationDuration:`${durationMs}ms`,animationPlayState:playing?'running':'paused'}} onAnimationEnd={event=>{if(event.target===event.currentTarget&&event.animationName==='wf-module-snap')setSettled(true);}}/>;
}

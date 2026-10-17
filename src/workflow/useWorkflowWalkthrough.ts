import {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore,type RefObject} from 'react';
import type {Graph} from '../../packages/workflow/graph';
import {createWalkthrough} from './walkthrough';
import {WalkthroughPlayback,type PlaybackState} from './walkthrough-playback';
export interface WorkflowNarration {enabled:boolean;speak:(text:string)=>void;stop:()=>void}
export function useWorkflowWalkthrough(graph:Graph,viewport:RefObject<HTMLDivElement|null>,active:boolean,blocked:boolean,buildReveal:boolean,narration:WorkflowNarration|undefined){
 const binding=JSON.stringify(graph),plan=useMemo(()=>createWalkthrough(graph),[binding]);
 const [motionOn,setMotionOn]=useState(true),[reduced,setReduced]=useState(()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches);
 const [open,setOpen]=useState(false),[announce,setAnnounce]=useState(false);
 const [ancestorMotionOff,setAncestorMotionOff]=useState(false);
 const id=useId(),panelRef=useRef<HTMLElement|null>(null),opener=useRef<HTMLElement|null>(null),ownNarration=useRef(false);
 const latest=useRef({binding,active,blocked,motionOn,reduced,ancestorMotionOff,narration});latest.current={binding,active,blocked,motionOn,reduced,ancestorMotionOff,narration};
 function available(){
  const element=viewport.current,context=latest.current;
  if(!context.active||context.blocked||typeof document==='undefined'||document.hidden||!element?.isConnected||element.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
  for(let ancestor:HTMLElement|null=element;ancestor;ancestor=ancestor.parentElement){const style=getComputedStyle(ancestor);if(style.display==='none'||style.visibility==='hidden')return false;}
  return true;
 }
 const [player]=useState(()=>new WalkthroughPlayback(plan,binding,()=>({binding:latest.current.binding,available:available(),motion:latest.current.motionOn&&!latest.current.reduced&&!viewport.current?.closest('[data-motion="off"]')})));
 const snapshot=useSyncExternalStore(player.subscribe,player.getSnapshot,player.getSnapshot),bound=useRef(binding);
 const state:PlaybackState=bound.current===binding?snapshot:{mode:'idle',playing:false,index:-1,revealed:plan.creationGroups.length,creationCycle:snapshot.creationCycle};
 function stopNarration(){if(ownNarration.current){ownNarration.current=false;latest.current.narration?.stop();}}
 function interrupt(){stopNarration();if(player.getSnapshot().mode==='creation')player.skip();else player.pause();}
 useEffect(()=>{if(bound.current!==binding){stopNarration();bound.current=binding;player.sync(plan,binding);}},[binding,plan,player]);
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const change=()=>{latest.current.reduced=media.matches;setReduced(media.matches);player.checkEnvironment();if(media.matches)stopNarration();};
  media.addEventListener('change',change);return ()=>media.removeEventListener('change',change);
 },[player]);
 useEffect(()=>{
  const check=()=>{const off=!!viewport.current?.closest('[data-motion="off"]');latest.current.ancestorMotionOff=off;setAncestorMotionOff(off);player.checkEnvironment();if(!available()||off)stopNarration();};
  const observer=new MutationObserver(check);
  for(let ancestor:HTMLElement|null=viewport.current;ancestor;ancestor=ancestor.parentElement)observer.observe(ancestor,{attributes:true,attributeFilter:['hidden','inert','aria-hidden','class','style','data-motion']});
  document.addEventListener('visibilitychange',check);check();
  return ()=>{observer.disconnect();document.removeEventListener('visibilitychange',check);};
 },[player]);
 useEffect(()=>{if(!narration?.enabled)stopNarration();},[narration?.enabled]);
 useEffect(()=>{player.checkEnvironment();if(!active||blocked||!motionOn||reduced)stopNarration();},[active,blocked,motionOn,reduced,player]);
 useEffect(()=>{if(buildReveal)player.replayCreation();return ()=>{stopNarration();player.dispose();};},[player]);
 const step=open&&state.mode==='tour'?plan.steps[state.index]:undefined;
 const queuedNodes=new Set(state.mode==='creation'?plan.creationGroups.slice(state.revealed).flatMap(group=>group.nodeIds):[]);
 const queuedEdges=new Set(state.mode==='creation'?plan.creationGroups.slice(state.revealed).flatMap(group=>group.edgeIds):[]);
 const currentCreation=new Set(state.mode==='creation'?plan.creationGroups[state.revealed-1]?.nodeIds:[]);
 const currentCreationEdges=new Set(state.mode==='creation'?plan.creationGroups[state.revealed-1]?.edgeIds:[]);
 function command(action:()=>void){stopNarration();action();}
 function show(){opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setOpen(true);command(player.startTour);requestAnimationFrame(()=>panelRef.current?.querySelector<HTMLElement>('[data-walkthrough-heading]')?.focus({preventScroll:true}));}
 function close(){command(player.stop);setOpen(false);const target=opener.current;opener.current=null;if(target?.isConnected&&!target.closest('[hidden],[inert]'))target.focus({preventScroll:true});}
 function narrate(){if(!step||!narration?.enabled||!available())return;player.pause();stopNarration();ownNarration.current=true;narration.speak(step.narration);}
 return {id,plan,state,open,step,panelRef,motionOn,reduced,motionEnabled:motionOn&&!reduced&&!ancestorMotionOff,announce,setAnnounce,queuedNodes,queuedEdges,currentCreation,currentCreationEdges,player,command,show,close,interrupt,narrate,setMotionOn,narrationEnabled:!!narration?.enabled};
}
export type WorkflowWalkthrough=ReturnType<typeof useWorkflowWalkthrough>;

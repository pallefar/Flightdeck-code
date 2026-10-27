import type {WalkthroughPlan} from './walkthrough';
export interface PlaybackState {mode:'idle'|'creation'|'tour';playing:boolean;index:number;revealed:number;creationCycle:number}
export interface PlaybackContext {binding:string;available:boolean;motion:boolean}
/** Presentation clock only. Owns no graph, execution state, voice or adapters. */
export class WalkthroughPlayback {
 private state:PlaybackState;
 private listeners=new Set<()=>void>();
 private timer:ReturnType<typeof setTimeout>|undefined;
 private creationCycle=0;
 constructor(private plan:WalkthroughPlan,private binding:string,private context:()=>PlaybackContext){this.state=this.finalState();}
 private finalState():PlaybackState{return {mode:'idle',playing:false,index:-1,revealed:this.plan.creationGroups.length,creationCycle:this.creationCycle};}
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 private emit(patch:Partial<PlaybackState>){this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
 private clear(){if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined;}
 private current(){if(this.context().binding===this.binding)return true;this.stop();return false;}
 /** Call on visibility/active/modal/motion changes, not just when starting a timer. */
 checkEnvironment=()=>{
  if(!this.current())return;
  const {available,motion}=this.context();
  if(!available||!motion){if(this.state.mode==='creation')this.skip();else if(this.state.playing)this.pause();}
 };
 sync=(plan:WalkthroughPlan,binding:string)=>{if(binding===this.binding)return;this.clear();this.plan=plan;this.binding=binding;this.emit(this.finalState());};
 private schedule(){
  this.clear();if(!this.state.playing)return;
  this.timer=setTimeout(()=>{
   this.timer=undefined;if(!this.current())return;
   this.checkEnvironment();if(!this.state.playing)return;
   if(this.state.mode==='creation'){
    if(this.state.revealed>=this.plan.creationGroups.length){this.skip();return;}
    this.emit({revealed:this.state.revealed+1});
   }else if(this.state.mode==='tour'){
    if(this.state.index>=this.plan.steps.length-1){this.pause();return;}
    this.emit({index:this.state.index+1});
   }
   this.schedule();
  },this.state.mode==='creation'?2000/Math.max(1,this.plan.creationGroups.length):2000);
 }
 replayCreation=()=>{
  this.clear();if(!this.current())return;
  const {available,motion}=this.context();if(!available||!motion||!this.plan.steps.length){this.skip();return;}
  this.emit({mode:'creation',playing:true,index:-1,revealed:1,creationCycle:++this.creationCycle});this.schedule();
 };
 startTour=()=>{this.clear();if(!this.current()||!this.context().available||!this.plan.steps.length)return;this.emit({mode:'tour',playing:false,index:0,revealed:this.plan.creationGroups.length});};
 next=()=>{if(!this.current()||this.state.mode!=='tour'||!this.context().available)return;this.pause();this.emit({index:Math.min(this.plan.steps.length-1,this.state.index+1)});};
 previous=()=>{if(!this.current()||this.state.mode!=='tour'||!this.context().available)return;this.pause();this.emit({index:Math.max(0,this.state.index-1)});};
 pause=()=>{this.clear();if(this.state.playing)this.emit({playing:false});};
 resume=()=>{if(!this.current())return;const {available,motion}=this.context();if(this.state.mode==='idle'||!available||!motion)return;this.emit({playing:true});this.schedule();};
 skip=()=>{this.clear();this.emit(this.finalState());};
 stop=this.skip;
 dispose=()=>{this.clear();this.listeners.clear();};
}

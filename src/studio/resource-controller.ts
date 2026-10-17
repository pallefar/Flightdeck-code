import { ResourceClient, ResourceClientError, type Definition, type ResourceSummary, type FunctionSummary, type ResourceExecution } from './resource-client';
export interface ResourceState {
 ready:boolean;loaded:boolean;busy:boolean;resources:ResourceSummary[];functions:FunctionSummary[];selected:ResourceSummary|null;revisions:ResourceSummary[];draft:Definition|null;functionId:string;parameters:unknown;result:ResourceExecution|null;error:string|null;saved:boolean;
}
const initial=():ResourceState=>({ready:false,loaded:false,busy:false,resources:[],functions:[],selected:null,revisions:[],draft:null,functionId:'',parameters:undefined,result:null,error:null,saved:false});
export class ResourceController {
 private state=initial();private listeners=new Set<()=>void>();private project='';private token='';private client:ResourceClient|null=null;private turn=0;private abort:AbortController|null=null;
 constructor(private transport:typeof fetch=fetch) {}
 getState=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 matchesScope(project:string,token:string) {return this.project===project && this.token===token;}
 private patch(update:Partial<ResourceState>) {this.state={...this.state,...update};for(const listener of this.listeners) listener();}
 setScope(project:string,token:string) {
  if(this.matchesScope(project,token)) return;
  this.cancel();this.project=project;this.token=token;this.client=null;
  try {this.client=new ResourceClient(project,token,this.transport);}catch {/* Invalid scope must mask previous data. */}
  this.state={...initial(),ready:!!this.client};for(const listener of this.listeners) listener();
 }
 cancel() {this.turn++;this.abort?.abort();this.abort=null;if(this.state.busy) this.patch({busy:false});}
 private async operation(action:(client:ResourceClient,signal:AbortSignal)=>Promise<Partial<ResourceState>>) {
  if(!this.client) return;
  this.cancel();const turn=++this.turn;const abort=new AbortController();this.abort=abort;const client=this.client;
  this.patch({busy:true,error:null,result:null,saved:false});
  try {const update=await action(client,abort.signal);if(turn===this.turn && !abort.signal.aborted) this.patch(update);}
  catch(e) {if(turn===this.turn && !abort.signal.aborted) this.patch({error:(e instanceof ResourceClientError?e:new ResourceClientError('unavailable')).message});}
  finally {if(turn===this.turn) {this.abort=null;this.patch({busy:false});}}
 }
 private parameterSeed(functionId:string) {const schema=this.state.functions.find(f=>f.id===functionId)?.input;return schema?.type==='object'?{}:schema?.type==='array'?[]:undefined;}
 refresh=async()=>this.operation(async(client,signal)=>({...await client.list(signal),loaded:true}));
 open=async(id:string)=>this.operation(async(client,signal)=>{const selected=await client.get(id,signal);const revisions=await client.history(id,signal);return {selected,revisions,draft:structuredClone(selected.definition),functionId:selected.definition.functions[0]??'',parameters:this.parameterSeed(selected.definition.functions[0]??'')};});
 selectRevision(revision:number) {this.cancel();const selected=this.state.revisions.find(r=>r.revision===revision);if(!selected) return;this.patch({selected,draft:structuredClone(selected.definition),functionId:selected.definition.functions[0]??'',parameters:this.parameterSeed(selected.definition.functions[0]??''),result:null,error:null,saved:false});}
 create() {this.cancel();if(!this.client) return;this.patch({selected:null,revisions:[],draft:{name:'',functions:[]},functionId:'',parameters:undefined,result:null,error:null,saved:false});}
 edit(draft:Definition) {this.cancel();this.patch({draft:structuredClone(draft),result:null,error:null,saved:false});}
 chooseFunction(functionId:string) {this.cancel();if(!this.state.selected?.definition.functions.includes(functionId)) return;this.patch({functionId,parameters:this.parameterSeed(functionId),result:null,error:null});}
 setParameters(parameters:unknown) {this.cancel();this.patch({parameters,result:null,error:null});}
 save=async()=>{
  const draft=this.state.draft;if(!draft) return;const current=this.state.selected;
  await this.operation(async(client,signal)=>{const selected=await client.save(structuredClone(draft),current??undefined,signal);return {selected,draft:structuredClone(selected.definition),revisions:[...this.state.revisions.filter(r=>r.revision!==selected.revision),selected],resources:[...this.state.resources.filter(r=>r.id!==selected.id),selected],saved:true,functionId:selected.definition.functions[0]??'',parameters:this.parameterSeed(selected.definition.functions[0]??'')};});
 };
 test=async()=>{
  const selected=this.state.selected;const fn=this.state.functions.find(f=>f.id===this.state.functionId);if(!selected || !fn) return;
  const parameters=structuredClone(this.state.parameters);
  await this.operation(async(client,signal)=>({result:await client.execute(selected,fn,parameters,signal)}));
 };
}

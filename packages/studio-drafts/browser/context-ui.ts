import type { Context, OSSession } from './client.js';
export function contextPresentation(context:Context|null) {
 const selected=context?.projects.find(p=>p.id===context.scope.projectId&&p.enabled);
 if(!context||!selected)return {confirmed:false,identity:'OS session not verified',project:'No server-confirmed project'};
 return {confirmed:true,identity:`${context.actor.displayName} (${context.actor.username})`,project:selected.label};
}
/** Optional host-token-inheriting context disclosure. No localStorage, account
 * selector, login credentials or implicit project fallback. Mount is optional;
 * native DOM focus/responsive acceptance remains a separate gate. */
export function mountContextBar(root:HTMLElement,session:OSSession) {
 const doc=root.ownerDocument;
 function render(){
  const state=session.snapshot(),view=contextPresentation(state.context);
  const identity=doc.createElement('span');identity.textContent=view.identity;
  const label=doc.createElement('label');label.textContent='Project ';
  const select=doc.createElement('select');select.setAttribute('aria-label','Authorized OS project');select.disabled=!state.context||state.busy;
  if(!state.context){const option=doc.createElement('option');option.textContent=view.project;select.append(option);}
  else for(const project of state.context.projects.filter(p=>p.enabled)){
   const option=doc.createElement('option');option.value=project.id;option.textContent=project.label;option.selected=project.id===state.context.scope.projectId;select.append(option);
  }
  select.addEventListener('change',()=>{const context=session.snapshot().context;if(!context)return;void session.select({workspaceId:context.scope.workspaceId,projectId:select.value}).catch(()=>session.clear());});
  label.append(select);const disclosure=doc.createElement('span');disclosure.textContent=state.uncertain?'Save outcome uncertain — writes blocked':'Graph drafts only · execution, providers and release blocked';
  root.replaceChildren(identity,label,disclosure);
 }
 render();const stop=session.subscribe(render);return ()=>{stop();root.replaceChildren();};
}

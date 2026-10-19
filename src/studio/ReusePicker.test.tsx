import {expect,it,vi} from 'vitest';
import {createStudioReuseBridge,type StudioReusePreviewContext} from './ReusePicker';
import * as PickerModule from './ReusePicker';
import {renderToStaticMarkup} from 'react-dom/server';
import {createPublicReuseCatalog,bundledCatalogSource,type ReuseMetadata} from '../reuse-catalog/catalog';
import {builtinRegistry} from '../../packages/workflow/graph';
import {StudioController} from './controller';
import {isValidElement,type ReactNode,type ReactElement} from 'react';
import type {CatalogPort} from '../reuse-catalog/controller';
const selection=(r:ReuseMetadata)=>JSON.stringify({kind:r.kind,id:r.id,metadataDigest:r.metadataDigest,templateVersion:r.templateVersion});

it('U04 central edits advance even same-value and updater revisions and revoke a pending candidate before send-review notifications',async()=>{
  const h=host(),b=h.bridge;
  expect(typeof (b as unknown as {editPrompt?:unknown}).editPrompt).toBe('function');
  if(!('editPrompt' in b))return;
  const edit=b.editPrompt as (text:string|((current:string)=>string))=>unknown;
  edit('原始\r\n🛰');await b.reuse.open('{}');await b.reuse.select(selection(b.reuse.getState().rows.find(r=>r.id==='manual')!));
  expect(b.reuse.getState().candidate).not.toBeNull();
  h.invalidate.mockImplementation(()=>expect(b.reuse.getState().candidate).toBeNull());
  edit(current=>current);edit('later');edit('原始\r\n🛰');
  expect(JSON.parse(b.composer.read() as string)).toEqual({contextEpoch:0,revision:4,text:'原始\r\n🛰'});
  expect(h.writes).toEqual(['原始\r\n🛰','原始\r\n🛰','later','原始\r\n🛰']);
  expect(h.invalidate).toHaveBeenCalledTimes(4);h.disconnect();
});

async function candidate(b:ReturnType<typeof createStudioReuseBridge>,id='manual'){
  await b.reuse.open('{}');await b.reuse.select(selection(b.reuse.getState().rows.find(r=>r.id===id)!));
  const p=b.reuse.getState().candidate;expect(p).not.toBeNull();if(!p)throw Error('No candidate');
  b.reuse.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));
  return {p,action:JSON.stringify({reviewId:b.reuse.getState().reviewId})};
}

it('U05 inserts through the one central CAS edit and exposes one exact undo, never an automatic send',async()=>{
  const h=host(),b=h.bridge,original='原始\r\n🙂 e\u0301';b.editPrompt(original);
  const {p,action}=await candidate(b);
  expect(await b.reuse.insert(action)).toBe(true);
  expect(h.writes).toEqual([original,p.afterText]);expect(h.invalidate).toHaveBeenCalledTimes(2);
  const undo=JSON.stringify({undoId:b.reuse.getState().undoId});b.reuse.close();
  expect(b.reuse.undo(undo)).toBe(true);expect(h.writes).toEqual([original,p.afterText,original]);
  expect(b.reuse.undo(undo)).toBe(false);expect(JSON.parse(b.composer.read() as string).revision).toBe(3);h.disconnect();
});

it('U06 revokes context synchronously before notifying listeners and never restores an old review after scope ABA',async()=>{
  const h=host(),b=h.bridge;const {action}=await candidate(b);
  expect(typeof (b as unknown as {revokeContext?:unknown}).revokeContext).toBe('function');
  if(!('revokeContext' in b))return;
  const revoke=b.revokeContext as ()=>void;
  let seen=false;const off=b.reuse.subscribe(()=>{seen=true;expect(b.reuse.getState().candidate).toBeNull();});
  revoke();revoke();off();expect(seen).toBe(true);
  expect(JSON.parse(b.composer.read() as string).contextEpoch).toBe(2);
  expect(await b.reuse.insert(action)).toBe(false);expect(h.writes).toEqual([]);h.disconnect();
});

it('U07 StrictMode cleanup/setup keeps one usable controller, but unmounted ports are immediately unwritable and finally disposed',async()=>{
  const h=host(),b=h.bridge,controller=b.reuse;
  b.editPrompt('before');h.disconnect();b.editPrompt('unmounted');
  expect(h.writes).toEqual(['before']);expect(b.composer.read()).toBeNull();
  const disconnect=b.connect();await Promise.resolve();expect(b.reuse).toBe(controller);
  b.editPrompt('mounted again');expect(h.writes).toEqual(['before','mounted again']);
  expect(await b.reuse.open('{}')).toBe(true);disconnect();await Promise.resolve();
  b.connect();expect(await b.reuse.open('{}')).toBe(false);b.editPrompt('cannot revive');
  expect(h.writes).toEqual(['before','mounted again']);
});

it('U08 renders real bounded metadata and an explicit selected detail/unknowns/exact inert preview/review boundary',async()=>{
  const Component=(PickerModule as unknown as {ReusePicker?:React.ComponentType<{reuse:ReturnType<typeof createStudioReuseBridge>['reuse'];active:boolean}>}).ReusePicker;
  expect(typeof Component).toBe('function');if(!Component)return;
  const h=host(),b=h.bridge;await b.reuse.open('{}');
  let html=renderToStaticMarkup(<Component reuse={b.reuse} active/>);
  expect(html).toContain('Search reusable sources');expect(html).toContain('Source kind');
  expect(html).toContain('aria-modal="true"');expect(html).toContain('12 source definitions');
  expect(html).not.toContain('Exact insertion preview');expect(html).not.toContain('Schema fields');
  await b.reuse.query('{"kind":"process-template","query":"analytical-report"}');
  const row=b.reuse.getState().rows[0]!;await b.reuse.select(selection(row));
  const p=b.reuse.getState().candidate!;expect(p).not.toBeNull();
  html=renderToStaticMarkup(<Component reuse={b.reuse} active/>);
  expect(html).toContain('Exact insertion preview');expect(html).toContain('I reviewed this exact reference');
  expect(html).toContain('License');expect(html).toContain('Independent approval');expect(html).toContain('Executable version');expect(html).toContain('Canonical owner');
  expect(html.match(/Unknown/g)?.length).toBeGreaterThanOrEqual(4);
  expect(html).toContain('Template version');expect(html).not.toContain('analytical-report@');
  expect(html).toContain('studio-reuse-current-request/1');expect(html).toContain('not HTTP');
  expect(html).not.toContain('<form');expect(html).not.toContain('<script');
  expect(html.match(/<button\b[^>]*disabled[^>]*>Add reference<\/button>/)).not.toBeNull();
  expect(h.writes).toEqual([]);expect(h.invalidate).not.toHaveBeenCalled();h.disconnect();
});

it('U10 native dialog effect replay does not close/reopen an active modal or steal focus, but real removal returns focus',async()=>{
  const activate=(PickerModule as unknown as {activateReuseDialog?:typeof PickerModule.activateReuseDialog}).activateReuseDialog;
  expect(typeof activate).toBe('function');if(!activate)return;
  let open=false,connected=true;
  const show=vi.fn(()=>{open=true;}),close=vi.fn(),focus=vi.fn(),searchFocus=vi.fn();
  const node={get open(){return open;},get isConnected(){return connected;},showModal:show,close,ownerDocument:{visibilityState:'visible'}} as unknown as HTMLDialogElement;
  const opener={isConnected:true,closest:()=>null,focus} as unknown as HTMLButtonElement;
  const search={focus:searchFocus} as unknown as HTMLInputElement;
  const cleanup=activate(node,search,()=>opener,()=>{},()=>true);cleanup();
  const finalCleanup=activate(node,search,()=>opener,()=>{},()=>true);await Promise.resolve();
  expect(show).toHaveBeenCalledTimes(1);expect(close).not.toHaveBeenCalled();expect(focus).not.toHaveBeenCalled();
  connected=false;finalCleanup();await Promise.resolve();expect(focus).toHaveBeenCalledTimes(1);
});

it('U11 Escape revokes dialog work synchronously and Tab wraps only at visible modal edges without submitting Enter',async()=>{
  const key=(PickerModule as unknown as {handleReuseDialogKey?:typeof PickerModule.handleReuseDialogKey}).handleReuseDialogKey;
  expect(typeof key).toBe('function');if(!key)return;
  const h=host(),b=h.bridge;await candidate(b);
  const first={focus:vi.fn(),getClientRects:()=>[{}],closest:()=>null},last={focus:vi.fn(),getClientRects:()=>[{}],closest:()=>null};
  const node={querySelectorAll:()=>[first,last],ownerDocument:{activeElement:last}} as unknown as HTMLDialogElement;
  const event=(value:string,shiftKey=false)=>({key:value,shiftKey,currentTarget:node,preventDefault:vi.fn(),stopPropagation:vi.fn()});
  let e=event('Tab');key(e,()=>b.reuse.close());expect(first.focus).toHaveBeenCalledTimes(1);expect(e.preventDefault).toHaveBeenCalledOnce();
  (node.ownerDocument as unknown as {activeElement:unknown}).activeElement=first;e=event('Tab',true);key(e,()=>b.reuse.close());expect(last.focus).toHaveBeenCalledOnce();
  e=event('Enter');key(e,()=>b.reuse.close());expect(e.preventDefault).not.toHaveBeenCalled();expect(e.stopPropagation).toHaveBeenCalledOnce();expect(b.reuse.getState().open).toBe(true);
  e=event('Escape');key(e,()=>b.reuse.close());expect(e.preventDefault).toHaveBeenCalledOnce();expect(b.reuse.getState().open).toBe(false);expect(b.reuse.getState().reviewId).toBeNull();expect(h.writes).toEqual([]);h.disconnect();
});

it('U12 CAS routes through the same host editPrompt callback with its operation-local lease and one send-review invalidation',async()=>{
  let b!:ReturnType<typeof createStudioReuseBridge>;const route=vi.fn((next:string,cas:{expected:import('../reuse-catalog/controller').ComposerSnapshot;isCurrent:()=>boolean})=>b.editPrompt(next,cas));
  const invalidate=vi.fn(),writes:string[]=[];
  const options={invalidateSendReview:invalidate,setPrompt:(text:string)=>writes.push(text),preview,available:()=>true,routeEdit:route};
  b=createStudioReuseBridge(options);const disconnect=b.connect();const {action}=await candidate(b);
  expect(await b.reuse.insert(action)).toBe(true);expect(route).toHaveBeenCalledTimes(1);expect(invalidate).toHaveBeenCalledTimes(1);expect(writes).toHaveLength(1);
  disconnect();
});

it('U13 manual edit cannot write an unmounted port when send-review notification synchronously tears down the session',()=>{
  const h=host();h.invalidate.mockImplementation(()=>h.disconnect());
  expect(h.bridge.editPrompt('late event')).toBeNull();expect(h.writes).toEqual([]);expect(h.bridge.composer.read()).toBeNull();
});

it.each(['close','cancel','manual-edit','fresh-scope','unmount','busy'] as const)('S01 rechecks the real send-review notification boundary after reentrant %s',async mode=>{
  const network=vi.fn<typeof fetch>(async()=>{throw Error('Development forbidden network');}),studio=new StudioController(network),writes:string[]=[];
  let available=true,scope=0,armed=false,disconnected=()=>{};
  const b=createStudioReuseBridge({invalidateSendReview:()=>studio.invalidateSkillSendReview(),setPrompt:text=>writes.push(text),preview,available:()=>available,scope:()=>[scope]});
  disconnected=b.connect();const {action}=await candidate(b);
  const off=studio.subscribe(()=>{if(!armed)return;armed=false;if(mode==='close')b.reuse.close();else if(mode==='cancel')b.reuse.cancel();else if(mode==='manual-edit')b.editPrompt('later human text');else if(mode==='fresh-scope')scope++;else if(mode==='unmount')disconnected();else available=false;});
  armed=true;expect(await b.reuse.insert(action)).toBe(false);
  expect(writes).toEqual(mode==='manual-edit'?['later human text']:[]);expect(b.reuse.getState().undoId).toBeNull();expect(network).not.toHaveBeenCalled();off();disconnected();
});

it.each(['typing','same-value','ABA','scope'] as const)('S02 one bridge undo cannot erase later %s',async mode=>{
  const h=host(),b=h.bridge,{p,action}=await candidate(b);expect(await b.reuse.insert(action)).toBe(true);
  const undo=JSON.stringify({undoId:b.reuse.getState().undoId});
  if(mode==='scope')b.revokeContext();else if(mode==='same-value')b.editPrompt(p.afterText);else{b.editPrompt('later human text');if(mode==='ABA')b.editPrompt(p.afterText);}
  const before=[...h.writes];expect(b.reuse.undo(undo)).toBe(false);expect(h.writes).toEqual(before);h.disconnect();
});

it('S03 checks fresh scope refs at action reads without waiting for a React effect and never serializes their private values',async()=>{
  let scope='DEVELOPMENT_PRIVATE_SCOPE_SENTINEL';const b=createStudioReuseBridge({invalidateSendReview:()=>{},setPrompt:()=>{},preview,available:()=>true,scope:()=>[scope]});const off=b.connect();
  const {action}=await candidate(b);scope='DEVELOPMENT_OTHER_SCOPE_SENTINEL';
  expect(await b.reuse.insert(action)).toBe(false);const read=b.composer.read() as string;
  expect(Object.keys(JSON.parse(read)).sort()).toEqual(['contextEpoch','revision','text']);expect(read).not.toContain('SENTINEL');expect(b.composer.measure('request')).not.toContain('SENTINEL');off();
});

it('S04 unavailable reuse refuses insertion without disabling existing manual typing',async()=>{
  const h=host(),{action}=await candidate(h.bridge);h.unavailable();h.bridge.editPrompt('manual typing remains allowed');
  expect(await h.bridge.reuse.insert(action)).toBe(false);expect(h.writes).toEqual(['manual typing remains allowed']);expect(h.bridge.composer.read()).toBeNull();h.disconnect();
});

it('S05 over-limit local context is not dropped or truncated and the fixed message asks for explicit shortening',async()=>{
  const context={...preview(),pendingAnswers:{purpose:'x'.repeat(2100)}},h=host(context),b=h.bridge;
  b.editPrompt('keep this exact request');await b.reuse.open('{}');expect(await b.reuse.select(selection(b.reuse.getState().rows.find(r=>r.id==='manual')!))).toBe(false);
  expect(b.reuse.getState().error).toBe('prompt-limit');const html=renderToStaticMarkup(<PickerModule.ReusePicker reuse={b.reuse} active/>);
  expect(html).toContain('Explicitly shorten');expect(html).toContain('Nothing is truncated or silently omitted');expect(h.writes).toEqual(['keep this exact request']);expect(context.pendingAnswers.purpose).toHaveLength(2100);h.disconnect();
});

it('S06 only the selected actual schema is read, with escaped metadata and exact native preview text',async()=>{
  const schema=vi.fn(bundledCatalogSource.schema),api=createPublicReuseCatalog({...bundledCatalogSource,schema,builtins:()=>builtinRegistry.map(row=>row.type==='manual'?{...row,label:'<svg onload="DEVELOPMENT">',description:'<script>DEVELOPMENT</script>'}:row)});
  const h=host(preview(),{list:q=>api.list(q),detail:q=>api.detail(q)}),b=h.bridge;
  await b.reuse.open('{}');expect(schema).not.toHaveBeenCalled();await b.reuse.select(selection(b.reuse.getState().rows.find(r=>r.id==='manual')!));
  expect(schema.mock.calls.every(([id])=>id==='manual')).toBe(true);
  const tree=PickerModule.ReusePickerBody({reuse:b.reuse,state:b.reuse.getState()}),nodes=walk(tree),pre=nodes.find(node=>node.type==='pre');
  expect(pre?.props.children).toBe(b.reuse.getState().candidate!.insertedText);
  const html=renderToStaticMarkup(tree);expect(html).not.toContain('<script>');expect(html).not.toContain('<svg');expect(html).toContain('&lt;script&gt;');h.disconnect();
});

it('S07 displayed review and Insert handlers capture rendered IDs/text and cannot consume a newer preview',async()=>{
  const h=host(),b=h.bridge;await b.reuse.open('{}');await b.reuse.select(selection(b.reuse.getState().rows.find(r=>r.id==='manual')!));
  const body=()=>walk(PickerModule.ReusePickerBody({reuse:b.reuse,state:b.reuse.getState()}));
  const checkbox=()=>body().find(node=>node.type==='input'&&node.props.type==='checkbox')!;
  const add=()=>body().find(node=>node.type==='button'&&node.props.children==='Add reference')!;
  const oldReview=checkbox().props.onChange!;oldReview({target:{checked:true}});const oldInsert=add().props.onClick!;
  await b.reuse.select(selection(b.reuse.getState().rows.find(r=>r.id==='http')!));oldReview({target:{checked:true}});expect(b.reuse.getState().reviewId).toBeNull();
  checkbox().props.onChange!({target:{checked:true}});const currentId=b.reuse.getState().reviewId;
  oldInsert();await Promise.resolve();expect(h.writes).toEqual([]);expect(b.reuse.getState().reviewId).toBe(currentId);
  add().props.onClick!();await vi.waitFor(()=>expect(h.writes).toHaveLength(1));h.disconnect();
});

it('S08 fixed uncertain-composer failure labels never echo raw exceptions or guarantee no change',async()=>{
  const api=createPublicReuseCatalog(),h=host(preview(),{list:q=>api.list(q),detail:()=>{throw Error('DEVELOPMENT_SENSITIVE_EXCEPTION');}});await h.bridge.reuse.open('{}');await h.bridge.reuse.select(selection(h.bridge.reuse.getState().rows[0]!));
  let html=renderToStaticMarkup(<PickerModule.ReusePicker reuse={h.bridge.reuse} active/>);expect(html).not.toContain('DEVELOPMENT_SENSITIVE_EXCEPTION');
  h.disconnect();
  const b=createStudioReuseBridge({invalidateSendReview:()=>{},setPrompt:()=>{},routeEdit:()=>{throw Error('DEVELOPMENT_SENSITIVE_EXCEPTION');},preview,available:()=>true}),off=b.connect();const {action}=await candidate(b);
  expect(await b.reuse.insert(action)).toBe(false);expect(b.reuse.getState().error).toBe('composer-unavailable');
  html=renderToStaticMarkup(<PickerModule.ReusePicker reuse={b.reuse} active/>);
  expect(html).toContain('edit confirmation is uncertain');expect(html).toContain('Inspect your current request');expect(html).not.toContain('No changes were made');expect(html).not.toContain('DEVELOPMENT_SENSITIVE_EXCEPTION');off();
});

it('S09 insertion only invalidates existing send review and retains the actual Studio transcript/result and workbench',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({status:'needs_input',understanding:'DEVELOPMENT question',questions:[{id:'purpose',question:'Which outcome?'}]}))),studio=new StudioController(fetcher);
  await studio.submit({connectionId:'local',prompt:'DEVELOPMENT request'},'DEVELOPMENT_NOT_A_CREDENTIAL');const before=studio.getState(),workbench=studio.workbench.getState();
  const b=createStudioReuseBridge({invalidateSendReview:()=>studio.invalidateSkillSendReview(),setPrompt:()=>{},preview,available:()=>true}),off=b.connect();const {action}=await candidate(b);
  expect(await b.reuse.insert(action)).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);expect(studio.getState().result).toBe(before.result);expect(studio.getState().transcript).toBe(before.transcript);expect(studio.workbench.getState()).toBe(workbench);off();
});

it.each((['list','detail','insert'] as const).flatMap(stage=>(['scope','disconnect','edit-ABA'] as const).map(change=>({stage,change}))))('S10 late actual-factory $stage cannot write after bridge $change',async({stage,change})=>{
  const api=createPublicReuseCatalog();let release!:()=>void,entered!:()=>void,calls=0,signal:AbortSignal|null=null;
  const barrier=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const wait=async<T,>(dto:T,s:AbortSignal)=>{signal=s;entered();await barrier;return dto;};
  const catalog:CatalogPort={list:async(q,s)=>{const dto=await api.list(q);return stage==='list'?wait(dto,s):dto;},detail:async(q,s)=>{const dto=await api.detail(q);calls++;return stage==='detail'||stage==='insert'&&calls===2?wait(dto,s):dto;}};
  const h=host(preview(),catalog),b=h.bridge;b.editPrompt('baseline');let pending:Promise<boolean>;
  if(stage==='list')pending=b.reuse.open('{}');else{await b.reuse.open('{}');const q=selection(b.reuse.getState().rows.find(row=>row.id==='http')!);if(stage==='detail')pending=b.reuse.select(q);else{await b.reuse.select(q);const p=b.reuse.getState().candidate!;b.reuse.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));pending=b.reuse.insert(JSON.stringify({reviewId:b.reuse.getState().reviewId}));}}
  await started;if(change==='scope')b.revokeContext();else if(change==='disconnect')h.disconnect();else{b.editPrompt('later text');b.editPrompt('baseline');}
  release();expect(await pending).toBe(false);expect((signal as unknown as AbortSignal).aborted).toBe(true);expect(b.reuse.getState().candidate).toBeNull();expect(b.reuse.getState().undoId).toBeNull();
  expect(h.writes).toEqual(change==='edit-ABA'?['baseline','later text','baseline']:['baseline']);h.disconnect();
});

it('U15 names unknown future server context instead of presenting local projection bytes as admitted transport',async()=>{
  const h=host();await candidate(h.bridge);const html=renderToStaticMarkup(<PickerModule.ReusePicker reuse={h.bridge.reuse} active/>);
  expect(html).toContain('Server-loaded skill content and later model requests are not measured here.');h.disconnect();
});

type ElementProps={children?:ReactNode;type?:string;disabled?:boolean;onChange?:(event:{target:{checked:boolean}})=>unknown;onClick?:()=>unknown};
function walk(node:ReactNode):Array<ReactElement<ElementProps>>{
  if(Array.isArray(node))return node.flatMap(walk);
  if(!isValidElement<ElementProps>(node))return [];
  return [node,...walk(node.props.children)];
}

const preview=():StudioReusePreviewContext=>({projectId:'development-reuse',connectionId:'',authoringEngine:'json-planner',pendingAnswers:{purpose:'中文 🛰\r\n'},pendingContext:{status:'needs_input',questions:[{id:'purpose',question:'What should it do?'}]}});
function host(context=preview(),catalog?:CatalogPort){
  const writes:string[]=[],invalidate=vi.fn();let available=true;
  const bridge=createStudioReuseBridge({invalidateSendReview:invalidate,setPrompt:text=>writes.push(text),preview:()=>context,available:()=>available,...(catalog?{catalog}:{})});
  const disconnect=bridge.connect();
  return {bridge,writes,invalidate,disconnect,unavailable:()=>{available=false;}};
}

it('U03 measures exact named local current-request, raw context and envelope projections without omitting pending context',()=>{
  const h=host(),text='原始\r\nrequest 🛰';
  const measured=h.bridge.composer.measure(text);
  expect(typeof measured).toBe('string');
  if(typeof measured!=='string')return;
  const c=preview(),request={projection:'studio-reuse-current-request/1',prompt:text,projectId:c.projectId,connectionId:c.connectionId||null,authoringEngine:c.authoringEngine,pendingAnswers:c.pendingAnswers,pendingContext:c.pendingContext};
  const dynamic=JSON.stringify(request);
  const envelope={projection:'studio-reuse-raw-envelope/1',task:'studio.spec.draft',facts:{workflow:{kind:'text',text:dynamic}}};
  const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length;
  expect(JSON.parse(measured)).toEqual({requestBytes:bytes(request),dynamicContextCodeUnits:dynamic.length,envelopeBytes:bytes(envelope)});
  expect(h.writes).toEqual([]);expect(h.invalidate).not.toHaveBeenCalled();h.disconnect();
});

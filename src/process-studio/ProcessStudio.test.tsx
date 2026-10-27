import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ProcessDraft} from './contracts';
import {ProcessReviewGate,ProcessStudio,parseRoiIntegerInput,dialogFocusTarget} from './ProcessStudio';
import {ROI_ASSUMPTION_KEYS} from './roi';

const draftFixture=():ProcessDraft=>({brief:{format:'flightdeck-process-brief/1',title:'Typed test fact',problem:'A recurring handoff waits for independent human review.',outcome:'A human can inspect the reviewed draft.',users:'Human process operator',systemOfRecord:'Existing source reference capability; no record import.',dataSensitivity:'internal',currency:'EUR',templateId:'operations-queue',v1Features:['List own proposals for human review'],v2Features:[],acceptanceCriteria:['Human can review'],roi:{annualVolume:null,baselineSeconds:null,targetSeconds:null,adoptionBasisPoints:null,loadedHourlyCostCents:null,cashRealizationBasisPoints:null,annualRecurringCostCents:null,initialCostCents:null}},choices:{appId:'test-process',icon:'Q',navSection:'Ops & insight',visibleToRoles:['admin'],consentedScopes:['write:inbox-proposal']}});
const deferred=<T,>()=>{let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

describe('Process review revision',()=>{
 it('requires fresh review after every edit, even edit then revert',()=>{
  const gate=new ProcessReviewGate();
  gate.review('same-exact-plan',true);
  expect(gate.isReviewed('same-exact-plan')).toBe(true);
  gate.edit();gate.edit();
  expect(gate.getSnapshot().revision).toBe(2);
  expect(gate.isReviewed('same-exact-plan')).toBe(false);
  gate.review('same-exact-plan',true);
  expect(gate.isReviewed('same-exact-plan')).toBe(true);
  expect(gate.isReviewed('different-plan')).toBe(false);
 });
 it('sends an isolated snapshot once and discards cancelled late output',async()=>{
  const gate=new ProcessReviewGate(),source=draftFixture(),held=deferred<{artifactId:string;label:string}>();
  let calls=0,signal:AbortSignal|undefined,snapshot:ProcessDraft|undefined;
  const build=(draft:ProcessDraft,_key:string,abort:AbortSignal)=>{calls++;snapshot=draft;signal=abort;return held.promise;};
  await gate.run(source,'exact',build,()=>true);expect(calls).toBe(0);
  gate.review('exact',true);
  const pending=gate.run(source,'exact',build,()=>true);
  await gate.run(source,'exact',build,()=>true);
  expect(calls).toBe(1);expect(gate.getSnapshot().pending).toBe(true);
  source.brief.title='changed outside';expect(snapshot?.brief.title).toBe('Typed test fact');
  gate.cancel();expect(signal?.aborted).toBe(true);expect(gate.getSnapshot().pending).toBe(false);
  held.resolve({artifactId:'late',label:'Must be discarded'});await pending;
  expect(gate.getSnapshot().receipt).toBeNull();expect(gate.isReviewed('exact')).toBe(false);
 });
 it.each(['edit','edit-revert','hide','scope','unmount'] as const)('discards a real pending callback after %s',async(reason)=>{
  const gate=new ProcessReviewGate(),held=deferred<{artifactId:string;label:string}>();let current=true,signal:AbortSignal|undefined;
  gate.review('exact',true);
  const work=gate.run(draftFixture(),'exact',(_draft,_key,abort)=>{signal=abort;return held.promise;},()=>current);
  if(reason==='edit'||reason==='edit-revert'){gate.edit();if(reason==='edit-revert')gate.edit();}
  else {current=false;gate.cancel();}
  held.resolve({artifactId:'stale-test-receipt',label:'Stale'});await work;
  expect(signal?.aborted).toBe(true);expect(gate.getSnapshot().receipt).toBeNull();expect(gate.getSnapshot().pending).toBe(false);
 });
 it('leaves the request genuinely pending without timers and consumes review on actual acceptance',async()=>{
  const gate=new ProcessReviewGate(),held=deferred<{artifactId:string;label:string}>(),updates:number[]=[];
  const unsubscribe=gate.subscribe(()=>updates.push(gate.getSnapshot().revision));
  gate.review('exact',true);
  const work=gate.run(draftFixture(),'exact',()=>held.promise,()=>true);
  await Promise.resolve();expect(gate.getSnapshot().pending).toBe(true);expect(gate.getSnapshot().receipt).toBeNull();
  held.resolve({artifactId:'exact-returned-id',label:'Actual callback label'});await work;
  expect(gate.getSnapshot().receipt).toEqual({artifactId:'exact-returned-id',label:'Actual callback label',reviewKey:'exact'});
  expect(gate.getSnapshot().pending).toBe(false);expect(gate.isReviewed('exact')).toBe(false);expect(updates.length).toBeGreaterThan(0);
  unsubscribe();const count=updates.length;gate.edit();expect(updates).toHaveLength(count);expect(gate.getSnapshot().receipt).toBeNull();
 });
 it.each(['reject','malformed'] as const)('fails closed on %s without leaking raw errors or silently retrying',async(mode)=>{
  const gate=new ProcessReviewGate();let calls=0;gate.review('exact',true);
  await gate.run(draftFixture(),'exact',async()=>{calls++;if(mode==='reject')throw new Error('PRIVATE_ERROR_SENTINEL');return {artifactId:'',label:''};},()=>true);
  expect(calls).toBe(1);expect(gate.getSnapshot().receipt).toBeNull();expect(gate.getSnapshot().error).toBe(true);
  expect(gate.getSnapshot().message).not.toContain('PRIVATE_ERROR_SENTINEL');expect(gate.isReviewed('exact')).toBe(false);
 });
 it('keeps a newer pending attempt intact when a cancelled older callback settles',async()=>{
  const gate=new ProcessReviewGate(),old=deferred<{artifactId:string;label:string}>(),fresh=deferred<{artifactId:string;label:string}>();
  gate.review('old',true);const previous=gate.run(draftFixture(),'old',()=>old.promise,()=>true);gate.cancel();
  gate.review('new',true);const current=gate.run(draftFixture(),'new',()=>fresh.promise,()=>true);
  old.resolve({artifactId:'old',label:'Discard'});await previous;expect(gate.getSnapshot().pending).toBe(true);expect(gate.getSnapshot().receipt).toBeNull();
  fresh.resolve({artifactId:'new',label:'Keep'});await current;expect(gate.getSnapshot().receipt?.artifactId).toBe('new');
 });
 it('refuses a new request when the rendered context is already inactive',async()=>{
  const gate=new ProcessReviewGate();let calls=0;gate.review('exact',true);
  await gate.run(draftFixture(),'exact',async()=>{calls++;return {artifactId:'never',label:'Never'};},()=>false);
  expect(calls).toBe(0);
 });
});

describe('ROI input and modal keyboard boundaries',()=>{
 it('keeps blank assumptions unknown, admits zero and refuses coerced/out-of-bound integers',()=>{
  for(const key of ROI_ASSUMPTION_KEYS){expect(parseRoiIntegerInput('',key)).toBeNull();expect(parseRoiIntegerInput('0',key)).toBe(0);}
  for(const raw of ['-1','1.5','1e3',' 2','2 ','NaN','Infinity','9007199254740992'])expect(parseRoiIntegerInput(raw,'annualVolume')).toBe('invalid');
  expect(parseRoiIntegerInput('10001','adoptionBasisPoints')).toBe('invalid');
  expect(parseRoiIntegerInput('10000','adoptionBasisPoints')).toBe(10000);
  expect(parseRoiIntegerInput('31536001','targetSeconds')).toBe('invalid');
 });
 it('wraps only at live modal boundaries including missing focus',()=>{
  expect(dialogFocusTarget(3,0,true)).toBe(2);expect(dialogFocusTarget(3,2,false)).toBe(0);
  expect(dialogFocusTarget(3,-1,false)).toBe(0);expect(dialogFocusTarget(3,-1,true)).toBe(2);
  expect(dialogFocusTarget(3,1,false)).toBeNull();expect(dialogFocusTarget(0,-1,false)).toBe(-1);
 });
});

describe('Process discovery server render (not mounted browser proof)',()=>{
 it('starts blank and blocked with explicit unknown ROI and no granted or live state',()=>{
  let sends=0;
  const html=renderToStaticMarkup(createElement(ProcessStudio,{active:true,scopeEpoch:0,projectId:'',buildAvailable:false,buildUnavailableReason:'Authenticate to build.',onBuild:async()=>{sends++;throw new Error('No send');},onOpenStudio:()=>{},onConnectionSettings:()=>{}}));
  expect(sends).toBe(0);
  expect(html).toContain('Process discovery');expect(html).toContain('Process name');
  expect(html).toContain('Session only');expect(html).toContain('No template selected');
  expect(html).toContain('value="unanswered" selected');
  expect(html).not.toContain('value="public" selected');
  expect(html).toContain('Unknown — no estimate');expect(html).toContain('currency');
  expect(html).toContain('Draft ceilings, not grants');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Build V1 draft<\/button>/);
  expect(html).not.toContain('role="progressbar"');expect(html).not.toContain('<dialog');
 });
 it('keeps an inactive retained area hidden and inert without sending during SSR',()=>{
  let calls=0;
  const html=renderToStaticMarkup(createElement(ProcessStudio,{active:false,scopeEpoch:7,projectId:'test',buildAvailable:true,buildUnavailableReason:'',onBuild:async()=>{calls++;return {artifactId:'never',label:'Never'};},onOpenStudio:()=>{},onConnectionSettings:()=>{}}));
  expect(html).toMatch(/aria-label="Process discovery workspace" hidden="" inert=""/);expect(calls).toBe(0);
 });
 it('keeps component IO out of scope and uses a keyed pre-effect privacy boundary',()=>{
  const source=readFileSync(new URL('./ProcessStudio.tsx',import.meta.url),'utf8');
  expect(source).not.toMatch(/\b(?:fetch|localStorage|sessionStorage|indexedDB|XMLHttpRequest)\s*(?:\(|\.)/);
  expect(source).toContain('key={JSON.stringify([props.scopeEpoch,props.projectId])}');
  expect(source).toContain('current.current=props');expect(source).toContain('scopeIsCurrent');
 });
 it('scopes theme CSS and gives pending decoration reduced/off motion and contained modal geometry',()=>{
  const css=readFileSync(new URL('./ProcessStudio.css',import.meta.url),'utf8');
  expect(css).not.toMatch(/(?:^|\n)\s*(?:html|body|:root)\b/);expect(css).toContain('var(--surface,#fff)');expect(css).toContain('var(--te,#e98300)');
  expect(css).toContain('prefers-reduced-motion:reduce');expect(css).toContain('[data-motion=off]');expect(css).toContain('max-height:calc(100dvh - 20px)');expect(css).toContain('pointer-events:none');
 });
});

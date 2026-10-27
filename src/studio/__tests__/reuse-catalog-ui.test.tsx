import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {StudioApp} from '../StudioApp';
import * as StudioRoot from '../StudioApp';
import {StudioController} from '../controller';
import {existsSync,readFileSync} from 'node:fs';

it('U14 keeps the maintained native acceptance entry on the actual StudioApp/core with DEVELOPMENT-only controlled ports',()=>{
  const path=new URL('./reuse-catalog.browser.tsx',import.meta.url);
  expect(existsSync(path)).toBe(true);if(!existsSync(path))return;
  const source=readFileSync(path,'utf8');
  expect(source).toContain("import {StudioApp} from '../StudioApp'");
  expect(source).toContain('createPublicReuseCatalog');expect(source).toContain('<StrictMode>');
  expect(source).toContain('DEVELOPMENT ONLY');expect(source).toContain('reuseCatalog={catalog}');
  expect(source).not.toMatch(/\b(?:fetch|localStorage|sessionStorage|indexedDB|eval|WebSocket)\s*\(/);
  expect(source).not.toContain('reactFiber');expect(source).not.toContain('approveSkillSend(');
});

it('U16 the delayed DEVELOPMENT port resolves current factory data after its hold, not a stale precomputed DTO',()=>{
  const source=readFileSync(new URL('./reuse-catalog.browser.tsx',import.meta.url),'utf8');
  expect(source).toContain("await hold('detail');return api.detail(input)");
  expect(source).toContain("await hold('list');return api.list(input)");
});

it('U02 creates a stable local public-catalog session without writes or automatic effects',async()=>{
  const factory=(StudioRoot as unknown as {createStudioReuseBridge?:typeof StudioRoot.createStudioReuseBridge}).createStudioReuseBridge;
  expect(typeof factory).toBe('function');
  if(!factory)return;
  let writes=0,invalidations=0;
  const bridge=factory({invalidateSendReview:()=>{invalidations++;},setPrompt:()=>{writes++;},preview:()=>({projectId:'',connectionId:'',authoringEngine:'json-planner',pendingAnswers:{},pendingContext:null}),available:()=>true});
  const disconnect=bridge.connect();
  expect(await bridge.reuse.open('{}')).toBe(true);
  expect(bridge.reuse.getState().rows).toHaveLength(12);
  expect(bridge.reuse.getState().candidate).toBeNull();
  expect(JSON.parse(bridge.composer.read() as string)).toEqual({contextEpoch:0,revision:0,text:''});
  bridge.reuse.close();expect(writes).toBe(0);expect(invalidations).toBe(0);
  disconnect();
});

it('U09 binds the actual root entry to a dialog capability while preserving the explicit request form and no automatic effects',()=>{
  const controller=new StudioController(()=>Promise.reject(new Error('Development no-effect boundary')));
  const before=controller.getState(),workbench=controller.workbench.getState();let calls=0;
  const html=renderToStaticMarkup(<StudioApp controller={controller} fetcher={async()=>{calls++;throw Error('Development no-effect boundary');}}/>);
  const trigger=html.match(/<button\b[^>]*aria-label="Browse reusable sources"[^>]*>/)?.[0];
  expect(trigger).toMatch(/aria-haspopup="dialog"/);
  expect(html).not.toContain('class="reuse-picker-dialog"');expect(html).not.toContain('Exact insertion preview');
  expect(html).toContain('maxLength="8000"');expect(html).toContain('Create draft');
  expect(controller.getState()).toBe(before);expect(controller.workbench.getState()).toBe(workbench);expect(calls).toBe(0);
});

it('makes public-source reuse reachable from chat without backend credentials or a model',()=>{
  let calls=0;
  const fetcher:typeof fetch=(..._args)=>{
    calls++;
    return Promise.reject(new Error('Unexpected network access in the static reuse entry test.'));
  };
  const html=renderToStaticMarkup(<StudioApp fetcher={fetcher}/>);
  expect(calls).toBe(0);
  const trigger=html.match(/<button\b[^>]*aria-label="Browse reusable sources"[^>]*>/)?.[0];
  expect(trigger,'The public-static reuse picker must be reachable before model setup.').toBeDefined();
  expect(trigger).not.toMatch(/\bdisabled(?:[\s=>])/);
});

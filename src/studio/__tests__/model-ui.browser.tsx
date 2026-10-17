// Explicit browser test harness only. Not imported by any production entry.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioApp } from '../StudioApp';
import { StudioController } from '../controller';
import type { ModelConnectionDescriptor } from '../connection';
import { workspaceGraphSchema, type WorkspaceDraft } from '../workspace-client';
const subappFixture = { status: 'subapp-result', target: 'subapp', determination: { target: 'subapp', reason: 'Fixture application' }, outcome: { status: 'proposed', understanding: 'Fixture', generated: { plan: { id: 'fixture', label: 'Fixture app', version: '1', routePrefix: '/api/fixture', webModuleId: 'fixture', envVar: 'FIXTURE_ENABLED', tablePrefix: 'fixture_', manifestData: { icon: '📋', navSection: 'Apps', capabilities: [], visibleToRoles: [] } }, files: [], warnings: ['Fixture only; not mounted'] }, conformance: { ok: false, findings: [], rules: [] }, artifacts: {} } };

export async function runMountedModelUi() {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); const checks: string[] = [];
  const tick = () => new Promise(r => setTimeout(r, 30));
  const assert = (ok: unknown, label: string) => { if (!ok) throw new Error(label); checks.push(label); };
  const get = <T extends Element>(selector: string) => { const node = host.querySelector<T>(selector); if (!node) throw new Error(`Missing ${selector}`); return node; };
  const button = (text: string) => { const b = [...host.querySelectorAll('button')].find(b => b.textContent === text); if (!b) throw new Error(`Missing button ${text}`); return b; };
  const input = async (node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await tick();
  };
  const descriptors: ModelConnectionDescriptor[] = [
    { id: 'codex-chatgpt', label: 'ChatGPT subscription (native Codex)', model: null, status: 'unavailable', verification: 'not-probed', reason: 'Zero-tool boundary not verified' },
    { id: 'flightdeck', label: 'Flightdeck model service', model: null, status: 'unavailable', verification: 'not-probed', reason: 'Approved Studio bridge unavailable' },
    { id: 'local', label: 'Local model', model: 'fixture-local', status: 'configured', verification: 'not-probed' },
    { id: 'anthropic', label: 'Anthropic API', model: 'fixture-anthropic', status: 'configured', verification: 'not-probed' },
  ];
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const calls: { url: string; init?: RequestInit }[] = [];
  let mode: 'needs' | 'review' | 'subapp' | 'late' = 'needs'; let staleHealth = false;
  let releaseHealth!: (response: Response) => void; let releaseCreate!: (response: Response) => void;
  const health = { ok: true, selectedId: null, model: null, modelStatus: 'unselected', verification: 'not-probed' };
  const review = { status: 'model-request-refused', decision: { decision: 'refuse', reason: 'Human review required', contentHash: 'a'.repeat(64) }, review: { hash: 'a'.repeat(64), preview: 'Bounded fixture context', unchecked: [] }, skillSourceState: 'loaded' };
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    if (String(url).endsWith('/health')) return staleHealth ? new Promise(r => { releaseHealth = r; }) : json(health);
    if (String(url).endsWith('/model-connections')) return json({ connections: descriptors, selectedId: null });
    if (String(url).endsWith('/skills')) return json({ projectId: 'project-a', skillSourceState: 'empty', skillSources: [] });
    if (String(url).endsWith('/create')) {
      if (mode === 'late') return new Promise(r => { releaseCreate = r; });
      return json(mode === 'review' ? review : mode === 'subapp' ? subappFixture : { status: 'needs_input', questions: [{ id: 'country', question: 'Which country?' }] });
    }
    if (String(url).endsWith('/blocks/propose')) return json({ status: 'block-proposed', reviewRequired: true, block: { id: 'reviewFields', label: 'Review fields', baseType: 'set', defaults: { fields: { reviewNeeded: true } }, description: 'Fixture reviewed block' } });
    throw new Error('Unexpected fixture transport request');
  };
  const controller = new StudioController(fetcher);
  const originalFetch = globalThis.fetch;
  let savedDraft: WorkspaceDraft | null = null;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('/api/studio/workspaces/project-a/workflows')) throw new Error('Unexpected workspace fixture request');
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { graph: unknown };
      const graph = workspaceGraphSchema.parse(body.graph);
      savedDraft = { id: '12345678-1234-4123-8123-123456789abc', projectId: 'project-a', revision: 1, status: 'draft', createdBy: 'Fixture operator', updatedBy: 'Fixture operator', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', approvalBindings: [], graph };
      return json({ draft: savedDraft });
    }
    if (String(url).endsWith('/runs')) return json({ runs: [] });
    if (String(url).endsWith('/12345678-1234-4123-8123-123456789abc')) return json({ draft: savedDraft });
    return json({ drafts: savedDraft ? [{ ...savedDraft, graph: undefined, name: savedDraft.graph.name }] : [] });
  };
  try {
    root.render(createElement(StudioApp, { controller, fetcher })); await tick();
    assert(host.innerText.includes('No backend credentials supplied'), 'uncredentialed demo explains missing backend credentials in the visible editor');
    button('AI builder').click(); await tick();
    assert(calls.length === 0, 'mount makes no transport/model call');
    await input(get<HTMLInputElement>('input[placeholder="STUDIO_OPERATOR_TOKEN"]'), 'fixture-not-a-real-credential');
    await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'), 'project-a');
    await input(get<HTMLTextAreaElement>('textarea[placeholder="What should this project help people do?"]'), 'Review incoming requests.');
    button('Check connection & project skills').click(); await tick(); await tick();
    assert(calls.length === 3 && calls.every(c => c.init?.credentials === 'same-origin' && new Headers(c.init?.headers).has('Authorization')), 'descriptor check authenticates same-origin DTO reads only');
    const select = get<HTMLSelectElement>('[aria-label="Model connection"]');
    assert(select.value === '' && button('Create draft').disabled, 'configured provider is not implicitly selected');
    assert(select.options[1]?.disabled && select.options[2]?.disabled && host.textContent?.includes('Zero-tool boundary not verified'), 'unavailable choices and reasons remain visible');
    await input(select, 'local'); assert(!button('Create draft').disabled, 'explicit configured selection enables create');
    button('Create draft').click(); await tick(); await tick();
    assert(JSON.parse(String(calls.at(-1)?.init?.body)).connectionId === 'local', 'create binds selected destination');
    await input(get<HTMLInputElement>('.studio-card input:not([type="checkbox"])'), 'DE');
    button('Submit answers').click(); await tick(); await tick();
    const answer = JSON.parse(String(calls.at(-1)?.init?.body));
    assert(answer.connectionId === 'local' && answer.answers.country === 'DE', 'clarification retains destination and answers');
    mode = 'review'; button('Create draft').click(); await tick(); await tick();
    get<HTMLInputElement>('[aria-label="Skill send review"] input').click(); await tick();
    button('Send reviewed context to model').click(); await tick(); await tick();
    const approved = JSON.parse(String(calls.at(-1)?.init?.body));
    assert(approved.connectionId === 'local' && approved.reviewedSkillHash === 'a'.repeat(64), 'explicit review binds original selected ID and hash');
    await input(select, 'anthropic');
    assert(!host.querySelector('[aria-label="Skill send review"]') && controller.getState().result === null, 'destination change clears skill review and original request');
    mode = 'late'; button('Create draft').click(); await tick();
    const pending = calls.at(-1)?.init?.signal;
    await input(select, 'local'); releaseCreate(json(review)); await tick(); await tick();
    assert(pending?.aborted && controller.getState().result === null, 'destination change aborts and suppresses late create result');
    mode = 'review'; button('Create draft').click(); await tick(); await tick();
    await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'), 'project-b');
    assert(!host.querySelector('[aria-label="Skill send review"]') && select.value === '' && button('Create draft').disabled, 'project change clears review and authenticated descriptors');
    await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'), 'project-a');
    staleHealth = true; button('Check connection & project skills').click(); await tick();
    const read = calls.at(-1)?.init?.signal;
    await input(get<HTMLInputElement>('input[placeholder="STUDIO_OPERATOR_TOKEN"]'), 'different-fixture-credential');
    releaseHealth(json(health)); await tick(); await tick();
    assert(read?.aborted && select.value === '' && [...select.options].slice(1).every(o => o.disabled) && button('Create draft').disabled, 'changed credentials cannot accept stale descriptor result');
    staleHealth = false; button('Check connection & project skills').click(); await tick(); await tick();
    await input(select, 'local'); mode = 'subapp'; button('Create draft').click(); await tick(); await tick();
    await input(get<HTMLTextAreaElement>('[aria-label="Describe the mini-app"]'), 'Regenerate fixture application');
    button('Build').click(); await tick(); await tick();
    assert(JSON.parse(String(calls.at(-1)?.init?.body)).connectionId === 'local', 'workbench regeneration transport retains explicit ID');
    button('Workflow builder').click(); await tick();
    button('Custom block').click(); await tick();
    await input(get<HTMLInputElement>('[aria-label="Review custom block"] input:not([type="checkbox"])'), 'Mark requests for review.');
    button('Propose block').click(); await tick(); await tick();
    assert(JSON.parse(String(calls.at(-1)?.init?.body)).connectionId === 'local' && get<HTMLTextAreaElement>('[aria-label="Custom block JSON"]').value.includes('reviewFields'), 'mounted block proposal binds explicit destination and validates reviewed DTO');
    // Graph/workspace state retention is checked using the actual mounted child instances.
    const editor = get('[aria-label="Workflow graph editor"]'); const workspace = get('[aria-label="Workflow workspace"]');
    await input(get<HTMLInputElement>('[aria-label="Workflow name"]'), 'Retained provider draft');
    await input(get<HTMLTextAreaElement>('[aria-label="Server run input"]'), '{"approved":true}');
    button('AI builder').click(); await tick(); await input(select, '');
    button('Workflow builder').click(); await tick();
    assert(editor === get('[aria-label="Workflow graph editor"]') && workspace === get('[aria-label="Workflow workspace"]') && get<HTMLInputElement>('[aria-label="Workflow name"]').value === 'Retained provider draft' && get<HTMLTextAreaElement>('[aria-label="Server run input"]').value === '{"approved":true}', 'navigation preserves mounted editor graph and workspace input');
    assert(!get<HTMLButtonElement>('[aria-label="Save as new draft"]').disabled, 'workspace save remains usable without model selection');
    get<HTMLButtonElement>('[aria-label="Save as new draft"]').click(); await tick(); await tick();
    assert(workspace.textContent?.includes('Current draft: 12345678-1234-4123-8123-123456789abc') && !get<HTMLButtonElement>('[aria-label="Run saved revision"]').disabled, 'saved fixture identity readback enables deterministic execution without model selection');
    await input(get<HTMLInputElement>('[aria-label="Workflow name"]'), 'Dirty retained draft');
    button('AI builder').click(); await tick(); button('Workflow builder').click(); await tick();
    assert(workspace === get('[aria-label="Workflow workspace"]') && workspace.textContent?.includes('12345678-1234-4123-8123-123456789abc') && get<HTMLInputElement>('[aria-label="Workflow name"]').value === 'Dirty retained draft', 'saved identity and dirty typed graph survive builder navigation');
    get<HTMLButtonElement>('[aria-label="Refresh saved drafts"]').click(); await tick(); await tick();
    get<HTMLButtonElement>('[aria-label="Load draft 12345678-1234-4123-8123-123456789abc"]').click(); await tick();
    get<HTMLButtonElement>('[aria-label="Discard edits and load draft"]').click(); await tick(); await tick();
    const loadedEvidence = { editorReplaced: editor !== get('[aria-label="Workflow graph editor"]'), workspaceRetained: workspace === get('[aria-label="Workflow workspace"]'), name: get<HTMLInputElement>('[aria-label="Workflow name"]').value, workspace: workspace.textContent?.slice(-1800) };
    if (!loadedEvidence.editorReplaced || !loadedEvidence.workspaceRetained || loadedEvidence.name !== 'Retained provider draft' || !workspace.textContent?.includes('12345678-1234-4123-8123-123456789abc')) throw new Error(`Workspace load evidence: ${JSON.stringify(loadedEvidence)}`);
    assert(true, 'workspace load remounts editor only and preserves saved document identity');
    return { checks, requestCount: calls.length, liveCompletion: false };
  } finally { root.unmount(); host.remove(); globalThis.fetch = originalFetch; }
}

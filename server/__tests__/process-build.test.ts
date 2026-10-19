import Fastify, { type RouteShorthandOptions } from 'fastify';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { presentsOperatorToken } from '../index';
import { RequestAdmission } from '../request-admission';
import { registerProcessBuildRoutes } from '../process-build';
import { emptyProcessDraft, buildProcessPlan, PROCESS_TEMPLATES } from '../../src/process-studio/plan';
import type { ProcessDraft, ProcessTemplateId } from '../../src/process-studio/contracts';
import { generateSubApp } from '../../packages/codegen/src/pure';
import { parseStudioResult } from '../../src/studio/result';
import * as nativePipeline from '../../packages/pipeline/src/build-subapp-spec';
import * as connections from '../model-connections';

const path = '/api/studio/process/build';
const operator = { actor: 'Development Operator', token: 'public-process-build-development-only' };
const authorization = `Bearer ${operator.token}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const headers = { authorization, host: '127.0.0.1:3111', 'content-type': 'application/json' };
function completeDraft(templateId: ProcessTemplateId = 'operations-queue'): ProcessDraft {
  const draft = emptyProcessDraft();
  Object.assign(draft.brief, { title: 'Process review', problem: 'Review requests are scattered across a manual intake queue.', outcome: 'Prepare a reviewable request without changing source records.', users: 'Operations staff and independent human reviewers', systemOfRecord: 'Workspace contract references; no external connector is configured.', dataSensitivity: 'internal', templateId, v1Features: ['Prepare one bounded human-review proposal'], v2Features: ['Explore additional sources only after separate review'], acceptanceCriteria: ['A proposal is not an approval or a completed process step'] });
  Object.assign(draft.choices, { appId: 'process-review', icon: '📋', navSection: 'Ops & insight', visibleToRoles: ['legal'], consentedScopes: [...PROCESS_TEMPLATES.find(template => template.id === templateId)!.requiredScopes] });
  return draft;
}
function reviewed(draft = completeDraft(), projectId = 'alpha') {
  const plan = buildProcessPlan(draft);
  if (plan.status !== 'ready') throw new Error(`Complete fixture must be ready: ${JSON.stringify(plan)}`);
  return { projectId, draft, reviewKey: plan.reviewKey };
}

function fixture(intake?: RouteShorthandOptions, admission = new RequestAdmission()) {
  const app = Fastify({ logger: false });
  registerProcessBuildRoutes(app, { operator, digest, admission, intake: intake ?? {
    onRequest: async (request, reply) => {
      if (!presentsOperatorToken(request.headers.authorization, operator.token)) return reply.code(401).send({ error: 'operator token required' });
    },
  } });
  return { app, admission };
}
function wire(address: string, body: string, contentType: string, authenticated: boolean) {
  return new Promise<{ status: number | undefined; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const client = httpRequest(address + path, { method: 'POST', headers: {
      'content-type': contentType, 'content-length': Buffer.byteLength(body),
      ...(authenticated ? { authorization } : {}),
    } }, response => {
      let received = '';
      response.setEncoding('utf8'); response.on('data', chunk => { received += chunk; });
      response.on('error', reject);
      response.on('end', () => { resolve({ status: response.statusCode, headers: response.headers, body: received }); client.destroy(); });
    });
    client.setTimeout(3000, () => { client.destroy(new Error('wire response deadline')); });
    client.on('error', reject); client.end(body);
  });
}

it('authenticates native HTTP before malformed, oversized and non-JSON uploads, with fixed no-store responses', async () => {
  const { app, admission } = fixture();
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    for (const entry of [
      { body: '{"private-body-sentinel":', type: 'application/json', code: 400, error: 'malformed process request' },
      { body: JSON.stringify({ value: 'x'.repeat(65536) }), type: 'application/json', code: 413, error: 'process request too large' },
      { body: 'private-body-sentinel', type: 'text/plain', code: 415, error: 'process JSON required' },
      { body: 'private-body-sentinel', type: 'application/private-sentinel', code: 415, error: 'process JSON required' },
    ]) for (const authenticated of [false, true]) {
      const result = await wire(address, entry.body, entry.type, authenticated);
      expect(result.status).toBe(authenticated ? entry.code : 401);
      expect(JSON.parse(result.body)).toEqual({ error: authenticated ? entry.error : 'operator token required' });
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body).not.toContain('sentinel');
    }
    expect(admission.snapshot().active).toBe(0);
  } finally { await app.close(); }
});

it('returns stable missing-choice questions without acquiring admission or generating source', async () => {
  const { app, admission } = fixture();
  const acquire = vi.spyOn(admission, 'acquire');
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec');
  try {
    const response = await app.inject({ method: 'POST', url: path, headers, payload: { projectId: 'alpha', draft: emptyProcessDraft(), reviewKey: 'unready-review' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(buildProcessPlan(emptyProcessDraft()));
    expect(response.json().questions.length).toBeGreaterThan(0);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(acquire).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  } finally { build.mockRestore(); await app.close(); }
});

it('requires a strict canonical project and bounded exact ProcessDraft before any expensive work', async () => {
  const { app, admission } = fixture();
  const acquire = vi.spyOn(admission, 'acquire');
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec');
  const valid = { projectId: 'alpha', draft: emptyProcessDraft(), reviewKey: 'unready-review' };
  const { projectId: _projectId, ...noProject } = valid;
  const { reviewKey: _reviewKey, ...noReview } = valid;
  try {
    for (const payload of [
      null, [], true, 1, {}, noProject, noReview,
      ...['', 'Alpha', ' alpha', 'alpha ', 'alpha--beta', 'alpha-', '-alpha', '../alpha', 'a'.repeat(65)].map(projectId => ({ ...valid, projectId })),
      ...['actor', 'principals', 'roles', 'catalog', 'prd', 'spec', 'humanInput', 'answers', 'connectionId', 'maxPayloadTier', 'datasource', 'registrySource', 'templateVersion'].map(key => ({ ...valid, [key]: 'private-field-sentinel' })),
      { ...valid, draft: { ...valid.draft, grant: true } },
      { ...valid, draft: { ...valid.draft, brief: { ...valid.draft.brief, title: 'x'.repeat(81) } } },
      { ...valid, draft: { ...valid.draft, brief: { ...valid.draft.brief, v1Features: Array(7).fill('not a feature') } } },
      { ...valid, draft: { ...valid.draft, choices: { ...valid.draft.choices, consentedScopes: ['read:all'] } } },
      { ...valid, draft: { ...valid.draft, choices: { ...valid.draft.choices, visibleToRoles: ['super_admin'] } } },
      { ...valid, reviewKey: '' }, { ...valid, reviewKey: 7 }, { ...valid, reviewKey: 'x'.repeat(32769) },
      JSON.parse('{"projectId":"alpha","draft":{"__proto__":{"grant":true}},"reviewKey":"x"}'),
    ]) {
      const response = await app.inject({ method: 'POST', url: path, headers, payload: JSON.stringify(payload) });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'malformed process request' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain('private-field-sentinel');
    }
    const query = await app.inject({ method: 'POST', url: path + '?actor=untrusted', headers, payload: valid });
    expect(query.statusCode).toBe(400);
    expect(acquire).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  } finally { build.mockRestore(); await app.close(); }
});

it('rechecks the operator after parsing even if a trusted intake continuation alters authorization', async () => {
  const { app, admission } = fixture({
    onRequest: async (request, reply) => {
      if (!presentsOperatorToken(request.headers.authorization, operator.token)) return reply.code(401).send({ error: 'operator token required' });
    },
    preValidation: async request => { request.headers.authorization = 'Bearer no-longer-the-operator'; },
  });
  try {
    const response = await app.inject({ method: 'POST', url: path, headers, payload: { projectId: 'alpha', draft: emptyProcessDraft(), reviewKey: 'unready-review' } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'operator token required' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(admission.snapshot().active).toBe(0);
  } finally { await app.close(); }
});

it('refuses a stale or edited exact review before admission and source generation', async () => {
  const { app, admission } = fixture();
  const acquire = vi.spyOn(admission, 'acquire');
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec');
  try {
    const payload = reviewed();
    const revised = completeDraft(); revised.brief.v2Features.push('Consider another separately reviewed enhancement');
    for (const candidate of [
      { ...payload, reviewKey: 'stale' }, { ...payload, reviewKey: payload.reviewKey + ' ' },
      { ...payload, draft: revised },
      { ...payload, draft: { ...payload.draft, choices: { ...payload.draft.choices, visibleToRoles: ['legal', 'admin'] } } },
      { ...payload, reviewKey: JSON.stringify({ ...JSON.parse(payload.reviewKey), template: { id: 'operations-queue', version: '0.9.0' } }) },
      { ...payload, reviewKey: JSON.stringify({ ...JSON.parse(payload.reviewKey), format: 'flightdeck-process-plan/0' }) },
    ]) {
      const response = await app.inject({ method: 'POST', url: path, headers, payload: candidate });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ status: 'process-refused', issues: ['process review mismatch'] });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain(payload.reviewKey);
    }
    expect(acquire).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  } finally { build.mockRestore(); await app.close(); }
});

it.each(['operations-queue', 'case-workspace', 'analytical-report'] as const)('genuinely builds the reviewed %s SDK template with inert native output, exact ordered-files hash and zero model resolution', async templateId => {
  const { app, admission } = fixture();
  const payload = reviewed(completeDraft(templateId));
  const plan = buildProcessPlan(payload.draft);
  if (plan.status !== 'ready') throw new Error('expected ready fixture');
  const expected = generateSubApp(plan.spec);
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec');
  const acquire = vi.spyOn(admission, 'acquire');
  const resolve = vi.spyOn(connections, 'createModelConnections').mockImplementation(() => { throw new Error('model resolver forbidden'); });
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('model or provider call forbidden'));
  try {
    const response = await app.inject({ method: 'POST', url: path, headers, payload });
    expect(response.statusCode).toBe(200);
    const value = response.json();
    expect(value.status, response.body).toBe('process-built');
    expect(Object.keys(value).sort()).toEqual(['status', 'projectId', 'reviewKey', 'templateId', 'templateVersion', 'artifactId', 'outcome'].sort());
    expect(value).toMatchObject({ projectId: payload.projectId, reviewKey: payload.reviewKey, templateId, templateVersion: PROCESS_TEMPLATES.find(template => template.id === templateId)!.version });
    expect(value.outcome.status).toBe('proposed');
    expect(value.outcome.conformance.ok).toBe(true);
    expect(value.outcome.artifacts.decision).toBe('allow');
    expect(value.outcome.generated.files).toEqual(expected.files);
    expect(value.outcome.generated.files.some((file: { kind: string }) => file.kind === 'standalone')).toBe(true);
    const ordered = value.outcome.generated.files.map((file: { path: string; kind: string; contents: string }) => ({ path: file.path, kind: file.kind, contents: file.contents }));
    expect(value.artifactId).toBe(digest(JSON.stringify(ordered)));
    expect(value.artifactId).toMatch(/^[a-f0-9]{64}$/);
    expect(value.artifactId).not.toBe(digest(JSON.stringify([...ordered].reverse())));
    expect(value.outcome.generated.registryPatch).toEqual({ file: expected.registryPatch.file, importLine: expected.registryPatch.importLine, entryLines: expected.registryPatch.entryLines });
    expect(Object.keys(value.outcome.generated.registryPatch).sort()).toEqual(['entryLines', 'file', 'importLine']);
    expect(parseStudioResult({ status: 'subapp-result', target: 'subapp', determination: { target: 'subapp', reason: 'Explicit registered template' }, outcome: value.outcome })).toMatchObject({ status: 'subapp-result', outcome: { status: 'proposed' } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]?.[0]).toEqual({ prompt: plan.buildPrompt, spec: plan.spec, understanding: PROCESS_TEMPLATES.find(template => template.id === templateId)!.description, answers: { icon: payload.draft.choices.icon, navSection: payload.draft.choices.navSection, visibleToRoles: payload.draft.choices.visibleToRoles.join(','), ...Object.fromEntries(payload.draft.choices.consentedScopes.map(scope => [`consent:${scope}`, 'yes'])) } });
    expect(build.mock.calls[0]?.[1]).toEqual({ ctx: { actor: operator.actor }, digest, authorship: 'first-party-operator' });
    expect(acquire).toHaveBeenCalledWith(operator.actor, payload.projectId, expect.anything());
    expect(admission.snapshot()).toEqual({ active: 0, actors: 0, projects: 0, accepting: true });
    expect(resolve).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); resolve.mockRestore(); build.mockRestore(); await app.close(); }
});

it('retains shared admission through original slow work after a deadline and rejects its stale result', async () => {
  const { app, admission } = fixture(undefined, new RequestAdmission({ global: 1, deadlineMs: 20, drainMs: 20 }));
  const gate = barrier();
  let entered = 0;
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec').mockImplementation(async () => {
    entered++; await gate.promise;
    return { status: 'generation-refused', issues: ['private-fixture-exception-detail'] };
  });
  const acquire = vi.spyOn(admission, 'acquire');
  let settled = false;
  const pending = app.inject({ method: 'POST', url: path, headers, payload: reviewed() }).then(response => { settled = true; return response; });
  try {
    await vi.waitFor(() => expect(entered).toBe(1));
    const permit = acquire.mock.results[0]?.value;
    await vi.waitFor(() => expect(permit.signal.aborted).toBe(true));
    expect(settled).toBe(false);
    expect(admission.snapshot().active).toBe(1);
    const refused = await app.inject({ method: 'POST', url: path, headers, payload: reviewed(completeDraft(), 'novel-project') });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: 'request capacity unavailable' });
    expect(refused.headers['retry-after']).toBe('1');
    expect(refused.headers['cache-control']).toBe('no-store');
    expect(entered).toBe(1);
    gate.release();
    const stale = await pending;
    expect(stale.statusCode).toBe(503);
    expect(stale.json()).toEqual({ status: 'process-refused', issues: ['process build unavailable'] });
    expect(stale.body).not.toContain('private-fixture');
    expect(admission.snapshot()).toEqual({ active: 0, actors: 0, projects: 0, accepting: true });
  } finally { gate.release(); await pending; build.mockRestore(); await app.close(); }
});
function barrier() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

it('retains admission through a real socket disconnect until the original fixture operation settles', async () => {
  const { app, admission } = fixture(undefined, new RequestAdmission({ global: 1 }));
  const gate = barrier(); let entered = 0;
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec').mockImplementation(async () => {
    entered++; await gate.promise;
    return { status: 'generation-refused', issues: ['fixture generation refusal'] };
  });
  const acquire = vi.spyOn(admission, 'acquire');
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = httpRequest(address + path, { method: 'POST', headers: { authorization, 'content-type': 'application/json' } });
  const closed = new Promise<void>(resolve => { client.on('error', () => {}); client.on('close', () => resolve()); });
  client.end(JSON.stringify(reviewed()));
  try {
    await vi.waitFor(() => expect(entered).toBe(1));
    client.destroy(); await closed;
    const permit = acquire.mock.results[0]?.value;
    await vi.waitFor(() => expect(permit.signal.aborted).toBe(true));
    expect(admission.snapshot().active).toBe(1);
    const blocked = await app.inject({ method: 'POST', url: path, headers, payload: reviewed(completeDraft(), 'novel') });
    expect(blocked.statusCode).toBe(429);
    expect(entered).toBe(1);
    gate.release();
    await vi.waitFor(() => expect(admission.snapshot().active).toBe(0));
  } finally { client.destroy(); gate.release(); build.mockRestore(); await app.close(); }
});

it('does not reset hung shared capacity during bounded admission shutdown', async () => {
  const { app, admission } = fixture(undefined, new RequestAdmission({ global: 1, drainMs: 20 }));
  const gate = barrier(); let entered = 0;
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec').mockImplementation(async () => {
    entered++; await gate.promise;
    return { status: 'generation-refused', issues: ['fixture generation refusal'] };
  });
  const acquire = vi.spyOn(admission, 'acquire');
  const pending = app.inject({ method: 'POST', url: path, headers, payload: reviewed() }).then(response => response);
  try {
    await vi.waitFor(() => expect(entered).toBe(1));
    await expect(admission.close()).rejects.toThrow('request admission drain incomplete');
    expect(acquire.mock.results[0]?.value.signal.aborted).toBe(true);
    expect(admission.snapshot()).toEqual({ active: 1, actors: 1, projects: 1, accepting: false });
    expect((await app.inject({ method: 'POST', url: path, headers, payload: reviewed() })).statusCode).toBe(429);
    gate.release();
    expect((await pending).statusCode).toBe(503);
    await admission.close();
    expect(admission.snapshot()).toEqual({ active: 0, actors: 0, projects: 0, accepting: false });
    expect(entered).toBe(1);
  } finally { gate.release(); await pending; build.mockRestore(); await app.close(); }
});

it('rejects duplicate choices, excess known scopes, unsupported fields and document bounds without source generation', async () => {
  const { app, admission } = fixture();
  const acquire = vi.spyOn(admission, 'acquire');
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec');
  try {
    const payload = reviewed();
    const drafts = [
      { ...payload.draft, choices: { ...payload.draft.choices, visibleToRoles: ['legal', 'legal'] } },
      { ...payload.draft, choices: { ...payload.draft.choices, consentedScopes: ['write:inbox-proposal', 'write:inbox-proposal'] } },
      { ...payload.draft, choices: { ...payload.draft.choices, consentedScopes: ['write:inbox-proposal', 'read:contracts'] } },
      { ...payload.draft, choices: { ...payload.draft.choices, icon: 'x\nadmin' } },
      { ...payload.draft, choices: { ...payload.draft.choices, appId: '../escape' } },
      { ...payload.draft, brief: { ...payload.draft.brief, dataSensitivity: 'grant-approved' } },
      { ...payload.draft, brief: { ...payload.draft.brief, roi: { ...payload.draft.brief.roi, annualVolume: 1.5 } } },
      { ...payload.draft, brief: { ...payload.draft.brief, v2Features: Array(100).fill('x'.repeat(160)) } },
    ];
    for (const draft of drafts) {
      const response = await app.inject({ method: 'POST', url: path, headers, payload: { ...payload, draft } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'malformed process request' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(acquire).not.toHaveBeenCalled(); expect(build).not.toHaveBeenCalled();
  } finally { build.mockRestore(); await app.close(); }
});

it('sanitizes native pipeline exceptions and all non-proposed outcomes without disclosing their diagnostic fields', async () => {
  const { app, admission } = fixture();
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec');
  try {
    build.mockRejectedValueOnce(new Error('private-exception /private-fixture/location token-fixture'));
    const failed = await app.inject({ method: 'POST', url: path, headers, payload: reviewed() });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ status: 'process-refused', issues: ['process build unavailable'] });
    expect(failed.headers['cache-control']).toBe('no-store');
    for (const outcome of [
      { status: 'generation-refused', issues: ['private-exception /private-fixture/location'] },
      { status: 'invalid_draft', issues: ['private-exception'], attempts: 1 },
      { status: 'blocked', rule: 'private-rule', explanation: 'private-exception', evidence: 'private-evidence' },
    ] as const) {
      build.mockResolvedValueOnce(outcome);
      const refused = await app.inject({ method: 'POST', url: path, headers, payload: reviewed() });
      expect(refused.statusCode).toBe(200);
      expect(refused.json()).toEqual({ status: 'process-refused', issues: ['process generation refused'] });
      expect(refused.headers['cache-control']).toBe('no-store');
      expect(refused.body).not.toMatch(/private-|token-fixture/);
    }
    expect(admission.snapshot().active).toBe(0);
  } finally { build.mockRestore(); await app.close(); }
});

it('does not turn explicit missing scope consent into a yes answer or call the SDK', async () => {
  const { app, admission } = fixture();
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec');
  const acquire = vi.spyOn(admission, 'acquire');
  try {
    const draft = completeDraft(); draft.choices.consentedScopes = [];
    const response = await app.inject({ method: 'POST', url: path, headers, payload: { projectId: 'alpha', draft, reviewKey: 'not-yet-reviewable' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'needs-input', questions: [{ id: 'consent:write:inbox-proposal', question: expect.any(String), because: expect.any(String) }] });
    expect(build).not.toHaveBeenCalled(); expect(acquire).not.toHaveBeenCalled();
  } finally { build.mockRestore(); await app.close(); }
});

it('keeps native privacy gates closed for sensitive human facts with the original payload-tier ceiling', async () => {
  const { app } = fixture();
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec');
  try {
    const draft = completeDraft(); draft.brief.problem = 'Track sick leave, union membership and salary 98000 EUR for person@example.test.';
    const response = await app.inject({ method: 'POST', url: path, headers, payload: reviewed(draft) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'process-refused', issues: ['process generation refused'] });
    expect(response.body).not.toMatch(/person@example|98000|salary|union|sick/);
    // Harder boundary than the original downstream-only refusal: no SDK work.
    expect(build).not.toHaveBeenCalled();
  } finally { build.mockRestore(); await app.close(); }
});

it('does not admit a proposed result whose explicit conformance receipt is false', async () => {
  const { app, admission } = fixture();
  const draft = completeDraft(); const plan = buildProcessPlan(draft);
  if (plan.status !== 'ready') throw new Error('fixture not ready');
  // Real SDK output with intentionally simple fixture prose; this is not the
  // domain compiler acceptance proof exercised by the template tests above.
  const outcome = await nativePipeline.buildSubAppFromSpec({ prompt: 'Prepare a proposal form.', understanding: 'A proposal form for review.', spec: plan.spec, answers: { icon: draft.choices.icon, navSection: draft.choices.navSection!, visibleToRoles: 'legal', 'consent:write:inbox-proposal': 'yes' } }, { ctx: { actor: operator.actor }, digest, authorship: 'first-party-operator' });
  expect(outcome.status).toBe('proposed');
  if (outcome.status !== 'proposed') throw new Error('real native fixture refused');
  const build = vi.spyOn(nativePipeline, 'buildSubAppFromSpec').mockResolvedValueOnce({ ...outcome, conformance: { ...outcome.conformance, ok: false } });
  try {
    const response = await app.inject({ method: 'POST', url: path, headers, payload: reviewed(draft) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'process-refused', issues: ['process generation refused'] });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(admission.snapshot().active).toBe(0);
  } finally { build.mockRestore(); await app.close(); }
});

it('preflights non-native body objects before validators or getters can run', async () => {
  const payload = reviewed();
  let reads = 0;
  const accessor = Object.defineProperty({ ...payload }, 'draft', { enumerable: true, get() { reads++; throw new Error('private getter must not run'); } });
  const cycle: Record<string, unknown> = { ...payload }; cycle.loop = cycle;
  const values = [accessor, cycle, Object.assign(Object.create({ actor: 'untrusted' }), payload), { ...payload, [Symbol('untrusted')]: true }, { ...payload, reviewKey: undefined }];
  for (const value of values) {
    const { app, admission } = fixture({ preValidation: async request => { request.body = value; } });
    const acquire = vi.spyOn(admission, 'acquire');
    try {
      const response = await app.inject({ method: 'POST', url: path, headers, payload: '{}' });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'malformed process request' });
      expect(acquire).not.toHaveBeenCalled();
    } finally { await app.close(); }
  }
  expect(reads).toBe(0);
});

it('requires canonical private same-origin before parsing and retains the supplied production intake hook', async () => {
  const intake = vi.fn(async (request, reply) => {
    if (!presentsOperatorToken(request.headers.authorization, operator.token)) return reply.code(401).send({ error: 'operator token required' });
  });
  const { app, admission } = fixture({ onRequest: intake });
  try {
    for (const requestHeaders of [
      { ...headers, origin: 'null' }, { ...headers, origin: 'https://127.0.0.1:3111' },
      { ...headers, origin: 'http://127.0.0.1:3112' }, { ...headers, origin: 'http://localhost:3111' },
      { ...headers, origin: 'http://127.0.0.1:3111/path' }, { ...headers, origin: 'http://user@127.0.0.1:3111' },
      ...['evil.example', 'localhost.', 'LOCALHOST', '127.1', '127.0.0.1.evil', '[0:0:0:0:0:0:0:1]', 'localhost:0', 'localhost:65536', 'localhost:080', 'localhost@evil'].map(host => ({ ...headers, host })),
    ]) {
      const response = await app.inject({ method: 'POST', url: path, headers: { ...requestHeaders, 'x-forwarded-host': '127.0.0.1:3111', 'x-forwarded-proto': 'http' }, payload: '{"private-sentinel":' });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'private same-origin process build required' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(intake).toHaveBeenCalledTimes(16);
    for (const host of ['localhost', '127.0.0.1:3111', '[::1]:3111']) for (const origin of [undefined, `http://${host}`]) {
      const response = await app.inject({ method: 'POST', url: path, headers: { ...headers, host, ...(origin === undefined ? {} : { origin }) }, payload: '{' });
      expect(response.statusCode).toBe(400);
    }
    const before = intake.mock.calls.length;
    const unauthorized = await app.inject({ method: 'POST', url: path, headers: { host: 'evil.example', origin: 'null', 'content-type': 'text/plain' }, payload: '{' });
    expect(unauthorized.statusCode).toBe(401);
    expect(intake.mock.calls.length).toBe(before);
    const refusedHeaders = { authorization, 'content-type': 'application/json', origin: 'http://localhost:3112' };
    const nativeAddress = await app.listen({ host: '127.0.0.1', port: 0 });
    const native = await new Promise<{ status: number | undefined; body: string; cache: string | string[] | undefined }>((resolve, reject) => {
      const client = httpRequest(nativeAddress + path, { method: 'POST', headers: { ...refusedHeaders, 'x-forwarded-host': new URL(nativeAddress).host } }, response => {
        let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; }); response.on('error', reject);
        response.on('end', () => { resolve({ status: response.statusCode, body, cache: response.headers['cache-control'] }); client.destroy(); });
      });
      client.setTimeout(3000, () => client.destroy(new Error('origin wire deadline'))); client.on('error', reject); client.end('{"private-sentinel":');
    });
    expect(native.status).toBe(403);
    expect(JSON.parse(native.body)).toEqual({ error: 'private same-origin process build required' });
    expect(native.cache).toBe('no-store');
    expect(admission.snapshot().active).toBe(0);
  } finally { await app.close(); }
});

import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import type { TLSSocket } from 'node:tls';
import type { Digest } from '../packages/guardrails/src/pure';
import { gateGeneratedArtifacts } from '../packages/guardrails/src/pure';
import { admissionRefused, type RequestAdmission } from './request-admission';
import { presentsOperatorToken } from './index';
import { z } from 'zod';
import { boundedJson } from '../packages/workflow/data';
import { buildProcessPlan, parseProcessDraft, PROCESS_TEMPLATES } from '../src/process-studio/plan';
import { buildSubAppFromSpec } from '../packages/pipeline/src/build-subapp-spec';

const processBody = z.object({
  projectId: z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  draft: z.unknown(),
  reviewKey: z.string().min(1).max(32768),
}).strict();

export interface ProcessBuildRouteOptions {
  readonly operator: { readonly actor: string; readonly token: string };
  readonly digest: Digest;
  readonly intake: RouteShorthandOptions;
  readonly admission: RequestAdmission;
}
/** Same canonical loopback policy as session setup; proxy headers never establish origin. */
function privateOrigin(request: FastifyRequest): boolean {
  const host = request.raw.headers.host;
  if (typeof host !== 'string') return false;
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?$/.exec(host);
  if (!match || (match[2] !== undefined && Number(match[2]) > 65535)) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true; // Authenticated nonbrowser clients may omit Origin.
  if (typeof origin !== 'string' || origin === 'null') return false;
  try {
    const protocol = (request.raw.socket as TLSSocket).encrypted === true ? 'https' : 'http';
    return new URL(origin).origin === origin && origin === new URL(`${protocol}://${host}`).origin;
  } catch { return false; }
}

/** Private operator-scoped template source authoring; never install or execute.
 * Mounted by Studio's composition root, not an OS identity or host bridge.
 */
export function registerProcessBuildRoutes(app: FastifyInstance, options: ProcessBuildRouteOptions): void {
  const { actor, token } = options.operator;
  const intakeHooks = options.intake.onRequest === undefined ? [] : Array.isArray(options.intake.onRequest) ? [...options.intake.onRequest] : [options.intake.onRequest];
  app.post('/api/studio/process/build', {
    ...options.intake,
    logLevel: 'silent',
    bodyLimit: Math.min(options.intake.bodyLimit ?? 65536, 65536),
    onRequest: [
      (request, reply, done) => {
        reply.header('Cache-Control', 'no-store');
        if (!presentsOperatorToken(request.headers.authorization, token)) {
          void reply.code(401).send({ error: 'operator token required' });
          return;
        }
        done();
      },
      ...intakeHooks,
      async (request, reply) => {
        if (!privateOrigin(request)) return reply.code(403).send({ error: 'private same-origin process build required' });
        if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(request.headers['content-type'] ?? '')) return reply.code(415).send({ error: 'process JSON required' });
      },
    ],
    errorHandler: (error, _request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const code = error.statusCode === 413 ? 413 : error.statusCode === 415 ? 415 : error.statusCode === 400 ? 400 : 503;
      return reply.code(code).send({ error: code === 413 ? 'process request too large' : code === 415 ? 'process JSON required' : code === 400 ? 'malformed process request' : 'process build unavailable' });
    },
  }, async (request, reply) => {
    if (!presentsOperatorToken(request.headers.authorization, token)) return reply.code(401).send({ error: 'operator token required' });
    if (!boundedJson(request.body, 65536, 7, 1000) || !z.object({}).strict().safeParse(request.query).success) return reply.code(400).send({ error: 'malformed process request' });
    const parsed = processBody.safeParse(request.body);
    request.body = undefined;
    if (!parsed.success) return reply.code(400).send({ error: 'malformed process request' });
    const draft = parseProcessDraft(parsed.data.draft);
    if (!draft) return reply.code(400).send({ error: 'malformed process request' });
    const plan = buildProcessPlan(draft);
    if (plan.status === 'needs-input') return reply.send({ status: 'needs-input', questions: plan.questions });
    if (plan.status === 'invalid') return reply.code(400).send({ error: 'malformed process request' });
    // Equality binds the current server compiler/template and the whole parsed draft.
    // This is neither an authorization receipt nor an independent-human approval.
    if (parsed.data.reviewKey !== plan.reviewKey) return reply.code(409).send({ status: 'process-refused', issues: ['process review mismatch'] });
    const template = PROCESS_TEMPLATES.find(item => item.id === plan.templateId);
    if (!template || plan.prd.length > 8000 || plan.buildPrompt.length > 8000) return reply.code(400).send({ error: 'malformed process request' });
    const permit = options.admission.acquire(actor, parsed.data.projectId, request);
    if (!permit) return admissionRefused(reply);
    try {
      // Scan every human fact independently of compiler-owned PRD headings and
      // provenance formatting. This preserves the strictest existing policy;
      // it is not anonymisation or permission to transmit a private process.
      const facts = gateGeneratedArtifacts([{ path: 'process-brief.json', content: JSON.stringify(draft.brief) }], { actor, digest: options.digest });
      if (facts.decision !== 'allow') return reply.send({ status: 'process-refused', issues: ['process generation refused'] });
      // There is deliberately no model dependency, selection, repair or fallback.
      // The unchanged native pipeline still runs input/output privacy and conformance.
      const outcome = await permit.track(() => buildSubAppFromSpec({
        prompt: plan.buildPrompt,
        spec: plan.spec,
        // The PRD stays review data; only the actual closed template description
        // becomes generated-output understanding. Human facts are not rewritten.
        understanding: template.description,
        answers: {
          icon: draft.choices.icon,
          navSection: draft.choices.navSection!,
          visibleToRoles: draft.choices.visibleToRoles.join(','),
          ...Object.fromEntries(draft.choices.consentedScopes.map(scope => [`consent:${scope}`, 'yes'])),
        },
      }, { ctx: { actor }, digest: options.digest, authorship: 'first-party-operator' }));
      if (permit.signal.aborted) return reply.code(503).send({ status: 'process-refused', issues: ['process build unavailable'] });
      if (outcome.status === 'needs_input') return reply.send({ status: 'needs-input', questions: outcome.questions.map(({ id, question, because }) => ({ id, question, because })) });
      if (outcome.status !== 'proposed' || outcome.conformance.ok !== true) return reply.send({ status: 'process-refused', issues: ['process generation refused'] });
      const artifactId = options.digest(JSON.stringify(outcome.generated.files.map(file => ({ path: file.path, kind: file.kind, contents: file.contents }))));
      return reply.send({ status: 'process-built', projectId: parsed.data.projectId, reviewKey: plan.reviewKey, templateId: plan.templateId, templateVersion: template.version, artifactId, outcome });
    } catch {
      return reply.code(503).send({ status: 'process-refused', issues: ['process build unavailable'] });
    } finally { await permit.release(); }
  });
}

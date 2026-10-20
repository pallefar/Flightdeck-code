/**
 * ⭐ THE COMPOSITION ROOT. The only file in this repo that constructs
 * anything.
 *
 * `package.json` has promised `tsx watch server/index.ts` since the
 * beginning and `server/` was an empty directory. Everything underneath it
 * existed and was tested — the provider, the planner bridge, the guardrails,
 * the translator, the emitters — and nothing anywhere assembled them, so the
 * product could not be run. That is the reachability problem this repo keeps
 * finding, in its largest form: ~2,100 passing tests over parts that were
 * never wired to each other.
 *
 * The browser half needs no server: `generateSubApp` and `runConformanceGate`
 * are pure by construction (that is what `codegen/src/pure.ts` is for), so
 * the workbench runs them client-side against a real spec. This exists for
 * the one thing that cannot happen in a browser — the model call, which
 * needs a key that must never reach one.
 *
 * ── WHO IS TYPING, AND WHY THE BODY DOES NOT GET TO SAY ──────────────────
 *
 * `buildEnvelope` will only call an operator's own instruction `ready` when
 * the text is `first-party-operator` AND the actor is a named human. Those
 * two fields are the difference between "send it" and "stop for a person",
 * so if an HTTP body could set them, ANY caller could self-certify and the
 * whole first-party policy would be decoration.
 *
 * So they are not read from the request. The operator is named ONCE, in the
 * environment, and a request proves it is that operator by presenting a
 * shared secret. A request that cannot is refused — NOT downgraded to
 * third-party and quietly run, because doing unauthenticated work is still
 * doing work, and it would spend the operator's model budget on it.
 *
 * ⚠ THIS IS SINGLE-OPERATOR AUTHENTICATION and it is stated rather than
 * implied: one name, one secret, no sessions, no roles. It is the honest
 * shape for a Studio one person runs. Putting this behind a real identity
 * provider is a deployment's job, and the seam for it is `operatorOf()` —
 * that is the only function that decides who is asking.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { ResourceStore, ResourceError } from "../packages/resources/store";
import { jsonValue } from "../packages/workflow/graph";
import { ResourceRegistry, type CredentialResolver } from "../packages/resources/registry";
import { loadResourceConfig } from "./resource-config";
import { registerProductionAssets } from "./production-assets";
import { RequestAdmission, admissionRefused, admittedModel, type RequestAdmissionOptions } from "./request-admission";
import { registerReadinessRoute } from "./readiness";
import { registerProcessBuildRoutes } from './process-build';
import { createRequestAuthoring, NATIVE_REQUEST_POLICY } from './authoring-run';
import { createAnthropicSessionSetup, type AnthropicSessionSetupOptions } from "./anthropic-session-setup";
import { registerWorkflowResourceRoutes, type WorkflowResourceDependencies } from "./workflow-resources";

import Fastify, { type FastifyReply, type RouteShorthandOptions } from "fastify";
import { z } from "zod";

import {
  DATASOURCE_KINDS,
  createFileGrantStore,
  createMemoryDirectory,
  effectiveGrant,
  type DatasourceRef,
  type GrantStore,
  type IdentityDirectory,
} from "../packages/approvals/src/index";
import { isNamedHuman } from "../packages/guardrails/src/approval-pure";
import { buildSubAppFromPrompt } from "../packages/pipeline/src/build-subapp";
import { proposeStudioBlock } from "../packages/pipeline/src/propose-block";
import { createStudioFromPrompt, type StudioSkillSourceState } from "../packages/pipeline/src/create-studio";
import { projectSkillsSchema, type ProjectSkillSource } from "../packages/spec/src/studio-create";
import { loadProjectSkillsFile } from "./project-skill-source";
import { registerWorkflowWorkspaceRoutes } from "./workflow-workspace";
import { registerSubappWorkspaceRoutes } from './subapp-workspace';
import { createFileSubappWorkspaceStore, type SubappWorkspaceStore } from './subapp-workspace-store';
import type { WorkflowApprovalDependencies } from "./workflow-approval";
import { createFileWorkflowWorkspaceStore, type WorkflowWorkspaceStore } from "./workflow-workspace-store";
import { createModelConnections, MODEL_CONNECTION_IDS, type ModelConnectionRegistry } from "./model-connections";


/** SHA-256 over UTF-8 — the Node half, so `node:crypto` is allowed here.
 * Injected rather than imported by the packages, which is what lets them
 * stay mountable inside a sub-app route. */
const digest = (utf8: string): string => createHash("sha256").update(utf8, "utf8").digest("hex");

const MIN_TOKEN_CHARS = 24;

export interface OperatorIdentity {
  readonly actor: string;
  readonly token: string;
}

/**
 * Reads the operator out of the environment, or explains what is missing.
 *
 * Boot fails rather than defaulting. An anonymous operator would be a named
 * human as far as nothing is concerned, and `isNamedHuman` is what stands
 * between "Anna's salary" and the wire.
 */
export function operatorFromEnv(env: Readonly<Record<string, string | undefined>>): OperatorIdentity | string {
  const actor = env["STUDIO_OPERATOR"]?.trim() ?? "";
  const token = env["STUDIO_OPERATOR_TOKEN"] ?? "";
  if (actor === "") return "STUDIO_OPERATOR is not set — name the human who operates this Studio";
  if (!isNamedHuman(actor)) {
    // The value is NOT echoed. It is the operator's name, and a boot log is
    // exactly the kind of place a name should not appear by accident.
    return "STUDIO_OPERATOR is not a named human — a role, a service or an initial is refused by the same rule that governs approvals";
  }
  if (token.length < MIN_TOKEN_CHARS) {
    return `STUDIO_OPERATOR_TOKEN must be at least ${MIN_TOKEN_CHARS} characters — it is the only thing separating an anonymous request from the first-party path`;
  }
  return { actor, token };
}

/**
 * Constant-time bearer check.
 *
 * Compared as DIGESTS, not as raw bytes: `timingSafeEqual` throws when the
 * two buffers differ in length, and that throw is itself an oracle for the
 * secret's length. Hashing both sides first makes every comparison the same
 * width.
 */
export function presentsOperatorToken(header: string | undefined, token: string): boolean {
  if (header === undefined) return false;
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  const presented = match?.[1];
  if (presented === undefined) return false;
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(token, "utf8").digest();
  return timingSafeEqual(a, b);
}

const buildBody = z
  .object({
    connectionId: z.enum(MODEL_CONNECTION_IDS).optional(),
    prompt: z.string().min(1).max(8_000),
    answers: z.record(z.string().max(2_000)).optional(),
    registrySource: z.string().max(200_000).optional(),
    /**
     * ⭐ WHERE THE PROMPT CAME FROM, when it came from anywhere.
     *
     * Absent means the operator typed it, and there is no datasource to
     * check a grant against. Present means this request is USING DATA, and
     * `effectiveGrant` decides whether this project may — which is the
     * "approved per project and per datasource" requirement, and the reason
     * the tier is derived from the payload rather than declared here.
     */
    projectId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .optional(),
    datasource: z
      .object({
        kind: z.enum(DATASOURCE_KINDS),
        id: z.string().min(1).max(120),
        scope: z.string().min(1).max(120).optional(),
      })
      .strict()
      .optional(),
    toolId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .optional(),
  })
  .strict();

const createBody = buildBody.extend({
  /** Explicit private native tool-loop opt-in; omission preserves the JSON planner. */
  authoringEngine: z.literal('native-v1').optional(),
  answers: z.record(z.string().max(120), z.string().max(2_000)).refine(a => Object.keys(a).length <= 20).optional(),
  projectSkills: projectSkillsSchema.optional(),
  reviewedSkillHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

export interface ServerOptions {
  /** Trusted private opt-in. Does not select a provider, send data, execute or deploy. */
  readonly nativeAuthoringEnabled?: boolean;
  /** Trusted process-local zero-queue concurrency/deadline limits; never browser input. */
  readonly requestAdmission?: RequestAdmissionOptions;
  /** Opt-in trusted read-only Vite build directory, snapshotted at startup. */
  readonly productionAssetRoot?: string;
  /** Opt-in same-origin document mic policy only. Browser consent is still required;
   * no audio transport, voice commands, model selection or execution authority. */
  readonly productionVoiceInput?: boolean;
  readonly operator: OperatorIdentity;
  /** Server-owned registry. Selection/configuration never comes from browser overrides. */
  readonly modelConnections?: ModelConnectionRegistry;
  /** Private, explicitly enabled server-memory setup; never browser input. */
  readonly anthropicSessionSetup?: Omit<AnthropicSessionSetupOptions, "baseRegistry" | "authenticate">;
  /** Injected so the tests drive the whole route without a key or a socket. */
  readonly llm?: Parameters<typeof buildSubAppFromPrompt>[1]["llm"];
  /** Required with llm: trusted destination/model/policy revision, explicit even in fixture tests. */
  readonly llmBindingId?: string;
  /** Where grants live. Defaults to the file named by `STUDIO_GRANTS_FILE`. */
  readonly store?: GrantStore;
  /** Who the subject ids resolve to. Defaults to the operator, alone. */
  readonly directory?: IdentityDirectory;
  /** Server-owned project binding; browser-supplied skills are reference context only. */
  readonly projectSkillSource?: ProjectSkillSource;
  /** Private local authoring store; not a host project-authorization claim. */
  readonly workflowWorkspaceStore?: WorkflowWorkspaceStore;
  /** Private local source drafts only; never a generated-file application or host grant. */
  readonly subappWorkspaceStore?: SubappWorkspaceStore;
  /** Opt-in trusted independent reviewer authentication/policy and private checkpoint journal. */
  readonly workflowApprovals?: WorkflowApprovalDependencies;
  /** Trusted startup-only dependencies. Default authoring is local single-operator partitioning,
   * NOT host project authorization. Execution is closed without an explicit project policy. */
  readonly workflowResources?: Partial<Pick<WorkflowResourceDependencies, "store" | "registry" | "authorize">> & { readonly credentialResolver?: CredentialResolver };
}

/** Cache classification only: never rewrite the target used for routing/auth.
 * Compare at most the namespace's encoded width, not the rest of the path:
 * a malformed later parameter must not erase an already-private namespace.
 * Encoded separators, double decoding and public lookalikes are not aliases. */
function isStudioTarget(target = ''): boolean {
  // Strip only the authority of HTTP absolute-form targets. Do not use URL's
  // normalized pathname (dot segments/backslashes must not become aliases).
  const authority = /^https?:\/\/[^/?#]+/i.exec(target);
  let offset = authority?.[0].length ?? 0;
  for (const char of '/api/studio') {
    if (target[offset] === char) { offset++; continue; }
    if (char !== '/' && target[offset] === '%' && target.slice(offset + 1, offset + 3).toLowerCase() === char.charCodeAt(0).toString(16)) { offset += 3; continue; }
    return false;
  }
  return offset === target.length || target[offset] === '/' || target[offset] === '?' || target[offset] === '#';
}

export function createServer(options: ServerOptions): ReturnType<typeof Fastify> {
  const nativeAuthoringEnabled = options.nativeAuthoringEnabled ?? process.env['STUDIO_NATIVE_AUTHORING'] === '1';
  const admission = new RequestAdmission(options.requestAdmission);
  const app = Fastify({
    // ⚠ NO REQUEST LOGGING. The body is a prompt, and a prompt is the one
    // thing in this system most likely to contain a person's name — that is
    // the entire reason the pseudonymiser sits in front of it. A default
    // access log would write it to disk before any of that ran.
    logger: false,
    bodyLimit: 1_000_000,
    requestTimeout: 30000,
    // These router failures precede route hooks. Match Fastify's raw default
    // body/key order/content type, independently of the private cache header.
    frameworkErrors: (error, request, reply: FastifyReply) => {
      if (error.code === 'FST_ERR_BAD_URL' || error.code === 'FST_ERR_MAX_PARAM_LENGTH' || error.code === 'FST_ERR_ASYNC_CONSTRAINT') {
        const statusCode = error.code === 'FST_ERR_BAD_URL' ? 400 : error.code === 'FST_ERR_MAX_PARAM_LENGTH' ? 414 : 500;
        const body = JSON.stringify(statusCode === 500
          ? { error: 'Internal Server Error', message: error.message, statusCode }
          : { error: 'Bad Request', code: error.code, message: error.message, statusCode });
        reply.hijack();
        if (isStudioTarget(request.raw.url)) reply.raw.setHeader('Cache-Control', 'no-store');
        reply.raw.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
        reply.raw.end(body);
        return reply;
      }
      if (isStudioTarget(request.raw.url)) reply.header('Cache-Control', 'no-store');
      return reply.send(error);
    },
  });

  // Native 'request' listeners run before Fastify's router only when prepended.
  // Its default closing 503 bypasses Request/Reply and all lifecycle hooks.
  // Set a header only; leave routing, status/body and load shedding untouched.
  // inject does not emit this event, so frameworkErrors/onSend remain needed.
  app.server.prependListener('request', (request, response) => {
    if (isStudioTarget(request.url)) response.setHeader('Cache-Control', 'no-store');
  });

  // Private API payloads and refusals must not be stored by HTTP caches.
  // Keep the separately registered HTML and hashed-asset policies unchanged.
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.routeOptions.url?.startsWith('/api/studio/') || isStudioTarget(request.raw.url)) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.addHook("preClose", async () => { admission.stop(); sessionSetup.close(); await admission.close(); });
  app.addHook("onClose", async () => { await admission.close(); });
  registerReadinessRoute(app, admission);

  // Construct once at startup; descriptor access and resolution remain auth-first.
  if (options.llm && options.modelConnections) throw new Error("Choose a registry or a trusted LLM injection, not both");
  if (options.llm && (!options.llmBindingId?.trim() || options.llmBindingId.length > 500 || /[\r\n]/.test(options.llmBindingId))) throw new Error("Trusted LLM injection requires a model binding");
  const baseRegistry = options.modelConnections ?? createModelConnections(options.llm ? { env: {} } : {});
  const sessionSetup = createAnthropicSessionSetup({
    ...options.anthropicSessionSetup,
    enabled: options.anthropicSessionSetup?.enabled ?? process.env["STUDIO_ANTHROPIC_SESSION_SETUP"] === "1",
    baseRegistry,
    authenticate: header => presentsOperatorToken(header, options.operator.token),
  });
  sessionSetup.register(app);
  // Retain the facade itself: spreading it would freeze live descriptors.
  const modelConnections = sessionSetup.registry;
  app.get("/api/studio/model-connections", async (request, reply) => {
    if (!presentsOperatorToken(request.headers.authorization, options.operator.token)) return reply.code(401).send({ error: "operator token required" });
    return reply.send({ connections: modelConnections.descriptors, selectedId: modelConnections.selectedId ?? null });
  });

  // Call only after authentication and strict body parsing. The resolved
  // client and exact destination binding stay local to this one request.
  function selectModel(connectionId: string | undefined) {
    if (options.llm && connectionId === undefined) return { llm: options.llm, modelBindingId: digest(JSON.stringify(["studio-trusted-injection-v1", options.llmBindingId])) };
    const id = connectionId ?? modelConnections.selectedId;
    if (id === undefined) return { status: "model-connection-unselected" as const, error: "select a model connection" };
    try {
      const resolved = modelConnections.resolve(id);
      if (!resolved.bindingId || !resolved.descriptor.model || resolved.descriptor.id !== id || resolved.descriptor.status !== "configured") throw new Error();
      return { llm: resolved.llm, connection: resolved, modelBindingId: digest(JSON.stringify(["studio-resolved-model-v1", resolved.descriptor.id, resolved.descriptor.model, resolved.bindingId])) };
    } catch {
      return { status: "model-connection-unavailable" as const, error: "selected model connection unavailable" };
    }
  }

  // ⭐ ONE OPERATOR, AND THE DIRECTORY SAYS SO.
  //
  // `effectiveGrant` resolves every actor through an `IdentityDirectory`
  // rather than trusting the `kind` written on a row — that is how a
  // non-human is stopped from APPROVING. For a single-operator Studio the
  // directory is that one person; a deployment with more people replaces
  // this, which is why it is an option rather than a constant.
  const directory =
    options.directory ??
    createMemoryDirectory([
      { id: options.operator.actor, kind: "human", displayName: options.operator.actor, active: true },
    ]);
  const store = options.store ?? createFileGrantStore(process.env["STUDIO_GRANTS_FILE"] ?? ".studio/grants.json");

  app.get("/api/studio/health", async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    // Public liveness reads no model configuration. Authenticated details
    // describe configuration only; they never probe or claim live service.
    if (!presentsOperatorToken(request.headers.authorization, options.operator.token)) return { ok: true };
    const selectedId = modelConnections.selectedId ?? null;
    const descriptor = selectedId === null ? undefined : modelConnections.descriptors.find(connection => connection.id === selectedId);
    return { ok: true, selectedId, model: descriptor?.model ?? null, modelStatus: descriptor?.status ?? "unselected", verification: "not-probed", processBuild: 'registered-templates-v1' };
  });

  const modelIntake: RouteShorthandOptions = {
    onRequest: async (request, reply) => {
      if (!presentsOperatorToken(request.headers.authorization, options.operator.token)) return reply.code(401).send({ error: "operator token required" });
    },
  };
  registerProcessBuildRoutes(app, { operator: options.operator, digest, intake: modelIntake, admission });
  app.get('/api/studio/authoring', modelIntake, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { ...NATIVE_REQUEST_POLICY, enabled: nativeAuthoringEnabled, connectionIds: ['anthropic'] };
  });
  app.post("/api/studio/build", modelIntake, async (request, reply) => {
    if (!presentsOperatorToken(request.headers.authorization, options.operator.token)) {
      // Fail closed. Not a downgrade to third-party: an unauthenticated
      // request that still ran would spend the operator's model budget.
      return reply.code(401).send({ error: "operator token required" });
    }
    const parsed = buildBody.safeParse(request.body);
    if (!parsed.success) {
      // Issue PATHS only. `zod`'s messages can quote the offending value,
      // and the offending value here is a prompt.
      return reply.code(400).send({ error: "malformed request", at: parsed.error.issues.map((i) => i.path.join(".")) });
    }
    const release = admission.acquire(options.operator.actor, parsed.data.projectId, request);
    if (!release) return admissionRefused(reply);
    try {
    const model = selectModel(parsed.data.connectionId);
    if ("status" in model) return reply.code(409).send(model);

    // ⭐ THE GRANT, AT INTAKE — BEFORE A MODEL CALL IS SPENT ON THE DATA.
    //
    // `gateWorkflowIntake` states the principle this follows: "Refusing at
    // intake is the only place one decision closes all of them." Once a
    // prompt has been planned from, its content is in the understanding, the
    // spec, the generated fixtures and the audit — several paths to the same
    // person data, and no single later refusal closes them.
    //
    // `toolContent` is the request as specified, because at intake the tool
    // IS its specification — there is no generated code yet. So an approval
    // binds to this prompt, and editing the prompt requires a new one, which
    // is what a content hash is for.
    //
    // No `datasource` means the operator typed it and nothing was read, so
    // there is no grant to check — the guardrails still gate the text.
    if (parsed.data.datasource !== undefined) {
      if (parsed.data.projectId === undefined) {
        return reply.code(400).send({ error: "a datasource needs the projectId whose grant governs it", at: ["projectId"] });
      }
      const datasource: DatasourceRef = {
        kind: parsed.data.datasource.kind,
        id: parsed.data.datasource.id,
        scope: parsed.data.datasource.scope,
      };
      const toolId = parsed.data.toolId ?? "studio-prompt";
      const decision = await effectiveGrant({
        store,
        directory,
        toolId,
        toolContent: { toolId, prompt: parsed.data.prompt },
        projectId: parsed.data.projectId,
        datasource,
        // ⭐ THE TIER IS DERIVED FROM THIS, by guardrails, over every
        // representation it can be read as. There is no tier field on the
        // request and there must never be one.
        payload: parsed.data.prompt,
        requestedBy: { kind: "human", id: options.operator.actor, displayName: options.operator.actor },
      });
      if (!decision.allowed) {
        // 200 with an outcome, not an error: a refusal is an ANSWER, and it
        // carries the contentHash a person approves and the audit body that
        // records the asking.
        return reply.send({ status: "grant-refused", decision });
      }
    }

    const outcome = await buildSubAppFromPrompt(
      {
        prompt: parsed.data.prompt,
        ...(parsed.data.answers === undefined ? {} : { answers: parsed.data.answers }),
        ...(parsed.data.registrySource === undefined ? {} : { registrySource: parsed.data.registrySource }),
      },
      {
        llm: admittedModel(model.llm, release),
        ctx: { actor: options.operator.actor },
        digest,
        // ⭐ FROM CONFIG, NEVER FROM THE BODY. See this file's header: these
        // two fields are what `buildEnvelope` reads to decide between "send"
        // and "stop for a human".
        authorship: "first-party-operator",
      },
    );
    return reply.send(outcome);
    } finally { void release.release(); }
  });

  app.get<{ Params: { projectId: string } }>("/api/studio/projects/:projectId/skills", async (request, reply) => {
    if (!presentsOperatorToken(request.headers.authorization, options.operator.token)) return reply.code(401).send({ error: "operator token required" });
    const projectId = request.params.projectId;
    if (!buildBody.shape.projectId.unwrap().safeParse(projectId).success) return reply.code(400).send({ error: "malformed project identity", at: ["projectId"] });
    try {
      const source = options.projectSkillSource ?? loadProjectSkillsFile(process.env["STUDIO_PROJECT_SKILLS_FILE"]);
      const skills = projectSkillsSchema.parse(await source(projectId));
      return reply.send({ projectId, skillSourceState: skills.length > 0 ? "loaded" : "empty", skillSources: skills.map(s => ({ id: s.id, version: s.version, contentHash: digest(s.content) })) });
    } catch {
      return reply.send({ projectId, skillSourceState: "unavailable", skillSources: [], issues: ["project skill source unavailable"] });
    }
  });

  app.post("/api/studio/create", modelIntake, async (request, reply) => {
    if (!presentsOperatorToken(request.headers.authorization, options.operator.token)) return reply.code(401).send({ error: "operator token required" });
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "malformed request", at: ["request"] });
    if (parsed.data.authoringEngine && !nativeAuthoringEnabled) return reply.code(409).send({ status: 'native-authoring-unavailable', error: 'Native authoring is not enabled for this connection. No fallback is attempted.' });
    const release = admission.acquire(options.operator.actor, parsed.data.projectId, request);
    if (!release) return admissionRefused(reply);
    try {
    const model = selectModel(parsed.data.connectionId);
    if ("status" in model) return reply.code(409).send(model);
    if (parsed.data.datasource && !parsed.data.projectId) return reply.code(400).send({ error: "a datasource needs a projectId", at: ["projectId"] });
    if (parsed.data.authoringEngine && (!model.connection || model.connection.nativeAuthoring?.kind !== 'anthropic-messages-v1')) return reply.code(409).send({ status: 'native-authoring-unavailable', error: 'Native authoring is not enabled for this connection. No fallback is attempted.' });
    let skillSourceState: StudioSkillSourceState = "not-loaded";
    try {
      const source = options.projectSkillSource ?? loadProjectSkillsFile(process.env["STUDIO_PROJECT_SKILLS_FILE"]);
      const lazySource: ProjectSkillSource = async projectId => {
        try {
          const skills = projectSkillsSchema.parse(await source(projectId));
          skillSourceState = skills.length > 0 ? "loaded" : "empty";
          return skills;
        } catch {
          skillSourceState = "unavailable";
          throw new Error("project skill source unavailable");
        }
      };
      const checkGrant = async (skills?: Awaited<ReturnType<ProjectSkillSource>>) => {
        if (!parsed.data.datasource || !parsed.data.projectId) return undefined;
        const toolId = parsed.data.toolId ?? "studio-create";
        const relevantInput = { ...parsed.data, toolId, ...(skills === undefined ? {} : { serverProjectSkills: skills }) };
        return effectiveGrant({ store, directory, toolId, toolContent: relevantInput, projectId: parsed.data.projectId, datasource: parsed.data.datasource, payload: JSON.stringify(relevantInput), requestedBy: { kind: "human", id: options.operator.actor, displayName: options.operator.actor } });
      };
      // First grant covers ALL caller input before classification. A second,
      // workflow-only decision binds the actual server-loaded skill content.
      const intakeGrant = await checkGrant();
      if (intakeGrant && !intakeGrant.allowed) return reply.send({ status: "grant-refused", decision: intakeGrant, skillSourceState });
      const body = parsed.data;
      let authorizedSkills: Awaited<ReturnType<ProjectSkillSource>> | undefined;
      const authorizeWorkflowContext = async (skills: Awaited<ReturnType<ProjectSkillSource>>) => {
        const decision = await checkGrant(skills);
        if (!decision || decision.allowed) authorizedSkills = skills;
        return decision;
      };
      const authoring = body.authoringEngine && model.connection ? createRequestAuthoring({
        connection: model.connection, permit: release, actor: options.operator.actor, projectId: body.projectId,
        reauthorize: async () => { const decision = await checkGrant(authorizedSkills); return !decision || decision.allowed; },
      }) : undefined;
      const outcome = await createStudioFromPrompt({
        prompt: body.prompt,
        ...(body.answers === undefined ? {} : { answers: body.answers }),
        ...(body.projectId === undefined ? {} : { projectId: body.projectId }),
        ...(body.toolId === undefined ? {} : { toolId: body.toolId }),
        ...(body.registrySource === undefined ? {} : { registrySource: body.registrySource }),
        ...(body.projectSkills === undefined ? {} : { projectSkills: body.projectSkills }),
        ...(body.reviewedSkillHash === undefined ? {} : { reviewedSkillHash: body.reviewedSkillHash }),
        ...(body.datasource === undefined ? {} : { datasource: { kind: body.datasource.kind, id: body.datasource.id, ...(body.datasource.scope === undefined ? {} : { scope: body.datasource.scope }) } }),
      }, { llm: authoring?.llm ?? admittedModel(model.llm, release), modelBindingId: model.modelBindingId,
        ...(authoring ? { nativeAuthoring: authoring.nativeAuthoring } : {}),
        ctx: { actor: options.operator.actor }, digest, authorship: "first-party-operator", projectSkills: [], projectSkillSource: lazySource, authorizeWorkflowContext, graphDrafts: true });
      return reply.send({ ...outcome, skillSourceState });
    } catch {
      // No provider, loader, filesystem path or grant-store error is exposed.
      return reply.send({ status: "invalid_determination", issues: ["studio context unavailable"], skillSourceState: "unavailable" });
    }
    } finally { void release.release(); }
  });

  app.post("/api/studio/blocks/propose", modelIntake, async (request, reply) => {
    if (!presentsOperatorToken(request.headers.authorization, options.operator.token)) return reply.code(401).send({ error: "operator token required" });
    const parsed = z.object({ prompt: z.string().trim().min(1).max(2000), connectionId: z.enum(MODEL_CONNECTION_IDS).optional() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "malformed block request" });
    const release = admission.acquire(options.operator.actor, undefined, request);
    if (!release) return admissionRefused(reply);
    try {
    const model = selectModel(parsed.data.connectionId);
    if ("status" in model) return reply.code(409).send(model);
    return reply.send(await proposeStudioBlock(parsed.data.prompt, { llm: admittedModel(model.llm, release), ctx: { actor: options.operator.actor }, digest, authorship: "first-party-operator" }));
    } finally { void release.release(); }
  });

  const resourceConfig = options.workflowResources?.registry || options.workflowResources?.authorize ? undefined : loadResourceConfig(process.env["STUDIO_RESOURCE_CONFIG_FILE"], options.workflowResources?.credentialResolver);
  const resourceStore = options.workflowResources?.store ?? new ResourceStore(process.env["STUDIO_RESOURCE_DIR"] ?? join(process.env["STUDIO_STATE_DIR"] ?? ".studio", "resources"));
  const resourceRegistry = options.workflowResources?.registry ?? resourceConfig?.registry ?? new ResourceRegistry([], {});
  const authorizeResource: WorkflowResourceDependencies["authorize"] = options.workflowResources?.authorize ?? resourceConfig?.authorize ?? (async (actor, _projectId, action) => actor === options.operator.actor && action !== "execute");
  registerWorkflowResourceRoutes(app, {
    admission,
    store: resourceStore,
    registry: resourceRegistry,
    authenticate: async header => presentsOperatorToken(header, options.operator.token) ? { actor: options.operator.actor } : null,
    authorize: authorizeResource,
  });

  registerSubappWorkspaceRoutes(app, {
    actor: options.operator.actor,
    authenticate: header => presentsOperatorToken(header, options.operator.token),
    store: options.subappWorkspaceStore ?? createFileSubappWorkspaceStore(resolve(process.env['STUDIO_SUBAPP_WORKSPACE_FILE'] ?? join(process.env['STUDIO_STATE_DIR'] ?? '.studio', 'subapp-workspace.json'))),
  });

  registerWorkflowWorkspaceRoutes(app, {
    admission,
    ...(options.workflowApprovals ? { approvals: options.workflowApprovals } : {}),
    actor: options.operator.actor,
    adaptersFor: ({ actor, projectId }) => ({ resource: async request => {
      if (!await authorizeResource(actor, projectId, "execute")) throw new ResourceError(403);
      const record = await resourceStore.get(projectId, request.resourceId);
      if (record.revision !== request.revision || record.state !== "active") throw new ResourceError(409);
      // The run context, not graph/browser fields, owns actor/project. Recheck at effect time.
      if (!await authorizeResource(actor, projectId, "execute")) throw new ResourceError(403);
      const current = await resourceStore.get(projectId, request.resourceId);
      if (current.revision !== request.revision || current.state !== "active") throw new ResourceError(409);
      const result = await resourceRegistry.execute(current, request.functionId, request.parameters, actor, request.signal);
      return jsonValue.parse(result.output);
    } }),
    authenticate: header => presentsOperatorToken(header, options.operator.token),
    store: options.workflowWorkspaceStore ?? createFileWorkflowWorkspaceStore(process.env["STUDIO_WORKSPACE_FILE"] ?? ".studio/workflow-workspace.json"),
  });

  const productionAssetRoot = options.productionAssetRoot ?? process.env["STUDIO_FRONTEND_ASSET_ROOT"];
  if (productionAssetRoot !== undefined) registerProductionAssets(app, productionAssetRoot, options.productionVoiceInput ?? process.env["STUDIO_VOICE_INPUT"] === "1");
  return app;
}

/**
 * ⭐ IS THIS MODULE THE ENTRY POINT?
 *
 * ⚠ This was `process.argv[1]?.endsWith("server/index.ts")`, which is a
 * guess about a FILENAME. It happens to work for `npx tsx server/index.ts`
 * and for `tsx watch server/index.ts` — both were run to check — and it
 * fails SILENTLY the moment anything renames the file or runs a build
 * output: `node dist/server/index.js` imports the module, matches nothing,
 * boots nothing, and prints nothing. A server that exits 0 having never
 * listened is the worst possible failure for whoever is setting it up.
 *
 * The URL comparison is the actual question — "was I the module node was
 * told to run" — and it is stable across names, directories and build
 * output. Verified to hold under both runners before replacing the old
 * check.
 */
const isEntryPoint = ((): boolean => {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(invoked).href;
  } catch {
    return false;
  }
})();

/* c8 ignore start — the boot path; `createServer` is what the tests drive. */
if (isEntryPoint) {
  const operator = operatorFromEnv(process.env);
  if (typeof operator === "string") {
    process.stderr.write(`studio: refusing to start — ${operator}\n`);
    process.exit(1);
  }
  const port = Number(process.env["PORT"] ?? 8787);
  // ⚠ LOOPBACK BY DEFAULT. This process holds a model key and a bearer
  // secret; binding every interface is a decision someone should have to
  // make out loud.
  const host = process.env["STUDIO_HOST"] ?? "127.0.0.1";
  void createServer({ operator })
    .listen({ port, host })
    .then(() => process.stdout.write(`studio: listening on http://${host}:${port}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`studio: failed to start — ${(error as Error).message}\n`);
      process.exit(1);
    });
}
/* c8 ignore stop */

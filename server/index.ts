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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Fastify from "fastify";
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
import { HARNESS_MODE_ENV, harnessProvider, resolveMode, type HarnessMode } from "../packages/harness/src/index";
import { buildSubAppFromPrompt } from "../packages/pipeline/src/build-subapp";
import { AnthropicProvider } from "../packages/providers/src/anthropic";
import { anthropicConfigFromEnv, type ProviderConfigInput } from "../packages/providers/src/config";
import { DEFAULT_MODEL } from "../packages/providers/src/models";
import { plannerLlm } from "../packages/providers/src/planner-bridge";
import type { ModelProvider } from "../packages/providers/src/types";

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

/**
 * The Studio checkout this server belongs to: the nearest ancestor of THIS
 * FILE that holds a `package.json`. Found from `import.meta.url`, so it is the
 * same under `tsx server/index.ts`, `tsx watch`, and a build output in
 * `dist/server/` — and it never depends on the directory the process was
 * started from.
 */
export const STUDIO_ROOT: string = ((): string => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    if (path.dirname(dir) === dir) return path.dirname(here); // no package.json anywhere: the dir above server/
  }
})();

export const GRANTS_FILE_ENV_VAR = "STUDIO_GRANTS_FILE";

/**
 * ⭐ WHERE THE GRANTS LIVE — anchored to the Studio checkout, never to cwd.
 *
 * This was `process.env.STUDIO_GRANTS_FILE ?? ".studio/grants.json"`, which
 * `fs` resolves against `process.cwd()`. Start the server from another
 * directory and it opened a DIFFERENT, EMPTY store. That fails closed — no
 * rows, everything refused — which is exactly why it would go unnoticed:
 * every approval anyone made reads as absent, and nothing says why.
 *
 *   unset            → `<root>/.studio/grants.json`
 *   relative value   → resolved against `<root>`, not cwd
 *   absolute value   → used as given
 *   empty/whitespace → a boot problem. `??` kept the empty string, so the
 *                      store would have tried to read the path "".
 */
export function grantsFileFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  root: string = STUDIO_ROOT,
): { readonly file: string } | { readonly problem: string } {
  const value = env[GRANTS_FILE_ENV_VAR];
  if (value === undefined) return { file: path.join(root, ".studio", "grants.json") };
  if (value.trim() === "") return { problem: `${GRANTS_FILE_ENV_VAR} is set but empty` };
  return { file: path.isAbsolute(value) ? value : path.resolve(root, value) };
}

/**
 * ⭐ WHERE RECORDINGS LIVE — committed, and anchored to the checkout like the
 * grants file, so `playback` reads the same fixtures from any cwd.
 */
export const HARNESS_FIXTURES_DIR: string = path.join(STUDIO_ROOT, "fixtures", "harness");

/** `off` is the server's own mode: no harness at all. */
export type StudioHarnessMode = "off" | HarnessMode;

/**
 * ⭐ THE SERVER'S DEFAULT IS OFF, NOT THE HARNESS'S DEFAULT.
 *
 * `resolveMode` defaults to `playback`, which is right for a test suite and
 * wrong for a running Studio: an operator who set nothing would get every build
 * refused with a cache miss. And `live` through the harness WRITES every
 * prompt to disk, which this server otherwise refuses to do (see the
 * `logger: false` note below) — so recording is something an operator turns on
 * by name, never something they get by leaving a variable unset.
 *
 * A set value goes to `resolveMode`, so the spellings and the refusal of a typo
 * are the harness's, not a second copy of them.
 */
export function harnessModeFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): { readonly mode: StudioHarnessMode } | { readonly problem: string } {
  const raw = env[HARNESS_MODE_ENV];
  if (raw === undefined || raw.trim() === "") return { mode: "off" };
  try {
    return { mode: resolveMode(env) };
  } catch (error) {
    return { problem: (error as Error).message };
  }
}

/**
 * The provider the planner is handed, per `FLIGHTDECK_HARNESS_MODE`.
 *
 *   off       `live()` itself — exactly what this server did before the harness
 *   live      `live()` wrapped: every call recorded into `fixturesDir`
 *   playback  the recordings only. `live` is never called, so a replaying
 *             server needs no key and cannot reach the network by accident.
 *
 * `model` is what stands behind a request that names none; the harness keys on
 * it (see `providers-adapter.ts`).
 */
export function modelProviderFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  options: { readonly live: () => ModelProvider; readonly fixturesDir: string; readonly model: string },
): ModelProvider {
  const read = harnessModeFromEnv(env);
  if ("problem" in read) throw new Error(`studio: refusing to start — ${read.problem}`);
  const { fixturesDir, model } = options;
  switch (read.mode) {
    case "off":
      return options.live();
    case "live":
      return harnessProvider({ mode: "live", provider: options.live(), model, fixturesDir });
    case "playback":
      return harnessProvider({ mode: "playback", model, fixturesDir });
  }
}

/**
 * ⭐ EVERYTHING THE BOOT REFUSES, collected rather than first-wins, so one
 * restart fixes all of it.
 *
 * `anthropicConfigFromEnv` is lenient on purpose — a library must not take a
 * process down — and reports a bad FLIGHTDECK_EFFORT in `ignored`. Every
 * caller here read only `.config` and threw `ignored` away, so `turbo` or
 * `High` ran at the default without a word: an operator who believed they had
 * turned a dial had not. This is the composition root, the one place that can
 * say "that is not what you meant", so an `ignored` entry is a refusal here.
 */
export function bootProblems(env: Readonly<Record<string, string | undefined>>): string[] {
  const problems: string[] = [];
  const operator = operatorFromEnv(env);
  if (typeof operator === "string") problems.push(operator);
  const grants = grantsFileFromEnv(env);
  if ("problem" in grants) problems.push(grants.problem);
  problems.push(...anthropicConfigFromEnv(env).ignored);
  const harness = harnessModeFromEnv(env);
  if ("problem" in harness) problems.push(harness.problem);
  return problems;
}

const buildBody = z
  .object({
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

export interface ServerOptions {
  readonly operator: OperatorIdentity;
  /** Injected so the tests drive the whole route without a key or a socket. */
  readonly llm?: Parameters<typeof buildSubAppFromPrompt>[1]["llm"];
  /**
   * Where grants live. Defaults to the file `grantsFileFromEnv` names:
   * `STUDIO_GRANTS_FILE`, resolved against `STUDIO_ROOT` when relative, and
   * `<STUDIO_ROOT>/.studio/grants.json` when unset — never against cwd.
   */
  readonly store?: GrantStore;
  /** Who the subject ids resolve to. Defaults to the operator, alone. */
  readonly directory?: IdentityDirectory;
  /** Where `FLIGHTDECK_HARNESS_MODE` records and replays. Defaults to
   * `HARNESS_FIXTURES_DIR`. Ignored when `llm` is injected. */
  readonly harnessFixturesDir?: string;
}

/**
 * The real provider's config, or a refusal. Checked HERE as well as at the
 * entry point, so a server started any other way — a test harness, an
 * embedding — cannot quietly run a typo'd effort at the default either.
 */
function providerConfigOrThrow(env: Readonly<Record<string, string | undefined>>): ProviderConfigInput {
  const { config, ignored } = anthropicConfigFromEnv(env);
  if (ignored.length > 0) throw new Error(`studio: refusing to start — ${ignored.join("; ")}`);
  return config;
}

/** The real provider — behind the record/playback harness when one is asked for. */
function studioProvider(fixturesDir: string): ModelProvider {
  // Validated up front in every mode, playback included: a typo'd effort is a
  // refusal whether or not this run will spend it.
  const config = providerConfigOrThrow(process.env);
  return modelProviderFromEnv(process.env, {
    live: () => new AnthropicProvider(config),
    fixturesDir,
    model: config.model ?? DEFAULT_MODEL,
  });
}

function grantsFileOrThrow(env: Readonly<Record<string, string | undefined>>): string {
  const grants = grantsFileFromEnv(env);
  if ("problem" in grants) throw new Error(`studio: refusing to start — ${grants.problem}`);
  return grants.file;
}

/** What health reports: `injected` when a caller supplied the llm, since the
 * env then decides nothing. */
function harnessModeLabel(options: ServerOptions): StudioHarnessMode | "injected" | null {
  if (options.llm !== undefined) return "injected";
  const read = harnessModeFromEnv(process.env);
  return "mode" in read ? read.mode : null;
}

export function createServer(options: ServerOptions): ReturnType<typeof Fastify> {
  const app = Fastify({
    // ⚠ NO REQUEST LOGGING. The body is a prompt, and a prompt is the one
    // thing in this system most likely to contain a person's name — that is
    // the entire reason the pseudonymiser sits in front of it. A default
    // access log would write it to disk before any of that ran.
    logger: false,
    bodyLimit: 1_000_000,
  });

  const llm =
    options.llm ??
    // ⚠ NOT `gatedPlannerLlm`. That wrapper pseudonymises and gates
    // `request.user` — the prompt the PLANNER assembles, scaffolding and all
    // — which assesses as tier 4 and sends nothing; the measured symptom was
    // a guardrail refusal reported as `invalid_draft`. `buildSubAppFromPrompt`
    // gates the INPUT boundary instead, before the planner builds anything,
    // and its own tests assert the model is never called on a refusal. So the
    // raw bridge is correct here, and double-gating would break the path.
    plannerLlm(studioProvider(options.harnessFixturesDir ?? HARNESS_FIXTURES_DIR));

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
  const store = options.store ?? createFileGrantStore(grantsFileOrThrow(process.env));

  app.get("/api/studio/health", async () => ({
    ok: true,
    // ⚠ THE EFFECTIVE MODEL, not the override.
    //
    // This read `anthropicConfigFromEnv().config.model`, which is populated
    // only when FLIGHTDECK_MODEL is in the environment — so a perfectly
    // healthy default install answered `"model": null` while the provider
    // would in fact use DEFAULT_MODEL. A health endpoint that says "none"
    // about the thing it is going to use is worse than one that says
    // nothing. Found by booting the server and reading its own answer.
    model: anthropicConfigFromEnv().config.model ?? DEFAULT_MODEL,
    // Whether a key EXISTS, never anything about it.
    modelKeyConfigured: (process.env["ANTHROPIC_API_KEY"] ?? "").length > 0,
    // `playback` answers from fixtures, not the model — say so, or a replaying
    // server is indistinguishable from a live one from the outside.
    harnessMode: harnessModeLabel(options),
  }));

  app.post("/api/studio/build", async (request, reply) => {
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
        llm,
        ctx: { actor: options.operator.actor },
        digest,
        // ⭐ FROM CONFIG, NEVER FROM THE BODY. See this file's header: these
        // two fields are what `buildEnvelope` reads to decide between "send"
        // and "stop for a human".
        authorship: "first-party-operator",
      },
    );
    return reply.send(outcome);
  });

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
  const problems = bootProblems(process.env);
  const operator = operatorFromEnv(process.env);
  const grants = grantsFileFromEnv(process.env);
  // The second and third conditions are implied by the first; they are here
  // so the narrowing below is the compiler's, not a comment's.
  if (problems.length > 0 || typeof operator === "string" || "problem" in grants) {
    for (const problem of problems) process.stderr.write(`studio: refusing to start — ${problem}\n`);
    process.exit(1);
  }
  // The PATH, once, so "which store is this" is answerable from the boot
  // log. Never anything read from it.
  process.stdout.write(`studio: grants at ${grants.file}\n`);
  const port = Number(process.env["PORT"] ?? 8787);
  // ⚠ LOOPBACK BY DEFAULT. This process holds a model key and a bearer
  // secret; binding every interface is a decision someone should have to
  // make out loud.
  const host = process.env["STUDIO_HOST"] ?? "127.0.0.1";
  void createServer({ operator, store: createFileGrantStore(grants.file) })
    .listen({ port, host })
    .then(() => process.stdout.write(`studio: listening on http://${host}:${port}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`studio: failed to start — ${(error as Error).message}\n`);
      process.exit(1);
    });
}
/* c8 ignore stop */

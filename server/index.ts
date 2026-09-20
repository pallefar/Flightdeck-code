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

import Fastify from "fastify";
import { z } from "zod";

import { isNamedHuman } from "../packages/guardrails/src/approval-pure";
import { buildSubAppFromPrompt } from "../packages/pipeline/src/build-subapp";
import { AnthropicProvider } from "../packages/providers/src/anthropic";
import { anthropicConfigFromEnv } from "../packages/providers/src/config";
import { plannerLlm } from "../packages/providers/src/planner-bridge";

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
    prompt: z.string().min(1).max(8_000),
    answers: z.record(z.string().max(2_000)).optional(),
    registrySource: z.string().max(200_000).optional(),
  })
  .strict();

export interface ServerOptions {
  readonly operator: OperatorIdentity;
  /** Injected so the tests drive the whole route without a key or a socket. */
  readonly llm?: Parameters<typeof buildSubAppFromPrompt>[1]["llm"];
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
    plannerLlm(new AnthropicProvider(anthropicConfigFromEnv().config));

  app.get("/api/studio/health", async () => ({
    ok: true,
    // Whether a key EXISTS, never anything about it.
    model: anthropicConfigFromEnv().config.model ?? null,
    modelKeyConfigured: (process.env["ANTHROPIC_API_KEY"] ?? "").length > 0,
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

/* c8 ignore start — the boot path; `createServer` is what the tests drive. */
if (process.argv[1]?.endsWith("server/index.ts") === true) {
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

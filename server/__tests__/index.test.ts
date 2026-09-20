/**
 * The composition root, driven as a real HTTP surface.
 *
 * `fastify.inject()` runs the whole request lifecycle — routing, body parse,
 * hooks, serialisation — without a socket, so these are not tests of a
 * handler function pulled out of its context. That distinction is the point:
 * this file exists because ~2,100 tests passed over parts nothing assembled,
 * and a test that calls the handler directly would repeat exactly that
 * mistake one level up.
 */
import { describe, expect, it } from "vitest";

import { EXAMPLE_DRAFT_JSON } from "../../packages/spec/src/prompt";
import { createMemoryGrantStore } from "../../packages/approvals/src/store";
import type { DatasourceRef, GrantRow } from "../../packages/approvals/src/index";
import { createServer, operatorFromEnv, presentsOperatorToken } from "../index";

const TOKEN = "a-sufficiently-long-operator-token";
const OPERATOR = { actor: "Karsten Haldan", token: TOKEN };

/** A model that answers with a draft grounded in the prompt below. */
const DRAFT = (() => {
  const base = JSON.parse(EXAMPLE_DRAFT_JSON) as Record<string, unknown>;
  const spec = base["spec"] as Record<string, unknown>;
  spec["visibleToRoles"] = { roles: ["legal", "admin"], evidence: "visible to legal and admin" };
  spec["capabilities"] = [{ capability: "read:contracts", evidence: "contract folders needing review" }];
  base["understanding"] = "Show contract folders needing review, for legal and admin.";
  return JSON.stringify(base);
})();
const PROMPT = "Show contract folders needing review, visible to legal and admin.";

const serve = (llm?: () => Promise<{ text: string }>) =>
  createServer({ operator: OPERATOR, ...(llm === undefined ? {} : { llm }) });

describe("who is allowed to ask", () => {
  it("⭐ refuses without the operator token — and does NOT run anyway as third-party", async () => {
    // The tempting alternative is to downgrade an unauthenticated request to
    // `third-party-content` and let the guardrails stop it. That still spends
    // a model call on an anonymous caller.
    let called = 0;
    const app = serve(async () => {
      called += 1;
      return { text: DRAFT };
    });
    const res = await app.inject({ method: "POST", url: "/api/studio/build", payload: { prompt: PROMPT } });
    expect(res.statusCode).toBe(401);
    expect(called).toBe(0);
  });

  it("refuses a wrong token, and a token in the wrong scheme", async () => {
    const app = serve(async () => ({ text: DRAFT }));
    for (const authorization of [`Bearer ${TOKEN}x`, `Basic ${TOKEN}`, TOKEN, "Bearer ", ""]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/studio/build",
        headers: { authorization },
        payload: { prompt: PROMPT },
      });
      expect(res.statusCode, authorization).toBe(401);
    }
  });

  it("⭐ the body cannot claim to be the operator", async () => {
    // `actor` and `authorship` are what `buildEnvelope` reads to decide
    // between sending and stopping for a human. The schema is `.strict()`,
    // so naming them is a 400 rather than a silently ignored field — a
    // caller who tried should be told, not quietly downgraded.
    const app = serve(async () => ({ text: DRAFT }));
    const res = await app.inject({
      method: "POST",
      url: "/api/studio/build",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: PROMPT, actor: "Anna Sørensen", authorship: "first-party-operator" },
    });
    expect(res.statusCode).toBe(400);

    // ⚠ AND THE REFUSAL CARRIES PATHS AND NOTHING ELSE.
    //
    // This used to assert only `not.toContain("Anna")`, which passed whatever
    // the handler echoed: zod reports an unrecognised key by NAMING THE KEY,
    // so the value never appeared and the assertion could not fail. Mutation
    // testing found it — swapping the path mapping for the full issue objects
    // left it green.
    //
    // zod DOES quote the received value for some issue types (an enum
    // mismatch reads "received 'Anna'"), so the mapping is what keeps a
    // future field from leaking. That is a property of the RESPONSE SHAPE,
    // and this is the assertion that pins it.
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["at", "error"]);
    for (const at of body["at"] as unknown[]) {
      expect(typeof at).toBe("string");
      expect(at as string).toMatch(/^[A-Za-z0-9_.]*$/);
    }
    expect(res.body).not.toContain("Anna");
  });

  it("compares the token in constant time, over equal-width digests", () => {
    // `timingSafeEqual` throws on a length mismatch, and that throw is an
    // oracle for the secret's length — so both sides are hashed first.
    expect(presentsOperatorToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(() => presentsOperatorToken("Bearer x", TOKEN)).not.toThrow();
    expect(presentsOperatorToken("Bearer x", TOKEN)).toBe(false);
    expect(presentsOperatorToken(undefined, TOKEN)).toBe(false);
  });
});

describe("what it refuses to boot with", () => {
  it("⭐ no operator, a role instead of a person, or a short token", () => {
    expect(typeof operatorFromEnv({})).toBe("string");
    expect(typeof operatorFromEnv({ STUDIO_OPERATOR: "admin", STUDIO_OPERATOR_TOKEN: TOKEN })).toBe("string");
    expect(typeof operatorFromEnv({ STUDIO_OPERATOR: "service", STUDIO_OPERATOR_TOKEN: TOKEN })).toBe("string");
    expect(typeof operatorFromEnv({ STUDIO_OPERATOR: "Karsten Haldan", STUDIO_OPERATOR_TOKEN: "short" })).toBe(
      "string",
    );
    expect(operatorFromEnv({ STUDIO_OPERATOR: "Karsten Haldan", STUDIO_OPERATOR_TOKEN: TOKEN })).toEqual({
      actor: "Karsten Haldan",
      token: TOKEN,
    });
  });

  it("never echoes the operator's name in the reason it refuses", () => {
    const reason = operatorFromEnv({ STUDIO_OPERATOR: "Anna Sørensen the intern", STUDIO_OPERATOR_TOKEN: TOKEN });
    if (typeof reason !== "string") return; // it was accepted; nothing to check
    expect(reason).not.toContain("Anna");
  });
});

describe("the whole path, over HTTP", () => {
  it("⭐ a prompt becomes a proposal — every package, through one route", async () => {
    const app = serve(async () => ({ text: DRAFT }));
    const res = await app.inject({
      method: "POST",
      url: "/api/studio/build",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: PROMPT },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; generated?: { files: { path: string }[] } };
    expect(body.status).toBe("proposed");
    const paths = (body.generated?.files ?? []).map((f) => f.path);
    expect(paths).toContain("server/subapps/works-council-gaps/manifest.ts");
    expect(paths).toContain("standalone/server.ts");
  });

  it("a guardrail refusal comes back as an OUTCOME, not a 500", async () => {
    // Tier 4 input. The gate refuses before the model, and the caller gets a
    // decision with an audit body rather than a stack trace.
    let called = 0;
    const app = serve(async () => {
      called += 1;
      return { text: DRAFT };
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/studio/build",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: "Track sick leave and union membership for the team." },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; decision?: { tier: number; audit?: unknown } };
    expect(body.status).toBe("model-request-refused");
    expect(body.decision?.tier).toBe(4);
    expect(body.decision?.audit).toBeDefined();
    expect(called).toBe(0);
  });

  it("health says whether a key is configured, and nothing about it", async () => {
    const res = await serve(async () => ({ text: DRAFT })).inject({ method: "GET", url: "/api/studio/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(typeof body["modelKeyConfigured"]).toBe("boolean");
    // ⭐ THE EFFECTIVE MODEL, never null on a healthy install. This said
    // `null` on a default install — the field reads the FLIGHTDECK_MODEL
    // override, and reported "none" for the model the provider would
    // actually use. Found by booting the server, not by a test.
    expect(body["model"]).toBe("claude-opus-5");
    // The key's VALUE must not be reachable through this endpoint by any name.
    const key = process.env["ANTHROPIC_API_KEY"];
    if (key !== undefined && key.length > 0) expect(res.body).not.toContain(key);
  });

  it("health needs no token — an unauthenticated probe is how a deploy checks liveness", async () => {
    const res = await serve(async () => ({ text: DRAFT })).inject({ method: "GET", url: "/api/studio/health" });
    expect(res.statusCode).toBe(200);
  });
});


/**
 * ⭐ THE CALL SITE `effectiveGrant` DID NOT HAVE.
 *
 * `redteam-attacks.test.ts` carried a case called "STILL OPEN: no consumer
 * wires effectiveGrant() into a route yet", whose body was
 * `expect(true).toBe(true)` and whose only output was a console line. The
 * whole approval system — 176 tests, a ceiling/project intersection, a
 * directory, revocation, sealed decisions — decided nothing, because nothing
 * asked it.
 */
const CONTRACTS: DatasourceRef = { kind: "repo-path", id: "contracts", scope: "input" };
const TOOL_ID = "studio-prompt";
const PROJECT = "rhineland";

const grantRow = (projectId: string, maxTier: 1 | 2 | 3 | 4): GrantRow => ({
  projectId,
  toolId: TOOL_ID,
  datasources: [{ datasource: CONTRACTS, maxTier }],
  revokedAt: null,
});

const withGrants = (rows: readonly GrantRow[], llm: () => Promise<{ text: string }>) =>
  createServer({ operator: OPERATOR, llm, store: createMemoryGrantStore({ rows }) });

const ask = (payload: Record<string, unknown>) => ({
  method: "POST" as const,
  url: "/api/studio/build",
  headers: { authorization: `Bearer ${TOKEN}` },
  payload,
});

describe("a prompt that came from a datasource needs a grant", () => {
  it("⭐ no grant at all — refused, and the model is never called", async () => {
    let called = 0;
    const app = withGrants([], async () => {
      called += 1;
      return { text: DRAFT };
    });
    const res = await app.inject(ask({ prompt: PROMPT, projectId: PROJECT, datasource: CONTRACTS }));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; decision?: { allowed: boolean; reason: string } };
    expect(body.status).toBe("grant-refused");
    expect(body.decision?.allowed).toBe(false);
    // ⭐ AT INTAKE. Not after planning — once a prompt has been planned from,
    // its content is in the understanding, the spec and the fixtures.
    expect(called).toBe(0);
  });

  it("⭐ ceiling and project row present — the build proceeds", async () => {
    const app = withGrants([grantRow("*", 2), grantRow(PROJECT, 2)], async () => ({ text: DRAFT }));
    const res = await app.inject(ask({ prompt: PROMPT, projectId: PROJECT, datasource: CONTRACTS }));
    expect((res.json() as { status: string }).status).toBe("proposed");
  });

  it("⭐ a project row under a SHUT ceiling is masked — consent on record, still refused", async () => {
    // The third state `GrantDecision` documents: `projectGranted &&
    // !ceilingGranted`. A project cannot grant itself past the Function.
    const app = withGrants([grantRow(PROJECT, 4)], async () => ({ text: DRAFT }));
    const res = await app.inject(ask({ prompt: PROMPT, projectId: PROJECT, datasource: CONTRACTS }));
    const body = res.json() as { status: string; decision?: { ceilingGranted: boolean; projectGranted: boolean } };
    expect(body.status).toBe("grant-refused");
    expect(body.decision?.ceilingGranted).toBe(false);
    expect(body.decision?.projectGranted).toBe(true);
  });

  it("⭐ tier 3/4 data needs a named human even WITH the grant", async () => {
    // The user requirement in one case: category 3 and 4 data must be
    // approved. The tier is derived from the payload, not declared.
    const app = withGrants([grantRow("*", 4), grantRow(PROJECT, 4)], async () => ({ text: DRAFT }));
    const res = await app.inject(
      ask({
        prompt: "Track sick leave and union membership for Anna Sørensen.",
        projectId: PROJECT,
        datasource: CONTRACTS,
      }),
    );
    const body = res.json() as { status: string; decision?: { tier: number; requiresNamedApproval: boolean } };
    expect(body.status).toBe("grant-refused");
    expect(body.decision?.requiresNamedApproval).toBe(true);
    expect(body.decision?.tier).toBeGreaterThanOrEqual(3);
  });

  it("the refusal carries the contentHash a person approves, and an audit body", async () => {
    const app = withGrants([], async () => ({ text: DRAFT }));
    const res = await app.inject(ask({ prompt: PROMPT, projectId: PROJECT, datasource: CONTRACTS }));
    const body = res.json() as { decision?: { contentHash?: string; audit?: unknown } };
    expect(body.decision?.contentHash).toMatch(/^[0-9a-f]{16,}$/);
    expect(body.decision?.audit).toBeDefined();
  });

  it("a datasource without a projectId is a 400 — there is no row to check", async () => {
    const app = withGrants([], async () => ({ text: DRAFT }));
    const res = await app.inject(ask({ prompt: PROMPT, datasource: CONTRACTS }));
    expect(res.statusCode).toBe(400);
  });

  it("⛔ and a typed prompt with NO datasource is not gated by a grant", async () => {
    // Nothing was read, so there is nothing to have been granted. The
    // guardrails still gate the text — that is a different question.
    const app = withGrants([], async () => ({ text: DRAFT }));
    const res = await app.inject(ask({ prompt: PROMPT }));
    expect((res.json() as { status: string }).status).toBe("proposed");
  });
});

/**
 * ⭐ THE WHOLE CHAIN, RUN. Prompt to proposal, through every gate.
 *
 * Six packages — spec, providers (via the planner shape), pseudonym, envelope,
 * guardrails, codegen, conformance — were reachable from nothing but their own
 * tests. This exercises them as one thing, which is the only way to find the
 * defects that live BETWEEN them. The `ctx.actor` bug that made the entire
 * first-party path unreachable was exactly such a defect: both packages'
 * unit tests were right about their own half.
 *
 * No API key is needed: the model is a function, which is the point of @spec
 * declaring its boundary as `PlannerLlm` rather than importing a vendor.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { EXAMPLE_DRAFT, EXAMPLE_DRAFT_JSON } from "../../../spec/src/prompt";
import { buildSubAppFromPrompt } from "../build-subapp";

const digest = (utf8: string): string => createHash("sha256").update(utf8, "utf8").digest("hex");
const OPERATOR = { actor: "Karsten Haldan" };

/** A model that answers with a draft grounded in PROMPT — as a real one must. */
const DRAFT = (() => {
  const base = JSON.parse(EXAMPLE_DRAFT_JSON) as Record<string, unknown>;
  const spec = base["spec"] as Record<string, unknown>;
  spec["visibleToRoles"] = { roles: ["legal", "admin"], evidence: "visible to legal and admin" };
  spec["capabilities"] = [
    { capability: "read:contracts", evidence: "contract folders needing review" },
  ];
  base["understanding"] = "Show contract folders needing review, for legal and admin.";
  return JSON.stringify(base);
})();

const goodModel = async () => ({ text: DRAFT });

/**
 * ⭐ TIER 2, AND GROUNDED. Both matter, and both were measured.
 *
 * TIER: "visible to legal and admin" assesses as tier 2. The same sentence
 * ending "for HR reviewers and the works council liaison" assesses as TIER 3
 * — `text-indicates-natural-person` — and so needs a human even first-party.
 * That is the line the pseudonymiser draws and it is a sensible one: a generic
 * role is not a person, a named function is closer to one.
 *
 * GROUNDED: @spec refuses a draft whose claims are not quotable from the
 * request. The model cannot hand itself `visibleToRoles` the user never asked
 * for — so the draft below quotes THIS prompt, which is what a real model
 * would have to do.
 */
const PROMPT = "Show contract folders needing review, visible to legal and admin.";

/**
 * ⭐ THE CONSENT ANSWERS, AND WHY THE FIRST ROUND DOES NOT PRODUCE A SPEC.
 *
 * Measured, not assumed: the planner's first answer to this prompt is
 * `needs_input` with two questions — `consent:read:contracts` ("the request
 * does not say the app may read contract records, and no quote from it backs
 * that scope") and `visibleToRoles`.
 *
 * That IS the per-datasource approval working: a capability nobody asked for
 * is not granted because the model drafted it. So the end-to-end path is two
 * rounds, and a test that skipped straight to a spec would be testing a
 * product that does not exist.
 */
const CONSENT = { "consent:read:contracts": "yes" };

/** The policy now lives on `BuildDeps`, because the gate runs at the INPUT
 * boundary — on the person's own words — not around the assembled prompt. */
function deps(model: () => Promise<{ text: string }>, first = true) {
  return {
    llm: model,
    ctx: OPERATOR,
    digest,
    ...(first ? { authorship: "first-party-operator" as const } : {}),
  };
}

describe("prompt → proposal, end to end", () => {
  it("⭐ plans a spec from a prompt — gate, model, draft, and @spec's own gates", async () => {
    // The whole input half works: the guardrails allow a first-party tier-2
    // prompt, the model is called, the draft parses, and @spec's evidence
    // gates accept it because every claim IS quotable from the prompt.
    //
    const outcome = await buildSubAppFromPrompt({ prompt: PROMPT }, deps(goodModel));

    // ⭐ PROMPT → PROPOSAL, END TO END. Guardrails, model, draft, @spec's
    // evidence gates, the @spec→@codegen translator, the emitters, the
    // conformance gate and the output gate — all of it, in one call, with no
    // API key because the model is a function.
    //
    // This assertion has moved three times in three commits, and each move
    // was a real blocker coming down: `generation-refused` (no translator),
    // then `translation-refused` (the planner's example declared a table),
    // then `artifacts-refused` (the output scanner read generated TypeScript
    // as data). Naming the honest end each time is what made the next one
    // findable.
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;
    const paths = outcome.generated.files.map((f) => f.path);
    // The host half a Flightdeck mount needs...
    expect(paths).toContain("server/subapps/works-council-gaps/manifest.ts");
    expect(paths).toContain("server/subapps/works-council-gaps/guard.ts");
    expect(paths).toContain("server/subapps/works-council-gaps/routes/gaps.ts");
    expect(paths).toContain("web/src/subapps/works-council-gaps/index.tsx");
    // ...and the standalone harness, so the sub-app also runs on its own.
    expect(paths).toContain("standalone/server.ts");
    expect(paths).toContain("standalone/index.html");
  });

  it("⭐ the two spec FORMATS are bridged — and the bridge refuses rather than guesses", async () => {
    // This case used to read `expect(true).toBe(true)` under a comment
    // explaining that nothing translated @spec's document into @codegen's, so
    // PROMPT → APP stopped at a schema error. `translate-spec.ts` is that
    // translator. What it will NOT do is as much of the point as what it does:
    // a @spec route carries `kind` and `capabilities`, and @codegen's propose
    // operation needs `proposalKind`, `ticketField`, `fields` and
    // `auditEvent` — which nothing in a @spec document names. So read-only
    // mini-apps translate today and proposing ones are refused BY NAME.
    const { translateSpec } = await import("../translate-spec");
    const outcome = await buildSubAppFromPrompt({ prompt: PROMPT }, deps(goodModel));
    // It got past @codegen's door, which is the whole claim.
    expect(outcome.status).not.toBe("generation-refused");

    // And the refusing half is reachable from a real planner spec, not only
    // from a hand-built fixture.
    const proposing = translateSpec({
      specVersion: 1, id: "x", label: "X", version: "0.1.0", minHostVersion: "5.0.0",
      icon: "📄", navSection: "Overview", purpose: "p", sourcePrompt: "s",
      capabilities: ["write:inbox-proposal"], visibleToRoles: ["admin"],
      derived: { routePrefix: "/api/subapps/x", webModuleId: "x", navPath: "/x", enableEnvVar: "SUBAPP_X_ENABLED", tablePrefix: "subapp_x_" },
      routes: [{ id: "f", method: "POST", path: "/file", summary: "s", kind: "propose", capabilities: ["write:inbox-proposal"] }],
      tables: [], widgets: [], settingsPanel: null,
    });
    expect(proposing.ok).toBe(false);
  });

  it("⭐ the guardrails' refusal is the ANSWER, not an exception that escapes", async () => {
    // Without the first-party flag the model is never called, and the caller
    // gets a decision carrying the envelope rather than a stack trace.
    const model = vi.fn(goodModel);
    const outcome = await buildSubAppFromPrompt({ prompt: PROMPT }, deps(model, false));

    expect(outcome.status).toBe("model-request-refused");
    if (outcome.status !== "model-request-refused") return;
    expect(outcome.decision.envelope?.disposition).toBe("requires-human-approval");
    expect(model).not.toHaveBeenCalled();
  });

  it("a prompt too thin to act on comes back as QUESTIONS, without spending a model call", async () => {
    const model = vi.fn(goodModel);
    const outcome = await buildSubAppFromPrompt({ prompt: "an app" }, deps(model));
    expect(outcome.status).toBe("needs_input");
    expect(model).not.toHaveBeenCalled(); // below MIN_PROMPT_WORDS
  });

  it("⭐ a capability nobody asked for is not granted because the model drafted it", async () => {
    // The per-datasource approval, as behaviour rather than as a feature list.
    //
    // The UNMODIFIED example draft claims `read:contracts` with evidence that
    // is NOT in this prompt, so the planner asks instead of assuming. Grounded
    // evidence needs no question — the user's own words granted it — which is
    // why the test above plans straight through.
    const outcome = await buildSubAppFromPrompt(
      { prompt: PROMPT },
      deps(async () => ({ text: EXAMPLE_DRAFT_JSON })),
    );
    expect(outcome.status).toBe("needs_input");
    if (outcome.status !== "needs_input") return;
    const ids = outcome.questions.map((q) => (q as { id?: string }).id ?? "");
    expect(ids.some((id) => id.startsWith("consent:"))).toBe(true);
  });

  it("an unusable model reply is reported as invalid_draft, not thrown", async () => {
    const outcome = await buildSubAppFromPrompt(
      { prompt: PROMPT, maxAttempts: 1 },
      deps(async () => ({ text: "I'm afraid I can't do that." })),
    );
    expect(outcome.status).toBe("invalid_draft");
  });

  it("⭐ the OUTPUT is gated too — the translator landed, so this runs", async () => {
    // gateGeneratedArtifacts is the strictest row in GATE_POLICY: tier 3/4 are
    // never approvable, because personal data in emitted files is a bug in
    // generation and the remedy for a bug is to fix it.
    const outcome = await buildSubAppFromPrompt(
      { prompt: PROMPT, answers: CONSENT },
      deps(goodModel),
    );
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;
    // It ran, on the real emitted files, and it has a content hash bound to them.
    expect(outcome.artifacts.gate).toBe("generated-artifacts");
    expect(outcome.artifacts.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("⭐ the file-shape mismatch is handled — the gate did NOT see empty files", async () => {
    // @codegen's GeneratedFile has `contents`; @guardrails' has `content`.
    // Mapping them the wrong way round hands the gate a set of empty files and
    // every one of them passes. This asserts the gate saw real bytes, by
    // feeding it a file that MUST trip it.
    const { gateGeneratedArtifacts } = await import("../../../guardrails/src/pure");
    const poisoned = gateGeneratedArtifacts(
      [{ path: "tests/subapps/x/fixture.ts", content: 'const seed = { email: "anna.sorensen@example.dk" };' }],
      { ...OPERATOR, digest },
    );
    expect(poisoned.decision).not.toBe("allow");

    // ⚠ AND THE WRONG FIELD NAME DOES NOT FAIL SAFE — it THROWS.
    // `gateGeneratedArtifacts` reads `file.content` and calls `.includes` on
    // it, so a file shaped `{ contents }` crashes rather than being refused.
    // A crash is louder than a silent pass and in that sense better, but it is
    // still the gate not answering a question it was asked. Pinned here so
    // the behaviour is known rather than discovered.
    expect(() =>
      gateGeneratedArtifacts(
        [{ path: "tests/subapps/x/fixture.ts", contents: "x" } as never],
        { ...OPERATOR, digest },
      ),
    ).toThrow();
  });
});

/**
 * ⭐ THE REFUSALS THAT LEFT NO TRACE.
 *
 * Every case above produces a `ModelRequestDecision` — a contentHash, an
 * audit body, a reason. A tier-4 payload produced none of them: the
 * pseudonymiser throws at the ceiling BEFORE calling the callback that holds
 * the gate, so the chain recorded every ordinary refusal and was silent on
 * the serious ones. `buildSubAppFromPrompt` surfaced it as an exception —
 * a crash, from a control working exactly as designed.
 */
describe("a payload above the tier ceiling is refused WITH a record", () => {
  // Measured, not assumed — both routes to 4, which are different rules:
  //   name-shaped span, no names declared → `unverified-name-shaped-content`
  //   sick leave / union membership       → `special-category-signal`
  const TIER_4 = [
    { prompt: "Show contract folders for Anna Sørensen to review.", code: "unverified-name-shaped-content" },
    { prompt: "Track sick leave and union membership for the team.", code: "special-category-signal" },
  ] as const;

  for (const { prompt, code } of TIER_4) {
    it(`refuses "${prompt.slice(0, 32)}…" as an outcome, not an exception (${code})`, async () => {
      const model = vi.fn(goodModel);
      const seen: unknown[] = [];
      const outcome = await buildSubAppFromPrompt(
        { prompt },
        { ...deps(model), onModelDecision: (d: unknown) => seen.push(d) },
      );

      expect(outcome.status).toBe("model-request-refused");
      if (outcome.status !== "model-request-refused") return;
      // Nothing was sent. This was already true — it is the part that worked.
      expect(model).not.toHaveBeenCalled();

      // ⭐ AND NOW IT IS WRITTEN DOWN. Each of these was absent before.
      expect(outcome.decision.decision).toBe("refuse");
      expect(outcome.decision.tier).toBe(4);
      expect(outcome.decision.contentHash).toMatch(/^[0-9a-f]{8,}$/);
      expect(outcome.decision.audit).toBeDefined();
      expect(outcome.decision.tierReasonCodes).toContain(code);
      // The caller's own hook fires for this refusal like any other, so a
      // host that logs decisions logs this one too.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(outcome.decision);
    });
  }

  it("⭐ the audit body carries codes and tiers — never the words that caused it", async () => {
    const prompt = "Show contract folders for Anna Sørensen to review.";
    const outcome = await buildSubAppFromPrompt({ prompt }, deps(goodModel));
    expect(outcome.status).toBe("model-request-refused");
    if (outcome.status !== "model-request-refused") return;
    // The whole decision, serialised — the shape a host would append to a
    // chain that is replicated and read by people who were not in the room.
    const written = JSON.stringify(outcome.decision);
    expect(written).not.toContain("Anna");
    expect(written).not.toContain("Sørensen");
    expect(written).not.toContain("contract folders");
    // And the hash does not reproduce the payload either: it is over a
    // compiled-in shape, so the SAME refusal reasons hash the same whatever
    // the person was called.
    const other = await buildSubAppFromPrompt(
      { prompt: "Show contract folders for Bjarne Mortensen to review." },
      deps(goodModel),
    );
    if (other.status !== "model-request-refused") throw new Error("expected a refusal");
    expect(other.decision.contentHash).toBe(outcome.decision.contentHash);
  });

  it("only a tier refusal is converted — anything else still propagates", async () => {
    // The catch that turns a throw into an outcome is the kind of code that
    // quietly swallows unrelated bugs. A tokeniser fault is not a policy
    // decision and must not come back wearing one.
    const exploding = () => {
      throw new Error("digest exploded");
    };
    await expect(
      buildSubAppFromPrompt({ prompt: PROMPT }, { ...deps(goodModel), digest: exploding }),
    ).rejects.toThrow("digest exploded");
  });
});

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
    // `auditEvent` — which nothing in a @spec document names. Since owner
    // ruling 2026-09-22 (8) a proposing route gets them from an APPROVED
    // template it names (see the describe block at the end of this file); one
    // that names none is still refused BY NAME, which is what this pins.
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

/**
 * ⭐ OWNER RULING 2026-09-22 (8), END TO END. A proposing mini-app, from a
 * prompt: the model is shown the approved catalogue, picks a template id, and
 * the fields its proposals write come from that template. HANDOVER §6 listed
 * "@spec cannot describe a proposing app" as open; this is it closing.
 */
describe("a proposing app, from the approved catalogue", () => {
  const PROPOSE_PROMPT = "Show contract folders needing review and flag a divergence for review, visible to legal and admin.";

  const proposingDraft = (template: string | null) => {
    const base = JSON.parse(DRAFT) as Record<string, unknown>;
    const spec = base["spec"] as Record<string, unknown>;
    spec["id"] = "divergence-desk";
    spec["label"] = "Divergence desk";
    spec["capabilities"] = [
      { capability: "read:contracts", evidence: "contract folders needing review" },
      { capability: "write:inbox-proposal", evidence: "flag a divergence for review" },
    ];
    spec["routes"] = [
      ...(spec["routes"] as unknown[]),
      {
        id: "flag",
        method: "POST",
        path: "/flag",
        summary: "Flag a divergence for review",
        kind: "propose",
        capabilities: ["write:inbox-proposal"],
        template,
      },
    ];
    return JSON.stringify(base);
  };

  it("⭐ shows the model the approved templates, and generates from the one it picked", async () => {
    const model = vi.fn(async () => ({ text: proposingDraft("divergence") }));
    const outcome = await buildSubAppFromPrompt({ prompt: PROPOSE_PROMPT }, deps(model));

    const system = (model.mock.calls[0] as unknown as [{ system: string }] | undefined)?.[0].system ?? "";
    expect(system).toContain("divergence");
    expect(system).toContain("handoff");

    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;
    const route = outcome.generated.files.find((f) => f.path === "server/subapps/divergence-desk/routes/flag.ts");
    expect(route?.contents).toContain("divergence-desk-divergence-");
    // The template's fields and nothing else: `ticket` and `note`.
    expect(route?.contents).toContain("ticket:");
    expect(route?.contents).toContain("note:");
    expect(outcome.conformance.ok).toBe(true);
  });

  it("asks which approved template, rather than generating, when the model names none", async () => {
    const outcome = await buildSubAppFromPrompt(
      { prompt: PROPOSE_PROMPT },
      deps(async () => ({ text: proposingDraft(null) })),
    );
    expect(outcome.status).toBe("needs_input");
    if (outcome.status !== "needs_input") return;
    const question = outcome.questions.find((q) => q.id.startsWith("routes:template:"));
    expect(question?.options).toEqual(["divergence", "handoff"]);
  });

  it("⛔ the menu is the pipeline's, not the caller's — a smuggled template never reaches the model", async () => {
    const model = vi.fn(async () => ({ text: proposingDraft("salary-change") }));
    const outcome = await buildSubAppFromPrompt(
      {
        prompt: PROPOSE_PROMPT,
        proposalTemplates: [{ id: "salary-change", summary: "Change a salary.", fields: ["ticket", "salary"] }],
      } as never,
      deps(model),
    );
    const system = (model.mock.calls[0] as unknown as [{ system: string }] | undefined)?.[0].system ?? "";
    expect(system).not.toContain("salary-change");
    expect(outcome.status).toBe("needs_input");
  });
});

/**
 * ⭐ THE CANDIDATE CARRIES THE SPEC IT WAS BUILT FROM — the file
 * `scripts/promote.sh` needs.
 *
 * promote.sh takes `SPEC=<file>`, records `sha256sum "$SPEC"` in the
 * compliance record, and re-runs `@codegen`'s CLI on that file. A `proposed`
 * outcome used to carry the generated files and no spec, so a prompt-built
 * candidate had nothing to hand promote.sh except the files themselves. It
 * now carries the TRANSLATED `@codegen` spec and the sha256 of its one
 * canonical serialisation — the bytes a person writes to disk.
 */
describe("the proposed outcome carries the @codegen spec and its canonical sha256", () => {
  it("⭐ spec is exactly translateSpec(the planner's spec) — nothing re-derived", async () => {
    const { planFromPrompt } = await import("../../../spec/src/planner");
    const { approvedTemplateMenu } = await import("../../../codegen/src/proposal-templates");
    const { translateSpec } = await import("../translate-spec");

    const outcome = await buildSubAppFromPrompt({ prompt: PROMPT }, deps(goodModel));
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;

    const planned = await planFromPrompt(
      { prompt: PROMPT, proposalTemplates: approvedTemplateMenu() },
      goodModel,
    );
    expect(planned.status).toBe("planned");
    if (planned.status !== "planned") return;
    const translated = translateSpec(planned.spec);
    expect(translated.ok).toBe(true);
    if (!translated.ok) return;
    expect(outcome.spec).toEqual(translated.spec);
  });

  it("⭐ specSha256 is sha256(serializeSpec(spec)), and serializeSpec is the canonical form", async () => {
    const { serializeSpec } = await import("../build-subapp");
    const outcome = await buildSubAppFromPrompt({ prompt: PROMPT }, deps(goodModel));
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;

    const text = serializeSpec(outcome.spec);
    expect(text).toBe(`${JSON.stringify(outcome.spec, null, 2)}\n`);
    expect(outcome.specSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.specSha256).toBe(digest(text));
  });

  it("⭐ written to a file, its file hash is specSha256 — what promote.sh's sha256sum records", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { serializeSpec } = await import("../build-subapp");
    const { generateSubApp } = await import("../../../codegen/src/pure");

    const outcome = await buildSubAppFromPrompt({ prompt: PROMPT }, deps(goodModel));
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-spec-"));
    try {
      const file = path.join(dir, "candidate.spec.json");
      fs.writeFileSync(file, serializeSpec(outcome.spec));
      const bytes = fs.readFileSync(file);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(outcome.specSha256);

      // And that file is what promote.sh's codegen step would regenerate the
      // SAME candidate from: every file path and every byte.
      const again = generateSubApp(JSON.parse(bytes.toString("utf8")));
      expect(again.files.map((f) => [f.path, f.contents])).toEqual(
        outcome.generated.files.map((f) => [f.path, f.contents]),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

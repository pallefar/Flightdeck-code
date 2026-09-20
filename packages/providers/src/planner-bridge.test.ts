/**
 * Proof that `@spec` can run on a real provider WITHOUT CHANGING ITS OWN CODE.
 *
 * Two levels of proof, because either alone is weak:
 *
 *  1. COMPILE TIME — what `plannerLlm()` returns is assigned to the real
 *     `PlannerLlm` type imported from `@spec/planner`. If @spec widens or
 *     renames its boundary, this file stops compiling. That is the check the
 *     structural port in `planner-bridge.ts` would otherwise let drift.
 *
 *  2. RUN TIME — the real `planFromPrompt` is driven end to end over a real
 *     provider (the in-memory fake, so no network), and the outcomes are
 *     asserted from @spec's side of the seam.
 *
 * ⚠ THIS IS THE ONE FILE HERE THAT DEPENDS ON A SIBLING PACKAGE. Imported by
 * relative path, the same way `packages/conformance/src/codegen-output.test.ts`
 * reaches into `@codegen`. If it goes red, read the message: a failure means
 * the bridge and @spec's boundary have disagreed, and `packages/spec/src/planner.ts`
 * decides which side is wrong.
 */

import { describe, expect, it } from "vitest";

import { planFromPrompt } from "../../spec/src/planner";
import type { PlannerLlm } from "../../spec/src/planner";

import { fakeProvider, FakeProvider } from "./fake";
import { plannerLlm } from "./planner-bridge";

/* ── 1. compile-time conformance ─────────────────────────────────────────── */

/**
 * The assignment IS the assertion: `PlannerLlm` is @spec's own type, and
 * `plannerLlm(...)` is ours. If these ever diverge, `npx tsc --noEmit` fails
 * here rather than at some call site months later.
 */
const conformingLlm: PlannerLlm = plannerLlm(fakeProvider("{}"));

describe("the bridge satisfies @spec's PlannerLlm seam", () => {
  it("is assignable to the real PlannerLlm type", () => {
    expect(typeof conformingLlm).toBe("function");
  });

  it("returns the shape @spec's PlannerCompletion describes", async () => {
    const llm = plannerLlm(fakeProvider({ output: "drafted", tokens_in: 3, tokens_out: 9 }));

    const completion = await llm({ system: "S", user: "U", purpose: "draft", attempt: 1 });

    expect(completion).toEqual({ text: "drafted", truncated: false });
  });
});

/* ── 2. what the bridge sends ────────────────────────────────────────────── */

describe("the bridge's request", () => {
  it("passes system stably and the volatile prompt as the one user turn", async () => {
    const provider = new FakeProvider(() => ({ output: "{}" }));

    await plannerLlm(provider)({ system: "STABLE", user: "VOLATILE", purpose: "draft", attempt: 1 });

    const call = provider.calls[0];
    expect(call?.request.system).toBe("STABLE");
    expect(call?.request.messages).toEqual([{ role: "user", content: "VOLATILE" }]);
  });

  it("sends exactly one user turn and no assistant prefill", async () => {
    const provider = new FakeProvider(() => ({ output: "{}" }));

    await plannerLlm(provider)({ system: "S", user: "U", purpose: "repair", attempt: 2 });

    const messages = provider.calls[0]?.request.messages ?? [];
    // A trailing assistant turn is a prefill, and a prefill is a 400 on Opus 5.
    expect(messages).toHaveLength(1);
    expect(messages.every((message) => message.role === "user")).toBe(true);
  });

  it("can spend less effort on the repair round-trip than on the draft", async () => {
    const provider = new FakeProvider(() => ({ output: "{}" }));
    const llm = plannerLlm(provider, { draftEffort: "high", repairEffort: "low" });

    await llm({ system: "S", user: "U", purpose: "draft", attempt: 1 });
    await llm({ system: "S", user: "U", purpose: "repair", attempt: 2 });

    expect(provider.calls[0]?.request.effort).toBe("high");
    expect(provider.calls[1]?.request.effort).toBe("low");
  });

  it("leaves effort and model unset when the caller did not ask, so provider config wins", async () => {
    const provider = new FakeProvider(() => ({ output: "{}" }));

    await plannerLlm(provider)({ system: "S", user: "U", purpose: "draft", attempt: 1 });

    expect(provider.calls[0]?.request.effort).toBeUndefined();
    expect(provider.calls[0]?.request.model).toBeUndefined();
  });
});

/* ── 3. end to end through the real planner ──────────────────────────────── */

const PROMPT =
  "A mini app that flags contracts missing a works-council date, visible to hr_reviewer and wc_liaison.";

/** A draft in @spec's own wire format, built here so this file owns its fixture. */
const DRAFT = {
  understanding: "Flag contracts with no works-council date.",
  spec: {
    id: "works-council-gaps",
    label: "Works council gaps",
    icon: "🗓️",
    navSection: "Contract pipeline",
    purpose: "Lists contracts with no works-council consultation date.",
    visibleToRoles: {
      roles: ["hr_reviewer", "wc_liaison"],
      evidence: "visible to hr_reviewer and wc_liaison",
    },
    capabilities: [
      { capability: "read:contracts", evidence: "contracts missing a works-council date" },
    ],
    routes: [
      {
        id: "list-gaps",
        method: "GET",
        path: "/gaps",
        summary: "Contracts with no works-council date",
        kind: "read",
        capabilities: ["read:contracts"],
      },
    ],
    tables: [
      {
        name: "gap_snapshot",
        purpose: "Last computed gap list.",
        columns: [
          { name: "contract_id", type: "text", nullable: false, pii: false },
          { name: "checked_at", type: "timestamp", nullable: false, pii: false },
        ],
      },
    ],
  },
};

describe("planFromPrompt driven over a provider", () => {
  it("consumes a provider reply and reaches a real outcome, with @spec untouched", async () => {
    const provider = fakeProvider(JSON.stringify(DRAFT));

    const outcome = await planFromPrompt({ prompt: PROMPT }, plannerLlm(provider));

    // Deliberately NOT asserting `planned`: the gates in @spec are owned by
    // another package and evolve. What this proves is that the provider's text
    // crossed the seam and was parsed and gated — anything but `invalid_draft`
    // means the bridge did its job.
    expect(outcome.status).not.toBe("invalid_draft");
  });

  it("reports a truncated reply to the planner rather than letting it parse a fragment", async () => {
    // Valid-looking JSON, cut off. If `truncated` were dropped on the way
    // across the seam, the planner would happily parse this and plan from it.
    const provider = fakeProvider({ output: JSON.stringify(DRAFT), cut_off: true });

    const outcome = await planFromPrompt({ prompt: PROMPT, maxAttempts: 1 }, plannerLlm(provider));

    expect(outcome.status).toBe("invalid_draft");
    if (outcome.status === "invalid_draft") {
      expect(outcome.issues.join(" ")).toMatch(/cut off/i);
    }
  });

  it("surfaces a provider failure as invalid_draft instead of throwing at the caller", async () => {
    const provider = fakeProvider({ output: "", error_code: "rate_limit" });

    const outcome = await planFromPrompt({ prompt: PROMPT, maxAttempts: 1 }, plannerLlm(provider));

    // planFromPrompt catches around the model call; throwing is the contract.
    expect(outcome.status).toBe("invalid_draft");
  });

  it("lets the planner retry through the bridge, draft then repair", async () => {
    const provider = fakeProvider("not json at all", JSON.stringify(DRAFT));

    const outcome = await planFromPrompt({ prompt: PROMPT, maxAttempts: 2 }, plannerLlm(provider));

    expect(provider.calls).toHaveLength(2);
    expect(outcome.status).not.toBe("invalid_draft");
  });
});

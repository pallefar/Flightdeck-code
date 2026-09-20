/**
 * THE ROUND TRIP AS THE UNIT.
 *
 * `vault-dump.test.ts` proves the vault is not reachable. This file proves the
 * package still does its job with the vault out of the caller's hands, and
 * that the tier gate is a GATE — the previous arrangement had `assessTier` as
 * a function the caller was advised to call while holding the payload, which
 * is a comment with a return value.
 */
import { describe, expect, it } from "vitest";
import { PayloadTierError, PseudonymError, ResidualPiiError, VaultDumpError } from "../errors";
import { withPseudonymisation } from "../with-pseudonymisation";

const SOURCE = "Anna Berger schrieb an carl.schmidt@acme.de am 01.03.2024. Carl Schmidt antwortete.";
const NAMES = ["Anna Berger", "Carl Schmidt"];

describe("withPseudonymisation round-trips without handing out the key", () => {
  it("tokenizes, sends the payload, and restores the reply byte-exactly", async () => {
    let seen = "";
    const { text, report } = await withPseudonymisation(SOURCE, { names: NAMES }, (payload) => {
      seen = payload.text;
      // The model echoes the payload; restoration must give the source back.
      return payload.text;
    });
    expect(seen).not.toContain("Anna Berger");
    expect(seen).toContain("<person:3>");
    expect(text).toBe(SOURCE);
    expect(report.exact).toBe(true);
    expect(report.rejected).toEqual([]);
    expect(report.dropped).toEqual([]);
  });

  it("reports by tag, never by value", async () => {
    const { report } = await withPseudonymisation(
      SOURCE,
      { names: NAMES },
      ({ text }) => `${text.match(/<person:\d+>/)?.[0]} hat geantwortet. <person:99> <date>`,
    );
    const serialised = JSON.stringify(report);
    for (const secret of ["Anna", "Berger", "carl.schmidt", "acme", "01.03.2024"]) {
      expect(serialised, secret).not.toContain(secret);
    }
    expect(report.restored.map((r) => r.tag)).toEqual(["<person:3>"]);
    expect(report.rejected.map((r) => r.reason).sort()).toEqual(["degraded", "invented"]);
    // Everything the model did not use is named, by tag.
    expect(report.dropped.length).toBeGreaterThan(0);
    expect(report.dropped.every((tag) => /^<[a-z]+:\d+>$/.test(tag))).toBe(true);
    expect(report.tokenized.every((f) => typeof f.occurrences === "number")).toBe(true);
  });

  it("carries the assessment to `send` so an audit line can be written", async () => {
    let tier = 0;
    const { report } = await withPseudonymisation(SOURCE, { names: NAMES }, (payload) => {
      tier = payload.assessment.payloadTier;
      expect(payload.assessment.vaultTier).toBe(4);
      expect(payload.assessment.coverage.unchecked.length).toBeGreaterThan(0);
      return payload.text;
    });
    expect(tier).toBe(3);
    expect(report.assessment.statement).toContain("vault is tier 4");
  });
});

describe("the tier gate is an enforcement point, not advice", () => {
  it("does not call `send` when the payload is above the ceiling", async () => {
    let called = false;
    // Art. 9 prose about a pseudonymised person floors at 4 and never reduces.
    const source = "Anna Berger ist seit der Diagnose Depression krankgeschrieben.";
    await expect(
      withPseudonymisation(source, { names: ["Anna Berger"] }, () => {
        called = true;
        return "never";
      }),
    ).rejects.toBeInstanceOf(PayloadTierError);
    expect(called, "the payload reached `send` despite the refusal").toBe(false);
  });

  it("refuses by default when NO names were declared over name-shaped text", async () => {
    // The cheapest mistake in this package: declare nothing, and nothing
    // checked the name class. `tier.ts` floors that at the source tier, so the
    // default ceiling turns the omission into a refusal rather than a wider
    // request.
    let called = false;
    const error = await withPseudonymisation("Anna Berger war am Standort Bremen.", {}, () => {
      called = true;
      return "never";
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PayloadTierError);
    expect(called).toBe(false);
    expect((error as PayloadTierError).payloadTier).toBe(4);
    expect((error as PayloadTierError).maxPayloadTier).toBe(3);
    expect((error as PayloadTierError).reasons).toContain("unverified-name-shaped-content");
    // The refusal names codes and tiers only.
    for (const secret of ["Anna", "Berger", "Bremen"]) {
      expect((error as Error).message, secret).not.toContain(secret);
    }
  });

  it("lets a caller say in code that they mean to send it", async () => {
    const { text } = await withPseudonymisation(
      "Anna Berger war am Standort Bremen.",
      { names: ["Anna Berger"], maxPayloadTier: 4 },
      ({ text: payload }) => payload,
    );
    expect(text).toBe("Anna Berger war am Standort Bremen.");
  });

  it("still refuses to transmit at all when tokenization leaves residue", async () => {
    // The proof gate is upstream of the tier gate and upstream of `send`.
    let called = false;
    await expect(
      withPseudonymisation("Kontakt: anna@acme.de", { patterns: [] }, () => {
        called = true;
        return "never";
      }),
    ).rejects.toBeInstanceOf(ResidualPiiError);
    expect(called).toBe(false);
  });
});

describe("the reply is untrusted, and the vault does not outlive the call", () => {
  it("refuses a reply that is a bare tag list, which is what a dump looks like", async () => {
    // Second line of defence, and no longer the thing the claim rests on: a
    // model (or a document that shaped the prompt) asking for the key ring
    // back gets VaultDumpError. The caller can say they meant it.
    await expect(
      withPseudonymisation(SOURCE, { names: NAMES }, () => "<person:3> <person:4> <email:1>"),
    ).rejects.toBeInstanceOf(VaultDumpError);

    const { text } = await withPseudonymisation(
      SOURCE,
      { names: NAMES, onTagOnlyOutput: "restore" },
      () => "<person:3> <person:4>",
    );
    expect(text).toBe("Anna Berger Carl Schmidt");
  });

  it("propagates a failure from `send` unchanged", async () => {
    const boom = new Error("502 from the provider");
    await expect(withPseudonymisation(SOURCE, { names: NAMES }, () => Promise.reject(boom))).rejects.toBe(boom);
  });

  it("refuses a `send` that resolves to something that is not the reply text", async () => {
    await expect(
      // A caller wiring up an SDK response object rather than its text.
      // `String(…)` on one of those is how an unrestored payload gets returned
      // as if it were an answer.
      withPseudonymisation(SOURCE, { names: NAMES }, () => ({ content: "hi" }) as unknown as string),
    ).rejects.toBeInstanceOf(PseudonymError);
  });

  it("does not leak state between calls", async () => {
    const first = await withPseudonymisation("Mail an anna@acme.de", { maxPayloadTier: 4 }, () => "<email:1>");
    const second = await withPseudonymisation("Mail an bob@acme.de", { maxPayloadTier: 4 }, () => "<email:1>");
    expect(first.text).toBe("anna@acme.de");
    expect(second.text).toBe("bob@acme.de");
  });
});

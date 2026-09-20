/**
 * ⭐ THE THIRD COPY.
 *
 * `guardrails` has `isNamedHuman`. `approvals` used to have its own weaker
 * rule and now imports that one — `redteam-attacks.test.ts` proves it. This
 * package had a THIRD, weaker still: `blank(actor.displayName)`, i.e. any
 * non-blank string is a named human.
 *
 * Measured before the fix, 18 of 21 probes disagreed. "system",
 * "automation", "agent", "admin", "service", "bot", "anonymous", "the
 * approver" and a bare "x" were all named humans HERE and refused THERE.
 *
 * That is not cosmetic in this package. The registry is what makes an
 * approved tool reusable by later projects — the "approve it once, use it
 * for future projects" path. An approval it accepts becomes a permanent,
 * citable fact about a tool that every future project inherits, so
 * "approved by system" would have travelled.
 *
 * This file exists so a fourth copy cannot appear quietly.
 */
import { describe, expect, it } from "vitest";

import { isNamedHuman } from "../../../guardrails/src/approval-pure";
import { namedHuman } from "../actor";

const asNamed = (name: string): boolean =>
  namedHuman({ kind: "human", id: name, displayName: name }) !== null;

describe("one named-human rule, across packages", () => {
  it("⭐ everything guardrails calls UNNAMED, the registry refuses too", () => {
    const disagreed: string[] = [];
    for (const name of [
      "system",
      "automation",
      "agent",
      "studio",
      "admin",
      "unknown",
      "the approver",
      "service",
      "svc",
      "bot",
      "robot",
      "none",
      "null",
      "undefined",
      "anonymous",
      "someone",
      "user",
      "x",
      "",
      "   ",
    ]) {
      expect(isNamedHuman(name), `guardrails should refuse ${JSON.stringify(name)}`).toBe(false);
      if (asNamed(name)) disagreed.push(name);
    }
    expect(disagreed).toEqual([]);
  });

  it("⛔ and a real person still passes — a rule that refuses everyone is not a rule", () => {
    for (const name of ["Anna Sørensen", "Karsten Haldan", "Wiebke Clausen"]) {
      expect(isNamedHuman(name), name).toBe(true);
      expect(asNamed(name), name).toBe(true);
    }
  });

  it("⭐ BOTH fields are checked — a real display name over a role id is refused", () => {
    // `approvals` checks displayName AND id, because either one alone lets a
    // service account wear a person's name or a person's name label a
    // service account.
    expect(namedHuman({ kind: "human", id: "system", displayName: "Anna Sørensen" })).toBeNull();
    expect(namedHuman({ kind: "human", id: "a.sorensen", displayName: "service" })).toBeNull();
    expect(namedHuman({ kind: "human", id: "a.sorensen", displayName: "Anna Sørensen" })).not.toBeNull();
  });

  it("a non-human is still refused whatever it is called", () => {
    expect(namedHuman({ kind: "agent", id: "crew.auditor", displayName: "Anna Sørensen" })).toBeNull();
    expect(namedHuman(null)).toBeNull();
    expect(namedHuman(undefined)).toBeNull();
  });

  it("the rule is IMPORTED, not transcribed — there is no local NON_NAMES here", async () => {
    // A copy that agrees today is a copy that can drift tomorrow. This is the
    // assertion that keeps it a reference rather than a duplicate.
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("../actor.ts", import.meta.url), "utf8");
    expect(source).toContain('from "../../guardrails/src/approval-pure"');
    expect(source).not.toMatch(/NON_NAMES\s*=/);
  });
});

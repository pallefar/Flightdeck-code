/**
 * The bridge between two documents that share a type name.
 *
 * Every case here is about the SAME question: does the translator carry what
 * the source actually said, or does it fill a gap with something plausible?
 * A translator that guesses ships as a working app doing what nobody asked.
 */
import { describe, expect, it } from "vitest";

import type { MiniAppSpec as SpecSpec } from "../../../spec/src/schema";
import { generateSubApp } from "../../../codegen/src/pure";
import { PROPOSAL_TEMPLATES } from "../proposal-templates";
import { translateSpec } from "../translate-spec";

const BASE: SpecSpec = {
  specVersion: 1,
  id: "works-council-gaps",
  label: "Works council gaps",
  version: "0.1.0",
  minHostVersion: "5.0.0",
  icon: "🗓️",
  navSection: "Contract pipeline",
  purpose: "Flags contracts that have no works-council consultation date recorded.",
  sourcePrompt: "Show contracts with no works-council date.",
  capabilities: ["read:contracts"],
  visibleToRoles: ["hr_reviewer", "wc_liaison"],
  derived: {
    routePrefix: "/api/subapps/works-council-gaps",
    webModuleId: "works-council-gaps",
    navPath: "/works-council-gaps",
    enableEnvVar: "SUBAPP_WORKS_COUNCIL_GAPS_ENABLED",
    tablePrefix: "subapp_works_council_gaps_",
  },
  routes: [
    { id: "list-gaps", method: "GET", path: "/gaps", summary: "Contracts with no date", kind: "read", capabilities: ["read:contracts"] },
  ],
  tables: [],
  widgets: [],
  settingsPanel: null,
};

describe("what translates", () => {
  it("⭐ carries the metadata and turns flat routes into domains", () => {
    const result = translateSpec(BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.id).toBe("works-council-gaps");
    expect(result.spec.summary).toBe(BASE.purpose);
    expect(result.spec.capabilities).toEqual(["read:contracts"]);
    expect(result.spec.visibleToRoles).toEqual(["hr_reviewer", "wc_liaison"]);
    // The domain is the first path segment — derived, so the same spec always
    // writes the same `routes/<name>.ts` rather than renaming files per run.
    expect(result.spec.domains).toEqual([
      {
        name: "gaps",
        routes: [
          { method: "GET", path: "/gaps", summary: "Contracts with no date", operation: { kind: "list-contracts" } },
        ],
      },
    ]);
  });

  it("groups several routes under one domain, and splits different ones", () => {
    const result = translateSpec({
      ...BASE,
      routes: [
        { id: "a", method: "GET", path: "/gaps", summary: "s", kind: "read", capabilities: ["read:contracts"] },
        { id: "b", method: "GET", path: "/gaps/:id", summary: "s", kind: "read", capabilities: ["read:contracts"] },
        { id: "c", method: "GET", path: "/filed", summary: "s", kind: "read", capabilities: ["write:inbox-proposal"] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.domains.map((d) => d.name)).toEqual(["gaps", "filed"]);
    expect(result.spec.domains[0]?.routes).toHaveLength(2);
    // A read route holding the write scope reads the sub-app's OWN proposals —
    // the only durable state a database-free mini-app can observe about itself.
    expect(result.spec.domains[1]?.routes[0]?.operation).toEqual({ kind: "list-proposals" });
  });

  it("passes webModuleId through, so the two packages' derivations must agree", () => {
    const result = translateSpec(BASE);
    expect(result.ok && result.spec.webModuleId).toBe("works-council-gaps");
  });
});

describe("what it refuses — and refuses rather than approximates", () => {
  it("⭐ a propose route that names no approved template — the fields come from the catalogue, never the model", () => {
    // Owner ruling 2026-09-22 (8). @codegen's propose operation needs
    // proposalKind, ticketField, fields and auditEvent; a @spec route names a
    // template, and nothing else in the document names a field.
    const result = translateSpec({
      ...BASE,
      capabilities: ["write:inbox-proposal"],
      routes: [
        { id: "file", method: "POST", path: "/file", summary: "File it", kind: "propose", capabilities: ["write:inbox-proposal"] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals[0]?.at).toBe("routes[0].template");
    expect(result.refusals[0]?.needs).toMatch(/approved proposal template.*divergence.*handoff/);
  });

  it("⭐ a settingsPanel, because the same field name means two different things", () => {
    // @spec's tier is the approvals vocabulary; @codegen's is who may open
    // the panel. Found by the compiler, not by reading either schema.
    const result = translateSpec({ ...BASE, settingsPanel: { tier: "project" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.some((r) => r.at === "settingsPanel")).toBe(true);
  });

  it("⭐ a table — refused, NOT dropped", () => {
    // Emitting the same app without the persistence it asked for is a
    // different app with the same name.
    const result = translateSpec({
      ...BASE,
      tables: [
        {
          name: "gap_snapshot",
          purpose: "cache",
          columns: [{ name: "contract_id", type: "text", nullable: false, pii: false }],
        } as SpecSpec["tables"][number],
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.some((r) => r.at === "tables")).toBe(true);
  });

  it("a path with no first segment to name a domain file", () => {
    const result = translateSpec({
      ...BASE,
      routes: [{ id: "root", method: "GET", path: "/", summary: "s", kind: "read", capabilities: ["read:contracts"] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals[0]?.at).toBe("routes[0].path");
  });

  it("reports EVERY refusal, not just the first — a person fixes one document", () => {
    const result = translateSpec({
      ...BASE,
      settingsPanel: { tier: "ceiling" },
      routes: [
        { id: "file", method: "POST", path: "/file", summary: "s", kind: "propose", capabilities: ["write:inbox-proposal"] },
        { id: "root", method: "GET", path: "/", summary: "s", kind: "read", capabilities: ["read:contracts"] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((r) => r.at).sort()).toEqual(["routes[0].template", "routes[1].path", "settingsPanel"]);
  });

  it("never names a VALUE in a refusal — only a path and what is needed", () => {
    const result = translateSpec({
      ...BASE,
      routes: [
        { id: "file", method: "POST", path: "/anna-sorensen-salary", summary: "Anna Sørensen salary", kind: "propose", capabilities: ["write:inbox-proposal"] },
        { id: "file2", method: "POST", path: "/anna", summary: "s", kind: "propose", capabilities: ["write:inbox-proposal"], template: "anna-sorensen" },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const written = JSON.stringify(result.refusals);
    expect(written).not.toContain("Anna");
    expect(written).not.toContain("Sørensen");
    expect(written).not.toContain("anna-sorensen");
  });
});

/**
 * ⭐ OWNER RULING 2026-09-22 (8): proposing apps are generated only from the
 * closed catalogue of approved templates. The model named a template id; the
 * translator is where that id becomes the fields a proposal writes — and where
 * an unknown or unapproved one is refused.
 */
describe("proposing routes, from the approved catalogue", () => {
  const PROPOSING: SpecSpec = {
    ...BASE,
    capabilities: ["read:contracts", "write:inbox-proposal"],
    routes: [
      BASE.routes[0]!,
      { id: "flag", method: "POST", path: "/flag", summary: "Flag a divergence", kind: "propose", capabilities: ["write:inbox-proposal"], template: "divergence" },
    ],
  };

  it("⭐ turns a template id into the template's operation — nothing from the route but its path", () => {
    const result = translateSpec(PROPOSING);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const flag = result.spec.domains.find((d) => d.name === "flag")?.routes[0];
    const template = PROPOSAL_TEMPLATES.find((t) => t.id === "divergence")!;
    expect(flag).toEqual({
      method: "POST",
      path: "/flag",
      summary: "Flag a divergence",
      operation: {
        kind: "propose",
        proposalKind: template.proposalKind,
        ticketField: template.ticketField,
        fields: template.fields,
        // Namespaced under THIS app's id, as @codegen requires.
        auditEvent: `works-council-gaps.${template.auditEventSuffix}`,
      },
    });
  });

  it("⭐ generates: the translated spec passes @codegen's own door", () => {
    const result = translateSpec(PROPOSING);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const generated = generateSubApp(result.spec);
    const routes = generated.files.find((f) => f.path === "server/subapps/works-council-gaps/routes/flag.ts");
    expect(routes?.contents).toContain("works-council-gaps-divergence-");
  });

  it("⛔ refuses a template id that is not in the catalogue, without echoing it", () => {
    const result = translateSpec({
      ...PROPOSING,
      routes: [PROPOSING.routes[0]!, { ...PROPOSING.routes[1]!, template: "salary-change" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]?.at).toBe("routes[1].template");
    expect(result.refusals[0]?.needs).toMatch(/not in the approved catalogue/);
    expect(JSON.stringify(result.refusals)).not.toContain("salary-change");
  });

  it("⛔ refuses an UNAPPROVED template, even one that is in the catalogue", () => {
    const unapproved = PROPOSAL_TEMPLATES.map((t) => (t.id === "divergence" ? { ...t, approval: null } : t));
    const result = translateSpec(PROPOSING, unapproved);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals[0]?.at).toBe("routes[1].template");
    expect(result.refusals[0]?.needs).toMatch(/no approval record/);
  });

  it("⛔ refuses a template edited after its approval", () => {
    const edited = PROPOSAL_TEMPLATES.map((t) =>
      t.id === "divergence" ? { ...t, fields: [...t.fields, { name: "salary", type: "number" as const }] } : t,
    );
    const result = translateSpec(PROPOSING, edited);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals[0]?.needs).toMatch(/changed since it was approved/);
  });

  it("⛔ refuses two routes backed by one template — their proposals would be indistinguishable", () => {
    const result = translateSpec({
      ...PROPOSING,
      routes: [...PROPOSING.routes, { ...PROPOSING.routes[1]!, id: "flag2", path: "/flag-again" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((r) => r.at)).toEqual(["routes[2].template"]);
  });

  it("read-only specs are unaffected — the same output as before the catalogue existed", () => {
    const result = translateSpec(BASE, []);
    expect(result.ok).toBe(true);
  });
});

/**
 * The schema is the last line before codegen. These tests pin the cross-field rules that a
 * field-by-field reading would miss - the ones that would otherwise surface as a host that
 * refuses to boot, or as a consent screen that understates what the code does.
 */

import { describe, expect, it } from "vitest";
import { formatIssues, miniAppSpecSchema, parseMiniAppSpec, toManifestFields } from "./schema";
import type { MiniAppSpec } from "./schema";
import { derivationsFor } from "./vocabulary";

const valid: MiniAppSpec = {
  specVersion: 1,
  id: "works-council-gaps",
  label: "Works council gaps",
  version: "0.1.0",
  minHostVersion: "5.0.0",
  icon: "🗓️",
  navSection: "Contract pipeline",
  purpose: "Lists contracts with no works-council consultation date.",
  sourcePrompt: "Flag contracts missing a works-council date.",
  capabilities: ["read:contracts"],
  visibleToRoles: ["hr_reviewer"],
  derived: derivationsFor("works-council-gaps"),
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
      fullName: "subapp_works_council_gaps_gap_snapshot",
      purpose: "Last computed gap list.",
      columns: [{ name: "contract_id", type: "text", nullable: false, pii: false }],
    },
  ],
  widgets: [],
  settingsPanel: null,
};

const mutate = (change: (draft: MiniAppSpec) => void): unknown => {
  const draft = structuredClone(valid) as MiniAppSpec;
  change(draft);
  return draft;
};

const messagesFor = (value: unknown): string => {
  const result = parseMiniAppSpec(value);
  expect(result.success).toBe(false);
  return result.success ? "" : formatIssues(result.error).join(" | ");
};

describe("miniAppSpecSchema", () => {
  it("accepts a complete spec", () => {
    expect(miniAppSpecSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unknown key rather than passing it to codegen", () => {
    expect(messagesFor({ ...valid, owner: "hr" })).toContain("owner");
  });

  it("rejects derived values that do not follow from the id", () => {
    expect(
      messagesFor(
        mutate((draft) => {
          (draft.derived as { routePrefix: string }).routePrefix = "/api/apps/something-else";
        }),
      ),
    ).toContain("derived.routePrefix");
  });

  it("rejects a route that uses a scope the manifest does not declare", () => {
    expect(
      messagesFor(
        mutate((draft) => {
          draft.routes[0] = { ...valid.routes[0]!, capabilities: ["read:contracts", "write:inbox-proposal"] };
        }),
      ),
    ).toContain("consent screen would understate");
  });

  it("rejects a declared scope that no route uses", () => {
    expect(
      messagesFor(
        mutate((draft) => {
          (draft.capabilities as string[]).push("write:inbox-proposal");
        }),
      ),
    ).toContain("narrowest capabilities");
  });

  it("rejects a proposing route without the write scope, and a reading route with it", () => {
    expect(
      messagesFor(
        mutate((draft) => {
          draft.routes[0] = { ...valid.routes[0]!, kind: "propose" };
        }),
      ),
    ).toContain("proposes but does not hold");

    expect(
      messagesFor(
        mutate((draft) => {
          (draft.capabilities as string[]).push("write:inbox-proposal");
          draft.routes[0] = { ...valid.routes[0]!, capabilities: ["read:contracts", "write:inbox-proposal"] };
        }),
      ),
    ).toContain("read-only but holds");
  });

  it("requires a non-empty audience", () => {
    expect(
      messagesFor(
        mutate((draft) => {
          (draft.visibleToRoles as string[]).length = 0;
        }),
      ),
    ).toContain("non-empty");
  });

  it("holds the host version ceiling", () => {
    expect(
      messagesFor(
        mutate((draft) => {
          (draft as { minHostVersion: string }).minHostVersion = "5.1.0";
        }),
      ),
    ).toContain("5.0.0");
    expect(
      miniAppSpecSchema.safeParse(
        mutate((draft) => {
          (draft as { minHostVersion: string }).minHostVersion = "4.9.0";
        }),
      ).success,
    ).toBe(true);
  });

  it("keeps the manifest literal: real id, real label, real emoji", () => {
    expect(messagesFor(mutate((draft) => ((draft as { id: string }).id = "Works_Council")))).toContain("id");
    expect(
      messagesFor(mutate((draft) => ((draft as { label: string }).label = "app.contracts.title"))),
    ).toContain("i18n");
    expect(messagesFor(mutate((draft) => ((draft as { icon: string }).icon = "calendar")))).toContain("emoji");
  });

  it("keeps every table under the id-derived prefix", () => {
    expect(
      messagesFor(
        mutate((draft) => {
          draft.tables[0] = { ...valid.tables[0]!, fullName: "contracts_gap_snapshot" };
        }),
      ),
    ).toContain("subapp_works_council_gaps_gap_snapshot");
  });

  it("rejects duplicate route ids and duplicate endpoints", () => {
    expect(
      messagesFor(
        mutate((draft) => {
          draft.routes.push({ ...valid.routes[0]!, path: "/other" });
        }),
      ),
    ).toContain("used twice");
    expect(
      messagesFor(
        mutate((draft) => {
          draft.routes.push({ ...valid.routes[0]!, id: "list-gaps-2" });
        }),
      ),
    ).toContain("GET /gaps");
  });
});

describe("toManifestFields", () => {
  it("returns exactly the fields the host manifest validates", () => {
    expect(toManifestFields(valid)).toEqual({
      id: "works-council-gaps",
      label: "Works council gaps",
      version: "0.1.0",
      minHostVersion: "5.0.0",
      icon: "🗓️",
      navSection: "Contract pipeline",
      routePrefix: "/api/apps/works-council-gaps",
      webModuleId: "works-council-gaps",
      capabilities: ["read:contracts"],
      visibleToRoles: ["hr_reviewer"],
      settingsPanel: null,
      widgets: [],
    });
    // Route and table detail is codegen's input, not manifest surface.
    expect(Object.keys(toManifestFields(valid))).not.toContain("routes");
  });
});

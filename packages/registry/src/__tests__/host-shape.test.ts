/**
 * THE EMITTED JSON IS THE HOST'S FILE.
 *
 * `HOST_FILE_AS_SHIPPED` below is copied verbatim from the real
 * `project-contract/subapps.json` (trimmed to two installs and three history
 * rows; every key and every spelling is the file's own). It is embedded rather
 * than read from disk so the suite measures the SHAPE and not whether a sibling
 * checkout happens to be mounted — but it is a copy of something real, which is
 * what makes "our emission looks like that" a claim worth making.
 *
 * Two schemas are used on purpose, and the difference between them is the point:
 *
 *   `hostRegistryFileSchema`    — a mirror of the host's OWN reader, leniency
 *                                 included. If our output fails this, the host
 *                                 cannot read it.
 *   `emittedRegistryFileSchema` — what Studio additionally promises about what
 *                                 it writes (`.strict()`, real scope literals,
 *                                 a slug id). Stricter than the host on purpose;
 *                                 a gate in front of a fail-loud boot should be.
 *
 * The first is also run against the REAL file, so a mirror that had drifted
 * into fantasy would fail here rather than in production.
 */

import { describe, expect, it } from "vitest";

import {
  SUBAPP_REGISTRY_SCHEMA,
  applyEventsToHostRegistry,
  emittedRegistryFileSchema,
  hostRegistryFileSchema,
  readHostRegistryFile,
  serializeSubAppRegistryFile,
  toSubAppRegistryFile,
} from "../emit";
import {
  approve,
  createLedger,
  disableForProject,
  disableFunctionWide,
  enableForProject,
  enableFunctionWide,
  propose,
  register,
} from "../ledger";
import { ADMIN, AGENT, APPROVER, T, miniApp, mustOk, script } from "./support";
import type { Artifact } from "../artifact";
import type { Ledger, LedgerResult } from "../ledger";

/** Verbatim from `project-contract/subapps.json` (host version 5.0.0). */
const HOST_FILE_AS_SHIPPED = {
  schema: "subapp-registry/1",
  installs: [
    {
      id: "docusign",
      version: "0.1.0",
      enabled: true,
      installedAt: "2026-08-25T07:34:05.289Z",
      installedBy: "uat-admin",
      grantedScopes: ["read:contracts"],
    },
    {
      id: "maps",
      version: "0.1.0",
      enabled: true,
      installedAt: "2026-08-25T07:34:07.642Z",
      installedBy: "uat-admin",
      grantedScopes: [],
    },
  ],
  _history: [
    { at: "2026-08-12T12:05:39.551Z", by: "uat-super", event: "subapp.enabled", subAppId: "maps" },
    { at: "2026-08-12T12:05:39.604Z", by: "uat-super", event: "subapp.enabled", subAppId: "docusign" },
    { at: "2026-09-01T09:26:17.281Z", by: "uat-super", event: "subapp.enabled", subAppId: "advantage" },
  ],
} as const;

/** Run one artifact all the way to "enabled in one project". */
function through(ledger: Ledger, artifact: Artifact, workflowId: string, projectId: string) {
  const steps: LedgerResult[] = [];
  const p = mustOk(propose(ledger, { artifact, workflowId, by: AGENT, at: T.proposed }));
  steps.push(p);
  const a = mustOk(approve(p.ledger, { artifactId: artifact.id, contentHash: p.entry.contentHash, by: APPROVER, at: T.approved }));
  steps.push(a);
  const r = mustOk(register(a.ledger, { artifactId: artifact.id, contentHash: p.entry.contentHash, by: ADMIN, at: T.registered }));
  steps.push(r);
  const e = mustOk(enableFunctionWide(r.ledger, { artifactId: artifact.id, by: ADMIN, at: T.enabled }));
  steps.push(e);
  const x = mustOk(enableForProject(e.ledger, { artifactId: artifact.id, projectId, by: ADMIN, at: T.project }));
  steps.push(x);
  return { ledger: x.ledger, steps, contentHash: p.entry.contentHash };
}

function mixedLedger() {
  const first = through(createLedger(), miniApp(), "orchestrate-workflow", "bensheim");
  const second = through(first.ledger, script(), "quality-check", "hamburg");
  return { ledger: second.ledger, miniAppHash: first.contentHash };
}

describe("the mirror is a mirror", () => {
  it("accepts the real, shipped host file", () => {
    expect(hostRegistryFileSchema.safeParse(HOST_FILE_AS_SHIPPED).success).toBe(true);
  });

  it("degrades to empty on garbage rather than throwing, exactly like the host's reader", () => {
    expect(readHostRegistryFile("not json at all")).toEqual({ installs: [], history: [] });
    expect(readHostRegistryFile(undefined)).toEqual({ installs: [], history: [] });
    expect(readHostRegistryFile({ installs: [{ id: 7 }] })).toEqual({ installs: [], history: [] });
    expect(readHostRegistryFile(JSON.stringify(HOST_FILE_AS_SHIPPED)).installs).toHaveLength(2);
  });
});

describe("what Studio emits", () => {
  it("validates against the host's schema AND Studio's stricter one", () => {
    const { ledger } = mixedLedger();
    const file = toSubAppRegistryFile(ledger);

    expect(file.schema).toBe(SUBAPP_REGISTRY_SCHEMA);
    expect(hostRegistryFileSchema.safeParse(file).success).toBe(true);
    const strict = emittedRegistryFileSchema.safeParse(file);
    expect(strict.success, JSON.stringify(strict.error?.issues ?? [])).toBe(true);
  });

  it("an install row carries the host's six keys and not a seventh", () => {
    const { ledger } = mixedLedger();
    const row = toSubAppRegistryFile(ledger).installs[0];
    expect(Object.keys(row ?? {})).toEqual([
      "id",
      "version",
      "enabled",
      "installedAt",
      "installedBy",
      "grantedScopes",
    ]);
    expect(row).toEqual({
      id: "wc-clock",
      version: "0.1.0",
      enabled: true,
      installedAt: T.enabled,
      installedBy: "uat-admin",
      grantedScopes: ["read:contracts"],
    });
  });

  it("survives a JSON round-trip through the host's own formatting", () => {
    const { ledger } = mixedLedger();
    const file = toSubAppRegistryFile(ledger);
    const text = serializeSubAppRegistryFile(file);

    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
    expect(readHostRegistryFile(text).installs).toEqual(file.installs);
  });
});

describe("a script never reaches the host's sub-app ledger", () => {
  it("is absent from installs and from _history, while living fully in the Studio ledger", () => {
    const { ledger } = mixedLedger();
    const file = toSubAppRegistryFile(ledger);

    // Both artifacts went through the identical lifecycle...
    expect(ledger.entries.map((e) => e.artifactId).sort()).toEqual(["parity-scaffold", "wc-clock"]);
    expect(ledger.history.filter((h) => h.subAppId === "parity-scaffold")).toHaveLength(5);

    // ...and only the mini-app is a row the host could resolve with getManifest.
    expect(file.installs.map((i) => i.id)).toEqual(["wc-clock"]);
    expect(JSON.stringify(file)).not.toContain("parity-scaffold");
  });
});

describe("history rows", () => {
  it("a host-native event is written with the host's four keys, indistinguishable from its own", () => {
    const { ledger } = mixedLedger();
    const rows = toSubAppRegistryFile(ledger)._history as Array<Record<string, unknown>>;
    const enabled = rows.find((r) => r["event"] === "subapp.enabled");
    const projectEnabled = rows.find((r) => r["event"] === "subapp.project-enabled");

    expect(Object.keys(enabled ?? {})).toEqual(["at", "by", "event", "subAppId"]);
    expect(Object.keys(projectEnabled ?? {})).toEqual(["at", "by", "event", "subAppId"]);
    // The host's own rows have exactly this shape.
    expect(Object.keys(HOST_FILE_AS_SHIPPED._history[0])).toEqual(["at", "by", "event", "subAppId"]);
  });

  it("a lifecycle event carries the provenance the host's four keys cannot", () => {
    const { ledger, miniAppHash } = mixedLedger();
    const rows = toSubAppRegistryFile(ledger)._history as Array<Record<string, unknown>>;
    const approved = rows.find((r) => r["event"] === "subapp.approved");

    expect(approved).toMatchObject({
      at: T.approved,
      by: "k.haldan",
      event: "subapp.approved",
      subAppId: "wc-clock",
      kind: "mini-app",
      contentHash: miniAppHash,
      workflowId: "orchestrate-workflow",
      grantedScopes: ["read:contracts"],
    });
    // The whole lifecycle is legible from the file alone.
    expect(rows.map((r) => r["event"])).toEqual([
      "subapp.proposed",
      "subapp.approved",
      "subapp.registered",
      "subapp.enabled",
      "subapp.project-enabled",
    ]);
  });
});

describe("merging into a file that already exists", () => {
  it("keeps every install and every history row the host wrote, and appends ours", () => {
    const { ledger, steps } = through(createLedger(), miniApp(), "orchestrate-workflow", "bensheim");
    let file: unknown = HOST_FILE_AS_SHIPPED;
    for (const step of steps) {
      if (!step.ok) throw new Error(step.reason);
      file = applyEventsToHostRegistry(file, ledger, step.events);
    }

    const merged = readHostRegistryFile(file);
    expect(merged.installs.map((i) => i.id)).toEqual(["docusign", "maps", "wc-clock"]);
    // Pre-existing rows are untouched, byte for byte.
    expect(merged.installs[0]).toEqual(HOST_FILE_AS_SHIPPED.installs[0]);
    expect(merged.installs[1]).toEqual(HOST_FILE_AS_SHIPPED.installs[1]);

    // _history is ADDITIVE: the host's three rows stay in front of ours.
    expect(merged.history).toHaveLength(3 + 5);
    expect(merged.history.slice(0, 3)).toEqual(HOST_FILE_AS_SHIPPED._history);
    expect(hostRegistryFileSchema.safeParse(file).success).toBe(true);
  });

  it("replaces an artifact's row instead of appending a second one", () => {
    const { ledger, steps } = through(createLedger(), miniApp(), "orchestrate-workflow", "bensheim");
    let file: unknown = HOST_FILE_AS_SHIPPED;
    for (const step of steps) {
      if (!step.ok) throw new Error(step.reason);
      file = applyEventsToHostRegistry(file, ledger, step.events);
    }

    const off = mustOk(disableFunctionWide(ledger, { artifactId: "wc-clock", by: ADMIN, at: T.later }));
    file = applyEventsToHostRegistry(file, off.ledger, off.events);

    const merged = readHostRegistryFile(file);
    expect(merged.installs.filter((i) => i.id === "wc-clock")).toHaveLength(1);
    // The row SURVIVES the disable, carrying `enabled: false` — "never enabled"
    // and "turned off" must not be byte-identical.
    expect(merged.installs.find((i) => i.id === "wc-clock")).toMatchObject({
      enabled: false,
      installedAt: T.later,
      installedBy: "uat-admin",
    });
    expect(merged.history.at(-1)).toEqual({
      at: T.later,
      by: "uat-admin",
      event: "subapp.disabled",
      subAppId: "wc-clock",
    });
  });

  it("a per-project disable writes history but never touches the Function's install row", () => {
    const { ledger } = through(createLedger(), miniApp(), "orchestrate-workflow", "bensheim");
    const before = toSubAppRegistryFile(ledger).installs;

    const off = mustOk(
      disableForProject(ledger, { artifactId: "wc-clock", projectId: "bensheim", by: ADMIN, at: T.later }),
    );
    const after = toSubAppRegistryFile(off.ledger).installs;

    // subapps.json is the FUNCTION's install ledger, not a project's.
    expect(after).toEqual(before);
    expect(off.events.map((e) => e.event)).toEqual(["subapp.project-disabled"]);
  });
});

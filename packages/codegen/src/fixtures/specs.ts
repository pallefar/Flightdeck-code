/** Fixture specs. Three of them, and which one is the PRIMARY matters.
 *
 * `contractRunSpec` is the product: a Cowork workflow converted into a
 * database-free mini-app. It carries a `## Procedure` as workflow steps,
 * binds three of them to routes, leaves three as checklist lines, and
 * reaches the host only through the capability adapter. It is the shape
 * every other test in this package should be read against.
 *
 * `minimalSpec` is the smallest thing that generates at all — one route,
 * no workflow — which keeps the "floor" path honest when the workflow
 * branch is not taken.
 *
 * `wcClockSpec` is ⛔ NOT the mini-app path. It declares tables and so has
 * to say `profile: "table-backed"` out loud. It is kept because that path
 * works and is tested (every operation kind, every field type, a
 * CHECK-constrained enum, an index, a settings panel, both scopes) — but a
 * spec that looks like this is not what Studio converts a workflow into. */
import type { MiniAppSpec } from "../spec-contract";

export const minimalSpec = {
  id: "shift-notes",
  label: "Shift Notes",
  icon: "📝",
  navSection: "Ops & insight",
  summary: "The contract folders this app may read. Nothing is stored.",
  capabilities: ["read:contracts"],
  visibleToRoles: ["admin"],
  domains: [
    {
      name: "contracts",
      title: "Contract folders",
      routes: [
        {
          method: "GET",
          path: "/contracts",
          summary: "Contract folders visible to this workspace",
          operation: { kind: "list-contracts" },
        },
      ],
    },
  ],
} satisfies MiniAppSpec;

/** ⭐ THE PRIMARY FIXTURE — a Cowork workflow, converted.
 *
 * Derived from `skills/orchestrate-workflow/SKILL.md`: its frontmatter
 * `name`/`description` become the workflow header, and its `## Procedure`
 * becomes the six steps below, with the skill's own gate language kept
 * (step 3 is the statutory step-graph, which the skill says may never be
 * skipped or self-approved, so it carries no action at all).
 *
 * Three steps bind to routes and three do not, which is the realistic
 * ratio: most of a workflow happens outside any one app, and a page that
 * pretended otherwise would be the wrong page. Nothing here declares a
 * table — the app's entire durable output is the proposals it files. */
export const contractRunSpec = {
  id: "contract-run",
  label: "Contract Run",
  icon: "🧭",
  navSection: "Contract pipeline",
  summary: "Walk a contract folder through the orchestrate-workflow procedure, proposing each hand-off for a human to approve.",
  capabilities: ["read:contracts", "write:inbox-proposal"],
  visibleToRoles: ["hr_preparer", "hr_reviewer", "wc_liaison", "legal", "admin"],
  workflow: {
    name: "orchestrate-workflow",
    description:
      "Drive an employment contract through its country-specific workflow step-graph by reading and updating its on-disk folder and manifest.json; idempotent and resumable across human and RPA hand-offs.",
    source: "skills/orchestrate-workflow/SKILL.md",
    steps: [
      {
        n: 1,
        title: "Read state",
        detail: "Load the folder and see which artifacts exist and which steps are done, audited and approved.",
        needs: ["contracts/{ticket}_{person}/", "manifest.json"],
        produces: ["Where things stand"],
        gate: "auto",
        action: { domain: "folders", method: "GET", path: "/contracts" },
      },
      {
        n: 2,
        title: "Validate consistency",
        detail:
          "Reconcile the folder against canonical memory and flag divergence — never silently trust the folder.",
        needs: ["Pinned template version", "Canonical memory"],
        produces: ["Divergence flag"],
        gate: "human",
        action: { domain: "handoffs", method: "POST", path: "/flag" },
      },
      {
        n: 3,
        title: "Enforce the step-graph as gates",
        detail:
          "Follow the pack's stepGraph. Never advance out of order, never self-approve, never skip a statutory step (DE works council; fixed-term wet-ink issuance).",
        needs: ["Country pack stepGraph"],
        produces: ["Next allowable step"],
        gate: "statutory",
      },
      {
        n: 4,
        title: "Run the next step",
        detail: "Delegate to the responsible crew agent for the step the graph allows.",
        needs: ["Next allowable step"],
        produces: ["Step output"],
        gate: "human",
      },
      {
        n: 5,
        title: "Ask for the hand-off",
        detail: "At every hand-off that needs a human, the ping is drafted rather than sent.",
        needs: ["Step output"],
        produces: ["Hand-off proposal"],
        gate: "human",
        action: { domain: "handoffs", method: "POST", path: "/handoff" },
      },
      {
        n: 6,
        title: "Update state",
        detail:
          "Write the transition to manifest.json and canonical memory with actor, time and version. Humans are never the agent; agents never appear as approvers.",
        needs: ["Approval"],
        produces: ["manifest.json entry", "Audit event"],
        gate: "human",
      },
    ],
  },
  domains: [
    {
      name: "folders",
      title: "Contract folders",
      routes: [
        {
          method: "GET",
          path: "/contracts",
          summary: "Load the contract folders this app may read",
          operation: { kind: "list-contracts" },
        },
      ],
    },
    {
      name: "ledger",
      title: "Filed proposals",
      routes: [
        {
          method: "GET",
          path: "/proposals",
          summary: "Everything this app has already proposed",
          operation: { kind: "list-proposals" },
        },
      ],
    },
    {
      name: "handoffs",
      title: "Hand-offs",
      routes: [
        {
          method: "POST",
          path: "/flag",
          summary: "Flag a divergence for review",
          operation: {
            kind: "propose",
            proposalKind: "divergence",
            ticketField: "ticket",
            auditEvent: "contract-run.divergence-proposed",
            fields: [
              { name: "ticket", type: "string" },
              { name: "note", type: "string", maxLength: 500, optional: true },
            ],
          },
        },
        {
          method: "POST",
          path: "/handoff",
          summary: "Propose the hand-off ping",
          operation: {
            kind: "propose",
            proposalKind: "handoff",
            ticketField: "ticket",
            auditEvent: "contract-run.handoff-proposed",
            fields: [
              { name: "ticket", type: "string" },
              { name: "step", type: "enum", values: ["works-council", "offer-letter", "approval", "finalize"] },
            ],
          },
        },
      ],
    },
  ],
} satisfies MiniAppSpec;

/** ⛔ NOT a mini-app. Kept as the regression fixture for the table path,
 * which is why it has to name that profile explicitly — the default
 * refuses it. */
export const wcClockSpec = {
  profile: "table-backed",
  id: "wc-clock",
  label: "Works Council Clock",
  version: "0.1.0",
  icon: "⏱️",
  navSection: "Contract pipeline",
  summary: "Track the statutory consultation window for a contract folder, and ask for a review.",
  capabilities: ["read:contracts", "write:inbox-proposal"],
  visibleToRoles: ["hr_preparer", "hr_reviewer", "wc_liaison", "admin"],
  settingsPanel: { tier: "workspace-admin", label: "Clock defaults" },
  tables: [
    {
      name: "clocks",
      columns: [
        { name: "ticket", type: "text", notNull: true },
        { name: "started_at", type: "text", notNull: true },
        { name: "state", type: "text", notNull: true, values: ["running", "paused", "expired"] },
        { name: "days", type: "integer", notNull: true },
        { name: "statutory", type: "integer", notNull: true },
        { name: "note", type: "text" },
      ],
      indexes: [{ on: ["ticket"] }],
    },
  ],
  domains: [
    {
      name: "clocks",
      title: "Consultation clocks",
      routes: [
        {
          method: "GET",
          path: "/clocks",
          summary: "Clocks running in this workspace",
          operation: { kind: "list-rows", table: "clocks", orderBy: { column: "started_at", direction: "desc" }, limit: 100 },
        },
        {
          method: "GET",
          path: "/clocks/:clockId",
          operation: { kind: "get-row", table: "clocks", keyColumn: "id", param: "clockId" },
        },
        {
          method: "POST",
          path: "/clocks",
          summary: "Start a consultation clock",
          operation: {
            kind: "insert-row",
            table: "clocks",
            auditEvent: "wc-clock.clock-started",
            fields: [
              { name: "ticket", type: "string", maxLength: 64 },
              { name: "startedAt", type: "string", maxLength: 40 },
              { name: "state", type: "enum", values: ["running", "paused", "expired"] },
              { name: "days", type: "integer" },
              { name: "statutory", type: "boolean" },
              { name: "note", type: "string", maxLength: 500, optional: true },
            ],
          },
        },
      ],
    },
    {
      name: "review",
      title: "Review",
      routes: [
        {
          method: "GET",
          path: "/contracts",
          summary: "Contract folders this app may read",
          operation: { kind: "list-contracts" },
        },
        {
          method: "POST",
          path: "/flag",
          summary: "Flag a divergence for review",
          // Owner ruling 2026-09-22 (8): the approved `divergence` template, exactly
          // (`proposal-templates.ts`). This route used to file its own `flag` kind with the
          // same two fields; @codegen now refuses a proposing route no approved template
          // stands for, fixtures included.
          operation: {
            kind: "propose",
            proposalKind: "divergence",
            ticketField: "ticket",
            auditEvent: "wc-clock.divergence-proposed",
            fields: [
              { name: "ticket", type: "string" },
              { name: "note", type: "string", maxLength: 500, optional: true },
            ],
          },
        },
      ],
    },
  ],
} satisfies MiniAppSpec;

/** A stand-in for `server/subapps/registry.ts`, trimmed to the parts the
 * patch anchors on. Deliberately NOT a copy of the real file: the patch
 * must work against a registry that has grown since, so the fixture has a
 * different set of sub-apps than any real one. */
export const registryFixture = `/** Code-declared sub-app catalog (APP-01/APP-07). */
import { subAppManifestSchema, type SubAppManifest } from "./types.js";
import { shellReferenceManifest } from "./shell-reference/manifest.js";
import { docusignManifest } from "./docusign/manifest.js";

export const HOST_VERSION = "5.0.0";

export const SUBAPP_MANIFESTS: SubAppManifest[] = [
  shellReferenceManifest,
  docusignManifest, // Ph28
];

export function getManifest(id: string): SubAppManifest | null {
  return SUBAPP_MANIFESTS.find((m) => m.id === id) ?? null;
}
`;

/** Fixture specs. Two of them, on purpose: the contract names a FLOOR
 * (`shell-reference`, two files) and a CEILING (`docusign`, a routes/ split
 * with its own schema), and a generator that only ever ran against one
 * shape would be a generator with an untested branch in it.
 *
 * `minimalSpec` has no tables at all — it must emit no `schema.ts` and a
 * manifest whose `initSchema` is a no-op.
 * `wcClockSpec` exercises every operation kind, every field type, an
 * optional column, a CHECK-constrained enum, an index, a settings panel and
 * both capability scopes. */
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

export const wcClockSpec = {
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
          summary: "Ask a reviewer to look at a folder",
          operation: {
            kind: "propose",
            proposalKind: "flag",
            ticketField: "ticket",
            auditEvent: "wc-clock.flag-proposed",
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

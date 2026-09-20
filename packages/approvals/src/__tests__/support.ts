/** Shared fixtures. Names are invented; no real person appears in a test. */
import { createMemoryGrantStore } from "../store";
import { createMemoryDirectory } from "../directory";
import type { ApprovalRecord } from "../approval";
import type { Actor, DirectoryEntry } from "../actor";
import type { DatasourceRef } from "../datasource";
import type { GrantRow } from "../grant";
import type { DataTier } from "../tiers";
import { toolContentHash } from "../identity";

export const TOOL = "wc-gap-report";
export const PROJECT = "rhineland";

/**
 * Two versions of the tool, as CONTENT. The hashes below are derived from them
 * rather than typed out, because the package derives them too — a fixture that
 * carried a literal hash would be testing a string, not a binding.
 */
export const TOOL_V1 = { id: TOOL, files: [{ path: "report.ts", text: "export const rows = 1;" }] };
export const TOOL_V2 = { id: TOOL, files: [{ path: "report.ts", text: "export const rows = 2;" }] };

export const HASH_V1 = toolContentHash(TOOL_V1);
export const HASH_V2 = toolContentHash(TOOL_V2);

export const AT = "2026-09-20T09:00:00Z";
/** Inside the decision TTL, for the freshness checks. */
export const SOON = "2026-09-20T09:00:02Z";
export const LATER = "2026-09-20T09:05:00Z";

/**
 * ⭐ TIERS ARE NOW DERIVED FROM DATA, so a test that wants a tier-4 question has
 * to hand over tier-4 data. These four payloads are what `packages/guardrails`
 * actually scores at 1, 2, 3 and 4 — not markers a fixture asserts.
 *
 *   1  nothing in any denylist
 *   2  BUSINESS_SEGMENTS (`contract`, `status`) and no person field
 *   3  PII_DENIED_SEGMENTS (`name`)
 *   4  PII_DENIED_SUBSTRINGS (`iban`, `salary`)
 */
export const PAYLOADS = {
  1: { headline: "Quarterly overview", count: 12 },
  2: { contract: { id: "C-4411", status: "open" } },
  3: { employee: { name: "Maren Keller" } },
  4: { employee: { name: "Maren Keller", iban: "DE89370400440532013000", salary_eur: 84000 } },
} as const satisfies Record<DataTier, unknown>;

export const payloadFor = (tier: DataTier): unknown => PAYLOADS[tier];

export const REQUESTER: Actor = { kind: "agent", id: "crew.contract-auditor" };
export const APPROVER: Actor = { kind: "human", id: "m.keller", displayName: "Maren Keller" };

/**
 * The identity directory the fixtures resolve against. This is the authority on
 * `kind` and `displayName`; what a row or a request SAYS about an actor is not
 * read by anything.
 */
export const DIRECTORY_ENTRIES: readonly DirectoryEntry[] = [
  { id: "crew.contract-auditor", kind: "agent", displayName: "Contract Auditor", active: true },
  { id: "m.keller", kind: "human", displayName: "Maren Keller", active: true },
  { id: "j.oduya", kind: "human", displayName: "Joseph Oduya", active: true },
  { id: "a.narrow", kind: "human", displayName: "Alma Narrow", active: true },
  { id: "b.wide", kind: "human", displayName: "Bo Wide", active: true },
  { id: "r.retired", kind: "human", displayName: "Rita Retired", active: false },
  /** A human with no name on file: an opaque subject id is not a NAMED human. */
  { id: "u_81f3", kind: "human", displayName: "", active: true },
  /** A service account. It may call itself whatever it likes on a row. */
  { id: "svc-ci-runner", kind: "system", displayName: "CI Runner (service)", active: true },
  { id: "system", kind: "system", displayName: "system", active: true },
  { id: "scheduler", kind: "system", displayName: "Scheduler", active: true },
  { id: TOOL, kind: "tool", displayName: "WC Gap Report", active: true },
];

export const directory = (extra: readonly DirectoryEntry[] = []) =>
  createMemoryDirectory([...DIRECTORY_ENTRIES, ...extra]);

export const ds = (kind: DatasourceRef["kind"], id: string, scope?: string): DatasourceRef => ({
  kind,
  id,
  scope,
});

/** `boot.json#connectors[0]` — one connector, four very different sub-scopes. */
export const SHAREPOINT = ds("connector", "microsoft-365", "SharePoint");
export const OUTLOOK = ds("connector", "microsoft-365", "Outlook");
export const M365 = ds("connector", "microsoft-365");
export const CONTRACTS_INPUT = ds("repo-path", "contracts", "input");
export const VAULT = ds("repo-path", "obsidian-vault");

export const row = (
  projectId: string,
  entries: readonly (readonly [DatasourceRef, DataTier])[],
  revokedAt?: string,
): GrantRow => ({
  projectId,
  toolId: TOOL,
  datasources: entries.map(([datasource, maxTier]) => ({ datasource, maxTier })),
  revokedAt: revokedAt ?? null,
});

export const ceiling = (entries: readonly (readonly [DatasourceRef, DataTier])[]): GrantRow =>
  row("*", entries);

export const approval = (over: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  toolId: TOOL,
  contentHash: HASH_V1,
  projectId: PROJECT,
  datasource: CONTRACTS_INPUT,
  tier: 4,
  approvedBy: APPROVER,
  approvedAt: AT,
  revokedAt: null,
  ...over,
});

export const store = (rows: readonly GrantRow[], approvals: readonly ApprovalRecord[] = []) =>
  createMemoryGrantStore({ rows, approvals });

/**
 * A question, built the way a real consumer must build one: by handing over the
 * tool CONTENT and the DATA. `tier` here selects a payload that guardrails
 * really scores at that tier — it is not passed through to the decision, because
 * there is nowhere for it to go.
 */
export const ask = (over: {
  datasource: DatasourceRef;
  tier: DataTier;
  projectId?: string;
  toolContent?: unknown;
  payload?: unknown;
  requestedBy?: Actor;
  at?: string;
}) => ({
  toolId: TOOL,
  toolContent: over.toolContent ?? TOOL_V1,
  projectId: over.projectId ?? PROJECT,
  datasource: over.datasource,
  payload: over.payload ?? payloadFor(over.tier),
  requestedBy: over.requestedBy ?? REQUESTER,
  directory: directory(),
  at: over.at ?? AT,
});

/** Shared fixtures. Names are invented; no real person appears in a test. */
import { createMemoryGrantStore } from "../store";
import type { ApprovalRecord } from "../approval";
import type { Actor } from "../actor";
import type { DatasourceRef } from "../datasource";
import type { GrantRow } from "../grant";
import type { DataTier } from "../tiers";
import { CEILING_PROJECT_ID } from "../identity";

export const TOOL = "wc-gap-report";
export const PROJECT = "rhineland";

/** Two content hashes: the tool as approved, and the tool after an edit. */
export const HASH_V1 = "sha256:0f2a1b3c4d5e6f708192a3b4c5d6e7f8";
export const HASH_V2 = "sha256:ffffeeeeddddccccbbbbaaaa99998888";

export const AT = "2026-09-20T09:00:00Z";

export const REQUESTER: Actor = { kind: "agent", id: "crew.contract-auditor" };
export const APPROVER: Actor = { kind: "human", id: "m.keller", displayName: "Maren Keller" };

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
  row(CEILING_PROJECT_ID, entries);

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

export const ask = (over: {
  datasource: DatasourceRef;
  tier: DataTier;
  projectId?: string;
  contentHash?: string;
  requestedBy?: Actor;
}) => ({
  toolId: TOOL,
  contentHash: over.contentHash ?? HASH_V1,
  projectId: over.projectId ?? PROJECT,
  datasource: over.datasource,
  tier: over.tier,
  requestedBy: over.requestedBy ?? REQUESTER,
  at: AT,
});

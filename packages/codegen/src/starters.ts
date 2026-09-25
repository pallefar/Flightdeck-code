/** The starter catalogue — how a person gets a sub-app WITHOUT a model call.
 *
 * Ruling 8: Studio generates from the approved catalogue and the spec, never
 * free-form code. The model path (`/api/studio/build`) needs a key and, for
 * the newer modes, an approved prompt text; until those exist a person must
 * still be able to type what they want and get a working app. This is that
 * path: a closed list of spec SHAPES, each built only from the operation
 * kinds `spec-contract.ts` allows and the proposal templates the owner
 * approved (`proposal-templates.ts`). The request text only CHOOSES a shape
 * and NAMES the app — it is never emitted, because a request can carry a
 * person's name and the generated source is committed.
 *
 * Pure (no node:*), so the browser workbench runs it; `pure.ts` re-exports it
 * and `pure-closure.test.ts` checks the closure stays pure. */
import { PROPOSAL_TEMPLATES, proposeOperation } from "./proposal-templates";
import { RESERVED_SUBAPP_IDS, type MiniAppSpec, type WorkspaceRole } from "./spec-contract";

export type StarterId = "contract-list" | "handoff-desk" | "records-log";

export interface Starter {
  readonly id: StarterId;
  /** Shown in the chat reply, so a person knows which shape was picked. */
  readonly title: string;
  readonly defaultLabel: string;
  readonly summary: string;
  /** Lower-case stems; any match scores one. */
  readonly keywords: readonly string[];
}

export const STARTERS: readonly Starter[] = Object.freeze([
  {
    id: "contract-list",
    title: "Read-only contract list (mini-app, database-free)",
    defaultLabel: "Contract List",
    summary: "The contract folders this workspace may read. Nothing is stored.",
    keywords: ["contract", "folder", "overview", "list", "show", "view", "dashboard"],
  },
  {
    id: "handoff-desk",
    title: "Hand-off desk: propose hand-offs and flag divergences for a person to approve (mini-app)",
    defaultLabel: "Hand-off Desk",
    summary: "Propose hand-offs and flag divergences on contract folders; a person approves each proposal in the inbox.",
    keywords: ["hand-off", "handoff", "propose", "proposal", "flag", "divergence", "approve", "approval", "escalat", "request"],
  },
  {
    id: "records-log",
    title: "Records log with its own table (table-backed: ships a schema.ts a human reviews)",
    defaultLabel: "Records Log",
    summary: "Log entries with a status, list them, and open one.",
    keywords: ["log", "track", "record", "register", "entries", "entry", "note", "journal", "capture"],
  },
]);

const byId = (id: StarterId): Starter => {
  const starter = STARTERS.find((s) => s.id === id);
  if (starter === undefined) throw new Error(`unknown starter ${id}`);
  return starter;
};

/** The starter a request scores highest on; ties go to catalogue order, and
 * no match at all is the read-only list — the least a generated app can do. */
export function pickStarter(prompt: string): Starter {
  const text = prompt.toLowerCase();
  let best: Starter = byId("contract-list");
  let bestScore = 0;
  for (const starter of STARTERS) {
    const score = starter.keywords.filter((k) => text.includes(k)).length;
    if (score > bestScore) {
      best = starter;
      bestScore = score;
    }
  }
  return best;
}

/** `called "X"`, `named X`, or a quoted name — at most four words. */
export function starterLabelFromPrompt(prompt: string): string | null {
  const quoted = /(?:called|named)?\s*["“']([^"”']{1,60})["”']/i.exec(prompt);
  const bare = /\b(?:called|named)\s+([A-Za-z0-9][A-Za-z0-9 -]{0,60})/i.exec(prompt);
  const raw = quoted?.[1] ?? bare?.[1];
  if (raw === undefined) return null;
  // A bare name runs until the first connective: "named Vendor Tracker that logs" → "Vendor Tracker".
  const words = raw.trim().split(/\s+/);
  const stop = words.findIndex((w) => /^(that|which|to|for|and|with|who)$/i.test(w));
  const kept = (stop >= 0 ? words.slice(0, stop) : words).slice(0, 4).join(" ").trim();
  return kept === "" ? null : kept;
}

function slugOf(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** Roles a request names, always with admin. The four workspace roles only. */
function rolesFor(prompt: string): WorkspaceRole[] {
  const text = prompt.toLowerCase();
  const roles: WorkspaceRole[] = [];
  if (/\bhr\b|preparer/.test(text)) roles.push("hr_preparer");
  if (/review/.test(text)) roles.push("hr_reviewer");
  if (/works council|\bwc\b/.test(text)) roles.push("wc_liaison");
  if (/legal/.test(text)) roles.push("legal");
  roles.push("admin");
  return roles;
}

export interface StarterOptions {
  readonly label: string;
  readonly visibleToRoles?: readonly WorkspaceRole[];
}

/** A spec for one starter, named. The id is the label's slug, moved off any
 * id the host already registers (D-04 locks an id once shipped). */
export function specFromStarter(id: StarterId, options: StarterOptions): MiniAppSpec {
  const starter = byId(id);
  let appId = slugOf(options.label);
  if (!/^[a-z0-9]/.test(appId)) appId = slugOf(starter.defaultLabel);
  if ((RESERVED_SUBAPP_IDS as readonly string[]).includes(appId)) appId = `${appId}-app`.slice(0, 40);
  const label = slugOf(options.label) === "" ? starter.defaultLabel : options.label.slice(0, 80);
  const visibleToRoles = [...(options.visibleToRoles ?? ["admin"])];
  const common = { id: appId, label, version: "0.1.0", visibleToRoles, summary: starter.summary } as const;

  switch (id) {
    case "contract-list":
      return {
        ...common,
        icon: "📂",
        navSection: "Contract pipeline",
        capabilities: ["read:contracts"],
        domains: [
          {
            name: "contracts",
            title: "Contract folders",
            routes: [{ method: "GET", path: "/contracts", summary: "Contract folders visible to this workspace", operation: { kind: "list-contracts" } }],
          },
        ],
      };
    case "handoff-desk": {
      const template = (tid: string) => {
        const t = PROPOSAL_TEMPLATES.find((p) => p.id === tid);
        if (t === undefined) throw new Error(`proposal template ${tid} is not in the catalogue`);
        return proposeOperation(t, appId);
      };
      return {
        ...common,
        icon: "🤝",
        navSection: "Contract pipeline",
        capabilities: ["read:contracts", "write:inbox-proposal"],
        domains: [
          {
            name: "folders",
            title: "Contract folders",
            routes: [{ method: "GET", path: "/contracts", summary: "Contract folders this app may read", operation: { kind: "list-contracts" } }],
          },
          {
            name: "ledger",
            title: "Filed proposals",
            routes: [{ method: "GET", path: "/proposals", summary: "Everything this app has already proposed", operation: { kind: "list-proposals" } }],
          },
          {
            name: "handoffs",
            title: "Hand-offs",
            routes: [
              { method: "POST", path: "/handoff", summary: "Propose the hand-off ping", operation: template("handoff") },
              { method: "POST", path: "/flag", summary: "Flag a divergence for review", operation: template("divergence") },
            ],
          },
        ],
      };
    }
    case "records-log":
      return {
        ...common,
        profile: "table-backed",
        icon: "🗒️",
        navSection: "Ops & insight",
        capabilities: [],
        tables: [
          {
            name: "entries",
            columns: [
              { name: "title", type: "text", notNull: true },
              { name: "status", type: "text", notNull: true, values: ["open", "in-progress", "done"] },
              { name: "note", type: "text" },
            ],
            indexes: [{ on: ["status"] }],
          },
        ],
        domains: [
          {
            name: "entries",
            title: "Entries",
            routes: [
              {
                method: "GET",
                path: "/entries",
                summary: "Entries, newest first",
                operation: { kind: "list-rows", table: "entries", orderBy: { column: "created_at", direction: "desc" }, limit: 200 },
              },
              {
                method: "GET",
                path: "/entries/:entryId",
                summary: "One entry",
                operation: { kind: "get-row", table: "entries", keyColumn: "id", param: "entryId" },
              },
              {
                method: "POST",
                path: "/entries",
                summary: "Log an entry",
                operation: {
                  kind: "insert-row",
                  table: "entries",
                  auditEvent: `${appId}.entry-logged`,
                  fields: [
                    { name: "title", type: "string", maxLength: 200 },
                    { name: "status", type: "enum", values: ["open", "in-progress", "done"] },
                    { name: "note", type: "string", maxLength: 2000, optional: true },
                  ],
                },
              },
            ],
          },
        ],
      };
  }
}

/** The whole non-LLM path: request → starter → named spec. */
export function specForPrompt(prompt: string): MiniAppSpec {
  const starter = pickStarter(prompt);
  const label = starterLabelFromPrompt(prompt) ?? starter.defaultLabel;
  return specFromStarter(starter.id, { label, visibleToRoles: rolesFor(prompt) });
}

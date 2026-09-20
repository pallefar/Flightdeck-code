/** The gate's output language.
 *
 * ⭐ WHY FINDINGS AND NOT EXCEPTIONS. Studio shows a human a screen that
 * says "this app is safe to add" or "here is what is wrong with it". An
 * exception carries one message and stops at the first problem; a
 * generated sub-app with four problems would then take four round trips
 * through a language model to fix. So every check returns a list, the gate
 * concatenates them, and `assertShippable` is the thin wrapper for callers
 * that only want the refusal.
 *
 * Every finding carries a FILE and a LINE because the consumer is either a
 * person reading a diff or a model being asked to repair its own output.
 * "capability escape somewhere in your app" is not actionable;
 * `routes/entries.ts:14` is.
 *
 * Rule ids are stable strings, not enum positions: they go in test names,
 * in Studio's UI and eventually in somebody's suppression list, so
 * renumbering them later is a breaking change. */

export type Severity = "error" | "warning";

export interface RuleSpec {
  /** `error` refuses the write. `warning` is written into the review
   * screen and does not block — reserved for things that produce a wrong
   * output rather than a host that will not boot. */
  readonly severity: Severity;
  readonly title: string;
  /** The clause of `docs/FLIGHTDECK-SUBAPP-CONTRACT.md` this enforces. */
  readonly contract: string;
}

/** The whole catalog, in one object, so `RULE_IDS` and the `RuleId` union
 * cannot drift from the rules the checks actually raise. */
const CATALOG = {
  // ── The manifest: would `loadValidatedManifests` accept this file? ──
  "FD-M001": { severity: "error", title: "manifest file present", contract: "§1" },
  "FD-M002": { severity: "error", title: "manifest data fields are literals", contract: "§2" },
  "FD-M003": { severity: "error", title: "manifest satisfies subAppManifestSchema", contract: "§2" },
  "FD-M004": { severity: "error", title: "minHostVersion within the host ceiling", contract: "§2" },
  "FD-M005": { severity: "error", title: "id-derived fields equal their derivation", contract: "§3" },
  "FD-M006": { severity: "error", title: "manifest carries initSchema and registerRoutes", contract: "§2" },
  "FD-M007": { severity: "error", title: "directory name equals the manifest id", contract: "§3" },

  // ── The import closure: what does mounting this drag in? ────────────
  "FD-I001": { severity: "error", title: "no sibling sub-app in the import closure", contract: "§5.4" },
  "FD-I002": { severity: "error", title: "no registry.ts or installRoutes.ts import", contract: "§5.4" },
  "FD-I003": { severity: "error", title: "every internal import resolves", contract: "§1" },
  "FD-I004": { severity: "error", title: "no import across the server/web tier line", contract: "§3" },
  "FD-I005": { severity: "warning", title: "every file is reachable from a mount root", contract: "§1" },

  // ── Capability escape: what can this code reach at runtime? ─────────
  "FD-C001": { severity: "error", title: "no node builtin in a mounted module", contract: "§5.3" },
  "FD-C002": { severity: "error", title: "no database driver import", contract: "§5.3" },
  "FD-C003": { severity: "error", title: "no host module outside the leaf allowlist", contract: "§5.3" },
  "FD-C004": { severity: "error", title: "routes audit only through the capability adapter", contract: "§5.5" },
  "FD-C005": { severity: "error", title: "no package the host does not already carry", contract: "§1" },

  // ── Guard first: does every handler check enable-state? ─────────────
  "FD-G001": { severity: "error", title: "every handler calls the enable guard", contract: "§5.1" },
  "FD-G002": { severity: "error", title: "the guard call comes before any work", contract: "§5.1" },
  "FD-G003": { severity: "error", title: "every route registration is verifiable", contract: "§5.1" },
  "FD-G004": { severity: "error", title: "the guard is imported, not assumed", contract: "§5.1" },

  // ── Never cache a boolean. ──────────────────────────────────────────
  "FD-B001": { severity: "error", title: "no module-level environment read", contract: "§5.2" },
  "FD-B002": { severity: "error", title: "no module-level enable-state constant", contract: "§5.2" },
  "FD-B003": { severity: "warning", title: "enable-state is read through the host leaves", contract: "§4" },

  // ── Tables are namespaced by id. ────────────────────────────────────
  "FD-S001": { severity: "error", title: "DDL stays under the sub-app table prefix", contract: "§3" },
  "FD-S002": { severity: "error", title: "queries stay under the sub-app table prefix", contract: "§3" },
  "FD-S003": { severity: "error", title: "index names stay under the sub-app prefix", contract: "§3" },
  "FD-S004": { severity: "error", title: "no table name the gate cannot read", contract: "§3" },

  // ── Would it actually mount? ────────────────────────────────────────
  "FD-X001": { severity: "warning", title: "the registry edit ships with the app", contract: "§7" },
  "FD-X002": { severity: "error", title: "the web module the manifest names exists", contract: "§3" },
  "FD-X003": { severity: "error", title: "the web module default-exports a Page", contract: "§3" },
  "FD-X004": { severity: "error", title: "declared tables are wired into initSchema", contract: "§2" },
  "FD-X005": { severity: "warning", title: "shipped i18n is wired into the host", contract: "§7, §8" },

  // ── The gate's own honesty. ─────────────────────────────────────────
  // A check that crashes has not passed the app. It fails closed, under
  // its own rule id, so "the gate said yes" never means "the gate threw".
  "FD-Z001": { severity: "error", title: "every check completed", contract: "—" },
} as const satisfies Record<string, RuleSpec>;

export type RuleId = keyof typeof CATALOG;

export const RULES: Readonly<Record<RuleId, RuleSpec>> = CATALOG;

/** Every rule the gate knows, in catalog order. The gate reports this so a
 * caller can tell "nothing was wrong" from "that check never ran". */
export const RULE_IDS: readonly RuleId[] = Object.keys(CATALOG) as RuleId[];

export interface Position {
  /** 1-based. `0` means the finding is about the file set, not a line. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
}

export const NO_POSITION: Position = { line: 0, column: 0 };

export interface Finding {
  readonly rule: RuleId;
  readonly severity: Severity;
  /** Repo-relative path in the HOST repo, or `(candidate)` when the
   * finding is about the set of files rather than one of them. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
  /** One sentence, addressed to whoever has to fix it. Names the thing it
   * found and the rule it broke — never "invalid input". */
  readonly message: string;
  /** The offending source line, trimmed. `null` when there is no line. */
  readonly evidence: string | null;
}

export const CANDIDATE_SCOPE = "(candidate)";

export function finding(
  rule: RuleId,
  file: string,
  at: Position,
  message: string,
  evidence?: string,
): Finding {
  const spec = RULES[rule];
  return {
    rule,
    severity: spec.severity,
    file,
    line: at.line,
    column: at.column,
    message,
    evidence: evidence === undefined ? null : evidence.trim(),
  };
}

/** File, then line, then rule id — the order a reviewer walks a diff in.
 * Deterministic for a given candidate, which is what makes the gate's
 * output diffable between runs. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.column !== b.column) return a.column - b.column;
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

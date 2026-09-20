/**
 * THE HOST'S FILE, NOT A PARALLEL ONE.
 *
 * `/home/user/project-contract/subapps.json` is the shape this module writes:
 *
 *     { "schema": "subapp-registry/1", "installs": [...], "_history": [...] }
 *
 * and `flightdeck/server/subapps/installRoutes.ts` is the code that reads and
 * rewrites it. Studio does not get to invent a second registry format — "the
 * whole point is that an approved tool becomes enableable in any tenant through
 * the machinery that already exists", and a second format is a second
 * machinery.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE PLACE A SCRIPT AND A MINI-APP PART COMPANY
 * ─────────────────────────────────────────────────────────────────────────
 * Both kinds run the identical lifecycle in `ledger.ts`. Only mini-apps are
 * projected here, because both host routes start with
 *
 *     const manifest = getManifest(id);
 *     if (!manifest) return reply.code(404).send({ error: "unknown sub-app" });
 *
 * so a script id in `installs` would be a row the host can never resolve,
 * enable or disable — a permanently 404-ing entry in a file an operator reads
 * to find out what is installed. Scripts stay in the Studio ledger, which is
 * where their approvals and their history live and where `reuseDecision`
 * answers for them. A test holds this line.
 *
 * ⛔ NOTHING HERE WRITES A FILE. `fs` does not appear in this package: a
 * sub-app route reaches the world only through the injected capability adapter
 * (contract §5 rule 3), and the host's own write is an atomic
 * read-current → build-next → tmp+rename inside ONE synchronous handler
 * ("Pitfall 4 — no durability gap"). Reproducing half of that from a second
 * process is how two writers lose each other's rows. This module produces the
 * VALUE; the host performs the write.
 */

import { z } from "zod";

import { toHostHistoryRow, type HistoryEntry, type HostHistoryRow } from "./audit";
import { isHostInstallable } from "./artifact";
import { CEILING_PROJECT_ID } from "./identity";
import { currentRegistered, type Ledger } from "./ledger";

/** Host: `SUBAPP_REGISTRY_REL`, relative to the workspace root. */
export const SUBAPP_REGISTRY_REL = "subapps.json";
/** Host: the literal `writeSubAppRegistryEntry` stamps on every write. */
export const SUBAPP_REGISTRY_SCHEMA = "subapp-registry/1";

/* ── the host's schema, mirrored ────────────────────────────────────────── */

/**
 * A byte-for-byte mirror of `installRoutes.ts`'s `subAppFileEntrySchema`,
 * INCLUDING its leniency: `grantedScopes` is `z.array(z.string())` there, not
 * an enum, because the reader adopts the file as it is. Copying the leniency is
 * the point — a mirror that were stricter than the original would refuse files
 * the host happily reads, and then Studio's idea of "valid" would be the one
 * that is wrong.
 */
export const hostInstallEntrySchema = z.object({
  id: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  installedAt: z.string(),
  installedBy: z.string(),
  grantedScopes: z.array(z.string()),
});

/** Mirror of `subAppRegistryFileSchema`. All three keys optional, as there. */
export const hostRegistryFileSchema = z.object({
  schema: z.string().optional(),
  installs: z.array(hostInstallEntrySchema).optional(),
  _history: z.array(z.unknown()).optional(),
});

/**
 * What Studio additionally guarantees about what IT emits. Not a claim about
 * what the host accepts — that is `hostRegistryFileSchema` above, and the two
 * are kept apart so a reader can see which rule belongs to whom.
 *
 * `.strict()` on the entry: an unknown key in a row we wrote would be a silent
 * widening of a file the host round-trips (contract §5 rule 6).
 */
export const emittedRegistryFileSchema = z.object({
  schema: z.literal(SUBAPP_REGISTRY_SCHEMA),
  installs: z.array(
    hostInstallEntrySchema.extend({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      grantedScopes: z.array(z.enum(["read:contracts", "write:inbox-proposal"])),
    }).strict(),
  ),
  _history: z.array(z.unknown()),
});

/**
 * The row as this package hands it out: structurally
 * `z.infer<typeof hostInstallEntrySchema>`, but written by hand so the arrays
 * are `readonly`. A schema-inferred type would hand callers a mutable
 * `string[]` into a frozen object, which is a lie the type checker would help
 * them tell.
 */
export interface HostInstallEntry {
  readonly id: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly installedAt: string;
  readonly installedBy: string;
  readonly grantedScopes: readonly string[];
}

export interface SubAppRegistryFile {
  readonly schema: string;
  readonly installs: readonly HostInstallEntry[];
  readonly _history: readonly unknown[];
}

/* ── reading an existing file ───────────────────────────────────────────── */

/**
 * Read-fresh, NEVER THROWS — mirroring `readSubAppRegistryFile`'s own comment:
 * "the fail-loud posture of this phase applies to MANIFEST validation, not to
 * reading this per-workspace change log". A malformed or absent file degrades
 * to empty rather than taking a caller down, which is what lets a first write
 * against a missing file behave exactly like the host's.
 */
export function readHostRegistryFile(raw: unknown): {
  installs: readonly HostInstallEntry[];
  history: readonly unknown[];
} {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { installs: [], history: [] };
    }
  }
  const parsed = hostRegistryFileSchema.safeParse(value);
  if (!parsed.success) return { installs: [], history: [] };
  return { installs: parsed.data.installs ?? [], history: parsed.data._history ?? [] };
}

/* ── projecting the ledger ──────────────────────────────────────────────── */

/**
 * The ceiling rows, as `installs[]`.
 *
 * `installs[].enabled` IS the Function ceiling — the host's `'*'` row — and
 * per-project rows deliberately do not appear: `subapps.json` is "the
 * FUNCTION's install ledger, not a project's" (`installRoutes.ts`, the
 * per-project disable branch). Project consent lives in `subapp_installs` and,
 * on the Studio side, in `Ledger.enablements`.
 *
 * A row survives a disable and a retirement, carrying `enabled: false`. The
 * host never deletes one either: the row is the record that this Function once
 * consented, and deleting it would make "never enabled" and "turned off"
 * indistinguishable — the exact distinction the host added `projectConsented`
 * to the wire to preserve.
 */
export function toInstallEntries(ledger: Ledger): readonly HostInstallEntry[] {
  const rows = ledger.enablements
    .filter((r) => r.projectId === CEILING_PROJECT_ID)
    .filter((r) => {
      const entry =
        currentRegistered(ledger, r.artifactId) ??
        ledger.entries.find((e) => e.artifactId === r.artifactId) ??
        null;
      return entry !== null && isHostInstallable(entry.kind);
    });
  return Object.freeze(
    [...rows]
      // Deterministic, and in the host's own order: it writes
      // `[...others, entry]`, so the most recently written row is last.
      .sort((a, b) =>
        a.installedAt === b.installedAt
          ? a.artifactId < b.artifactId
            ? -1
            : a.artifactId > b.artifactId
              ? 1
              : 0
          : a.installedAt < b.installedAt
            ? -1
            : 1,
      )
      .map((r) =>
        Object.freeze({
          id: r.artifactId,
          version: r.version,
          enabled: r.enabled,
          installedAt: r.installedAt,
          installedBy: r.installedBy,
          grantedScopes: Object.freeze([...r.grantedScopes]) as readonly string[],
        }),
      ),
  );
}

/** History rows for host-installable artifacts only, in ledger order. */
export function toHostHistoryRows(history: readonly HistoryEntry[]): readonly HostHistoryRow[] {
  return Object.freeze(history.filter((h) => isHostInstallable(h.kind)).map(toHostHistoryRow));
}

/**
 * A whole file from a whole ledger — the bootstrap projection, for a workspace
 * whose `subapps.json` does not exist yet. For an existing file use
 * `applyEventsToHostRegistry`, which is the incremental, host-shaped write.
 */
export function toSubAppRegistryFile(ledger: Ledger): SubAppRegistryFile {
  return Object.freeze({
    schema: SUBAPP_REGISTRY_SCHEMA,
    installs: toInstallEntries(ledger),
    _history: toHostHistoryRows(ledger.history),
  });
}

/**
 * ONE TRANSITION, ONE WRITE — the shape `writeSubAppRegistryEntry` has:
 *
 *     read current -> build next with ADDITIVE _history -> write tmp, rename
 *
 * This is the second and third steps as a pure function; the caller does the
 * first and the fourth. `installs` is replace-by-id (never appended twice for
 * one artifact), `_history` is append-only and keeps every row already in the
 * file — including rows the host itself wrote and rows from Studio events this
 * ledger no longer remembers.
 *
 * ⚠ PASS THE EVENTS OF ONE COMMIT, not the whole ledger history. A `LedgerResult`
 * hands back exactly that list (`result.events`). Passing everything each time
 * would re-append rows the file already has, which is how a change log grows a
 * second copy of its own past.
 */
export function applyEventsToHostRegistry(
  existing: unknown,
  ledger: Ledger,
  events: readonly HistoryEntry[],
): SubAppRegistryFile {
  const current = readHostRegistryFile(existing);
  const touched = new Set(events.filter((e) => isHostInstallable(e.kind)).map((e) => e.subAppId));

  // Only rows the LEDGER can currently speak for are replaced. An artifact the
  // events name but the ledger has no ceiling row for — a proposal, say —
  // leaves whatever the file already had alone, rather than dropping it: this
  // function narrows a file, it never prunes one.
  const rebuilt = new Map(
    toInstallEntries(ledger)
      .filter((row) => touched.has(row.id))
      .map((row) => [row.id, row] as const),
  );
  const kept = current.installs.filter((row) => !rebuilt.has(row.id));

  return Object.freeze({
    schema: SUBAPP_REGISTRY_SCHEMA,
    installs: Object.freeze([...kept, ...rebuilt.values()]),
    _history: Object.freeze([...current.history, ...toHostHistoryRows(events)]),
  });
}

/**
 * The exact bytes the host writes: `JSON.stringify(nextFile, null, 2)`, no
 * trailing newline (`installRoutes.ts#writeSubAppRegistryEntry`). Provided so a
 * caller does not have to know that, and so a diff against a host-written file
 * is a diff about content rather than about formatting.
 */
export function serializeSubAppRegistryFile(file: SubAppRegistryFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Does this value satisfy the host's own reader? Returns the parse result
 * rather than a boolean so a caller can report WHICH key is wrong.
 */
export function validateAgainstHostSchema(value: unknown): z.SafeParseReturnType<unknown, unknown> {
  return hostRegistryFileSchema.safeParse(value);
}

/** What the preview reproduces, what it fabricates, and what it cannot
 * touch at all — as data, rendered in the pane beside the frame.
 *
 * ⭐ WHY THIS IS A FIRST-CLASS SCREEN AND NOT A FOOTNOTE. A preview is a
 * claim: "this is what your app will do". For a sub-app compiled into
 * somebody else's Fastify host, most of that claim is false, and the parts
 * that are false are not obvious by looking. The rows in the table are
 * invented. The SQL never ran. The host's stylesheet is not here. A
 * reviewer who does not know that will read a green preview as evidence
 * the app works, approve it, and find out at boot.
 *
 * So the ledger is not a disclaimer. It is the index of which parts of the
 * screen are evidence and which are scenery, and it sits beside the frame
 * rather than behind a tooltip. Every `absent` row below is a question the
 * preview CANNOT answer, named so somebody goes and answers it elsewhere. */

export type Fidelity = "real" | "mocked" | "absent";

export interface LedgerRow {
  readonly aspect: string;
  readonly fidelity: Fidelity;
  /** What is actually happening, in one sentence. Written to be read by
   * somebody deciding whether to trust what they just saw. */
  readonly note: string;
}

export interface LedgerInput {
  /** False when `scanScopes` found no route registrations to read, so
   * capability gating is not being enforced in the preview at all. That
   * downgrades a `real` row to `absent`, and the pane says so. */
  readonly scopesScanned: boolean;
  readonly hasCapabilities: boolean;
}

export function buildLedger(input: LedgerInput): readonly LedgerRow[] {
  return [
    {
      aspect: "Page structure",
      fidelity: "real",
      note: "Panels, forms and fields are parsed out of the generated index.tsx — not re-derived from the spec, so a codegen bug shows up here.",
    },
    {
      aspect: "Request paths",
      fidelity: "real",
      note: "Every call goes to the route prefix and sub-path the generated page itself carries.",
    },
    {
      aspect: "Body validation",
      fidelity: "real",
      note: "A real Zod schema, rebuilt from the same field descriptors and .strict() like the emitted route. The 400s you see are genuine Zod issues.",
    },
    {
      aspect: "Enable-state (§4)",
      fidelity: "real",
      note: "All three layers, ANDed and re-read on every request — never cached, exactly as §5.2 requires of the generated guard.",
    },
    {
      aspect: "Capability gating (§9)",
      fidelity: input.scopesScanned ? "real" : "absent",
      note: input.scopesScanned
        ? "Each route's required scope was read from the emitted server source, not guessed from the HTTP method."
        : "No route registrations could be read from the emitted server source, so no capability is being enforced in this preview. Treat every route here as unguarded.",
    },
    {
      aspect: "Refusal routing",
      fidelity: "real",
      note: "Routed on HTTP status and the body's code, on the same branches as the generated runtime — which is fingerprinted, so this claim breaks loudly if the emitter changes.",
    },
    {
      aspect: "Row data",
      fidelity: "mocked",
      note: "Fabricated, seeded from the sub-app id so it is identical every time you open it. Column names are real; every cell is invented.",
    },
    {
      aspect: "Success bodies",
      fidelity: "mocked",
      note: "Only refusals are modelled exactly. A 200's shape is a reasonable guess and should not be relied on.",
    },
    {
      aspect: "Audit trail (§5.5, §8)",
      fidelity: "mocked",
      note: "Events are recorded in memory with field names only. No hash is constructed — the sub-app may never construct one — and nothing reaches a real audit log.",
    },
    {
      aspect: "Proposals (§7)",
      fidelity: input.hasCapabilities ? "mocked" : "absent",
      note: input.hasCapabilities
        ? "A write capability produces a memory/proposals/ path and a field list. No file is written and nothing is advanced or resolved."
        : "This sub-app declares no capabilities, so it proposes nothing.",
    },
    {
      aspect: "SQL and initSchema",
      fidelity: "absent",
      note: "No statement is executed and no table is created. A clean preview is not evidence the DDL or the queries are correct.",
    },
    {
      aspect: "Host shell",
      fidelity: "absent",
      note: "No nav, no role-based access, no i18n, and not the host's theme.css. The frame carries the host's class names; the host's stylesheet is not in Studio.",
    },
    {
      aspect: "Fastify lifecycle",
      fidelity: "absent",
      note: "No hooks, no serializers, no host error mapper. Route registration order and reply serialization are untested here.",
    },
  ];
}

export function countBy(rows: readonly LedgerRow[], fidelity: Fidelity): number {
  return rows.filter((row) => row.fidelity === fidelity).length;
}

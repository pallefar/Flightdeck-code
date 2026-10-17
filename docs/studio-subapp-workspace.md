# Private sub-app draft-source workspaces

This slice persists authoring **data**, not a deployed sub-app. `registerSubappWorkspaceRoutes` is an explicit standalone registration seam; this module does not mount itself in the server composition root or change the Workbench UI. There are no model/provider calls, shell commands, source evaluation, generated-file application, host writes, runs, approvals, activation or deployment operations.

## Shared DTO

`packages/subapp-workspace/schema.ts` imports only Zod and uses browser-native `TextEncoder`; it has no Node/filesystem imports.

- `SubappSnapshot` / `snapshotSchema`: `{ baseline, files }`. `baseline` has exactly the Workbench `Candidate` fields: `manifest`, `files`, `findings`, `rulesRun`, `notes`. `files` contains the independently editable working source.
- `SubappDocument` / `documentSchema`: `{ id, projectId, revision, status: 'draft', snapshot, contentHash, createdBy, updatedBy, createdAt, updatedAt }`.
- `SubappSummary` / `summarySchema`: document metadata without `snapshot`, plus `{ label, subappId, fileCount }`. Labels/IDs come from the baseline manifest. Lists do not return source, findings or notes; their metadata is still private.
- `contentHash` is the server-computed lowercase SHA-256 hex digest of UTF-8 `JSON.stringify(document.snapshot)` after DTO admission. It is **ordered DTO JSON**, not recursively sorted JSON. Array order and exact source strings matter. The schemas put known object fields into their declared DTO order. Browser consumers must verify the digest over the received snapshot before using a confirmation; the pure synchronous document schema validates the digest's format, not its cryptographic binding.

Every DTO property is required. Own `undefined` properties are **not** optional JSON and are rejected, including unknown keys with `undefined`. Use `null` only where the contract explicitly permits it (`manifest.summary`, finding `evidence`). There is no whitespace trimming or line-ending normalization of source strings.

The baseline is immutable for the lifetime of an existing document. Changing generated source, findings, rules, notes or manifest metadata requires a new draft, not an update. Working files must have the same unique exact path/kind inventory as the baseline; their order may change. An update does not rerun a check, make edited source verified, or convert historical findings into findings about the working source. Baseline metadata supplied on creation is stored context, **not attested generation provenance or any permission grant**.

Paths are inert artifact labels. They must be canonical relative slash-separated paths beneath `server/`, `web/src/`, `tests/` or `standalone/`, with ASCII alphanumeric/underscore-leading segments and subsequent alphanumeric, dot, underscore or hyphen characters. Absolute paths, empty/dot/parent segments, backslashes, URI escapes and drive syntax are rejected rather than normalized. A stored path is never resolved against a filesystem root.

## Native JSON admission and bounds

Before recursive Zod parsing, the shared admission function walks own property descriptors iteratively. It refuses cycles, symbols, accessors, hidden properties, sparse/decorated arrays, exotic prototypes, dangerous prototype keys, nonfinite numbers, functions, bigint and `undefined`. It does not invoke getters or `toJSON`. Ordinary and null-prototype JSON objects are accepted; proxies are outside the native-object contract and reflective exceptions fail closed. All schema errors collapse to a fixed message rather than returning caller-controlled keys or source fragments.

Limits are decimal byte counts, not KiB/MiB:

| Boundary | Ceiling |
| --- | --- |
| Documents in one store, across all projects | 64 |
| Files in each baseline/working inventory | 100, at least 1 |
| UTF-8 contents of each source file | 200,000 bytes |
| Entire JSON snapshot, baseline and working source together | 2,000,000 bytes |
| Entire serialized store | 32,000,000 bytes |
| Path | 240 characters |
| Manifest/text/finding field | 2,000 characters |
| Findings, rules and notes | 1,000 entries each |
| Capabilities and visible roles | 100 entries each |
| Actor | 1–200 characters, no surrounding whitespace or ASCII controls |
| Native JSON traversal | Depth 24; 500,000 values; 10,000 array entries/object properties per container |
| Native HTTP body | 2,001,024 bytes |
| Document / summary admission | snapshot ceiling + 8,000 / 32,000 bytes |

These limits combine: maximum per-field counts need not fit simultaneously within snapshot/store byte ceilings. Source can legitimately contain words such as `token` or `key`; there is no unreliable keyword-based secret scrubber or secret-free-content assurance. Authentication credentials and authority fields are not snapshot properties. Authors must not paste credentials into source; source is private persisted plaintext, not a credential vault.

## File store

```ts
const store = createFileSubappWorkspaceStore(trustedAbsoluteFilePath);
await store.create(projectId, snapshot, trustedActor);
await store.list(projectId); // SubappSummary[]
await store.get(projectId, draftId); // SubappDocument | undefined
await store.update(projectId, draftId, snapshot, expectedRevision, trustedActor);
```

The constructor validates a literal canonical absolute configured path and performs no filesystem IO. Reads of an absent target return an empty store without creating directories. Invalid native arguments are rejected before directory creation.

The format is strict `{ version: 1, drafts: SubappDocument[] }`. Each operation validates every existing record, unique document IDs and internally recomputed content hashes; a corrupt record in another project is not silently dropped. IDs are server UUIDs. Creation begins at revision 1. Update checks exact project/UUID, revision and immutable baseline under the cross-process lock; preserves the creator/creation timestamp and every other record; then increments the revision. A stale revision, exhausted safe integer or changed baseline is an explicit 409. There is no last-write-wins path.

Existing ancestors must be nonsymlink directories; the immediate store parent must be process-owned **0700**, and an existing target must be a process-owned regular **0600** file with exactly one link. Unexpected ownership, modes, types, symlinks, hardlinks and metadata errors fail closed; existing state is never chmodded or repaired. Newly created directories are 0700. Every writer independently fsyncs the containing directory of each process-owned 0700 ancestor, including already-existing entries: existence or EEXIST does not establish that another creator completed its durability barrier. This also covers an explicitly retried operation after a failed barrier; no automatic mutation retry is added. Pre-existing nonprivate ancestors are trusted startup infrastructure. Parent ancestry must remain immutable against concurrent same-user replacement; this path-based implementation does not claim a race-proof sandbox against a malicious same-UID process, ACL administrator, privileged process, network filesystem or rollback attacker.

Writers reuse `server/workflow-approval-lock.ts`'s exclusive cross-process directory lock at `<store>.lock`. Its bounded acquisition wait can return 409. Crashed locks are never reclaimed automatically. Operators must investigate a stale lock rather than treating removal as restore or retry authorization.

Reads use no-follow/nonblocking open, bounded chunked reads, fatal UTF-8 decoding, descriptor metadata comparisons and exact final target identity checks. Writes validate the complete next store, create an exclusive random 0600 no-follow sibling temp, fsync and close it, recheck parent/target, atomically rename, fsync the parent, and perform an actual bounded **byte-for-byte** readback plus complete schema/hash validation before acknowledging. Cleanup attempts to unlink only the writer's own temp even when closing its descriptor rejects; failure remains unavailable, not confirmed persistence. This does not promise successful cleanup if the OS also refuses unlink or secure erasure of plaintext. There is no overwrite after corruption, automatic restore, mutation retry or source materialization.

A failure after rename/fsync/readback may mean a commit occurred without confirmation. Read the exact draft/history and reconcile before explicitly retrying; do not blindly retry creation. Absence on an ordinary future read is empty initial state, not rollback/deletion detection. Hashes provide consistency checks, not authenticated provenance or nonrollbackable freshness. Atomic-file durability assumes the local filesystem honors native rename/fsync semantics.

## Standalone HTTP routes

```ts
registerSubappWorkspaceRoutes(app, {
  actor: trustedActor,
  authenticate: authorization => operatorPredicate(authorization),
  store,
});
```

`actor` and the synchronous deny-default authentication predicate are trusted injection, not browser fields. This is private local operator authentication plus exact project partitioning, **not host session verification, project membership or host authorization**. Host identity/namespace integration is separate work.

| Method | Path below `/api/studio/workspaces/:projectId/subapps` | Request | Response |
| --- | --- | --- | --- |
| GET | collection | no body, no query | `200 { drafts: SubappSummary[] }` |
| POST | collection | strict `{ snapshot }` | `201 { draft: SubappDocument }` |
| GET | `/:draftId` | no body, no query | `200 { draft }` |
| PUT | `/:draftId` | strict `{ snapshot, expectedRevision }` | `200 { draft }` |

Project IDs are exact lowercase slug strings of at most 64 characters; draft IDs are UUIDs. All query keys are refused. Fastify owns its shallow router-param objects (which have a custom prototype); those are validated by strict scalar schemas, not admitted as arbitrary snapshot objects. Native JSON bodies still receive descriptor-first preflight. Fastify's automatic HEAD behavior inherits the authenticated GET registration.

Authentication runs in `onRequest`, before JSON parsing, body-size errors, parameter/query validation or any store access. Registered-route responses, including native parser failures and authentication refusals, are `Cache-Control: no-store`; route logging is silent. An upstream app hook/logger is outside this module and must not log private payloads or credentials. Unknown routes are the surrounding Fastify app's policy, not these handlers.

Errors are fixed bounded DTOs, never filesystem paths, schema details, source fragments or raw exceptions:

- 400: malformed request/native DTO/identity/query.
- 401: authentication required (including predicate exceptions).
- 404: not found in the exact requested project.
- 409: revision, immutable-baseline or lock conflict.
- 413: native body limit or store/document capacity exceeded.
- 503: unavailable, unsafe/corrupt state or unconfirmed persistence.

Per-file/snapshot schema bound violations within the native body limit are malformed 400; native request/store capacity overflow is 413. There is no create/read/update/delete authorization interpretation in baseline capabilities or roles, and no delete, run, apply, approval, activation or deployment endpoint here.

## Verification

From the Studio checkout, using the designated scratch directory:

```sh
TMPDIR=/Users/te451223/.hermes/cache/scratch node_modules/.bin/vitest run \
  packages/subapp-workspace/schema.test.ts \
  server/__tests__/subapp-workspace-store.test.ts \
  server/__tests__/subapp-workspace.test.ts \
  server/__tests__/subapp-workspace-process.test.ts \
  server/__tests__/subapp-workspace-faults.test.ts --maxWorkers=1
node_modules/.bin/tsc --noEmit -p packages/subapp-workspace/tsconfig.json
```

Fixtures exercise real private filesystem creation/reconstruction, exact bytes/digests, project isolation, CAS, immutable baselines, two independent OS writers, quotas/corruption/link/mode refusals, bounded read drift, fsync/readback failure and uncertain commits. Fault tests wrap real native filesystem operations at explicit failure points; they do not fabricate store results. HTTP tests use both actual loopback Fetch and Fastify injection, including auth-before-malformed/oversize precedence and real generator/scaffold output. Manual incomplete source is persisted without executing or re-verifying it; artifact trees remain absent.

The initial delivery verification completed with **32 passing assertion records across 5 physical test files**, no failed/skipped cases, and a clean scoped TypeScript check (exit 0). Those historical green tests did not establish the ancestor concurrency barrier: independent review subsequently reproduced F1 durability, F2 GET/HEAD body handling and F3 cleanup defects. Current remediation evidence is separate below. Totals are parsed from actual JSON reports, not summed across repeated RED/GREEN runs. One intermediate test harness exhausted its worker heap while a deep matcher enumerated a 32 MB Buffer; native `Buffer.equals` fixed that fixture comparison without increasing heap limits or changing production bounds.

RED/GREEN logs and inert exact-byte source snapshots with SHA-256 hashes are retained under `/Users/te451223/.hermes/cache/scratch/subapp-workspace-evidence/`. The evidence does not attest a host installation, UI acceptance, provider completion, deployment, production identity, ACL audit or power-loss recovery.

### Independent review and remediation checkpoint

The original read-only independent report and all 42 hash-verified artifacts are preserved under `docs/evidence/authoring-integration/workspace-independent-review/`; its manifest is archived separately and unchanged. F1 and F3 have test-first source fixes, and the helper's non-blocking 10,001-object-property mismatch N1 is fixed while retaining the 10,000-element array positive control. F2 request framing is a separate in-progress source task and is not accepted here.

The parent replayed the original independent two-process race and six native fault probes against F1/F3 fixes, changing only evidence-output/child paths. The race now shows writer B completing its own ancestor barrier while writer A remains blocked; A's subsequent SIGKILL and exact revision-1 readback are observed. All six fault cases pass, including the missing ancestor-fsync retry and partial-write/close-EIO cleanup. This is parent reproduction, not independent re-review or simulated power-loss/data-loss testing. Replay evidence and exact inert probe snapshots are in `docs/evidence/authoring-integration/workspace-store-native-replay/`.

These changes remain source-only. A fresh independent fix review, final combined suite, body-framing closure, immutable runtime/candidate checks and any authorized private update are separate gates. No live volume, service, operator credential or model provider was changed.

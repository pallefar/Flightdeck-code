# Offline workflow backup integrity and conservative recovery

## Status and non-goals

This is a **staged offline integrity verifier**, not a live backup service, restore engine, production rollback fence, or recovery approval. G03 (consistent production restore/anti-rollback integration) and G08 (audited stale-lock recovery) remain open. Every successful verification explicitly returns `restore: "blocked"`. No extraction, startup, resume, decision, key regeneration, lock deletion, effect retry, or network upload is implemented.

`server/workflow-backup.ts` creates a bounded in-memory archive from an explicitly trusted, immutable, stopped state tree. `scripts/workflow-backup-verify.ts` reads an archive and a separately trusted reference without changing either. Tests exercise **synthetic real file-backed workspace, approval HMAC/checkpoint, resource proposal/history files and permanent claims**. Grants are an empty synthetic JSON fixture. No active private state or real keys are required.

## Mandatory trust boundary

Before calling `createOfflineSnapshot`, the trusted operator/server composition must establish that **all writers on every host/process are stopped**, automatic restarts disabled, queued work drained or classified uncertain, and the selected roots/ancestors cannot be mutated during collection. The caller supplies `quiescence: "all-writers-stopped"`, a server-owned UUID identity, UUID epoch and externally allocated positive generation. This string is an assertion, not cryptographic proof or machine-verifiable cross-host quiescence. Do not derive it from an HTTP body, model output or untrusted CLI arguments.

The existing protocols are independent: workspace `<workspace-file>.lock`, approval `.key-lock` and `<approval-id>.json.lock`, and resource `<project>/<resource-id>/lock`. Acquiring a new invented root lock does **not** stop their writers. This module acquires none of those locks and refuses transient lock/temp entries. Two identical scans detect some races but cannot prove an atomic live snapshot, prevent an ABA mutation or replace stopped-writer evidence. Descriptor-relative hostile-directory race protection is not claimed; immutable trusted roots are a prerequisite.

The verifier requires an **externally owned, monotonic, non-rollbackable reference** outside the backed-up roots, archives and any future restore target. A private local JSON file is the test adapter, not a production monotonic authority. Its owner/0600 mode and SHA-256 binding do not make it immune to same-owner rollback. Never accept a reference inside an archive, publish an archive's suggested generation as authority without independent approval, restore the catalog alongside the private volume, or pass an in-memory rollbackable reference as production freshness evidence. Loss of the external authority blocks verification/recovery; do not recreate it from a backup.

Reference version 1 binds `serverId`, `epoch`, exact `generation`, `snapshotId` and SHA-256 of the **entire archive**. Changing generation fields alone cannot bless old content. Verification reads the external reference before and after scanning and refuses any observed change. The trusted `verifyOfflineSnapshotAgainstFence` adapter allows an independently authoritative bounded reader; it does not implement catalog publication, CAS or monotonic storage. A change after the final read is still possible. Because there is no restore/effect operation, this is not an effect-time lock or authorization guarantee. A future restore must retain/atomically recheck authority at its actual effect boundary.

**HMAC authenticity is not freshness.** A valid older journal plus its old key can omit claims created later; restoring the entire private volume can replay consumed approvals. Only independent external authority and reconciliation can address this. This tool never turns successful integrity into permission to start.

## Format and limits

The deliberately narrow normalized source tree is:

```text
<offline-private-root>/              0700, owned by current UID
  workspace.json                    0600, workspace version 1/2
  grants.json                       0600, bounded plain JSON
  approvals/                        0700
    .integrity-key                  0600, exactly 32 bytes
    <approval-UUID>.json             0600, actual signed envelope
    .claim-<digest>/                 0700, permanent claims, including empty dirs
  resources/                        0700, all proposal/revision/head files
```

This is a normalized synthetic/offline layout, **not automatic discovery of the Docker volume**. Actual bootstrap secrets, registry configuration, separate grants locations, mounts and encryption keys need an approved inventory/mapping before production integration; none were inspected as active state. Do not omit authority files simply because the synthetic tree did not include them.

Archive version 1 records quiescence assertion, server UUID, epoch UUID, generation, snapshot UUID and entries with relative path, kind, mode and size. Each file carries exact bytes in canonical base64 and a SHA-256. Directories are represented so empty permanent claims are not lost. Required workspace/grants/key/resource/approval roots cannot be omitted. Review-pending runs need matching pending journals; consumed journals need their original run/gate/context claim. Approval HMAC, checkpoint schema, ordered graph/context binding and pending-run equality are checked using the existing contracts. Resource/grant bytes are bound exactly but **not reauthorized as operational policy**; full resource activation and host authorization validation remain necessary before any future recovery.

Limits: 2,048 entries; 16 path components; 512 path characters; 16,000,000 bytes per file; 32,000,000 aggregate decoded bytes; 48,000,000 archive bytes; 4,096 external-reference bytes; plain-JSON preflight depth 32 and 100,000 visited values. There is no compression or archive extraction surface. Reads reject nonregular files, symlink files/ancestors, hardlinks, wrong UID, any mode other than 0600/0700, traversal and transient locks/tempfiles. Options reject inherited authority, prototype keys and accessors without invoking getters. Errors/CLI output use fixed categories and no key/content logging.

**Confidentiality:** base64 and hashes are not encryption or anonymization. The archive contains the private HMAC key, input/output and pending review data. Keep archive/reference files 0600 in approved private directories; store/archive-transfer only through an independently approved encrypted backup service with separate access authority, key escrow, retention and audit. This implementation performs no upload and supplies no encryption/key lifecycle.

## Safe exercise and read-only verification

From the repository, with installed dependencies and an explicitly private ephemeral scratch TMPDIR:

```sh
TMPDIR=/Users/te451223/.hermes/cache/scratch ./node_modules/.bin/vitest run server/__tests__/workflow-backup.test.ts --maxWorkers=1
```

The exercise creates synthetic stores, pauses a real run, creates/verifies an archive, persists a real consumed claim and advances an external test catalog. A separate Node process refuses the valid older archive. Another independent process advances the file-backed catalog between the two fence reads and verification refuses it. No connector/model adapter is invoked by the backup APIs and no ready-to-start directory is emitted. The CLI is exercised against the same temporary synthetic archive.

For an already approved offline archive and separately obtained authoritative reference, the only CLI operation is:

```sh
node --import tsx scripts/workflow-backup-verify.ts verify /absolute/offline/archive.json /absolute/external/reference.json
```

Success is a small JSON report with integrity, blocked restore, generation and entry/file counts. Failure exits 1 with a fixed refusal. Paths must be absolute, traversal-free and symlink-free. Do not point this command at active state or treat arbitrary local reference files as freshness authority.

## Conservative incident/recovery procedure

1. **Contain and preserve.** Stop admission and every writer/automatic restart under the approved service owner. Preserve original private volumes, logs and upstream receipts with restricted evidence access. Record host/process/container ownership and the affected run, project, gate, journal revision and external operation identifiers; do not record payloads/keys in general incident logs.
2. **Prove quiescence externally.** Confirm all hosts and scheduled jobs are stopped, no outstanding connectors can still finish, and no filesystem writer can alter any selected root. This utility cannot establish that proof. If it cannot be established, do not collect a purported consistent snapshot or reclaim a lock.
3. **Inspect authoritative state, not just a lock's age.** Identify whether the observed directory is a transient workspace/key/approval/resource lock or a permanent `.claim-*`. Check journal decision/state, exact original run/CAS, checkpoint graph/context bindings, workspace execution epoch and run disposition, and independent upstream receipts. Time/PID alone cannot establish ownership or absence of remote effects.
4. **Never remove permanent claims.** Never delete/regenerate an integrity key over existing journals, erase claims, rewrite consumed journals as pending, discard resource activation history, automatically reclaim old locks, or auto-retry uncertain calls. Key loss/corruption or mixed state is a fail-closed incident requiring independent recovery authority.
5. **Select against external authority.** Obtain the current non-rollbackable catalog from its independent owner, outside the recovered volume. Verify exact identity/epoch/generation/snapshot/hash. Reject older archives, missing key/journal/claim, changed permissions, links, altered bytes or catalog advancement. Keep all failed candidates private for investigation. Do not make a failed archive pass by lowering the external generation.
6. **Reconcile effects independently.** Compare approved/claimed/consumed/interrupted runs with upstream systems' authoritative receipts and current policy/grants. Reservation gives at-most-one claimed resume, not transactional exactly-once remote effects. Treat any crash after decision, claim or CAS as potentially effectful; do not replay an upstream call to discover whether it ran.
7. **Remain offline.** This verifier performs no restore. Do not manually unpack its data into a configured runtime directory or start the current bootstrap with recovered journals. A `.restore-blocked` marker would be insufficient because the current runtime does not honor such a marker; this module intentionally emits no runtime tree.
8. **Separate future engineering approval.** Production recovery requires a startup/resume quarantine guard enforced at the real composition root, externally monotonic restore fencing retained through effect time, complete mount/config/key inventory, independent claim/effect reconciliation, explicit stale-lock disposition policy, verified host identities/reviewer/resource authority, and an audited isolated recovery drill. Only an independently approved integration may make reconciled state runnable. This runbook grants no permission to delete locks or retry effects.

## Verification evidence

Final focused execution: **46 tests passed in four files**, including 14 new offline-backup tests, 18 approval-route tests, 5 independent/crashed-process tests and 9 workspace-store tests. Executed with the private scratch TMPDIR and one Vitest worker. The new CLI was exercised in a real child process. Both strict scoped module/CLI TypeScript checking and the repository's `tsc --noEmit` completed with exit 0. The complete repository test suite, operational deployment and restored-runtime availability were not exercised by this slice.

## Remaining availability limits

Stopped-writer proof, monotonic catalog publisher/CAS, encrypted backup service, operational key lifecycle, quarantine/startup integration, live consistent snapshotting, audited lock disposition, and end-to-end restored-runtime availability are not implemented or claimed. Integrity verification intentionally fails closed; inability to resume is preferable to duplicate uncertain effects.

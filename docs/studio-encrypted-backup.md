# Encrypted offline archive and synthetic recovery verification

## Accomplished slice — not restore authorization

`server/workflow-backup-envelope.ts` adds real AES-256-GCM encryption around the existing bounded offline archive. It is an **unmounted, trusted-caller, offline byte API**, not an HTTP route, backup scheduler, key service or restore engine. Successful decryption returns the exact validated serialized archive plus the existing report with `restore: "blocked"`.

`scripts/studio-recovery-drill.ts` creates a fresh synthetic file-backed fixture, round-trips an encrypted file, checks every archived byte/mode and an empty permanent claim, and exercises the existing deny-only bootstrap quarantine in real child processes. It does **not extract an archive**, construct/start a restored server, resume a workflow, make an approval decision, call an adapter/provider, remove a marker to unlock state or inspect a live volume. Only the entire newly created synthetic fixture is deleted during cleanup.

This slice does not change `workflow-backup.ts`, startup, approval/claim handling, package configuration, the disabled host identity bridge, a container/image or any public deployment. Source tests and synthetic process evidence do not establish staging-image or production recovery availability.

## Trusted-caller interface

```ts
import { encryptOfflineBackup, decryptOfflineBackup } from './server/workflow-backup-envelope';

// Every argument comes from an independently approved offline operator composition.
// trustedKeyBytes is an explicitly supplied 32-byte Node Buffer, NOT a password.
const encryptedBytes = await encryptOfflineBackup(
  validatedArchiveBytes, trustedKeyBytes, trustedPrivateScratchDirectory,
  readCurrentIndependentFence,
);
const { bytes: verifiedArchiveBytes, report } = await decryptOfflineBackup(
  encryptedBytes, trustedKeyBytes, trustedPrivateScratchDirectory,
  readCurrentIndependentFence,
);
// report.restore === 'blocked'; verifiedArchiveBytes is not a runnable state directory.
```

Both functions take positional arguments:

1. A native non-shared `Buffer`: archive bytes for encryption, envelope bytes for decryption.
2. An explicit non-shared 32-byte `Buffer` key supplied by the trusted caller.
3. An existing, canonical absolute, process-owned **0700** private scratch directory.
4. A trusted `() => Promise<Buffer>` bounded reader for the **independently authoritative current external reference**.

There is no environment/browser/log/key-file discovery, implicit key generation, password coercion, KDF, key identifier lookup, persistent operational key, new dependency, network call or automatic fallback. Invalid key lengths and non-Buffer keys refuse before any fence read. Caller buffers are copied before awaits and never zeroed/mutated by the API; shared-memory backing is refused. Owned temporary key/plaintext buffers are best-effort zeroed. This does not guarantee erasure of JavaScript, native crypto, filesystem or OS copies. Callers remain responsible for their own returned private archive bytes and key lifetime.

**Key provisioning, access control, independent escrow, rotation, nonce/key usage budgets, retention, destruction and audited disaster access are not implemented.** The fixture's one-time random key is never an operational key and is not persisted or emitted. Random 96-bit nonces are generated internally for each encryption; callers cannot select/reuse one through this API.

## Wire version 1

The format is binary, uncompressed and exact-length. Integers are unsigned big-endian.

| Offset | Bytes | Value |
| --- | ---: | --- |
| 0 | 8 | Magic `FDSBENC` followed by NUL |
| 8 | 1 | Envelope version `1` |
| 9 | 1 | Algorithm identifier `1` = AES-256-GCM |
| 10 | 2 | External-reference metadata byte length |
| 12 | 4 | Plaintext/ciphertext byte length |
| 16 | 12 | Random nonce |
| 28 | metadata length | Exact reference bytes from the validated first independent fence read |
| next | ciphertext length | AES-GCM ciphertext of the entire exact archive |
| final | 16 | GCM authentication tag |

**AAD is the complete 28-byte header followed by all metadata bytes.** Version, algorithm, lengths, nonce and reference are authenticated, not merely advisory fields. Unsupported framing, zero/oversized lengths, truncation, extra/trailing bytes, concatenation, tampering and a wrong key all refuse. The tag length is pinned to 16 bytes. Decryption never releases provisional plaintext before authentication and full existing archive/fence verification.

Bounds are enforced before staging/fence lookup for oversized archive/envelope inputs:

- Archive/plaintext/ciphertext: **1–48,000,000 bytes**.
- Reference metadata and each trusted fence read: **1–4,096 bytes**.
- Entire envelope: at most **48,004,140 bytes** (28 + 4,096 + 48,000,000 + 16).
- Existing inner limits remain unchanged: 2,048 entries, 16,000,000 bytes per file, 32,000,000 aggregate decoded bytes, private file/directory modes, constrained relative paths, JSON structural preflight, required authority files, HMAC/checkpoint/order bindings and permanent-claim checks. See `docs/workflow-backup-recovery.md` for that contract.

Reference schema/version is validated by the existing verifier, not a second weaker implementation. Encryption validates the exact bytes before encrypting. Decryption authenticates first, requires metadata to equal **each independently supplied fence read byte-for-byte**, and validates the decrypted archive against that fence. JSON whitespace/reordering in a subsequently supplied reference therefore refuses, even if semantically equivalent. Never use envelope metadata itself as the trusted reader.

Metadata is authenticated **but not encrypted**: reference identity/epoch/generation/snapshot/hash, total length and nonce are visible. Ciphertext is not anonymization. The entire envelope and the independent reference still need separately approved access/storage policies.

## Reusing archive validation safely

The existing verifier accepts a private regular archive file, not a Buffer. The new API therefore creates one fresh random `offline-envelope-*` scratch directory, writes only `archive.json` with exclusive/no-follow creation and 0600 permissions, calls the unchanged `verifyOfflineSnapshotAgainstFence`, then unlinks that archive and removes the empty temporary directory before returning. It creates no workspace layout, extraction target, store lock or runtime capability.

Scratch spelling is checked before creation: absolute only, no empty/dot/traversal components, backslashes or control characters. Every ancestor must be a real directory, never a symlink. Scratch/staging directories must be process-owned 0700; the created regular archive must be process-owned 0600 with one link. Success and ordinary failure cleanup are tested. Cleanup failure is a fixed refusal, not reported success.

**The scratch archive is plaintext.** Use an approved private encrypted scratch filesystem and account for crash remnants in an independent operational procedure. Normal unlink is not secure erase; abrupt process/host termination cannot guarantee cleanup. There is no stale-directory reclamation API. Namespace/ancestors must remain trusted and immutable while the operation runs: these checks are not descriptor-relative protection against a hostile concurrent directory swap. The source snapshot still requires independently established stopped writers. No new root lock pretends to coordinate existing store locks.

All public API failures are exactly `Error('encrypted offline backup refused')`, without a native cause, key, payload or path. The module performs no logging. The synthetic CLI emits only its bounded nonsecret report or `synthetic recovery drill refused` and exit 1. Time/admission bounds for a trusted fence reader are the embedding caller's responsibility; this module is not an exposed concurrent service.

## Reproducible isolated verification drill

With already installed dependencies, from the repository:

```sh
TMPDIR=/Users/te451223/.hermes/cache/scratch \
  node --import tsx scripts/studio-recovery-drill.ts synthetic \
  /Users/te451223/.hermes/cache/scratch
```

The CLI accepts only `synthetic <existing-private-scratch-parent>`; it cannot accept a backup, live state root, key, extraction target or restore/unlock command. It creates a new unpredictable `studio-recovery-drill-*` child and only operates on that child. Unsupported commands/path spelling refuse without creating a fixture. The scratch parent and its unrelated contents are retained.

The actual drill:

1. Creates real synthetic workspace/draft/run files, a run paused at an actual approval node, a signed approval checkpoint, a real resource proposal/history and explicit empty synthetic grants. The graph is manual → approval → output; installed deny-only adapters remain uncalled.
2. Persists the real permanent run/gate/context claim **before any resume**, leaving the journal pending. This is an isolated claim-before-resume crash-boundary fixture, not a fabricated completed effect or human approval. It performs no `beginResume`, runner restore or runner resume.
3. Uses the existing archive creator and a clearly named, external-to-source **synthetic-reference-not-monotonic.json** fixture. That local file is deliberately not claimed as monotonic production authority.
4. Encrypts, exclusively writes a private encrypted file, reads back the exact ciphertext, decrypts/authenticates it and validates through the existing verifier. Compares every recovered archive entry to original file bytes/directory modes; preserves the empty permanent claim. No files are extracted from decrypted entries.
5. Actually refuses wrong-key, tampered-tag and stale-reference decryptions. The synthetic reference advances to a newly created generation-2 snapshot; the old encrypted archive refuses. An old valid tag/HMAC cannot establish freshness.
6. Confirms the original archive-source entries are unchanged, then adds a quarantine marker **only to that new synthetic source**. `sourceUnchanged` reports original archived bytes/modes, excluding this deliberate marker addition. Checks the complete marked inventory after each of two actual child bootstrap attempts. Bootstrap and native guard are real unchanged sources; secret/server downstream imports are explicit deny-only counter fixtures, so a guard regression cannot start a server or load secrets. Each attempt must exit 1 with the existing fixed refusal and all downstream counters zero. This is not a deployed-image boot test.
7. Deletes the entire owned synthetic subtree and verifies ENOENT before returning `cleanup: "verified"`. No marker is cleared to make any target runnable. Output contains counts, fixed statuses and aggregate synthetic hashes, never archived bodies or keys.

A successful run reports `restore: "blocked"`, `extraction: "not-implemented"`, `runtimeStarted: false`, zero adapter/resume/downstream calls, preservation and refusal results, and verified cleanup. Availability of a restored runtime is intentionally **not** a success criterion or claim.

## Verification and remaining gates

The new test file covers real native crypto interoperability/random nonces, authenticated framing and metadata, wrong keys/references, truncation/concatenation, tampering, fixed sanitized errors/no logging, input ownership, shared-memory/type refusals, private/no-follow staging and cleanup, malformed archive/reference schemas and byte ceilings. The exact 48,000,000-byte archive with 4,096-byte reference is exercised, not merely its oversized rejection. Real function and CLI drill paths are exercised independently.

```sh
TMPDIR=/Users/te451223/.hermes/cache/scratch ./node_modules/.bin/vitest run \
  server/__tests__/workflow-backup-envelope.test.ts \
  server/__tests__/workflow-backup.test.ts --maxWorkers=1
./node_modules/.bin/tsc --noEmit
```

These are local source/fixture checks. The implementation's original focused run and first independent review passed **34 test cases** across the two named files (**20 envelope/drill tests + 14 existing archive tests**). That review nevertheless reproduced a cross-realm shared-memory input-contract defect: local-realm `instanceof SharedArrayBuffer` did not recognize a native Buffer backed by another realm's shared store. The refusal now uses the realm-independent native backing-store brand check. Four regression cases first reproduced the acceptance, then passed with the repair; the parent reran **38 cases** (**24 envelope/drill + 14 archive**), all passing. Fresh independent remediation review is now accepted in that bounded scope: **38 focused cases and 42 separate native-VM probes passed**, including shared-backed encryption/decryption keys, archive/envelope inputs and both fence reads, plus ordinary foreign-realm/offset controls. Parent verified 18 artifact hashes and 12 current source/config/document hashes, then independently replayed all 42 probes with zero failures and verified fixture cleanup. Repeated runs and probe records are not added to the Vitest total. Evidence is `docs/evidence/v1/envelope-remediation/independent-recheck/`; its source hashes precede this documentation-only acceptance annotation. This closes F1's input-contract repair, not production recovery authority.

The standalone real CLI drill reported **6 files, 11 entries, 1 permanent claim, 2 refused bootstrap attempts**, zero adapter/resume/downstream calls, exact encrypted-file/archive preservation and verified cleanup. These totals are focused coverage, not a full-repository or deployed-image test result. No existing archive/runtime path was replaced by this slice.

Production recovery remains independently blocked on:

- Operational encrypted storage/transfer integration and complete key lifecycle/escrow authority.
- Real stopped-writer proof and a complete approved inventory of mounts, secrets, bootstrap configuration, grants, registry/history and identity state; the normalized fixture is not volume discovery.
- An independently owned non-rollbackable reference publisher/CAS and effect-time freshness fencing retained through recovery/start/resume. Two reads alone are not such a lock; a local catalog is rollbackable.
- Independent permanent-claim, approval, interrupted-run and upstream-effect/receipt reconciliation. Authenticity is not freshness; no automatic retry can resolve an uncertain external effect.
- Exact host/reviewer/resource authority and policy reconciliation; the host identity bridge stays disabled.
- A separately reviewed safe extraction/ownership/namespace design, complete startup **and resume** quarantine coverage, explicit recovery authorization and a production-topology availability drill. No extraction is supplied here, so there is no partial restore API to misuse.
- Stale-lock disposition and audited incident procedure. Never remove live permanent claims or regenerate an integrity key to make a failed candidate pass.

A passing synthetic verification drill closes none of those production authority/availability gates by itself.

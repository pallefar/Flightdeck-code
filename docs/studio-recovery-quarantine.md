# Marked-state bootstrap refusal

**Scope: deny-only engineering control, not recovery authorization. G03 remains open.**

The private Docker bootstrap now checks its state root before `loadSecrets`, operator validation, server composition or listening. An operator-placed `.restore-blocked` entry refuses startup. The guard uses only `lstat`; it never opens or reads the marker. Regular files (including empty/unreadable files), directories, symlinks (including dangling links), and every other existing entry kind all deny. There is no marker-content schema or special value that enables startup.

Refusal retains the existing constant public result: exit status 1, no stdout, and:

```text
studio: startup refused (check private configuration)
```

Neither private paths, marker content, secret values, nor native metadata errors are echoed. The guard creates, changes, removes and authorizes nothing. In particular, a marked root cannot reach token creation, secret-file loading, approval-key initialization, grant/store writes, provider calls, route registration or listening through this bootstrap. There is no unlock/removal/clear endpoint, extraction, restoration, activation, repair, reconciliation or retry added by this change.

## Root contract

`STUDIO_STATE_DIR` is trusted operator configuration, not a request/browser/archive field. Bootstrap retains the `/state` default when the variable is absent. Configure the stopped process with a literal, canonical absolute POSIX path:

- No root `/`, relative/empty path, empty path component, trailing slash, backslash, control character, `.` or `..` component. Invalid spelling is refused before any filesystem lookup, not normalized into another location.
- Starting at `/`, every existing ancestor and the root itself must be a real directory, not a symlink. A file or other root/ancestor entry is refused.
- An existing state root must be owned by the process UID and have exactly private `0700` permission bits, without special mode bits. The guard does not repair ownership or permissions. This tightens rejection of unusual custom roots, while retaining the normal new private bootstrap defaults.
- Only native `ENOENT` for the **final** root component under fully checked existing ancestors permits a fresh root. No recursive missing-ancestor allowance and no automatic `mkdir` occurs in the guard. The unchanged secret loader can create that fresh root only after the guard returns.
- For an existing validated root, only `ENOENT` from marker `lstat` permits normal unmarked startup. `EACCES`, `EPERM`, `EIO`, `ENOTDIR`, `ELOOP` and all other/uncategorized metadata errors refuse.

This assumes a stopped application and a trusted, immutable root/ancestor namespace throughout checking and startup. It is **not hostile TOCTOU/race protection**, a root lock, a stopped-writer proof, or coordination with existing per-store locks. No deployed path or volume was marked or modified to implement or test this control.

## What this does not establish

Passing the guard means only that this bootstrap did not observe a marker under the stated assumptions. It is not an allow/activation decision. In particular this does **not**:

- detect unmarked restored archives/state, a removed marker, or a rolled-back/missing marker;
- establish freshness, an external monotonic identity/epoch/generation/CAS fence, nonrollbackability or backup completeness/confidentiality;
- guard direct `createServer(...)` callers or the direct `server/index.ts` entry, which bypass this Docker bootstrap;
- quarantine an already-running server, dynamically stop/resume workflows, or enforce effect-time recovery authority;
- reconcile uncertain external effects/receipts, erase claims/locks, authorize key regeneration, supply production reviewer authority, or make restored state safe to run;
- complete G03/R01 or authorize deployment, restoration, recovery activation or marker removal.

Do not use the absence or manual deletion of a marker as recovery approval. Safe operational recovery still requires the independent authority, inventory, stopped-writer and effect-reconciliation prerequisites in `docs/workflow-backup-recovery.md`.

## Verification boundary

`deploy/studio-docker/recovery-quarantine.test.mjs` runs in the existing Node test family. All state fixtures are newly created private directories under the configured scratch temporary root; no deployed volume, host source, database, hosted credential or provider service is used.

Tests exercise the actual bootstrap entry in child processes:

- Marked regular/empty/symlink/dangling-symlink/directory fixtures refuse repeatedly with exact file bytes/modes and directory contents unchanged. An additional child with real secret loader/composition imports, no supplied operator token and a deliberately invalid fixture operator proves no token is created before refusal. These marked children never reach composition.
- Hermetic downstream-import fixtures count `loadSecrets`, `operatorFromEnv`, `createServer`, and `listen`: all remain zero on refusal. Real guard code and native filesystem metadata are retained; selected metadata failures/ownership bits are injected only where deterministic errno/ownership testing requires them. This is not evidence of production filesystem races or provider behavior.
- Malformed spelling, symlink roots/ancestors, non-directory entries, insecure roots, missing ancestors, native inaccessible-root modes and injected unexpected metadata errors fail closed. A valid private unmarked root and a final-component-absent root preserve normal progression, without guard writes.
- An isolated real unmarked child boots the actual composition with an explicitly nonsecret fixture operator token and no model credentials. Real loopback HTTP verifies exact public/authenticated liveness, unauthorized descriptor/workspace refusal, authenticated empty workspace reads, and `409 model-connection-unselected`. A throwing provider-fetch trap records zero calls. The child terminates through the existing SIGTERM handler, not a deployed service action.
- Source contract assertions pin pre-loader/pre-composition ordering and the explicit production-runtime helper COPY plus Dockerfile-specific context allowlist. This is a packaging contract, **not an image build/startup proof**. The existing default runner still executes both Vitest and Docker Node families.

Local commands:

```sh
node --test deploy/studio-docker/recovery-quarantine.test.mjs
npm run test:docker
npm test -- scripts/test-entry.test.ts --maxWorkers=2
npm run typecheck
npm run build
git diff --check
```

## Parent acceptance — October 15, 2026

Parent reread the helper, actual bootstrap, secret loader, both Dockerfile paths and context rules. The API-only Dockerfile already copies the complete whitelisted deployment directory; the production Dockerfile explicitly copies the new helper.

Independent execution passed all **14 focused tests**, all **30 Docker Node tests**, and the default two-family entry with **2 selected Vitest tests plus those same 30 Node tests**. These are overlapping runs, not additive distinct test totals.

A separate guard-overlay image `flightdeck-studio-recovery-parent:20261015` (actual ID `sha256:de83a93905dc221079dfc410bc25407e94ae81d6053bfbb99b415a2c1a8e32c5`) was built on the immutable accepted staging image, copying only the actual new bootstrap/helper and a nonsecret development probe. Under UID 1000, network-none, read-only root, dropped capabilities and fresh private tmpfs state, **8 unique Linux fixture checks** passed. The actual bootstrap refused five marker kinds twice each with exact state unchanged and no operator-token creation; private unmarked/fresh-root handling and nonrepair of insecure permissions were also exercised. The copied helper's SHA-256 matched the checkout.

`docs/evidence/next-ui/recovery-quarantine-parent.json` records the result, exact image IDs and readback. Both owned one-shot containers were removed; existing staging/companion/OS container IDs were unchanged. No active volume was mounted or marked.

This Linux overlay proof is **not a build of the complete new production application** and does not accept its packaging/release. The final combined candidate remains separate. The engineering interlock is verified, but G03/R01, independent monotonic authority, already-running/effect-time enforcement, recovery activation and deployment remain open.

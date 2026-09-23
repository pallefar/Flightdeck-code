# Flightdeck Studio — handover

Everything below was **verified by running it** in the container this was built in,
unless a line says otherwise. Where something cannot be verified here, it says so
and says why.

- **Repo:** `https://github.com/pallefar/Flightdeck-code`
- **Branch:** `claude/gauntlet-loop-install-hp490e` — the only branch. There is no
  `main` on origin, so clone and stay on this one.
- **State:** 2368 tests, 0 skipped, 119 files, all passing against `project-contract`
  at `integration/unified-2026-09-22`; `tsc --noEmit` clean (2026-09-22, Mac).
  The one host-dependent failure is closed: the host's docusign manifest declares
  `contributions: docusignContributions` (host 42b0f308, OS-04), a member of
  `SubAppManifest` that `subAppManifestSchema` never validates — like
  `initSchema`/`registerRoutes`. Codegen's test-only manifest reader now sets
  aside exactly the members the host's interface adds beyond the Zod data
  (drift-tested against `server/subapps/types.ts` in both directions), splits
  members by bracket depth rather than by line, and still throws on a computed
  data field, a computed unknown member, a spread or a shorthand.
  ⛔ **The conformance gate treats `contributions` the opposite way: it REFUSES
  it (FD-M008).** The host acts on it at boot (`assertContributionsUnambiguous`)
  and at runtime, so a generated mini-app may not declare one. Before this, the
  gate called it "additive and ignored" and passed a manifest that contributed
  signing state. `manifest-members-drift.test.ts` now fails if the host's
  manifest gains a member the gate neither validates, requires nor refuses.

---

## 1. Why you are moving this to the Mac

One reason only: **the host's compliance gate cannot pass in this container.**
Studio itself does not need a database — the only mention of Postgres in this
repo is a *denylist* of imports a generated mini-app may not use
(`packages/conformance/src/checks/capability-escape.ts:40`).

What that blocks, precisely: `scripts/promote.sh` runs Flightdeck's own
`scripts/gate.sh` with a generated candidate mounted, and writes a
`studio-compliance-record/1`. `shipSubApp` refuses to write into the host repo
without a passing record for that exact spec. So today nothing can be promoted
from this container — not because the code is wrong, but because the gate cannot
pass here.

**What was actually established here — including where my first reading of it
was too confident.**

The gate was run three times: with the candidate mounted, on a clean host with
nothing mounted, and again after installing the missing Python packages. The
current state of a clean host in this container is:

```
PASS: contracts/ PII boundary
FAIL: flightdeck vitest suite
SKIP: flightdeck Postgres tier — flightdeck/.env.supabase not found (gitignored)
PASS: flightdeck typecheck
PASS: run_eval.py            ← was FAIL; fixed by two pip installs, see §2.4
FAILED STACKS: vitest
EXIT=1
```

Three separate things, and they are not the same kind of problem:

1. **`run_eval` is solved.** It needed `python-docx` and `openpyxl`. Verified,
   not predicted — it now passes inside the gate as well as standalone.

2. **`postgres-tier` does not need you to install Postgres.** It skips because
   **`flightdeck/.env.supabase` is missing**, and that file is gitignored. You
   need the credentials file, not a local database. (I had written "install
   Postgres" here before reading the skip reason. It is Supabase.)

3. **The `vitest` stack's failures are not yet attributable.** Several are
   artefacts of how I built the sandbox rather than facts about the host: the
   copy excluded `.git`, so `piiGitBoundary.test.ts` refuses to run
   ("requires a real git repository"); `web/dist` was never built, so a test
   that says "run `npm run build:web` — this test measures the real bundle"
   fails; `contracts/INDEX.json` is a derived artifact that was not in the
   copy. The rest point at a missing `soffice` (LibreOffice) and at Supabase.

   So **do not carry my numbers over.** Establish your own baseline on the Mac,
   in a real checkout, before attributing anything to Studio:

   ```bash
   cd /Users/you/project-contract && bash scripts/gate.sh
   ```

   That is the number to compare against.

**The one properly-controlled experiment, and it is the good news.**
`npm run mount` copies the host, runs its suite, mounts a generated sub-app,
and runs the same suite again — same sandbox, one variable:

```
before: Tests  1 failed | 2719 passed | 21 skipped (2741)
after:  Tests  1 failed | 2729 passed | 21 skipped (2751)
```

**Mounting added 10 passing tests and no failures.** The single failure is
present in BOTH runs — a real docx→PDF conversion that does not succeed in this
container — so it is not ours. This is the evidence I should have led with:
unlike the gate comparison above, it holds everything else fixed.

### 1.1 The first end-to-end run on the Mac (2026-09-24) — both scripts are red, for named reasons

Run on the owner's Mac against the OS integration tip `c44d665b`
(`integration/unified-2026-09-22`, a clean worktree — not `project-contract`,
which holds loose PII files). Postgres tier opted out on purpose
(`FLIGHTDECK_GATE_POSTGRES=0`: the Mac's only database is the live one).

```bash
REPO=<clean OS worktree> npm run mount
HOST_REPO=<clean OS worktree> FLIGHTDECK_GATE_POSTGRES=0 PYTHON_BIN=<a venv with processes/contracts-de/engine/requirements.txt> npm run promote
```

**`npm run mount` — EXIT 1, MOUNT FAILED** (host sub-app suite, same sandbox):

```
before: Tests  3394 passed | 1 expected fail | 24 skipped (3419)
after:  Tests  1 failed | 3405 passed | 1 expected fail | 24 skipped (3431)
failing only with the sub-app mounted:
  tests/subapps/launcherSubappDefaults.test.ts > ⛔ every registered sub-app not on the exclusion list is defaulted ON
```

Mounting added 11 passing tests and **one failure that is the candidate's**:
the host requires every registered sub-app to be switched on in
`scripts/start-postgres.sh` or listed, with a reason, as off by default.
Codegen emits neither. Which side a generated mini-app belongs on is a
decision, not a fix (see §6). Before this run the script printed this
comparison and exited 0 whatever the result. It now fails when mounting adds a
failure or adds no passing test, or when either run has no summary. It also
runs the suite behind the same `POSTGRES_*` unset and `AUTH_REQUIRED=false`
`WORKSPACES_ENABLED=false` fence that `gate.sh` uses (`scripts/__tests__/sandbox.test.ts`).

**`npm run promote` — EXIT 1, BLOCKED.** Record:

```json
{ "passed": ["conformance-redteam","generate-and-mount","build-web"],
  "failed": ["studio-suite","host-gate"],
  "skipped": ["host-gate-partial"],
  "readyForProduction": false, "verdict": "BLOCKED — stacks failed" }
```

- `studio-suite`: 2 of 2534 failed. One was a test that inherited
  `FLIGHTDECK_GATE_POSTGRES=0` from promote's environment. It is fixed and
  now pins the variable. The other is
  `harness.test.ts › re-recording an unchanged call rewrites the same bytes`,
  a wall-clock `durationMs` flake (0 vs 1 ms). It is not fixed here and passed
  on the rerun (2534/2534).
- red-team: `9/9 planted violations produced a BLOCKING finding`.
- host gate (`gate.sh` in the sandbox): PII boundary PASS · typecheck PASS ·
  `run_eval.py` PASS (`regressions 120/120 · gates 4/4 · wc-xlsx 21/21 · GREEN`) ·
  Postgres tier SKIPPED (opted out) · **vitest FAIL, 11 of 8299**:
  - 6 × `piiGitBoundary.test.ts` (the untracked index files and the five loose
    Pudzianowski files "still exist"). These stay red in ANY PII-free sandbox
    until a person moves the files or rules on the split (`scripts/sandbox-lib.sh`, KNOWN).
  - 3 × `contracts/INDEX.json` readers (`api`, `contracts-read`, `readers`).
    `INDEX.json` is gitignored, so it is never in the sandbox.
  - 1 × `launcherSubappDefaults.test.ts`: the candidate (as above).
  - 1 × `atlasCategoricalPalette.test.ts`: **the candidate.** Codegen's web
    module hard-codes four pre-Atlas hex colours
    (`web/src/subapps/wc-clock/index.tsx → #ff8200 #2fd472 #ffc24b #ff5b4d`).
    `npm run mount` cannot see this because it runs `tests/subapps/` only.

`run_eval` passes only because `PYTHON_BIN` pointed at a venv. The sandbox is
tracked files only, so it never has the host's `.venv`. `sandbox_run_host_gate`
now hands the gate the host's `.venv/bin/python` when `PYTHON_BIN` is unset.
With neither, a PEP 668 Homebrew `python3` fails `run_eval` on `import docx`.

---

## 2. Setup on the Mac

### 2.1 Prerequisites

| Need | Why | Check |
|---|---|---|
| Node ≥ 20 | declared in `package.json` `engines` | `node -v` |
| Python 3.11+ | the host's engine + `run_eval.py` | `python3 --version` |
| `flightdeck/.env.supabase` | the host gate's `postgres-tier` stack — it wants CREDENTIALS, not a local install | `ls flightdeck/.env.supabase` |
| LibreOffice (`soffice`) | some host docx→PDF tests | `soffice --version` |
| The host repo | guardrails compare against it; promote mounts into it | see §2.3 |

### 2.2 Studio

```bash
git clone https://github.com/pallefar/Flightdeck-code
cd Flightdeck-code
git checkout claude/gauntlet-loop-install-hp490e
npm ci                 # package-lock.json is committed
npm run typecheck      # expect: clean
npm test               # expect: 2368 passed, 0 skipped  — see the warning below
```

> ⚠ **`npm test` FAILS if the host checkout is missing**, with a named reason.
> That is deliberate: a divergence test that silently skips is indistinguishable
> from one that passed. Verified both ways here:
>
> ```
> FLIGHTDECK_HOST_ROOT=/nonexistent npm test          → 1 failed, 8 skipped
> FLIGHTDECK_HOST_ROOT=/nonexistent \
>   FLIGHTDECK_HOST_ABSENT_ACKNOWLEDGED=unverified-lists-accepted npm test
>                                                     → 7 passed, 8 skipped
> ```
>
> The acknowledgement is a deliberately non-obvious exact string, because `=1` is
> what people set by reflex to make red go away. Use it only until you have the
> host repo cloned.

### 2.3 The host repo

Everything that points at the host is an **environment variable with a Linux
default** — there are no hardcoded paths to edit. (That sentence was FALSE when
first written: three host-comparison test files hardcoded the Linux path and
ignored `FLIGHTDECK_HOST_ROOT`, so on a Mac they would have skipped silently on
every run. Fixed; the variable is now honoured, verified by pointing it
elsewhere and watching 12 tests move from passing to skipped.)

```bash
export FLIGHTDECK_HOST_ROOT=/Users/you/project-contract   # guardrails read this
export HOST_REPO=/Users/you/project-contract              # scripts/promote.sh
export REPO=/Users/you/project-contract                   # scripts/mount-in-host.sh
(cd "$FLIGHTDECK_HOST_ROOT/flightdeck" && npm install)     # promote.sh requires this
```

### 2.4 What the host gate needs that this container lacks

```bash
# ⭐ VERIFIED — these two, and the eval stack goes GREEN.
#
# Not guessed from the error message: the host's third-party Python imports
# were enumerated (`docx` and `openpyxl`; everything else is stdlib or one of
# the host's own modules). Both were missing here. After installing them:
#
#   $ PYTHONUTF8=1 python3 processes/contracts-de/engine/eval/run_eval.py
#   OVERALL: regressions 120/120 · gates 4/4 · wc-xlsx 21/21 · cases 4 · GREEN
#   EXIT=0
#
python3 -m pip install python-docx openpyxl

# ⚠ NOT a local Postgres install. The postgres-tier stack skips with:
#
#   SKIP: flightdeck Postgres tier — flightdeck/.env.supabase not found
#         (it is gitignored — expected in CI and in a fresh worktree)
#
# So what it wants is the CREDENTIALS FILE, which is deliberately not in the
# repo. Put your `flightdeck/.env.supabase` in place; read gate.sh's
# postgres-tier block for the variables it expects. This is the one thing in
# this document that could not be verified here, because there is no such
# file and no database in this container to verify it against.
```

Then read `$FLIGHTDECK_HOST_ROOT/scripts/gate.sh` for the exact connection
variables it expects — **do not guess them from this document.** It was not
possible to verify the Postgres configuration here, because there is no database
in this container to verify it against. That is the one section of this handover
written from reading rather than from running.

---

## 3. Running it

### 3.1 The server (the only thing that needs a key)

The browser half needs no server: codegen and conformance are pure by
construction, so the workbench runs them client-side. The server exists for the
model call, which needs a key that must never reach a browser.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export STUDIO_OPERATOR="Your Name"                       # required; a real name
export STUDIO_OPERATOR_TOKEN="$(openssl rand -hex 24)"   # required; ≥24 chars
npm run dev:server
```

Verified here:

```
$ npm run dev:server
studio: listening on http://127.0.0.1:8787

$ curl -s localhost:8787/api/studio/health
{"ok":true,"model":"claude-opus-5","modelKeyConfigured":false}
                                                        ^^^^^
     false because there is no key in THIS container. On your Mac with
     ANTHROPIC_API_KEY exported it reads true. The server boots either way —
     the client is built lazily, so a missing key fails at call time, which is
     correct, rather than at import time, which would be hostile.

$ curl -s -o /dev/null -w '%{http_code}' -XPOST localhost:8787/api/studio/build \
    -H 'content-type: application/json' -d '{"prompt":"test"}'
401
```

**The 401 is the design, not a bug.** `buildEnvelope` only calls an operator's own
instruction `ready` when the text is `first-party-operator` AND the actor is a
named human. If an HTTP body could set those, any caller could self-certify. So
they come from config and a request proves it is the operator with the bearer
token. An unauthenticated request is refused rather than quietly downgraded and
run anyway — that would still spend your model budget.

A real call:

```bash
curl -s localhost:8787/api/studio/build \
  -H "authorization: Bearer $STUDIO_OPERATOR_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"prompt":"Show contract folders needing review, visible to legal and admin."}'
```

### 3.2 Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `STUDIO_OPERATOR` | **yes** | — | The named human who operates this Studio. Boot refuses anything in `NON_NAMES` (`guardrails/src/approval-pure.ts:58`) — system, automation, agent, studio, flightdeck, approver, admin, unknown, n/a, service, svc, bot, robot, none, null, undefined, anonymous, someone, user — and anything under 2 characters. |
| `STUDIO_OPERATOR_TOKEN` | **yes** | — | Bearer secret, ≥24 chars. The only thing separating an anonymous request from the first-party path. |
| `ANTHROPIC_API_KEY` | for real calls | — | Read lazily; the server boots without it. |
| `PORT` | no | `8787` | `vite.config.ts` derives its `/api` proxy target from this, so `npm run dev` and `npm run dev:server` stay in step. |
| `STUDIO_HOST` | no | `127.0.0.1` | Loopback by default: this process holds a key and a secret. |
| `STUDIO_GRANTS_FILE` | no | `<studio root>/.studio/grants.json` | Durable approvals, written `0600`. The base is the Studio checkout (`STUDIO_ROOT`: the nearest ancestor of `server/index.ts` holding a `package.json`), never cwd: a relative value resolves against that root, an absolute one is used as given, set-but-empty refuses to boot. Boot prints `studio: grants at <path>`. A grants file created under another cwd before 2026-09-22 is not migrated — it fails closed (reads as no grants), so point this variable at it explicitly. |
| `FLIGHTDECK_MODEL` | no | `claude-opus-5` | |
| `FLIGHTDECK_EFFORT` | no | `high` | `low\|medium\|high\|xhigh\|max`, case-sensitive. Anything else is refused at boot (`studio: refusing to start — FLIGHTDECK_EFFORT=turbo is not one of …`, exit 1), and `createServer` throws on it whenever it builds the real provider. Unset or empty takes the default. |
| `FLIGHTDECK_HOST_ROOT` | no | `/home/user/project-contract` | **Set this on the Mac.** |
| `FLIGHTDECK_HOST_ABSENT_ACKNOWLEDGED` | no | — | Exact string `unverified-lists-accepted`. Only while the host repo is absent. |
| `FLIGHTDECK_HARNESS_MODE` | no | — (off) | Unset or empty: the server calls the provider directly and records nothing. `live`/`record`: calls the provider and records each call into `fixtures/harness/` (needs a key and costs money). `playback`/`replay`: answers only from `fixtures/harness/`, needs no key, and a miss fails with `HarnessCacheMiss`, reported as an `invalid_draft` issue. Any other value stops the server at boot. `/api/studio/health` reports the mode as `harnessMode`. See `fixtures/harness/README.md`. |
| `HOST_REPO` / `REPO` / `SANDBOX` / `SPEC` / `RECORD` | no | Linux paths | Used by `scripts/*.sh`. |
| `SUBAPP_<ID>_ENABLED` | per sub-app | — | Generated kill switch; `"true"` exactly. |
| `CODEGEN_DEBUG=1` | no | — | Stack traces from the codegen CLI. |

### 3.3 Scripts

| Command | What it does | Works here? |
|---|---|---|
| `npm test` | 2368 tests | ✅ |
| `npm run typecheck` | `tsc --noEmit` | ✅ |
| `npm run dev` | Vite, the workbench | ✅ |
| `npm run build` | `tsc -b` + Vite build → `dist/` | ✅ 553 kB bundle, 1.7s |
| `npm run dev:server` | the composition root | ✅ |
| `npm run redteam` | plants violations, all must block | ✅ `7/7` |
| `npm run standalone` | builds and smoke-tests each standalone fixture | ✅ |
| `npm run mount` | mounts a candidate into a host sandbox and diffs the suite before/after; exits 1 if mounting adds a failure or no passing test | container: +10 passing, +0 failing · Mac (host c44d665b): ❌ +11 passing, **+1 failing** — §1.1 |
| `npm run promote` | **the production gate** | ❌ blocked — §1, Mac run §1.1 |

---

## 4. What "done" looks like on the Mac

Run the gate and read the record:

```bash
HOST_REPO=/Users/you/project-contract SPEC=fixtures/wc-clock.spec.json \
  bash scripts/promote.sh
cat /tmp/fd-promote/compliance-record.json
```

Today, here, it ends (this record is from BEFORE the two pip installs; the four
Studio stacks pass, the host stack does not):

```json
{ "passed": ["studio-suite","conformance-redteam","generate-and-mount","build-web"],
  "failed": ["host-gate"],
  "skipped": ["host-gate-partial"],
  "readyForProduction": false,
  "verdict": "BLOCKED — stacks failed" }
```

You are done when `failed` and `skipped` are both empty and
`readyForProduction` is `true`. **A skip is never green** — the record says so
itself, and `admitComplianceRecord` refuses a record with a skipped stack even
if the boolean claims otherwise.

Then `shipSubApp` will accept it and write into the host repo. Until then it
refuses, and that refusal is the feature.

---

## 5. Things that will bite you if nobody says them

These are load-bearing. Each is a property something else depends on.

1. **`payloadTier` is not the caller's to assert.** `envelope/src/tier-claim.ts`
   recomputes it from the bytes. A record or a report whose claim disagrees with
   its own evidence is refused in *both* directions — including the "cautious"
   direction, because believing a pessimistic lie still means the claim decides.

2. **There is ONE named-human rule**, `guardrails/src/approval-pure.ts`. It has
   been duplicated three times in this repo's history and every copy was weaker;
   one accepted `"system"`, `"bot"`, `"anonymous"` and a bare `"x"`. Import it.
   `registry/src/__tests__/one-named-human-rule.test.ts` asserts no local
   `NON_NAMES` list exists.

3. **`packages/*/src/pure.ts` must not reach Node.** Not just imports — *globals*
   too. `Buffer` and `process` sat inside that surface for the whole life of the
   package while the fence was green, because the fence walked import lines.
   `pure-closure.test.ts` now scans for both.

4. **Transcribed constants must have a drift test** that reads the original off
   disk and fails in both directions. `envelope/src/coverage.ts` explains why the
   copies exist; `tier-claim-drift.test.ts` and `tier-ceiling-drift.test.ts` are
   the pattern to follow.

5. **Widening consent needs a named human; narrowing needs nobody.** Enabling
   records `grantedScopes`, so it is a guardrail-4 moment. Disabling emits none —
   a kill switch that waits for a person is not a kill switch.

6. **A corrupt store is an error, never an empty one.** Reading it as empty looks
   fail-safe (no rows → everything refused) and then the next write erases the
   record the control existed to protect.

7. **Never add an opt-out to the fixture privacy guard.** `writeFixtureAt`
   refuses to write personal data into a committed file. An escape hatch there
   would be used by exactly the caller who most needs the refusal.

---

## 6. Honest remaining work

- **The host gate has never gone fully green anywhere I could observe it**, and
  one of its three problems is now solved (`run_eval`, via two pip installs).
  What remains is the `vitest` stack and the Supabase credentials file. Getting
  a clean `bash scripts/gate.sh` on the Mac is the first thing to do and the
  only thing standing between this and a promotable build — and per §1, start
  by taking your own baseline, because my sandbox numbers are not a fair
  comparison.
- **Two host tests fail on every generated candidate** (the Mac run in §1.1).
  (1) `launcherSubappDefaults.test.ts`: a new sub-app must be switched on in
  `scripts/start-postgres.sh` or listed as off by default. This is an open
  decision. Switching generated mini-apps on (layer 2, the per-workspace
  install, still applies) is not fail-closed. Leaving them off needs an entry
  in a host test. (2) `atlasCategoricalPalette.test.ts`: the codegen web
  emitter hard-codes pre-Atlas hex colours. This is a codegen fix. Until both
  are dealt with, no candidate can pass the host gate, even after the PII files
  are moved.
- **Grant rows are versioned (closed 2026-09-22).** A row carries a
  store-assigned `rev`; `putGrantRow(row, expectedRev)` (`null` = create-only)
  throws `GrantRowConflictError` (`code: "grant_row_conflict"`, `status: 409`)
  when the row moved since the writer read it, so a widening can no longer
  silently erase a narrowing. `revokeGrantRow` stays unconditional but bumps the
  rev, so a widening prepared before a revoke is refused after it. Both stores
  apply the same check (`versionedGrantWrite`, `approvals/src/store.ts`); the
  file store does it under its lock. Pinned by `row-version.test.ts` and the
  red-team case `BLOCKED: grant rows carry a version`. ⚠ What is NOT there:
  nothing in production writes grants, and there is no HTTP route for it, so
  the 409 is a status on the error, not yet a response anyone receives.
- **Proposing apps come from an approved template catalogue (closed 2026-09-22,
  owner ruling 8 — see §8).** The planner is shown the approved templates and a
  `propose` route names one by id; `@spec`'s draft route has no key a field could
  be written in, so the model cannot write the fields a proposal carries. The
  translator turns the id into the template's `proposalKind`/`ticketField`/
  `fields`/namespaced `auditEvent` and refuses a missing, unknown or unapproved
  template, or a second route on the same one. The catalogue
  (`codegen/src/proposal-templates.ts`, moved from `pipeline/` in fix round 2) is
  seeded with `divergence` and
  `handoff`, taken from `contractRunSpec` and tested against it field for field.
  Each carries `approvedBy`/`approvedAt` plus a content hash, so editing a
  template after approval invalidates it. Read-only mini-apps are unchanged.
  The Cowork-workflow conversion (`packages/subapp/src/studio/conversion.ts`)
  is under the catalogue too (fix round 1): its old in-code `step` proposal
  (`ticket`, `step`, `note`) is now the catalogue's `step` template with
  `approval: null`, and the conversion resolves it like any other template.
  ⚠ Consequence to know about: until the owner approves `step`, a converted
  workflow files NO proposal. Its propose route and `write:inbox-proposal` are
  dropped with a warning naming ruling 8, its proposal steps show on the rail
  without an action, and a workflow whose every route would file a proposal is
  `rejected` by name. Approving `step` restores the previous output byte for
  byte (checked: same files, same warnings). See §8 for the choice.
  **Fix round 2: the catalogue is now enforced where every path meets,
  @codegen's `planSubApp`.** Before, it was checked only where Studio PRODUCES a
  spec (the prompt path and the conversion). The way into the host is neither:
  `scripts/promote.sh` step 3 runs `codegen/src/cli.ts --spec "$SPEC"` on any
  @codegen spec (`--spec -` is documented "for piping a model's output straight
  in"), and the workbench's `candidateFrom(spec)` takes any spec. A review took
  `contractRunSpec`, rewrote `/flag` to file a `salary-change` with `salary:
  number` and `employeeName`, and got exit 0, 8 planned files, `gate ok: true`,
  so a `studio-compliance-record/1` was within reach with no template approved.
  Reproduced here before the fix, then refused after it: the CLI now exits 2
  naming ruling 8, `generateSubApp` throws `SpecRejectedError`, and
  `candidateFrom` throws, so there is no candidate and no download. A `propose`
  operation is generated only when it is EXACTLY `proposeOperation(t, spec.id)`
  for an approved template `t` (same `proposalKind`, `ticketField`, `fields`,
  including bounds and order, and `<id>.<suffix>` `auditEvent`), and only one
  route may file each template. The refusal names the templates and the parts
  that differ and echoes nothing invented. Tests:
  `codegen/src/__tests__/propose-from-catalogue.test.ts` (both review probes,
  widened, narrowed, loosened, wrong audit event, unapproved `step`, duplicate
  template, and the test-only override), two CLI cases in `cli.test.ts` (file
  and stdin), and one `candidateFrom` case in `src/__tests__/wiring.test.ts`.
  A fence test pins which non-test files may pass the override
  (`proposalCatalogue`): `generate.ts`, `plan.ts`, and the conversion forwarding
  its own tests-only option.
  ⚠ Consequence: the table-backed `wcClockSpec` TS fixture filed its own `flag`
  kind (`ticket` plus optional `note`, the same two fields as `divergence`). It
  now files the approved `divergence` template, so its proposals are named
  `wc-clock-divergence-<ticket>-…` instead of `wc-clock-flag-…`. The JSON
  fixtures that `promote.sh`, `mount-in-host.sh` and `standalone-smoke.sh` read
  already matched the catalogue (wc-clock and shift-notes are read-only,
  contract-run uses `divergence`/`handoff` exactly). Checked: all three still
  dry-run with exit 0, and the red-team is still `7/7`.
  ⚠ What this does NOT cover, stated so nobody reads more into it:
  - **Hand edits in the workbench.** The conformance gate reads emitted TEXT and
    has no rule about proposal fields. A saved edit that adds a field to a
    generated propose route still passes the gate on the edited files, so the
    ruling-9 download can carry it with `gate.ok: true`. That download is for
    review only, and `promote.sh` regenerates from a SPEC, which is now checked.
    But the edited file itself is not re-checked against the catalogue.
  - **`shipSubApp` binds its record to a spec hash, not to the files.**
    `admitComplianceRecord` checks the record against the `specSha256` the
    CALLER passes. Nothing checks that `candidate.files` were generated from
    that spec. Today there is no production caller of `shipSubApp` (only tests
    and a doc example), so no path uses this. Whoever wires one should have it
    regenerate from the spec, or compare the files with a regeneration. See §8.
- **The workbench has a browser-only "Download candidate" (closed 2026-09-22,
  owner ruling 9, see §8).** It sits in the tab strip. It is enabled only when
  the conformance gate passes on the EDITED files (the saved overlay, re-gated
  in the browser) and nothing is unsaved or in conflict; the tooltip on the
  disabled button says which of those is the reason. It saves one JSON document,
  `studio-candidate-download/1`, holding the files as edited, the list of edited
  paths, and the gate verdict over exactly those bytes. The document says it is
  not a compliance record. It writes nothing on the server (a test scans
  `download.ts` for any request API), and it never writes into the host repo:
  `scripts/promote.sh` plus a compliance record remain the only path. The
  editor's `Save` is now labelled "Save in workbench", and its tooltip says it
  writes no file.
  ⚠ What is NOT there: `promote.sh` still regenerates from a SPEC, so a
  hand-edited candidate cannot yet be promoted as edited. The download is for
  review. Separately, the Gate tab still shows the verdict on Studio's own
  text; the verdict on the edited files appears only in the download button's
  tooltip and in the downloaded file. The tooltip therefore names the first
  failing error by rule, file and line (`FD-M003 server/subapps/wc-clock/
  manifest.ts:35 — …`, "(and N more)"), since no pane shows it. Showing the
  edited-files verdict in the Gate pane itself is the larger follow-up.
  The adapter that decides the verdict in the shipped app now lives in
  `src/wiring.ts` (moved out of `main.tsx`) and is tested against the real gate
  (`src/__tests__/wiring.test.ts`); before, changing it to `ok: true` left the
  suite green.

---

## 7. How the pieces fit

```
prompt
  └─ server/index.ts ........... the only file that constructs anything
       ├─ approvals ........... effectiveGrant, at intake, before a model call
       ├─ pseudonym ........... tokenise; the vault never leaves the frame
       ├─ guardrails .......... gateModelRequest → envelope
       │    └─ envelope ....... the only shape that may reach a model
       ├─ providers ........... Anthropic; harness records/replays
       ├─ spec ................ plan → a @spec document
       ├─ pipeline ............ translate-spec: @spec → @codegen   ← the bridge
       ├─ codegen ............. emit host half + standalone harness
       ├─ conformance ......... the sub-app contract; shipSubApp writes
       │    └─ compliance ..... the host's verdict, required to write
       └─ registry ............ approve once, reuse later; durable ledger
```

`packages/store` holds the shared file lock and atomic write, because approvals
and registry both need durability and neither may depend on the other.

⚠ **That diagram is a flow, not a dependency DAG — and the package graph is not
one.** `envelope` and `guardrails` import each other:

```
guardrails/src/gates.ts:64   → envelope/src/build.ts        (buildEnvelope)
envelope/src/build.ts:151    → guardrails/src/approval-pure (isNamedHuman)
```

At FILE level it is acyclic — `approval-pure.ts` imports only `./hash` — which
is why it loads. It is cyclic at PACKAGE level and deliberately so: the second
edge exists because there must be exactly ONE named-human rule (invariant 2
above), and importing it was judged better than a fourth copy. If you ever
reorganise these into enforced acyclic packages, that is the edge you will hit,
and the copy is not the answer.

---

## 8. Owner rulings implemented on this branch

On 2026-09-22 the owner, Karsten Haldan, was shown nine numbered decisions, each with a
recommendation. His reply, verbatim, was:

> "take your recommendations"

The nine-item list itself is not in this repository. So each **question** below is the
orchestrator's restatement as relayed to this branch, **not a quotation**. The reply is
quoted exactly. `memory/decisions.md` in the host is deliberately not edited here: the
orchestrator adds the D-entries at merge.

### Ruling 8: where a proposing mini-app's fields come from

- **Question (restated):** `@spec` names no field, and `@codegen`'s `propose` needs
  `proposalKind`, `ticketField`, `fields` and `auditEvent`. How should a proposing
  mini-app get the fields it writes into the review inbox?
- **Recommendation accepted:** proposing apps are generated only from a closed
  catalogue of proposal templates the owner approves. The model picks a template id and
  never invents the fields it writes into the review inbox. Seed the catalogue with
  templates derived from contract-run's existing `divergence` and `handoff` shapes.
  Each template carries an approval record (`approvedBy`/`approvedAt`), and generation
  refuses an unapproved one. Read-only mini-apps are unaffected.
- **Owner's reply, verbatim:** "take your recommendations"
- **Implemented:** `packages/codegen/src/proposal-templates.ts` holds the catalogue
  and the approval check (it was in `packages/pipeline/src/` until fix round 2). `packages/spec/src/templates.ts` defines the menu the planner
  is shown; the draft route gets a `template` field, the gates and prompt use it.
  `packages/pipeline/src/translate-spec.ts` resolves the template id into the operation
  and is where generation refuses. Tests:
  `codegen/src/__tests__/proposal-templates.test.ts` (moved with the module), `spec/src/templates.test.ts`,
  and the new blocks in `translate-spec.test.ts` and `build-subapp.test.ts`.
- **One addition beyond the letter of the ruling, stated so it can be vetoed:** each
  approval record also carries the sha256 of the template it approved. A name and a
  date alone would still "approve" a template whose fields were widened afterwards.
  With the hash, a widened template counts as unapproved until someone re-approves it.
- **Approval recorded on the two seeds:** `approvedBy: "Karsten Haldan"`,
  `approvedAt: "2026-09-22"`. The owner approved seeding these by accepting the
  recommendation.
- **Fix round 1 — the workflow conversion brought under the ruling.** Review
  found the ruling implemented more narrowly than it reads: the Cowork-workflow
  conversion (`packages/subapp/src/studio/conversion.ts`) still wrote a fixed
  `step` proposal in code, outside the catalogue, and this document had left that
  as an open question. The ruling already answers it: "proposing apps are
  generated ONLY from a closed catalogue of proposal templates the owner
  approves … generation refuses unapproved ones", and the owner's reply to it was,
  verbatim, "take your recommendations". So:
  - The conversion's shape is now the catalogue's `step` entry, transcribed field
    for field (`ticket` ≤64, `step` ≤48, optional `note` ≤500, audited as
    `<id>.step-proposed`), with **`approval: null`**. It is visible in review,
    left off the planner's menu, and never generated from.
  - The conversion resolves it through `resolveProposalTemplate` and builds the
    operation with the same `proposeOperation` the prompt path uses (moved into
    `proposal-templates.ts`). While it is unapproved, the propose route is dropped
    and so is `write:inbox-proposal` (least privilege: no consent line for a write
    the app cannot make), each with a warning that cites ruling 8. The review
    summary shows the capabilities the manifest actually declares. A workflow
    with nothing left to generate is `rejected` by name.
  - **Choice made, stated so it can be vetoed:** drop and warn rather than reject
    every workflow with a proposal step. The ruling says "refuses"; what is
    refused is the proposing ROUTE. The read-only rest of the app is still
    generated, the same way the conversion already drops routes it cannot serve.
  - **No new owner decision was taken here.** Two ways forward are the owner's:
    approve the `step` template (add an approval record to that entry; output
    returns to exactly what it was), or carve the conversion out of ruling 8
    explicitly.
  - Tests: the `step` block in `proposal-templates.test.ts`, and the ruling 8
    block in `subapp/src/__tests__/conversion.test.ts`, which also proves an
    approved `step` builds the route FROM the template and a widened one is
    refused.
- **Fix round 2: one reading, applied everywhere, which means @codegen.**
  - **Question (restated, as fix round 2 put it):** round 1 applied ruling 8 to
    the conversion by its literal text. Read the same way, does it also cover a
    @codegen spec that never went through Studio's producers? That is
    `scripts/promote.sh` → `codegen/src/cli.ts --spec` (also `--spec -`,
    documented "for piping a model's output straight in"), and the workbench's
    `candidateFrom(spec)`. Or does ruling 8 cover model-authored generation
    only?
  - **Ruling applied (the same ruling; no new one was sought):** "proposing apps
    are generated only from a closed catalogue of proposal templates the owner
    approves … generation refuses an unapproved one." **Owner's reply,
    verbatim:** "take your recommendations"
  - **Reading chosen: the literal one**, the reading round 1 used for the
    conversion. Two reasons. First, one rule read two ways is how the conversion
    ended up outside the catalogue in the first place. Second, the narrower
    reading does not close this path either: `--spec -` exists to take a
    model's output, so the CLI is a model-driven path under either reading.
  - **Where:** `planSubApp` (`codegen/src/plan.ts`, `checkProposalTemplates`),
    because every path goes through it: `buildSubAppFromPrompt`, the
    conversion, `cli.ts` (and so `promote.sh`, `mount-in-host.sh` and
    `standalone-smoke.sh`) and `candidateFrom`. The catalogue moved into
    @codegen as a leaf module. It imports only `guardrails/src/approval-pure`,
    `hash` and `sha256`, which import nothing that imports @codegen, and
    `pure-closure.test.ts` is still green with `zod` as the only bare specifier.
    @pipeline and the conversion import it from there.
  - **Choices made inside the ruling, stated so they can be vetoed:**
    - **Exact match, not "at most".** A route with a template's `proposalKind`
      but one field fewer, or a looser bound, is refused. A narrowed template
      is still a template nobody approved.
    - **One route per template, at codegen too.** The translator already refused
      this. Two routes on one template write proposals with the same
      `<app>-<kind>-` prefix, which the step rail cannot tell apart.
    - **`wcClockSpec` rebound to `divergence`.** It is a test fixture for the
      table path, not something Studio ships. Its `flag` route carried
      `divergence`'s exact fields under its own kind, so it now files the
      approved template. No new template was added or approved to keep `flag`:
      approving one is the owner's call.
    - **The override stays, tests only** (`GenerateOptions.proposalCatalogue`,
      `PlanOptions.proposalCatalogue`). It is the same pattern as
      `translateSpec`'s and `convertWorkflow`'s `catalogue` parameter, and it is
      needed so the approved-`step` conversion test can generate. A fence test
      pins the non-test files that may name it.
  - **Two open items for the owner, not decided here:**
    1. **Hand edits in the workbench are not checked against the catalogue.**
       The conformance gate reads emitted text and has no proposal-field rule.
       So the ruling-9 download can carry a hand-added field with `gate.ok:
       true`. It does not reach the host, because `promote.sh` regenerates from
       a spec. Should a person's hand edit to a proposal route count as
       "generation" under ruling 8, which would need a gate rule, or is that a
       review matter?
    2. **`shipSubApp` does not bind the files to the spec its record names**
       (§6). There is no production caller today. Deciding how a future caller
       proves "these files came from that spec" is outside ruling 8, but it is
       the other way an unapproved proposal could reach the host.

### Ruling 9: getting the edited files out of the workbench

- **Question (restated):** the workbench shows real generated source and a real
  gate verdict, but nothing can leave the browser. Its `Save` button reads like a
  disk write and only updates the in-memory draft. Should the workbench be able
  to export a candidate, and if so, how?
- **Recommendation accepted:** a browser-only "Download candidate" button. It is
  enabled only when the conformance gate passes on the edited files, it writes
  nothing on the server, and it never writes into the host repo (`promote.sh` plus
  a compliance record remain the only path). `Save`'s label and tooltip are
  clarified.
- **Owner's reply, verbatim:** "take your recommendations"
- **Implemented:** `src/workbench/download.ts` decides readiness, builds the
  document and does the browser save. `Workbench.tsx` takes the gate as an
  injected `checkFiles` prop and shows the button, and `main.tsx` passes in
  `src/wiring.ts`'s adapter over `runConformanceGate`. `EditorPane.tsx` has the Save relabel. Tests:
  `src/workbench/__tests__/download.test.ts` plus the new blocks in
  `components.test.tsx`. Also checked in headless Chromium against the dev
  server: the download fires with no network request; an unsaved edit disables
  the button; a saved edit that breaks the manifest (`navSection: "Mini apps"`,
  FD-M003) disables it with "The conformance gate fails on the edited files
  (1 error)".
- **Choices made inside the ruling, stated so they can be vetoed:**
  - The download is JSON, not a tree of files. A tree rooted at
    `server/subapps/<id>/` would be one `tar -x` away from a hand-install into
    the host.
  - It is also disabled while an edit is unsaved or a conflict is open. In
    either state the download would silently differ from what the panes show.
- **Fix round 1 — "enabled only when the conformance gate passes on the edited
  files", made true and tested.** The owner's reply is the same, verbatim: "take
  your recommendations". Review found three ways the implementation fell short
  of that sentence:
  - **The gate passed a manifest the host refuses to boot.** It called any member
    outside the Zod data "additive and ignored", which stopped being true at host
    42b0f308 (OS-04). A manifest carrying `contributions` (signing state, `/api/state`
    flags, background work handed the raw db) passed with zero findings, so the
    button enabled and the file said `gate.ok: true`. Now FD-M008 refuses
    `contributions` in any spelling, plus spreads and computed keys that could
    hide it. The typecheck stub types it `never`, and the mount probe refuses a
    manifest object that carries it at runtime. `manifest-members-drift.test.ts`
    reads the host's `SubAppManifest` and fails on any member the gate neither
    validates, requires nor refuses.
  - **The shipped adapter was untested.** `checkFiles` moved from `main.tsx` to
    `src/wiring.ts`, not into `src/workbench/`, which imports neither the
    generator nor the gate (`workbench/types.ts`). `src/__tests__/wiring.test.ts`
    runs it against the real gate through the real store. A saved
    `navSection: "Mini apps"` edit (FD-M003) and a saved `contributions` edit
    (FD-M008) each disable the button. `rulesRun` is the report's rules, not its
    checks. Changing the adapter to `ok: true` now fails two tests.
  - **The refusal named no error.** The tooltip said "(1 error) — fix them
    first", but the Gate pane shows Studio's verdict and listed nothing. It now
    names the first error by rule, file and line, adds "(and N more)", and says
    "it"/"them" by count (conflicts too).

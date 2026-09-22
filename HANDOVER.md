# Flightdeck Studio — handover

Everything below was **verified by running it** in the container this was built in,
unless a line says otherwise. Where something cannot be verified here, it says so
and says why.

- **Repo:** `https://github.com/pallefar/Flightdeck-code`
- **Branch:** `claude/gauntlet-loop-install-hp490e` — the only branch. There is no
  `main` on origin, so clone and stay on this one.
- **State:** 2309 tests, 0 skipped, 115 files, all passing against `project-contract`
  at `integration/unified-2026-09-22`; `tsc --noEmit` clean (2026-09-22, Mac).
  The one host-dependent failure is closed: the host's docusign manifest declares
  `contributions: docusignContributions` (host 42b0f308, OS-04), a member of
  `SubAppManifest` that `subAppManifestSchema` never validates — like
  `initSchema`/`registerRoutes`. The manifest reader now sets aside exactly the
  members the host's interface adds beyond the Zod data (drift-tested against
  `server/subapps/types.ts` in both directions), splits members by bracket depth
  rather than by line, and still throws on a computed data field, a computed
  unknown member, a spread or a shorthand.

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
npm test               # expect: 2309 passed, 0 skipped  — see the warning below
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
| `FLIGHTDECK_HARNESS_MODE` | no | — | `live` records fixtures, `playback` replays and fails on a miss. |
| `HOST_REPO` / `REPO` / `SANDBOX` / `SPEC` / `RECORD` | no | Linux paths | Used by `scripts/*.sh`. |
| `SUBAPP_<ID>_ENABLED` | per sub-app | — | Generated kill switch; `"true"` exactly. |
| `CODEGEN_DEBUG=1` | no | — | Stack traces from the codegen CLI. |

### 3.3 Scripts

| Command | What it does | Works here? |
|---|---|---|
| `npm test` | 2309 tests | ✅ |
| `npm run typecheck` | `tsc --noEmit` | ✅ |
| `npm run dev` | Vite, the workbench | ✅ |
| `npm run build` | `tsc -b` + Vite build → `dist/` | ✅ 553 kB bundle, 1.7s |
| `npm run dev:server` | the composition root | ✅ |
| `npm run redteam` | plants violations, all must block | ✅ `7/7` |
| `npm run standalone` | builds and smoke-tests each standalone fixture | ✅ |
| `npm run mount` | mounts a candidate into a host sandbox and diffs the suite before/after | ✅ +10 passing, +0 failing |
| `npm run promote` | **the production gate** | ❌ blocked — §1 |

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
  (`pipeline/src/proposal-templates.ts`) is seeded with `divergence` and
  `handoff`, taken from `contractRunSpec` and tested against it field for field.
  Each carries `approvedBy`/`approvedAt` plus a content hash, so editing a
  template after approval invalidates it. Read-only mini-apps are unchanged.
  ⚠ What is NOT covered: the Cowork-workflow conversion
  (`packages/subapp/src/studio/conversion.ts`) still builds its own fixed `step`
  proposal (`ticket`, `step`, `note`) in code. It is not model-authored, but it
  is outside the catalogue. Bringing it under would need a `step` template that
  the owner has not approved, so it is an open question for the owner, not
  something to fold in quietly.
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
  tooltip and in the downloaded file.

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
- **Implemented:** `packages/pipeline/src/proposal-templates.ts` holds the catalogue
  and the approval check. `packages/spec/src/templates.ts` defines the menu the planner
  is shown; the draft route gets a `template` field, the gates and prompt use it.
  `packages/pipeline/src/translate-spec.ts` resolves the template id into the operation
  and is where generation refuses. Tests:
  `pipeline/src/__tests__/proposal-templates.test.ts`, `spec/src/templates.test.ts`,
  and the new blocks in `translate-spec.test.ts` and `build-subapp.test.ts`.
- **One addition beyond the letter of the ruling, stated so it can be vetoed:** each
  approval record also carries the sha256 of the template it approved. A name and a
  date alone would still "approve" a template whose fields were widened afterwards.
  With the hash, a widened template counts as unapproved until someone re-approves it.
- **Approval recorded on the two seeds:** `approvedBy: "Karsten Haldan"`,
  `approvedAt: "2026-09-22"`. The owner approved seeding these by accepting the
  recommendation.

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
  injected `checkFiles` prop and shows the button, and `main.tsx` wires in
  `runConformanceGate`. `EditorPane.tsx` has the Save relabel. Tests:
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

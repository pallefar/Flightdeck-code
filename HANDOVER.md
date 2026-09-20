# Flightdeck Studio — handover

Everything below was **verified by running it** in the container this was built in,
unless a line says otherwise. Where something cannot be verified here, it says so
and says why.

- **Repo:** `https://github.com/pallefar/Flightdeck-code`
- **Branch:** `claude/gauntlet-loop-install-hp490e` — the only branch. There is no
  `main` on origin, so clone and stay on this one.
- **State:** 2207 tests passing, 0 skipped, 110 files, `tsc --noEmit` clean.

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
npm test               # expect: 2207 passed, 0 skipped  — see the warning below
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
default** — there are no hardcoded paths to edit:

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
| `STUDIO_OPERATOR` | **yes** | — | The named human who operates this Studio. Boot refuses a role, a service or an unset value. |
| `STUDIO_OPERATOR_TOKEN` | **yes** | — | Bearer secret, ≥24 chars. The only thing separating an anonymous request from the first-party path. |
| `ANTHROPIC_API_KEY` | for real calls | — | Read lazily; the server boots without it. |
| `PORT` | no | `8787` | |
| `STUDIO_HOST` | no | `127.0.0.1` | Loopback by default: this process holds a key and a secret. |
| `STUDIO_GRANTS_FILE` | no | `.studio/grants.json` | Durable approvals. Written `0600`. |
| `FLIGHTDECK_MODEL` | no | `claude-opus-5` | |
| `FLIGHTDECK_EFFORT` | no | `high` | |
| `FLIGHTDECK_HOST_ROOT` | no | `/home/user/project-contract` | **Set this on the Mac.** |
| `FLIGHTDECK_HOST_ABSENT_ACKNOWLEDGED` | no | — | Exact string `unverified-lists-accepted`. Only while the host repo is absent. |
| `FLIGHTDECK_HARNESS_MODE` | no | — | `live` records fixtures, `playback` replays and fails on a miss. |
| `HOST_REPO` / `REPO` / `SANDBOX` / `SPEC` / `RECORD` | no | Linux paths | Used by `scripts/*.sh`. |
| `SUBAPP_<ID>_ENABLED` | per sub-app | — | Generated kill switch; `"true"` exactly. |
| `CODEGEN_DEBUG=1` | no | — | Stack traces from the codegen CLI. |

### 3.3 Scripts

| Command | What it does | Works here? |
|---|---|---|
| `npm test` | 2207 tests | ✅ |
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
- **Grant rows are last-write-wins at the row level.** Two operators, one
  narrowing and one widening, and the narrowing is lost without a trace. Closing
  it needs a version on `GrantRow` and a compare-and-swap on the port; the *file*
  is already serialised with a lock. Tracked in
  `approvals/src/__tests__/redteam-attacks.test.ts` as `STILL OPEN`.
- **`@spec` cannot describe a proposing app.** The translator refuses a `propose`
  route because `@codegen` needs `proposalKind`, `ticketField`, `fields` and
  `auditEvent`, and nothing in a `@spec` document names a field. Read-only
  mini-apps work end to end today. Closing this means teaching the planner to
  emit field shapes — a change to the model contract, not a patch.
- **The workbench has no "export bundle" affordance.** It renders real generated
  source and a real gate verdict; there is no button to get the files out.

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

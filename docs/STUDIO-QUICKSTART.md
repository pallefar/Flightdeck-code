# Flightdeck Studio — quickstart

How a person gets **a sub-app** and **a workflow** out of Studio and into a
running Flightdeck OS, today, without a model key. Measured end to end on
2026-09-25 (branch `feat/p4h-studio` in both repos); the screenshots are in
`.shots/p4h/studio/` next to the repos.

Everything here follows ruling 8: Studio generates from the approved
catalogue and the spec, never free-form code. Hand-edited files never travel
into the OS; the **spec** does, and the OS side regenerates from it.

## 0. What you need

- This repo (Flightdeck-code) with its `node_modules`.
- An **OS worktree** (never the main checkout):
  `git -C <project-contract> worktree add <path> -b <branch> <base>`, with
  `flightdeck/node_modules` symlinked from a checkout that has them.
- For Studio's tests: `FLIGHTDECK_HOST_ROOT=<that OS worktree>`.

## 1. Start Studio

```bash
npx vite build
STUDIO_OPERATOR="Your Name" \
STUDIO_OPERATOR_TOKEN="<32+ random characters>" \
STUDIO_GRANTS_FILE=/some/private/dir/grants.json \
FLIGHTDECK_HARNESS_MODE=playback \
PORT=5140 npx tsx server/index.ts
```

Open `http://127.0.0.1:5140/`. Loopback only unless `STUDIO_ALLOW_REMOTE=true`.
`playback` answers model calls from recorded fixtures, so nothing reaches a
model; the no-model paths below do not call one at all.

## 2. A sub-app

1. **Type what you want** in the chat, e.g.
   `Show me the contract folders in an app called "Contract Desk"`.
   With no model, Studio picks the closest **starter** from the approved
   catalogue (`packages/codegen/src/starters.ts`: a read-only contract list,
   a hand-off desk that files proposals, a table-backed records log) and
   names it from `called "…"`. The request text itself is never emitted.
   Pasting a JSON spec instead uses that spec as written (spec-first).
2. Studio emits the source (server routes, guard, manifest with
   `generatedBy: "flightdeck-studio"`, the web page on the Atlas palette, a
   conformance test), runs the conformance gate and shows it: **Run**,
   **Files**, **Diff**, **Preview** (rendered against a mocked host, with the
   three enable layers as switches) and **Gate**.
3. Press **Download spec** (`<id>.spec.json`).
4. Mount it into your OS worktree:

   ```bash
   npm run mount:worktree -- --spec ~/Downloads/contract-desk.spec.json --host <OS worktree>
   ```

   `scripts/mount-into-worktree.sh` refuses a main checkout, regenerates from
   the spec with the codegen CLI, applies the registry patch (idempotent: a
   second run changes nothing), then runs the host's own proof with the gate's
   fences — the platform conformance kit, the app's own conformance test and
   `tests/subapps/studioGeneratedSubapps.test.ts` (off by default; the kill
   switch alone does not open it; an admin enable makes it answer 200).
5. Start that OS (SQLite; never set `POSTGRES_*`):

   ```bash
   cd <OS worktree>/flightdeck && npm run build:web
   PORT=4440 AUTH_REQUIRED=true WORKSPACES_ENABLED=true DATA_DIR=/some/dir \
   SUBAPP_CONTRACT_DESK_ENABLED=true npx tsx server/index.ts
   ```

   A generated app is **off by default** (D-036): the kill switch is yours to
   set, and nothing in a launcher sets it.
6. Sign in as a workspace admin, open **Library → Sub-app → Contract Desk →
   Enable**, pick the workspace, read the consent screen (it lists exactly the
   scopes the manifest declares) and **Approve & enable**. The app is at
   `/console/apps/contract-desk`.

## 3. A workflow

1. In Studio press **New workflow**. Describe it, e.g.
   `A workflow called "Equipment Request": staff ask for a laptop by a deadline, with an amount and an urgent flag`.
   Studio drafts a `studio-workflow-definition/1` file from the Workflow
   Builder's own step floor and field types (`@spec/workflow-starter`); the
   words pick intake fields, only `called "…"` names it.
2. Give **your name** and the **named person who decided the statutory
   steps** (even when there are none), and tick the statutory box only if a
   person decided there is one. The file is refused until both names are
   there; a model never decides a statutory step.
3. **Download workflow file** (`<slug>.workflow.json`). Nothing is sent
   anywhere.
4. In the OS: **Cockpit → ＋ New workflow → Import a Flightdeck Studio file**.
   The wizard checks the file (Studio-only keys dropped; unknown keys, a
   mistyped field, an unconfirmed statutory set and a missing author are each
   refused by name), shows it on the review step, and **Scaffold as proposal**
   submits the file's own steps to `POST /api/workflows` (admin RBAC).
   `boot.json` is never touched; a human applies the proposal in Cowork.
   **Back** on an imported review discards the import.
5. **Flow →** on the result switches the cockpit to the new process and opens
   the Flow board scoped to it (header `PROCESS: EQUIPMENT-REQUEST`).

## 4. With a model (not open yet — on purpose)

- `POST /api/studio/build` (operator token) runs the gated, pseudonymised
  planner. In `playback` with no recordings it reports the cache miss, never
  a made-up answer; `FLIGHTDECK_HARNESS_MODE=record` with a key records
  fixtures so later runs are offline.
- `POST /api/studio/workflow/draft` answers **409
  `approved_prompt_unavailable`** until a named human approves the
  `workflow-draft` text (`packages/spec/prompts/README.md` gives the
  procedure; wording is human-owned). With an approved text it still answers
  **501** until the gated workflow pipeline exists — it never calls a model
  around the input gate. The 409 names the no-model path above.

## 5. Tests

```bash
FLIGHTDECK_HOST_ROOT=<OS worktree> npx vitest run      # Studio, all
npx tsc --noEmit
# OS side (in <OS worktree>/flightdeck):
env -u POSTGRES_ENABLED -u POSTGRES_DSN AUTH_REQUIRED=false WORKSPACES_ENABLED=false \
  npx vitest run tests/studioWorkflowImport.test.ts tests/newWorkflowStudioImport.test.tsx \
  tests/subapps/studioGeneratedSubapps.test.ts
```

## Known limits

- The Flow board's lanes are the engine's fixed contract lanes
  (`web/src/steps.ts` `BOARD_LANES`), not the new process's own ladder; the
  board's rows and header are scoped to the new process.
- The OS New-workflow review step renders its label/value rows without a gap
  (`rail-row` inside the overlay) — pre-existing styling.
- A generated mini-app's page is English-only by design (no i18n keys, so
  mounting never moves the host's pinned i18n totals).

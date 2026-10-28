# Flightdeck Studio — portable continuation checkpoint

**Status: reviewed source is merged; the complete product is not accepted or deployed.**

This checkpoint supersedes historical test/state claims in the root `HANDOVER.md` for the October 28, 2026 Studio source-publication milestone. It is a source/continuation handover, not a certificate that the app works end to end.

## 1. What to clone

Repository: `pallefar/Flightdeck-code` on GitHub. Actual default branch: `claude/gauntlet-loop-install-hp490e` — do not assume `main`.

| Publication | Exact source | Merge |
|---|---|---|
| PR #1 — DNS callback correction and prior reviewed work | `004e7e4476b490eda810f7e5b3b6fcb285611c62` | `fa9ef7795e58f846d10b1c6f417d41f4e1ddb1f8` |
| PR #2 — 362-path UI/designer/shared/declaration/fixture batch | `2705628b6c3d6b3f4316446bfa326df995420603` | `11ed6a12e14297106fdbcea8549a1cab50fecdb9` |
| PR #3 — final atomic 20-path integration/consumer/checker batch | `4ffcd919bfd0b26c9b9bd790e4290553557f0bbd` | `e78947b3af754ac60650d9112d4f8f75c8e7399c` |

The reviewed product-source checkpoint is PR #3's merge, with tree `77a32d2b08a3d2df818efe47b034f41fed8f4284`. Later documentation-only commits may follow it. Read current remote refs and history instead of treating an old SHA as the permanent tip.

`public-source.json` binds 384 unique public source paths: 381 unique PR #2/#3 paths (the batches overlap at `package.json`) plus the three DNS-correction source/test/document paths. It is not the entire repository manifest and deliberately excludes private host source, machine state and raw evidence.

## 2. Start on another computer

Use a new checkout and authenticate independently. Do not copy another machine's tokens, `.env`, browser profile, private runtime volume or database.

```sh
gh auth status
gh repo clone pallefar/Flightdeck-code Flightdeck-code
cd Flightdeck-code
git switch claude/gauntlet-loop-install-hp490e
git pull --ff-only
python3 docs/continuation/2026-10-28/verify-source.py --repo .
```

The verifier is read-only. It checks both committed Git blobs and working files for the finite 384-path checkpoint and reports source identity, not behavior. If upstream legitimately changed one of those paths, stop and review the change; do not reset or overwrite newer work to obtain a match.

These clone/setup commands are portable guidance, not a claim that they ran successfully on the destination. The verifier itself is exercised against the source machine's pinned Git objects and finite source copy before publication of this handover.

### Dependency/build entrypoints — inspect before running

Root declares Node `>=20`; the retained isolated Linux evidence used Node 22.23.2 and pinned TypeScript 5.9.3. Use the committed lockfile, not fresh version upgrades. Root locked Vitest is 4.1.11 and Zod is 3.25.76. The editable designer has its own committed package/lock metadata; use one physical React peer tree, not a separately installed designer React copy.

The actual committed entrypoints are:

```sh
npm ci --ignore-scripts --include=dev --no-audit --no-fund
npm run typecheck
npm run check:designer
npm run build
npm test
```

**Do not run these as a blind acceptance recipe.** They are the source-defined commands, not a newly verified clean-install/full-suite result. Review lifecycle/native effects, exact dependency versions and all applicable test-family fixtures first. `npm test` is the full aggregator, not the 490-case focused gate. Historical broader/deadline/stronger-compiler retry caps are exhausted; this handover grants no new rerun. Ask for a separately bounded verification scope if required. No `--passWithNoTests`, assertions removed, narrower discovery, timeout inflation or fixture authority widening is permitted to manufacture a green result.

Root `prebuild`, `pretypecheck`, `pretest`, `pretest:vitest`, `predev` and `predev:server` build the canonical local `packages/studio-drafts` package. The root build regenerates `src/studio/designer` from `designer-source`, then runs TypeScript and Vite. Use `designer-source/README.md` and `REDISTRIBUTION.md`; do not hand-edit generated JavaScript/declarations/notices or invent a broader OS license.

### Local development is not deployment

The source's Vite server defaults to port 5180; `/api` proxies to `localhost:${PORT ?? 8787}`. `dev:server` starts the backend. Those source defaults do not establish any running service or credentials on a new machine. Inspect owned local configuration before starting servers; do not point a new clone at another project or production state by accident.

Do not run `mount`, `promote`, `standalone`, release scripts, Docker lifecycle, migrations or provider requests from this handover. Those have separate prerequisites and authority.

## 3. Architecture and implemented source boundaries

- `src/main.tsx` mounts the Studio UI. `src/studio` contains the conversation-to-authoring shell, provider setup, reusable designer host and workspace state. Stacked/vertical workflow authoring and responsive CSS are included in source.
- `designer-source` is the editable finite designer source projection; `src/studio/designer` is its generated output/declaration/notice closure. It reuses reviewed native PageDoc, editor history/savepoints and widget seams, not an arbitrary private host checkout.
- `packages/studio-drafts` is the canonical reusable package. Legacy workflow/guardrail/server entrypoints forward to its exports. Its browser DTO/session edge and server store have distinct dependency/authority boundaries. It is not a second identity database.
- `test-helpers/runtime-import-closure.ts` reads source as data and tracks runtime/source counterpart obligations, including late package contexts and conflicting mappings. `runtime-syntax-policy.ts` implements the finite known-capability policy; it is not a general JavaScript sandbox, taint engine or exhaustive unknown-global ban.
- Provider setup, local save, grading and route selection are not execution or spending authority. Local draft persistence is not native OS persistence or real implementation progress.
- Native identity, exact project-scoped grants, host artifact/progress records and real sign-in belong to the separate private host. That repository and its private metadata are not part of this public documentation set. Obtain the owner's private handover independently.

## 4. Verification: actual scope, not overlapping totals

| Evidence | Result | Limit |
|---|---|---|
| Final focused source candidate | 490 unique PASS =473 retained+17 additive, six disjoint same-source batches | Not a complete ordinary/default suite |
| Helper strict program | Exit 0 on final source | Not whole-host or alternate-compiler-option acceptance |
| Wrapper correction TDD | 9 expected failures →0, same paired test bytes | Retained historical execution, not new tests in static review |
| Enum correction TDD | 6 expected failures →0, same paired test bytes | Finite ordinary emitted binding/default-option policy |
| Final static staged review | PASS, security/logic/dependency/rights/composition lists empty | Source-only, under the exact exception below |
| PR #3 remote readback | Exact20 PR paths and20 complete blob bodies hashed;361 earlier paths preserved | Not a physical image or browser/service attestation |
| Last complete ordinary gate | 5,026 PASS /74 FAIL /304 files /0 skips | Earlier source/fixture epoch, not re-run after final source |
| Earlier Docker/designer families |44/44 and24/24; earlier production build exit0 | Separate retained epoch, not current release acceptance |

Do not add these overlapping records together or report 490 as a new whole-suite total. Earlier full329 failures, compiler exit2, native54 execution-scope FAIL/effects UNKNOWN, two broader OOM attempts, stronger UI compiler heap failures, deadline causes UNKNOWN and provenance/fixture incidents remain unwaived. Source publication does not erase them.

No CI checks were configured on the three Studio publication PRs at verification. `gh pr checks` returning “no checks reported” is not green CI.

### Exact historical evidence exception

The rights holder explicitly accepted ONLY the missing post-module-membership receipt for the initial wrapper-RED host interpreter. A host reader misclassified92 skipped registrations and raised after exact guest cleanup, before recording that one after-membership. Actual raw148PASS/9expectedFAIL/92SKIP, before-physical/source/config/input/export/lease/cleanup records survive. All seven final-source execution epochs have complete postmembership.

The missing contemporaneous receipt remains absent; it was not reconstructed or rerun. Original author and technical independent review `passed:false` reports remain immutable. A new finite source-eligibility decision was made under the explicit exception, not by relabeling the old contract satisfied. No other failure, gap, budget, source guard or publication check was waived.

Hash bindings:

- Final source manifest: `01175947761be027e9871b5d266ef7e82d4fe44dc35575f5bb9c87d7311fcf01`.
- Author seal: `d9756ed32d57b91c5994e6cafbba944b1fd11c3dcfbc5c5e73375bea43195458`.
- Technical source review seal: `a2f0a4d4d59a89fd49b69956cf6332445092a964437c6ff7c10247ece5ae1a2b`.
- Final staged review seal: `a40ab3c3bb5a168c794a664ebe462244109f979e510f47525142e6d7039018bb`.
- Final staged report: `0578f58e1f56419261b7d96a94f95277f64131f90266f28ae9828aea43fe00cd`.

Raw evidence is not in public Git. Hashes identify retained local evidence; they do not make it downloadable or prove that the destination has it. Use the sanitized verification summary and request a separately reviewed private transfer if raw records are necessary. Never bulk-publish scratch.

## 5. What is still unfinished

1. Establish the exact fresh checkout/dependency/fixture baseline. Review the old failed default cases and the current normal runner. Request bounded new verification authority where old caps forbid replay; do not claim historical isolated greens establish a clean fresh clone.
2. Complete the real native owner/mount and canonical sign-in/project context integration. Preserve workspace/project/action/epoch checks, default deny and literal opt-in. Do not invent principals, match identity by display/email, derive grants from UI roles or enable dormant routes.
3. Trace an authenticated new-project→Studio handoff, versioned draft CAS/readback, actual native artifact writer and genuine project implementation progress. Local save, a launcher link or an artifact-shaped DTO is not that round trip.
4. Revalidate merged UI/browser behavior and target widths with real fixture ownership. Native style/typeahead acceptance was not reached; source-only harness repairs are not a product pass.
5. Establish exact image/build/backup/rollback/monitoring prerequisites before private staging promotion. Existing staging was not deployed by this source publication. Preserve private files/volumes and refuse automatic retries after uncertain effects.
6. User performs canonical sign-in, enters a real Anthropic key only in-app, explicitly selects a model and reviews/sends the first provider request. No agent clipboard/key/token export, repeated declined vault prompts, automatic send or fixture production principals.

The owner's product goal remains Flightdeck-native Atlas layout/theme, reusable components and AppDesigner across workflow modules/SDK apps/Companion/project pages, a visible stacked workflow, discovery→ROI→PRD→blueprint→validated artifacts, user grading and deterministic model routing. Treat desired behavior as requirements, not verified delivery.

## 6. Safe continuity and rollback

- Clone reviewed source; do not copy running process state or mutate the source machine as cleanup.
- A Git clone transfers committed source only. It does not transfer local scratch, cached packages, app secrets, private volumes, Hermes skills, session history or a localhost memory bank.
- Hindsight checkpoint writes were mixed success/failure; the last publication writes failed. Bank name `shared` and a loopback endpoint on one machine do not establish destination access or synchronization. This document and `CONTINUE.md` are the fallback, not an “all memories transferred” claim. Do not expose a private bank anonymously or include credentials in a migration bundle.
- Git rollback, image rollback and private-data recovery are separate. Never force-push/reset default branches to old checkpoints. Any rollback of a running stateful app requires a reviewed compatible backup and explicit deployment authority.
- Protected original header tests and copies were deliberately unread/unstaged; the verifier's manifest must not be broadened to inspect them.

Use the paste-ready [continuation prompt](CONTINUE.md) on the new machine. This is enough to resume safely from the merged Studio source milestone without pretending full product acceptance.

# Getting a generated mini-app into production

Studio does not define compliance for Flightdeck OS. Flightdeck already did, in
`scripts/gate.sh`, and this is how a generated mini-app submits to it.

## The promotion path

```
workflow → spec → generated → conformance → approved → GATE GREEN → production
                                              ▲            ▲
                                    named human       the host's own
                                    per project,      five-stack gate
                                    per datasource    with the app mounted
```

`npm run promote` runs the whole thing and writes a compliance record.

## What actually gets run

| # | Stack | Whose |
|---|---|---|
| 1 | Studio typecheck + test suite | ours |
| 2 | Conformance red-team — planted violations must all block | ours |
| 3 | Generate the mini-app and apply the registry patch | ours |
| 4 | `npm run build:web` — three standalone tests measure the real bundle | host's |
| 5 | **`scripts/gate.sh` — all five host stacks, app mounted** | **host's** |
| 6 | Compliance record | ours |

Stack 5 is the load-bearing one. Everything above it is Studio checking itself,
which proves nothing about the host. Stack 5 is:

```
[1/5] contracts/ PII boundary check   check-contracts-boundary.sh --tracked
[2/5] flightdeck vitest suite         AUTH_REQUIRED=false WORKSPACES_ENABLED=false
[3/5] Postgres tier                   SKIPS unless Supabase is reachable
[4/5] npm run typecheck
[5/5] Python engine eval              processes/contracts-de/engine/eval/run_eval.py
```

## A skip is not a pass

The host's gate says it plainly, and this is the single rule the promotion
record exists to enforce:

> ⚠ A SKIP IS REPORTED, ALWAYS. A green gate that quietly exercised one engine
> fewer than it looks like it did is the thing this file was just changed to
> stop being possible.

So `promote.sh` has three outcomes, not two:

| Outcome | Meaning | Exit |
|---|---|---|
| `READY FOR PRODUCTION` | every stack ran **and** passed | 0 |
| `NOT CERTIFIED` | all run stacks green, but some were **skipped** | 1 |
| `BLOCKED` | a stack failed | 1 |

`NOT CERTIFIED` is the interesting one. Stack [3/5] skips whenever Supabase is
not up — which is most of the time in a container — so a run that looks green
has not exercised the Postgres tier at all. The record writes
`readyForProduction: false` in that case, and the verdict string says why.

## The compliance record

`studio-compliance-record/1` — what ran, what passed, what was skipped, the
spec's sha256, and a verdict. It is the artifact a human signs, and the reason
it carries the skip list is that a signature over a partial run is the failure
mode worth designing against.

Two properties, both deliberate:

- **`readyForProduction` requires an empty failed list AND an empty skipped
  list.** Not "no failures".
- **The spec's sha256 is in the record.** A record certifies the exact spec it
  ran against. Changing the spec invalidates it, the same way changing a tool's
  content invalidates its approval in `packages/approvals`.

## The provenance sidecar

`studio-provenance/1` (`packages/compliance/src/provenance.ts`) says what a
promoted candidate is and where it came from. `promote.sh` writes it as
`PROVENANCE.json` in the run dir and in the sandbox's app dir
(`flightdeck/server/subapps/<id>/PROVENANCE.json`):

```
{ schema, recordSha256, studioCommit, hostHead, catalogueEntryId,
  subject: { subappId, version, treeSha256, hostFiles: [{ path, sha256 }] } }
```

- **A sidecar, not a manifest field.** A field inside the tree would make the
  tree hash cover the file that states it. `treeSha256` covers the app dir
  and leaves out only its root `PROVENANCE.json`. The generated manifest
  carries no provenance.
- **Host files are listed.** Codegen also changes files outside the app dir:
  the registry patch, the web module and the host test. Step 3b lists each
  one with its sha256, from `git status` in the sandbox against the host's
  HEAD. A changed host file that codegen did not declare fails the
  `provenance-subject` stack, and so does a deleted one.
- **Bound to the record by digest.** `recordSha256` is the sha256 of the
  record's RFC 8785 (JCS) canonical form (`recordDigest`, with JCS
  implemented in `jcs.ts` and pinned by the RFC's vectors). It is not the
  file's bytes, so re-indenting the record does not change it.
- `studioCommit` is captured before step 1 (`provenance-cli.ts
  studio-identity`), before the suite, the red-team and codegen run. It ends
  in `-dirty` when the Studio checkout had local changes then, and keeps that
  marker even if the changes are reverted before the seal. The seal refuses
  if the checkout moved to another commit, or went from clean to changed,
  during the run. `catalogueEntryId` comes from `CATALOGUE_ENTRY_ID` and is
  `null` when the spec came from no catalogue entry.
- The seal re-hashes the subject in the sandbox. It also runs `git status`
  there again, so a host file that was unchanged at step 3b and changed
  later (by the build, a test or a concurrent edit) is found. It refuses if
  the candidate, any other host file or the host HEAD moved after step 3b.
  The sandbox HEAD must still be the host commit captured with the subject,
  and changes are taken against that commit, so a host edit committed inside
  the sandbox during the run is found too (`sandbox-head-moved`). Only the host's named runtime artifacts, which the gate rewrites, are set
  aside: `app/BRAIN-INDEX.md`, `app/skills-index.json`, `audit/*.jsonl`,
  `subapps.json` and `memory/proposals/brain-lint-*.md`, each matched
  exactly (`isHostRuntimeArtifact`). A failed seal cannot appear in the
  record it digests. Instead the record is rewritten as failed
  (`provenance-seal` in `failed`, `readyForProduction: false`) and the run
  blocks. `shipSubApp` admits on the record alone, so a blocked run must not
  leave a green record behind.

Who ran the checks is not proven by this file. The cosign attestation over
it is `upd-studio-attestation`.

## Not `set -e`

`promote.sh` uses `set -uo pipefail`, never `-e`, copying `gate.sh`'s own
reasoning: every stack must be attempted and aggregated rather than stopping at
the first failure.

This is not theoretical. An earlier version of `scripts/mount-in-host.sh` died
under `set -e` when `vitest` returned non-zero — which is its *normal* exit when
any test fails, and comparing runs that contain failures is that script's entire
purpose. The outer pipe rewrote the exit code to 0, so it reported success while
having run nothing. A gate that cannot fail is not a gate; a gate that dies
before reporting is worse, because it dies looking green.

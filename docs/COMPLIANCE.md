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

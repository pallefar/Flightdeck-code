# Gauntlet results
The bar is [`stackblitz-labs/bolt.diy`](https://github.com/stackblitz-labs/bolt.diy). A piece
is done when a critic with fresh context picks ours over it blind.

## Round 1 — 4/4, and not trustworthy

Every piece won on the first round, and every critic reported it could tell which side was
which. Three reasons the sweep is not a result:

1. A first-round sweep is the failure the skill names outright: *a bar that is too easy makes
   the loop exit on round one*.
2. Three of four critics cited the same bolt.diy file, `action-runner.ts` — convergence on one
   weak spot, not four independent comparisons.
3. **The bar was under-scoped, and that was a harness bug of mine.** I named individual
   counterpart files rather than whole subsystems:

| Piece | Ours | bolt.diy | |
|---|---|---|---|
| `spec` | 16 files | 40 files | fair |
| `codegen` | 26 | 5 | lopsided |
| `workbench` | 31 | 8 | lopsided |
| `conformance` | 28 | 2 | not a comparison |

For `conformance` the bar was two files, because bolt.diy has no conformance gate at all.
Declaring victory there is a category error.

## Round 2 — the neutral re-judge

Four corrections: criteria written by an agent that had seen only bolt.diy and did not know it
was writing for a comparison; the bar given its full surface; sides swapped so position bias
shows as a flip; critics required to steelman the mature side *before* picking, carrying an
explicit prior that real users outrank a tidy test suite.

**Result: 1 held, 3 flipped to the bar.**

| Piece | R1 | R2 | Confidence | Scope fair | Blinding held |
|---|---|---|---|---|---|
| `spec` | ours | **ours** | medium | no | no |
| `codegen` | ours | **bar** | medium | yes | no |
| `conformance` | ours | **bar** | medium | yes | no |
| `workbench` | ours | **bar** | high | yes | no |

The blinding failed on every piece in both rounds. Identifiers give it away instantly —
bolt.diy carries `boltArtifact`, `bolt-elements-*`, `@webcontainer/api`; ours names Flightdeck
in every file. Real blinding is not achievable when the code states its own target. The
round-2 maturity prior and steelman step exist to push against that bias rather than pretend
it is absent.

## What the three reversals actually said

### `codegen`

> B never attempts the executing half of the problem — no command execution, no incremental input, no project representation — so on criteria 2, 3's side-effect clause and 6 it can only be credited for the hazard not arising, which is weaker evidence than A's locatable mechanisms.
> 
> The sharpest concrete defect, though, is in the one place B does touch disk. `cli.ts`:
> 
> ```js
> for (const file of generated.files) {
>   const abs = path.join(outRoot, file.path);
>   fs.mkdirSync(path.dirname(abs), { recursive: true });
>   fs.writeFileSync(abs, file.contents, "utf8");
>   console.log(`codegen: wrote ${file.path}`);
> }
> ```
> 
> No try/catch, no staging directory, no rename-into-place. B's entire safety story is "validate exhaustively in memory, then commit" — and the commit is the one unguarded step. An EACCES, ENOSPC or a read-only path on the 4th of 8 files leaves a half-mounted sub-app on disk (manifest and guard present, routes and schema missing), exits with a raw Node stack trace — violating this very file's stated doctrine of "refuse with an exit code and a named reason rather than a stack trace" — and the rerun that should fix it is then refused by the clash check unless the operator reaches for `--force`, which is also the flag that blows away hand-edits. For a design whose claim to criterion 1 and criterion 5 rests on atomicity, the batch is not actually atomic. A staging dir plus a final move, or a try/catch that reports which files landed, would have closed i

### `conformance`

> A never executes, compiles, or typechecks the code it approves — so its gate answers "does this conform to the Flightdeck contract?" and cannot answer "does this work?". A generated sub-app with a type error, a null-deref, or a wrong SQL column passes A's gate with zero findings and then breaks the host build or fails at runtime. There is no `tsc`, no lint, no run, no sandbox, and no second opinion anywhere in the 28 files; everything is synchronous textual analysis. Compounding that, the write path that is supposed to consume `assertShippable` is not present in the supplied scope, so the gate's actual blocking power is asserted in comments rather than demonstrated in code — whereas B's WebContainer execution and build-then-throw path visibly have teeth.
> 
> A secondary gap: A's design is non-transferable by construction. Every rule derives from one host's contract (`SUBAPP_ID_RE`, `subapp_<id>_`, `require<Id>Enabled`, the nine-module leaf allowlist). That is the right answer for that target and A argues the point well in `gate.ts`, but it means A has no answer at all for a builder whose target is an arbitrary web app — which is the general form of the problem posed.

### `workbench`

> B has no control surface and no observation surface — only review. There is no editor, no save, no revert, no stop, no dirty tracking anywhere in the codebase (grepping for edit/save/stop/abort/revert/dirty across all of B turns up only the chat composer's textarea and the preview's enable checkboxes). So criterion 6 is absent outright: a user who watches the generator produce something wrong cannot touch the files, cannot cancel the round, and cannot undo it — the only recourse is another prompt. Paired with that, criteria 1 and 4 are absent for the same structural reason: B's unit of work is an entire round with a single `busy` flag, so there are no per-step states to render, and B executes no processes, so there is no output to stream. A has all three, and the locking subsystem in particular is a deliberate, persisted answer to "the agent wrote the file I'm editing" rather than a last-write-wins accident.

## What bolt.diy got wrong

The round-1 critics independently found a real defect worth reporting upstream: `#runFileAction`
catches a failed `webcontainer.fs.writeFile`, logs it, returns normally, and lets `#executeAction`
mark the action **complete** — a green check in the UI for a file that was never written, with a
subsequent build running against a tree missing that file.

---

## Round 3 — the defects fixed, judged on the same criteria

Each builder was handed its critic's finding as a bug report, fixed it, and faced the same
neutral criteria again. **1 of 3 now picks ours.**

| Piece | R1 | Neutral re-judge | After the fix | Scope fair? |
|---|---|---|---|---|
| `codegen` | ours | bar | bar (medium) | **no** |
| `conformance` | ours | bar | **ours (high)** | yes |
| `workbench` | ours | bar | bar (medium) | **no** |

### Every named defect was verified closed — in code, not comments

The question put to each critic was deliberately hostile: *closed, partially closed, or papered
over with comments rather than code?* All three answered closed, and none took our word for it.

- **codegen** — *"Closed, and closed properly… I checked for the failure mode where closing a
  defect introduces a worse one, since 990 lines and 38KB of file arrived to fix a 5-line loop.
  I did not find it."* The named disaster now has a test using a real temp dir and a real
  `ENOTDIR`, not a mock.
- **conformance** — *"I verified it by execution, not by reading. I ran it:
  `vitest run packages/conformance/src/verify.test.ts` → 25 passed, 13.7s of real wall clock."*
- **workbench** — *"The round-1 grep no longer reproduces: `editFile` 19 hits, `saveFile` 12,
  `revertFile` 4, `requestAbort` 7, `conflict` 112 … and they are not veneer."*

### The one that won, won properly

`conformance` is the only result in this run worth standing behind: neutral criteria, full bar
scope (`scopeFair: true`), sides swapped, maturity prior explicitly applied — *"I applied the
maturity prior and A still wins"* — at high confidence, verified by execution.

The best detail is a refusal: if process isolation is unavailable, the sandbox reports
"could not run" and **refuses**, rather than downgrading to unsandboxed execution. A check that
quietly becomes a no-op is the failure this whole project kept catching.

### Why the other two still lose, and what that actually means

Both losses carry `scopeFair: false` — **the critics themselves flagged the comparison as uneven.**

The pattern is the same in each. We now win the axis the two codebases genuinely share, and lose
on axes that require executing arbitrary code in a live runtime:

- **codegen** — *"on the one axis both codebases actually share — putting bytes on disk — B is now
  decisively better and A is the weakest code in either tree."* And: *"If the question were
  narrowed to 'which write path would you put a user's git repo behind,' the answer is B."*
  It lost on streaming, command execution and live project state — none of which a batch generator
  targeting a compiled host has.
- **workbench** — the critic scores ours ahead on **4 of 7** criteria and calls criterion 6
  (intervention and conflict handling) *"the best work in either codebase"*. It loses 5 and 7,
  both of which need a WebContainer-class runtime.

So the honest conclusion is not "we win" or "we lose". It is that criteria derived from bolt.diy
reward a capability class — running arbitrary web apps live in a browser — that Flightdeck Studio's
target deliberately excludes. A Flightdeck sub-app is Fastify routes compiled into a host; there is
nothing to stream into a WebContainer.

The one piece where the two problems genuinely coincide — *stop a person shipping broken code* —
is the one we won, at high confidence, on a fair comparison.

### On stopping here

The prompt said loop until the critic picks ours, with no round count. Two of three pieces are
still short of that. They are not stopping because a cap was hit; they are stopping because the
remaining gap is a deliberate architectural difference, and closing it would mean building a
WebContainer-equivalent for a target that compiles into a Fastify host. That is a product decision,
not a build task, and it belongs to whoever owns the roadmap.

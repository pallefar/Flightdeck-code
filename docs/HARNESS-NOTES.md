# Harness notes — what Open Scaffold gets right that we don't

Source: [`Open-Harness/open-harness`](https://github.com/Open-Harness/open-harness) ("Open Scaffold"),
MIT, TypeScript. *"Build AI workflows you can test like software."*

Read because this project has two AI workflows in it — Studio itself (prompt → spec → code)
and the gauntlet loop that judges Studio — and both have the same testability problem.

## 1. Record once live, replay forever

Open Scaffold's core move: every action in a workflow is an immutable event, and providers run
in one of two modes.

| Mode | Behaviour |
|---|---|
| `live` | call the real API, record the response |
| `playback` | replay the recorded response — no API call, no cost, deterministic |

> The recorder captures the exact stream events from the provider, so playback is
> indistinguishable from live execution.

**What we do instead, and why it is weaker.** `packages/spec/` already injects the model
(`PlannerLlm`) so the planner is testable without a network, and `test-support.ts` supplies
`fakeLlm(...replies)`. That is the right instinct, but the fixtures are *invented strings we wrote*.
Recorded fixtures are *real provider responses*, so they carry the failure modes we would never
think to write down: truncation mid-token, stray markdown fences, whitespace that breaks a parser,
a reply that is valid JSON but semantically wrong.

Our own planner already has code for three of those (`json.ts`'s depth-aware scanner,
the `truncated` flag, `buildRepairPrompt`). Those paths are currently tested against
hand-written approximations of the thing they defend against.

**Adoption**: keep `PlannerLlm` as the seam, add a recording implementation that writes real
completions to a fixtures directory and a playback implementation that reads it. The seam already
exists; only the two implementations are missing.

## 2. The harness is a variable, and it must be controlled

This matters more than the first point, because we learned it the hard way.

The gauntlet judged the same four packages twice:

| Run | Code | Harness | Result |
|---|---|---|---|
| Round 1 | identical | mine: my criteria, bar under-scoped, fixed sides | **4/4 ours** |
| Re-judge | identical | neutral criteria, full bar scope, swapped sides, maturity prior | **1/4 ours** |

The code did not change between those two runs. So the flip isolates the harness: round 1 was
measuring my harness, not the work. That is a clean result, but we only got it by paying for a
second full run and noticing the first looked too good.

With recorded judgments we could have replayed one judge against different code — holding the
harness fixed — and different judges against the same code, and attributed the difference
immediately instead of retrospectively.

Round 2 deliberately holds the harness fixed and changes only the code, which is the other half
of the experiment. Both halves should be replayable, and currently neither is.

## 3. Worth considering: don't hand-roll the loop

`apps/harness-loop` is a small task-execution loop built on their `agent()` / `workflow()` /
`phase()` primitives, with observer callbacks (`onStateChanged`, `onTextDelta`,
`onAgentCompleted`) and typed agent output via Zod.

Our gauntlet is a hand-written script. It worked, and it found real defects — but its two bugs were
both harness bugs, not model bugs: an under-scoped bar, and criteria I wrote myself. A harness with
recorded runs and a comparison mode would have surfaced both sooner.

Not a recommendation to adopt the dependency today. A recommendation to stop treating the judging
harness as throwaway scaffolding around the real work, because in this project it repeatedly *was*
the thing that decided the answer.

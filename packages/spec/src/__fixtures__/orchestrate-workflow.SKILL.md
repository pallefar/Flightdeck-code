---
name: orchestrate-workflow
description: >
  Drive an employment contract through its country-specific workflow step-graph by reading and updating its
  on-disk folder and manifest.json; idempotent and resumable across human and RPA hand-offs. Use as the top-level
  controller for processing a contract from intake to finalize, and whenever resuming an existing contract folder
  to work out what has been done, audited, and approved and what the next allowable step is. This is the engine's
  conductor — start here for any "process this contract" or "what's next for this contract" request.
---

# orchestrate-workflow

## Why
The folder is the on-disk projection of the workflow state, which is what makes hand-offs (human, skill, or RPA)
clean and resumable. This skill is idempotent: hand it a folder and it figures out where things stand.

## Inputs
- A contract folder under `contracts/{ticket}_{person}/` with `manifest.json` (template at `contracts/_TEMPLATE/`).
- The relevant country pack.

## Procedure
1. **Read state** — load `manifest.json`; see which artifacts exist in `input/ works-council/ offer-letter/
   contract/ audit/` and which steps are done / audited / approved.
2. **Validate consistency** — confirm the draft was generated from the `input/` present and the pinned template
   version; reconcile the folder against canonical memory and **flag divergence** (never silently trust the folder).
3. **Enforce the step-graph as gates** — follow the pack's `stepGraph`. Never advance out of order, never
   self-approve, never skip a statutory step (DE works council; fixed-term wet-ink issuance).
4. **Run the next step** by delegating to the responsible crew agent (mapping: `kernel/agents/agents.json → stepIndex`):
   Lineal(scopeGate) → Trichter(resolve-context) → Paragraf(apply-clause-logic) → Klammer(assemble-contract) →
   Lupe(quality-check) → human review → (DE) Wecker-supported works council → offer letter → approval → Stempel(finalize).
5. **At every hand-off that needs a human**, Glocke drafts the ping via `notify-teams`.
6. **Update state** — write each transition to `manifest.json` (actor, time, version) and to canonical memory.
   **Agent attribution (mandatory):** every executed step records `agent` + `agentVersion` (pinned from
   `kernel/agents/agents.json` at execution time) in the manifest step entry AND in its audit event
   `{step, agent, agentVersion}`. Human judgments record `by`/`decidedBy` = named human, `agent` stays the
   preparer or null — humans are never "agent"; agents never appear as approvers.

## Operating modes (the autonomy slider)
- **assisted** (default): every step human-reviewed.
- **semi-agentic** (graduated per scope): auto-advance non-statutory steps on green checks; sample + handle flags.
- A scope graduates after >=50 consecutive zero-rework contracts AND 100% test-pass; any single rework rolls it
  back to assisted. Statutory steps and EXCEPTION-routed contracts never graduate.

## RPA boundary
RPA/automation may set a file "present", move documents, or fetch input — but only an authenticated human (via
their identity) may set "audited" or "approved". Bots write facts, not judgments.

## Guardrails
- Memory is canonical; the folder/manifest is the operational interface.
- Pin versions at generation; only a controlled re-baseline regenerates an in-flight contract (resets approvals).


## Honors the per-step review policy + audit (always)
At each step, read the project's `reviewPolicy` (see the `review-policy` skill):
- `review: on`  → pause and route to a human (Teams ping); advance only after approval.
- `review: off` → proceed automatically.
Either way, append an **audit** event for the step (actor = skill or authenticated user, mode = auto|assisted,
inputs ref, output/diff, gate result, decision, reason). Hard-guardrail steps are always `on` regardless of policy.

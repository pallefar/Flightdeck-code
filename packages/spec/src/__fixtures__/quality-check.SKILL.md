---
name: quality-check
description: >
  Run the hard quality gates on a draft employment contract: completeness, country-specific mandatory-content,
  template diff, and (for bilingual packs) translation parity. Use before any draft enters human review or
  advances a workflow step, and block advancement on any failure. Also used at release time to run a pack's
  full test-case library before a template/rule change ships.
---

# quality-check

## Why
These gates are what keep a fallible generator from shipping a non-compliant contract. They are HARD gates:
a failure blocks advancement and routes back with specifics.

## Per-contract checks (runtime)
1. **Completeness** — every required field populated; no leftover placeholders.
2. **Mandatory content** — every item in `processes/contracts-de/packs/<COUNTRY>/mandatory-content.md` is present, checked against the
   **governing-language** version (German for DE). A missing statutory term fails the gate.
3. **Template diff** — surface every deviation from the approved template and which clause decisions were applied.
4. **Translation parity** (bilingual packs) — the DE and EN versions must not diverge.

Record each result in `manifest.json` under `steps.qualityGate.checks`. On any failure, set the contract to
"needs-input" / "send-back" with a specific, actionable message.

## Per-pack checks (release time)
Run the pack's `test-cases/` library. The pack (or any template/rule change) must pass before shipping; a
deliberately broken template or a deliberately missing statutory term MUST be caught. This suite is also the
graduation gate referenced by `orchestrate-workflow`.

## Guardrails
- Template diff alone is not enough — the explicit mandatory-content checklist catches stale-but-approved templates.
- Do not soften a gate to let a contract through; flag and route back instead.

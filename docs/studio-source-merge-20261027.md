# Studio source-publication checkpoint — October 27, 2026

This checkpoint concerns source publication through PR #1, **not a deployed or fully accepted Studio/OS product**.

## Source scope

The existing feature head `2d0a3aa28733e9648c3a24ee0ccbb0cc7b154078` contains seven already-pushed commits above default branch `claude/gauntlet-loop-install-hp490e`, base `f80ad1f05018b8a38e720c3df59bff5ff0950cba`. The repository does not use `main` as its default branch at this checkpoint.

Independent read-only review verified the historical source receipts and exact receipt-to-commit joins: 5,074 passing Vitest assertions across 293 files plus 44 passing Node cases, with recorded typecheck/build/whitespace exits zero. These remain historical results; they are not a new full-suite run or CI claim.

That same review found **SOURCE-001**, an unexercised resource-transport DNS callback defect. The existing literal-IP loopback tests did not cover the hostname path. The focused correction returns the single checked DNS address in an array when Node requests `all:true`, preserving the scalar callback otherwise. It does not change destination validation, request URL/Host/TLS defaults, credential handling or redirect policy.

## Focused execution

Using the installed Node 22.23.3 runtime and copied existing dependencies in an isolated tracked-source checkout:

- The new hostname regression first failed on the unchanged production source: native socket lookup requested `all:true`, but the callback returned the scalar shape. The strengthened exact failure was `expected ['scalar'] to deeply equal ['array']`.
- The same regression passed after the four-added/one-removed-line production correction.
- Final focused retention passed **seven tests across two files**: six new hostname/callback/unsafe-DNS cases and the unchanged existing literal-loopback/redirect test. Repeated runs are not extra coverage.
- The unchanged project TypeScript configuration passed `tsc --noEmit -p tsconfig.json`; whitespace checking passed.

The hostname regression mocks initial DNS and the HTTPS entry seam, then uses an actual owned loopback HTTP socket to exercise Node's native lookup callback contract. It does not contact an external resource, exercise a real remote TLS handshake or prove live provider acceptance. Additional callback checks assert outside the sanitizing production seam so an assertion failure cannot be mistaken for the expected sanitized error.

No full default suite, production frontend build, native/browser/worker replay, install/update, image build or deployment was performed for this focused correction. Fresh independent correction review and exact remote reads remain required before any merge. No absent GitHub check is represented as passing CI.

## Not included

Newer UI/AppDesigner/OS candidates remain isolated and unadopted. The publication inventory established **no newer merge-ready set**: 119 deduplicated production/configuration paths and 34 other verification/documentation path deltas remain blocked by baseline/projection/validation/integration prerequisites. Four off-repository correction files have no established shipping destination. These counts describe candidate differences, not an accepted patch or new defect count.

Their broad failure/compiler/evidence qualifications are not applied retroactively to the verified historical source, nor waived by its publication. Three protected local untracked header-test sources and ignored raw evidence are excluded. Credentials/private state are never included.

## Runtime and handover

Source commit/push/merge does not restart Studio, Companion or Flightdeck OS, activate grants or the host bridge, migrate state, select a model or send a provider request. The chosen runtime target remains the existing private Studio instance, not public production. Whole-product integration and real user-controlled acceptance remain separate.

The final extensive cross-computer handover and standalone continuation prompt are due after genuinely verified working-state acceptance. They must distinguish source/remote/runtime status, preserve unresolved failures, provide portable setup/evidence/skill references and verify destination Hindsight access; a local scratch path or localhost memory service does not transfer automatically.

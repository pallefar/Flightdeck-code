# Independent-audit P3: composer edits revoke skill-send review

## Contract

Every composer mutation (typing/paste/native input, Clear, either starter suggestion, or accepted dictation) advances a controller-owned monotonic composer epoch. A pending review remains bound to the epoch captured when its immutable original request started. The UI removes the acknowledgment/action after divergence and explains that a fresh explicit Create is required. Reverting to identical text does not restore consent. A delayed original-A review cannot become actionable after editing B. Clarification and reviewed-send continuations retain the original epoch rather than re-arming it.

The original request, answers, connection/project and server-provided hash remain unchanged. The controller checks the epoch again at the send boundary; a detached/stale UI handler cannot send a revoked packet. Editing does not cancel the request, reset conversation or Workbench, clear graph/source drafts, save, retry, execute or deploy anything. A new explicit Create does not inherit the old reviewed hash; its review requires a fresh checkbox even if the deterministic fixture returns the same hash.

## TDD and verification

Observed RED before the corresponding implementation:

- New controller revocation test: `expected undefined to be type of 'function'`.
- Clarification continuation test: expected two payloads, received three (the stale reviewed send was incorrectly re-armed). Fixed by retaining the original request epoch on continuations.
- Real native StudioApp: original A → explicit Create → check review → native composer edit B left the old reviewed button enabled. `docs/evidence/review-composer-p3/red-native.json` and `.png` retain that RED result.

GREEN commands:

```sh
./node_modules/.bin/vitest run src/studio --maxWorkers=1
npm run typecheck
```

Final scoped run: **30 files / 234 tests passed**, including the four new controller regressions. `tsc --noEmit` passed. The earlier five-file 76-test run is a subset, not additional tests. Full merged repository acceptance belongs to the parent.

## Native browser evidence

Owned loopback fixture: `src/studio/__tests__/composer-review.browser.html`, `.tsx` and `composer-review.vite.config.ts`, port **5298**, HMR off, no API proxy. The actual StudioApp and StudioController run in StrictMode with clearly labelled deterministic DTO responses. Bootstrap uses a nonsecret fixture-only operator sentinel, not a real credential or authentication service. Composer, checkbox, buttons, navigation and editor edits use CDP native mouse/key/input, not DOM `.value` replacement. Native select-all uses Chromium's `selectAll` editing command because plain Meta+A did not select in this local CDP session.

Durable evidence under `docs/evidence/review-composer-p3/`:

- `green-ordinary-reverted.json`: reverting A does not revive the review; the same transcript/result/Workbench/editor/workspace identities remain.
- `green-clear.json`: Clear empties the composer, removes the action, adds no request.
- `green-delayed.json`: while A is held, native B typing revokes approval; A's eventual review has no action and creates no follow-up request.
- `green-explicit-exact-send.json`: fresh review starts unchecked; one explicit send carries the original prompt/project/connection and exact 64-character fixture hash.
- `green-suggestions.json`: both native starter buttons funnel through revocation and prefill only; no create requests.
- `green-dictation-event-fixture.json`: explicit native voice Enable/Check/Dictate followed by an injected final recognition event changes composer and revokes review with no send. **Not acoustic/microphone or real recognition proof.**
- `green-dirty-editors.json`: native workflow-name and source-editor typing survive a subsequent native composer edit. The source was explicitly seeded from the repository's frozen generator fixture, not claimed as new model output. Dirty buffer bytes and actual editor DOM identity remain unchanged.
- PNGs show RED, revoked, dictation-fixture and dirty-editor states.

No API setup, model/vendor/credential operation, host service, dependency, deployment, commit or push was performed by this P3 work. Fixture shutdown/closed-port proof and the separate P2 UI findings are recorded in the adjacent evidence/acceptance documents.

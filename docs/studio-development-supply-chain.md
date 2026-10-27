# Studio development / CI dependency migration

Verified October 14, 2026. This follows the historical runtime-only hardening record in `studio-runtime-supply-chain.md`; that record's outstanding development findings are now resolved in this checkout. No live image, service, host installation, credential or provider configuration was changed.

## Minimal supported update

Only one direct dependency changed: development-only `vitest`, from `^2.1.8` (installed `2.1.9`) to exact `4.1.11`. The existing React plugin `4.7.0`, frontend Vite `6.4.3`, source-map-js `1.2.2`, production tsx `4.23.15` and all production dependency lock entries are unchanged. No overrides, forced audit fixes, new coverage/browser integrations or compiler/test relaxations were added.

Primary sources checked against the live registry and upstream on the verification date:

- [Vitest supported releases](https://vitest.dev/releases): 5.0 receives regular patches; 4.1 receives important/security backports; older lines are unsupported. Thus 3.2.7 is **not** an acceptable supported security migration despite the registry's `V3` tag.
- [Vitest redirect-mock advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9): affected Vitest/mocker `>=2.1.0 <4.1.11`; fixed in 4.1.11 and 5.0.0. The advisory explicitly says 2.x/3.x will not receive this fix.
- [4.1.11 upstream release](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11), published August 18, 2026: includes the redirect-mock allowlist backport. Registry tags were `V3=3.2.7`, `V4=4.1.11`, `latest=5.0.4`. This migration deliberately does not choose the newest major solely because npm audit suggests it.
- Registry `npm view vitest@4.1.11 engines peerDependencies dependencies --json`: Node `^20.0.0 || ^22.0.0 || >=24.0.0`; Vite `^6.0.0 || ^7.0.0 || ^8.0.0`. Actual host and pinned Docker base both run Node `22.23.3`. Existing Vite 6.4.3 satisfies the dependency/peer constraint; existing React plugin's peer also accepts Vite 6.
- [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration.html): `minWorkers` was removed; `maxWorkers` is the applicable worker limit. The old argument was actually exercised and refused with `CACError: Unknown option --minWorkers`. Use the bounded release command below; do not reintroduce that flag or silently swallow unknown CLI options.

The default `npm test` runner remains unchanged: shell-free argument arrays, externally supplied Vitest arguments, then the separate Docker `node:test` family even if the first child fails. `vitest.config.ts` still merges React/alias configuration and default exclusions and separates only `deploy/studio-docker/**`. No framework/config/source compatibility changes were needed. Generated host-test emission and live-source SDK projections passed unchanged under the new test framework; no dependencies were installed in the host checkout.

## Installation issue and resolution

Host npm 10.9.9 crashed before modifying the manifest/lock with Arborist `Cannot read properties of null (reading 'edgesOut')` during optional peer-set resolution. `--prefer-dedupe` and explicitly selecting the unchanged Vite version did not resolve it; neither attempt changed the manifest/lock. No peer checks were disabled.

Registry-verified npm 12.2.0 supports Node `^22.22.2 || ^24.15.0 || >=26.0.0`. Its one-shot invocation completed the same single-dependency install:

```sh
npm exec --yes --package=npm@12.2.0 -- \
  npm install --ignore-scripts --save-dev --save-exact vitest@4.1.11
```

This downloaded a temporary npm CLI through the normal npm cache, not a global/OS installation; host npm remains 10.9.9. No global npm config, TLS setting, runtime dependency or unsupported override changed. The final Docker build independently completed normal npm 10.9.9 `npm ci --ignore-scripts` against the resulting lock in both build and omit-dev stages.

## Audits and exact graph

Raw audits use `npm audit --json --ignore-scripts`, independently of `npm audit --omit=dev --json --ignore-scripts`. These are vulnerable **package-entry** counts, not unique advisory counts or demonstrated exploitable application routes.

| Scope | Moderate | High | Critical | Total |
| --- | ---: | ---: | ---: | ---: |
| Full development/build graph before | 3 | 1 | 2 | 6 |
| Full development/build graph after | 0 | 0 | 0 | 0 |
| Production omit-dev lock audit after | 0 | 0 | 0 | 0 |
| Production audit inside the actual new candidate | 0 | 0 | 0 | 0 |

Info/low counts are also zero. The six initial entries were `@vitest/mocker`, `esbuild`, `tinypool`, `vite`, `vite-node`, `vitest`. `npm ls --all --json` was captured before/after and the final installed graph is valid.

| Lock/install path | Before | After |
| --- | --- | --- |
| `node_modules/vitest` | 2.1.9 | 4.1.11 |
| `node_modules/vitest/node_modules/@vitest/mocker` | 2.1.9 | removed; root `@vitest/mocker` 4.1.11 |
| `node_modules/tinypool` | 1.1.1 | removed; new Vitest does not depend on Tinypool |
| `node_modules/vite-node` | 2.1.9 | removed |
| `node_modules/vitest/node_modules/vite` | 5.4.21 | removed; compatible root Vite reused |
| `node_modules/vite-node/node_modules/vite` | 5.4.21 | removed |
| Both old Vitest/Vite-node nested esbuild paths | 0.21.5 | removed |
| `node_modules/vite` | 6.4.3 | unchanged |
| `node_modules/vite/node_modules/esbuild` | 0.25.12 | unchanged |
| `node_modules/esbuild` (production tsx) | 0.28.2 | unchanged |
| `node_modules/source-map-js` | 1.2.2 | unchanged |

Advisory prerequisites were checked using the reviewed GitHub advisory API, not inferred from severity:

- [Mocker redirect reads](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) require registration and loading through a reachable development integration. Public standalone interceptor/HMR registration is unauthenticated; Vitest browser RPC registration requires its token. The new allowlist fix closes the read boundary.
- [Vitest UI read/execute](https://github.com/advisories/GHSA-5xrq-8626-4rwp) requires a listening UI server, not mere dependency installation. The new supported release is outside affected ranges. The old UI/API/browser modes were never started to demonstrate this issue.
- [Tinypool worker-options gadget](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) requires an upstream prototype-pollution primitive plus attacker-controlled executable worker settings/code. [Run-options gadget](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) additionally requires a caller-supplied options object; `run(task)` with no second argument is not that vector. Tinypool is absent after migration, rather than forcibly overridden across an unsupported major.
- [esbuild cross-origin disclosure](https://github.com/advisories/GHSA-67mh-4wv8-2f99) requires the esbuild serve feature and attacker-controlled browsing content. Remaining esbuild versions are outside the affected `<=0.24.2` range.
- [Vite map traversal](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) needs a reachable dev server and sensitive predictable map. [Windows deny bypass](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) also needs alternate Windows paths; [editor NTLM disclosure](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) needs Windows NTLM/editor middleware and an attacker-controlled UNC target. Root Vite 6.4.3 was already patched for these findings; the old affected nested copies are gone. `vite-node` previously inherited its Vite finding.

A zero known npm application-dependency audit is **not** a general security guarantee, an OS/base/global-npm scan, a provider readiness assertion or permission to deploy. Continue refreshing advisories and supported release status, keep development tooling unexposed and do not provide production credentials to builds/tests.

## Real verification

A new three-test regression file `scripts/development-supply-chain.test.ts` was written and run before the update. Under Vitest 2.1.9 it failed on the old direct pin and affected Tinypool 1.1.1, while the runtime-isolation assertion passed. After migration all three tests pass; existing runner/discovery tests also pass unchanged.

```sh
FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract \
  npm test -- --maxWorkers=4
npm run typecheck
npm run build
npm audit --json --ignore-scripts
npm audit --omit=dev --json --ignore-scripts
npm ls --all --json
```

Executed the default host-aware entry, with all files discovered: **2,867 Vitest tests in 187 files passed** (the original 2,864 plus three new regressions), **16 Node tests passed**, zero failures/pending/skips/cancellations. The JSON assertion-status count was computed programmatically: exactly 2,867 `passed`, no other status. Both families ran, including generated-emission conformance and actual host-source tests. Typecheck and the complete production build passed. The existing Vite >500 kB chunk warning remains visible, not suppressed; no React key warnings were introduced.

All **89 non-dev lock entries** (including optional platform entries, excluding the root manifest) are unchanged as complete parsed objects before/after. The physical package count is deliberately a separate assertion:

- Built isolated `flightdeck-studio-devchain-check:local`, image ID `sha256:7b848670876de7dd5df3c38c9ae894355460555bb37ad485b7c9f5dd0da260ab`, 420509379 bytes. No active tag was overwritten.
- The existing physical verifier found **63 installed application packages** with matching lock paths/versions, valid actual `npm ls`, no dev-only/forbidden tool packages including nested copies, and no runtime server/package test sources. Node `22.23.3`, UID 1000.
- The unchanged private-bootstrap fixture ran in a read-only, network-none one-shot container with ephemeral private `/state` tmpfs, no published port or persistent volume. Actual HTTP checks: health 200, unauthorized descriptors 401, authenticated four-model descriptors 200, unselected build 409, entry and two built assets 200, source/map/API-fallback refusals 404. No vendor/resource invocation; generated credentials remained inside the fixture.
- A separate no-server one-shot production audit used only the existing approved public CA read-only mount with TLS validation enabled and returned zero findings.
- Compared IDs, image IDs and start timestamps for staging, companion, integration OS and atlas-dev before/after artifact checks: unchanged. Frozen staging remained untouched; there was no live cutover.

Raw before/after audit JSON, reviewed-advisory JSON, dependency trees, RED log, full-suite JSON/log, candidate build log, physical/runtime smoke JSON, production image audit and live identity comparisons are in `/Users/te451223/.hermes/cache/scratch/studio-devchain/`. Scratch evidence is local and temporary; reproduce the commands above rather than treating these files as a permanent external attestation. Parent-owned fresh release verification and any deployment approval remain separate.

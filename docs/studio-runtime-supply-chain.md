# Studio production runtime supply chain

## Scope and implementation

This hardens **the opt-in production UI/API image**, not a deployed service. The default API companion, OS, host, shell and canvas containers are not rebuilt or restarted. This is evidence for the dependency/runtime portion of production gate G06, not permission to mark the deployment gate complete.

- Both stages use the same immutable official `node:22-slim` multi-platform index digest: `sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`, obtained using `docker buildx imagetools inspect node:22-slim` on October 14, 2026. The selected Linux arm64 manifest is `sha256:b20fe038d9592822dd534600a1ddf467e985178aa3fed60ec441a056c2cc45bd` (official-image creation annotation October 6, 2026).
- The build stage still installs all locked development dependencies and runs **unchanged `npm run build` (`tsc -b && vite build`)** over the complete source/test tree. No compiler strictness, assertions, test discovery, thresholds or timeouts are weakened.
- The runtime stage performs a separate `npm ci --ignore-scripts --omit=dev`. It no longer copies the build stage's entire `node_modules`. The real entry stays `node --import tsx deploy/studio-docker/bootstrap.mjs`, so `tsx` is an explicitly pinned production dependency (`4.23.15`), rather than an accidentally retained development tool. Its locked esbuild and platform binary remain legitimate runtime dependencies.
- Server and package source tests are pruned **after** the full build/typecheck, then copied from the build stage into the runtime. Conformance fixture modules are retained; only `__tests__` directories and `.test.*`/`.spec.*` sources are removed. The TypeScript server/package implementations are intentionally retained: this is not a bundled, reflected/dynamic-import-sensitive backend rewrite.
- The Dockerfile-specific context allowlist retains complete application source and includes only bootstrap, secrets loader and build-only pruning utility from deployment files. Host scripts, verification utilities, Compose fixtures, credentials and CA files are not copied into the image. The host-approved **public CA** is used only as a BuildKit secret; TLS validation remains enabled.
- `source-map-js` was updated within the existing dependency range to patched `1.2.2`. There are no unsupported transitive overrides or forced test-toolchain major upgrades.

## Audit interpretation

The initial **full** lock/installed-tree audit reported **7 vulnerable package entries: 3 moderate, 2 high, 2 critical**. These are not seven independently exploitable production endpoints, nor seven unique advisories: `vitest`, `vite-node` and `@vitest/mocker` inherit some child findings. Installed versions and their nested paths were collected using `npm ls --all --json`, and the advisory prerequisites below were checked against GitHub's reviewed advisory API and the upstream Vitest advisory.

After the source-map patch, the **full development/build graph still has 6 vulnerable package entries: 3 moderate, 1 high, 2 critical**. Do not present `npm audit --omit=dev` as fixing that development graph. The old Vitest 2.x toolchain is retained for compatibility in this change and still needs a separately tested supported-major migration. Never expose its UI/API/browser mode or build/test workers to untrusted callers; run builds/tests without production credentials. Removing it from the final image removes its production presence, not developer/CI risk.

| Original package entry | npm severity | Actual prerequisites / disposition |
| --- | --- | --- |
| `@vitest/mocker` | moderate | Redirect-mock file read requires reachable mock registration/loaded module. Unauthenticated use is the public standalone interceptor/HMR integration; Vitest browser RPC is token-authenticated. Removed from production image, unresolved in dev graph. [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9). |
| `esbuild` (old nested copies under Vitest/Vite-node) | moderate | Cross-origin disclosure requires running esbuild's `serve` feature and visiting attacker-controlled content; ordinary transforms are not that HTTP listener. Old nested copies removed from runtime; the production loader's newer locked esbuild is retained. [GHSA-67mh-4wv8-2f99](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99). |
| `source-map-js` | high | Extremely large indexed source-map section offsets can block the event loop when malicious maps are processed. Patched to `1.2.2` in the full lock/tree; absent from production install. [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). |
| `tinypool` | critical | These are prototype-pollution **gadgets**, requiring a pollution primitive elsewhere and attacker-controlled worker code/options. The `run()` filename gadget additionally requires caller-supplied options; no-options `run(task)` is explicitly not affected by that vector. Removed from production image; unresolved developer/CI risk. [Worker-options advisory](https://github.com/tinylibs/tinypool/security/advisories/GHSA-5gmw-xhrv-c9v3), [run-options advisory](https://github.com/tinylibs/tinypool/security/advisories/GHSA-85c8-ppgw-ccpr). |
| `vite` (old nested copies) | high | Dev-server `.map` traversal requires reachable server and predictable sensitive map. Windows deny bypass additionally needs NTFS alternate paths or enabled short names; editor disclosure needs Windows NTLM, a reachable editor middleware and attacker-controlled UNC target. Production runs Fastify/static snapshots, not a Vite listener. Root Vite `6.4.3` is patched for these listed Vite advisories; old nested copies remain dev-only. [Map traversal](https://github.com/vitejs/vite/security/advisories/GHSA-4w7w-66w2-5vf9), [Windows deny bypass](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff), [Editor disclosure](https://github.com/vitejs/launch-editor/security/advisories/GHSA-v6wh-96g9-6wx3). |
| `vite-node` | moderate | Inherited vulnerable Vite dependency, not a separate demonstrated route. Removed from production image, retained in old development test tree. |
| `vitest` | critical | UI/API exposure can permit file write/execute; Windows UI/browser paths have additional file-read behavior. The upstream advisory does not say mere installation makes the Fastify API remotely exploitable. Vitest is absent from runtime; development version remains affected. [GHSA-5xrq-8626-4rwp](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp). |

The production application audit is not a scanner of Debian packages, Node core, globally bundled npm/Yarn, arbitrary generated code, external Codex executables, configured resource destinations or live provider credentials. Zero known application-dependency advisories is **not** proof of general security. Digest pinning gives reproducible base selection, not automatic security updates; review the Node support schedule and refresh/rescan the digest regularly and on security releases.

## Reproduce without touching live services

Run from the checkout. The candidate tag is intentionally distinct from the live companion and from the parent staging candidate.

```sh
docker build \
  --secret id=studio_ca,src=/Users/te451223/.hermes/cache/scratch/studio-build-trusted-ca.pem \
  -f deploy/studio-docker/Dockerfile.production \
  -t flightdeck-studio-runtime-hardening-check:local .

# No external network, no published port, no persistent state/credential volume.
# Generated operator token stays in the ephemeral private /state tmpfs.
docker run --rm -i --read-only --network none --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777 \
  --tmpfs /state:rw,nosuid,nodev,mode=0700,uid=1000,gid=1000 \
  --entrypoint node flightdeck-studio-runtime-hardening-check:local \
  --input-type=module - --smoke \
  < deploy/studio-docker/verify-runtime-artifact.mjs

# npm's online advisory request needs verified registry TLS and network.
# No server starts in this separate one-shot container; the public CA stays
# a read-only mount and never becomes an image layer or production secret.
docker run --rm --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777 \
  --mount type=bind,src=/Users/te451223/.hermes/cache/scratch/studio-build-trusted-ca.pem,dst=/run/studio-ca.pem,readonly \
  -e NODE_EXTRA_CA_CERTS=/run/studio-ca.pem -e npm_config_cache=/tmp/npm-cache \
  --entrypoint npm flightdeck-studio-runtime-hardening-check:local \
  audit --omit=dev --json

npm audit --json                       # full dev/build graph: keep separate
npm run test:docker                    # recipe + physical-verifier fixtures
```

The physical verifier enumerates actual package manifests (including scoped/nested installs), rejects dev-only or unlocked entries, checks exact installed/lock versions and required runtime dependencies, validates the real npm dependency graph, and checks source-test absence. The smoke uses the unchanged private bootstrap, real loopback HTTP and actual built JS/CSS. It authenticates only with the generated ephemeral development token, tests all four model descriptors and an unselected-model `409`, and makes no model/provider/resource invocation. A dev-only physical package is a failure even if an omit-dev lock audit would otherwise return zero.

## Verification record

Verified on October 14, 2026:

- Built and retained isolated `flightdeck-studio-runtime-hardening-check:local`, image ID `sha256:5fb2c1bfa5af5d3b0a4fa9f721ed4531f5e1b623c6739d0145dadc423cfe1d6e`, Linux arm64, Node `v22.23.3`, runtime user UID `1000`. Image size reported by Docker: `420530251` bytes. The full build succeeded; Vite retains its pre-existing >500 kB chunk warning (568.46 kB JS), which was not silenced.
- The **physical filesystem verifier found 63 installed application packages**, with exact matching lock entries and a valid real npm dependency graph. `tsx 4.23.15`, `esbuild 0.28.2` and `@esbuild/linux-arm64 0.28.2` are retained. Vitest, its mocker/runner, Vite, Vite-node, TypeScript, Tinypool and the React Vite plugin are absent, including nested copies. Runtime server/package source tests are absent.
- The **audit executed inside this actual candidate** returned zero known application dependency vulnerabilities (`info/low/moderate/high/critical/total` all `0`). npm audit's metadata still describes the whole lock (including omitted dev and platform-optional entries); it is not the physical installed package count. The separately executed physical verifier is the installation evidence.
- The network-none, read-only, no-capabilities ephemeral smoke passed through the **unchanged bootstrap**: real HTTP health `200`, unauthorized model descriptors `401`, authenticated four-connection descriptors `200`, authenticated unselected-model build `409`, real frontend entry `200`, both actual built JS/CSS assets `200`, and source/map/API-fallback requests `404`. No model, provider or resource invocation occurred, and no generated token was printed or copied out.
- `npm run test:docker`: **16 passed**. Targeted provider/model/static-asset/resource tests: **75 passed**. The complete unchanged production build and `npm run typecheck` passed. Parent-owned whole-project/staging/deployment checks remain separate.
- The live companion and OS container IDs **and start timestamps** were read before/after and compared byte-for-byte unchanged. No active image tag was overwritten, no live service was restarted, and no deployment was performed. The one-shot verification containers removed themselves; no persistent fixture volume or published port was created.

Early builds correctly refused concurrently incomplete request-admission/backup edits; those failures were not bypassed by excluding source tests. This verifies the opt-in artifact's dependency/runtime portion of G06 only. The active companion deployment and the full development/CI advisory migration remain outstanding.

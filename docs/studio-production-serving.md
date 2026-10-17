# Opt-in Studio production serving candidate

The optional image builds the frontend with `npm run build` (TypeScript plus Vite) and serves it from the **real Studio Fastify composition root** on the API's origin. There is no Vite server or frontend proxy at runtime. The default companion remains API-only; neither its image tag nor its running container was changed by this work. This is a tested production **candidate**, not a production deployment or host authorization integration.

## Serving contract

Enable with a trusted absolute `STUDIO_FRONTEND_ASSET_ROOT`, or pass `productionAssetRoot` to `createServer`. The optional production image sets `/app/dist`. An absent setting preserves API-only behavior; an explicitly empty or invalid setting refuses startup with a constant error.

The startup loader accepts only `index.html` and one flat `assets` directory. It registers GET/HEAD `/`, `/demo`, and exact hashed JavaScript/CSS asset paths. There is no wildcard file server, directory listing, redirect, arbitrary SPA route, `/index.html` route, or API fallback to HTML. Literal canonical request paths are required after Fastify routing; encoded aliases are refused. Static request URIs are capped at 2,048 characters, including their query string. Private state, repository paths, package files, source files, source maps and unknown asset names cannot become public routes.

Limits: 128 assets, 8 MiB per asset, 20 MiB total snapshot, 128 KiB entry document. Directory enumeration and regular-file reads are bounded. Absolute paths containing traversal/backslashes, symlink ancestors, symlink files/directories, nonregular files, missing script references, inline scripts and non-build names refuse startup. Files are opened with `O_NOFOLLOW | O_NONBLOCK`, checked with descriptor metadata, read within their bounds, and checked again for size/timestamp changes. The validated bytes are retained in memory; subsequent requests perform **no filesystem access**, so later file replacement cannot change admitted content.

The asset root is trusted deployment input, **not** user-selected upload storage. Its entire parent/tree must remain immutable while startup validates it. Node's portable filesystem API does not provide an atomic descriptor-relative `openat` tree traversal here; ancestor checks do not claim protection against an attacker concurrently swapping writable parent directories. The Docker image keeps `/app/dist` in its read-only filesystem. Do not mount a writable or attacker-controlled build tree.

Static responses include correct JS/CSS/HTML MIME, `nosniff`, `Referrer-Policy: no-referrer`, restrictive permissions policy, and:

```text
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'self' about:; form-action 'none'
```

Only validated content-hash build names get `public, max-age=31536000, immutable`; the entry has `no-cache`. Scripts do not receive `unsafe-inline` or `unsafe-eval`. Inline styles are explicitly allowed because React and the existing workbench inject style elements and attributes; this is **not nonce-protected styling**.

### Preview and host boundaries

The inspected `src/workbench/components/PreviewFrame.tsx` creates an `about:blank` iframe with `sandbox="allow-same-origin"`, **without `allow-scripts`**. React portals supply the preview's components and CSS; generated source is not executed in the frame. `frame-src 'self' about:` preserves this existing scriptless document boundary. A real Chromium probe verified document access and injected styles under the deployed CSP with no policy violation. The full model-produced subapp path was not exercised: no model connection was configured or called. If a future preview requires executing generated scripts, this policy must not be globally weakened; a separately reviewed isolation design is required.

`frame-ancestors 'none'` intentionally disallows embedding Studio. The existing OS launcher opens a separate Studio tab with separate sign-in; neither that boundary nor host routes, credentials, project authority or launch configuration changed.

This loopback HTTP fixture provides **no TLS or HSTS**. A real deployment still requires an approved HTTPS reverse proxy/TLS termination, protected origin access and appropriate operator/identity configuration. Same-origin serving does not replace the existing single-operator authentication or configure an independent reviewer/provider.

## Optional image

```sh
# Isolated candidate tag only; does not replace the companion image.
docker build -f deploy/studio-docker/Dockerfile.production \
  -t flightdeck-studio-production-check:local .
# When a host-approved PUBLIC CA is needed for verified registry TLS:
# docker build --secret "id=studio_ca,src=$TRUSTED_CA_PEM" \
#   -f deploy/studio-docker/Dockerfile.production \
#   -t flightdeck-studio-production-check:local .
```

The Dockerfile-specific `.dockerignore` allowlists build inputs, excluding local state, `.env`, key/certificate and credential files. `npm ci --ignore-scripts` uses the existing lockfile and optional BuildKit public-CA secret; TLS verification is never disabled. No server credentials are supplied to the frontend build. The runtime copies the build output and the existing backend TypeScript/tsx dependencies, but not the frontend source tree or a development Vite process. Retaining the locked development toolchain is deliberate because the existing server runs through tsx; dependency minimization is not claimed.

`deploy/studio-docker/production.compose.yml` is an **optional overlay** for a separately approved production service change. It changes only image/build and the asset setting, inheriting the base companion's nonroot, read-only, loopback/private-volume limits. Do not apply it to the running companion without approval. Its intended build/config commands, from the repository root, are:

```sh
docker compose -f docker-compose.studio.yml \
  -f deploy/studio-docker/production.compose.yml config --quiet
# Building this distinct tag is not permission to recreate a running service.
docker compose -f docker-compose.studio.yml \
  -f deploy/studio-docker/production.compose.yml build studio-backend
```

## Repeat the isolated development smoke

`production-check.compose.yml` is standalone, not merged with the companion. It uses a fixture-only operator, a new private volume, a free dynamically allocated loopback port, no API keys, and no model selection. Credentials are generated by the **unchanged real private bootstrap**, read only inside the smoke process, and never printed. Its distinct service/image/project prevent accidental use of the companion's volume or ports 8787/4173.

```sh
CHECK_PROJECT=flightdeck-studio-production-check-isolated
docker compose -p "$CHECK_PROJECT" \
  -f deploy/studio-docker/production-check.compose.yml up -d --wait
# Read only the mapped nonsecret origin; Docker chooses a free host port.
docker compose -p "$CHECK_PROJECT" \
  -f deploy/studio-docker/production-check.compose.yml port studio-production-check 8787
docker compose -p "$CHECK_PROJECT" \
  -f deploy/studio-docker/production-check.compose.yml exec -T studio-production-check \
  node --input-type=module - save < deploy/studio-docker/production-http-smoke.mjs
# Restart ONLY this development fixture; do not rerun the save/run action.
docker compose -p "$CHECK_PROJECT" \
  -f deploy/studio-docker/production-check.compose.yml restart studio-production-check
docker compose -p "$CHECK_PROJECT" \
  -f deploy/studio-docker/production-check.compose.yml up -d --wait
docker compose -p "$CHECK_PROJECT" \
  -f deploy/studio-docker/production-check.compose.yml exec -T studio-production-check \
  node --input-type=module - readback < deploy/studio-docker/production-http-smoke.mjs
# Repeat readback after `up -d --force-recreate --wait` to verify recreation.
# Destructive cleanup is ONLY for this isolated project's fixture volume:
docker compose -p "$CHECK_PROJECT" \
  -f deploy/studio-docker/production-check.compose.yml down -v
```

The smoke verifies both entry pages, real bundled assets/HEAD/security headers, public health `{ok:true}`, unauthenticated API 401, four authenticated model descriptors, unselected-model 409, real file-backed draft creation/update to revision 2, exact draft readback, one deterministic manual → set → output run, and complete run/draft snapshots after restart and recreation. It verifies private 0600 files. Readback never repeats an effect. It emits only development record IDs and verification status, not credentials.

## Recorded verification — October 14, 2026

- Strict RED/GREEN cycles for real-root static serving, canonical routes/security headers, fail-closed bounded startup files, and explicit environment enablement; 18 static tests plus 17 composition-root tests passed.
- All six Docker configuration/private bootstrap/secret tests passed. `npm run build` and the multistage Docker build passed. Vite reports a >500 KiB bundle warning; no warning threshold or compiler check was weakened.
- Candidate retained as `flightdeck-studio-production-check:local`, image ID `sha256:b310145baed0e8520cb753f348b32f3e9c0d4e17b41628bc5a05e57b25ce3f1f`. This captures the UI revision at its build time; rebuild after parallel UI changes before release.
- Real Docker smoke passed save, restart readback and recreation readback. Browser `/` and `/demo` rendered the actual bundle, same-origin health returned `{ok:true}`, unauthenticated model access returned 401, AI creation stayed blocked without a configured model, and the conditional demo ran locally to COMPLETED. Captured CSP violations and JavaScript errors were empty; the scriptless frame/style boundary probe passed.
- Runtime inspection confirmed UID/GID 1000, read-only root, dropped ALL capabilities, no-new-privileges, 128 PIDs, 768 MiB, and loopback-only ephemeral publication. The fixture container/network/private volume were removed; the candidate image remains for repeat verification.
- The running companion and OS container IDs and start timestamps were identical before/after. No actual operator credential, existing private volume, companion tag or host launcher was changed.
- Full host-aware Vitest run with four workers: **181 files / 2,788 tests passed; one file / three tests failed**. The failures are the already known computed hand-written host manifests (`docusign`, `maps`, `advantage`) in `packages/codegen/src/__tests__/manifest-rules.test.ts`, not new static-serving failures. No fixtures or validators were loosened.
- Observed remaining UI documentation issue outside this worker's file ownership: the built AI builder's connection-help text still recommends development Vite/proxy commands. That should be updated to distinguish this production image before release. Browser operator sign-in/full model-produced subapp rendering, real HTTPS deployment, live providers, independent-review identity configuration and installed-host integration are not verified by this candidate.

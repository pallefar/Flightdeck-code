# Studio private Docker companion

This is the upgraded authoring **backend**, not a replacement for Flightdeck OS and not a Docker-served frontend. The existing Studio Vite demo on `http://127.0.0.1:5180` proxies `/api` to this companion on `127.0.0.1:8787`. The OS launcher still opens a separate Studio sign-in; no host authentication, scopes, permission gates, registry, database or volumes are changed.

## Start / stop

From the Studio checkout:

```sh
docker compose -f docker-compose.studio.yml build studio-backend
docker compose -f docker-compose.studio.yml up -d --no-build --wait studio-backend
docker compose -f docker-compose.studio.yml ps
# Stop only this companion, preserving private state:
docker compose -f docker-compose.studio.yml stop studio-backend
```

The explicit Compose project is `flightdeck-studio-companion`, service `studio-backend`, volume `flightdeck-studio-companion_studio-private`. Never use the Flightdeck OS compose files for these commands. Do not use `down -v`: it destroys Studio private drafts, runs and the generated operator token.

`STUDIO_OPERATOR` defaults to **Karsten Haldan**, the operator named by the user. It is not a fixture identity. Startup calls the real `operatorFromEnv` and `createServer`; it does not add another authentication route or override authorizations. Missing or invalid named-operator configuration fails closed.

Runtime: Node 22, UID/GID 1000, read-only image, dropped capabilities, no-new-privileges, bounded process/memory/tmpfs, no Docker socket. Only its private `/state` named volume and temporary `/tmp` are writable. `/state` is 0700; its generated 32-byte random operator token is 0600 and remains stable across restarts. Workspace state and smoke records are also private. Docker administration still permits access to this volume: do not treat it as protection against a privileged host administrator.

## Corporate TLS during builds

The inspected host uses a trusted Zscaler public root certificate. Both local Node Docker images initially rejected npm TLS with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`; npm presented the less specific `Exit handler never called!` error. The working build supplied **only the host-trusted public CA**, never a private key, through a BuildKit secret mount:

```sh
# TRUSTED_CA_PEM points to an exported, approved public CA certificate.
docker build --secret "id=studio_ca,src=$TRUSTED_CA_PEM" \
  -f deploy/studio-docker/Dockerfile -t flightdeck-studio-backend:local .
docker compose -f docker-compose.studio.yml up -d --no-build --wait studio-backend
```

The CA is used for `npm ci --ignore-scripts --include=dev`; it is not baked into the image or persisted into container configuration. TLS verification stays enabled. On networks without that corporate proxy the ordinary Compose build needs no CA. Do not disable certificate checks or reuse another application's credentials.

## Anthropic API key — explicit opt-in

The default service mounts no key. It selects Anthropic because the user requested that provider, but reports it `unavailable` / `not-probed`. Authenticated model-dependent requests return 409 while unconfigured. Workspace save and deterministic local execution remain available. There is no implicit fallback, fabricated completion or live model probe.

1. Using a password manager or private local UI, create a regular file **outside the repository** containing your own Anthropic API key, optionally followed by one newline. Never paste it into chat, a shell command, a graph, `.env`, Compose YAML or logs.
2. Set its permissions to 0600 (or 0400), owned/readable by the container's UID 1000. Docker Desktop's inspected macOS file mount mapped a host-private 0600 test file to UID 1000 and passed the reader checks. Linux bind mounts must be explicitly owned by UID 1000. Root-owned 0400 files cannot be read by this non-root runtime and are intentionally refused.
3. Set **only the filename** and recreate **only the companion**:

```sh
export STUDIO_ANTHROPIC_SECRET_FILE='/absolute/path/outside/repository/anthropic-key'
docker compose -f docker-compose.studio.yml \
  -f deploy/studio-docker/anthropic.compose.yml \
  up -d --no-build --wait studio-backend
```

If this network also requires its trusted public CA for runtime Anthropic HTTPS, export `STUDIO_TRUSTED_CA_FILE` (filename only) and add `-f deploy/studio-docker/trusted-ca.compose.yml` to the same command. That mounts the approved public CA read-only and sets `NODE_EXTRA_CA_CERTS`; it never weakens TLS verification.

All opt-in bind mounts use `create_host_path: false`, so a typo cannot silently create a directory. Always retain the same override file list for later recreates. The server reads whitelisted secret files into its own process environment before loading the real server module. It rejects missing/nonregular/symlink files (including symlink ancestors), oversized files, invalid UTF-8, blank/multiline/control-character contents, group/world permissions, unexpected ownership, unknown `_FILE` variables, and conflicting file/direct values. Errors are constant and do not echo filenames or contents. File mounts contain secret references; actual values are not placed in Compose environment or `docker inspect` command arguments.

A configured descriptor is still `not-probed`. Do not claim live Anthropic verification until an explicitly reviewed real model request succeeds; no live call has been made by this deployment.

## Browser operator credential

The initial generated token stays inside the private volume; deployment and smoke tests do not print or extract it. Public liveness is not sign-in. Browser authenticated actions still require the real operator credential, through the existing Studio sign-in and a user-controlled vault/autofill flow.

For a credential already managed by the named operator's password manager, export that credential through the manager's secure local UI to a private regular file outside this repository. Prefer a unique random 64-character token (server minimum is checked by `operatorFromEnv`). Save the same credential in the browser vault for the Studio origin and autofill it into the existing sign-in—never pass it through chat. Set only `STUDIO_OPERATOR_SECRET_FILE` to that file's path and add `-f deploy/studio-docker/operator.compose.yml` to the companion command. This explicit override uses the supplied operator token; without it the companion uses the original generated token. Keep the operator override on subsequent recreates to avoid reverting to the original credential. Do not copy Studio credentials into the Flightdeck OS browser storage.

No browser vault credential has been provisioned by the Docker deployment. No host credential files have been created or modified.

## Verify save / run / restart

Before provisioning a real model key, the following exercises real HTTP against the actual running backend with credentials read internally from private files. It creates a clearly isolated `docker-development-*` authoring workspace, saves then updates revision 2, runs actual manual → set → output engine execution, and verifies draft/run snapshots plus actual named-operator attribution. It does not call a provider, use mocked production adapters or write to any OS project.

```sh
node --test deploy/studio-docker/*.test.mjs
docker compose -f docker-compose.studio.yml exec -T studio-backend \
  node deploy/studio-docker/http-smoke.mjs save
docker compose -f docker-compose.studio.yml restart studio-backend
docker compose -f docker-compose.studio.yml up -d --no-build --wait studio-backend
docker compose -f docker-compose.studio.yml exec -T studio-backend \
  node deploy/studio-docker/http-smoke.mjs readback
```

Use the same opt-in file list if an operator secret is supplied. This deterministic smoke intentionally requires Anthropic to be unconfigured; it is not a model-key validator. Readback compares the complete exact saved draft and finished run after restart, including immutable graph snapshot/digest and revision. It verifies 0600 file modes, unauthenticated 401, public health `{ "ok": true }`, four descriptors, and unconfigured-model 409. It emits only development record identifiers, test output and the operator's already supplied name—no bearer or API credentials. `readback` is repeatable without creating additional drafts or rerunning an execution.

## Verify that unconfigured independent review stays blocked

The companion image includes the durable approval server, but the default Compose setup has **no independent reviewer identity provider or queue policy**. It must not advertise approval authority merely because the API exists. This development smoke creates a manual → approval → output run, checks that it pauses with `resumable: false`, checks authenticated approval routes return 503 and unauthenticated requests return 401, and verifies the exact original run after restart. It creates no reviewer identity and sends no approved human proof.

```sh
docker compose -f docker-compose.studio.yml exec -T studio-backend \
  node --input-type=module - save < deploy/studio-docker/approval-default-http-smoke.mjs
docker compose -f docker-compose.studio.yml restart studio-backend
docker compose -f docker-compose.studio.yml up -d --no-build --wait studio-backend
docker compose -f docker-compose.studio.yml exec -T studio-backend \
  node --input-type=module - readback < deploy/studio-docker/approval-default-http-smoke.mjs
```

These checks passed against the rebuilt companion on October 14, 2026. Existing mapped-run and resource-draft exact readbacks also passed; the OS container identity and start time remained unchanged. This verifies default blocking and persistence, not live independent review. The actual independently authenticated restart/resume and competing-process effect-counter tests are documented in `docs/workflow-approvals.md`; production identity/queue configuration remains required.

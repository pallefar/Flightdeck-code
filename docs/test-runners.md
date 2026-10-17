# Test runners

Run from the repository root with Node 22 (the Docker companion also uses Node 22):

```sh
npm test
FLIGHTDECK_HOST_ROOT=/path/to/flightdeck-host npm test
```

The default entry runs **both** families in sequence:

1. Vitest runs the existing TypeScript/JavaScript test discovery.
2. Node's built-in runner executes `deploy/studio-docker/*.test.mjs`.

Docker companion tests use `node:test`, not Vitest. Importing them into Vitest caused two `No test suite found` failures and did not correctly account for their tests. `vitest.config.ts` merges the existing Vite configuration (including React, aliases and proxy) and retains Vitest's default exclusions, adding only `deploy/studio-docker/**`. All other default discovery remains unchanged; no test is skipped to repair runner separation.

`scripts/test-all.mjs` launches the active Node executable with argument arrays, inherited output/environment and no shell. Both families are attempted even when the first fails or cannot start. The aggregate exit is 0 only when both succeed, otherwise 1; a signal-terminated child counts as failure. A known Vitest failure must not hide Docker test execution or turn the default entry green.

## Focused commands

```sh
npm run test:vitest -- server/__tests__/index.test.ts
npm run test:docker
npm test -- scripts/test-entry.test.ts
```

Arguments after `npm test --` are forwarded **only to Vitest**, unchanged. The complete Docker family still runs with its fixed Node command. Use `test:vitest` when a Vitest-only run is intentional, and `test:docker` for the companion-only family. Vitest flags such as `--watch` remain Vitest flags: Docker runs after that process exits.

The runner uses the repository root as the child working directory and its installed Vitest entry, without installing dependencies. No dependency or lockfile change is required for the script/config repair. Docker image construction must copy `scripts/test-all.mjs` as well as the package manifest if `npm test` is to be available inside the image.

## Regression and baseline verification

`scripts/test-entry.test.ts` checks default exclusions, unmodified default includes, preservation of Vite configuration, npm entry wiring, literal argument forwarding, both-success/second-failure aggregation and real second-child execution after a first-child failure.

Host-aware full runs may still fail on the three existing hand-written computed-manifest cases in `packages/codegen/src/__tests__/manifest-rules.test.ts`: **docusign**, **maps** and **advantage**. Those cases and the manifest parser are not weakened by this runner repair. Report their actual failure status separately from runner-discovery errors, which should be absent.

Additional checks:

```sh
npm run typecheck
npm run build
git diff --check
```

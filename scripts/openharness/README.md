# Optional OpenHarness verification

```sh
npm run verify:openharness
# Or avoid npm's launcher/configuration entirely:
python3 -B scripts/verify-openharness.py --scratch-parent "$TMPDIR"
# Runner helper tests only; no downloads:
python3 -B -m unittest discover -s scripts/openharness -p test_runner.py -v
```

Requires **macOS with working `/usr/bin/sandbox-exec`**, Python 3.9+, Node 20+
and the project's already-installed `tsx`, TypeScript and Node types. Other
platforms, missing confinement, failed native sensitivity controls or any failed
child/check **refuse**; there is no unconfined fallback. Paths are derived from
the checkout. `--scratch-parent` selects an existing trusted temporary directory;
otherwise Python uses the caller's temporary directory. Every invocation creates
a new private owned child directory, never reuses an installation, and retains
it for inspection. Remove only that printed directory when finished.

## What runs

- Official `@open-harness/sdk@0.1.1`, not the stale split alpha packages.
  `provenance.json` pins npm's SHA-512, independently audited tarball SHA-256,
  published git head, inspected upstream commit and exact dependency-file hashes.
- Download verifies the **whole original tarball** before safely extracting only
  its unchanged package manifest, ESM core entry/transitive chunks and published
  core declarations. Server/client/provider entries are not extracted or imported.
  The original manifest still advertises absent unused entries: this is deliberately
  **not a complete SDK installation**. No vendor agent SDK or Ralph is installed.
- A separate `npm ci --ignore-scripts --no-audit --no-fund` uses the checked-in
  **unchanged audited core-only lock**: eight exact roots, 49 locked entries;
  native optional packages are platform-specific. All entries require official
  npm HTTPS tarballs and SHA-512 integrity. Physical manifests are checked against
  the lock, including absence of unreviewed extra packages. No root dependency or
  root lock change is made.
- Native loopback-socket and outside-owned-root-write negative controls, then the
  original 27 real core runtime checks, six real SDK → existing Flightdeck
  `createDraftBroker` read-only checks and eight original-broker abort/drain
  checks. The scoped published-core API is also compiled with strict TypeScript,
  NodeNext/ES2022 and **`skipLibCheck=false`**. Runner helper tests run separately
  inside the verifier. Counts are not summed across repeated invocations.

Acquisition uses public npm networking with lifecycle scripts disabled, empty
user/global npmrc files, private cache and OS-limited writes. During **all probes,
helper tests and typechecking**, macOS denies `network*` and writes outside the
owned directory. A new explicit child environment supplies only tool PATH,
owned HOME/TMPDIR and nonsecret cache controls; it never copies provider keys,
proxy variables, preloads or SDK options. System curl disables curlrc and proxies.
This is **network/write confinement, not an arbitrary-code filesystem-read
sandbox**: trusted system tools, project loaders/source and installed project
packages remain readable. The harness does not inspect the user's private HOME,
planning, credentials, host services or containers.

## Results and boundaries

The final stdout JSON names `report.json` and the actual success/failure stage.
That report includes individual checks, real child exit/timeout status, locked and
physical package counts, original SDK file hashes and unchanged Flightdeck source
hashes. `process-status.json`, individual result JSON and complete per-process
logs are retained. Success requires **both** valid uniquely counted checks and
successful actual process termination; printing success before a later process
failure cannot pass. Timeouts terminate only owned process groups and fail.

All identities and policy decisions are explicitly **DEVELOPMENT fixtures**, not
Flightdeck OS authentication, grants or independent human approval. The only
actual broker handler used is bounded `read_block_catalog`; unknown `shell` is
refused. There is no model client/send, AnthropicProvider, SDK HTTP server,
arbitrary tool execution, provider/environment discovery, persistent recording,
default database, Docker or service change. Synthetic cassettes are visibly
labelled and memory-only, not captured provider completions.

The upstream SDK **unconditionally creates `HOME/.openscaffold`**, even with
custom stores. Here HOME is owned scratch and the directory must remain empty.
Its public abort can settle **before original work**. The held real-broker proof
keeps the original promise registered, demonstrates that early settlement,
retains drain until the original finishes, then awaits `broker.close()`.
The outer SDK handle alone is never evidence of native drain. Hard termination
or a process crash can leave this owned scratch directory; cleanup is not secure
erasure or proof of remote cancellation.

This command is an **optional project verification harness only**. It does not
mount or integrate OpenHarness into Studio's production runtime, authorize a
model, select a provider, deploy anything, or prove host/UI/end-to-end acceptance.

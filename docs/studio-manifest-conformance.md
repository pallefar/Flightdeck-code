# Manifest conformance boundaries

## Two different source contracts

Generated `manifest.ts` files remain subject to `testing/readEmittedManifest.ts`:
all data fields must be JSON-compatible literals; only the existing `initSchema`
and `registerRoutes` members are removed by its generated-shape reader. No runtime
logic or admission rules in that reader were changed for hand-written host files.
Computed optional contributions, additional function fields, references and calls
remain rejected for generated data. The existing emitter/invariant tests continue
to exercise complete generated candidates.

Hand-written host manifests are not emitter output. The actual `docusign`, `maps`
and `advantage` sources contain computed contributions or an additional callback.
Feeding those through the generated-only reader caused the three baseline failures.
`testing/readHostManifestMetadata.ts` now provides a separate, static AST metadata
projection. It never imports/evaluates host modules or resolves callback references.

## Authoritative drift guard

Before projecting a manifest, `readHostManifestContract` reads the actual host
`flightdeck/server/subapps/types.ts` and the local `manifest-rules.ts` and
`spec-contract.ts` as text. It:

- Requires a bare `z.object` manifest schema, preserving unknown-key stripping.
- Compares every local core field's AST against the host's, resolving bounded
  static const aliases, including ID/route regexes, capability and role arrays,
  navigation enums, nested settings-panel fields and optional/minimum semantics.
- Uses a small supported core Zod expression language; unsupported expressions,
  unresolved aliases and default/refinement changes fail closed rather than execute.
- Rejects any additional required host schema field. An additional data member can
  be omitted only when the actual schema declares an explicit outer `.optional()`.
- Requires the actual `SubAppManifest` interface to extend `SubAppManifestData`,
  preserves its two required callback declarations and rejects newly required
  interface fields. Optional interface additions are schema-stripped omissions,
  not evidence their callback implementations work.

The projection requires exactly one typed, named `const` object initializer. Source
is limited to 1 MiB, lexical/parser and AST nesting are bounded (64), and recursive
core literal/alias traversal is bounded (32). Core values support only inert string,
finite number, boolean, null, array and object literals. Computed keys, duplicate
keys, accessors, shorthand, prototype-sensitive keys, references, calls,
interpolations and spreads are refused. All top-level spreads are refused, including
ones preceding or following otherwise valid metadata.

The result contains `metadata` and an `omittedMembers` ledger with each member's
name, original source start/end and reason (`optional-schema` or
`schema-stripped-callback`). Even literal optional additive data is reported as
omitted rather than accidentally claiming it was validated. Tests independently
discover all members in all four actual manifest ASTs and require complete accounting.
The metadata then passes the unchanged `assertManifestWouldBoot` core validator.

## What this proves — and does not

This proves the local **core metadata rules** match the live schema declarations,
and that all four actual host manifests supply conforming literal core metadata.
Mutation tests demonstrate rejection of core shape/enum/regex constraints and
required-field drift; source tests prove malformed metadata and ambiguous source
cannot become admission success. Existing SDK source-projection/ABI guards remain
separate and are not replaced by this check.

This is **not** full host boot, callback execution, dependency installation, optional
additive schema validation, registry registration, host compatibility/install-gate
execution or a deployed integration. In particular, optional fields such as
`maxHostVersion`, `widgets`, `generatedBy`, directory listings and workflow/migration
contributions are outside this core projection and visible in its ledger when
present. `assertManifestWouldBoot` is a historical name, not a full runtime guarantee.
Host dependencies are not needed and must not be installed just to run this seam.

## Release verification

```sh
FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract npx vitest run \
  packages/codegen \
  packages/conformance/src/host-sdk-model.test.ts \
  packages/conformance/src/host-request-web-model.test.ts \
  packages/conformance/src/host-sdk-mount.test.ts --maxWorkers=4 --minWorkers=1
npm run typecheck
npm run build
```

An explicitly supplied missing `FLIGHTDECK_HOST_ROOT` fails loudly. Ordinary local
runs without a host checkout retain the existing visible skipped-host behavior;
such runs are not release conformance evidence. The release command must supply the
real checkout and report no skipped manifest tests.

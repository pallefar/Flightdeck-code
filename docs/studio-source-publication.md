# Source publication and local verification

The GitHub repository contains application source, tests, deterministic fixtures, deployment templates and project documentation. A source push is not a runtime deployment or public-production approval.

## Files kept local

Git ignores these by default:

- `**/evidence/`: raw validation reports, screenshots, source/build archives and operational readbacks.
- `**/node-compile-cache/`: local Node compiler caches.
- `.env` and `.env.*`: machine configuration and credentials, except explicitly documented `.env.example`, `.env.sample` and `.env.template` files. Examples must never contain real credentials.
- `deploy/studio-docker/trust/*.pem`: explicitly approved, machine-specific public trust inputs.
- Existing dependency, build and scratch directories.

These files are preserved locally, not deleted or rewritten to manufacture a passing result. References to evidence in historical documents describe local records and may not resolve in a fresh Git checkout. Reproducible test sources and required deterministic fixtures—including `subapp-workspace.generated.snapshot`—remain versioned.

`scripts/publication-boundary.test.ts` exercises the ignore boundary through Git and protects both private-path exclusions and normal source/example admission. Ignore rules are not a substitute for a staged-payload secret review.

## Before pushing

1. Review the exact staged paths and source hashes. Do not use forced staging to include ignored runtime material.
2. Scan the candidate for credential/private-key patterns. Distinguish deliberately synthetic test data from real credentials; do not print suspected secret values.
3. Run typecheck, the default test entry and the production frontend build. Host-contract tests require the actual `FLIGHTDECK_HOST_ROOT`; do not silently skip them.
4. Verify that a source snapshot without local evidence still builds and passes tests. Reusing installed dependencies does not claim a new clean installation or a new dependency audit.
5. Push the intended branch without force, then read back its exact remote commit.

## Runtime boundary

Pushing source does not restart Studio, its companion or Flightdeck OS; rotate an API key; authorize a reviewer; activate the disabled host bridge; or install a newly built image. The private Studio service and local design preview can therefore differ from the pushed source. Runtime promotion remains a separate, deliberate checkpoint with existing private-data preservation and readback requirements.

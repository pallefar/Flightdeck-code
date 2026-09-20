#!/usr/bin/env bash
# Prove a Studio-generated sub-app actually mounts in the real Flightdeck host.
#
# This is the only test that answers "does it work in Flightdeck?" rather than
# "does it satisfy our idea of Flightdeck's rules". It runs the HOST'S OWN test
# suite with a generated sub-app in SUBAPP_MANIFESTS.
#
# It NEVER writes to the host checkout. It builds a throwaway copy, symlinks the
# host's node_modules (1.1G — copying it would be absurd), and works there. The
# real checkout is read-only input.
set -euo pipefail

HOST="${HOST:-/home/user/project-contract/flightdeck}"
SPEC="${SPEC:-$(dirname "$0")/../fixtures/wc-clock.spec.json}"
SANDBOX="${SANDBOX:-/tmp/fd-sandbox}"
STUDIO="$(cd "$(dirname "$0")/.." && pwd)"

[ -d "$HOST/server/subapps" ] || { echo "not a Flightdeck host: $HOST" >&2; exit 2; }
[ -d "$HOST/node_modules" ] && [ "$(ls "$HOST/node_modules" | wc -l)" -gt 10 ] || {
  echo "host deps missing — run: (cd $HOST && npm install)" >&2; exit 2; }

echo "==> sandbox: copying host (excluding node_modules, .git)"
rm -rf "$SANDBOX"; mkdir -p "$SANDBOX"
tar -C "$HOST" --exclude=node_modules --exclude=.git -cf - . | tar -C "$SANDBOX" -xf -
ln -s "$HOST/node_modules" "$SANDBOX/node_modules"

echo "==> baseline: host fences before we touch anything"
( cd "$SANDBOX" && npx vitest run tests/subapps/subappManifest.test.ts \
    tests/subapps/subappImportClosure.test.ts tests/subapps/i18nSplit.test.ts 2>&1 | tail -4 )

echo "==> generating from $SPEC"
( cd "$STUDIO" && npx tsx packages/codegen/src/cli.ts --spec "$SPEC" --out "$SANDBOX" )

echo "==> applying the emitted registry patch"
( cd "$SANDBOX" && patch -p1 < server/subapps/registry.ts.patch && rm server/subapps/registry.ts.patch )

echo "==> the fences, with a generated sub-app mounted"
cd "$SANDBOX"
npx vitest run tests/subapps/subappManifest.test.ts tests/subapps/i18nSplit.test.ts 2>&1 | tail -4
npx vitest run tests/subapps/subappImportClosure.test.ts tests/subapps/subappCapabilityEscape.test.ts 2>&1 | tail -4
npx vitest run tests/subapps/wc-clock/ 2>&1 | tail -4

echo
echo "==> mounted. The host validated it, not us."

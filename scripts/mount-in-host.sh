#!/usr/bin/env bash
# Prove a Studio-generated sub-app actually mounts in the real Flightdeck host.
#
# This is the only test that answers "does it work in Flightdeck?" rather than
# "does it satisfy our idea of Flightdeck's rules". It runs the HOST'S OWN suite
# with a generated sub-app in SUBAPP_MANIFESTS.
#
# ── WHY THE SANDBOX IS THE WHOLE REPO, NOT JUST flightdeck/ ──────────────
# The first version of this script copied only `flightdeck/`. Six test files
# then failed with ENOENT on paths like
# `/tmp/processes/contracts-de/engine/eval/run_eval.py`, because tests such as
# `tests/subapps/maps/mapsStageD.test.ts` do `path.join(__dirname, "..", "..")`
# to reach `processes/` and `engine/` in the REPO ROOT, one level above
# flightdeck/. Sandboxing flightdeck/ alone puts those hops in /tmp.
#
# Those six failures were not caused by generated code — a clean-baseline run
# reproduced all six — but a harness that fails six files for its own reasons
# cannot tell you whether the seventh is yours. So the sandbox mirrors the repo.
#
# It NEVER writes to the host checkout: the whole repo is COPIED (41M without
# .git/node_modules), and only node_modules — 1.1G, absurd to copy — is
# symlinked. A test that writes, writes into the copy.
set -euo pipefail

REPO="${REPO:-/home/user/project-contract}"
HOST_REL="${HOST_REL:-flightdeck}"
SPEC="${SPEC:-$(cd "$(dirname "$0")/.." && pwd)/fixtures/wc-clock.spec.json}"
ROOT="${SANDBOX:-/tmp/fd-sandbox}"
SANDBOX="$ROOT/$HOST_REL"
STUDIO="$(cd "$(dirname "$0")/.." && pwd)"

[ -d "$REPO/$HOST_REL/server/subapps" ] || { echo "not a Flightdeck repo: $REPO" >&2; exit 2; }
[ "$(ls "$REPO/$HOST_REL/node_modules" 2>/dev/null | wc -l)" -gt 10 ] || {
  echo "host deps missing — run: (cd $REPO/$HOST_REL && npm install)" >&2; exit 2; }

echo "==> sandbox: copying the whole repo (excluding .git, node_modules)"
rm -rf "$ROOT"; mkdir -p "$ROOT"
tar -C "$REPO" --exclude=.git --exclude=node_modules -cf - . | tar -C "$ROOT" -xf -
ln -s "$REPO/$HOST_REL/node_modules" "$SANDBOX/node_modules"

# vitest exits non-zero when ANY test fails, and this script's whole job is to
# compare counts across a run that may legitimately contain pre-existing
# failures. Under `set -e` a bare pipeline here kills the script before the
# comparison it exists to print — which is exactly what happened the first time.
# So: capture to a log, never let the exit status propagate, and report from the
# log. `|| true` is load-bearing, not sloppiness.
fences() {
  local log="$1"
  ( cd "$SANDBOX" && npx vitest run tests/subapps/ >"$log" 2>&1 ) || true
  grep -E "Test Files|Tests " "$log" | tail -2
}

# Three standalone tests assert against the REAL built bundle and say so in
# their own failure message ("run `npm run build:web` — this test measures the
# real bundle"). Without web/dist they fail for a reason that has nothing to do
# with a generated sub-app, and a baseline carrying avoidable failures makes the
# comparison harder to read. It takes ~3s.
echo "==> building the web bundle (3 standalone tests measure the real one)"
( cd "$SANDBOX" && npm run build:web >"$ROOT/build.log" 2>&1 ) || {
  echo "build:web FAILED — see $ROOT/build.log" >&2; exit 1; }

echo "==> baseline: the host's sub-app suite, before we touch anything"
BEFORE="$(fences "$ROOT/before.log")"; echo "$BEFORE"

echo "==> generating from $SPEC"
( cd "$STUDIO" && npx tsx packages/codegen/src/cli.ts --spec "$SPEC" --out "$SANDBOX" )

echo "==> applying the emitted registry patch"
( cd "$SANDBOX" && patch -p1 < server/subapps/registry.ts.patch && rm server/subapps/registry.ts.patch )

echo "==> the same suite, with a generated sub-app mounted"
AFTER="$(fences "$ROOT/after.log")"; echo "$AFTER"

echo
echo "==> compare. Mounting must ADD passing tests and add no failures."
echo "    before: $(echo "$BEFORE" | grep -oE 'Tests .*' || true)"
echo "    after:  $(echo "$AFTER"  | grep -oE 'Tests .*' || true)"
echo
echo "    full logs: $ROOT/before.log  $ROOT/after.log"
echo
echo "    Known environmental failure in this container, present in BOTH runs:"
echo "    tests/subapps/docusign/docusignLibreoffice.test.ts — a real docx->PDF"
echo "    conversion. /usr/bin/soffice exists but the conversion does not"
echo "    succeed here, so the test runs instead of self-skipping. Not ours."

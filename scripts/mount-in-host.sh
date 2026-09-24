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
# It NEVER writes to the host checkout: the sandbox is the host's HEAD commit
# as a history-free, single-commit git checkout — tracked files only, with a
# real .git (scripts/sandbox-lib.sh says why: the host's PII tests need git, and
# neither gitignored person data and secrets nor the person data still in the
# host's history may reach /tmp). Only node_modules — 1.1G, absurd to copy — is
# symlinked. A test that writes, writes into the sandbox.
#
# The sandbox is built under a fresh mode-700 `mktemp -d
# ${TMPDIR:-/tmp}/fd-studio.XXXXXX` and removed on exit, however the run ends
# (FLIGHTDECK_KEEP_SANDBOX=1 keeps it and prints where). The logs go to a
# mode-700 .studio/runs/<stamp>-mount.* in this checkout (gitignored), which
# outlives the sandbox. SANDBOX=<path> still names it explicitly; that path is
# then yours and is kept (scripts/sandbox-lib.sh).
set -euo pipefail

REPO="${REPO:-/home/user/project-contract}"
HOST_REL="${HOST_REL:-flightdeck}"
SPEC="${SPEC:-$(cd "$(dirname "$0")/.." && pwd)/fixtures/wc-clock.spec.json}"
STUDIO="$(cd "$(dirname "$0")/.." && pwd)"
. "$STUDIO/scripts/sandbox-lib.sh"

[ -d "$REPO/$HOST_REL/server/subapps" ] || { echo "not a Flightdeck repo: $REPO" >&2; exit 2; }
[ "$(ls "$REPO/$HOST_REL/node_modules" 2>/dev/null | wc -l)" -gt 10 ] || {
  echo "host deps missing — run: (cd $REPO/$HOST_REL && npm install)" >&2; exit 2; }

sandbox_new_run_dir "$STUDIO" mount || exit 2
RUN_DIR="$SANDBOX_RUN_DIR"
if [ -n "${SANDBOX:-}" ]; then
  ROOT="$SANDBOX"
else
  sandbox_new_parent || exit 2
  ROOT="$SANDBOX_PARENT/sandbox"
fi
SANDBOX="$ROOT/$HOST_REL"
echo "==> run logs: $RUN_DIR"

echo "==> sandbox: the whole repo at HEAD, one commit (tracked files only)"
sandbox_from_tracked "$REPO" "$ROOT"
ln -s "$REPO/$HOST_REL/node_modules" "$SANDBOX/node_modules"

# vitest exits non-zero when ANY test fails, and this script's whole job is to
# compare counts across a run that may legitimately contain pre-existing
# failures. Under `set -e` a bare pipeline here kills the script before the
# comparison it exists to print — which is exactly what happened the first time.
# So: capture to a log, never let the exit status propagate, and report from the
# log. `|| true` is load-bearing, not sloppiness.
#
# ⛔ The POSTGRES_* unsets and the AUTH/WORKSPACES pins are the host gate's own
# fence (scripts/gate.sh, stack 2), copied because this runs the same suite:
# with POSTGRES_ENABLED/POSTGRES_DSN/SUPABASE_TEST_DSN in the environment, an
# app-boot test with a fixture root binds the live workspace and the indexers
# prune it — the 2026-08-20 data loss. This script used to pass the caller's
# environment straight through, so an operator who had exported them for a
# server run armed that against the live database.
fences() {
  local log="$1"
  ( cd "$SANDBOX" \
    && unset POSTGRES_ENABLED POSTGRES_DSN SUPABASE_TEST_DSN \
    && AUTH_REQUIRED=false WORKSPACES_ENABLED=false npx vitest run tests/subapps/ >"$log" 2>&1 ) || true
  # `|| true` again: a run that crashed before its summary must reach the
  # comparison below (which fails it) rather than kill the script under set -e.
  { grep -E "Test Files|Tests " "$log" || true; } | tail -2
}

# count WHAT LINE — the N in "N what" on a vitest "Tests" summary line; 0 if
# absent. "expected fail" is not "failed", so it never counts as one.
count() { printf '%s\n' "$2" | grep -oE "[0-9]+ $1" | head -1 | grep -oE '^[0-9]+' || echo 0; }

# The failing tests a run named, one per line, sorted.
failing() { grep -E '^ *FAIL ' "$1" | sed -E 's/^ *FAIL +//; s/ +[0-9]+m?s$//' | sort -u; }

# Three standalone tests assert against the REAL built bundle and say so in
# their own failure message ("run `npm run build:web` — this test measures the
# real bundle"). Without web/dist they fail for a reason that has nothing to do
# with a generated sub-app, and a baseline carrying avoidable failures makes the
# comparison harder to read. It takes ~3s.
echo "==> building the web bundle (3 standalone tests measure the real one)"
( cd "$SANDBOX" && npm run build:web >"$RUN_DIR/build.log" 2>&1 ) || {
  echo "build:web FAILED — see $RUN_DIR/build.log" >&2; exit 1; }

echo "==> baseline: the host's sub-app suite, before we touch anything"
BEFORE="$(fences "$RUN_DIR/before.log")"; echo "$BEFORE"

echo "==> generating from $SPEC"
( cd "$STUDIO" && npx tsx packages/codegen/src/cli.ts --spec "$SPEC" --out "$SANDBOX" )

echo "==> applying the emitted registry patch"
( cd "$SANDBOX" && patch -p1 < server/subapps/registry.ts.patch && rm server/subapps/registry.ts.patch )

echo "==> the same suite, with a generated sub-app mounted"
AFTER="$(fences "$RUN_DIR/after.log")"; echo "$AFTER"

echo
echo "==> compare. Mounting must ADD passing tests and add no failures."
B_TESTS="$(echo "$BEFORE" | grep -oE 'Tests .*' || true)"
A_TESTS="$(echo "$AFTER"  | grep -oE 'Tests .*' || true)"
echo "    before: $B_TESTS"
echo "    after:  $A_TESTS"
echo
echo "    full logs: $RUN_DIR/before.log  $RUN_DIR/after.log"
echo

# Enforced, not just printed: the script used to say the rule above and exit 0
# whatever the numbers were. Its first Mac run (host c44d665b) went from 0 to
# 1 failed with the sub-app mounted and reported success. A test failing in
# BOTH runs (the Linux container's docusignLibreoffice, say) is the host's and
# is not held against the candidate; a test failing only AFTER is.
PROBLEMS=""
[ -n "$B_TESTS" ] || PROBLEMS="$PROBLEMS\n    the baseline run printed no Tests summary — see $RUN_DIR/before.log"
[ -n "$A_TESTS" ] || PROBLEMS="$PROBLEMS\n    the mounted run printed no Tests summary — see $RUN_DIR/after.log"
if [ -n "$B_TESTS" ] && [ -n "$A_TESTS" ]; then
  B_FAIL="$(count failed "$B_TESTS")"; A_FAIL="$(count failed "$A_TESTS")"
  B_PASS="$(count passed "$B_TESTS")"; A_PASS="$(count passed "$A_TESTS")"
  [ "$A_FAIL" -le "$B_FAIL" ] || PROBLEMS="$PROBLEMS\n    failures went from $B_FAIL to $A_FAIL"
  [ "$A_PASS" -gt "$B_PASS" ] || PROBLEMS="$PROBLEMS\n    passing tests went from $B_PASS to $A_PASS — mounting added none"
  NEW_FAILS="$(comm -13 <(failing "$RUN_DIR/before.log") <(failing "$RUN_DIR/after.log"))"
  [ -z "$NEW_FAILS" ] || PROBLEMS="$PROBLEMS\n    failing only with the sub-app mounted:$(printf '%s\n' "$NEW_FAILS" | sed 's/^/\n      /')"
  PRE_FAILS="$(comm -12 <(failing "$RUN_DIR/before.log") <(failing "$RUN_DIR/after.log"))"
  [ -z "$PRE_FAILS" ] || printf '    failing in BOTH runs (the host'"'"'s, not the candidate'"'"'s):\n%s\n' "$(printf '%s\n' "$PRE_FAILS" | sed 's/^/      /')"
fi
if [ -n "$PROBLEMS" ]; then
  printf 'MOUNT FAILED:%b\n' "$PROBLEMS"
  exit 1
fi
echo "MOUNT OK — mounting added $((A_PASS - B_PASS)) passing test(s) and no failure."

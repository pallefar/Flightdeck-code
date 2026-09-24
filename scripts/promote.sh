#!/usr/bin/env bash
# promote.sh — the production-readiness gate for a Studio-generated mini-app.
#
# "Ready for production" here means one thing: the HOST'S OWN compliance gate
# (scripts/gate.sh, five stacks including the PII boundary check and the Python
# engine eval) is green WITH the candidate mini-app mounted — plus Studio's own
# conformance and guardrail gates. Studio does not get to define compliance for
# Flightdeck; Flightdeck already did, and this script submits to it.
#
# ── TWO DISCIPLINES COPIED FROM scripts/gate.sh, DELIBERATELY ─────────────
#
# 1. NOT `set -e`. Every stack must be attempted and the result aggregated, not
#    stopped at the first failure. This script exits non-zero if ANY stack
#    fails. (I shipped a version of mount-in-host.sh that died under `set -e`
#    before printing its own comparison and reported exit 0 while running
#    nothing. Hence the emphasis.)
#
# 2. A SKIP IS REPORTED, ALWAYS — and a skip is never green. gate.sh's own
#    words: "a green gate that quietly exercised one engine fewer than it looks
#    like it did is the thing this file was just changed to stop being
#    possible." A promotion record that hides a skipped stack is worse than no
#    record, because someone signs it.
#
# NEVER writes to the host checkout. The sandbox is the host's HEAD commit as
# a history-free, single-commit git checkout — tracked files only, with a real
# .git, because the host gate's PII stack needs git, and must never see
# gitignored person data, secrets, or the person data still in the host's
# history (scripts/sandbox-lib.sh says why). The host's piiGitBoundary.test.ts
# also asserts the gitignored PII files exist on disk, which a PII-free sandbox
# never satisfies, so step [5/6] hands the gate FLIGHTDECK_PII_HOST_ROOT=$REPO
# and those checks read the real host checkout, read-only; a host that predates
# that variable still records host-gate FAIL. The whole repo, not just
# flightdeck/: tests reach above flightdeck/ into processes/ and engine/.
# node_modules is symlinked; flightdeck/.env.supabase is the one ignored file
# brought in, mode 600, only for the host gate step, and removed again right
# after it (sandbox_run_host_gate; FLIGHTDECK_GATE_POSTGRES=0 keeps it out
# entirely).
#
# WHERE THINGS GO (scripts/sandbox-lib.sh): the sandbox is built under a fresh
# mode-700 `mktemp -d ${TMPDIR:-/tmp}/fd-studio.XXXXXX` and removed on exit,
# however the run ends (FLIGHTDECK_KEEP_SANDBOX=1 keeps it and prints where).
# Logs and the compliance record go to a mode-700 .studio/runs/<stamp>-promote.*
# in this checkout (gitignored), which outlives the sandbox. SANDBOX=<path>
# still names the sandbox explicitly; that path is then yours and is kept, and
# an existing non-empty one is replaced only if it carries the studio-sandbox
# marker a previous run wrote.
#
# Usage: HOST_REPO=/path/to/project-contract SPEC=fixtures/x.spec.json \
#        bash scripts/promote.sh
set -uo pipefail

STUDIO="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${HOST_REPO:-/home/user/project-contract}"
SPEC="${SPEC:-$STUDIO/fixtures/wc-clock.spec.json}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
. "$STUDIO/scripts/sandbox-lib.sh"

FAILED=""; SKIPPED=""; PASSED=""
note_pass() { PASSED="$PASSED $1"; echo "PASS: $1"; }
note_fail() { FAILED="$FAILED $1"; echo "FAIL: $1"; }
note_skip() { SKIPPED="$SKIPPED $1"; echo "SKIP: $1 — $2"; }

[ -d "$REPO/flightdeck/server/subapps" ] || { echo "not a Flightdeck repo: $REPO" >&2; exit 2; }
[ -f "$SPEC" ] || { echo "no spec at $SPEC" >&2; exit 2; }

sandbox_new_run_dir "$STUDIO" promote || exit 2
RUN_DIR="$SANDBOX_RUN_DIR"
if [ -n "${SANDBOX:-}" ]; then
  ROOT="$SANDBOX"
else
  sandbox_new_parent || exit 2
  ROOT="$SANDBOX_PARENT/sandbox"
fi
SANDBOX="$ROOT/flightdeck"
RECORD="${RECORD:-$RUN_DIR/compliance-record.json}"
echo "run logs: $RUN_DIR"

echo "==> [0/6] sandbox"
sandbox_from_tracked "$REPO" "$ROOT" || { echo "could not build the sandbox from $REPO's HEAD" >&2; exit 2; }
if [ "$(ls "$REPO/flightdeck/node_modules" 2>/dev/null | wc -l)" -gt 10 ]; then
  ln -s "$REPO/flightdeck/node_modules" "$SANDBOX/node_modules"
else
  echo "host deps missing — run: (cd $REPO/flightdeck && npm install)" >&2; exit 2
fi
SPEC_HASH="$(sha256sum "$SPEC" | cut -d' ' -f1)"
echo "spec sha256: $SPEC_HASH"

echo "==> [1/6] Studio typecheck + tests"
# The guardrail divergence tests read the host's security lists from
# FLIGHTDECK_HOST_ROOT (packages/guardrails/src/host-source.ts), which defaults
# to /home/user/project-contract. This script is told where the host is via
# HOST_REPO, so it hands that on: without it, on any machine where the host is
# not at the Linux default (the Mac), the suite checked the lists against a path
# that does not exist and this stack failed for the script's reasons, not
# Studio's. An explicitly set FLIGHTDECK_HOST_ROOT still wins.
HOST_ROOT="${FLIGHTDECK_HOST_ROOT:-$REPO}"
if ( cd "$STUDIO" && FLIGHTDECK_HOST_ROOT="$HOST_ROOT" npx tsc --noEmit && \
     FLIGHTDECK_HOST_ROOT="$HOST_ROOT" npx vitest run >"$RUN_DIR/studio-tests.log" 2>&1 ); then
  note_pass "studio-suite"
else
  note_fail "studio-suite"
fi

echo "==> [2/6] Studio conformance red-team (planted violations must all block)"
# ⚠ THIS CHECK WAS BROKEN IN BOTH DIRECTIONS, and a real run found it.
#
#   grep -qE '^[0-9]+/\1? ?planted|planted violations produced a BLOCKING finding'
#
# 1. `\1` is a BACK-REFERENCE, which ERE does not have. GNU grep answered
#    "Invalid back reference" and exited non-zero, so this stack reported
#    FAIL on a run whose red-team had just printed "7/7 planted violations
#    produced a BLOCKING finding". promote.sh could therefore never report
#    ready, and the compliance record could never say so either.
# 2. Had the pattern been valid it would have been worse: the second
#    alternative matches the SENTENCE with no count in it at all, so
#    "0/7 planted violations produced a BLOCKING finding" — every planted
#    violation slipping through — matches and passes.
#
# Replaced with an explicit comparison: the two numbers must be equal AND
# non-zero. No regex cleverness, and nothing that passes when the run found
# nothing.
if ( cd "$STUDIO" && npm run redteam >"$RUN_DIR/redteam.log" 2>&1 ); then
  SUMMARY="$(grep -oE '[0-9]+/[0-9]+ planted violations produced a BLOCKING finding' "$RUN_DIR/redteam.log" | tail -1)"
  RT_GOT="${SUMMARY%%/*}"
  RT_WANT="$(printf '%s' "${SUMMARY#*/}" | cut -d' ' -f1)"
  if [ -n "$SUMMARY" ] && [ "$RT_GOT" = "$RT_WANT" ] && [ "${RT_GOT:-0}" -gt 0 ] 2>/dev/null; then
    echo "  $SUMMARY"
    # The red-team's OWN skips, surfaced. This script's doctrine is that a
    # skip is never invisible; that applies to a stack's internals too.
    RT_SKIPS="$(grep -c '^  SKIP' "$RUN_DIR/redteam.log" || true)"
    [ "${RT_SKIPS:-0}" -gt 0 ] && echo "  note: red-team skipped $RT_SKIPS planted case(s) — see $RUN_DIR/redteam.log"
    note_pass "conformance-redteam"
  else
    note_fail "conformance-redteam"; echo "  no 'N/N planted' summary with N>0 — see $RUN_DIR/redteam.log"
  fi
else
  note_fail "conformance-redteam"; echo "  the red-team run itself failed — see $RUN_DIR/redteam.log"
fi

echo "==> [3/6] generate + mount the candidate"
if ( cd "$STUDIO" && npx tsx packages/codegen/src/cli.ts --spec "$SPEC" --out "$SANDBOX" >"$RUN_DIR/codegen.log" 2>&1 ) && \
   ( cd "$SANDBOX" && patch -p1 <server/subapps/registry.ts.patch >>"$RUN_DIR/codegen.log" 2>&1 && rm server/subapps/registry.ts.patch ); then
  note_pass "generate-and-mount"
else
  note_fail "generate-and-mount"; echo "  see $RUN_DIR/codegen.log"
fi

echo "==> [4/6] web bundle (three standalone tests measure the real one)"
if ( cd "$SANDBOX" && npm run build:web >"$RUN_DIR/build.log" 2>&1 ); then
  note_pass "build-web"
else
  note_fail "build-web"
fi

echo "==> [5/6] THE HOST'S OWN GATE — scripts/gate.sh, all five stacks"
# This is the load-bearing stack. Everything above is Studio checking itself.
# sandbox_run_host_gate brings in flightdeck/.env.supabase for this step only
# (its Postgres tier reads it) and removes it again, and hands the gate
# FLIGHTDECK_PII_HOST_ROOT (this host, read-only); see scripts/sandbox-lib.sh.
sandbox_run_host_gate "$REPO" "$ROOT" "$RUN_DIR/host-gate.log"
HOST_GATE_RC=$?
if grep -q '^SKIPPED STACKS:' "$RUN_DIR/host-gate.log"; then
  note_skip "host-gate-partial" "$(grep '^SKIPPED STACKS:' "$RUN_DIR/host-gate.log")"
fi
if [ "$HOST_GATE_RC" -eq 0 ]; then
  note_pass "host-gate"
else
  note_fail "host-gate"; grep -E '^(FAILED STACKS|FAIL):' "$RUN_DIR/host-gate.log" | head -5
fi

echo "==> [6/6] compliance record"
python3 - "$RECORD" "$STAMP" "$SPEC_HASH" "$PASSED" "$FAILED" "$SKIPPED" <<'PY'
import json, sys
record, stamp, spec_hash, passed, failed, skipped = sys.argv[1:7]
split = lambda s: [x for x in s.split() if x]
f, s = split(failed), split(skipped)
json.dump({
    "schema": "studio-compliance-record/1",
    "at": stamp,
    "specSha256": spec_hash,
    "passed": split(passed), "failed": f, "skipped": s,
    # A skip is NEVER green. Both conditions must hold.
    "readyForProduction": not f and not s,
    "verdict": ("ready" if not f and not s else
                "BLOCKED — stacks failed" if f else
                "NOT CERTIFIED — stacks were skipped, so this run does not cover them"),
    "note": "Signed off by a human only after reading the stack list. A skipped stack is not a passed stack.",
}, open(record, "w"), indent=2)
print(json.dumps(json.load(open(record)), indent=2))
PY

echo
echo "==> Promotion summary"
[ -n "$SKIPPED" ] && echo "SKIPPED:$SKIPPED  (green below does NOT cover these)"
if [ -z "$FAILED" ] && [ -z "$SKIPPED" ]; then
  echo "READY FOR PRODUCTION — every stack ran and passed. Record: $RECORD"; exit 0
elif [ -z "$FAILED" ]; then
  echo "NOT CERTIFIED — all run stacks green, but stacks were skipped. Record: $RECORD"; exit 1
else
  echo "BLOCKED — FAILED STACKS:$FAILED. Record: $RECORD"; exit 1
fi

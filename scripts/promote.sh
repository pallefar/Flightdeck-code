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
# NEVER writes to the host checkout. Copies the whole repo (tests reach above
# flightdeck/ into processes/ and engine/), symlinks node_modules.
#
# Usage: HOST_REPO=/path/to/project-contract SPEC=fixtures/x.spec.json \
#        bash scripts/promote.sh
set -uo pipefail

STUDIO="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${HOST_REPO:-/home/user/project-contract}"
SPEC="${SPEC:-$STUDIO/fixtures/wc-clock.spec.json}"
ROOT="${SANDBOX:-/tmp/fd-promote}"
SANDBOX="$ROOT/flightdeck"
RECORD="${RECORD:-$ROOT/compliance-record.json}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

FAILED=""; SKIPPED=""; PASSED=""
note_pass() { PASSED="$PASSED $1"; echo "PASS: $1"; }
note_fail() { FAILED="$FAILED $1"; echo "FAIL: $1"; }
note_skip() { SKIPPED="$SKIPPED $1"; echo "SKIP: $1 — $2"; }

[ -d "$REPO/flightdeck/server/subapps" ] || { echo "not a Flightdeck repo: $REPO" >&2; exit 2; }
[ -f "$SPEC" ] || { echo "no spec at $SPEC" >&2; exit 2; }

echo "==> [0/6] sandbox"
rm -rf "$ROOT"; mkdir -p "$ROOT"
tar -C "$REPO" --exclude=.git --exclude=node_modules -cf - . | tar -C "$ROOT" -xf -
if [ "$(ls "$REPO/flightdeck/node_modules" 2>/dev/null | wc -l)" -gt 10 ]; then
  ln -s "$REPO/flightdeck/node_modules" "$SANDBOX/node_modules"
else
  echo "host deps missing — run: (cd $REPO/flightdeck && npm install)" >&2; exit 2
fi
SPEC_HASH="$(sha256sum "$SPEC" | cut -d' ' -f1)"
echo "spec sha256: $SPEC_HASH"

echo "==> [1/6] Studio typecheck + tests"
if ( cd "$STUDIO" && npx tsc --noEmit && npx vitest run >"$ROOT/studio-tests.log" 2>&1 ); then
  note_pass "studio-suite"
else
  note_fail "studio-suite"
fi

echo "==> [2/6] Studio conformance red-team (planted violations must all block)"
if ( cd "$STUDIO" && npm run redteam >"$ROOT/redteam.log" 2>&1 ) && \
   grep -qE '^[0-9]+/\1? ?planted|planted violations produced a BLOCKING finding' "$ROOT/redteam.log"; then
  tail -1 "$ROOT/redteam.log"
  note_pass "conformance-redteam"
else
  note_fail "conformance-redteam"
fi

echo "==> [3/6] generate + mount the candidate"
if ( cd "$STUDIO" && npx tsx packages/codegen/src/cli.ts --spec "$SPEC" --out "$SANDBOX" >"$ROOT/codegen.log" 2>&1 ) && \
   ( cd "$SANDBOX" && patch -p1 <server/subapps/registry.ts.patch >>"$ROOT/codegen.log" 2>&1 && rm server/subapps/registry.ts.patch ); then
  note_pass "generate-and-mount"
else
  note_fail "generate-and-mount"; echo "  see $ROOT/codegen.log"
fi

echo "==> [4/6] web bundle (three standalone tests measure the real one)"
if ( cd "$SANDBOX" && npm run build:web >"$ROOT/build.log" 2>&1 ); then
  note_pass "build-web"
else
  note_fail "build-web"
fi

echo "==> [5/6] THE HOST'S OWN GATE — scripts/gate.sh, all five stacks"
# This is the load-bearing stack. Everything above is Studio checking itself.
( cd "$ROOT" && bash scripts/gate.sh >"$ROOT/host-gate.log" 2>&1 )
HOST_GATE_RC=$?
if grep -q '^SKIPPED STACKS:' "$ROOT/host-gate.log"; then
  note_skip "host-gate-partial" "$(grep '^SKIPPED STACKS:' "$ROOT/host-gate.log")"
fi
if [ "$HOST_GATE_RC" -eq 0 ]; then
  note_pass "host-gate"
else
  note_fail "host-gate"; grep -E '^(FAILED STACKS|FAIL):' "$ROOT/host-gate.log" | head -5
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

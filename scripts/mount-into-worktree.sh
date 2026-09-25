#!/usr/bin/env bash
# Mount a Studio-generated sub-app INTO an OS worktree a person will run.
#
#   bash scripts/mount-into-worktree.sh --spec <app.spec.json> --host <OS worktree>
#
# The three ways a generated app meets the host, and which one this is:
#   mount-in-host.sh       a throwaway sandbox; proves the host suite stays green
#   promote.sh             the host repo itself, behind a studio-compliance-record/1
#   mount-into-worktree.sh THIS: a linked git worktree you then boot and click through
#
# ⭐ FROM THE SPEC, NEVER FROM EDITED FILES (ruling 8). The workbench's
# "Download spec" button saves the spec; this regenerates from it with the
# same codegen CLI promote.sh uses, so what lands is exactly what the
# approved catalogue produces.
#
# ⛔ A LINKED WORKTREE ONLY. A main checkout (its `.git` is a directory) is
# refused: the owner's standing rule is that main checkouts are never
# edited by an agent or a tool. A worktree is disposable and reviewable
# (`git status` shows exactly what landed).
#
# ⛔ OFF BY DEFAULT (D-036). The generated manifest carries
# generatedBy: "flightdeck-studio"; this script never sets the kill switch
# and never edits a launcher. It prints the two steps an operator takes:
# start the OS with SUBAPP_<ID>_ENABLED=true, then an admin enables the app
# for a workspace in the Catalog.
#
# Idempotent: the codegen CLI treats an identical re-run as a no-op, and the
# registry patch is skipped when the registry already imports the app.
#
# After mounting it runs the host's own proof, with the host gate's fences
# (no POSTGRES_* in the environment — the 2026-08-20 data loss): the
# generated app's conformance test, the platform conformance kit, and
# studioGeneratedSubapps.test.ts (off by default → admin enable → 200).
# MOUNT_SKIP_HOST_TESTS=1 skips that (Studio's own test of this script).
#
# Exit codes: 0 mounted (or already mounted) · 1 the host proof failed ·
# 2 bad usage or a refused target · 3 codegen refused the write.
set -euo pipefail

STUDIO="$(cd "$(dirname "$0")/.." && pwd)"
SPEC=""
HOST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) SPEC="${2:-}"; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
    *) echo "mount-into-worktree: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$SPEC" ] && [ -n "$HOST" ] || { echo "usage: mount-into-worktree.sh --spec <spec.json> --host <OS worktree>" >&2; exit 2; }
[ -f "$SPEC" ] || { echo "mount-into-worktree: no spec at $SPEC" >&2; exit 2; }
SPEC="$(cd "$(dirname "$SPEC")" && pwd)/$(basename "$SPEC")"
HOST="$(cd "$HOST" 2>/dev/null && pwd)" || { echo "mount-into-worktree: no directory $HOST" >&2; exit 2; }

FD="$HOST/flightdeck"
[ -f "$FD/server/subapps/registry.ts" ] || { echo "mount-into-worktree: not a Flightdeck checkout: $HOST" >&2; exit 2; }
if [ ! -f "$HOST/.git" ]; then
  echo "mount-into-worktree: $HOST is not a linked git worktree (its .git is not a file) — main checkouts are never written; create one with: git -C <repo> worktree add <path> -b <branch>" >&2
  exit 2
fi

ID="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(typeof s.id!=="string"||!/^[a-z0-9][a-z0-9-]*$/.test(s.id)) process.exit(1); process.stdout.write(s.id)' "$SPEC")" || {
  echo "mount-into-worktree: the spec names no valid id" >&2; exit 2; }
ENV_VAR="SUBAPP_$(printf '%s' "$ID" | tr 'a-z-' 'A-Z_')_ENABLED"

echo "==> generating $ID from $SPEC into $FD"
( cd "$STUDIO" && npx tsx packages/codegen/src/cli.ts --spec "$SPEC" --out "$FD" ) || {
  echo "mount-into-worktree: codegen refused the write (see above)" >&2; exit 3; }

PATCH="$FD/server/subapps/registry.ts.patch"
if grep -q "from \"./$ID/manifest.js\"" "$FD/server/subapps/registry.ts"; then
  echo "==> registry already imports $ID — patch skipped"
  rm -f "$PATCH"
elif [ -f "$PATCH" ]; then
  echo "==> applying the emitted registry patch"
  ( cd "$FD" && patch -p1 --forward --quiet < server/subapps/registry.ts.patch ) || {
    echo "mount-into-worktree: the registry patch did not apply cleanly — $PATCH is left for you to read" >&2; exit 3; }
  rm -f "$PATCH"
else
  echo "mount-into-worktree: codegen emitted no registry patch and the registry does not import $ID" >&2
  exit 3
fi

if [ "${MOUNT_SKIP_HOST_TESTS:-}" != "1" ]; then
  echo "==> the host's proof: conformance + off-by-default + admin-enable-loads"
  TESTS=(tests/subapps/sdkConformance.test.ts tests/subapps/studioGeneratedSubapps.test.ts)
  [ -d "$FD/tests/subapps/$ID" ] && TESTS+=("tests/subapps/$ID")
  ( cd "$FD" \
    && unset POSTGRES_ENABLED POSTGRES_DSN SUPABASE_TEST_DSN \
    && AUTH_REQUIRED=false WORKSPACES_ENABLED=false npx vitest run "${TESTS[@]}" ) || {
    echo "mount-into-worktree: the host's proof FAILED with $ID mounted" >&2; exit 1; }
fi

cat <<EOF

MOUNTED $ID into $HOST (git status there shows exactly what landed).

It is OFF by default (D-036). To run it:
  1. start that OS with the kill switch on:   $ENV_VAR=true
  2. sign in as a workspace admin, open Catalog, and enable "$ID" for the workspace
     (the consent screen lists the scopes its manifest declares).
EOF

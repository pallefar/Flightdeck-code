#!/usr/bin/env bash
# Does a generated sub-app actually run OUTSIDE Flightdeck OS?
#
# Not "does it emit a harness" — `standalone.test.ts` asks that, and it can
# only ever prove things about text. This generates a real tree, typechecks
# it against its own tsconfig, builds the bundle, boots the server and drives
# the page with a real browser. Four rounds of MODULE_NOT_FOUND and four type
# errors were found this way and by no other means, including one the tests
# could not have found because the app RAN while it did not COMPILE.
#
# Run it with no arguments and it covers every fixture — see SPECS below.
#
# `set -uo pipefail` and never `-e`: this script's whole job is to run things
# that may fail and then report. An `-e` here would exit before the summary,
# which is the failure mode scripts/promote.sh was written to avoid.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ⭐ ALL THE FIXTURES BY DEFAULT, NOT ONE.
#
# This ran against wc-clock alone for its whole first life, and wc-clock alone
# is what made it look finished. The second spec found a type error (a shim
# narrower than the host's own `principal`), and the third found that the check
# itself encoded one fixture's shape — it required a contracts table on a page
# that renders a step rail. One fixture proves one fixture.
#
# `npm run standalone` therefore covers every profile: the DB-free mini-app,
# the table path, and a converted Cowork workflow. Pass a path to run just one.
if [[ $# -gt 0 ]]; then
  SPECS=("$@")
else
  SPECS=()
  while IFS= read -r f; do SPECS+=("$f"); done < <(find "$REPO/fixtures" -name '*.spec.json' | sort)
fi

if [[ ${#SPECS[@]} -gt 1 ]]; then
  RC=0
  for spec in "${SPECS[@]}"; do
    printf '\n════════ %s ════════\n' "$(basename "$spec" .spec.json)"
    PORT=$(( ${PORT:-5199} + RANDOM % 200 )) bash "${BASH_SOURCE[0]}" "$spec" || RC=1
  done
  exit $RC
fi

SPEC="${SPECS[0]}"
WORK="$(mktemp -d)"
PORT="${PORT:-5199}"
HOST_TREE="$WORK/host"
ALONE="$WORK/standalone-tree"
FAILED=()
step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '    ok   %s\n' "$1"; }
bad()  { printf '    FAIL %s\n' "$1"; FAILED+=("$1"); }

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$HOST_TREE" "$ALONE"

step "generate both trees from $(basename "$SPEC")"
if npx tsx "$REPO/packages/codegen/src/cli.ts" --spec "$SPEC" --out "$HOST_TREE" --standalone "$ALONE" > "$WORK/gen.log" 2>&1; then
  ok "generated"
else
  bad "codegen refused"; sed 's/^/    /' "$WORK/gen.log"; exit 1
fi

step "the sub-app's own files are byte-identical in both trees"
DIFFS=0
while IFS= read -r rel; do
  if ! cmp -s "$HOST_TREE/$rel" "$ALONE/$rel"; then bad "differs: $rel"; DIFFS=$((DIFFS+1)); fi
done < <(cd "$HOST_TREE" && find . -type f -not -path "./.flightdeck-codegen/*" -not -name "*.patch" | sed 's|^\./||')
[[ $DIFFS -eq 0 ]] && ok "every host file matches its standalone copy"

ln -sfn "$REPO/node_modules" "$ALONE/node_modules"

step "the standalone tree typechecks on ITS OWN tsconfig"
# The tree that runs is not the tree this repo typechecks. Four type errors
# lived here while the app served HTTP 200 — running is not compiling.
if (cd "$ALONE" && npx tsc --noEmit -p standalone/tsconfig.json > "$WORK/tsc.log" 2>&1); then
  ok "tsc --noEmit clean"
else
  bad "tsc errors"; head -20 "$WORK/tsc.log" | sed 's/^/    /'
fi

step "the web bundle builds"
if (cd "$ALONE" && npx vite build --config standalone/vite.config.ts > "$WORK/vite.log" 2>&1); then
  ok "$(grep -c 'modules transformed' "$WORK/vite.log" > /dev/null && grep -o '[0-9]* modules transformed' "$WORK/vite.log" | head -1)"
else
  bad "vite build"; tail -12 "$WORK/vite.log" | sed 's/^/    /'
fi

ENV_VAR="$(grep -o 'SUBAPP_[A-Z0-9_]*_ENABLED' "$ALONE/standalone/server.ts" | head -1)"

step "the enablement gate refuses when $ENV_VAR is unset"
REFUSAL="$( (cd "$ALONE" && timeout 30 npx tsx standalone/server.ts --allow-anonymous --port="$PORT" 2>&1) | head -1 )"
if [[ "$REFUSAL" == *"is not set to true"* ]]; then
  ok "refused, and said why"
else
  bad "started (or failed differently) without the env var: $REFUSAL"
fi

step "boot with real data, then drive it with a real browser"
mkdir -p "$ALONE/data/contracts/TE-4711-acme-gmbh" "$ALONE/data/contracts/TE-4712-globex-ag"
# `exec`, so $! IS the server's process chain (npm exec → tsx → node) and not
# a subshell wrapped around it. Without it, cleanup killed only the subshell
# and left the server listening on $PORT after every run — one orphan per
# fixture, found the first time this ran on a Mac.
(cd "$ALONE" && exec env "$ENV_VAR=true" npx tsx standalone/server.ts --allow-anonymous --port="$PORT" --data="$ALONE/data" > "$WORK/server.log" 2>&1) &
SERVER_PID=$!
for _ in $(seq 1 30); do
  curl -sf -m 2 "http://127.0.0.1:$PORT/healthz" > /dev/null 2>&1 && break
  sleep 1
done

if curl -sf -m 5 "http://127.0.0.1:$PORT/healthz" > "$WORK/health.json" 2>/dev/null; then
  ok "healthz: $(head -c 120 "$WORK/health.json")"
else
  bad "server never came up"; tail -12 "$WORK/server.log" | sed 's/^/    /'
fi

if [[ -f "$REPO/scripts/standalone-smoke.mjs" ]]; then
  if node "$REPO/scripts/standalone-smoke.mjs" "http://127.0.0.1:$PORT/" > "$WORK/browser.json" 2>&1; then
    ok "browser rendered the page"
    sed 's/^/    /' "$WORK/browser.json"
  else
    bad "browser check"; sed 's/^/    /' "$WORK/browser.json"
  fi
else
  bad "scripts/standalone-smoke.mjs is missing — the browser half did not run"
fi

printf '\n==> summary\n'
if [[ ${#FAILED[@]} -eq 0 ]]; then
  printf '    STANDALONE WORKS — generated, identical, typechecked, built, gated, served, rendered.\n'
  exit 0
fi
printf '    %d check(s) failed:\n' "${#FAILED[@]}"
for f in "${FAILED[@]}"; do printf '      - %s\n' "$f"; done
exit 1

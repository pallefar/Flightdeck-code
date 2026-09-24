# sandbox-lib.sh — sourced by scripts/promote.sh and scripts/mount-in-host.sh.
# Not executable on its own. Test: scripts/__tests__/sandbox.test.ts.
#
# ⛔ THE SANDBOX IS THE HOST'S HEAD COMMIT, AS A HISTORY-FREE, SINGLE-COMMIT
#    GIT CHECKOUT — TRACKED FILES ONLY, NOTHING ELSE.
#
# Both scripts used to build it with
#   tar -C "$REPO" --exclude=.git --exclude=node_modules -cf - . | tar -C "$ROOT" -xf -
# which was wrong in both directions at once:
#   1. It stripped .git, so the host's git-based PII checks could not run in
#      the sandbox: tests/piiGitBoundary.test.ts refuses to run outside a real
#      git checkout, and check-contracts-boundary.sh --tracked lists
#      `git ls-files`.
#   2. It copied everything .gitignore exists to keep out — the loose
#      person-bearing contracts under contracts/, flightdeck/.env and
#      flightdeck/.env.supabase — into /tmp, world-readable.
#
#   3. (Found in review of the first fix.) A full `git clone` is no better: it
#      copies the host's WHOLE object store. The host's history still holds
#      person-bearing contracts that were committed in the canonical baseline
#      and removed later, so `git show <sha>:<path>` in the sandbox would hand
#      them back. The sandbox therefore fetches the HEAD commit alone, depth 1:
#      one commit, and only the blobs of its tree.
#
# Its own repo, not `git worktree add`: a worktree registers itself in the
# HOST's .git and shares its object store, so a sandbox commit or gc would write
# into the host. `git init` + a depth-1 fetch reads the host and writes only
# under $ROOT, and there is no remote to push back to. The host's git-based PII
# checks need no history (check-ignore, ls-files, diff --cached).
#
# The host gate's flightdeck/tests/piiGitBoundary.test.ts also asserts that
# gitignored files EXIST on disk — contracts/INDEX.json, app/data/status.js and
# the five loose real-person contracts under contracts/. A PII-free sandbox
# leaves exactly those out, by design (measured against host 9d25a078: 6 of 40
# failed). CLOSED by option (c), keeping both the gate and the fence at full
# strength: sandbox_run_host_gate hands the gate FLIGHTDECK_PII_HOST_ROOT, the
# real host checkout this sandbox was built from, and the host test reads those
# existence checks there, read-only; its tracked-ness checks still run against
# the sandbox. Nothing ignored is copied in for it. This needs the host side
# (OS item os-pii-boundary-host-root): a host that predates it ignores the
# variable, and step [5/6] then still records host-gate FAIL, honestly.

#
# ── WHERE IT LIVES, AND WHO MAY DELETE WHAT ────────────────────────────────
# The scripts used ROOT=${SANDBOX:-/tmp/fd-promote} and /tmp/fd-sandbox: fixed,
# guessable paths in a shared directory, never removed, holding the host's
# tracked tree plus every log and the compliance record. sandbox_from_tracked
# also ran `rm -rf` on whatever ROOT it was handed, and the .env.supabase trap
# REPLACED any earlier EXIT trap. Now:
#   - With SANDBOX unset, the sandbox is <parent>/sandbox under a fresh
#     `mktemp -d ${TMPDIR:-/tmp}/fd-studio.XXXXXX` (mode 700) — sandbox_new_parent.
#   - Logs and the record go to a mode-700 <studio>/.studio/runs/<stamp>-<name>.*
#     (gitignored; STUDIO_RUNS_DIR overrides the base) — sandbox_new_run_dir.
#     They are written there directly, so they outlive the sandbox even when
#     the run is killed.
#   - ONE EXIT handler, sandbox_cleanup: removes every .env.supabase registered
#     with sandbox_arm_pg_env_cleanup, then the mktemp parent (not a SANDBOX the
#     caller named: that path is the caller's). FLIGHTDECK_KEEP_SANDBOX=1 keeps
#     the sandbox and prints its path; the .env.supabase is removed regardless.
#   - sandbox_from_tracked writes a studio-sandbox/1 marker and only ever
#     replaces a directory that is empty or carries that marker.

SANDBOX_MARKER_SCHEMA="studio-sandbox/1"
# Shell state, never read from the environment: a SANDBOX_PARENT exported by a
# caller must not become something sandbox_cleanup deletes.
SANDBOX_PARENT=""
SANDBOX_RUN_DIR=""
SANDBOX_PG_ENV_FILES=""
SANDBOX_TRAP_ARMED=""

# sandbox_new_parent — SANDBOX_PARENT := a fresh mode-700 mktemp directory,
# removed on exit by sandbox_cleanup (armed here). The sandbox goes in
# "$SANDBOX_PARENT/sandbox".
sandbox_new_parent() {
  local base="${TMPDIR:-/tmp}" made
  base="${base%/}"
  made="$(mktemp -d "$base/fd-studio.XXXXXX")" && [ -d "$made" ] || {
    echo "could not create a private sandbox directory under $base" >&2; return 1; }
  chmod 700 "$made" || return 1
  SANDBOX_PARENT="$made"
  sandbox_arm_cleanup
}

# sandbox_new_run_dir STUDIO NAME — SANDBOX_RUN_DIR := a fresh mode-700
# <STUDIO>/.studio/runs/<UTC stamp>-NAME.XXXXXX for this run's logs and record.
sandbox_new_run_dir() {
  local base="${STUDIO_RUNS_DIR:-$1/.studio/runs}" made
  mkdir -p "$base" && chmod 700 "$base" || {
    echo "could not create the run log directory $base" >&2; return 1; }
  made="$(mktemp -d "$base/$(date -u +%Y%m%dT%H%M%SZ)-$2.XXXXXX")" && [ -d "$made" ] || {
    echo "could not create a run directory under $base" >&2; return 1; }
  chmod 700 "$made" || return 1
  SANDBOX_RUN_DIR="$made"
}

# sandbox_arm_cleanup — installs sandbox_cleanup as THE EXIT handler, once.
# HUP/INT/TERM exit through it too (bash does not run an EXIT trap when a
# signal it has no trap for kills it).
sandbox_arm_cleanup() {
  [ -z "$SANDBOX_TRAP_ARMED" ] || return 0
  trap sandbox_cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  SANDBOX_TRAP_ARMED=1
}

# sandbox_cleanup — the EXIT handler. .env.supabase first, then the parent.
# Never calls `exit`, so the script's own exit code is what the caller sees.
sandbox_cleanup() {
  local f
  while IFS= read -r f; do
    [ -z "$f" ] || rm -f "$f"
  done <<EOF
$SANDBOX_PG_ENV_FILES
EOF
  if [ -n "$SANDBOX_PARENT" ] && [ -d "$SANDBOX_PARENT" ]; then
    case "$(basename "$SANDBOX_PARENT")" in fd-studio.*) ;; *) return 0 ;; esac
    if [ "${FLIGHTDECK_KEEP_SANDBOX:-}" = "1" ]; then
      echo "sandbox kept (FLIGHTDECK_KEEP_SANDBOX=1): $SANDBOX_PARENT/sandbox" >&2
    else
      rm -rf "$SANDBOX_PARENT"
    fi
  fi
  return 0
}

# sandbox_clear_root ROOT — makes ROOT free for a new sandbox, or refuses.
# Only an empty directory or one carrying a valid studio-sandbox/1 marker is
# removed; anything else (a foreign directory, a file, a symlink) is left alone
# and this returns non-zero with the reason.
sandbox_clear_root() {
  local root="$1" marker="$1/.git/studio-sandbox"
  if [ -L "$root" ]; then
    echo "refusing to use $root: it is a symlink. Point SANDBOX at a new path." >&2; return 1
  fi
  [ -e "$root" ] || return 0
  if [ ! -d "$root" ]; then
    echo "refusing to use $root: it exists and is not a directory. Point SANDBOX at a new path." >&2; return 1
  fi
  if [ -z "$(ls -A "$root" 2>/dev/null)" ]; then rmdir "$root" && return 0; fi
  if [ ! -L "$root/.git" ] && [ -f "$marker" ] && [ ! -L "$marker" ] \
     && [ "$(wc -l <"$marker" | tr -d ' ')" = "1" ] \
     && grep -Eqx "$SANDBOX_MARKER_SCHEMA [0-9a-f]{40}([0-9a-f]{24})?" "$marker"; then
    rm -rf "$root" && return 0
    echo "could not remove the earlier sandbox $root" >&2; return 1
  fi
  echo "refusing to replace $root: it is not empty and has no $SANDBOX_MARKER_SCHEMA marker ($marker), so it is not a studio-sandbox this script built. Nothing was deleted. Point SANDBOX at a new path, or remove it yourself." >&2
  return 1
}

# sandbox_from_tracked REPO ROOT — ROOT becomes a mode-700 git repo holding
# REPO's HEAD commit and nothing older, checked out detached. Uncommitted host
# edits are deliberately NOT included: what gets certified is a commit.
# An existing ROOT is replaced only if sandbox_clear_root allows it. The marker
# (ROOT/.git/studio-sandbox, mode 600, "studio-sandbox/1 <host HEAD>") lives in
# .git so git — and the host gate's ignored-file checks — never see it.
sandbox_from_tracked() {
  local repo="$1" root="$2" common head
  [ -n "$root" ] || return 1
  common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)" || return 1
  head="$(git -C "$repo" rev-parse --verify 'HEAD^{commit}')" || return 1
  sandbox_clear_root "$root" || return 1
  mkdir -p "$(dirname "$root")" && mkdir -m 700 "$root" || return 1
  git -C "$root" init -q || return 1
  ( umask 077 && printf '%s %s\n' "$SANDBOX_MARKER_SCHEMA" "$head" >"$root/.git/studio-sandbox" ) \
    && chmod 600 "$root/.git/studio-sandbox" || return 1
  # file:// (not a bare path) so --depth is honoured: a local-path transfer
  # would copy objects wholesale, history included.
  git -C "$root" fetch -q --no-tags --depth 1 "file://$common" "$head" || return 1
  git -C "$root" -c advice.detachedHead=false checkout -q --detach FETCH_HEAD || return 1
  echo "sandbox: $root at $head (one commit, tracked files only)"
}

# sandbox_add_pg_env REPO ROOT — the ONE gitignored file a sandbox may hold:
# flightdeck/.env.supabase, which the host gate's Postgres tier reads. Created
# mode 600 from birth (umask 077), never printed. A no-op when the host has none
# (gate.sh then reports the tier as SKIPPED — loudly, never green). Callers
# use sandbox_run_host_gate, which removes it again as soon as the gate has run.
sandbox_add_pg_env() {
  local src="$1/flightdeck/.env.supabase" dst="$2/flightdeck/.env.supabase"
  [ -f "$src" ] || return 0
  ( umask 077 && cp "$src" "$dst" ) && chmod 600 "$dst"
}

# sandbox_arm_pg_env_cleanup ROOT — registers ROOT/flightdeck/.env.supabase
# with sandbox_cleanup, the one EXIT handler: the backstop for a run that dies
# between bringing the file in and removing it. It used to install its own
# EXIT trap, which REPLACED any earlier one; it now adds to the handler.
sandbox_arm_pg_env_cleanup() {
  local f="$1/flightdeck/.env.supabase"
  case "
$SANDBOX_PG_ENV_FILES
" in *"
$f
"*) ;; *) SANDBOX_PG_ENV_FILES="$SANDBOX_PG_ENV_FILES
$f" ;; esac
  sandbox_arm_cleanup
}

# sandbox_run_host_gate REPO ROOT LOG — runs the host's own scripts/gate.sh in
# ROOT, output to LOG, and returns its exit code. Its Postgres tier reads
# flightdeck/.env.supabase, gitignored and so not in the sandbox: that one file
# is brought in for this step only (unless FLIGHTDECK_GATE_POSTGRES=0 opts the
# tier out) and removed again straight after, with the EXIT trap as backstop.
#
# The gate's run_eval stack prefers $ROOT/.venv/bin/python, else python3. .venv
# is gitignored, so the sandbox never has one, and on a PEP 668 Mac (Homebrew
# python3 without python-docx) run_eval failed on an import error in every
# promote run, for the sandbox's reason rather than the candidate's. So when
# PYTHON_BIN is not set and the HOST has a venv, the gate is handed the host's
# interpreter by path. Nothing is copied; an explicit PYTHON_BIN still wins.
#
# FLIGHTDECK_PII_HOST_ROOT is ALWAYS the host checkout the sandbox was built
# from (a value the caller had set is overridden), for the gate's process only.
# If it cannot be resolved the gate does not run and this returns non-zero.
sandbox_run_host_gate() {
  local repo="$1" root="$2" log="$3" rc host_root pybin="${PYTHON_BIN:-}"
  host_root="$(git -C "$repo" rev-parse --show-toplevel)" && [ -n "$host_root" ] || {
    echo "could not resolve the host checkout $repo; host gate not run" >&2; return 2; }
  sandbox_arm_pg_env_cleanup "$root"
  [ "${FLIGHTDECK_GATE_POSTGRES:-1}" = "0" ] || sandbox_add_pg_env "$repo" "$root"
  if [ -z "$pybin" ]; then
    if [ -x "$repo/.venv/bin/python" ]; then pybin="$repo/.venv/bin/python"
    elif [ -x "$repo/.venv/Scripts/python.exe" ]; then pybin="$repo/.venv/Scripts/python.exe"; fi
  fi
  ( cd "$root" && { [ -z "$pybin" ] || export PYTHON_BIN="$pybin"; } \
      && FLIGHTDECK_PII_HOST_ROOT="$host_root" bash scripts/gate.sh >"$log" 2>&1 )
  rc=$?
  rm -f "$root/flightdeck/.env.supabase"
  return "$rc"
}

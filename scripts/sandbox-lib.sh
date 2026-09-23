# sandbox-lib.sh — sourced by scripts/promote.sh and scripts/mount-in-host.sh.
# Not executable on its own. Test: scripts/__tests__/sandbox.test.ts.
#
# ⛔ THE SANDBOX IS THE HOST'S HEAD COMMIT, AS A HISTORY-FREE, SINGLE-COMMIT
#    GIT CHECKOUT — TRACKED FILES ONLY, NOTHING ELSE.
#
# Both scripts used to build it with
#   tar -C "$REPO" --exclude=.git --exclude=node_modules -cf - . | tar -C "$ROOT" -xf -
# which was wrong in both directions at once:
#   1. It stripped .git, so the host gate could NEVER pass in the sandbox:
#      tests/piiGitBoundary.test.ts refuses to run outside a real git checkout,
#      and check-contracts-boundary.sh --tracked lists `git ls-files`. promote.sh
#      could therefore never write readyForProduction: true.
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
# under $ROOT, and there is no remote to push back to. Nothing in the host gate
# needs history (piiGitBoundary.test.ts and check-contracts-boundary.sh
# --tracked use check-ignore, ls-files and diff --cached).

# sandbox_from_tracked REPO ROOT — ROOT becomes a mode-700 git repo holding
# REPO's HEAD commit and nothing older, checked out detached. Uncommitted host
# edits are deliberately NOT included: what gets certified is a commit.
sandbox_from_tracked() {
  local repo="$1" root="$2" common head
  [ -n "$root" ] || return 1
  common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)" || return 1
  head="$(git -C "$repo" rev-parse --verify 'HEAD^{commit}')" || return 1
  rm -rf "$root" || return 1
  mkdir -p "$(dirname "$root")" && mkdir -m 700 "$root" || return 1
  git -C "$root" init -q || return 1
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

# sandbox_arm_pg_env_cleanup ROOT — an EXIT trap that removes
# ROOT/flightdeck/.env.supabase: the backstop for a run that dies between
# bringing the file in and removing it. Replaces any earlier EXIT trap.
sandbox_arm_pg_env_cleanup() {
  trap "rm -f $(printf '%q' "$1/flightdeck/.env.supabase")" EXIT
}

# sandbox_run_host_gate REPO ROOT LOG — runs the host's own scripts/gate.sh in
# ROOT, output to LOG, and returns its exit code. Its Postgres tier reads
# flightdeck/.env.supabase, gitignored and so not in the sandbox: that one file
# is brought in for this step only (unless FLIGHTDECK_GATE_POSTGRES=0 opts the
# tier out) and removed again straight after, with the EXIT trap as backstop.
sandbox_run_host_gate() {
  local repo="$1" root="$2" log="$3" rc
  sandbox_arm_pg_env_cleanup "$root"
  [ "${FLIGHTDECK_GATE_POSTGRES:-1}" = "0" ] || sandbox_add_pg_env "$repo" "$root"
  ( cd "$root" && bash scripts/gate.sh >"$log" 2>&1 )
  rc=$?
  rm -f "$root/flightdeck/.env.supabase"
  return "$rc"
}

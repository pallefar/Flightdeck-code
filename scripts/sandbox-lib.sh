# sandbox-lib.sh — sourced by scripts/promote.sh and scripts/mount-in-host.sh.
# Not executable on its own. Test: scripts/__tests__/sandbox.test.ts.
#
# ⛔ THE SANDBOX IS THE HOST'S TRACKED FILES, AS A GIT CHECKOUT — NOTHING ELSE.
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
# A clone, not `git worktree add`: a worktree registers itself in the HOST's
# .git and shares its object store, so a sandbox commit or gc would write into
# the host. A clone reads the host and writes only under $ROOT. Its origin is
# removed so nothing in the sandbox can push back.

# sandbox_from_tracked REPO ROOT — ROOT becomes a mode-700 clone of REPO,
# checked out (detached) at REPO's HEAD commit. Uncommitted host edits are
# deliberately NOT included: what gets certified is a commit.
sandbox_from_tracked() {
  local repo="$1" root="$2" common head
  [ -n "$root" ] || return 1
  common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)" || return 1
  head="$(git -C "$repo" rev-parse --verify 'HEAD^{commit}')" || return 1
  rm -rf "$root" || return 1
  mkdir -p "$(dirname "$root")" && mkdir -m 700 "$root" || return 1
  git clone -q --no-checkout --no-hardlinks "$common" "$root" || return 1
  git -C "$root" remote remove origin || return 1
  git -C "$root" -c advice.detachedHead=false checkout -q --detach "$head" || return 1
  echo "sandbox: $root at $head (tracked files only)"
}

# sandbox_add_pg_env REPO ROOT — the ONE gitignored file a sandbox may hold:
# flightdeck/.env.supabase, which the host gate's Postgres tier reads. Created
# mode 600 from birth (umask 077), never printed. A no-op when the host has none
# (gate.sh then reports the tier as SKIPPED — loudly, never green). Callers
# remove it again as soon as the gate has run.
sandbox_add_pg_env() {
  local src="$1/flightdeck/.env.supabase" dst="$2/flightdeck/.env.supabase"
  [ -f "$src" ] || return 0
  ( umask 077 && cp "$src" "$dst" ) && chmod 600 "$dst"
}

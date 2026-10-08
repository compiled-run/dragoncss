#!/usr/bin/env bash
# Bootstraps a Claude Code cloud session (the SessionStart hook in .claude/settings.json); a no-op unless CLAUDE_CODE_REMOTE=true.
# Installs the Node every workflow pins (.github/workflows node-version) and the pnpm of package.json's packageManager, then runs
# pnpm install --frozen-lockfile and pnpm setup:git. Safe to rerun; any failure exits non-zero with its cause.
#
# Native runs: cloud sessions have no Swift or Kotlin toolchain, so a native test there would read "blocked (owner tooling)" and
# pass. In a cloud session this script exports DRAGON_REQUIRE_NATIVE=1 through CLAUDE_ENV_FILE, so such a run fails, naming the
# missing tool (packages/translate/src/native.ts, requireNative); cloud lanes run native test files through CI (test-files.yml).
#
# The hook runs on every SessionStart source (startup, resume, clear, compact, fork), since compaction drops CLAUDE_ENV_FILE
# exports. Its stdout reaches Claude's context, so only the final summary line goes there; everything else goes to stderr.
#
# --print-versions prints the two pins and exits, in any session.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)

die() { echo "cloud-setup: $*" >&2; exit 1; }

# The one full x.y.z Node pin across the workflows; a major-only pin must name the same major, and any other value fails.
node_pin() {
  local values full major v
  [ -d "$ROOT/.github/workflows" ] || die "no .github/workflows directory"
  values=$(find "$ROOT/.github/workflows" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) -exec sed -n "s/^[[:space:]]*node-version:[[:space:]]*//p" {} + | tr -d "'\"" | sed 's/[[:space:]]*$//')
  [ -n "$values" ] || die "no node-version in .github/workflows"
  full=$(printf '%s\n' "$values" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -u || true)
  [ -n "$full" ] || die "no workflow pins a full x.y.z node-version"
  [ "$(printf '%s\n' "$full" | wc -l | tr -d ' ')" = 1 ] || die "the workflows pin different Node versions: $(printf '%s' "$full" | tr '\n' ' ')"
  major=${full%%.*}
  while IFS= read -r v; do
    case "$v" in
      "$full" | "$major") ;;
      *) die "a workflow pins node-version '$v', which is not $full or $major" ;;
    esac
  done <<< "$values"
  printf '%s\n' "$full"
}

pnpm_pin() {
  local v
  v=$(sed -n 's/^[[:space:]]*"packageManager":[[:space:]]*"pnpm@\([^"+]*\)\(+[^"]*\)\{0,1\}",\{0,1\}[[:space:]]*$/\1/p' "$ROOT/package.json")
  printf '%s\n' "$v" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || die "package.json packageManager is not pnpm@x.y.z (read '$v')"
  printf '%s\n' "$v"
}

case "${1:-}" in
  --print-versions)
    NODE=$(node_pin)
    PNPM=$(pnpm_pin)
    printf 'node %s\npnpm %s\n' "$NODE" "$PNPM"
    exit 0
    ;;
  '') ;;
  *) die "unknown argument '$1' (only --print-versions)" ;;
esac

[ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
exec 3>&1 1>&2

[ -n "${CLAUDE_ENV_FILE:-}" ] || die "CLAUDE_ENV_FILE is not set, so the session's commands would not get DRAGON_REQUIRE_NATIVE=1 or the pinned Node"
# First, so a native run in this session fails rather than reads blocked even when the install below fails.
echo 'export DRAGON_REQUIRE_NATIVE=1' >> "$CLAUDE_ENV_FILE"

NODE=$(node_pin)
PNPM=$(pnpm_pin)
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) PLATFORM=linux-x64 ;;
  Linux-aarch64 | Linux-arm64) PLATFORM=linux-arm64 ;;
  *) die "no Node download for $(uname -s)-$(uname -m)" ;;
esac
NODE_HOME=${DRAGON_NODE_HOME:-$HOME/.local/share/dragon/node-v$NODE-$PLATFORM}

if [ "$("$NODE_HOME/bin/node" --version 2>/dev/null || true)" != "v$NODE" ]; then
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP" "$NODE_HOME.partial"' EXIT
  TAR=node-v$NODE-$PLATFORM.tar.xz
  echo "cloud-setup: installing Node $NODE into $NODE_HOME"
  curl -fsSL --retry 3 --retry-connrefused -o "$TMP/$TAR" "https://nodejs.org/dist/v$NODE/$TAR"
  curl -fsSL --retry 3 --retry-connrefused -o "$TMP/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE/SHASUMS256.txt"
  grep -q "  $TAR\$" "$TMP/SHASUMS256.txt" || die "SHASUMS256.txt of Node $NODE has no $TAR"
  (cd "$TMP" && grep "  $TAR\$" SHASUMS256.txt | sha256sum -c --status -) || die "$TAR does not match its SHA-256 in SHASUMS256.txt"
  rm -rf "$NODE_HOME.partial"
  mkdir -p "$NODE_HOME.partial"
  tar -xJf "$TMP/$TAR" --strip-components=1 -C "$NODE_HOME.partial"
  rm -rf "$NODE_HOME"
  mv "$NODE_HOME.partial" "$NODE_HOME"
fi
export PATH="$NODE_HOME/bin:$PATH"
[ "$(node --version)" = "v$NODE" ] || die "node on PATH is $(node --version), not v$NODE"

if [ "$("$NODE_HOME/bin/pnpm" --version 2>/dev/null || true)" != "$PNPM" ]; then
  echo "cloud-setup: installing pnpm $PNPM"
  "$NODE_HOME/bin/npm" install --global --prefix "$NODE_HOME" --no-fund --no-audit "pnpm@$PNPM"
fi
[ "$(command -v pnpm)" = "$NODE_HOME/bin/pnpm" ] || die "pnpm on PATH is $(command -v pnpm || echo 'missing'), not $NODE_HOME/bin/pnpm"
[ "$(pnpm --version)" = "$PNPM" ] || die "pnpm is $(pnpm --version), not $PNPM"

cd "$ROOT"
pnpm install --frozen-lockfile
pnpm setup:git

# Later Bash commands of the session get the pinned Node and pnpm first on PATH; the line adds it only once however often it is sourced.
echo "case \":\$PATH:\" in *\":$NODE_HOME/bin:\"*) ;; *) export PATH=\"$NODE_HOME/bin:\$PATH\" ;; esac" >> "$CLAUDE_ENV_FILE"
echo "cloud-setup: Node $NODE, pnpm $PNPM, dependencies installed, git merge drivers set, DRAGON_REQUIRE_NATIVE=1" >&3

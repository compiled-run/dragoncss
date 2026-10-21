#!/usr/bin/env bash
# Installs Homebrew's openjdk@17 at the exact build the committed lanes.json host lanes record (layout-vectors-host:
# "JRE 17.0.21+0; openjdk version "17.0.21" 2026-10-20"), not whatever `brew install openjdk@17` serves today. Homebrew moves the
# formula to each new patch (17.0.20.1 to 17.0.21 on 2026-10-20), and a newer JDK fails every toolchain check against lanes.json.
# The bottle comes from ghcr.io by its sha256 (old bottles stay there), so the JDK is Homebrew's own build of that version.
# Changing the pin is a reviewed edit here (the digests are in ghcr.io/v2/homebrew/core/openjdk/17/manifests/<version>) plus a
# lanes-host regen that records the new toolchain.
set -euo pipefail
VERSION=17.0.21
# The bottle digests of homebrew/core openjdk@17 17.0.21. A case, not an associative array: macOS's /bin/bash is 3.2.
bottle_sha() {
  case "$1" in
    x86_64_linux) echo 4e3e453ccfb614047819e1096afd1b32e2a6e26d3ff8c8e826303c81474111e9 ;;
    arm64_linux) echo 4104441a45d10e6e45ababff0919b94449a0d6e3a5675b122d16f1a6e4cf9ed1 ;;
    arm64_golden_gate) echo 733939db388c3cae83209853048598287c029abe919bf5a534221fd74512e2b5 ;;
    arm64_tahoe) echo 21dd7b1302c58dd79f58544797001715ac991146c8e33021ba978d08c0d84f6f ;;
    arm64_sequoia) echo 5a59888c492e4d04c29ce6ab4ae5b8d3f7f620aedd73e7b2e20c1f615558ad87 ;;
  esac
}
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_UPGRADE=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1
TAG=$(brew ruby -e 'print Utils::Bottles.tag')
sha=$(bottle_sha "$TAG")
[ -n "$sha" ] || { echo "no pinned openjdk@17 $VERSION bottle for $TAG" >&2; exit 1; }
have=$(brew list --versions openjdk@17 || true)
if [ "$have" = "openjdk@17 $VERSION" ]; then
  echo "openjdk@17 $VERSION is already installed"
else
  [ -z "$have" ] || brew uninstall --ignore-dependencies --force openjdk@17
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' EXIT
  # The name brew reads the formula and version from.
  bottle="$dir/openjdk@17--$VERSION.$TAG.bottle.tar.gz"
  for i in 1 2 3; do
    curl -sSfL -H 'Authorization: Bearer QQ==' -o "$bottle" "https://ghcr.io/v2/homebrew/core/openjdk/17/blobs/sha256:$sha" && break
    [ "$i" -lt 3 ] || { echo "the openjdk@17 $VERSION bottle download failed 3 times" >&2; exit 1; }
    sleep 20
  done
  echo "$sha  $bottle" | shasum -a 256 -c -
  brew install "$bottle"
fi
# Keeps a later brew upgrade from moving it.
brew pin openjdk@17
"$(brew --prefix openjdk@17)/bin/java" -version

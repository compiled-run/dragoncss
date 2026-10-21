#!/usr/bin/env bash
# Installs Homebrew's openjdk@17 at the exact build the committed lanes.json host lanes record (layout-vectors-host:
# "JRE 17.0.20.1+0; openjdk version "17.0.20.1" 2026-08-18"), not whatever `brew install openjdk@17` serves today. Homebrew moves
# the formula to each new patch (17.0.21 on 2026-10-20), and a newer JDK fails every toolchain check against lanes.json.
# The bottle comes from ghcr.io by its sha256 (old bottles stay there), so the JDK is Homebrew's own build of that version.
# Changing the pin is a reviewed edit here plus a lanes-host regen that records the new toolchain.
set -euo pipefail
VERSION=17.0.20.1
# The bottle digests of homebrew/core openjdk@17 17.0.20.1 (ghcr.io/v2/homebrew/core/openjdk/17/manifests/17.0.20.1).
# A case, not an associative array: macOS's /bin/bash is 3.2.
bottle_sha() {
  case "$1" in
    x86_64_linux) echo c4d7d14b912a175747502a41875e8c70a2c30975748f4f8c5ab00c1ba954810e ;;
    arm64_linux) echo 20700602d7849f1d4f860cb503573217dde83a0e22a860ea2b5dcb62ce842728 ;;
    arm64_golden_gate) echo 93731f4508525325cd2b2359167c3ee66d45255920cc6519b9a9a7e43ec7f164 ;;
    arm64_tahoe) echo 574e7c7169103e68312a87af27a6ce27de8f473031a22fd5babd4eeebb195c81 ;;
    arm64_sequoia) echo 96b8ced169f8234f67aa01adef2d89a111a93cb1bdba464cf1972df3578dfb79 ;;
    arm64_sonoma) echo 338ca05773a7a98670d26ca0475b238a02d888c65d643b727835265c873cb0bf ;;
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

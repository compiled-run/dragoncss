#!/usr/bin/env bash
# Installs Homebrew's openjdk@17 at the exact build the committed lanes.json host lanes record (layout-vectors-host:
# "JRE 17.0.21+0; openjdk version "17.0.21" 2026-10-20"), not whatever `brew install openjdk@17` serves today. Homebrew moves the
# formula to each new patch (17.0.20.1 to 17.0.21 on 2026-10-20), and a newer JDK fails every toolchain check against lanes.json.
# scripts/brew/openjdk@17.rb is homebrew/core's formula at that version; it is installed from a local tap, so the JDK is
# Homebrew's own bottle of it from ghcr.io, checked against the formula's sha256s. (Homebrew no longer installs a bottle file
# given by path.) Changing the pin is a reviewed copy of the newer homebrew/core formula there plus a lanes-host regen that
# records the new toolchain.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(sed -n 's|^  url ".*/jdk-\(17[.0-9]*\)-ga\.tar\.gz"$|\1|p' "$ROOT/scripts/brew/openjdk@17.rb")
[ -n "$VERSION" ] || { echo "scripts/brew/openjdk@17.rb has no jdk-17.x-ga url" >&2; exit 1; }
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_UPGRADE=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 HOMEBREW_NO_ENV_HINTS=1
have=$(brew list --versions openjdk@17 || true)
if [ "$have" = "openjdk@17 $VERSION" ]; then
  echo "openjdk@17 $VERSION is already installed"
else
  [ -z "$have" ] || brew uninstall --ignore-dependencies --force openjdk@17
  tap="$(brew --repository)/Library/Taps/dragon/homebrew-pin"
  [ -d "$tap" ] || brew tap-new --no-git dragon/pin >/dev/null
  mkdir -p "$tap/Formula"
  cp "$ROOT/scripts/brew/openjdk@17.rb" "$tap/Formula/openjdk@17.rb"
  # --force-bottle: a missing bottle for this runner fails here instead of building the JDK from source for an hour.
  brew install --force-bottle dragon/pin/openjdk@17
fi
# Keeps a later brew upgrade from moving it.
brew pin openjdk@17 2>/dev/null || brew pin dragon/pin/openjdk@17
java="$(brew --prefix)/opt/openjdk@17/bin/java"
"$java" -version
"$java" -version 2>&1 | grep -qF "openjdk version \"$VERSION\"" || { echo "the installed JDK is not openjdk $VERSION" >&2; exit 1; }

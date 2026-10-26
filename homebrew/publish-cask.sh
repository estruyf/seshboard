#!/usr/bin/env bash
#
# Stamps homebrew/seshboard.rb with a released version and its checksum, and with --push commits it
# to the Homebrew tap.
#
#   ./homebrew/publish-cask.sh              stamp the cask and print it
#   ./homebrew/publish-cask.sh --push       also push it to the tap
#
#   VERSION=1.2.3       the version to publish, default: apps/desktop/package.json
#   ZIP=path/to.zip     the archive to hash, default: the one in apps/desktop/dist, and failing that
#                       the asset attached to the release
#   TAP_REPO            default: estruyf/homebrew-tap
#   HOMEBREW_TAP_TOKEN  a token with write access to the tap; --push needs it
#
# The cask in this repository is the source of truth. Everything except `version` and `sha256` is
# edited here by hand and carried into the tap on the next release, so the tap is never edited directly.

set -euo pipefail

cd "$(dirname "$0")/.."

CASK="homebrew/seshboard.rb"
TAP_REPO="${TAP_REPO:-estruyf/homebrew-tap}"
PUSH=0

for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [ -z "${VERSION:-}" ]; then
  VERSION="$(node -p "require('./apps/desktop/package.json').version")"
fi
VERSION="${VERSION#v}"
NAME="Seshboard-$VERSION-arm64-mac.zip"

# Prefer the archive the build just produced: it is the exact bytes attached to the release, so
# hashing it can't race the CDN.
if [ -z "${ZIP:-}" ]; then
  if [ -f "apps/desktop/dist/$NAME" ]; then
    ZIP="apps/desktop/dist/$NAME"
  else
    ZIP="$(mktemp -d)/$NAME"
    echo "==> Downloading $NAME from the release"
    curl -fsSL -o "$ZIP" "https://github.com/estruyf/switchboard/releases/download/v$VERSION/$NAME"
  fi
fi

if [ ! -f "$ZIP" ]; then
  echo "no archive to hash: $ZIP" >&2
  exit 1
fi

SHA="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"
echo "==> Seshboard $VERSION"
echo "    archive $ZIP"
echo "    sha256  $SHA"

# Rewritten through a temp file because BSD and GNU sed disagree about -i.
TMP="$(mktemp)"
sed -e "s|^  version \".*\"$|  version \"$VERSION\"|" \
    -e "s|^  sha256 \".*\"$|  sha256 \"$SHA\"|" \
    "$CASK" > "$TMP"
mv "$TMP" "$CASK"

# A reshaped cask would make those substitutions quietly match nothing, which is how a tap ends up
# serving the previous release's checksum.
if ! grep -q "^  version \"$VERSION\"$" "$CASK" || ! grep -q "^  sha256 \"$SHA\"$" "$CASK"; then
  echo "::error::$CASK was not stamped. Check its version and sha256 lines." >&2
  exit 1
fi

# A cask is Ruby, so this catches a botched substitution without Homebrew's rubocop bundle.
# `brew style homebrew/seshboard.rb` is the fuller check to run by hand.
if command -v ruby >/dev/null 2>&1; then
  ruby -c "$CASK" > /dev/null
fi

if [ "$PUSH" -eq 0 ]; then
  echo
  cat "$CASK"
  echo
  echo "Not pushed. Re-run with --push to send it to $TAP_REPO."
  exit 0
fi

if [ -z "${HOMEBREW_TAP_TOKEN:-}" ]; then
  echo "--push needs HOMEBREW_TAP_TOKEN, a token with write access to $TAP_REPO." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The token rides in the URL, the usual CI shape: Actions masks the secret in the log, and the
# checkout is thrown away with the runner.
git clone --depth 1 "https://x-access-token:${HOMEBREW_TAP_TOKEN}@github.com/${TAP_REPO}.git" "$WORK/tap"

mkdir -p "$WORK/tap/Casks"
cp "$CASK" "$WORK/tap/Casks/seshboard.rb"
# The cask was called switchboard before the rename: cask_renames.json tells `brew upgrade` to move
# those installs to seshboard, and the old file goes so the tap has one cask for the app.
node -e '
const fs = require("fs");
const file = process.argv[1];
const renames = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
renames.switchboard = "seshboard";
fs.writeFileSync(file, JSON.stringify(renames, null, 2) + "\n");
' "$WORK/tap/cask_renames.json"
git -C "$WORK/tap" rm --quiet --ignore-unmatch Casks/switchboard.rb

git -C "$WORK/tap" config user.name "github-actions[bot]"
git -C "$WORK/tap" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$WORK/tap" add Casks/seshboard.rb cask_renames.json

if git -C "$WORK/tap" diff --cached --quiet; then
  echo "==> $TAP_REPO already serves $VERSION; nothing to push."
  exit 0
fi

git -C "$WORK/tap" commit -m "seshboard $VERSION"
git -C "$WORK/tap" push
echo "==> Pushed seshboard $VERSION to $TAP_REPO"

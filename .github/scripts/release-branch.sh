#!/usr/bin/env bash
# Checks that a release comes from the right branch, for each build job in release.yml, after release-version.sh:
# reads TAG, FEED and SHA (the tagged commit).
#
# - A Stable release (FEED=latest) must be a commit on main: main only ever holds what was released.
# - A beta (FEED=beta) must be a commit on dev, where the work for the next release lands, and for a version after
#   the latest release: Beta users get the newest entry on the releases page, so a beta of a version that is
#   already out would be offered to them.
# Any other pre-release reaches no one (it has no feed), so it may come from anywhere. A dry run is not checked.
set -euo pipefail

if [ "${DRY_RUN:-false}" == "true" ] || [ "$FEED" == "none" ]; then
  exit 0
fi

branch=$([ "$FEED" == "latest" ] && echo main || echo dev)

# "behind" or "identical": the tagged commit is in the branch's history. Asked of the API, since the checkout is shallow.
status=$(gh api "repos/$GITHUB_REPOSITORY/compare/$branch...$SHA" --jq .status 2>/dev/null || echo missing)
if [ "$status" != "behind" ] && [ "$status" != "identical" ]; then
  if [ "$status" == "missing" ]; then
    echo "::error::$TAG must come from $branch, and the branch $branch was not found."
  else
    echo "::error::$TAG must come from $branch, but its commit $SHA is not on $branch ($status). Tag a commit on $branch."
  fi
  exit 1
fi

if [ "$FEED" == "beta" ]; then
  latest=$(gh release view --repo "$GITHUB_REPOSITORY" --json tagName --jq .tagName 2>/dev/null || true)
  latest="${latest#v}"
  base="${VERSION%%-*}"
  # The beta's X.Y.Z must be above the latest release's (1.0.0-beta.1 is older than 1.0.0).
  highest=$(printf '%s\n%s\n' "$latest" "$base" | sort -V | tail -n1)
  if [ -n "$latest" ] && { [ "$latest" == "$base" ] || [ "$highest" != "$base" ]; }; then
    echo "::error::$TAG is a beta of $base, but v$latest is already released. Tag a beta of the next version, such as v$(echo "$latest" | awk -F. '{ print $1 "." $2 + 1 ".0" }')-beta.1."
    exit 1
  fi
fi

echo "::notice::$TAG comes from $branch."

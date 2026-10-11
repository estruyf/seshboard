#!/usr/bin/env bash
# The version and update feed of a release, for each build job in release.yml: reads TAG and PRERELEASE and
# appends VERSION and FEED to $GITHUB_ENV.
#
# FEED is which update feed the release carries: latest (Stable), nightly, or none. A pre-release tagged
# vX.Y.Z-nightly.YYYYMMDD.N is the Nightly feed; any other pre-release gets the builds but no feed, so no
# one is ever updated to it.
#
# A dry run (DRY_RUN=true, the workflow run by hand) has no tag: it builds the app's version with a suffix no
# release carries, such as 1.2.3-dryrun.42, and no feed.
set -euo pipefail

if [ "${DRY_RUN:-false}" == "true" ]; then
  version="$(node -p "require('./apps/desktop/package.json').version")-dryrun.${GITHUB_RUN_NUMBER:-0}"
  echo "::notice::Dry run: building $version. Nothing is published."
  echo "VERSION=$version" >> "$GITHUB_ENV"
  echo "FEED=none" >> "$GITHUB_ENV"
  exit 0
fi

version="${TAG#v}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "::error::The release tag '$TAG' is not a version like v1.2.3."
  exit 1
fi

if [[ "$version" == *-nightly.* ]]; then
  if [ "$PRERELEASE" != "true" ]; then
    echo "::error::$TAG is a nightly version; publish it as a pre-release."
    exit 1
  fi
  feed=nightly
elif [ "$PRERELEASE" == "true" ]; then
  echo "::notice::$TAG is a pre-release but not a nightly: it gets no update feed."
  feed=none
elif [[ "$version" == *-* ]]; then
  echo "::error::$TAG has a pre-release version but is published as a release; Stable users would be offered it."
  exit 1
else
  feed=latest
fi

echo "VERSION=$version" >> "$GITHUB_ENV"
echo "FEED=$feed" >> "$GITHUB_ENV"

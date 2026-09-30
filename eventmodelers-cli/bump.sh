#!/usr/bin/env bash
# Cuts a release: bumps the version, runs the tests, commits, tags and pushes.
# Usage: ./bump.sh [patch|minor|major|x.y.z]   (default: patch)
#
# Pushing the tag fires the release workflow (.github/workflows/release.yml), which publishes the
# npm package and the docker images and requires the tag to equal v<package.json version>.
set -euo pipefail

cd "$(dirname "$0")"
bump=${1:-patch}

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is not clean; commit or stash first" >&2
  exit 1
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "on '$branch', not main" >&2
  exit 1
fi

git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "main is not in sync with origin/main; pull or push first" >&2
  exit 1
fi

npm test

version=$(npm version "$bump" --no-git-tag-version | sed 's/^v//')
if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
  git checkout -- package.json package-lock.json
  echo "tag v$version already exists" >&2
  exit 1
fi

git add package.json package-lock.json
git commit -m "$version"

git tag "v$version"
git push origin main "v$version"

echo "Released v$version; watch it with: gh run watch"

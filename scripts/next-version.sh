#!/usr/bin/env bash
# Print the version the next release takes: ranke-go's, or the first patch above it that
# is free.
#
# WHY THE VERSION IS DERIVED. This library mirrors ranke-go, so what a consumer most needs
# from a version is which reference implementation it tracks — ranke-ts 0.24.x implements
# ranke-go 0.24.x, and that is a fact rather than a judgement. Choosing major/minor/patch
# by hand answered a different question, whether the change breaks anything, and answered
# it from our own reading each time. A mirror has no opinion to express there.
#
# THE RULE. Start at the ranke-go tools/go.mod names. While that exact version is already a
# ranke-ts tag, take the next patch. So:
#
#   ranke-go 0.24.3, last ranke-ts 0.24.3  ->  0.24.4
#   ranke-go 0.24.4, last ranke-ts 0.24.4  ->  0.24.5
#   ranke-go 0.25.0, last ranke-ts 0.24.5  ->  0.25.0
#
# A minor or major move upstream therefore carries straight across, and consecutive
# releases against one ranke-go walk the patch level on their own.
#
# The major and the minor are ranke-go's, always. Only the patch drifts, so the two
# versions read side by side: ranke-ts 0.24.x implements ranke-go 0.24.x, whatever x is.
set -euo pipefail

cd "$(dirname "$0")/.."

# PINNED and TAGS are the two inputs, overridable so the rule above can be exercised
# against the worked examples rather than only against this checkout — see
# scripts/next-version-test.sh.
module="github.com/flocko-motion/ranke-go"
pinned="${PINNED:-}"
if [ -z "$pinned" ]; then
	pinned="$(grep -oE "$module v[0-9]+\.[0-9]+\.[0-9]+" tools/go.mod |
		grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
fi
if [ -z "$pinned" ]; then
	echo "next-version: tools/go.mod names no released $module" >&2
	exit 1
fi

IFS=. read -r maj min pat <<<"$pinned"

# Every release tag, so "free" means free rather than merely above the newest.
taken="${TAGS:-$(git tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true)}"

# Start at ranke-go's patch and step up until the version is free. Nothing looks at what
# the highest published patch is, and it does not need to: reaching a free patch BELOW one
# already out would take a pin behind our own releases, and `ranke-go-check` refuses that —
# it holds tools/go.mod to the latest release. So the only way here is forwards.
while printf '%s\n' "$taken" | grep -qx "v${maj}.${min}.${pat}"; do
	pat=$((pat + 1))
done

echo "v${maj}.${min}.${pat}"

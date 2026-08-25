#!/usr/bin/env bash
# Exercise scripts/next-version.sh against the worked examples, and against the invariant
# they are examples of: the major and minor are ranke-go's, always, and only the patch
# level drifts. Release machinery that computes the wrong version mints a wrong release,
# and nothing downstream would question it.
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

# case <pinned ranke-go> <tags, comma-separated> <expected>
case_is() {
	local pinned="$1" tags="$2" want="$3" got
	got="$(PINNED="$pinned" TAGS="$(printf '%s\n' "${tags//,/$'\n'}")" ./scripts/next-version.sh)"
	if [ "$got" != "$want" ]; then
		echo "  ranke-go $pinned, tags [${tags}]: want $want, got $got" >&2
		fail=1
	fi
}

# The three the rule was stated with.
case_is 0.24.3 v0.24.3 v0.24.4
case_is 0.24.4 v0.24.3,v0.24.4 v0.24.5
case_is 0.25.0 v0.24.3,v0.24.4,v0.24.5 v0.25.0

# A ranke-go this library has not released against yet takes its version unchanged, which
# is what keeps the two readable side by side.
case_is 0.24.0 v0.5.0 v0.24.0
case_is 0.30.7 "" v0.30.7

# Consecutive releases against one ranke-go walk the patch.
case_is 0.24.0 v0.24.0,v0.24.1,v0.24.2 v0.24.3

# A gap is filled: the search starts at ranke-go's patch and takes the first free one, and
# nothing consults the highest published. That only reads oddly for a state the release path
# cannot reach — a free patch below one already out needs a pin behind our own releases, and
# `ranke-go-check` holds the pin to ranke-go's latest. These two record the arithmetic, not
# a situation to expect.
case_is 0.24.0 v0.24.0,v0.24.2 v0.24.1
case_is 0.24.1 v0.24.0,v0.24.1,v0.24.5 v0.24.2

# Tags from another major.minor never move the patch, the two lines being independent.
case_is 0.24.0 v0.23.9,v0.25.4 v0.24.0

# The invariant the examples above are instances of: whatever the tags, the major and the
# minor are ranke-go's and only the patch moves.
for pinned in 0.1.0 0.24.3 1.0.0 2.17.9; do
	got="$(PINNED="$pinned" TAGS="v0.24.3
v1.0.0
v2.17.9" ./scripts/next-version.sh)"
	if [ "${got%.*}" != "v${pinned%.*}" ]; then
		echo "  ranke-go $pinned: major.minor moved, got $got" >&2
		fail=1
	fi
done

if [ "$fail" -ne 0 ]; then
	echo "next-version: the rule does not hold" >&2
	exit 1
fi
echo "next-version: the rule holds over $(grep -c '^case_is' "$0") cases and the invariant"

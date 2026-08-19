#!/usr/bin/env bash
# Take the papers only when ranke-graph has actually moved.
#
# `verify` checks against the LATEST spec, which means every run has to establish what
# the latest IS. Establishing it and downloading it are different costs: the papers are
# ~1.8 MB of shallow clone, while the commit id at the tip of the branch is 40 bytes over
# `git ls-remote`. So this asks for the id, compares it against the one the local copy was
# taken at, and clones only on a difference. A run against an unmoved spec costs one
# request and no bytes.
#
# The stamp lives inside the papers directory, which `make docs` wipes, so a hand-run
# `make docs` clears it and the next check refetches. Wasteful by one clone, and wrong in
# the safe direction: the failure it cannot produce is believing a stale copy is current.
#
# RANKE_SPEC names a spec of your own — working offline, or against one not published yet,
# where a fetch would overwrite the copy under test.
set -euo pipefail

cd "$(dirname "$0")/.."

repo="${RANKE_GRAPH_REPO:-https://github.com/flocko-motion/ranke-graph}"
ref="${RANKE_GRAPH_REF:-main}"
papers="${PAPERS_DIR:-docs/papers}"
stamp="$papers/.source-sha"

if [ -n "${RANKE_SPEC:-}" ]; then
	echo ">> RANKE_SPEC=$RANKE_SPEC — keeping it, not fetching"
	exit 0
fi

# An unreachable ranke-graph is a failure, not a pass: a gate that cannot learn what the
# latest spec is has not checked against it.
remote="$(git ls-remote "$repo" "refs/heads/$ref" 2>/dev/null | cut -f1)"
if [ -z "$remote" ]; then
	echo "spec: cannot reach $repo ($ref) — set RANKE_SPEC to a copy to work offline" >&2
	exit 1
fi

if [ -f "$stamp" ] && [ -f "$papers/spec/ranke-spec.typ" ] && [ "$(cat "$stamp")" = "$remote" ]; then
	echo ">> papers already at $ref ${remote:0:12} — nothing to fetch"
	exit 0
fi

make docs
printf '%s\n' "$remote" >"$stamp"
echo ">> papers taken at $ref ${remote:0:12}"

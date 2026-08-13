#!/usr/bin/env bash
# Compare the rule ids the spec declares against the ids this library cites.
#
# WHAT A GREEN RUN MEANS: every id cited in the sources is declared by the spec, and
# every declared rule is either cited or listed in scripts/rule-citations.allow with a
# reason. That is all. Whether a citation is TRUE — whether the rule says what the
# comment says it says — is beyond a text comparison. Read a green run as "the ids exist
# and are accounted for", never as "the citations are correct".
#
# The gate has two directions, and only one can be hard:
#
#   cited but undeclared  — an error, always: a typo'd or invented id points confidently
#                           at nothing, and nothing else surfaces it. R-DELBY sat at five
#                           sites and R-QHOPS at one, both spelled consistently.
#   declared but uncited  — a ratchet. Most rules belong to another layer, so failing on
#                           "uncited" would buy fake citations. Instead the allowlist may
#                           only shrink: an unlisted uncited rule fails, and so does a
#                           listed rule that has since been cited.
#
# Mirrors ranke-go's scripts/rule-citations.sh, which `make verify` runs there too. Two
# divergences:
#
#   * The sources are TypeScript and the generators' Go. ranke-go prunes a directory
#     with its own go.mod as another module; tools/ has one and is still this repo's
#     code, citing rules in the fixtures it generates, so it is read.
#   * src/query.ts is GENERATED from rql.schema.json, whose descriptions name rules in
#     prose. Those are ranke-graph's words rather than this library's citations, so the
#     file is excluded — and a rule named only there counts as uncited.
#
# It needs the spec, which `make docs` fetches into docs/papers/ (gitignored), so it
# fails on a bare checkout rather than passing blind. RANKE_SPEC points it at a copy of
# your own, for working offline or against a spec not published yet.
#
# Usage: scripts/rule-citations.sh   (from any directory; `make verify` runs it)
#   RANKE_SPEC=<path>  a spec to read instead; a relative path is repo-relative.
set -euo pipefail

cd "$(dirname "$0")/.."

allow="scripts/rule-citations.allow"
generated="./src/query.ts"

# A citation is a rule id in backticks — one definition, both directions. Prose reaching
# for a word of the same shape (a V-SHAPED curve) is not a citation, and a bare-word
# match reads it as one: see scripts/rule-citations.canary.
id_re='[VR]-[A-Z0-9]+'
declared_re="#rule\\(\"$id_re\""
cited_re="\`$id_re\`"

# The spec: RANKE_SPEC, else the copy `make docs` fetches.
spec=""
for candidate in "${RANKE_SPEC:-}" "docs/papers/spec/ranke-spec.typ"; do
	if [ -n "$candidate" ] && [ -f "$candidate" ]; then
		spec="$candidate"
		break
	fi
done
if [ -z "$spec" ]; then
	echo "rule citations: no spec found — run 'make docs', or point RANKE_SPEC at a copy" >&2
	exit 1
fi
if [ ! -f "$allow" ]; then
	echo "rule citations: $allow is absent — the uncited-rule list is part of the gate" >&2
	exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# 1. Declared: the ids of the spec's #rule() declarations. An empty set means the
#    declaration format moved and every comparison below is vacuous.
grep -oE "$declared_re" "$spec" | grep -oE "$id_re" | sort -u > "$work/declared" || true
if [ ! -s "$work/declared" ]; then
	echo "rule citations: no #rule declarations in $spec — the extraction is blind, not passing" >&2
	exit 1
fi

# 2. Cited: ids in this checkout's sources. .worktrees holds sibling agent checkouts at
#    other commits, and node_modules and dist are not this library's code — a match in
#    any of them reports ids that were fixed here as still present.
find . \
	-name .git -prune -o \
	-name .worktrees -prune -o \
	-name node_modules -prune -o \
	-name dist -prune -o \
	-name testdata -prune -o \
	-path "$generated" -prune -o \
	\( -name '*.ts' -o -name '*.go' \) -print0 \
	| xargs -0 --no-run-if-empty grep -hoE "$cited_re" \
	| grep -oE "$id_re" \
	| sort -u > "$work/cited" || true

# 3. Listed: the allowlist, one rule per line as "<id> <reason>". A comment line or a
#    blank one is skipped; an id without a reason is not a listing.
: > "$work/listed"
while read -r id reason; do
	case "$id" in '#'* | '') continue ;; esac
	if [ -z "$reason" ]; then
		echo "rule citations: $allow lists $id with no reason — say why it is uncited" >&2
		exit 1
	fi
	echo "$id" >> "$work/listed"
done < "$allow"
sort -u "$work/listed" -o "$work/listed"

status=0

# 4. Hard gate: an id the sources cite that the spec does not declare.
unknown="$(comm -23 "$work/cited" "$work/declared")"
if [ -n "$unknown" ]; then
	echo "rule citations: cited but not declared by the spec —" >&2
	for id in $unknown; do
		echo "  $id" >&2
		grep -rnF --include='*.ts' --include='*.go' \
			--exclude-dir=.worktrees --exclude-dir=node_modules --exclude-dir=dist \
			-- "\`$id\`" . >&2 || true
	done
	status=1
fi

# 5. Ratchet, first half: a declared rule cited nowhere and not listed.
comm -13 "$work/cited" "$work/declared" > "$work/uncited"
unlisted="$(comm -23 "$work/uncited" "$work/listed")"
if [ -n "$unlisted" ]; then
	echo "rule citations: declared, cited nowhere, and not in $allow — cite it, or list it with a reason:" >&2
	for id in $unlisted; do echo "  $id" >&2; done
	status=1
fi

# 6. Ratchet, second half: what keeps the list shrinking. A listed rule that has since
#    been cited must leave the list, or the list rots into a permanent exemption and
#    step 5 goes quiet.
stale="$(comm -12 "$work/listed" "$work/cited")"
if [ -n "$stale" ]; then
	echo "rule citations: cited now, so remove it from $allow:" >&2
	for id in $stale; do echo "  $id" >&2; done
	status=1
fi

# 7. A listed id the spec no longer declares: the listing outlived its rule.
gone="$(comm -23 "$work/listed" "$work/declared")"
if [ -n "$gone" ]; then
	echo "rule citations: listed in $allow but no longer declared by the spec:" >&2
	for id in $gone; do echo "  $id" >&2; done
	status=1
fi

if [ "$status" -eq 0 ]; then
	printf 'rule citations: %s declared, %s cited, %s listed as uncited — ids accounted for (not their correctness)\n' \
		"$(wc -l < "$work/declared" | tr -d ' ')" \
		"$(wc -l < "$work/cited" | tr -d ' ')" \
		"$(wc -l < "$work/listed" | tr -d ' ')"
fi
exit "$status"

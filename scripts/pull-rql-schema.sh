#!/usr/bin/env bash
# Fetches ranke-graph's released rql.schema.json into the repo, where it is
# committed. The read language has one definition: ranke-go implements it, ranke-db's
# openapi.yaml $refs it, and this repository generates its Query type from it. A
# transcribed copy would give TypeScript a version of its own, which is the drift the
# arrangement exists to prevent.
#
# Committing the schema keeps the build offline and reproducible, and makes taking a
# new release a deliberate act with a reviewable diff.
set -euo pipefail

cd "$(dirname "$0")/.."

URL=${RQL_SCHEMA_URL:-https://github.com/rankegraph/ranke-graph/releases/latest/download/rql.schema.json}
DEST=schema/rql.schema.json

mkdir -p schema
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

echo ">> fetching $URL"
curl -fsSL "$URL" -o "$tmp"

# A truncated download would otherwise be committed as the schema.
if ! node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))' "$tmp"; then
	echo "the fetched schema is not valid JSON" >&2
	exit 1
fi

if [ -f "$DEST" ] && cmp -s "$tmp" "$DEST"; then
	echo ">> $DEST is already current"
	exit 0
fi

mv "$tmp" "$DEST"
trap - EXIT
echo ">> updated $DEST — run 'make generate' and review the diff"

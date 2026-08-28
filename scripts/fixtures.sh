#!/usr/bin/env bash
# Regenerates the reference data the tests check against, from Go programs importing
# ranke-go. ranke-go is the reference implementation, so its output is the
# specification of a decode rather than a sample of it.
#
# The generator resolves ranke-go from the module proxy, at the released version
# tools/go.mod names — never from a local checkout. An artifact must trace to a
# version: otherwise a regeneration part-way through a change bakes in an unreleased
# encoder, and the file gives no way to tell.
#
# To pick up new ranke-go behaviour, release ranke-go, then:
#
#   cd tools && go get github.com/rankegraph/ranke-go@vX.Y.Z && cd .. && scripts/fixtures.sh
#
# The version lands in the generated file's provenance, and a test refuses anything
# that did not come from a release.
set -euo pipefail

cd "$(dirname "$0")/.."

echo ">> claims (tools/fixtures)"
(cd tools && go run ./fixtures) > src/testing/claim_fixtures.json

echo ">> path.Match table (tools/globoracle)"
(cd tools && go run ./globoracle) > src/testing/glob_oracle.json

echo ">> query verdicts (tools/queryoracle)"
(cd tools && go run ./queryoracle) > src/testing/query_oracle.json

echo ">> framed result sequences (tools/seqoracle)"
(cd tools && go run ./seqoracle) > src/testing/seq_oracle.json

echo ">> regenerated; run 'make test' to see whether anything moved"

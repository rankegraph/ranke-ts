# Makefile — ranke-ts
#
# Thin wrapper over the npm scripts, so the targets match ranke-go's.

.PHONY: all install test typecheck build clean verify check release check-clean-tree fixtures \
	bench version generate pull-rql-schema check-generated docs docs-clean \
	spec ranke-go-check rule-citations next-version next-version-check \
	major minor patch breaking feature fix upgrade

# Foundational papers live in the ranke-graph repo. `make docs` pulls a fresh
# copy into docs/papers/ for local reference; the directory is gitignored and
# never committed — always fetched, never vendored.
RANKE_GRAPH_REPO ?= https://github.com/rankegraph/ranke-graph
RANKE_GRAPH_REF  ?= main
PAPERS_DIR       := docs/papers

# release-cycle.sh lives in ranke-graph and serves every consumer repo, so the git
# mechanics of a release (branch resolution, the merge-then-tag dance, the wait for
# CI) are written once, there. Cached under bin/ (gitignored), like brokkr elsewhere
# in this ecosystem. What differs here — the version is derived, not chosen, and
# this repo releases from a feature branch only — is scripts/release-next-version.sh
# and scripts/release-feature-branch-only (see that script's own header).
RELEASE_CYCLER     := bin/release-cycle.sh
RELEASE_CYCLER_URL ?= https://raw.githubusercontent.com/rankegraph/ranke-graph/$(RANKE_GRAPH_REF)/scripts/release-cycle.sh

all: typecheck test build

install:
	npm install

# The stamp a fresh clone is missing: tsc and json2ts live here, and npm run /
# npx resolve neither without it. Keyed on the lockfile, via `npm ci` rather than
# `install`'s `npm install`, so this reproduces the exact versions CI checks out —
# and reinstalls only when the lockfile actually moved, not on every invocation.
node_modules: package-lock.json
	npm ci
	@touch node_modules

# Node strips types, so the sources run as they are — no build before a test. The
# script adds a floor: `node --test` exits 0 when its glob matches nothing.
test:
	@./scripts/test.sh

# Regenerate the reference data from a released ranke-go. Needs a Go toolchain, so it
# is a deliberate step rather than part of `verify`.
fixtures:
	@./scripts/fixtures.sh

# Print a performance baseline: us per claim for a build with its stages, and bytes and
# peak RSS for a decode. A record to re-run and compare by hand, so it asserts nothing and
# stays out of `verify`, where a host that swings would fail a timing assertion at random.
# Usage: make bench [ITERATIONS=20000] [CLAIMS=2000]
ITERATIONS ?= 20000
CLAIMS     ?= 2000
bench:
	@./scripts/bench.sh $(ITERATIONS) $(CLAIMS)

# Take ranke-graph's released RQL schema, then regenerate the Query type from it.
# Both are deliberate: the schema is committed so the build stays offline, and taking
# a new one leaves a reviewable diff.
pull-rql-schema:
	@./scripts/pull-rql-schema.sh

generate: node_modules
	@./scripts/generate.sh

# Refuses a release whose generated Query type no longer matches the committed
# schema — the artifact and its source must move together.
#
# WRITES to the tree: `generate` rewrites src/query.ts before the diff, so a run that
# fails leaves the regenerated file in place, which is the point — the diff is the
# report. A run that passes rewrites it byte-identically and leaves the tree clean.
check-generated: generate
	@git diff --quiet -- src/query.ts || { \
		echo "src/query.ts is stale — run 'make generate' and commit the result" >&2; \
		exit 1; \
	}

# Covers the tests too, which the build config excludes.
typecheck: node_modules
	npm run typecheck

build: node_modules
	npm run build

clean:
	rm -rf dist

# Every rule id a comment cites is one the spec declares, and every declared rule is
# cited or listed in scripts/rule-citations.allow with a reason. It says nothing about
# whether a citation is TRUE — a text comparison cannot. Needs the spec, so `make docs`
# first; against a copy of your own:
#   make rule-citations RANKE_SPEC=path/to/spec.typ
rule-citations:
	@./scripts/rule-citations.sh

# Bring the papers up to ranke-graph's tip, cloning only when it has moved. There are
# only two ways to have a spec to check against — fetch it, or track a copy — and
# tracking a copy of a document that lives in a sibling repo duplicates it for nothing.
# So `verify` fetches, which is what makes it a check against the LATEST spec rather
# than against whenever someone last pulled. Establishing what the latest is costs 40
# bytes where taking it costs 1.8 MB, so the two are separated: see scripts/fetch-spec.sh.
spec:
	@./scripts/fetch-spec.sh

# ranke-go is the reference this library mirrors, so `verify` holds the pin to its latest
# release and the fixtures to the pin. Asked of the module proxy over HTTP, so a freshness
# question does not drag in the Go toolchain that keeps `fixtures` out of `verify`.
#   make ranke-go-check RANKE_GO_LATEST=v0.24.0   # offline, or ahead of a release
ranke-go-check:
	@./scripts/check-ranke-go.sh

# The gate a release must pass. ranke-go splits the fast checks from its full
# suite; here the whole lot runs in under a second, so `verify` is `all`.
#
# It checks against the LATEST spec, taken before it checks anything: a spec that moved
# while this code did not means the code is broken, and that is the finding rather than a
# false alarm. The reference claims ride in the same clone (`spec`), so the rules and the
# claims exercising them cannot come from two different moments.
#
# The cost is that `verify` needs the network. Offline, name local copies instead:
#   make verify RANKE_SPEC=path/to/spec.typ RANKE_TESTDATA_DIR=path/to/vectors
#
# check-generated is here because it was documented as a release gate and run by
# nothing — not verify, not release, not CI. A guarantee no target enforces is a
# comment. It WRITES src/query.ts; see its own note above.
verify: spec ranke-go-check next-version-check typecheck test build check-generated rule-citations

# The conventional name for the gate above — an alias, so both spellings run the
# same checks and neither can drift from the other.
check: verify

# The version, which is the latest release tag: package.json carries 0.0.0 in the tree
# and the release workflow stamps the tag's number in just before publishing. `--match`
# holds the answer to release tags, as scripts/release.sh does when it picks the tag to
# bump from — a prerelease or a stray tag is not the version this tree answers to.
version:
	@git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || { \
		echo "no release tag found — package.json's 0.0.0 stands in until one is cut" >&2; \
		exit 1; \
	}

# The version the next release takes: ranke-go's, or the first free patch above it. The
# major and minor are always ranke-go's, so the two read side by side.
next-version:
	@./scripts/next-version.sh

# The rule above, over its worked examples and the invariant they instance. In `verify`
# because release machinery that computes the wrong version mints a wrong release, and
# nothing downstream would question the number it was handed.
next-version-check:
	@./scripts/next-version-test.sh

# Cut a release: verify → rebase onto the default branch → merge via PR → tag the
# merged tip → push the tag → watch the release workflow, failing here if it fails.
# Run it from a feature branch; from the default branch it refuses, since the tag
# must land on code a PR merged and CI checked.
#
# Usage: make release. There is no bump word to pass — the version follows the ranke-go
# this tree mirrors, so nothing about it is a judgement to make at release time.
# check-clean-tree first, ahead of verify: a dirty tree is a free, instant check,
# and verify is not — failing on it should not cost a build first.
check-clean-tree:
	@[ -z "$$(git status --porcelain)" ] || { echo "working tree is dirty — commit or stash before releasing" >&2; exit 1; }

release: check-clean-tree verify $(RELEASE_CYCLER)
	@$(RELEASE_CYCLER)

$(RELEASE_CYCLER): ## Cache release-cycle.sh from ranke-graph (bin/ is gitignored — infra, never vendored)
	@mkdir -p $(dir $(RELEASE_CYCLER))
	@curl -fsSL $(RELEASE_CYCLER_URL) -o $(RELEASE_CYCLER)
	@chmod +x $(RELEASE_CYCLER)

# $(RELEASE_CYCLER) is a file target with no prerequisite, so once cached it is
# never re-fetched on its own — a stale copy (missing a ranke-graph fix) would sit
# there forever otherwise. upgrade is the one command that already means "bring
# everything to latest", so refreshing it here is what makes that true.
upgrade: ## Refresh the cached release-cycle.sh from ranke-graph
	@rm -f $(RELEASE_CYCLER)
	@$(MAKE) $(RELEASE_CYCLER)

# Absorb a bump word so `make release patch` reaches release-cycle.sh, which refuses
# it by name rather than leaving make to report a missing target. Someone passing one
# believes they chose something, and should be told they did not.
major minor patch breaking feature fix:
	@:

docs:
	@echo ">> fetching ranke-graph papers into $(PAPERS_DIR)/"
	@tmp=$$(mktemp -d) && \
		git clone --depth 1 --branch $(RANKE_GRAPH_REF) $(RANKE_GRAPH_REPO) $$tmp >/dev/null 2>&1 && \
		rm -rf $(PAPERS_DIR) && mkdir -p $(PAPERS_DIR) && \
		cp -r $$tmp/[0-9]*-* $(PAPERS_DIR)/ && \
		for d in shared spec glossary; do \
			[ -d $$tmp/$$d ] && cp -r $$tmp/$$d $(PAPERS_DIR)/; \
		done; \
		cp $$tmp/LICENSE $(PAPERS_DIR)/LICENSE 2>/dev/null || true; \
		rm -rf $$tmp; \
		echo ">> pulled $$(find $(PAPERS_DIR) -name '*.typ' | wc -l | tr -d ' ') paper(s)"

docs-clean:
	rm -rf $(PAPERS_DIR)

#!/usr/bin/env bash
# Cut a release as a self-contained cycle, run from a FEATURE BRANCH: ensure the
# tree is clean; push the branch, open + merge a PR into the default branch so the
# tag points at MERGED code; tag the merged tip; push the tag (which triggers the
# release workflow); then return to the branch you started on. It never leaves you
# on — or commits directly to — the default branch, and refuses to run from it.
#
# Usage: git switch -c <branch> && make release
#   The version is not chosen: it follows the ranke-go in tools/go.mod
#   (scripts/next-version.sh). Needs `gh`.
#
# '$default' is protected: a PR and a green `test` check are the only way in, so
# the merge is queued with --auto and waited on. The repo therefore needs
# auto-merge enabled (Settings → General → Allow auto-merge).
set -euo pipefail

# No bump word: the version is DERIVED from the ranke-go this tree mirrors, so there is
# nothing to choose. scripts/next-version.sh states the rule. A word passed anyway is
# refused rather than ignored, since someone passing one believes they chose something.
if [ "$#" -gt 0 ]; then
	cat >&2 <<-MSG
		release takes no bump word: the version follows the ranke-go in tools/go.mod,
		so ranke-ts $(./scripts/next-version.sh) is what this release would be.

		  make release
	MSG
	exit 1
fi

git fetch --tags --force origin >/dev/null 2>&1 || true
default="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')"
default="${default:-main}"
start="$(git rev-parse --abbrev-ref HEAD)"

# 1. Releases come off a feature branch, so every tag points at code a PR merged
#    and CI checked. '$default' is protected on both, and a tag cut from a local
#    '$default' would sidestep them — even a synced one, since the checkout can
#    hold commits that reached it by some other route.
if [ "$start" = "$default" ]; then
	cat >&2 <<-MSG
		on '$default' — releases are cut from a feature branch, so the tag lands on
		merged, CI-checked code. Branch, then release:

		  git switch -c <branch>
		  make release
	MSG
	exit 1
fi

# Always end back on the branch we started on — never park on the default branch.
trap 'git checkout --quiet "$start" 2>/dev/null || true' EXIT

# 2. Push the branch, open a PR if there isn't one, and merge it into the default
#    branch — without switching this checkout — so the tag comes off the merged tip.
if ! command -v gh >/dev/null; then
	echo "on '$start' — releasing needs it merged to '$default'. Install gh (https://cli.github.com) or merge manually, then re-run." >&2
	exit 1
fi
git fetch origin "$default" >/dev/null 2>&1

# An earlier `make release` can have merged '$start' already and then failed
# past that point — the tagged publish, say. Its commits are then already an
# ancestor of '$default': nothing to PR, and `gh pr create` on zero commits
# ahead fails outright. Resume from the merged tip instead of redoing a merge
# that already happened.
if git merge-base --is-ancestor "$start" "origin/$default"; then
	echo "'$start' is already merged into '$default' — resuming from there…"
	target="origin/$default"
else
	# Rebase onto the latest default first, so the PR is based on current
	# '$default' and merges cleanly. Abort cleanly on conflict rather than
	# leaving a half-finished rebase behind.
	echo "rebasing '$start' onto origin/$default…"
	if ! git rebase "origin/$default"; then
		git rebase --abort 2>/dev/null || true
		echo "rebase onto origin/$default hit conflicts — resolve them, then re-run" >&2
		exit 1
	fi
	echo "pushing '$start' and merging it into '$default'…"
	git push --force-with-lease -u origin "$start"
	if [ -z "$(gh pr list --head "$start" --state open --json number --jq '.[0].number' 2>/dev/null)" ]; then
		echo "opening a pull request…"
		gh pr create --base "$default" --head "$start" --fill
	fi
	# '$default' is protected on its CI check, which cannot have finished this soon
	# after the push — so queue the merge and let GitHub land it when the check
	# goes green. A plain `gh pr merge` here is rejected as a failing requirement.
	echo "merging the pull request once CI passes…"
	gh pr merge "$start" --merge --auto
	state=""
	for _ in $(seq 1 120); do
		state="$(gh pr view "$start" --json state --jq .state 2>/dev/null || true)"
		[ "$state" = "MERGED" ] && break
		if [ "$state" = "CLOSED" ]; then
			echo "the pull request closed without merging — no tag cut" >&2
			exit 1
		fi
		# A failed check leaves the PR OPEN with the merge still queued, so waiting out
		# the timeout reports a red CI ten minutes after it was knowable. Read the rollup
		# and stop on the first check that failed. A rollup entry is a check run (name,
		# conclusion) or a commit status (context, state), so both spellings are read.
		failed="$(gh pr view "$start" --json statusCheckRollup --jq '
			.statusCheckRollup
			| map(select((.conclusion // .state) as $c
				| $c == "FAILURE" or $c == "CANCELLED" or $c == "TIMED_OUT"
					or $c == "ACTION_REQUIRED" or $c == "ERROR"))
			| map(.name // .context) | join(", ")' 2>/dev/null || true)"
		if [ -n "$failed" ] && [ "$failed" != "null" ]; then
			cat >&2 <<-MSG
				CI failed on '$start' ($failed) — no tag cut.

				  see:  gh pr checks $start
				  logs: gh run view --log-failed

				The merge stays queued, so pushing a fix to '$start' lands it.
			MSG
			exit 1
		fi
		sleep 5
	done
	if [ "$state" != "MERGED" ]; then
		echo "the pull request has not merged after 10 minutes (checks pending, or auto-merge off)." >&2
		echo "  check: gh pr checks $start" >&2
		exit 1
	fi
	git fetch origin "$default" >/dev/null 2>&1
	target="origin/$default"

	# Bring the branch we started on up onto the merged default, so it's a clean
	# base for the next round of work (the merge kept our commits, so this
	# fast-forwards rather than replaying).
	echo "rebasing '$start' onto origin/$default…"
	git checkout --quiet "$start"
	git rebase "origin/$default"
fi

# 3. Take the version the ranke-go this tree mirrors fixes, tag the merged tip, push
#    the tag. Derived rather than chosen: scripts/next-version.sh states the rule, and
#    the tags it reads are the ones fetched at the top of this script.
next="$(./scripts/next-version.sh)"
latest="$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 || true)"
latest="${latest:-v0.0.0}"
sha="$(git rev-parse "$target")"

# A tag from an earlier attempt at THIS release — merged already, then the tagged
# workflow failed past that (a bad publish token, say) — already names $sha: resume
# by rerunning its workflow rather than failing on "tag already exists". One naming
# some OTHER commit is a real collision, not a resume, and is left for a human.
if existing="$(git rev-parse --quiet --verify "refs/tags/$next^{commit}" 2>/dev/null)"; then
	if [ "$existing" != "$sha" ]; then
		echo "$next already tags a different commit ($existing) — not this release" >&2
		exit 1
	fi
	echo "$next already tags $target — rerunning its release workflow…"
	run_id="$(gh run list --workflow=release.yml --json databaseId,headSha \
		--jq "[.[] | select(.headSha == \"$sha\")] | max_by(.databaseId).databaseId" 2>/dev/null || true)"
	if [ -z "$run_id" ] || [ "$run_id" = "null" ]; then
		echo "  $next is tagged, but no release run for it — check: gh run list --workflow=release.yml" >&2
		exit 1
	fi
	gh run rerun "$run_id" --failed
else
	echo "tagging ${latest} -> ${next} on ${default} (ranke-go's line)"
	git tag -a "$next" "$target" -m "release $next"

	# The run a tag push triggers is found by the commit it points at, and a commit
	# can carry more than one tag — re-releasing an unchanged commit leaves every
	# earlier attempt's run on the same SHA. Note the highest run id before pushing;
	# run ids only ascend, so the wait below can insist on a run created after this
	# point rather than settling for a stale one.
	prev_run="$(gh run list --workflow=release.yml --limit 1 --json databaseId \
		--jq '.[0].databaseId // 0' 2>/dev/null || true)"
	prev_run="${prev_run:-0}"

	git push origin "$next"

	run_id=""
	for _ in $(seq 1 30); do
		run_id="$(gh run list --workflow=release.yml --json databaseId,headSha \
			--jq "map(select(.headSha == \"$sha\" and .databaseId > $prev_run))[0].databaseId" \
			2>/dev/null || true)"
		[ -n "$run_id" ] && [ "$run_id" != "null" ] && break
		sleep 2
	done
fi

# 4. Wait for the release workflow — freshly triggered, or just rerun — so a failed
#    build or publish surfaces here instead of silently.
echo "waiting for the release workflow…"
if [ -z "${run_id:-}" ] || [ "$run_id" = "null" ]; then
	echo "  tag pushed, but no release run appeared — check: gh run list --workflow=release.yml" >&2
elif gh run watch "$run_id" --exit-status; then
	echo "release ${next} published ✓ (back on '$start')"
	exit 0
else
	echo "release ${next} FAILED in CI — see: gh run view $run_id --log-failed" >&2
	exit 1
fi
echo "pushed ${next} — the release workflow triggers on the tag. Back on '$start'."

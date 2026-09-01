#!/usr/bin/env bash
# scripts/release-cycle.sh's release-next-version.sh hook: this repo's version
# is derived from the ranke-go it mirrors, so nothing about it is a judgement
# release-cycle.sh should make at release time. scripts/next-version.sh states
# the rule; this only wires it in.
exec ./scripts/next-version.sh

// package: testing / testdata
// type:    io
// job:     resolving ranke-graph's reference-artifact set — locate it, read the manifest
// limits:  location and schema; running the cases is vectors_test.ts's
//
// Mirrors ranke-go's internal/vectors. The set is the spec's artifact rather than
// either implementation's, so running it is what lets ranke-ts fail conformance —
// and it is the only reference data here carrying cases that must be REFUSED.
//
// It comes from the papers `make spec` fetches, which is where the SPEC comes from, so the
// rules and the claims that exercise them move together. Sourcing the claims from a release
// instead let the two drift: the code would be checked against today's spec and a bundle
// cut whenever the last release was, and a changed spec that ought to break this library
// would pass unremarked. The published tarball says the same thing a release behind.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** MANIFEST is the manifest's filename inside a set. */
export const MANIFEST = 'manifest.json'

// Reason codes, so a test asserts the outcome it expected rather than any refusal.
export const ReasonOK = 'ok'
export const ReasonIDMismatch = 'id_mismatch'
export const ReasonWrongMessage = 'wrong_message'
export const ReasonMalformedID = 'malformed_id'
export const ReasonIdentitySign = 'identity_sign_mismatch'
export const ReasonNoContributor = 'unresolvable_contributor'
export const ReasonHeightWrong = 'height_wrong'
export const ReasonContentMismatch = 'content_hash_mismatch'

/**
 * ClaimCase is one claim record under the id it is offered as. The id is not part of
 * the record, so the pairing is what a case asserts.
 */
export interface ClaimCase {
  readonly file: string
  readonly id: string
  readonly verify: boolean
  readonly reason: string
  readonly why: string
}

/** ContentCase is one content blob under the hash it is offered as. */
export interface ContentCase {
  readonly file: string
  readonly hash: string
  readonly verify: boolean
  readonly reason: string
  readonly why: string
}

export interface Provenance {
  readonly generator: string
  readonly version: string
  readonly generated_at: string
}

/** Manifest names every artifact and the outcome an implementation must reach. */
export interface Manifest {
  readonly note: string
  readonly provenance: Provenance
  readonly claims: readonly ClaimCase[]
  readonly content: readonly ContentCase[]
}

/** ArtifactSet is a resolved set: where it lives, and what it expects. */
export interface ArtifactSet {
  readonly root: string
  readonly manifest: Manifest
  /** origin says where the set came from, for a test to report. */
  readonly origin: string
}

// RANKE_TESTDATA_DIR names a set of your own, for working offline or against one not
// published yet.
const DIR_ENV = 'RANKE_TESTDATA_DIR'

// Where `make docs` puts ranke-graph's reference claims, beside the spec it fetches in the
// same clone. A path rather than a download: one fetch, one source, no second copy to age.
const papersSet = new URL('../../docs/papers/01-ranke-graph/testdata/cbor/', import.meta.url)
  .pathname

/**
 * resolveArtifacts returns the set: the directory RANKE_TESTDATA_DIR names, else the one
 * beside the fetched papers.
 *
 * An absent set is an error and never a skip: silently not checking conformance is the one
 * outcome worse than a red run.
 */
export async function resolveArtifacts(): Promise<ArtifactSet> {
  const named = process.env[DIR_ENV]
  if (named !== undefined && named !== '') {
    return { root: named, manifest: loadManifest(named), origin: `${DIR_ENV}=${named}` }
  }
  if (!existsSync(join(papersSet, MANIFEST))) {
    throw new Error(
      `no reference claims at ${papersSet} — run 'make docs', or point ${DIR_ENV} at a set`,
    )
  }
  return { root: papersSet, manifest: loadManifest(papersSet), origin: `papers at ${papersSet}` }
}

function loadManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as Manifest
}

/** readArtifact returns one file's bytes, named as the manifest names it. */
export function readArtifact(root: string, file: string): Uint8Array {
  return readFileSync(join(root, file))
}


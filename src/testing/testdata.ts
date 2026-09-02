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

// Reason codes, so a test asserts the outcome it expected rather than any refusal. The set
// is ranke-go's internal/vectors/manifest.go, which is what mints them.
export const ReasonOK = 'ok'
export const ReasonIDMismatch = 'id_mismatch'
export const ReasonWrongMessage = 'wrong_message'
export const ReasonMalformedID = 'malformed_id'
export const ReasonNotEnveloped = 'not_enveloped'
export const ReasonNoContributor = 'unresolvable_contributor'
export const ReasonHeightWrong = 'height_wrong'
export const ReasonContentMismatch = 'content_hash_mismatch'
export const ReasonTimestampForm = 'timestamp_form'
export const ReasonBothContent = 'content_both_slots'
export const ReasonEdgeOrder = 'edge_order'
export const ReasonDatedForm = 'dated_form'
/** The first branch table's fixed height, read off the record alone. */
export const ReasonFirstTableHeight = 'first_table_height'
// The bookmark codes, one per rule a 𝒰_hist record can break.
export const ReasonBookmarkForm = 'bookmark_form'
export const ReasonBookmarkSignature = 'bookmark_signature'
export const ReasonBookmarkSlot = 'bookmark_slot'
export const ReasonBookmarkReference = 'bookmark_reference'
export const ReasonBookmarkGap = 'bookmark_gap'

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
  /** The rules this record breaks, absent for a case that must verify. */
  readonly violates?: readonly string[]
}

/**
 * BookmarkCase is one 𝒰_hist record under the id_seq(i, s) slot it is offered at
 * (`V-BMENV`). A case naming a list belongs to that whole list rather than standing alone:
 * the list is assembled from every case sharing the name, opened at the one marked open, and
 * judged together — which is the only register a list's contiguity has.
 */
export interface BookmarkCase {
  readonly file: string
  readonly slot: string
  readonly verify: boolean
  readonly reason: string
  readonly why: string
  readonly list?: string
  readonly open?: boolean
  readonly violates?: readonly string[]
}

/** ContentCase is one content blob under the hash it is offered as. */
export interface ContentCase {
  readonly file: string
  readonly hash: string
  readonly verify: boolean
  readonly reason: string
  readonly why: string
  readonly violates?: readonly string[]
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
  readonly bookmarks: readonly BookmarkCase[]
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

// loadManifest reads a set's manifest and demands a list for every keyspace it describes.
// ranke-go leaves `bookmarks` omitempty, so a set predating them parses as a manifest with
// none — and a suite reading that as "no bookmark cases to run" would report conformance it
// never checked. An absent keyspace is a failure here, the same way an absent set is.
function loadManifest(dir: string): Manifest {
  const m = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as Manifest
  for (const keyspace of ['claims', 'content', 'bookmarks'] as const) {
    if (!Array.isArray(m[keyspace])) {
      throw new Error(`${join(dir, MANIFEST)} names no ${keyspace} — the set is older than the suite`)
    }
  }
  return m
}

/** readArtifact returns one file's bytes, named as the manifest names it. */
export function readArtifact(root: string, file: string): Uint8Array {
  return readFileSync(join(root, file))
}


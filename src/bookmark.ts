// package: ranke / bookmark
// type:    crypto
// job:     the bookmark record (`V-BMENV`) — a COSE_Sign1 over S([i, s, k]) that 𝒰_hist holds
// under id_seq(i, s) — plus id_seq itself (`V-IDSEQ`) and the slot a fetched record must key
// (`V-BMSLOT`)
// limits:  reads one record, which is what a fetch has; the list it belongs to lives in
// 𝒰_hist, and resolving the ids it names takes a 𝒰 read
//
// Mirrors the read half of ranke-go's bookmark.go. A bookmark is the Sequencer's to write
// (SignBookmark, the minted seed), and its checks against a Universe need references resolved
// and a key, so neither half has a counterpart; src/vectors_test.ts runs those checks against
// the closure it assembles, as it does a claim's own.

import { bookmarkEnvelopeParts } from './codec_envelope.ts'
import { type Id, hashContent, hashFromMultihashBytes } from './id.ts'
import { CborReader, CborWriter } from './internal/cbor.ts'

/** RankeBookmarkError reports bytes that are not a bookmark of the pinned shape. */
export class RankeBookmarkError extends Error {
  override readonly name: string = 'RankeBookmarkError'
}

/**
 * Bookmark is one entry of a bookmark list: the index i it sits at, the seed s its list is
 * keyed on, the head id k it records, and the contributor its kid names (`V-BMENV`). Plain
 * frozen data with string ids, as a decoded claim is (-> claim).
 */
export interface Bookmark {
  readonly index: number
  readonly seed: Uint8Array
  readonly head: string
  readonly signer: string
}

/**
 * idSeq computes id_seq(i, s) := H(S([i, s])) (`V-IDSEQ`). A claim serializes as a map
 * (`V-SER`), so CBOR's major type alone keeps the two keyspaces apart.
 */
export function idSeq(index: number, seed: Uint8Array): Id {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RankeBookmarkError(`an index is a whole number, got ${index}`)
  }
  const w = new CborWriter()
  w.writeArrayHeader(2)
  w.writeUint(index)
  w.writeBytes(seed)
  return hashContent(w.bytes())
}

/**
 * decodeBookmark holds a stored record to `V-BMENV`: a tagged COSE_Sign1, its protected
 * header alg and kid alone, over the three-element S([i, s, k]). Checking its signature needs
 * the pubkey the kid's contributor publishes, so a decode reports the kid and stops.
 */
export function decodeBookmark(raw: Uint8Array): Bookmark {
  const { payload, kid } = envelope(raw)
  const signer = id(kid, 'kid')

  const r = new CborReader(payload)
  try {
    // The arity is read rather than assumed, so a record of another length is refused here
    // instead of being read short.
    const arity = r.readArrayHeader()
    if (arity !== 3) {
      throw new RankeBookmarkError(
        `a bookmark's payload is the three-element S([i, s, k]), got ${arity}`,
      )
    }
    const index = r.readInt()
    const seed = r.readBytes()
    const head = r.readBytes()
    r.expectEnd()
    if (index < 0n || index > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RankeBookmarkError(`an index beyond 2^53 exceeds what a number holds, got ${index}`)
    }
    if (seed.length === 0) throw new RankeBookmarkError('the payload carries an empty seed')
    return Object.freeze({
      index: Number(index),
      seed,
      head: id(head, 'head id').toString(),
      signer: signer.toString(),
    })
  } catch (e) {
    if (e instanceof RankeBookmarkError) throw e
    throw new RankeBookmarkError(`a bookmark's payload is S([i, s, k]): ${message(e)}`)
  }
}

/**
 * bookmarkAt reads the record offered at slot and recomputes id_seq(i, s) from the payload's
 * own i and s (`V-BMSLOT`). A mismatch is absence at that slot rather than damage — what
 * sits there belongs elsewhere.
 */
export function bookmarkAt(slot: Id, raw: Uint8Array): Bookmark {
  const bm = decodeBookmark(raw)
  const recomputed = idSeq(bm.index, bm.seed)
  if (!recomputed.equal(slot)) {
    throw new RankeBookmarkError(
      `a bookmark's own (i, s) key another slot than the one it was fetched at (\`V-BMSLOT\`): ` +
        `carries i=${bm.index}, keying id_seq to ${recomputed.toString()}, offered at ${slot.toString()}`,
    )
  }
  return bm
}

// envelope reads the COSE_Sign1 around a bookmark, reporting a refusal as this module's own:
// a caller holding a 𝒰_hist record wants one error class for every way it is not a bookmark.
function envelope(raw: Uint8Array): { payload: Uint8Array; kid: Uint8Array } {
  try {
    return bookmarkEnvelopeParts(raw)
  } catch (e) {
    throw new RankeBookmarkError(message(e))
  }
}

// id frames raw as a multihash. ranke-go's idFromBytes validates, where this library's wraps
// without looking, so the checking counterpart is the one named for it.
function id(raw: Uint8Array, what: string): Id {
  try {
    return hashFromMultihashBytes(raw)
  } catch (e) {
    throw new RankeBookmarkError(`${what}: ${message(e)}`)
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

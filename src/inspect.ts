// package: ranke / inspect
// type:    io
// job:     rendering a claim's bytes for a debugger — the slots a record carries, and the
// deviations that stop a decode, each at the offset it was found
// limits:  explains bytes, never admits them: the verdict comes from decodeClaim, so this
// module has no opinion of its own about validity
//
// ranke-go has no counterpart, as internal/cbor.ts has none: a Go caller reading a bad
// record reaches for a debugger, where a browser tab is the debugger. The reader refuses
// non-canonical bytes by design (`V-SER`), which cuts the wrong way for a person holding a
// malformed claim — that is the record they most want to see.
//
// A violating claim is rejected (spec §How to Read This), so `claim` is present only where
// a decode accepted the bytes. Nothing here hands back a usable claim built from a record
// it also called broken.

import type { Claim } from './claim.ts'
import { decodeClaim, type DecodeOptions } from './codec.ts'
import { envelopeParts } from './codec_envelope.ts'
import {
  NodeKeyEdges,
  type RecordKind,
  recordKeyName,
} from './record_keys.ts'
import { CborReader } from './internal/cbor.ts'

/** InspectedSlot is one numeric key of a record, and where its value sits. */
export interface InspectedSlot {
  /** The numeric key, as `V-SER` fixes it. */
  readonly key: number
  /** The slot's name, absent for a key the table does not assign (record_keys.ts). */
  readonly name?: string
  /** Byte offset of the key within the claim's bytes. */
  readonly at: number
  /** Length in bytes of the slot's encoded value. */
  readonly length: number
}

/** InspectedRecord is one node or edge record, named by where it was reached. */
export interface InspectedRecord {
  readonly kind: RecordKind
  /** Where this record sits: "node", or "node.edges[1]". */
  readonly path: string
  /** Byte offset of the record within the claim's bytes. */
  readonly at: number
  readonly slots: readonly InspectedSlot[]
}

/** Deviation is one reason these bytes are not a canonical claim, and where it is. */
export interface Deviation {
  /** Byte offset within the claim's bytes, so a reader can point at it. */
  readonly at: number
  /** The record the deviation was found in: "node", "node.edges[1]", or "claim". */
  readonly path: string
  readonly message: string
}

/**
 * ClaimInspection is what these bytes hold and what is wrong with them. A caller renders
 * `records` whatever the verdict, and `deviations` says why a decode refused.
 */
export interface ClaimInspection {
  /** Whether decodeClaim accepts these bytes. Decided by the decoder, not by this module. */
  readonly valid: boolean
  /** The decoded claim, present only when valid — broken bytes yield no usable claim. */
  readonly claim?: Claim
  /** Every record the walk could frame, outermost first. */
  readonly records: readonly InspectedRecord[]
  /** Every deviation found, in the order the bytes carry them. */
  readonly deviations: readonly Deviation[]
}

/**
 * inspectClaim renders a claim's bytes and reports what stops them decoding. It does not
 * throw: bytes that are not a claim at all come back as a deviation and no records.
 *
 * How far it recovers follows the encoding rather than a chosen depth. A slot whose value
 * will not parse is reported and skipped, so the slots after it still render; a record
 * whose own framing is broken ends there, since without a well-formed key there is no way
 * to find the next slot.
 */
export function inspectClaim(bytes: Uint8Array, opts: DecodeOptions = {}): ClaimInspection {
  const records: InspectedRecord[] = []
  const deviations: Deviation[] = []

  // The envelope first (`V-ENV`), the record a reader wants being its payload. A frame
  // that will not parse is the case this whole module exists for, so its complaint is a
  // deviation like any other rather than an exception.
  try {
    const parts = envelopeParts(bytes)
    inspectPayload(bytes, parts.payloadAt, parts.payload.length, records, deviations)
  } catch (err) {
    deviations.push({ at: 0, path: 'envelope', message: (err as Error).message })
  }

  // The verdict is the decoder's, so this module never disagrees with the library that
  // actually refuses the bytes. Its message joins the list only where the walk found
  // nothing: a decode stops at its first complaint, so where the walk already located a
  // fault the decoder is restating it without an offset, and a reader would show one
  // problem twice. Where the walk is silent the refusal is semantic — an unreadable
  // timestamp, both content slots, a type that is not in the vocabulary — and the
  // decoder's message is the only account of it there is.
  let claim: Claim | undefined
  try {
    claim = decodeClaim(bytes, '', opts)
  } catch (err) {
    if (deviations.length === 0) {
      deviations.push({ at: 0, path: 'claim', message: (err as Error).message })
    }
  }

  return Object.freeze({
    valid: claim !== undefined,
    ...(claim === undefined ? {} : { claim }),
    records: Object.freeze(records),
    deviations: Object.freeze(deviations),
  })
}

// inspectNode renders the node record and each edge inlined under its edges slot.
function inspectPayload(
  bytes: Uint8Array,
  at: number,
  _length: number,
  records: InspectedRecord[],
  deviations: Deviation[],
): void {
  const slots = walkRecord(bytes, at, 'node', deviations)
  records.push(Object.freeze({ kind: 'node', path: 'node', at, slots: Object.freeze(slots) }))

  const edges = slots.find((s) => s.key === NodeKeyEdges)
  if (edges === undefined) return
  const listAt = valueStart(bytes, edges)
  const r = new CborReader(bytes.subarray(listAt, listAt + edges.length))
  let count: number
  try {
    count = r.readArrayHeader()
  } catch (err) {
    deviations.push({ at: listAt, path: 'node.edges', message: (err as Error).message })
    return
  }
  for (let i = 0; i < count; i++) {
    const path = `node.edges[${i}]`
    const start = listAt + r.position
    try {
      r.skipValue()
    } catch (err) {
      deviations.push({ at: start, path, message: (err as Error).message })
      return // without a framed value there is no way to reach the next edge
    }
    records.push(
      Object.freeze({
        kind: 'edge',
        path,
        at: start,
        slots: Object.freeze(walkRecord(bytes, start, path, deviations)),
      }),
    )
  }
}

// walkRecord reads one CBOR map's numeric keys from `at`, reporting each slot and every
// deviation it meets. Canonical order is checked here rather than left to the reader, so a
// violation carries the offset of the key that broke it.
function walkRecord(
  bytes: Uint8Array,
  at: number,
  path: string,
  deviations: Deviation[],
): InspectedSlot[] {
  const kind: RecordKind = path === 'node' ? 'node' : 'edge'
  const r = new CborReader(bytes.subarray(at))
  const slots: InspectedSlot[] = []
  let count: number
  try {
    count = r.readMapHeader()
  } catch (err) {
    deviations.push({ at, path, message: (err as Error).message })
    return slots
  }

  let previous = -1
  for (let i = 0; i < count; i++) {
    const keyAt = at + r.position
    let key: number
    try {
      key = Number(r.readInt())
    } catch (err) {
      // A key that will not parse leaves no way to find the next one.
      deviations.push({ at: keyAt, path, message: (err as Error).message })
      return slots
    }
    if (key <= previous) {
      deviations.push({
        at: keyAt,
        path,
        message: `map keys out of canonical order: ${key} after ${previous}`,
      })
    }
    previous = key

    const valueAt = at + r.position
    try {
      r.skipValue()
    } catch (err) {
      deviations.push({ at: valueAt, path, message: (err as Error).message })
      return slots
    }
    const name = path === 'claim' ? undefined : recordKeyName(kind, key)
    slots.push(
      Object.freeze({
        key,
        ...(name === undefined ? {} : { name }),
        at: keyAt,
        length: at + r.position - valueAt,
      }),
    )
  }
  return slots
}

// valueStart is the offset of a slot's value: the key sits at `at`, the value follows it.
function valueStart(bytes: Uint8Array, slot: InspectedSlot): number {
  const r = new CborReader(bytes.subarray(slot.at))
  try {
    r.readInt()
  } catch {
    return slot.at
  }
  return slot.at + r.position
}

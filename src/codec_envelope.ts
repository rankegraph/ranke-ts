// package: ranke / codec_envelope
// type:    crypto
// job:     the claim envelope (`V-ENV`) — the one COSE_Sign1 shape a claim is stored as,
// which the Universe holds under id(v) = H(S(env(v))) — and the bookmark envelope beside it,
// whose protected header names a kid as well (`V-BMENV`)
// limits:  the record it wraps is codec.ts's, and nothing here judges that record's shape;
// verifies no signature and holds no key — the application signs (-> claim_builder)
//
// Not a COSE implementation, and not meant to grow into one. `V-ENV` pins every field —
// tag 18, `alg` alone protected, nothing unprotected — and `V-SIGN` pins the algorithm to
// Ed25519, so the envelope is one byte template with two variable strings in it. Reading it
// is recognising that template and refusing everything else, which is what stops one claim
// from having a second stored form and so a second id.
//
// ranke-go reaches one signer and one verifier over both shapes (signCOSE, verifySign1 in
// codec_envelope.go), the protected header being the only field they differ in. The same
// split holds here, over the frame a reader walks rather than over a COSE library's API.
//
// ranke-go reaches for veraison/go-cose (codec_envelope.go) and then refuses whatever that
// library accepts beyond the pinned shape. With nothing to ship here, the template is
// written directly; the bytes were pinned against ranke-graph's published envelopes rather
// than against a reading of RFC 9052.

import { CborWriter, encodeText } from './internal/cbor.ts'

/** RankeEnvelopeError reports bytes that are not an envelope of the pinned shape. */
export class RankeEnvelopeError extends Error {
  override readonly name: string = 'RankeEnvelopeError'
}

// The frame, byte for byte. The CBOR reader refuses a tag — a tag has no place in a ranke
// record — so the frame around one is read here rather than through it.
const TAG_COSE_SIGN1 = 0xd2 // tag(18)
const ARRAY_OF_FOUR = 0x84
/**
 * The protected header as it appears in the envelope: bstr(3) wrapping `{1: -8}`, `alg`
 * alone naming EdDSA. A constant rather than an encoding step, `V-SIGN` fixing the one
 * algorithm and `V-ENV` forbidding any other parameter.
 */
const PROTECTED = Uint8Array.of(0x43, 0xa1, 0x01, 0x27)
/**
 * A bookmark's protected header opens `{1: -8, 4: ...}` — alg, then COSE's kid, whose byte
 * string follows (`V-BMENV`). Key 1 encodes below key 4, so canonical order is the written
 * one; the kid's length varies, which is why this half is a prefix and not the whole header.
 */
const PROTECTED_BOOKMARK = Uint8Array.of(0xa2, 0x01, 0x27, 0x04)
const UNPROTECTED_EMPTY = 0xa0 // {}
/** Ed25519 signatures are 64 bytes, and the envelope carries the raw signature. */
export const signatureLength = 64

/**
 * envelopeSigningInput returns the bytes a signature covers: the `Sig_structure` of RFC
 * 9052 §4.4, `["Signature1", protected, external_aad, payload]` with an empty aad.
 *
 * This is what a Signer is handed. The library builds it so that an application returning
 * a signature needs no COSE of its own, and holds no claim bytes it did not ask for.
 */
export function envelopeSigningInput(payload: Uint8Array): Uint8Array {
  const w = new CborWriter()
  w.writeArrayHeader(4)
  w.writeRaw(encodeText('Signature1'))
  w.writeBytes(PROTECTED.subarray(1)) // the header map, framed afresh as a byte string
  w.writeBytes(new Uint8Array(0)) // external_aad: none
  w.writeBytes(payload)
  return w.bytes()
}

/**
 * encodeEnvelope assembles S(env(v)) from the serialized claim and the signature over its
 * signing input. The id is the hash of these bytes (`V-ID`).
 */
export function encodeEnvelope(payload: Uint8Array, signature: Uint8Array): Uint8Array {
  if (signature.length !== signatureLength) {
    throw new RankeEnvelopeError(
      `a signature is ${signatureLength} bytes, got ${signature.length}`,
    )
  }
  const body = new CborWriter()
  body.writeBytes(payload)
  body.writeBytes(signature)
  const framed = body.bytes()

  const out = new Uint8Array(3 + PROTECTED.length + framed.length)
  out[0] = TAG_COSE_SIGN1
  out[1] = ARRAY_OF_FOUR
  out.set(PROTECTED, 2)
  out[2 + PROTECTED.length] = UNPROTECTED_EMPTY
  out.set(framed, 3 + PROTECTED.length)
  return out
}

/** EnvelopeParts is an envelope taken apart, with where each piece sits in the bytes. */
export interface EnvelopeParts {
  readonly payload: Uint8Array
  /** Offset of the payload's first byte, for a reader pointing at what it renders. */
  readonly payloadAt: number
  readonly signature: Uint8Array
  readonly signatureAt: number
}

/**
 * envelopePayload returns the serialized claim an envelope carries, refusing bytes of any
 * other shape — which is how content is told from a claim, and how a record with a spare
 * header is refused rather than given an id of its own.
 */
export function envelopePayload(raw: Uint8Array): Uint8Array {
  return envelopeParts(raw).payload
}

/**
 * envelopeParts is envelopePayload with the offsets kept, for a reader that renders the
 * bytes rather than only reading them.
 */
export function envelopeParts(raw: Uint8Array): EnvelopeParts {
  return coseFrame(raw, (at) => {
    // The protected header is compared whole. Naming `alg` and nothing else is what makes it
    // this constant, so anything else is refused without parsing a header map at all.
    const header = raw.subarray(at, at + PROTECTED.length)
    if (!equal(header, PROTECTED)) {
      throw new RankeEnvelopeError(
        `the protected header is alg alone (${hex(PROTECTED)}), got ${hex(header)}`,
      )
    }
    return { next: at + PROTECTED.length, kid: null }
  }).parts
}

/** BookmarkEnvelopeParts is an envelope whose protected header also names a kid. */
export interface BookmarkEnvelopeParts extends EnvelopeParts {
  readonly kid: Uint8Array
}

/**
 * bookmarkEnvelopeParts reads the record 𝒰_hist holds at id_seq(i, s): the COSE_Sign1 frame
 * a claim takes, its protected header carrying alg and kid alone and its unprotected header
 * nothing (`V-BMENV`). What the kid names is bookmark.ts's.
 */
export function bookmarkEnvelopeParts(raw: Uint8Array): BookmarkEnvelopeParts {
  const { parts, kid } = coseFrame(raw, (at) => {
    // The header rides as a byte string, so its own length bounds the map: read the kid out
    // of it and land exactly at its end, and a third parameter has nowhere to hide.
    const header = readByteString(raw, at, 'protected header')
    const prefix = header.bytes.subarray(0, PROTECTED_BOOKMARK.length)
    if (!equal(prefix, PROTECTED_BOOKMARK)) {
      throw new RankeEnvelopeError(
        `a bookmark's protected header is alg then kid (${hex(PROTECTED_BOOKMARK)}…), got ${hex(prefix)}`,
      )
    }
    const kid = readByteString(header.bytes, PROTECTED_BOOKMARK.length, 'kid')
    if (kid.next !== header.bytes.length) {
      throw new RankeEnvelopeError(
        `a bookmark's protected header carries alg and kid alone, and ${header.bytes.length - kid.next} byte(s) beyond them`,
      )
    }
    if (kid.bytes.length === 0) {
      throw new RankeEnvelopeError('the protected header names an empty kid')
    }
    return { next: header.next, kid: kid.bytes }
  })
  return Object.freeze({ ...parts, kid: kid! })
}

// coseFrame reads the frame both records share — tag 18, the four-element array, the empty
// unprotected header, the payload and the signature — leaving the protected header, the one
// field the two shapes differ in, to readProtected.
function coseFrame(
  raw: Uint8Array,
  readProtected: (at: number) => { next: number; kid: Uint8Array | null },
): { parts: EnvelopeParts; kid: Uint8Array | null } {
  let at = 0
  const want = (byte: number, what: string): void => {
    if (raw[at] !== byte) {
      throw new RankeEnvelopeError(
        `${what}: expected 0x${byte.toString(16)}, got ${describe(raw[at])} at offset ${at}`,
      )
    }
    at++
  }
  want(TAG_COSE_SIGN1, 'not a COSE_Sign1 envelope')
  want(ARRAY_OF_FOUR, 'an envelope is a four-element array')

  const header = readProtected(at)
  at = header.next
  want(UNPROTECTED_EMPTY, 'the unprotected header carries nothing')

  const payload = readByteString(raw, at, 'payload')
  const signature = readByteString(raw, payload.next, 'signature')
  if (signature.bytes.length !== signatureLength) {
    throw new RankeEnvelopeError(
      `a signature is ${signatureLength} bytes, got ${signature.bytes.length}`,
    )
  }
  if (signature.next !== raw.length) {
    throw new RankeEnvelopeError(`${raw.length - signature.next} trailing byte(s)`)
  }
  if (payload.bytes.length === 0) throw new RankeEnvelopeError('the envelope carries no payload')
  const parts = Object.freeze({
    payload: payload.bytes,
    payloadAt: payload.next - payload.bytes.length,
    signature: signature.bytes,
    signatureAt: signature.next - signature.bytes.length,
  })
  return { parts, kid: header.kid }
}

// readByteString reads a definite-length CBOR byte string, in the shortest form canonical
// encoding requires. Nothing longer than 2^32 is admitted: a claim that size is not one.
function readByteString(
  raw: Uint8Array,
  at: number,
  what: string,
): { bytes: Uint8Array; next: number } {
  const head = raw[at]
  if (head === undefined) throw new RankeEnvelopeError(`truncated before the ${what}`)
  if (head >> 5 !== 2) {
    throw new RankeEnvelopeError(`the ${what} is a byte string, got ${describe(head)}`)
  }
  const arg = head & 0x1f
  let length = arg
  let start = at + 1
  if (arg >= 24) {
    const width = arg === 24 ? 1 : arg === 25 ? 2 : arg === 26 ? 4 : 0
    if (width === 0) throw new RankeEnvelopeError(`the ${what} states no readable length`)
    length = 0
    for (let i = 0; i < width; i++) {
      const b = raw[start + i]
      if (b === undefined) throw new RankeEnvelopeError(`truncated in the ${what}'s length`)
      length = length * 256 + b
    }
    start += width
    if (length < [0, 24, 256, 65536][width]!) {
      throw new RankeEnvelopeError(`the ${what}'s length is not in its shortest form`)
    }
  }
  if (start + length > raw.length) throw new RankeEnvelopeError(`truncated in the ${what}`)
  return { bytes: raw.subarray(start, start + length), next: start + length }
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function hex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function describe(b: number | undefined): string {
  return b === undefined ? 'end of input' : `0x${b.toString(16).padStart(2, '0')}`
}

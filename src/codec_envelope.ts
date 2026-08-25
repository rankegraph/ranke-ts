// package: ranke / codec_envelope
// type:    crypto
// job:     the claim envelope (`V-ENV`) — the one COSE_Sign1 shape a claim is stored as,
// which the Universe holds under id(v) = H(S(env(v)))
// limits:  the record it wraps is codec.ts's, and nothing here judges that record's shape;
// verifies no signature and holds no key — the application signs (-> claim_builder)
//
// Not a COSE implementation, and not meant to grow into one. `V-ENV` pins every field —
// tag 18, `alg` alone protected, nothing unprotected — and `V-SIGN` pins the algorithm to
// Ed25519, so the envelope is one byte template with two variable strings in it. Reading it
// is recognising that template and refusing everything else, which is what stops one claim
// from having a second stored form and so a second id.
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

/**
 * envelopePayload returns the serialized claim an envelope carries, refusing bytes of any
 * other shape — which is how content is told from a claim, and how a record with a spare
 * header is refused rather than given an id of its own.
 */
export function envelopePayload(raw: Uint8Array): Uint8Array {
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

  // The protected header is compared whole. Naming `alg` and nothing else is what makes it
  // this constant, so anything else is refused without parsing a header map at all.
  const header = raw.subarray(at, at + PROTECTED.length)
  if (!equal(header, PROTECTED)) {
    throw new RankeEnvelopeError(
      `the protected header is alg alone (${hex(PROTECTED)}), got ${hex(header)}`,
    )
  }
  at += PROTECTED.length
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
  return payload.bytes
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

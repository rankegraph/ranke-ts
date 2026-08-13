// package: ranke / id
// type:    crypto
// job:     the content-addressed Id type — a self-describing payload (multihash or signature) with
// parsing and equality
// limits:  does not verify ids or signatures; content integrity lives in content.ts

import { sha256 } from './internal/sha256.ts'

/** Multicodec code for a SHA2-256 multihash, which is what H frames (`V-HASH`). */
const CODE_SHA2_256 = 0x12
/** Multicodec code for an Ed25519 public key. */
const CODE_ED25519_PUB = 0xed
/**
 * Multicodec code for an EdDSA signature, which is what frames a node id (`V-SIGN`). A
 * pubkey carries CODE_ED25519_PUB, so the code alone says which of the two a payload is.
 */
const CODE_EDDSA = 0xd0ed

const SHA2_256_LEN = 32

/** Multibase prefix for lowercase base32 (RFC 4648, unpadded). */
const MULTIBASE_BASE32 = 'b'
const B32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

/**
 * Id is a self-describing, content-addressed identifier: id(v) = Sign(H(S(v)))
 * for nodes, id(e) = H(S(e)) for edges (spec §4).
 *
 * A node id is therefore a signature and an edge id a hash, and the leading
 * varint says which.
 */
export class Id {
  readonly #raw: Uint8Array
  readonly #str: string

  /** Callers reach an Id through hashContent, parseId, or idFromBytes. */
  private constructor(raw: Uint8Array) {
    this.#raw = raw
    this.#str = multibaseEncode(raw)
  }

  /** The multibase string form, as ranke-go's String() renders it. */
  toString(): string {
    return this.#str
  }

  /** The self-describing payload. */
  rawBytes(): Uint8Array {
    return this.#raw
  }

  /** equal compares by raw payload. */
  equal(other: Id | null | undefined): boolean {
    if (other == null) return false
    return bytesEqual(this.#raw, other.rawBytes())
  }

  /**
   * algorithm names the scheme that built this id — "sha2-256" for a multihash,
   * else the multicodec the leading varint names.
   *
   * An unnamed code renders as hex, where ranke-go prints the multicodec
   * library's own rendering of it.
   */
  algorithm(): string {
    if (decodeMultihash(this.#raw) !== null) return 'sha2-256'
    const v = readVarint(this.#raw, 0)
    if (v === null) return 'unknown'
    if (v.value === CODE_EDDSA) return 'eddsa'
    if (v.value === CODE_ED25519_PUB) return 'ed25519-pub'
    return '0x' + v.value.toString(16)
  }

  /** @internal */
  static fromBytes(raw: Uint8Array): Id {
    return new Id(raw)
  }
}

/** idFromBytes wraps a raw payload as an Id, its leading varint self-describing. */
export function idFromBytes(raw: Uint8Array): Id {
  return Id.fromBytes(raw)
}

/**
 * hashContent returns the SHA2-256 multihash of content as an Id — the address of
 * external content, and the id of an edge over its canonical bytes.
 */
export function hashContent(content: Uint8Array): Id {
  const digest = sha256(content)
  const raw = new Uint8Array(2 + digest.length)
  raw[0] = CODE_SHA2_256
  raw[1] = digest.length
  raw.set(digest, 2)
  return Id.fromBytes(raw)
}

/** parseId parses a multibase-encoded id string, multihash or signature payload. */
export function parseId(s: string): Id {
  if (s.length === 0) throw new RankeIdError('empty id')
  const base = s[0]!
  if (base !== MULTIBASE_BASE32) {
    throw new RankeIdError(`unsupported multibase prefix ${JSON.stringify(base)}`)
  }
  return Id.fromBytes(base32Decode(s.slice(1)))
}

/**
 * hashFromMultihashBytes wraps bytes already known to be a multihash, validating
 * the framing so a malformed address is refused at the boundary.
 */
export function hashFromMultihashBytes(raw: Uint8Array): Id {
  if (decodeMultihash(raw) === null) throw new RankeIdError('invalid multihash')
  return Id.fromBytes(raw)
}

/** RankeIdError reports a malformed id or multihash. */
export class RankeIdError extends Error {
  override readonly name = 'RankeIdError'
}

// decodeMultihash returns the digest when raw frames a SHA2-256 multihash of the
// declared length, and null otherwise. Only the one algorithm the ADT uses counts,
// so an id framed with any other code falls through to the multicodec reading.
function decodeMultihash(raw: Uint8Array): Uint8Array | null {
  const code = readVarint(raw, 0)
  if (code === null || code.value !== CODE_SHA2_256) return null
  const len = readVarint(raw, code.next)
  if (len === null || len.value !== SHA2_256_LEN) return null
  if (raw.length - len.next !== len.value) return null
  return raw.subarray(len.next)
}

// readVarint reads an unsigned LEB128 at off, returning the value and the offset
// past it. Values are bounded to 32 bits: every code the ADT uses is far smaller,
// and a longer one would exceed what a JS number holds exactly under shifting.
function readVarint(b: Uint8Array, off: number): { value: number; next: number } | null {
  let value = 0
  let shift = 0
  for (let i = off; i < b.length; i++) {
    const byte = b[i]!
    if (shift > 28) return null
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) {
      // A varint must be minimal: a trailing 0x00 group encodes a value a shorter
      // form already carries, so two encodings of one id would compare unequal.
      if (byte === 0 && i > off) return null
      return { value, next: i + 1 }
    }
    shift += 7
  }
  return null
}

// multibaseEncode renders the prefix and the digits as one flat string: a `+=` per
// digit leaves a 57-node rope per id, and a decoded claim names hundreds of ids.
function multibaseEncode(b: Uint8Array): string {
  const parts: string[] = [MULTIBASE_BASE32]
  let bits = 0
  let acc = 0
  for (const byte of b) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      parts.push(B32_ALPHABET[(acc >>> bits) & 0x1f]!)
    }
  }
  if (bits > 0) parts.push(B32_ALPHABET[(acc << (5 - bits)) & 0x1f]!)
  return parts.join('')
}

function base32Decode(s: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let acc = 0
  for (const ch of s) {
    const v = B32_ALPHABET.indexOf(ch)
    if (v < 0) throw new RankeIdError(`invalid base32 character ${JSON.stringify(ch)}`)
    acc = (acc << 5) | v
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((acc >>> bits) & 0xff)
    }
  }
  // Whatever is left is padding, and padding is zero — a non-zero remainder means
  // the string carries bits no byte sequence produced.
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) {
    throw new RankeIdError('base32 has non-zero padding bits')
  }
  return Uint8Array.from(out)
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

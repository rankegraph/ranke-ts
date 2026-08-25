// package: internal / cbor
// type:    io
// job:     CBOR Deterministic Encoding (RFC 8949 §4.2) — the writer a canonical record is
// built with, and a reader that refuses anything non-canonical
// limits:  the byte level only; which record fields exist is codec.ts's
//
// ranke-go takes this from fxamacker/cbor, so no Go file corresponds. Hand-rolled for
// two reasons: the reader hands back a value's raw byte range, since an id is computed
// over stored bytes and never a re-encode; and a permissive decoder would accept a
// non-canonical claim, which for a content-addressed record is a defect.

/** RankeCborError reports bytes lying outside canonical CBOR. */
export class RankeCborError extends Error {
  override readonly name: string = 'RankeCborError'
}

/**
 * RankeCborTruncated reports bytes that end mid-value. A stream reader waits for
 * more and retries; every other RankeCborError is final, so the two must be
 * distinguishable — a malformed record would otherwise stall a reader forever.
 */
export class RankeCborTruncated extends RankeCborError {
  override readonly name = 'RankeCborTruncated'
}

const MT_UINT = 0
const MT_NEGINT = 1
const MT_BYTES = 2
const MT_TEXT = 3
const MT_ARRAY = 4
const MT_MAP = 5
// Major 6 is a tag. A claim record carries none, but an envelope IS one (`V-ENV`), and a
// stream can carry envelopes — so the walker measures tag 18 to find a record boundary and
// refuses every other tag.
const MT_TAG = 6
const TAG_COSE_SIGN1 = 18

// Major 7 holds simple values and floats. A claim record uses none of it, but a
// result sequence also carries an execution report, and a report has booleans — so
// exactly false, true and null are admitted and every float is refused.
const MT_SIMPLE = 7
const SIMPLE_FALSE = 20
const SIMPLE_TRUE = 21
const SIMPLE_NULL = 22

/** CborInt is how an integer crosses this boundary: uint64 exceeds a JS number. */
export type CborInt = bigint

// ─── Writer ───────────────────────────────────────────────────────────

/**
 * CborWriter appends canonical CBOR to a growing buffer. Determinism is a property
 * of what a caller writes — heads take the shortest form here, and map ordering is
 * the caller's, for which writeSortedMap exists.
 */
export class CborWriter {
  #buf: Uint8Array
  #len = 0

  constructor(capacity = 256) {
    this.#buf = new Uint8Array(capacity)
  }

  /** bytes returns what has been written, as a view of exactly that length. */
  bytes(): Uint8Array {
    return this.#buf.slice(0, this.#len)
  }

  get length(): number {
    return this.#len
  }

  writeUint(n: number | bigint): void {
    this.#head(MT_UINT, BigInt(n))
  }

  /** writeInt writes a signed integer, choosing major type 0 or 1. */
  writeInt(n: number | bigint): void {
    const v = BigInt(n)
    if (v < 0n) this.#head(MT_NEGINT, -v - 1n)
    else this.#head(MT_UINT, v)
  }

  writeBytes(b: Uint8Array): void {
    this.#head(MT_BYTES, BigInt(b.length))
    this.#raw(b)
  }

  writeText(s: string): void {
    const utf8 = new TextEncoder().encode(s)
    this.#head(MT_TEXT, BigInt(utf8.length))
    this.#raw(utf8)
  }

  writeArrayHeader(n: number): void {
    this.#head(MT_ARRAY, BigInt(n))
  }

  writeMapHeader(n: number): void {
    this.#head(MT_MAP, BigInt(n))
  }

  /** writeRaw appends already-encoded CBOR, for a record embedded verbatim. */
  writeRaw(b: Uint8Array): void {
    this.#raw(b)
  }

  /**
   * writeSortedMap writes entries ordered by their encoded key bytes, which is what
   * §4.2 requires and is not the same as ordering by the key's value: a text key
   * carries its length first, so "b" precedes "aa".
   */
  writeSortedMap(entries: ReadonlyArray<readonly [Uint8Array, Uint8Array]>): void {
    const sorted = [...entries].sort((a, b) => compareBytes(a[0], b[0]))
    for (let i = 1; i < sorted.length; i++) {
      if (compareBytes(sorted[i - 1]![0], sorted[i]![0]) === 0) {
        throw new RankeCborError('duplicate map key')
      }
    }
    this.writeMapHeader(sorted.length)
    for (const [k, v] of sorted) {
      this.#raw(k)
      this.#raw(v)
    }
  }

  // head writes a major type with its argument in the shortest form that holds it.
  #head(major: number, arg: bigint): void {
    if (arg < 0n) throw new RankeCborError('negative argument')
    const mt = major << 5
    if (arg < 24n) {
      this.#byte(mt | Number(arg))
    } else if (arg <= 0xffn) {
      this.#byte(mt | 24)
      this.#byte(Number(arg))
    } else if (arg <= 0xffffn) {
      this.#byte(mt | 25)
      this.#bigEndian(arg, 2)
    } else if (arg <= 0xffff_ffffn) {
      this.#byte(mt | 26)
      this.#bigEndian(arg, 4)
    } else if (arg <= 0xffff_ffff_ffff_ffffn) {
      this.#byte(mt | 27)
      this.#bigEndian(arg, 8)
    } else {
      throw new RankeCborError('argument exceeds 64 bits')
    }
  }

  #bigEndian(v: bigint, width: number): void {
    for (let i = width - 1; i >= 0; i--) {
      this.#byte(Number((v >> BigInt(i * 8)) & 0xffn))
    }
  }

  #byte(b: number): void {
    this.#grow(1)
    this.#buf[this.#len++] = b
  }

  #raw(b: Uint8Array): void {
    this.#grow(b.length)
    this.#buf.set(b, this.#len)
    this.#len += b.length
  }

  #grow(n: number): void {
    if (this.#len + n <= this.#buf.length) return
    let cap = this.#buf.length * 2
    while (cap < this.#len + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.#buf.subarray(0, this.#len))
    this.#buf = next
  }
}

/** encodeUint / encodeText return one value's canonical bytes, for a map key. */
export function encodeUint(n: number | bigint): Uint8Array {
  const w = new CborWriter(9)
  w.writeUint(n)
  return w.bytes()
}

export function encodeText(s: string): Uint8Array {
  const w = new CborWriter(s.length + 9)
  w.writeText(s)
  return w.bytes()
}

// ─── Reader ───────────────────────────────────────────────────────────

/**
 * CborReader walks canonical CBOR, refusing what a deterministic encoder would
 * never emit: an argument in other than its shortest form, an indefinite length, a
 * tag, a float, or map keys out of order or repeated.
 *
 * Positions are exposed so a caller can take the raw byte range of a value —
 * `nodePreimage` needs the exact bytes an id was computed over.
 */
export class CborReader {
  readonly #b: Uint8Array
  #pos = 0

  constructor(b: Uint8Array) {
    this.#b = b
  }

  get position(): number {
    return this.#pos
  }

  get done(): boolean {
    return this.#pos >= this.#b.length
  }

  /** expectEnd refuses trailing bytes after the value a caller expected. */
  expectEnd(): void {
    if (!this.done) throw new RankeCborError('trailing bytes')
  }

  /** readInt reads major type 0 or 1 as a bigint. */
  readInt(): CborInt {
    const { major, arg } = this.#head()
    if (major === MT_UINT) return arg
    if (major === MT_NEGINT) return -arg - 1n
    throw new RankeCborError(`expected an integer, got major type ${major}`)
  }

  readBytes(): Uint8Array {
    const { major, arg } = this.#head()
    if (major !== MT_BYTES) throw new RankeCborError(`expected a byte string, got ${major}`)
    return this.#take(Number(arg))
  }

  readText(): string {
    const { major, arg } = this.#head()
    if (major !== MT_TEXT) throw new RankeCborError(`expected a text string, got ${major}`)
    const raw = this.#take(Number(arg))
    return utf8Decode(raw)
  }

  /** readArrayHeader returns the element count. */
  readArrayHeader(): number {
    const { major, arg } = this.#head()
    if (major !== MT_ARRAY) throw new RankeCborError(`expected an array, got ${major}`)
    return Number(arg)
  }

  /** readMapHeader returns the entry count. */
  readMapHeader(): number {
    const { major, arg } = this.#head()
    if (major !== MT_MAP) throw new RankeCborError(`expected a map, got ${major}`)
    return Number(arg)
  }

  /**
   * skipValue advances past one complete value and returns its raw bytes — the
   * exact stored bytes, which is what an id is computed over.
   */
  skipValue(): Uint8Array {
    const start = this.#pos
    this.#skip()
    return this.#b.subarray(start, this.#pos)
  }

  /**
   * tryScanValue is skipValue for a stream: null means the buffer holds no complete
   * value yet and the position is left where it was, so the caller retries after the
   * next chunk. Malformed bytes still throw.
   */
  tryScanValue(): Uint8Array | null {
    const start = this.#pos
    try {
      this.#skip()
    } catch (err) {
      this.#pos = start
      if (err instanceof RankeCborTruncated) return null
      throw err
    }
    return this.#b.subarray(start, this.#pos)
  }

  /** readSimple reads false, true or null. */
  readSimple(): boolean | null {
    const { major, arg } = this.#head()
    if (major !== MT_SIMPLE) {
      throw new RankeCborError(`expected false, true or null, got major type ${major}`)
    }
    if (arg === BigInt(SIMPLE_FALSE)) return false
    if (arg === BigInt(SIMPLE_TRUE)) return true
    return null
  }

  #skip(): void {
    const { major, arg } = this.#head()
    switch (major) {
      case MT_UINT:
      case MT_NEGINT:
      case MT_SIMPLE:
        return
      case MT_BYTES:
      case MT_TEXT:
        this.#take(Number(arg))
        return
      case MT_ARRAY:
        for (let i = 0n; i < arg; i++) this.#skip()
        return
      case MT_MAP:
        for (let i = 0n; i < arg; i++) {
          this.#skip()
          this.#skip()
        }
        return
      case MT_TAG:
        this.#skip() // the tagged value: an envelope's four-element array
        return
      default:
        throw new RankeCborError(`major type ${major} has no place in a ranke record`)
    }
  }

  // head reads one initial byte and its argument, refusing every encoding a
  // deterministic writer would not have produced.
  #head(): { major: number; arg: bigint } {
    if (this.done) throw new RankeCborTruncated('truncated')
    const ib = this.#b[this.#pos++]!
    const major = ib >> 5
    const ai = ib & 0x1f
    if (major === MT_SIMPLE) {
      if (ai !== SIMPLE_FALSE && ai !== SIMPLE_TRUE && ai !== SIMPLE_NULL) {
        throw new RankeCborError(
          `major type 7 carries only false, true and null here, got additional information ${ai}`,
        )
      }
      return { major, arg: BigInt(ai) }
    }
    // A tag has no place in a ranke RECORD, but a stream carries envelopes, which are
    // tagged (`V-ENV`). So the walker measures one to find a record boundary, and only
    // tag 18: any other tag is a value this format does not have.
    if (major === MT_TAG) {
      if (ai !== TAG_COSE_SIGN1) {
        throw new RankeCborError(`tag ${ai} has no place in a ranke stream`)
      }
      return { major, arg: BigInt(ai) }
    }
    if (major > MT_MAP) {
      throw new RankeCborError(`major type ${major} has no place in a ranke record`)
    }
    if (ai < 24) return { major, arg: BigInt(ai) }
    if (ai === 31) throw new RankeCborError('indefinite length')
    if (ai > 27) throw new RankeCborError(`reserved additional information ${ai}`)

    const width = 1 << (ai - 24)
    const raw = this.#take(width)
    let arg = 0n
    for (const byte of raw) arg = (arg << 8n) | BigInt(byte)

    // Shortest form: a value that fits a narrower head must use it, or one integer
    // would have several encodings and one record several ids.
    const min = ai === 24 ? 24n : 1n << BigInt((width >> 1) * 8)
    if (arg < min) {
      throw new RankeCborError(`argument ${arg} is not in its shortest form`)
    }
    return { major, arg }
  }

  #take(n: number): Uint8Array {
    if (n < 0) throw new RankeCborError('negative length')
    if (this.#pos + n > this.#b.length) throw new RankeCborTruncated('truncated')
    const out = this.#b.subarray(this.#pos, this.#pos + n)
    this.#pos += n
    return out
  }
}

/**
 * readSortedMapKeys reads a map's entries through readKey/readValue, holding the
 * keys to §4.2 order: strictly ascending by encoded bytes, so no key repeats and
 * no reordering passes as equivalent.
 */
export function readSortedMap<K, V>(
  r: CborReader,
  readKey: (r: CborReader) => { key: K; raw: Uint8Array },
  readValue: (r: CborReader) => V,
): Array<[K, V]> {
  const n = r.readMapHeader()
  const out: Array<[K, V]> = []
  let prev: Uint8Array | null = null
  for (let i = 0; i < n; i++) {
    const { key, raw } = readKey(r)
    if (prev !== null) {
      const c = compareBytes(prev, raw)
      if (c > 0) throw new RankeCborError('map keys out of canonical order')
      if (c === 0) throw new RankeCborError('duplicate map key')
    }
    prev = Uint8Array.from(raw)
    out.push([key, readValue(r)])
  }
  return out
}

/** compareBytes orders two byte strings lexicographically. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!
    if (d !== 0) return d
  }
  return a.length - b.length
}

// utf8Decode rejects malformed sequences: a lenient decode would map two different
// byte strings to one text value, and a claim is addressed by its bytes.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

function utf8Decode(b: Uint8Array): string {
  try {
    return strictUtf8.decode(b)
  } catch {
    throw new RankeCborError('invalid UTF-8 in a text string')
  }
}

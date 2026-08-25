// package: ranke / codec_seq
// type:    io
// job:     reading a result run as it arrives — cbor-seq (RFC 8742) and json-seq (RFC 7464),
// each holding a partial record across a chunk boundary
// limits:  framing plus the per-record decode; what a read returns is the server's
//
// ranke-go has no counterpart: it produces results and RankeDB frames them, while a
// browser is the side that must consume a stream it cannot buffer whole.
//
// Output.Detail and Output.Shape between them decide what a record carries — an id, a
// route of ids, a claim (ranke-go's ResultKind) — so the reader reports the kind and a
// caller switches once, as ranke-go's QueryResult has it.

import type { Claim } from './claim.ts'
import {
  RankeDecodeError,
  decodeClaim,
  decodeSerializedClaim,
  type DecodeOptions,
} from './codec.ts'
import { decodeClaimJSON, type WireClaim } from './codec_json.ts'
import { CborReader } from './internal/cbor.ts'

/** SeqEncoding names the framing a result stream arrives in. */
export type SeqEncoding = 'cbor' | 'json'

/**
 * QueryReport trails a stream when execution.report was set (`R-QREPORT`). A duration
 * carries its unit in the name, being a bare integer of nanoseconds; those names are the
 * read contract, and a field beyond them is the server's to define.
 */
export interface QueryReport {
  readonly started_at?: string
  readonly elapsed_ns?: number
  readonly results?: number
  readonly truncated?: boolean
  readonly events?: readonly QueryEvent[]
}

/** QueryEvent is one logged step or point during execution. */
export interface QueryEvent {
  readonly at_ns?: number
  readonly engine?: string
  readonly op?: string
  readonly level?: string
  readonly duration_ns?: number
  readonly detail?: string
  readonly attrs?: Record<string, unknown>
}

/**
 * ResultRecord is one record of a result run, tagged by what it carries — the kinds of
 * ranke-go's ResultKind. The tag is `R-QSTREAM`'s: a reader learns what an element holds
 * without inspecting the payload. An endpoint and a route are the two `R-QSHAPE` fixes,
 * and a path of CLAIMS arrives as one record per claim, so `claim` covers both shapes
 * and a caller counts a route out for itself.
 */
export type ResultRecord =
  | { readonly kind: 'claim'; readonly claim: Claim }
  /**
   * The stored record under `detail: envelope`, with the bytes kept: hashing them against
   * the id is the only check a client can make itself (`R-QCANON`).
   */
  | { readonly kind: 'envelope'; readonly bytes: Uint8Array; readonly claim: Claim }
  | { readonly kind: 'claim_id'; readonly id: string }
  | { readonly kind: 'path_id'; readonly ids: readonly string[] }
  | { readonly kind: 'report'; readonly report: QueryReport }

/**
 * RawSeqReader splits a stream into records without reading them. It is the framing
 * on its own, for a payload this library does not yet name.
 */
export interface RawSeqReader {
  /** push returns the records completed by this chunk, in arrival order. */
  push(chunk: Uint8Array): Uint8Array[]
  /** end reports the stream closed, throwing when bytes remain that completed nothing. */
  end(): Uint8Array[]
  /** bytesRead is the total fed in, for progress reporting. */
  readonly bytesRead: number
}

/**
 * SeqReader turns chunks into records. Feed it whatever a stream hands over and it
 * returns the records now complete, holding any partial tail for the next call.
 *
 * A push parser rather than an iterator, so a caller owning the read loop can count
 * bytes as they land; readRecords wraps it for the common case.
 */
export interface SeqReader {
  push(chunk: Uint8Array): Claim[]
  end(): Claim[]
  readonly bytesRead: number
}

/** newRawSeqReader builds the framing reader for an encoding. */
export function newRawSeqReader(encoding: SeqEncoding): RawSeqReader {
  return encoding === 'cbor' ? new CborSeqReader() : new JsonSeqReader()
}

/**
 * newSeqReader builds a push parser yielding claims, skipping a trailing report and
 * refusing a record that carries something else — see readRecords for those.
 */
export function newSeqReader(encoding: SeqEncoding, opts: DecodeOptions = {}): SeqReader {
  const raw = newRawSeqReader(encoding)
  const claims = (records: Uint8Array[]): Claim[] => {
    const out: Claim[] = []
    for (const rec of records) {
      const decoded = decodeResultRecord(rec, encoding, opts)
      // Both details that carry a claim: the serialized record, and the envelope around
      // one. A caller wanting the bytes as well reaches for readRecords.
      if (decoded.kind === 'claim' || decoded.kind === 'envelope') out.push(decoded.claim)
      else if (decoded.kind !== 'report') throw notAClaim(decoded.kind)
    }
    return out
  }
  return {
    push: (chunk) => claims(raw.push(chunk)),
    end: () => claims(raw.end()),
    get bytesRead() {
      return raw.bytesRead
    },
  }
}

function notAClaim(kind: string): RankeDecodeError {
  return new RankeDecodeError(
    `the stream carries ${kind} records, which output.detail: id asks for — read it with readRecords`,
  )
}

/**
 * decodeResultRecord reads one record, reporting what it carries.
 *
 * Under json framing the shape decides: a string is an id, an array of strings a
 * route, an object naming a type and a created_at a claim, and any other object the
 * trailing report.
 */
export function decodeResultRecord(
  raw: Uint8Array,
  encoding: SeqEncoding,
  opts: DecodeOptions = {},
): ResultRecord {
  if (encoding === 'cbor') return decodeCborRecord(raw, opts)

  const text = utf8.decode(raw).trim()
  const value: unknown = JSON.parse(text)

  if (typeof value === 'string') return { kind: 'claim_id', id: value }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'string') {
        throw new RankeDecodeError('a route of ids holds strings')
      }
    }
    return { kind: 'path_id', ids: value as readonly string[] }
  }
  if (typeof value !== 'object' || value === null) {
    throw new RankeDecodeError(`a result record is a string, a list or an object`)
  }
  const record = value as Record<string, unknown>
  if ('type' in record && 'created_at' in record) {
    return { kind: 'claim', claim: decodeClaimJSON(record as WireClaim) }
  }
  return { kind: 'report', report: record as QueryReport }
}

// CBOR major types, read from a record's first byte to tell what it carries. Every
// payload in a cbor sequence is CBOR, so the four kinds discriminate as under json.
const MAJOR_TEXT = 3
const MAJOR_ARRAY = 4
const MAJOR_MAP = 5
const MAJOR_TAG = 6
const MAJOR_SIMPLE = 7

function decodeCborRecord(raw: Uint8Array, opts: DecodeOptions): ResultRecord {
  if (raw.length === 0) throw new RankeDecodeError('an empty record carries nothing')
  switch (raw[0]! >> 5) {
    case MAJOR_TEXT: {
      const r = new CborReader(raw)
      const id = r.readText()
      r.expectEnd()
      return { kind: 'claim_id', id }
    }
    case MAJOR_ARRAY: {
      const r = new CborReader(raw)
      const n = r.readArrayHeader()
      const ids: string[] = []
      for (let i = 0; i < n; i++) ids.push(r.readText())
      r.expectEnd()
      return { kind: 'path_id', ids }
    }
    case MAJOR_MAP: {
      // A claim's record keys are integers (codec.ts encNode); a report's are text.
      const r = new CborReader(raw)
      r.readMapHeader()
      const keyMajor = raw[r.position]! >> 5
      if (keyMajor === MAJOR_TEXT) return { kind: 'report', report: readCborReport(raw) }
      // `detail: claims` serves the serialized claim, the envelope's payload — so no id
      // covers it, and it decodes as a payload rather than through an envelope.
      return { kind: 'claim', claim: decodeSerializedClaim(raw, '', opts) }
    }
    // `detail: envelope` serves the stored record, tagged apart from a serialized claim so
    // a reader parses one and hands on the other (`R-QSTREAM`). The bytes ride along
    // because hashing them against an id is the whole reason to ask for this form.
    case MAJOR_TAG:
      return { kind: 'envelope', bytes: raw, claim: decodeClaim(raw, '', opts) }
    default:
      throw new RankeDecodeError(
        `a result record is a text string, a list or a map, got CBOR major type ${raw[0]! >> 5}`,
      )
  }
}

// readCborReport reads the report's text-keyed map. Its values vary by field, so each
// is taken as raw bytes and read by its own key rather than by a shared shape.
function readCborReport(raw: Uint8Array): QueryReport {
  const r = new CborReader(raw)
  const n = r.readMapHeader()
  const out: Record<string, unknown> = {}
  for (let i = 0; i < n; i++) {
    const key = r.readText()
    const value = r.skipValue()
    out[key] = readCborScalar(value)
  }
  r.expectEnd()
  return out as QueryReport
}

function readCborScalar(raw: Uint8Array): unknown {
  const r = new CborReader(raw)
  switch (raw[0]! >> 5) {
    case MAJOR_TEXT:
      return r.readText()
    case 0:
    case 1: {
      const v = r.readInt()
      return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(v)
        : v
    }
    // A report states whether a limit cut the read short, so it carries a boolean —
    // the one place in a sequence major type 7 appears.
    case MAJOR_SIMPLE:
      return r.readSimple()
    default:
      // An event list or an attrs map: handed back as bytes, since a diagnostic's
      // shape is the server's and a reader that needs it can decode further.
      return raw
  }
}

/**
 * readRecords yields each record as it arrives, tagged by what it carries — the
 * reader for any Output.Detail.
 *
 * ```ts
 * for await (const rec of readRecords(res.body!, 'json')) {
 *   if (rec.kind === 'claim_id') seen.add(rec.id)
 * }
 * ```
 */
export async function* readRecords(
  stream: ReadableStream<Uint8Array>,
  encoding: SeqEncoding,
  opts: DecodeOptions = {},
): AsyncGenerator<ResultRecord, void, undefined> {
  for await (const raw of readRawRecords(stream, encoding)) {
    yield decodeResultRecord(raw, encoding, opts)
  }
}

/**
 * readRawRecords yields each record's bytes, framing only. It reads a payload this
 * library does not name, so a new result kind needs no release here.
 */
export async function* readRawRecords(
  stream: ReadableStream<Uint8Array>,
  encoding: SeqEncoding,
): AsyncGenerator<Uint8Array, void, undefined> {
  const reader = newRawSeqReader(encoding)
  const source = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await source.read()
      if (done) break
      for (const rec of reader.push(value)) yield rec
    }
    for (const rec of reader.end()) yield rec
  } finally {
    source.releaseLock()
  }
}

/**
 * readClaims yields each claim as it arrives, skipping a trailing report — the reader
 * for output.detail: claims or graph.
 *
 * ```ts
 * const res = await fetch(url)
 * for await (const claim of readClaims(res.body!, 'cbor')) { … }
 * ```
 */
export async function* readClaims(
  stream: ReadableStream<Uint8Array>,
  encoding: SeqEncoding,
  opts: DecodeOptions = {},
): AsyncGenerator<Claim, void, undefined> {
  for await (const rec of readRecords(stream, encoding, opts)) {
    if (rec.kind === 'claim' || rec.kind === 'envelope') yield rec.claim
    else if (rec.kind !== 'report') throw notAClaim(rec.kind)
  }
}

/**
 * readIds yields the ids a `detail: id` run returns, flattening a route into the
 * claims along it — the reader for an identity sequence.
 */
export async function* readIds(
  stream: ReadableStream<Uint8Array>,
  encoding: SeqEncoding = 'json',
): AsyncGenerator<string, void, undefined> {
  for await (const rec of readRecords(stream, encoding)) {
    if (rec.kind === 'claim_id') yield rec.id
    else if (rec.kind === 'path_id') for (const id of rec.ids) yield id
    else if (rec.kind === 'claim') {
      throw new RankeDecodeError('the stream carries claims; read it with readClaims')
    }
  }
}

// Buffer accumulates chunks and drops what has been consumed, so a long stream does
// not retain the bytes already turned into records.
class Buffer {
  #b = new Uint8Array(0)

  get length(): number {
    return this.#b.length
  }

  view(): Uint8Array {
    return this.#b
  }

  append(chunk: Uint8Array): void {
    if (this.#b.length === 0) {
      this.#b = Uint8Array.from(chunk)
      return
    }
    const next = new Uint8Array(this.#b.length + chunk.length)
    next.set(this.#b)
    next.set(chunk, this.#b.length)
    this.#b = next
  }

  consume(n: number): void {
    this.#b = n >= this.#b.length ? new Uint8Array(0) : this.#b.slice(n)
  }
}

/**
 * CborSeqReader reads a CBOR sequence (RFC 8742): canonical items concatenated with
 * no framing of their own, so the reader asks the decoder whether a complete item is
 * present and waits when it is not.
 */
class CborSeqReader implements RawSeqReader {
  readonly #buf = new Buffer()
  #read = 0

  get bytesRead(): number {
    return this.#read
  }

  push(chunk: Uint8Array): Uint8Array[] {
    this.#read += chunk.length
    this.#buf.append(chunk)
    const out: Uint8Array[] = []
    const r = new CborReader(this.#buf.view())
    let consumed = 0
    for (;;) {
      const raw = r.tryScanValue()
      if (raw === null) break
      out.push(Uint8Array.from(raw))
      consumed = r.position
    }
    this.#buf.consume(consumed)
    return out
  }

  end(): Uint8Array[] {
    if (this.#buf.length > 0) {
      throw new RankeDecodeError(`the stream ended mid-record, ${this.#buf.length} byte(s) unread`)
    }
    return []
  }
}

const RS = 0x1e // the record separator RFC 7464 leads each record with
const LF = 0x0a

/**
 * JsonSeqReader reads a JSON text sequence (RFC 7464): each record is preceded by
 * RS and followed by LF, which makes a record boundary findable without parsing.
 */
class JsonSeqReader implements RawSeqReader {
  readonly #buf = new Buffer()
  #read = 0
  #started = false

  get bytesRead(): number {
    return this.#read
  }

  push(chunk: Uint8Array): Uint8Array[] {
    this.#read += chunk.length
    this.#buf.append(chunk)
    const out: Uint8Array[] = []
    let consumed = 0
    const b = this.#buf.view()

    // A record runs from one RS to the next; the last one in the buffer stays until
    // a following RS, or end(), proves it complete.
    let i = 0
    if (!this.#started) {
      while (i < b.length && b[i] !== RS) i++
      if (i > 0) consumed = i
      if (i < b.length) this.#started = true
    }
    while (this.#started) {
      const next = b.indexOf(RS, i + 1)
      if (next < 0) break
      const rec = trimRecord(b.subarray(i + 1, next))
      if (rec !== null) out.push(Uint8Array.from(rec))
      i = next
      consumed = i
    }
    this.#buf.consume(consumed)
    return out
  }

  end(): Uint8Array[] {
    const b = this.#buf.view()
    if (b.length === 0) return []
    const start = b[0] === RS ? 1 : 0
    const rec = trimRecord(b.subarray(start))
    this.#buf.consume(b.length)
    return rec === null ? [] : [Uint8Array.from(rec)]
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

// trimRecord drops the trailing newline RFC 7464 ends a record with, and reports a
// whitespace-only record as nothing.
function trimRecord(raw: Uint8Array): Uint8Array | null {
  let end = raw.length
  while (end > 0 && (raw[end - 1] === LF || raw[end - 1] === 0x0d)) end--
  if (end === 0) return null
  const trimmed = raw.subarray(0, end)
  return trimmed.every((b) => b === 0x20 || b === 0x09) ? null : trimmed
}

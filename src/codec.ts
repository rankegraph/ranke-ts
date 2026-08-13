// package: ranke / codec
// type:    io
// job:     canonical CBOR to a Claim — the node record with its edges inlined, aliases resolved
// limits:  decodes; the byte level is internal/cbor.ts and nothing here verifies an id

import type { Claim, Edge } from './claim.ts'
import { type ContentRef, contentNone } from './content.ts'
import { edgeClassFromAlias, edgeClassToAlias, edgeSubtypeFromAlias, edgeSubtypeToAlias } from './edge_taxonomy.ts'
import type { RelationDirection } from './edge_taxonomy.ts'
import {
  encodingClassFromAlias,
  encodingClassToAlias,
  encodingSubFromAlias,
  encodingSubToAlias,
} from './encoding_taxonomy.ts'
import { fieldNameFromAlias, fieldNameToAlias } from './field_taxonomy.ts'
import { splitType } from './filter.ts'
import { hashContent, hashFromMultihashBytes, idFromBytes, parseId } from './id.ts'
import {
  nodeClassFromAlias,
  nodeClassToAlias,
  nodeSubtypeFromAlias,
  nodeSubtypeToAlias,
} from './node_taxonomy.ts'
import { checkTimestampFields, validRFC3339Nano } from './time_fields.ts'
import {
  CborReader,
  CborWriter,
  RankeCborError,
  compareBytes,
  encodeText,
  encodeUint,
} from './internal/cbor.ts'

/** RankeDecodeError reports bytes a claim cannot be read from. */
export class RankeDecodeError extends Error {
  override readonly name: string = 'RankeDecodeError'
}

// The claim file wraps the node record under key 1, and the node record's own keys are
// the ones `V-SER` fixes. A key absent means its zero value: the encoder drops an empty
// string, an empty collection and a zero number.
const CLAIM_NODE = 1

// Keys 1 to 8 are the slots a node and an edge share, so one number means one thing in
// either record. A node then takes 9 to 11 and an edge 12 to 13 (`V-SER`).
const SHARED_TYPE_CLASS = 1
const SHARED_TYPE_SUB = 2
const SHARED_ENCODING_CLASS = 3
const SHARED_ENCODING_SUB = 4
const SHARED_CONTENT_HASH = 5
const SHARED_CONTENT = 6
const SHARED_CONTENT_SIZE = 7
const SHARED_FIELDS = 8

const N_TYPE_CLASS = SHARED_TYPE_CLASS
const N_TYPE_SUB = SHARED_TYPE_SUB
const N_ENCODING_CLASS = SHARED_ENCODING_CLASS
const N_ENCODING_SUB = SHARED_ENCODING_SUB
const N_CONTENT_HASH = SHARED_CONTENT_HASH
const N_CONTENT = SHARED_CONTENT
const N_CONTENT_SIZE = SHARED_CONTENT_SIZE
const N_FIELDS = SHARED_FIELDS
const N_CREATED_AT = 9
const N_EDGES = 10
const N_HEIGHT = 11

const E_TYPE_CLASS = SHARED_TYPE_CLASS
const E_TYPE_SUB = SHARED_TYPE_SUB
const E_ENCODING_CLASS = SHARED_ENCODING_CLASS
const E_ENCODING_SUB = SHARED_ENCODING_SUB
const E_CONTENT_HASH = SHARED_CONTENT_HASH
const E_CONTENT = SHARED_CONTENT
const E_CONTENT_SIZE = SHARED_CONTENT_SIZE
const E_FIELDS = SHARED_FIELDS
const E_REFERENCE = 12
const E_RELATION_DIRECTION = 13

/** DecodeOptions tunes what a decode spends effort on. */
export interface DecodeOptions {
  /**
   * edgeIds computes each edge's id, H(S(e)) over its stored bytes. It costs one
   * digest per edge, so it is off unless a caller addresses edges.
   */
  readonly edgeIds?: boolean
}

/**
 * decodeClaim decodes a claim's canonical CBOR. The id comes from wherever the
 * bytes came from — a claim's record does not carry its own id — and an omitted one
 * leaves `claim.id` empty.
 */
export function decodeClaim(bytes: Uint8Array, id = '', opts: DecodeOptions = {}): Claim {
  try {
    const r = new CborReader(bytes)
    const entries = readIntMap(r)
    r.expectEnd()
    const nodeRaw = entries.get(CLAIM_NODE)
    if (nodeRaw === undefined) throw new RankeDecodeError('the claim carries no node record')
    return decodeNode(nodeRaw, id, opts)
  } catch (err) {
    if (err instanceof RankeDecodeError) throw err
    throw new RankeDecodeError(`not a claim: ${(err as Error).message}`)
  }
}

/**
 * nodePreimage extracts S(node) — key 1 — from a claim's stored bytes, the exact bytes
 * an id was signed over. Checking an id against them is `V-ID`, which is why it hashes
 * these and never a re-encode.
 */
export function nodePreimage(bytes: Uint8Array): Uint8Array {
  const r = new CborReader(bytes)
  const entries = readIntMap(r)
  const node = entries.get(CLAIM_NODE)
  if (node === undefined) throw new RankeDecodeError('the claim carries no node record')
  return node
}

// readIntMap reads a map with integer keys, returning each value's raw bytes. Raw,
// because a record's own bytes are what the next level decodes or hashes.
function readIntMap(r: CborReader): Map<number, Uint8Array> {
  const n = r.readMapHeader()
  const out = new Map<number, Uint8Array>()
  let prev = -1
  for (let i = 0; i < n; i++) {
    const key = Number(r.readInt())
    if (key <= prev) throw new RankeCborError('record keys out of canonical order')
    prev = key
    out.set(key, r.skipValue())
  }
  return out
}

// readTextMap reads a field map, resolving each key's wire alias.
function readTextMap(raw: Uint8Array): Record<string, string> {
  const r = new CborReader(raw)
  const n = r.readMapHeader()
  const out: Record<string, string> = {}
  let prev: Uint8Array | null = null
  for (let i = 0; i < n; i++) {
    const keyStart = r.position
    const wire = r.readText()
    const keyRaw = raw.subarray(keyStart, r.position)
    if (prev !== null && compareBytes(prev, keyRaw) >= 0) {
      throw new RankeCborError('field keys out of canonical order')
    }
    prev = keyRaw
    out[unaliasFieldName(wire)] = r.readText()
  }
  r.expectEnd()
  return out
}

// A wire alias carries a leading "." — a prefix no literal name can have, so the
// reserved namespace and the open vocabulary never collide.
function unaliasFieldName(wire: string): string {
  return wire.startsWith('.') ? fieldNameFromAlias(wire.slice(1)) : wire
}

function unalias(wire: string, from: (v: string) => string): string {
  return wire.startsWith('.') ? from(wire.slice(1)) : wire
}

function text(raw: Uint8Array | undefined): string {
  if (raw === undefined) return ''
  const r = new CborReader(raw)
  const s = r.readText()
  r.expectEnd()
  return s
}

function uint(raw: Uint8Array | undefined): number {
  if (raw === undefined) return 0
  const r = new CborReader(raw)
  const v = r.readInt()
  r.expectEnd()
  if (v < 0n) throw new RankeDecodeError('a size or height cannot be negative')
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RankeDecodeError('a size or height beyond 2^53 exceeds what a number holds')
  }
  return Number(v)
}

function bytes(raw: Uint8Array | undefined): Uint8Array | null {
  if (raw === undefined) return null
  const r = new CborReader(raw)
  const b = r.readBytes()
  r.expectEnd()
  return Uint8Array.from(b)
}

function fields(raw: Uint8Array | undefined): Readonly<Record<string, string>> {
  const out = raw === undefined ? {} : readTextMap(raw)
  // `V-TIME` covers delete_by and the two pubkey bounds as well as created_at. Read at
  // the door, since a record that arrived as bytes meets no other parser.
  const bad = checkTimestampFields(out)
  if (bad !== null) throw new RankeDecodeError(`a timestamp is not RFC 3339 nanoseconds: ${bad}`)
  return Object.freeze(out)
}

// content resolves the three-way declaration: inline bytes, an external address, or
// nothing. Inline and external are exclusive (§Content), so bytes present with a
// hash is a malformed record rather than a preference.
function content(
  inline: Uint8Array | null,
  hash: Uint8Array | null,
  size: number,
  encodingClass: string,
  encodingSub: string,
): ContentRef {
  const encoding = encodingClass === '' && encodingSub === '' ? '' : `${encodingClass}/${encodingSub}`
  if (inline !== null && hash !== null) {
    throw new RankeDecodeError('a record declares both inline content and a content hash')
  }
  if (inline !== null) return Object.freeze({ kind: 'inline', bytes: inline, size, encoding })
  if (hash !== null) {
    return Object.freeze({
      kind: 'external',
      hash: hashFromMultihashBytes(hash).toString(),
      size,
      encoding,
    })
  }
  // A size with neither the bytes nor an address: content the record declares and does
  // not carry, which a read cutting content to nothing delivers (`R-QCONTENT`). It holds
  // an empty run of bytes rather than none, so a reader compares lengths as ever.
  if (size > 0) return Object.freeze({ kind: 'inline', bytes: new Uint8Array(0), size, encoding })
  return contentNone
}

function decodeNode(raw: Uint8Array, id: string, opts: DecodeOptions): Claim {
  const m = readIntMap(new CborReader(raw))

  const typeClass = unalias(text(m.get(N_TYPE_CLASS)), nodeClassFromAlias)
  const typeSub = unalias(text(m.get(N_TYPE_SUB)), nodeSubtypeFromAlias)
  if (typeClass === '' || typeSub === '') {
    throw new RankeDecodeError('a node record states no type')
  }
  const createdAt = text(m.get(N_CREATED_AT))
  if (createdAt === '') throw new RankeDecodeError('a node record states no created_at')

  const edgesRaw = m.get(N_EDGES)
  const edges = edgesRaw === undefined ? [] : decodeEdges(edgesRaw, opts)

  return Object.freeze({
    id,
    type: `${typeClass}/${typeSub}`,
    typeClass,
    typeSub,
    createdAt,
    createdAtMs: parseCreatedAt(createdAt),
    height: uint(m.get(N_HEIGHT)),
    fields: fields(m.get(N_FIELDS)),
    content: content(
      bytes(m.get(N_CONTENT)),
      bytes(m.get(N_CONTENT_HASH)),
      uint(m.get(N_CONTENT_SIZE)),
      unalias(text(m.get(N_ENCODING_CLASS)), encodingClassFromAlias),
      unalias(text(m.get(N_ENCODING_SUB)), encodingSubFromAlias),
    ),
    edges: Object.freeze(edges),
  })
}

function decodeEdges(raw: Uint8Array, opts: DecodeOptions): Edge[] {
  const r = new CborReader(raw)
  const n = r.readArrayHeader()
  const out: Edge[] = []
  for (let i = 0; i < n; i++) {
    out.push(decodeEdge(r.skipValue(), opts))
  }
  r.expectEnd()
  return out
}

function decodeEdge(raw: Uint8Array, opts: DecodeOptions): Edge {
  const m = readIntMap(new CborReader(raw))

  const reference = bytes(m.get(E_REFERENCE))
  if (reference === null) throw new RankeDecodeError('an edge states no reference')
  const typeClass = unalias(text(m.get(E_TYPE_CLASS)), edgeClassFromAlias)
  const typeSub = unalias(text(m.get(E_TYPE_SUB)), edgeSubtypeFromAlias)
  if (typeClass === '' || typeSub === '') {
    throw new RankeDecodeError('an edge states no type')
  }

  const dirRaw = m.get(E_RELATION_DIRECTION)
  let relationDirection: RelationDirection = 0
  if (dirRaw !== undefined) {
    const r = new CborReader(dirRaw)
    const v = r.readInt()
    r.expectEnd()
    if (v !== 1n && v !== -1n) {
      throw new RankeDecodeError(`relation_direction is +1 or -1, got ${v}`)
    }
    relationDirection = Number(v) as RelationDirection
  }

  const edge: Edge = {
    reference: idFromBytes(reference).toString(),
    type: `${typeClass}/${typeSub}`,
    typeClass,
    typeSub,
    fields: fields(m.get(E_FIELDS)),
    relationDirection,
    content: content(
      bytes(m.get(E_CONTENT)),
      bytes(m.get(E_CONTENT_HASH)),
      uint(m.get(E_CONTENT_SIZE)),
      unalias(text(m.get(E_ENCODING_CLASS)), encodingClassFromAlias),
      unalias(text(m.get(E_ENCODING_SUB)), encodingSubFromAlias),
    ),
    // The edge id is H(S(e)) over its stored bytes, never over a re-encode, so it
    // stays stable as the alias taxonomy grows.
    ...(opts.edgeIds === true ? { id: hashContent(raw).toString() } : {}),
  }
  return Object.freeze(edge)
}

/**
 * claimFromRecord is the Claim a decode of encodeClaim(n) yields, arrived at from the
 * record instead of the bytes — what a builder holding the record wants, since parsing
 * back its own output costs a seventh of a build.
 *
 * It rests on every string a record carries being charset-clean and canonical, which
 * claim_builder.ts holds its input to, and on the alias tables being bijections, which
 * the taxonomy tests hold them to: the wire then renders those strings back unchanged.
 * `claim_builder_test.ts` proves the agreement over every builder case.
 *
 * ranke-go needs no counterpart — its Node already satisfies Claim, where a decoded
 * claim here is plain data (see README).
 *
 * @internal
 */
export function claimFromRecord(n: NodeRecord, id: string): Claim {
  return Object.freeze({
    id,
    type: `${n.typeClass}/${n.typeSub}`,
    typeClass: n.typeClass,
    typeSub: n.typeSub,
    createdAt: n.createdAt,
    createdAtMs: parseCreatedAt(n.createdAt),
    height: n.height,
    fields: fieldsInWireOrder(n.fields),
    content: contentFromRef(n.content),
    edges: Object.freeze((n.edges ?? []).map(edgeFromRecord)),
  })
}

function edgeFromRecord(e: EdgeRecord): Edge {
  return Object.freeze({
    reference: e.reference,
    type: `${e.typeClass}/${e.typeSub}`,
    typeClass: e.typeClass,
    typeSub: e.typeSub,
    fields: fieldsInWireOrder(e.fields),
    relationDirection: e.relationDirection ?? 0,
    content: contentFromRef(e.content),
  })
}

// fieldsInWireOrder is the field map a decode reads back: the same entries, in the order
// the record writes them. That order is by encoded key bytes, so a short alias leads, and
// a claim serialises the same whichever side it came from.
function fieldsInWireOrder(
  fields: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (fields === undefined) return Object.freeze({})
  const names = Object.keys(fields)
  if (names.length < 2) return Object.freeze({ ...fields }) // one entry is already in order
  const wire = new Map(names.map((name) => [name, encodeText(aliasToWire(name, fieldNameToAlias))]))
  const out: Record<string, string> = {}
  for (const name of [...wire.keys()].sort((a, b) => compareBytes(wire.get(a)!, wire.get(b)!))) {
    out[name] = fields[name]!
  }
  return Object.freeze(out)
}

// contentFromRef is the declaration a decode reads back. Empty inline content leaves
// no slot in the record, so the wire carries none; the bytes are copied, as a decode's
// are, so the claim holds what no caller can reach afterwards.
function contentFromRef(ref: ContentRef | undefined): ContentRef {
  if (ref === undefined || ref.kind === 'none') return contentNone
  if (ref.kind === 'external') {
    return Object.freeze({ kind: 'external', hash: ref.hash, size: ref.size, encoding: ref.encoding })
  }
  // Content declared but not carried keeps its length, so the claim states what exists
  // while holding none of it.
  if (ref.bytes.length === 0 && ref.size > 0) {
    return Object.freeze({
      kind: 'inline',
      bytes: new Uint8Array(0),
      size: ref.size,
      encoding: ref.encoding,
    })
  }
  if (ref.bytes.length === 0) return contentNone
  return Object.freeze({
    kind: 'inline',
    bytes: Uint8Array.from(ref.bytes),
    size: ref.size,
    encoding: ref.encoding,
  })
}

/**
 * parseCreatedAt returns epoch milliseconds for a created_at in the one form `V-TIME`
 * admits, dropping precision past the millisecond — which is why claim.createdAt keeps
 * the string.
 */
export function parseCreatedAt(s: string): number {
  if (!validRFC3339Nano(s)) {
    throw new RankeDecodeError(`created_at is not RFC 3339 nanoseconds in UTC: ${s}`)
  }
  return Date.parse(s)
}

// ─── Encoding: the canonical bytes an id is computed over ─────────────

/**
 * NodeRecord is what encodeNode serializes: a node's own fields, with each edge
 * already built. It is the input to signing, so nothing here is derived later.
 */
export interface NodeRecord {
  readonly typeClass: string
  readonly typeSub: string
  /** RFC 3339 with fixed-width nanoseconds in UTC, which is what keeps S(v) stable. */
  readonly createdAt: string
  readonly height: number
  readonly fields?: Readonly<Record<string, string>>
  readonly content?: ContentRef
  readonly edges?: readonly EdgeRecord[]
}

/** EdgeRecord is what encodeEdge serializes. */
export interface EdgeRecord {
  readonly reference: string
  readonly typeClass: string
  readonly typeSub: string
  readonly relationDirection?: RelationDirection
  readonly fields?: Readonly<Record<string, string>>
  readonly content?: ContentRef
}

/**
 * encodeEdge returns the canonical S(e) bytes an edge id is computed over.
 *
 * Mirrors ranke-go's buildEncEdge and encodeEdge: the aliases are applied into the
 * bytes, and a zero-valued slot is omitted rather than written.
 */
export function encodeEdge(e: EdgeRecord): Uint8Array {
  const entries: Array<readonly [Uint8Array, Uint8Array]> = [
    [encodeUint(E_REFERENCE), encodeIdBytes(e.reference)],
    [encodeUint(E_TYPE_CLASS), encodeText(aliasToWire(e.typeClass, edgeClassToAlias))],
    [encodeUint(E_TYPE_SUB), encodeText(aliasToWire(e.typeSub, edgeSubtypeToAlias))],
  ]
  if (e.relationDirection !== undefined && e.relationDirection !== 0) {
    entries.push([encodeUint(E_RELATION_DIRECTION), encodeInt(e.relationDirection)])
  }
  const fields = encodeFields(e.fields)
  if (fields !== null) entries.push([encodeUint(E_FIELDS), fields])
  pushContent(entries, e.content, {
    hash: E_CONTENT_HASH,
    size: E_CONTENT_SIZE,
    encodingClass: E_ENCODING_CLASS,
    encodingSub: E_ENCODING_SUB,
    inline: E_CONTENT,
  })

  const w = new CborWriter()
  w.writeSortedMap(entries)
  return w.bytes()
}

/**
 * encodeNode returns the canonical S(v) bytes a node id is computed over, with each
 * edge's own record embedded raw — so S(v) commits to the edges and their content.
 */
export function encodeNode(n: NodeRecord): Uint8Array {
  return encodeNodeWithEdges(n, (n.edges ?? []).map(encodeEdge))
}

/**
 * encodeNodeWithEdges is encodeNode where each edge's S(e) is already in hand, which is
 * a builder's position: it encodes every edge to compute the edge ids. Canonical CBOR is
 * deterministic, so bytes held are the bytes a re-encode yields — the same property the
 * ids rest on.
 *
 * `edges` are S(e) for `n.edges`, one per edge and in that order.
 *
 * @internal
 */
export function encodeNodeWithEdges(n: NodeRecord, edges: readonly Uint8Array[]): Uint8Array {
  const entries: Array<readonly [Uint8Array, Uint8Array]> = [
    [encodeUint(N_TYPE_CLASS), encodeText(aliasToWire(n.typeClass, nodeClassToAlias))],
    [encodeUint(N_TYPE_SUB), encodeText(aliasToWire(n.typeSub, nodeSubtypeToAlias))],
    [encodeUint(N_CREATED_AT), encodeText(n.createdAt)],
  ]
  if (n.height !== 0) entries.push([encodeUint(N_HEIGHT), encodeUint(n.height)])
  const fields = encodeFields(n.fields)
  if (fields !== null) entries.push([encodeUint(N_FIELDS), fields])
  pushContent(entries, n.content, {
    hash: N_CONTENT_HASH,
    size: N_CONTENT_SIZE,
    encodingClass: N_ENCODING_CLASS,
    encodingSub: N_ENCODING_SUB,
    inline: N_CONTENT,
  })
  if (edges.length > 0) {
    const w = new CborWriter()
    w.writeArrayHeader(edges.length)
    for (const raw of edges) w.writeRaw(raw)
    entries.push([encodeUint(N_EDGES), w.bytes()])
  }

  const w = new CborWriter()
  w.writeSortedMap(entries)
  return w.bytes()
}

/** encodeClaim wraps a node record as the stored claim: the record under key 1. */
export function encodeClaim(n: NodeRecord): Uint8Array {
  return encodeClaimFromNode(encodeNode(n))
}

/**
 * encodeClaimFromNode is encodeClaim over S(v) already in hand — the very bytes the id
 * was computed over, so the stored record and the id cannot come apart.
 *
 * @internal
 */
export function encodeClaimFromNode(node: Uint8Array): Uint8Array {
  const w = new CborWriter()
  w.writeSortedMap([[encodeUint(CLAIM_NODE), node]])
  return w.bytes()
}

// pushContent writes the content declaration, which is inline bytes or an address,
// never both (§Content). An encoding is mandatory wherever content is present.
function pushContent(
  entries: Array<readonly [Uint8Array, Uint8Array]>,
  content: ContentRef | undefined,
  keys: { hash: number; size: number; encodingClass: number; encodingSub: number; inline: number },
): void {
  if (content === undefined || content.kind === 'none') return
  const { typeClass, typeSub } = splitType(content.encoding)
  entries.push([encodeUint(keys.encodingClass), encodeText(aliasToWire(typeClass, encodingClassToAlias))])
  entries.push([encodeUint(keys.encodingSub), encodeText(aliasToWire(typeSub, encodingSubToAlias))])
  if (content.size !== 0) entries.push([encodeUint(keys.size), encodeUint(content.size)])
  if (content.kind === 'inline') {
    // Bytes the record does not hold leave the slot out, the size above standing for
    // what exists.
    if (content.bytes.length > 0) entries.push([encodeUint(keys.inline), encodeBytes(content.bytes)])
    return
  }
  entries.push([encodeUint(keys.hash), encodeBytes(parseId(content.hash).rawBytes())])
}

// encodeFields aliases each key and writes the map, or null when there are none: an
// empty map is a slot ranke-go omits.
function encodeFields(fields: Readonly<Record<string, string>> | undefined): Uint8Array | null {
  const names = Object.keys(fields ?? {})
  if (names.length === 0) return null
  const w = new CborWriter()
  w.writeSortedMap(
    names.map(
      (k) => [encodeText(aliasToWire(k, fieldNameToAlias)), encodeText(fields![k]!)] as const,
    ),
  )
  return w.bytes()
}

// An alias carries a leading "." on the wire — a prefix no literal can have, so the
// reserved namespace and the open vocabulary never collide.
function aliasToWire(v: string, toAlias: (s: string) => string): string {
  const a = toAlias(v)
  return a === v ? v : `.${a}`
}

function encodeIdBytes(id: string): Uint8Array {
  return encodeBytes(parseId(id).rawBytes())
}

function encodeBytes(b: Uint8Array): Uint8Array {
  const w = new CborWriter(b.length + 9)
  w.writeBytes(b)
  return w.bytes()
}

function encodeInt(n: number): Uint8Array {
  const w = new CborWriter(9)
  w.writeInt(n)
  return w.bytes()
}

import assert from 'node:assert/strict'
import test from 'node:test'

import { type EdgeRecord, type NodeRecord, encodeEdge, encodeNodeWithEdges } from './codec.ts'
import { CborReader } from './internal/cbor.ts'

// The numeric keys `V-SER` fixes, read off the encoded bytes rather than off the constants
// that produced them: a mis-transcribed table round-trips against itself happily.
// Inline content and a content_hash are exclusive (§Content), so covering all eight
// shared keys takes one record of each kind.

/** keysOf maps each numeric key in a CBOR map to the raw bytes of its value. */
function keysOf(record: Uint8Array): Map<number, Uint8Array> {
  const r = new CborReader(record)
  const n = r.readMapHeader()
  const out = new Map<number, Uint8Array>()
  for (let i = 0; i < n; i++) {
    const key = Number(r.readInt())
    out.set(key, r.skipValue())
  }
  r.expectEnd()
  return out
}

const CREATED_AT = '2026-01-02T03:04:05.000000000Z'
const REF = 'bciqlu6awx6hqdt7kifaubxs5vyrchmadmgrzmf32ts2bb73b6iablli'

const inlineNode: NodeRecord = {
  typeClass: 'source',
  typeSub: 'note',
  createdAt: CREATED_AT,
  height: 3,
  fields: { a: '1' },
  content: { kind: 'inline', bytes: new Uint8Array([1, 2, 3]), size: 3, encoding: 'text/plain' },
}

const externalNode: NodeRecord = {
  ...inlineNode,
  content: { kind: 'external', hash: REF, size: 9, encoding: 'text/plain' },
}

const inlineEdge: EdgeRecord = {
  reference: REF,
  typeClass: 'relation',
  typeSub: 'employment',
  relationDirection: 1,
  fields: { b: '2' },
  content: { kind: 'inline', bytes: new Uint8Array([4, 5]), size: 2, encoding: 'text/plain' },
}

const externalEdge: EdgeRecord = {
  ...inlineEdge,
  content: { kind: 'external', hash: REF, size: 9, encoding: 'text/plain' },
}

const TYPE_CLASS = 1
const TYPE_SUB = 2
const ENCODING_CLASS = 3
const ENCODING_SUB = 4
const CONTENT_HASH = 5
const CONTENT = 6
const CONTENT_SIZE = 7
const FIELDS = 8
const SHARED = [TYPE_CLASS, TYPE_SUB, ENCODING_CLASS, ENCODING_SUB, CONTENT_HASH, CONTENT, CONTENT_SIZE, FIELDS]

const NODE_OWN = [9, 10, 11] // created_at, edges, height
const EDGE_OWN = [12, 13] // reference, relation_direction

const sorted = (keys: Iterable<number>) => [...keys].sort((a, b) => a - b)
const node = (n: NodeRecord) => keysOf(encodeNodeWithEdges(n, [encodeEdge(inlineEdge)]))
const edge = (e: EdgeRecord) => keysOf(encodeEdge(e))

test('a node record serializes under the keys `V-SER` fixes', () => {
  const want = (omit: number) => sorted([...SHARED.filter((k) => k !== omit), ...NODE_OWN])
  assert.deepEqual(sorted(node(inlineNode).keys()), want(CONTENT_HASH), 'inline content')
  assert.deepEqual(sorted(node(externalNode).keys()), want(CONTENT), 'external content')
})

test('an edge record serializes under the keys `V-SER` fixes', () => {
  const want = (omit: number) => sorted([...SHARED.filter((k) => k !== omit), ...EDGE_OWN])
  assert.deepEqual(sorted(edge(inlineEdge).keys()), want(CONTENT_HASH), 'inline content')
  assert.deepEqual(sorted(edge(externalEdge).keys()), want(CONTENT), 'external content')
})

// Which value sits under which number: a key set alone passes with two of them swapped,
// and reading a content_hash as content serves an address as a payload. Type and encoding
// values are alias-encoded, so those are checked by kind.
test('each key holds the slot the table assigns it', () => {
  const text = (b: Uint8Array | undefined) => new CborReader(b!).readText()
  const uint = (b: Uint8Array | undefined) => Number(new CborReader(b!).readInt())
  const bytes = (b: Uint8Array | undefined) => new CborReader(b!).readBytes()

  const n = node(inlineNode)
  assert.ok(text(n.get(TYPE_CLASS)).length > 0, 'node type class is text')
  assert.ok(text(n.get(TYPE_SUB)).length > 0, 'node type subtype is text')
  assert.ok(text(n.get(ENCODING_CLASS)).length > 0, 'node encoding class is text')
  assert.ok(text(n.get(ENCODING_SUB)).length > 0, 'node encoding subtype is text')
  assert.deepEqual(bytes(n.get(CONTENT)), new Uint8Array([1, 2, 3]), 'node content')
  assert.equal(uint(n.get(CONTENT_SIZE)), 3, 'node content_size')
  assert.equal(text(n.get(9)), CREATED_AT, 'node created_at')
  assert.equal(uint(n.get(11)), 3, 'node height')
  // edges is an array of whole edge records, each one an S(e).
  assert.equal(new CborReader(n.get(10)!).readArrayHeader(), 1, 'node edges')

  assert.ok(bytes(node(externalNode).get(CONTENT_HASH)).length > 0, 'node content_hash')

  const e = edge(inlineEdge)
  assert.deepEqual(bytes(e.get(CONTENT)), new Uint8Array([4, 5]), 'edge content')
  assert.equal(uint(e.get(CONTENT_SIZE)), 2, 'edge content_size')
  assert.ok(bytes(e.get(12)).length > 0, 'edge reference')
  assert.equal(uint(e.get(13)), 1, 'edge relation_direction')
  assert.ok(bytes(edge(externalEdge).get(CONTENT_HASH)).length > 0, 'edge content_hash')
})

// One number, one meaning. The records are untyped maps, so a reader that mixed them up
// would decode rather than fail, reading a created_at as a reference.
test('no key means one thing in a node and another in an edge', () => {
  for (const n of [inlineNode, externalNode]) {
    for (const e of [inlineEdge, externalEdge]) {
      for (const key of node(n).keys()) {
        if (!edge(e).has(key)) continue
        assert.ok(SHARED.includes(key), `key ${key} is in both records but is not a shared slot`)
      }
    }
  }
})

// Under 24, so CBOR encodes each key in the head byte alone; 24 and up costs a second
// byte on every record.
test('every key fits one head byte', () => {
  for (const record of [node(inlineNode), node(externalNode), edge(inlineEdge), edge(externalEdge)]) {
    for (const key of record.keys()) {
      assert.ok(key > 0 && key < 24, `key ${key} spills into a second head byte`)
    }
  }
})

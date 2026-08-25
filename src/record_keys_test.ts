import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EdgeRecordKeys,
  NodeRecordKeys,
  type RecordKind,
  recordKeyName,
} from './record_keys.ts'
import { envelopePayload } from './codec_envelope.ts'
import { CborReader } from './internal/cbor.ts'
import * as fx from './testing/fixtures.ts'

// The exported table is what a reader renders raw bytes with, so it is checked against
// ranke-go's output rather than against the constants that produced it: a mis-transcribed
// table round-trips against itself happily. The numbers come off encoded records, the
// names off ranke-go's JSON projection of those same claims.
//
// The numbers below are written out again on purpose, as codec_keys_test.ts does. Deriving
// them from the module under test would assert nothing.

const SHARED = new Map([
  [1, 'type_class'],
  [2, 'type_subtype'],
  [3, 'encoding_class'],
  [4, 'encoding_subtype'],
  [5, 'content_hash'],
  [6, 'content'],
  [7, 'content_size'],
  [8, 'fields'],
])
const NODE_OWN = new Map([
  [9, 'created_at'],
  [10, 'edges'],
  [11, 'height'],
])
const EDGE_OWN = new Map([
  [12, 'reference'],
  [13, 'relation_direction'],
])

const expected = (own: Map<number, string>) => new Map([...SHARED, ...own])

test('the table is the numbering @tbl:keys fixes', () => {
  assert.deepEqual(new Map(NodeRecordKeys), expected(NODE_OWN))
  assert.deepEqual(new Map(EdgeRecordKeys), expected(EDGE_OWN))
})

// One number, one meaning: the eight shared slots must read alike in both records, or a
// reader labels a node's key 5 one thing and an edge's another.
test('the shared slots agree across the two records', () => {
  for (const [key, name] of SHARED) {
    assert.equal(NodeRecordKeys.get(key), name, `node key ${key}`)
    assert.equal(EdgeRecordKeys.get(key), name, `edge key ${key}`)
  }
  for (const key of NODE_OWN.keys()) {
    assert.ok(!EdgeRecordKeys.has(key), `key ${key} is a node's alone`)
  }
  for (const key of EDGE_OWN.keys()) {
    assert.ok(!NodeRecordKeys.has(key), `key ${key} is an edge's alone`)
  }
})

// A key the table does not assign reads as the number alone. Naming it would be a guess,
// and a later implementation may add one.
test('an unassigned key has no name', () => {
  for (const kind of ['node', 'edge'] as RecordKind[]) {
    for (const key of [0, 14, 23, 24, 99]) {
      assert.equal(recordKeyName(kind, key), undefined, `${kind} key ${key}`)
    }
  }
  assert.equal(recordKeyName('node', 12), undefined, 'reference is an edge slot')
  assert.equal(recordKeyName('edge', 9), undefined, 'created_at is a node slot')
})

// keysOf reads the numeric keys of a CBOR map, which is what a reader faces.
function keysOf(record: Uint8Array): number[] {
  const r = new CborReader(record)
  const n = r.readMapHeader()
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(Number(r.readInt()))
    r.skipValue()
  }
  return out
}

// The JSON projection combines each type and encoding half under one key, so those two
// names map to `type` and `encoding`; every other slot carries its own name.
function jsonKeyFor(name: string): string {
  if (name === 'type_class' || name === 'type_subtype') return 'type'
  if (name === 'encoding_class' || name === 'encoding_subtype') return 'encoding'
  return name
}

// ranke-go is the oracle for the NAMES: every key a real record carries maps to a name its
// own JSON projection also carries. A renamed slot fails here rather than reaching a
// viewer as a confident mislabelling.
test('every name is one ranke-go projects the same slot under', () => {
  let checked = 0
  for (const f of fx.all) {
    const record = envelopePayload(fx.cborBytes(f))
    const projected = f.json as Record<string, unknown>
    for (const key of keysOf(record)) {
      const name = NodeRecordKeys.get(key)
      assert.ok(name !== undefined, `${f.label}: node key ${key} has no name`)
      assert.ok(
        jsonKeyFor(name) in projected,
        `${f.label}: node key ${key} is ${name}, absent from the projection`,
      )
      checked++
    }
    const edges = (projected.edges ?? []) as Array<Record<string, unknown>>
    for (const [i, edge] of edges.entries()) {
      // The record's edge list is in the same order the projection renders it.
      for (const key of edgeKeysOf(record, i)) {
        const name = EdgeRecordKeys.get(key)
        assert.ok(name !== undefined, `${f.label}: edge key ${key} has no name`)
        assert.ok(
          jsonKeyFor(name) in edge,
          `${f.label}: edge key ${key} is ${name}, absent from the projection`,
        )
        checked++
      }
    }
  }
  // A silent zero would pass every assertion above.
  assert.ok(checked > 40, `only ${checked} slots checked — the fixtures carry more`)
})

// edgeKeysOf reads the keys of the i-th edge record inlined under the node's edges slot.
function edgeKeysOf(nodeRecord: Uint8Array, i: number): number[] {
  const r = new CborReader(nodeRecord)
  const n = r.readMapHeader()
  for (let k = 0; k < n; k++) {
    const key = Number(r.readInt())
    const value = r.skipValue()
    if (key !== 10) continue // the edges slot
    const list = new CborReader(value)
    const count = list.readArrayHeader()
    for (let j = 0; j < count; j++) {
      const raw = list.skipValue()
      if (j === i) return keysOf(raw)
    }
  }
  return []
}

import assert from 'node:assert/strict'
import test from 'node:test'

import type { Claim, Edge } from './claim.ts'
import {
  type EdgeRecord,
  type NodeRecord,
  decodeClaim,
  encodeEdge,
  encodeNode,
} from './codec.ts'
import { encodeEnvelope, envelopePayload, signatureLength } from './codec_envelope.ts'
import { hashContent } from './id.ts'
import * as fx from './testing/fixtures.ts'

// The encoder's whole job is producing the bytes ranke-go produces: an id is computed
// over them, so a difference of one byte is a different claim. The fixtures hold
// ranke-go's own output, and envelopePayload extracts the serialized claim its signature
// covers — so decoding a fixture and encoding it back is a byte-for-byte comparison with
// the reference implementation, needing no key.

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')

// asRecord turns a decoded claim back into the record the encoder takes. Nothing is
// derived here: every value came off the wire.
function asRecord(c: Claim): NodeRecord {
  return {
    typeClass: c.typeClass,
    typeSub: c.typeSub,
    createdAt: c.createdAt,
    height: c.height,
    fields: c.fields,
    content: c.content,
    edges: c.edges.map(asEdgeRecord),
  }
}

function asEdgeRecord(e: Edge): EdgeRecord {
  return {
    reference: e.reference,
    typeClass: e.typeClass,
    typeSub: e.typeSub,
    relationDirection: e.relationDirection,
    fields: e.fields,
    content: e.content,
  }
}

test('encodeNode reproduces the bytes ranke-go signed over', () => {
  for (const f of fx.all) {
    const raw = fx.cborBytes(f)
    const want = envelopePayload(raw)
    const got = encodeNode(asRecord(decodeClaim(raw, f.id)))
    assert.equal(hex(got), hex(want), f.label)
  }
})

// The stored record is the envelope, and its signature is data the fixture carries — so
// re-sealing with that signature reproduces the record and its id without a key. A wrong
// payload would change the envelope and so the id, which is what makes this a byte check
// on everything the builder assembles, not just on the signature being copied through.
test('re-sealing reproduces the whole stored record and its id', () => {
  for (const f of fx.all) {
    const raw = fx.cborBytes(f)
    const signature = raw.subarray(raw.length - signatureLength)
    const payload = encodeNode(asRecord(decodeClaim(raw, f.id)))
    const got = encodeEnvelope(payload, signature)
    assert.equal(hex(got), hex(raw), f.label)
    assert.equal(hashContent(got).toString(), f.id, `${f.label}: id(v) = H(S(env(v)))`)
  }
})

// An edge id is H(S(e)) over its own bytes, so reproducing the ids proves each edge
// record byte for byte and not merely the node that embeds them.
test('encodeEdge reproduces every edge id ranke-go computed', () => {
  for (const f of fx.all) {
    const c = decodeClaim(fx.cborBytes(f), f.id, { edgeIds: true })
    const got = c.edges.map((e) => ({
      type: e.type,
      id: hashContent(encodeEdge(asEdgeRecord(e))).toString(),
    }))
    assert.deepEqual(got, f.edges ?? [], f.label)
    // And the recomputed id equals the one the decode reported, so the two paths agree.
    for (const [i, e] of c.edges.entries()) assert.equal(got[i]!.id, e.id, `${f.label} edge ${i}`)
  }
})

// The relation fixture is the one carrying every optional slot: a direction, edge
// fields, inline content on one edge and an external address on another.
test('the richest claim round-trips through the encoder', () => {
  const raw = fx.cborBytes(fx.relation)
  const c = decodeClaim(raw, fx.relation.id)
  const resealed = encodeEnvelope(
    encodeNode(asRecord(c)),
    raw.subarray(raw.length - signatureLength),
  )
  const again = decodeClaim(resealed, fx.relation.id)
  assert.deepEqual(again, c)
})

test('a zero-valued slot is omitted, not written', () => {
  // No height, no fields, no content, no edges: the record holds its three mandatory
  // keys and nothing else.
  const bare = encodeNode({
    typeClass: 'contribution',
    typeSub: 'contributor',
    createdAt: '2026-01-01T00:00:00.000000000Z',
    height: 0,
  })
  // a3 — a map of three, being type class, type sub and created_at.
  assert.equal(hex(bare).slice(0, 2), 'a3')
})

test('an omitted field set encodes as an absent slot, not an empty map', () => {
  const withEmpty = encodeNode({
    typeClass: 'source',
    typeSub: 'note',
    createdAt: '2026-01-01T00:00:00.000000000Z',
    height: 1,
    fields: {},
  })
  const without = encodeNode({
    typeClass: 'source',
    typeSub: 'note',
    createdAt: '2026-01-01T00:00:00.000000000Z',
    height: 1,
  })
  assert.equal(hex(withEmpty), hex(without))
})

// Field keys order by their encoded bytes, so a length-first ordering is what makes
// two implementations agree. The source fixture carries "aa", "b" and "title".
test('field keys keep the canonical order under re-encoding', () => {
  const raw = fx.cborBytes(fx.source)
  const c = decodeClaim(raw, fx.source.id)
  assert.equal(hex(encodeNode(asRecord(c))), hex(envelopePayload(raw)))

  // The same fields offered in a different insertion order must encode identically:
  // the ordering is the encoder's, never the caller's.
  const shuffled = encodeNode({
    ...asRecord(c),
    fields: { title: c.fields.title!, b: c.fields.b!, aa: c.fields.aa! },
  })
  assert.equal(hex(shuffled), hex(envelopePayload(raw)))
})

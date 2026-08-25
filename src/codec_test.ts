import assert from 'node:assert/strict'
import test from 'node:test'

import type { Claim } from './claim.ts'
import { contributorOf, edgesOfType, getField, hasField } from './claim.ts'
import { RankeDecodeError, decodeClaim } from './codec.ts'
import { envelopePayload } from './codec_envelope.ts'
import { decodeClaimJSON, type WireClaim } from './codec_json.ts'
import { hashContent } from './id.ts'
import * as fx from './testing/fixtures.ts'

// The fixtures are claims ranke-go built and encoded both ways. ranke-go is the
// reference implementation, so these are the specification of a decode: the CBOR
// path and the JSON path must both arrive at the claim it produced.

// A timestamp in the one form `V-TIME` admits, for the JSON records built by hand here.
const AT = '2026-01-01T00:00:00.000000000Z'

// The fixtures must trace to a version, so that a regeneration part-way through a
// change cannot bake in an unreleased encoder unnoticed. This runs first, because a
// stale fixture set makes every assertion below meaningless.
test('the fixtures come from a released ranke-go', () => {
  assert.equal(
    fx.provenance.substituted,
    undefined,
    'generated from a release rather than a local checkout',
  )
  assert.match(fx.provenance.rankeGo, /^v\d+\.\d+\.\d+$/, 'a released version')

  // ranke-go's JSON projection nests a record's fields, so an edge can carry its
  // own. A flat one predates that fix, and the two encodings will not agree.
  const src = fx.source.json as Record<string, unknown>
  assert.ok(
    'fields' in src,
    `ranke-go ${fx.provenance.rankeGo}'s JSON projection predates the edge-slot fix ` +
      '(fields flattened, edges reduced to {type, reference}). Release ranke-go, then ' +
      'cd tools && go get github.com/flocko-motion/ranke-go@vX.Y.Z && scripts/fixtures.sh',
  )
})

test('decodeClaim reads every fixture', () => {
  for (const f of fx.all) {
    const c = decodeClaim(fx.cborBytes(f), f.id)
    const w = f.json as WireClaim
    assert.equal(c.id, f.id, f.label)
    assert.equal(c.type, w.type, f.label)
    assert.equal(c.createdAt, w.created_at, f.label)
    assert.equal(c.height, w.height ?? 0, f.label)
    assert.deepEqual({ ...c.fields }, w.fields ?? {}, `${f.label} fields`)
    assert.equal(c.edges.length, (w.edges ?? []).length, `${f.label} edge count`)
  }
})

// Two encodings, one claim: whatever a caller asked the server for, the value it
// reads back is the same.
test('the CBOR and JSON paths agree', () => {
  for (const f of fx.all) {
    const fromCbor = decodeClaim(fx.cborBytes(f), f.id)
    const fromJson = decodeClaimJSON(f.json as WireClaim)
    assert.deepEqual(strip(fromJson), strip(fromCbor), f.label)
  }
})

// Neither encoding carries an edge id, so the comparison drops it; everything else
// must be identical.
function strip(c: Claim): unknown {
  return {
    id: c.id,
    type: c.type,
    typeClass: c.typeClass,
    typeSub: c.typeSub,
    createdAt: c.createdAt,
    createdAtMs: c.createdAtMs,
    height: c.height,
    fields: { ...c.fields },
    content: c.content,
    edges: c.edges.map((e) => ({
      reference: e.reference,
      type: e.type,
      typeClass: e.typeClass,
      typeSub: e.typeSub,
      fields: { ...e.fields },
      relationDirection: e.relationDirection,
      content: e.content,
    })),
  }
}

test('the type is split into class and subtype', () => {
  const c = decodeClaim(fx.cborBytes(fx.source), fx.source.id)
  assert.equal(c.type, 'source/register')
  assert.equal(c.typeClass, 'source')
  assert.equal(c.typeSub, 'register')
})

// A field map's keys order by encoded bytes, so "b" is stored before "aa". All three
// must come back, which is what proves the decoder honours that ordering rather than
// assuming a plain sort.
test('every field survives the length-first key ordering', () => {
  const c = decodeClaim(fx.cborBytes(fx.source), fx.source.id)
  assert.deepEqual({ ...c.fields }, {
    aa: 'length-first ordering',
    b: 'sorts before aa',
    title: 'Register of 1834',
  })
  assert.equal(getField(c, 'title'), 'Register of 1834')
  assert.ok(hasField(c, 'b'))
  assert.ok(!hasField(c, 'absent'))
})

test('inline content comes back with its size and encoding', () => {
  const c = decodeClaim(fx.cborBytes(fx.source), fx.source.id)
  assert.equal(c.content.kind, 'inline')
  if (c.content.kind !== 'inline') return
  assert.equal(new TextDecoder().decode(c.content.bytes), 'a parish register')
  assert.equal(c.content.size, 17)
  assert.equal(c.content.encoding, 'text/plain')
})

test('a claim with no content reports none', () => {
  const c = decodeClaim(fx.cborBytes(fx.entity), fx.entity.id)
  assert.equal(c.content.kind, 'none')
})

// An edge carries every slot a node does, which is what the JSON projection was
// dropping until ranke-go 0ad8ab3.
test('an edge carries its fields, direction and content', () => {
  const c = decodeClaim(fx.cborBytes(fx.relation), fx.relation.id)

  const [rel] = edgesOfType(c, 'relation/*')
  assert.ok(rel, 'the relation edge is present')
  assert.equal(rel.reference, fx.ids.entity)
  assert.equal(rel.relationDirection, 1)
  assert.equal(rel.fields.name, 'mother')
  assert.equal(rel.fields.certainty, 'high')
  assert.equal(rel.content.kind, 'inline')
  if (rel.content.kind === 'inline') {
    assert.equal(new TextDecoder().decode(rel.content.bytes), 'stated in the register')
    assert.equal(rel.content.encoding, 'text/plain')
  }

  const [scan] = edgesOfType(c, 'derivation/scan')
  assert.ok(scan, 'the external-content edge is present')
  assert.equal(scan.content.kind, 'external')
  if (scan.content.kind === 'external') {
    assert.equal(scan.content.hash, fx.ids.scanHash)
    assert.equal(scan.content.size, 18)
    assert.equal(scan.content.encoding, 'image/png')
  }
  assert.equal(scan.relationDirection, 0, 'zero outside relation/*')
})

test('edge ids are computed on request only', () => {
  const bare = decodeClaim(fx.cborBytes(fx.relation), fx.relation.id)
  assert.equal(bare.edges[0]!.id, undefined)

  const withIds = decodeClaim(fx.cborBytes(fx.relation), fx.relation.id, { edgeIds: true })
  assert.deepEqual(
    withIds.edges.map((e) => ({ type: e.type, id: e.id })),
    fx.relation.edges,
    'H(S(e)) over the stored edge bytes',
  )
})

test('edge ids match ranke-go for every fixture', () => {
  for (const f of fx.all) {
    const c = decodeClaim(fx.cborBytes(f), f.id, { edgeIds: true })
    assert.deepEqual(
      c.edges.map((e) => ({ type: e.type, id: e.id })),
      f.edges ?? [],
      f.label,
    )
  }
})

test('the contributor edge names the signer', () => {
  assert.equal(contributorOf(decodeClaim(fx.cborBytes(fx.source), fx.source.id)), fx.ids.contributor)
  assert.equal(
    contributorOf(decodeClaim(fx.cborBytes(fx.contributor), fx.contributor.id)),
    null,
    'an initial node carries its own key',
  )
})

// A claim's record does not carry its own id, so a decode is told it. `V-ID` hashes the
// stored bytes — the envelope, not the payload inside it — so the check needs no key.
test('the id is H over the stored bytes, and the payload sits inside them', () => {
  const raw = fx.cborBytes(fx.source)
  assert.equal(hashContent(raw).toString(), fx.source.id, 'id(v) = H(S(env(v)))')

  const payload = envelopePayload(raw)
  assert.ok(payload.length > 0)
  assert.ok(raw.length > payload.length, 'the payload is the record inside the envelope')
  // Hashing the payload answers something, and it is not the id: that is what `R-QCANON`
  // means by `detail: claims` carrying no such guarantee.
  assert.notEqual(hashContent(payload).toString(), fx.source.id)
})

test('an omitted id leaves the claim unnamed', () => {
  const c = decodeClaim(fx.cborBytes(fx.source))
  assert.equal(c.id, '', 'the bytes do not name the claim')
  assert.equal(c.type, 'source/register')
})

test('createdAt keeps its nanoseconds and offers milliseconds', () => {
  const c = decodeClaim(fx.cborBytes(fx.source), fx.source.id)
  assert.equal(c.createdAt, '2026-01-02T03:04:06.123456789Z', 'the signed value, in full')
  assert.equal(c.createdAtMs, Date.parse('2026-01-02T03:04:06.123Z'))
})

test('a decoded claim is frozen', () => {
  const c = decodeClaim(fx.cborBytes(fx.source), fx.source.id)
  assert.ok(Object.isFrozen(c))
  assert.ok(Object.isFrozen(c.fields))
  assert.ok(Object.isFrozen(c.edges))
})

test('decodeClaim refuses what is not a claim', () => {
  for (const bad of [
    new Uint8Array(0),
    Uint8Array.from([0x01]), // an integer, not a record
    Uint8Array.from([0xa1, 0x02, 0x01]), // a record under the wrong key
    new TextEncoder().encode('not cbor at all'),
  ]) {
    assert.throws(() => decodeClaim(bad), RankeDecodeError)
  }
})

test('decodeClaim refuses a truncated record', () => {
  const raw = fx.cborBytes(fx.source)
  for (const n of [1, 8, raw.length - 1]) {
    assert.throws(() => decodeClaim(raw.subarray(0, n)), RankeDecodeError, `${n} bytes`)
  }
})

test('decodeClaimJSON refuses a record missing its type or timestamp', () => {
  assert.throws(() => decodeClaimJSON({ created_at: AT }), RankeDecodeError)
  assert.throws(() => decodeClaimJSON({ type: 'source/note' }), RankeDecodeError)
  assert.throws(
    () => decodeClaimJSON({ type: 'source/note', created_at: 'not a date' }),
    RankeDecodeError,
  )
})

// `V-TIME` fixes one representation, so a timestamp a lax reader would take is refused:
// otherwise two implementations disagree on what a claim says while both read it.
test('decodeClaimJSON refuses a created_at outside the one form', () => {
  for (const at of [
    '2026-01-01T00:00:00Z', // no fraction
    '2026-01-01T00:00:00.000Z', // milliseconds, not nanoseconds
    '2026-01-01T00:00:00.000000000+01:00', // an offset, where `V-TIME` fixes UTC
    '2026-01-01', // a date alone
    '2026-02-30T00:00:00.000000000Z', // a day February does not have
    '2026-01-01T24:00:00.000000000Z', // an hour a day does not have
  ]) {
    assert.throws(() => decodeClaimJSON({ type: 'source/note', created_at: at }), RankeDecodeError, at)
  }
  decodeClaimJSON({ type: 'source/note', created_at: AT }) // the control
})

test('decodeClaimJSON refuses content declared both ways', () => {
  assert.throws(
    () =>
      decodeClaimJSON({
        type: 'source/note',
        created_at: AT,
        content: 'YQ==',
        content_hash: fx.ids.scanHash!,
      }),
    RankeDecodeError,
  )
})

// A record ranke-go's decode rejects, which ranke-ts must reject too: agreement on the
// accepted set says nothing about what a reader lets through. The bytes and the verdict
// are both ranke-go's (tools/fixtures), so nothing here is hand-written.
test('decodeClaim refuses every record ranke-go refuses', () => {
  assert.ok(fx.refusals.length > 0, 'the refusal cases are missing — regenerate the file')
  for (const r of fx.refusals) {
    assert.throws(() => decodeClaim(fx.cborBytes(r)), RankeDecodeError, r.label)
  }
})

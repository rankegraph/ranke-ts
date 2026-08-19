import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeClaim } from './codec.ts'
import { inspectClaim } from './inspect.ts'
import { CborWriter, encodeText, encodeUint } from './internal/cbor.ts'
import * as fx from './testing/fixtures.ts'

// The inspector explains bytes; it never admits them. A malformed claim is the record a
// person most wants to see, and the one the reader refuses by design.

test('a good claim inspects as valid, and the claim comes back', () => {
  for (const f of fx.all) {
    const seen = inspectClaim(fx.cborBytes(f))
    assert.equal(seen.valid, true, f.label)
    assert.deepEqual(seen.deviations, [], f.label)
    assert.equal(seen.claim?.type, decodeClaim(fx.cborBytes(f), f.id).type, f.label)
  }
})

// The slot names are what a viewer prints beside each number.
test('a node record renders its slots by name', () => {
  const seen = inspectClaim(fx.cborBytes(fx.source))
  const node = seen.records.find((r) => r.path === 'node')
  assert.ok(node !== undefined, 'the node record was framed')
  assert.equal(node.kind, 'node')

  const byName = new Map(node.slots.map((s) => [s.name, s]))
  assert.ok(byName.has('created_at'), 'created_at is named')
  assert.ok(byName.has('type_class'), 'type_class is named')
  assert.ok(byName.has('content'), 'content is named')
  assert.equal(byName.get('created_at')?.key, 9, 'created_at is key 9')
  assert.equal(byName.get('content')?.key, 6, 'content is key 6')

  // Every slot points somewhere inside the bytes it was read from.
  const total = fx.cborBytes(fx.source).length
  for (const s of node.slots) {
    assert.ok(s.at > 0 && s.at < total, `${s.name ?? s.key} offset ${s.at} is inside the record`)
    assert.ok(s.length > 0, `${s.name ?? s.key} has a length`)
  }
})

test('each inlined edge renders as its own record', () => {
  const seen = inspectClaim(fx.cborBytes(fx.relation))
  const edges = seen.records.filter((r) => r.kind === 'edge')
  assert.equal(edges.length, fx.relation.edges.length, 'one record per edge')
  assert.deepEqual(
    edges.map((e) => e.path),
    fx.relation.edges.map((_, i) => `node.edges[${i}]`),
  )
  const withReference = edges.filter((e) => e.slots.some((s) => s.name === 'reference'))
  assert.equal(withReference.length, edges.length, 'every edge names its reference')
})

// The line the viewer wants to print. A key out of order is reported at the offset of the
// key that broke it, and the slots after it still render.
test('keys out of canonical order are reported at their offset', () => {
  const w = new CborWriter()
  w.writeMapHeader(2)
  w.writeRaw(encodeUint(9))
  w.writeRaw(encodeText('2026-01-02T03:04:05.000000000Z'))
  w.writeRaw(encodeUint(1)) // after 9, so out of order
  w.writeRaw(encodeText('source'))
  const record = w.bytes()

  const outer = new CborWriter()
  outer.writeMapHeader(1)
  outer.writeRaw(encodeUint(1))
  outer.writeRaw(record)

  const seen = inspectClaim(outer.bytes())
  assert.equal(seen.valid, false, 'the decoder refuses it')
  assert.equal(seen.claim, undefined, 'no claim comes back from broken bytes')

  const order = seen.deviations.find((d) => d.message.includes('canonical order'))
  assert.ok(order !== undefined, `expected an ordering deviation, got ${JSON.stringify(seen.deviations)}`)
  assert.equal(order.path, 'node', 'the deviation names the record it is in')
  assert.ok(order.at > 0, 'the deviation carries an offset')
  // The offset points at the offending key, which is the byte holding 1.
  assert.equal(outer.bytes()[order.at], 0x01, 'the offset points at the out-of-order key')

  // Both slots still rendered: reporting a deviation does not end the record.
  const node = seen.records.find((r) => r.path === 'node')
  assert.deepEqual(node?.slots.map((s) => s.key), [9, 1], 'the slots after a deviation still render')
})

// The refusal fixtures are structurally sound records the decoder rejects on meaning — a
// timestamp that will not parse. The walk finds nothing there, so the decoder's account is
// the only one, and it must survive. These bytes and this verdict are both ranke-go's.
test('a record refused on meaning still renders, with the decoder explaining', () => {
  assert.ok(fx.refusals.length > 0, 'the refusal cases are missing — regenerate the file')
  for (const r of fx.refusals) {
    const seen = inspectClaim(fx.cborBytes(r))
    assert.equal(seen.valid, false, r.label)
    assert.equal(seen.claim, undefined, r.label)
    assert.equal(seen.deviations.length, 1, `${r.label}: one account, not none and not two`)
    assert.match(seen.deviations[0]!.message, /timestamp/i, r.label)
    // The record renders whatever the verdict — that is the point of the tab.
    const node = seen.records.find((rec) => rec.path === 'node')
    assert.ok(node !== undefined, `${r.label}: the node record still renders`)
    assert.ok(node.slots.length > 0, `${r.label}: its slots still render`)
  }
})

test('bytes that are not a claim yield a deviation and no records', () => {
  for (const bad of [new Uint8Array(0), new TextEncoder().encode('not cbor at all')]) {
    const seen = inspectClaim(bad)
    assert.equal(seen.valid, false)
    assert.deepEqual(seen.records, [])
    assert.ok(seen.deviations.length > 0, 'it says why')
  }
})

// Truncation is the common case for a stream cut short, and it must not throw.
test('a truncated claim reports rather than throws', () => {
  const raw = fx.cborBytes(fx.source)
  for (const n of [1, 8, 20, raw.length - 1]) {
    const seen = inspectClaim(raw.subarray(0, n))
    assert.equal(seen.valid, false, `${n} bytes`)
    assert.ok(seen.deviations.length > 0, `${n} bytes says why`)
  }
})

// An unassigned key is rendered as the number alone: naming it would be a guess, and a
// later implementation may add one.
test('a key the table does not assign renders unnamed', () => {
  const w = new CborWriter()
  w.writeMapHeader(1)
  w.writeRaw(encodeUint(21))
  w.writeRaw(encodeText('from a later implementation'))

  const outer = new CborWriter()
  outer.writeMapHeader(1)
  outer.writeRaw(encodeUint(1))
  outer.writeRaw(w.bytes())

  const seen = inspectClaim(outer.bytes())
  const node = seen.records.find((r) => r.path === 'node')
  const slot = node?.slots.find((s) => s.key === 21)
  assert.ok(slot !== undefined, 'the slot renders')
  assert.equal(slot.name, undefined, 'and carries no invented name')
})

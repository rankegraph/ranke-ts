import assert from 'node:assert/strict'
import test from 'node:test'

import { RankeDecodeError, decodeSerializedClaim } from './codec.ts'
import {
  type ResultRecord,
  newSeqReader,
  readClaims,
  readIds,
  readRawRecords,
  readRecords,
} from './codec_seq.ts'
import { contentHeld, contentSize } from './content.ts'
import { CborWriter, encodeText, encodeUint } from './internal/cbor.ts'
import * as fx from './testing/fixtures.ts'

// A result run is thousands of claims arriving over a stream, so the reader is fed
// chunks that fall wherever the network puts them. Every case here checks the same
// property: the claims read are the same however the bytes were split.

const LABELS = fx.all.map((f) => f.label)

function cborStream(): Uint8Array {
  const parts = fx.all.map(fx.cborBytes)
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function jsonSeqStream(): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const f of fx.all) {
    parts.push(Uint8Array.of(0x1e), enc.encode(JSON.stringify(f.json)), Uint8Array.of(0x0a))
  }
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// feed pushes the stream in chunks of the given size and returns every claim read.
function feed(encoding: 'cbor' | 'json', stream: Uint8Array, chunk: number): string[] {
  const r = newSeqReader(encoding)
  const labels: string[] = []
  for (let i = 0; i < stream.length; i += chunk) {
    for (const c of r.push(stream.subarray(i, Math.min(i + chunk, stream.length)))) {
      labels.push(c.type)
    }
  }
  for (const c of r.end()) labels.push(c.type)
  return labels
}

const TYPES = fx.all.map((f) => (f.json as { type: string }).type)

test('a cbor sequence reads whole', () => {
  assert.deepEqual(feed('cbor', cborStream(), Number.MAX_SAFE_INTEGER), TYPES)
})

// One byte at a time is the worst case: every record boundary falls inside a chunk,
// so the reader must hold a partial value across every single push.
test('a cbor sequence reads one byte at a time', () => {
  assert.deepEqual(feed('cbor', cborStream(), 1), TYPES)
})

test('a cbor sequence reads at every chunk size', () => {
  const stream = cborStream()
  for (const size of [2, 3, 7, 16, 31, 64, 97, 256, 1024]) {
    assert.deepEqual(feed('cbor', stream, size), TYPES, `chunk ${size}`)
  }
})

test('a json sequence reads at every chunk size', () => {
  const stream = jsonSeqStream()
  for (const size of [1, 2, 5, 13, 64, 200, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(feed('json', stream, size), TYPES, `chunk ${size}`)
  }
})

// A stream cut mid-record is a failure, so end() raises one; the claims it managed
// answer a different question than the one asked.
test('a cbor stream cut mid-record fails at end', () => {
  const stream = cborStream()
  const r = newSeqReader('cbor')
  const read = r.push(stream.subarray(0, stream.length - 4))
  assert.ok(read.length < fx.all.length, 'the last record is incomplete')
  assert.throws(() => r.end(), RankeDecodeError)
})

test('bytesRead counts what was fed', () => {
  const stream = cborStream()
  const r = newSeqReader('cbor')
  r.push(stream.subarray(0, 10))
  assert.equal(r.bytesRead, 10)
  r.push(stream.subarray(10))
  assert.equal(r.bytesRead, stream.length)
})

test('malformed bytes stop the stream rather than stalling it', () => {
  const r = newSeqReader('cbor')
  // A head outside its shortest form: no further chunk can make it canonical.
  assert.throws(() => r.push(Uint8Array.of(0x18, 0x17)), Error)
})

test('the claims a stream yields carry their fields', () => {
  const r = newSeqReader('cbor')
  const claims = [...r.push(cborStream()), ...r.end()]
  const src = claims.find((c) => c.type === 'source/register')
  assert.ok(src)
  assert.equal(src.fields.title, 'Register of 1834')
  assert.equal(src.content.kind, 'inline')
})

// readClaims is the wrapper a caller reaches for over a fetch body.
test('readClaims iterates a ReadableStream', async () => {
  const stream = cborStream()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < stream.length; i += 11) {
        controller.enqueue(stream.subarray(i, Math.min(i + 11, stream.length)))
      }
      controller.close()
    },
  })
  const got: string[] = []
  for await (const claim of readClaims(body, 'cbor')) got.push(claim.type)
  assert.deepEqual(got, TYPES)
})

test('readClaims iterates a json sequence', async () => {
  const stream = jsonSeqStream()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(stream.subarray(0, 3))
      controller.enqueue(stream.subarray(3))
      controller.close()
    },
  })
  const got: string[] = []
  for await (const claim of readClaims(body, 'json')) got.push(claim.type)
  assert.deepEqual(got, TYPES)
})

test('an empty stream yields nothing', () => {
  for (const encoding of ['cbor', 'json'] as const) {
    const r = newSeqReader(encoding)
    assert.deepEqual(r.push(new Uint8Array(0)), [])
    assert.deepEqual(r.end(), [])
  }
})

// A capped read is how the stream is normally served, so the size a withheld body states
// must survive the framing as well as the decode. The reader holds no content logic of its
// own — it hands a record to the CBOR or the JSON decoder — and this is what says so, the
// seq oracle exercising no content option.
test('a withheld body keeps its size through either framing', () => {
  // A served record is a serialized claim, so the held count is read rather than recorded.
  const heldOf = (c: fx.Capped) => contentHeld(decodeSerializedClaim(fx.cborBytes(c), c.id).content)
  const withheld = fx.capped.filter((c) => heldOf(c) === 0)
  assert.equal(withheld.length, 3, 'the options that serve a size and no bytes')

  for (const c of withheld) {
    const viaCbor = newSeqReader('cbor')
    const cbor = [...viaCbor.push(fx.cborBytes(c)), ...viaCbor.end()]
    assert.equal(cbor.length, 1, `${c.label}: one cbor record`)
    assert.equal(contentSize(cbor[0]!.content), c.size, `${c.label}: cbor keeps the size`)
    assert.equal(contentHeld(cbor[0]!.content), 0, `${c.label}: cbor holds no bytes`)

    const viaJson = newSeqReader('json')
    const json = [...viaJson.push(jsonSeq(c.json)), ...viaJson.end()]
    assert.equal(json.length, 1, `${c.label}: one json record`)
    assert.equal(contentSize(json[0]!.content), c.size, `${c.label}: json keeps the size`)
    assert.equal(contentHeld(json[0]!.content), 0, `${c.label}: json holds no bytes`)
  }
})

// --- the kinds a record can carry ---
//
// A record is not always a claim: Output.Detail and Output.Shape decide what one
// holds. RankeDB writes an id as a bare JSON string, a route of ids as an array in
// one record, and a path of claims as one record per claim (serve.go writeResult).
// Reading only claims left `detail: id` unreadable, which is what these cover.

function jsonSeq(...records: unknown[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const r of records) {
    parts.push(Uint8Array.of(0x1e), enc.encode(JSON.stringify(r)), Uint8Array.of(0x0a))
  }
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function bodyOf(bytes: Uint8Array, chunk = 7): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) {
        controller.enqueue(bytes.subarray(i, Math.min(i + chunk, bytes.length)))
      }
      controller.close()
    },
  })
}

test('an identity sequence reads as ids', async () => {
  const ids = [fx.ids.source!, fx.ids.entity!, fx.ids.relation!]
  const got: string[] = []
  for await (const id of readIds(bodyOf(jsonSeq(...ids)))) got.push(id)
  assert.deepEqual(got, ids)
})

// output.shape: path with detail: id puts a whole route in one record, so an id
// reader flattens it while a record reader keeps the routes apart.
test('a route of ids reads whole or flattened', async () => {
  const routes = [
    [fx.ids.relation!, fx.ids.entity!, fx.ids.source!],
    [fx.ids.entity!, fx.ids.source!],
  ]
  const bytes = jsonSeq(...routes)

  const records: ResultRecord[] = []
  for await (const rec of readRecords(bodyOf(bytes), 'json')) records.push(rec)
  assert.deepEqual(
    records.map((r) => r.kind),
    ['path_id', 'path_id'],
  )
  assert.deepEqual(records.map((r) => (r.kind === 'path_id' ? r.ids : null)), routes)

  const flat: string[] = []
  for await (const id of readIds(bodyOf(bytes))) flat.push(id)
  assert.deepEqual(flat, routes.flat())
})

test('a record reader tells a claim from an id', async () => {
  const bytes = jsonSeq(fx.ids.source!, fx.source.json, [fx.ids.entity!])
  const kinds: string[] = []
  for await (const rec of readRecords(bodyOf(bytes), 'json')) kinds.push(rec.kind)
  assert.deepEqual(kinds, ['claim_id', 'claim', 'path_id'])
})

// execution.report appends one record after the last result, so a claim reader must
// pass over it rather than try to read a claim from it.
test('a trailing report is reported, and skipped by the claim reader', async () => {
  const report = { StartedAt: '2026-01-02T03:04:05Z', Results: 1, Truncated: false, Events: [] }
  const bytes = jsonSeq(fx.source.json, report)

  const kinds: string[] = []
  for await (const rec of readRecords(bodyOf(bytes), 'json')) kinds.push(rec.kind)
  assert.deepEqual(kinds, ['claim', 'report'])

  const claims: string[] = []
  for await (const c of readClaims(bodyOf(bytes), 'json')) claims.push(c.type)
  assert.deepEqual(claims, ['source/register'], 'the report is not a result')
})

// Asking for claims from an identity run is a mistake worth naming, since the
// alternative is an empty result that looks like an empty archive.
test('the claim reader refuses an identity sequence by name', async () => {
  await assert.rejects(
    async () => {
      for await (const _ of readClaims(bodyOf(jsonSeq(fx.ids.source!)), 'json')) {
        /* the first record throws */
      }
    },
    (err: unknown) => {
      assert.ok(err instanceof RankeDecodeError)
      assert.match(err.message, /claim_id/)
      assert.match(err.message, /readRecords/)
      return true
    },
  )
})

// The framing on its own, so a payload this library does not name is still reachable.
test('raw records come back unread', async () => {
  const bytes = jsonSeq('one', 'two')
  const raws: string[] = []
  for await (const raw of readRawRecords(bodyOf(bytes), 'json')) {
    raws.push(new TextDecoder().decode(raw))
  }
  assert.deepEqual(raws, ['"one"', '"two"'])
})

test('ids read at every chunk size', async () => {
  const ids = [fx.ids.source!, fx.ids.entity!]
  const bytes = jsonSeq(...ids)
  for (const size of [1, 2, 13, 64, 4096]) {
    const got: string[] = []
    for await (const id of readIds(bodyOf(bytes, size))) got.push(id)
    assert.deepEqual(got, ids, `chunk ${size}`)
  }
})

// --- the same kinds under cbor framing ---
//
// A JSON record in a CBOR sequence mis-decodes rather than failing: a leading '"' is
// 0x22, a valid CBOR negative integer. So every payload in a cbor-seq is CBOR, and the
// four kinds are told apart by major type — text for an id, array for a route, a map
// with integer keys for a claim, a map with text keys for the report.

function cborSeq(...records: Uint8Array[]): Uint8Array {
  const total = records.reduce((n, r) => n + r.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const r of records) {
    out.set(r, at)
    at += r.length
  }
  return out
}

function cborText(s: string): Uint8Array {
  const w = new CborWriter()
  w.writeText(s)
  return w.bytes()
}

function cborTextArray(items: readonly string[]): Uint8Array {
  const w = new CborWriter()
  w.writeArrayHeader(items.length)
  for (const s of items) w.writeText(s)
  return w.bytes()
}

function cborReport(): Uint8Array {
  const w = new CborWriter()
  w.writeSortedMap([
    [encodeText('started_at'), encodeText('2026-01-02T03:04:05Z')],
    [encodeText('elapsed_ns'), encodeUint(1_500_000_000)],
    [encodeText('results'), encodeUint(1)],
  ])
  return w.bytes()
}

test('an identity sequence reads under cbor framing too', async () => {
  const ids = [fx.ids.source!, fx.ids.entity!]
  const bytes = cborSeq(...ids.map(cborText))
  const got: string[] = []
  for await (const id of readIds(bodyOf(bytes), 'cbor')) got.push(id)
  assert.deepEqual(got, ids)
})

test('every cbor record kind is told apart by its major type', async () => {
  const bytes = cborSeq(
    cborText(fx.ids.source!),
    cborTextArray([fx.ids.entity!, fx.ids.source!]),
    fx.cborBytes(fx.source),
    cborReport(),
  )
  const records: ResultRecord[] = []
  for await (const rec of readRecords(bodyOf(bytes), 'cbor')) records.push(rec)

  assert.deepEqual(
    records.map((r) => r.kind),
    ['claim_id', 'path_id', 'envelope', 'report'],
  )
  const [id, route, claim, report] = records
  assert.equal(id?.kind === 'claim_id' ? id.id : null, fx.ids.source)
  assert.deepEqual(route?.kind === 'path_id' ? route.ids : null, [fx.ids.entity, fx.ids.source])
  assert.equal(claim?.kind === 'envelope' ? claim.claim.type : null, 'source/register')
  assert.deepEqual(
    claim?.kind === 'envelope' ? claim.bytes : null,
    fx.cborBytes(fx.source),
    'the stored bytes ride along, so a client can hash them against the id',
  )
  assert.ok(report?.kind === 'report')
  assert.equal(report.report.results, 1)
  assert.equal(report.report.elapsed_ns, 1_500_000_000, 'nanoseconds, as the name says')
})

test('a cbor claim reader passes over a trailing report', async () => {
  const bytes = cborSeq(fx.cborBytes(fx.source), cborReport())
  const types: string[] = []
  for await (const c of readClaims(bodyOf(bytes), 'cbor')) types.push(c.type)
  assert.deepEqual(types, ['source/register'])
})

test('cbor records read at every chunk size', async () => {
  const bytes = cborSeq(cborText(fx.ids.source!), fx.cborBytes(fx.source), cborReport())
  for (const size of [1, 3, 17, 64, 4096]) {
    const kinds: string[] = []
    for await (const rec of readRecords(bodyOf(bytes, size), 'cbor')) kinds.push(rec.kind)
    // The fixture is an envelope, so it reads as one — told apart by its tag, which is
    // what `R-QSTREAM` requires of the two details that both carry a claim.
    assert.deepEqual(kinds, ['claim_id', 'envelope', 'report'], `chunk ${size}`)
  }
})

test('the fixture labels are all present, so the stream covers each shape', () => {
  assert.deepEqual(LABELS, ['contributor', 'source', 'entity', 'relation', 'deletion'])
})

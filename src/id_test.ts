import { createHash, randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'

import { RankeIdError, hashContent, hashFromMultihashBytes, idFromBytes, parseId } from './id.ts'
import { contributor } from './testing/fixtures.ts'

// Ids produced by ranke-go's HashContent — the reference implementation is the
// oracle, so a divergence in the digest, the multihash framing, or the base32
// alphabet shows up as an unequal string rather than as agreeing mistakes.
const GO_IDS: ReadonlyArray<readonly [string, string]> = [
  ['', 'bciqohmgeikmpyhautl57jsezn64sij5oihsgjg4tjssjlgi3pbjlqvi'],
  ['abc', 'bciqlu6awx6hqdt7kifaubxs5vyrchmadmgrzmf32ts2bb73b6iablli'],
  ['hello world', 'bciqlstjhxgju2pqiuuxffv62pwv7vree57rxuu4a52iir55m4lx432i'],
  [
    'a large external node payload',
    'bciqkyij3v6b4hjf32ooztgnwyqa7ddebmwbau2d5sbgz6m6wcxgdgwq',
  ],
]

test('hashContent matches ranke-go', () => {
  for (const [input, want] of GO_IDS) {
    assert.equal(hashContent(Buffer.from(input)).toString(), want, JSON.stringify(input))
  }
})

// A thousand bytes, so the base32 encoding of the id is unaffected but the hashed
// input spans several blocks.
test('hashContent matches ranke-go over a multi-block input', () => {
  const big = new Uint8Array(1000)
  for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 251
  assert.equal(
    hashContent(big).toString(),
    'bciqfsqs6iqjoffx4orzwm46oazycp44eea7vtqgsyptl46ytgr5t77a',
  )
})

test('an id frames a SHA2-256 multihash', () => {
  const raw = hashContent(Buffer.from('abc')).rawBytes()
  assert.equal(raw.length, 34)
  assert.equal(raw[0], 0x12, 'multicodec sha2-256')
  assert.equal(raw[1], 0x20, 'digest length')
  assert.equal(
    Buffer.from(raw.subarray(2)).toString('hex'),
    createHash('sha256').update('abc').digest('hex'),
  )
})

test('parseId round-trips every id form', () => {
  for (const [input] of GO_IDS) {
    const id = hashContent(Buffer.from(input))
    const back = parseId(id.toString())
    assert.equal(back.toString(), id.toString())
    assert.ok(back.equal(id))
  }
})

test('parseId round-trips random payloads', () => {
  for (let i = 0; i < 500; i++) {
    const raw = randomBytes(1 + (i % 40))
    const id = idFromBytes(raw)
    assert.deepEqual(parseId(id.toString()).rawBytes(), Uint8Array.from(raw))
  }
})

test('equal compares by payload, not identity', () => {
  const a = hashContent(Buffer.from('abc'))
  const b = parseId(a.toString())
  assert.ok(a.equal(b))
  assert.ok(!a.equal(hashContent(Buffer.from('abd'))))
  assert.ok(!a.equal(null))
})

// A claim id is a multihash like any other, the signature having moved inside the record
// it attests (`V-ENV`). Taken from the generated fixtures rather than transcribed: this is
// the only cross-check that ranke-ts reads the framing ranke-go actually writes, so a
// hand-copied id would leave it agreeing with itself alone.
const goClaimId = contributor.id

test('algorithm names the hash', () => {
  assert.equal(hashContent(Buffer.from('abc')).algorithm(), 'sha2-256')
  assert.equal(parseId(goClaimId).algorithm(), 'sha2-256')
})

// One framing for a claim, an edge and external content. 34 bytes where a signature
// payload was 66, which is why a base32 id reads 56 characters and not 106.
test('a claim id is a 34-byte multihash', () => {
  const raw = parseId(goClaimId).rawBytes()
  assert.deepEqual(
    Uint8Array.from(raw.subarray(0, 2)),
    Uint8Array.from([0x12, 0x20]),
    'the sha2-256 multicodec, then the digest length',
  )
  assert.equal(raw.length, 34, 'the code, the length, a 32-byte digest')
  assert.equal(goClaimId.length, 56, 'and 56 base32 characters')
})

// A pubkey keeps ed25519-pub, which is what makes the code alone tell the two
// apart — it is a contributor claim's content (ranke-go EncodePublicKey).
test('the multikey framing round-trips through parseId', () => {
  const pubkey = Buffer.from(
    'ed0103a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8',
    'hex',
  )
  const id = idFromBytes(pubkey)
  assert.equal(id.algorithm(), 'ed25519-pub')
  assert.deepEqual(parseId(id.toString()).rawBytes(), Uint8Array.from(pubkey))
})

test('parseId refuses a non-base32 multibase', () => {
  assert.throws(() => parseId('zQ3shokFTS3brHcDQrn82RUDfCZTfKvS'), RankeIdError)
  assert.throws(() => parseId(''), RankeIdError)
})

test('parseId refuses characters outside the alphabet', () => {
  // "1", "0", "8" and "9" are excluded from RFC 4648 base32, and uppercase is
  // a different multibase entirely.
  for (const s of ['bciq1', 'bciq0', 'bciq8', 'bCIQ']) {
    assert.throws(() => parseId(s), RankeIdError, s)
  }
})

test('parseId refuses non-zero padding bits', () => {
  // "bcp" carries 10 bits for one byte, and the two spare bits are set — a string
  // no byte sequence encodes to, so accepting it would give one id two forms.
  assert.throws(() => parseId('bcp'), RankeIdError)
})

test('hashFromMultihashBytes validates the framing', () => {
  const good = hashContent(Buffer.from('abc')).rawBytes()
  assert.ok(hashFromMultihashBytes(good).equal(hashContent(Buffer.from('abc'))))

  const shortDigest = Uint8Array.of(0x12, 0x20, 1, 2, 3)
  assert.throws(() => hashFromMultihashBytes(shortDigest), RankeIdError, 'declared length unmet')

  const wrongCode = Uint8Array.from(good)
  wrongCode[0] = 0x13
  assert.throws(() => hashFromMultihashBytes(wrongCode), RankeIdError, 'not sha2-256')

  const trailing = new Uint8Array(good.length + 1)
  trailing.set(good)
  assert.throws(() => hashFromMultihashBytes(trailing), RankeIdError, 'trailing bytes')
})

test('toString is stable across calls', () => {
  const id = hashContent(Buffer.from('hello world'))
  assert.equal(id.toString(), id.toString())
  assert.equal(`${id}`, id.toString())
})

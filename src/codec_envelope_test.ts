import assert from 'node:assert/strict'
import test from 'node:test'
import { createPublicKey, verify } from 'node:crypto'

import {
  RankeEnvelopeError,
  encodeEnvelope,
  envelopePayload,
  envelopeSigningInput,
  signatureLength,
} from './codec_envelope.ts'
import { hashContent } from './id.ts'
import { readArtifact, resolveArtifacts } from './testing/testdata.ts'

// The envelope is checked against ranke-graph's PUBLISHED records, not against bytes
// written here: a template compared with itself agrees however wrong it is. The set is the
// spec's artifact, so these are the bytes every implementation must read.

const set = await resolveArtifacts()
const accepted = set.manifest.claims.filter((c) => c.verify)

test('the published envelopes carry a payload and an id over their own bytes', () => {
  assert.ok(accepted.length > 0, 'the set names claims to accept')
  for (const c of accepted) {
    const raw = readArtifact(set.root, c.file)
    const payload = envelopePayload(raw)
    assert.ok(payload.length > 0, `${c.file}: a payload`)
    // `V-ID`: the id is H over the stored bytes, so it needs no key at all.
    assert.equal(hashContent(raw).toString(), c.id, `${c.file}: id(v) = H(S(env(v)))`)
  }
})

// The signing input is the half a reading of RFC 9052 could get wrong without the bytes
// ever disagreeing, since nothing else depends on it. A published signature verifying
// against a locally built Sig_structure is what settles it.
test('a published signature verifies against the signing input we build', () => {
  const contributor = accepted.find((c) => c.file.includes('root-contributor'))
  assert.ok(contributor !== undefined, 'the set carries a root contributor')
  const raw = readArtifact(set.root, contributor.file)
  const payload = envelopePayload(raw)
  const signature = raw.subarray(raw.length - signatureLength)

  // A root contributor's own content is its multikey pubkey: 0xed 0x01, then the raw key.
  const marker = payload.findIndex((b, i) => b === 0xed && payload[i + 1] === 0x01)
  assert.ok(marker >= 0, 'the contributor states a pubkey')
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      payload.subarray(marker + 2, marker + 34),
    ]),
    format: 'der',
    type: 'spki',
  })
  assert.ok(
    verify(null, envelopeSigningInput(payload), key, signature),
    'the signature covers the Sig_structure this library builds',
  )
})

test('encode and envelopePayload are inverses', () => {
  const payload = Uint8Array.of(0xa1, 0x01, 0x62, 0x2e, 0x63)
  const signature = new Uint8Array(signatureLength).fill(7)
  const raw = encodeEnvelope(payload, signature)
  assert.deepEqual(envelopePayload(raw), payload)
})

// Re-encoding a published envelope must reproduce it byte for byte, or a built claim and a
// decoded one would answer with different bytes and so different ids.
test('re-encoding a published envelope reproduces it', () => {
  for (const c of accepted) {
    // Uint8Array.from, since readArtifact hands back a Buffer and a strict comparison
    // separates the two by type however equal the bytes are.
    const raw = Uint8Array.from(readArtifact(set.root, c.file))
    const payload = envelopePayload(raw)
    const signature = raw.subarray(raw.length - signatureLength)
    assert.deepEqual(encodeEnvelope(payload, signature), raw, c.file)
  }
})

// `V-ENV` pins the headers, and the reason is not tidiness: the id hashes these bytes, so a
// spare header would give one claim a second stored form and a second id, both verifying.
test('a header beyond alg is refused', () => {
  const payload = Uint8Array.of(0xa1, 0x01, 0x62, 0x2e, 0x63)
  const good = encodeEnvelope(payload, new Uint8Array(signatureLength))

  const unprotected = Uint8Array.from(good)
  unprotected[6] = 0xa1 // one unprotected parameter where the rule admits none
  assert.throws(() => envelopePayload(unprotected), RankeEnvelopeError, 'unprotected header')

  const twoParams = Uint8Array.from(good)
  twoParams[3] = 0xa2 // two protected parameters where alg stands alone
  assert.throws(() => envelopePayload(twoParams), RankeEnvelopeError, 'protected header')

  const otherAlg = Uint8Array.from(good)
  otherAlg[5] = 0x26 // ES256 where V-SIGN fixes Ed25519
  assert.throws(() => envelopePayload(otherAlg), RankeEnvelopeError, 'another algorithm')
})

test('bytes that are not an envelope are refused', () => {
  const payload = Uint8Array.of(0xa1, 0x01, 0x62, 0x2e, 0x63)
  const good = encodeEnvelope(payload, new Uint8Array(signatureLength))

  // A serialized claim stored bare, which is the rejected-not-enveloped case: the id holds
  // over those bytes and the missing envelope is the whole defect.
  assert.throws(() => envelopePayload(payload), RankeEnvelopeError, 'a bare claim')
  assert.throws(() => envelopePayload(new Uint8Array(0)), RankeEnvelopeError, 'nothing')
  for (const n of [1, 2, 6, good.length - 1]) {
    assert.throws(() => envelopePayload(good.subarray(0, n)), RankeEnvelopeError, `${n} bytes`)
  }
  const trailing = new Uint8Array(good.length + 1)
  trailing.set(good)
  assert.throws(() => envelopePayload(trailing), RankeEnvelopeError, 'trailing bytes')
})

test('a signature of the wrong length is refused both ways', () => {
  const payload = Uint8Array.of(0xa1, 0x01)
  assert.throws(() => encodeEnvelope(payload, new Uint8Array(32)), RankeEnvelopeError)
  const good = encodeEnvelope(payload, new Uint8Array(signatureLength))
  const short = Uint8Array.from(good)
  short[short.length - signatureLength - 1] = 0x3f // bstr(31) where 64 is fixed
  assert.throws(() => envelopePayload(short), RankeEnvelopeError)
})

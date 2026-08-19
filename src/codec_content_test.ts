import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeClaim } from './codec.ts'
import { decodeClaimJSON, type WireClaim } from './codec_json.ts'
import { contentComplete, contentHeld, contentSize, inlineBytes } from './content.ts'
import { type Capped, capped, cborBytes } from './testing/fixtures.ts'

// A read may cap the content it inlines (`R-QCONTENT`), so a client receives claims whose
// content is partial or absent while content_size still states the true length. The bytes
// come from ranke-go's query encoder, the reference for that rule.

function find(label: string): Capped {
  const c = capped.find((x) => x.label === label)
  if (c === undefined) throw new Error(`capped fixture ${label} is missing — regenerate`)
  return c
}

test('every content option ranke-go serves decodes', () => {
  assert.ok(capped.length >= 6, 'the generator covers each option `R-QCONTENT` admits')
  for (const c of capped) {
    const claim = decodeClaim(cborBytes(c), c.id)
    assert.equal(contentHeld(claim.content), c.inline, `${c.label}: bytes held`)
    assert.equal(inlineBytes(claim.content)?.length, c.inline, `${c.label}: the bytes themselves`)
  }
})

// The size is the content's, whatever the record holds of it. Writing the truncated
// length would leave the shortfall unrecoverable, and the record unverifiable.
test('a capped claim declares the content length, not the prefix length', () => {
  for (const c of capped) {
    const claim = decodeClaim(cborBytes(c), c.id)
    assert.equal(contentSize(claim.content), c.size, `${c.label}: content_size`)
    assert.equal(c.declared, c.size, `${c.label}: ranke-go declared the full length`)
  }
})

// The predicate a reader needs: a prefix carries the same kind and the same non-zero size
// as whole content, so only the comparison tells them apart.
test('contentComplete tells a prefix from the whole content', () => {
  for (const c of capped) {
    const claim = decodeClaim(cborBytes(c), c.id)
    assert.equal(
      contentComplete(claim.content),
      c.inline === c.size,
      `${c.label}: held ${c.inline} of ${c.size}`,
    )
  }
  // Both partial cases must be visible as partial: one holding some bytes, one none.
  const partial = capped.filter((c) => c.inline < c.size)
  assert.ok(
    partial.some((c) => c.inline > 0) && partial.some((c) => c.inline === 0),
    'the fixtures cover a cut prefix and a content held back entirely',
  )
  for (const c of partial) {
    assert.equal(contentComplete(decodeClaim(cborBytes(c), c.id).content), false, c.label)
  }
})

// `R-QCANON`: content in full is the only output form a client can hash and check
// against the id, since those are the bytes S(v) the id was computed over.
test('content in full is the record whose hash is the id', () => {
  const full = find('max 0, content in full')
  const claim = decodeClaim(cborBytes(full), full.id)
  assert.equal(contentHeld(claim.content), full.size, 'every byte arrived')
  assert.ok(contentComplete(claim.content))
  assert.equal(claim.id, full.id)
})

// A record holding none of its content still declares it, reading as "inline, nothing
// held" — which is what lets a client ask again.
test('an absent content section inlines nothing', () => {
  const none = find('content absent, so none is inlined')
  assert.equal(none.inline, 0, 'ranke-go inlined none of it')
  const claim = decodeClaim(cborBytes(none), none.id)
  assert.equal(contentHeld(claim.content), 0)
  assert.equal(claim.content.kind, 'inline', 'content exists; this record holds none of it')
  assert.equal(contentComplete(claim.content), false)
  assert.equal(contentSize(claim.content), none.size)
})

test('cutoff delivers a prefix of the content, omit none of the value', () => {
  const cut = find('a cap the content overruns, cut at it')
  assert.equal(cut.inline, cut.cap, 'cut exactly at the cap')
  const cutClaim = decodeClaim(cborBytes(cut), cut.id)
  assert.equal(contentHeld(cutClaim.content), cut.cap)
  assert.equal(contentComplete(cutClaim.content), false, 'a prefix is not the content')

  const omitted = find('a cap the content overruns, omitted whole')
  assert.equal(omitted.inline, 0)
  assert.equal(contentHeld(decodeClaim(cborBytes(omitted), omitted.id).content), 0)
})

// An absent overflow is omit (`R-QCONTENT`), so the two must serve the same bytes.
test('an absent overflow serves what omit serves', () => {
  assert.equal(find('an absent overflow, which is omit').cbor,
    find('a cap the content overruns, omitted whole').cbor)
})

test('a cap the content fits leaves it whole', () => {
  const fits = find('a cap the content fits')
  assert.equal(fits.inline, fits.size)
  assert.equal(fits.cbor, find('max 0, content in full').cbor,
    'a cap nothing overruns serves the record in full')
})

// The JSON projection carries the same information (`R-QENCODING`), so its content field
// must follow the cap exactly as the CBOR record does.
test('the JSON projection caps content alike', () => {
  for (const c of capped) {
    const m = c.json as Record<string, unknown>
    const raw = m.content
    const inlined = typeof raw === 'string' ? Buffer.from(raw, 'base64').length : 0
    assert.equal(inlined, c.inline, `${c.label}: json content`)
    assert.equal(m.content_size, c.size, `${c.label}: json content_size`)
  }
})

// Carrying the same information is not the same as reading it. The test above inspects the
// wire and never decodes, which is why it stayed green while wireContent read a size-only
// record as no content at all — three of these six options, every one of them a served
// claim whose body a cap withheld.
test('both decode paths agree on every content option', () => {
  for (const c of capped) {
    const fromCbor = decodeClaim(cborBytes(c), c.id).content
    const fromJson = decodeClaimJSON(c.json as WireClaim).content
    assert.equal(fromJson.kind, fromCbor.kind, `${c.label}: kind`)
    assert.equal(contentSize(fromJson), contentSize(fromCbor), `${c.label}: size`)
    assert.equal(contentHeld(fromJson), contentHeld(fromCbor), `${c.label}: bytes held`)
    assert.equal(contentComplete(fromJson), contentComplete(fromCbor), `${c.label}: completeness`)
  }
})

// A withheld body is content that EXISTS and was not served. The size survives, nothing is
// held, and it is not complete — which is what lets a caller tell "too large, fetch it on
// selection" from "this claim has no content", the two a lost size collapses into one.
test('a withheld body keeps its size in both encodings', () => {
  const withheld = capped.filter((c) => c.inline === 0)
  assert.equal(withheld.length, 3, 'the options that serve a size and no bytes')
  for (const c of withheld) {
    for (const [via, ref] of [
      ['cbor', decodeClaim(cborBytes(c), c.id).content],
      ['json', decodeClaimJSON(c.json as WireClaim).content],
    ] as const) {
      assert.equal(contentSize(ref), c.size, `${c.label} via ${via}: the size is stated`)
      assert.equal(contentHeld(ref), 0, `${c.label} via ${via}: no bytes are held`)
      assert.equal(contentComplete(ref), false, `${c.label} via ${via}: and it is not whole`)
      assert.notEqual(ref.kind, 'none', `${c.label} via ${via}: content exists`)
    }
  }
})

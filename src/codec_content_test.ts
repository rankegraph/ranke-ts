import assert from 'node:assert/strict'
import test from 'node:test'

import { decodeSerializedClaim } from './codec.ts'
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

// A served record is a serialized claim (`R-QDETAIL`), not an envelope, so it decodes
// through decodeSerializedClaim — and no id covers it, which is what `R-QCANON` means by
// `detail: claims` carrying no such guarantee.
const served = (c: Capped) => decodeSerializedClaim(cborBytes(c), c.id).content

/** heldInJson reads the same record's inlined length off the projection. */
function heldInJson(c: Capped): number {
  const raw = (c.json as Record<string, unknown>).content
  return typeof raw === 'string' ? Buffer.from(raw, 'base64').length : 0
}

// The generator no longer records what the record holds, ranke-go exporting no decoder for
// a payload. It does not need to: the same record is emitted in both encodings, so the two
// readings are each other's oracle, and a decoder wrong about one would have to be wrong
// about the other in exactly the same way to pass.
test('every content option ranke-go serves decodes, and both encodings agree', () => {
  assert.ok(capped.length >= 6, 'the generator covers each option `R-QCONTENT` admits')
  for (const c of capped) {
    const held = contentHeld(served(c))
    assert.equal(held, heldInJson(c), `${c.label}: the two encodings hold the same count`)
    assert.equal(inlineBytes(served(c))?.length ?? 0, held, `${c.label}: the bytes themselves`)
  }
})

// The size is the content's, whatever the record holds of it. Writing the truncated
// length would leave the shortfall unrecoverable, and the record unverifiable.
test('a capped claim declares the content length, not the prefix length', () => {
  for (const c of capped) {
    assert.equal(contentSize(served(c)), c.size, `${c.label}: content_size`)
  }
})

// The predicate a reader needs: a prefix carries the same kind and the same non-zero size
// as whole content, so only the comparison tells them apart.
test('contentComplete tells a prefix from the whole content', () => {
  for (const c of capped) {
    assert.equal(
      contentComplete(served(c)),
      contentHeld(served(c)) === c.size,
      `${c.label}: held ${contentHeld(served(c))} of ${c.size}`,
    )
  }
  // Both partial cases must be visible as partial: one holding some bytes, one none.
  const partial = capped.filter((c) => contentHeld(served(c)) < c.size)
  assert.ok(
    partial.some((c) => contentHeld(served(c)) > 0) &&
      partial.some((c) => contentHeld(served(c)) === 0),
    'the fixtures cover a cut prefix and a content held back entirely',
  )
  for (const c of partial) {
    assert.equal(contentComplete(served(c)), false, c.label)
  }
})

// Content in full is the whole content in the record a read served. It is NOT the form a
// client hashes against the id: `R-QCANON` moved that to `detail: envelope`, and says
// outright that the id covers the envelope, not the payload inside it.
test('content in full holds every byte', () => {
  const full = find('max 0, content in full')
  assert.equal(contentHeld(served(full)), full.size, 'every byte arrived')
  assert.ok(contentComplete(served(full)))
})

// A record holding none of its content still declares it, reading as "inline, nothing
// held" — which is what lets a client ask again.
test('an absent content section inlines nothing', () => {
  const none = find('content absent, so none is inlined')
  assert.equal(contentHeld(served(none)), 0, 'ranke-go inlined none of it')
  assert.equal(served(none).kind, 'inline', 'content exists; this record holds none of it')
  assert.equal(contentComplete(served(none)), false)
  assert.equal(contentSize(served(none)), none.size)
})

test('cutoff delivers a prefix of the content, omit none of the value', () => {
  const cut = find('a cap the content overruns, cut at it')
  assert.equal(contentHeld(served(cut)), cut.cap, 'cut exactly at the cap')
  assert.equal(contentComplete(served(cut)), false, 'a prefix is not the content')

  const omitted = find('a cap the content overruns, omitted whole')
  assert.equal(contentHeld(served(omitted)), 0)
})

// An absent overflow is omit (`R-QCONTENT`), so the two must serve the same bytes.
test('an absent overflow serves what omit serves', () => {
  assert.equal(find('an absent overflow, which is omit').cbor,
    find('a cap the content overruns, omitted whole').cbor)
})

test('a cap the content fits leaves it whole', () => {
  const fits = find('a cap the content fits')
  assert.equal(contentHeld(served(fits)), fits.size)
  assert.equal(fits.cbor, find('max 0, content in full').cbor,
    'a cap nothing overruns serves the record in full')
})

// The JSON projection carries the same information (`R-QENCODING`), so its content field
// must follow the cap exactly as the CBOR record does.
test('the JSON projection caps content alike', () => {
  for (const c of capped) {
    const m = c.json as Record<string, unknown>
    assert.equal(heldInJson(c), contentHeld(served(c)), `${c.label}: json content`)
    assert.equal(m.content_size, c.size, `${c.label}: json content_size`)
  }
})

// Carrying the same information is not the same as reading it. The test above inspects the
// wire and never decodes, which is why it stayed green while wireContent read a size-only
// record as no content at all — three of these six options, every one of them a served
// claim whose body a cap withheld.
test('both decode paths agree on every content option', () => {
  for (const c of capped) {
    const fromCbor = served(c)
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
  const withheld = capped.filter((c) => contentHeld(served(c)) === 0)
  assert.equal(withheld.length, 3, 'the options that serve a size and no bytes')
  for (const c of withheld) {
    for (const [via, ref] of [
      ['cbor', served(c)],
      ['json', decodeClaimJSON(c.json as WireClaim).content],
    ] as const) {
      assert.equal(contentSize(ref), c.size, `${c.label} via ${via}: the size is stated`)
      assert.equal(contentHeld(ref), 0, `${c.label} via ${via}: no bytes are held`)
      assert.equal(contentComplete(ref), false, `${c.label} via ${via}: and it is not whole`)
      assert.notEqual(ref.kind, 'none', `${c.label} via ${via}: content exists`)
    }
  }
})

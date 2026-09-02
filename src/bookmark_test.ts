import assert from 'node:assert/strict'
import test from 'node:test'

import { RankeBookmarkError, bookmarkAt, decodeBookmark, idSeq } from './bookmark.ts'
import { envelopePayload } from './codec_envelope.ts'
import { parseId } from './id.ts'
import { readArtifact, resolveArtifacts } from './testing/testdata.ts'

// Checked against ranke-graph's PUBLISHED 𝒰_hist records, as the envelope is: a template
// compared with itself agrees however wrong it is. The manifest's slot is ranke-go's own
// id_seq(i, s) over each record's payload, which makes it the oracle for `V-IDSEQ`.

const set = await resolveArtifacts()
const bookmarks = set.manifest.bookmarks
const accepted = bookmarks.filter((b) => b.verify)

test('the set carries bookmark cases of both outcomes', () => {
  assert.ok(accepted.length > 0, 'a set with no accepted 𝒰_hist case proves nothing')
  assert.ok(
    bookmarks.some((b) => !b.verify),
    'a set with no refused 𝒰_hist case would pass a reader that accepts everything',
  )
})

test('every accepted record decodes and keys the slot it is offered at', () => {
  for (const c of accepted) {
    const raw = readArtifact(set.root, c.file)
    const bm = bookmarkAt(parseId(c.slot), raw)
    // `V-IDSEQ`: the slot is H(S([i, s])) over what the payload itself carries.
    assert.equal(idSeq(bm.index, bm.seed).toString(), c.slot, `${c.file}: id_seq(i, s)`)
    assert.ok(bm.head.startsWith('b'), `${c.file}: a head id`)
    assert.ok(bm.signer.startsWith('b'), `${c.file}: a signer id`)
  }
})

// The seed is fixed once per list and carried by every entry, so any one bookmark opens the
// whole list — which is the property the O(log n) head search stands on (spec §Bookmarks).
test('one entry of a list reaches every other entry of it', () => {
  const lists = new Map<string, typeof accepted>()
  for (const c of accepted) {
    if (c.list === undefined) continue
    lists.set(c.list, [...(lists.get(c.list) ?? []), c])
  }
  assert.ok(lists.size > 0, 'the set names a list to walk')
  for (const [name, cases] of lists) {
    assert.ok(cases.length > 1, `${name}: one entry alone shows nothing about reaching another`)
    const seed = decodeBookmark(readArtifact(set.root, cases[0]!.file)).seed
    for (const c of cases) {
      const bm = decodeBookmark(readArtifact(set.root, c.file))
      assert.deepEqual(bm.seed, seed, `${c.file}: one seed per list`)
      assert.equal(idSeq(bm.index, seed).toString(), c.slot, `${c.file}: reached from the seed`)
    }
  }
})

// `V-BMENV` fixes the payload's arity, so the two-element S([i, s]) the set carries is not a
// bookmark read short — it is refused.
test('a payload of the wrong arity is refused', () => {
  const c = bookmarks.find((b) => b.file.includes('bookmark-payload'))
  assert.ok(c !== undefined, 'the set carries a malformed-payload case')
  assert.throws(
    () => decodeBookmark(readArtifact(set.root, c.file)),
    (e: unknown) => e instanceof RankeBookmarkError && /three-element/.test((e as Error).message),
  )
})

// `V-BMSLOT`: a record whose own (i, s) keys a different slot belongs elsewhere, so the slot
// it was fetched at holds nothing. It decodes — only the pairing fails.
test('a record keying another slot is refused at this one', () => {
  const c = bookmarks.find((b) => b.file.includes('bookmark-slot'))
  assert.ok(c !== undefined, 'the set carries a wrong-slot case')
  const raw = readArtifact(set.root, c.file)
  const bm = decodeBookmark(raw)
  assert.notEqual(idSeq(bm.index, bm.seed).toString(), c.slot)
  assert.throws(() => bookmarkAt(parseId(c.slot), raw), RankeBookmarkError)
})

// The two keyspaces are separate, and neither reader admits the other's record: 𝒰 holds a
// claim map under id(v), 𝒰_hist a three-element array under id_seq(i, s) (`V-IDSEQ`).
test('a claim is no bookmark, and a bookmark no claim', () => {
  const claim = set.manifest.claims.find((c) => c.verify)
  assert.ok(claim !== undefined, 'the set names a claim to accept')
  assert.throws(() => decodeBookmark(readArtifact(set.root, claim.file)), RankeBookmarkError)
  assert.throws(() => envelopePayload(readArtifact(set.root, accepted[0]!.file)))
})

// `V-BMENV` pins the headers to alg and kid, and the reason is authorship: the kid is what
// says whose key to check a bookmark against, so a spare parameter or a second kid would
// leave the record naming two answers to that.
test('a header beyond alg and kid is refused', () => {
  const good = Uint8Array.from(readArtifact(set.root, accepted[0]!.file))
  assert.ok(decodeBookmark(good), 'the published record stands')

  // The protected header opens at offset 4: bstr, then the map header, alg, and kid's key.
  const cases: ReadonlyArray<readonly [number, number, string]> = [
    [4, 0xa3, 'three protected parameters where alg and kid are fixed'],
    [4, 0xa1, 'one, so the kid is gone'],
    [6, 0x26, 'ES256 where V-SIGN fixes Ed25519'],
    [7, 0x05, 'a parameter that is not the kid'],
    [44, 0xa1, 'one unprotected parameter where the rule admits none'],
  ]
  for (const [at, byte, what] of cases) {
    const bad = Uint8Array.from(good)
    bad[at] = byte
    assert.throws(() => decodeBookmark(bad), RankeBookmarkError, what)
  }
})

test('idSeq refuses an index a record could not carry', () => {
  const seed = new Uint8Array(16)
  assert.throws(() => idSeq(-1, seed), RankeBookmarkError)
  assert.throws(() => idSeq(1.5, seed), RankeBookmarkError)
  assert.throws(() => idSeq(Number.MAX_SAFE_INTEGER + 2, seed), RankeBookmarkError)
})

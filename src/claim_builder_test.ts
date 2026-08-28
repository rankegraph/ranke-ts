import assert from 'node:assert/strict'
import test from 'node:test'
import { createPrivateKey, createPublicKey, sign } from 'node:crypto'

import {
  type ClaimInput,
  RankeBuildError,
  contributorFrom,
  edgeIdOf,
  heightOf,
  newClaim as buildClaim,
  newEdge,
  normalizeCreatedAt,
} from './claim_builder.ts'
import { decodeClaim } from './codec.ts'
import { hashContent, idFromBytes, parseId } from './id.ts'
import * as fx from './testing/fixtures.ts'

// ranke-go built the fixtures; if this builder arrives at the same ids, it agrees on the
// type resolution, the contributor edge, the canonical edge order, the field ordering, the
// envelope framing and every byte of S(v) at once.
//
// Every claim is signed (`V-SIG`), so a rebuild needs the key the generator used: the seed
// is bytes 0..31 (tools/fixtures/main.go). It is test INPUT, not library state — this
// library holds no key material, and a Signer is how an application passes one in.
// node:crypto signs here; nothing shipped gains a dependency.

const enc = new TextEncoder()

const PKCS8_ED25519 = '302e020100300506032b657004220420'
const SPKI_ED25519 = '302a300506032b6570032100'
const PRIVATE_KEY = createPrivateKey({
  key: Buffer.concat([Buffer.from(PKCS8_ED25519, 'hex'), Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i))]),
  format: 'der',
  type: 'pkcs8',
})
const RAW_PUBLIC = createPublicKey(PRIVATE_KEY)
  .export({ format: 'der', type: 'spki' })
  .subarray(Buffer.from(SPKI_ED25519, 'hex').length)
/** The multikey framing `V-SIGN` fixes for a pubkey: 0xed as a varint, then the raw key. */
const PUBKEY = Uint8Array.from(Buffer.concat([Buffer.from([0xed, 0x01]), RAW_PUBLIC]))
const SIGNER = {
  pubkey: PUBKEY,
  sign: (message: Uint8Array): Uint8Array => Uint8Array.from(sign(null, message, PRIVATE_KEY)),
}

/** The pubkey as a contributor claim carries it: its own content (`V-SIG`). */
const PUBKEY_CONTENT = {
  kind: 'inline' as const,
  bytes: PUBKEY,
  size: PUBKEY.length,
  encoding: 'application/octet-stream',
}

/**
 * newClaim is the builder with the signing defaulted, since every claim is signed
 * (`V-SIG`) and most cases here are about something else. A case about signing passes its
 * own signer, or none where the refusal is the point.
 *
 * A root contributor gets the matching content too: it carries the pubkey its claims are
 * signed under, so defaulting the signer without it would build a claim the rules refuse.
 */
function newClaim(input: ClaimInput): ReturnType<typeof buildClaim> {
  if ('signer' in input) return buildClaim(input)
  const rootContributorWithNoKey =
    input.type === 'contribution/contributor' &&
    input.contributor === undefined &&
    input.content === undefined
  return buildClaim({
    ...input,
    ...(rootContributorWithNoKey ? { content: PUBKEY_CONTENT } : {}),
    signer: SIGNER,
  })
}

// The generator's clock: one instant, each claim a second later.
const AT_ROOT = '2026-01-02T03:04:05.123456789Z'
const AT_SOURCE = '2026-01-02T03:04:06.123456789Z'
const AT_ENTITY = '2026-01-02T03:04:07.123456789Z'
const AT_NOTE = '2026-01-02T03:04:16.123456789Z'
const AT_DERIVED = '2026-01-02T03:04:17.123456789Z'

/** The root contributor as the generator builds it: its content is its own pubkey. */
function rootContributor(): ReturnType<typeof newClaim> {
  return newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT })
}

test('a root contributor matches ranke-go', () => {
  const built = rootContributor()
  assert.equal(built.id, fx.contributor.id)
  assert.equal(Buffer.from(built.bytes).toString('hex'), fx.contributor.cbor)
})

test('a source matches ranke-go', () => {
  const root = rootContributor()
  const built = newClaim({
    type: 'source/register',
    contributor: contributorFrom(root.claim),
    content: {
      kind: 'inline',
      bytes: enc.encode('a parish register'),
      size: 17,
      encoding: 'text/plain',
    },
    fields: {
      title: 'Register of 1834',
      aa: 'length-first ordering',
      b: 'sorts before aa',
    },
    createdAt: AT_SOURCE,
    height: heightOf(root.claim),
    signer: SIGNER,
  })
  assert.equal(built.id, fx.source.id)
  assert.equal(Buffer.from(built.bytes).toString('hex'), fx.source.cbor)
})

// Two edges, so the order `V-EORDER` fixes — ascending by id(e), as byte strings — is
// exercised rather than assumed. Getting it wrong changes S(v) and so changes the id.
test('a claim with two edges matches ranke-go, edge order included', () => {
  const root = rootContributor()
  const contributor = contributorFrom(root.claim)
  const src = newClaim({
    type: 'source/register',
    contributor,
    content: {
      kind: 'inline',
      bytes: enc.encode('a parish register'),
      size: 17,
      encoding: 'text/plain',
    },
    fields: {
      title: 'Register of 1834',
      aa: 'length-first ordering',
      b: 'sorts before aa',
    },
    createdAt: AT_SOURCE,
    height: heightOf(root.claim),
    signer: SIGNER,
  })

  const built = newClaim({
    type: 'entity/person',
    contributor,
    edges: [{ reference: src.id, type: 'derivation/register' }],
    fields: { name: 'Anna Weber' },
    createdAt: AT_ENTITY,
    height: heightOf(root.claim, src.claim),
    signer: SIGNER,
  })
  assert.equal(built.id, fx.entity.id)
  assert.equal(Buffer.from(built.bytes).toString('hex'), fx.entity.cbor)
  // The edge order is part of S(v), so it must be ranke-go's and not insertion order.
  assert.deepEqual(
    built.claim.edges.map((e) => e.type),
    (fx.entity.edges ?? []).map((e) => e.type),
  )
})

// The claim a builder returns is the claim a decode of its own bytes yields, so a caller
// can store the bytes and read back what it built. The builder assembles that claim from
// the record it holds rather than parsing its own output, so this is where the two views
// are held to each other — one case per slot a record carries, since a slot no case fills
// is a slot where the builder's view and the wire's may drift apart unnoticed.
test('the claim returned is the claim its bytes decode to', () => {
  for (const { label, built } of equivalenceCases()) {
    const decoded = decodeClaim(built.bytes, built.id)
    assert.deepStrictEqual(built.claim, decoded, label)
    // deepStrictEqual takes an object's properties as a set, so it passes on a field map
    // holding the right entries in another order. A consumer serialising a claim sees
    // that order, and one built is the same claim as one read back.
    assert.equal(JSON.stringify(built.claim), JSON.stringify(decoded), `${label} (key order)`)
  }
})

function equivalenceCases(): Array<{ label: string; built: ReturnType<typeof newClaim> }> {
  const rootClaim = newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT })
  const contributor = contributorFrom(rootClaim.claim)
  const base = newClaim({ type: 'source/note', contributor, createdAt: AT_ROOT, height: 1 })
  const pubkey = Uint8Array.from(Buffer.from('ed01' + '33'.repeat(32), 'hex'))
  const external = fx.ids.scanHash! // the external content hash one fixture edge carries

  return [
    { label: 'a root contributor: no content, no fields, no edges, height 0', built: rootClaim },
    { label: 'a claim resting on a contributor', built: base },
    {
      label: 'inline content and fields whose keys pin the wire ordering',
      built: newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_NOTE,
        height: 1,
        content: { kind: 'inline', bytes: enc.encode('a note'), size: 6, encoding: 'text/plain' },
        fields: { b: 'sorts first', aa: 'sorts second', title: 'aliased', height: 'named like a slot' },
      }),
    },
    {
      label: 'external content, addressed and sized',
      built: newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_NOTE,
        height: 1,
        content: { kind: 'external', hash: external, size: 12, encoding: 'application/octet-stream' },
      }),
    },
    {
      label: 'inline content of no bytes, which the record leaves out',
      built: newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_NOTE,
        height: 1,
        content: { kind: 'inline', bytes: new Uint8Array(0), size: 0, encoding: 'text/plain' },
      }),
    },
    {
      label: 'an encoding subtype outside the alias table',
      built: newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_NOTE,
        height: 1,
        content: { kind: 'inline', bytes: enc.encode('{}'), size: 2, encoding: 'text/x-not-aliased' },
      }),
    },
    {
      label: 'every edge slot: a direction, own fields, inline and external content',
      built: newClaim({
        type: 'relation/family',
        contributor,
        createdAt: AT_DERIVED,
        height: 2,
        edges: [
          { reference: base.id, type: 'derivation/note' },
          {
            reference: base.id,
            type: 'relation/family',
            relationDirection: 1,
            fields: { name: 'parent', title: 'aliased' },
            content: { kind: 'inline', bytes: enc.encode('edge content'), size: 12, encoding: 'text/plain' },
          },
          {
            reference: rootClaim.id,
            type: 'relation/family',
            relationDirection: -1,
            content: { kind: 'external', hash: external, size: 12, encoding: 'application/octet-stream' },
          },
        ],
      }),
    },
    {
      label: 'a diff claim, which carries the diff edge as well as the contributor',
      built: newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_NOTE,
        height: 2,
        diffOf: base.id,
        edges: [{ reference: base.id, type: 'derivation/note', fields: { name: 'body' } }],
      }),
    },
    {
      label: 'a signed claim, whose id is a signature rather than a hash',
      built: newClaim({
        type: 'contribution/contributor',
        createdAt: AT_ROOT,
        content: { kind: 'inline', bytes: pubkey, size: pubkey.length, encoding: 'application/octet-stream' },
        signer: { pubkey, sign: () => new Uint8Array(64).fill(9) },
      }),
    },
    {
      label: 'a delete_by an edge takes from its target',
      built: newClaim({
        type: 'derivation/summary',
        contributor,
        createdAt: AT_DERIVED,
        height: 2,
        fields: { delete_by: '2030-01-01T00:00:00.000000000Z' },
        edges: [{ reference: base.id, type: 'derivation/note', referenced: base.claim }],
      }),
    },
  ]
}

// A build seals the envelope once and puts those bytes to both uses: hashing them for the
// id, and storing them as the claim. Hashing the stored record is what holds the two
// together — bytes stored other than the bytes hashed would name a claim its own record
// does not answer to. Every case answers now, `V-ID` being a hash whatever the signer.
test('the stored record holds the bytes the id was computed over', () => {
  for (const { label, built } of equivalenceCases()) {
    assert.equal(parseId(built.id).algorithm(), 'sha2-256', `${label}: an id is a hash`)
    assert.equal(hashContent(built.bytes).toString(), built.id, label)
  }
})

// The strings a record carries survive the wire only where the builder holds them to a
// charset and a canonical form, so each of these would otherwise be built into bytes
// that read back as something else.
test('a record slot the wire would render differently is refused', () => {
  const contributor = root()
  const source = (over: Partial<ClaimInput>) => () =>
    newClaim({ type: 'source/note', contributor, createdAt: AT_ROOT, height: 1, ...over })

  assert.throws(
    source({
      content: { kind: 'inline', bytes: enc.encode('x'), size: 1, encoding: '.t/plain' },
    }),
    RankeBuildError,
    'an encoding class opening with the alias prefix',
  )
  // A claim id would pass now, every id being a multihash (`V-ID`). A pubkey is the value
  // still framed another way, so it is what shows the check is looking.
  const pubkeyFramed = idFromBytes(
    Uint8Array.from(Buffer.from('ed01' + '00'.repeat(32), 'hex')),
  ).toString()
  assert.throws(
    source({ content: { kind: 'external', hash: pubkeyFramed, size: 3, encoding: 'text/plain' } }),
    RankeBuildError,
    'a content_hash framed as a pubkey rather than a multihash',
  )
  assert.throws(
    source({
      content: { kind: 'external', hash: fx.ids.scanHash!, size: 2 ** 60, encoding: 'text/plain' },
    }),
    RankeBuildError,
    'a content size beyond what a number holds exactly',
  )
  assert.throws(source({ height: 2 ** 60 }), RankeBuildError, 'a height beyond 2^53')
  assert.throws(source({ height: -1 }), RankeBuildError, 'a negative height')
  assert.throws(source({ fields: { title: '\ud800' } }), RankeBuildError, 'an unpaired surrogate')
})

// An id reaches a record in the form its own bytes render, so an edge names its target
// the way a reader of those bytes will see it. A payload whose length is a multiple of
// five has one base32 digit of room past its last byte, so it has a longer spelling too.
test('an edge reference is stored in canonical form', () => {
  const id = idFromBytes(new Uint8Array(35).fill(7)).toString()
  const longer = `${id}a` // one more digit, carrying padding bits alone
  assert.equal(newEdge({ reference: longer, type: 'derivation/note' }).reference, id)
})

// --- signing ---

test('a signer produces a multikey-framed id', () => {
  const pubkey = Uint8Array.from(Buffer.from('ed01' + '00'.repeat(32), 'hex'))
  const signature = new Uint8Array(64).fill(7)
  let signed: Uint8Array | null = null
  const built = newClaim({
    type: 'contribution/contributor',
    content: { kind: 'inline', bytes: pubkey, size: pubkey.length, encoding: 'application/octet-stream' },
    createdAt: AT_ROOT,
    signer: {
      pubkey,
      sign(message) {
        signed = message
        return signature
      },
    },
  })

  // What a signer is handed is the envelope's signing input, the `Sig_structure` of RFC
  // 9052 §4.4 (`V-SIGN`) — not a hash. A caller signs bytes and needs no COSE of its own.
  assert.ok(signed !== null)
  const message = signed as unknown as Uint8Array
  assert.deepEqual(
    Uint8Array.from(message.subarray(0, 12)),
    Uint8Array.from(Buffer.from('846a5369676e617475726531', 'hex')),
    'array(4), then the text "Signature1"',
  )

  // The id is a plain multihash over the stored envelope (`V-ID`), and the signature the
  // signer returned is inside those bytes rather than framing them.
  const id = parseId(built.id)
  assert.equal(id.algorithm(), 'sha2-256')
  assert.equal(id.rawBytes().length, 34, 'the multicodec, the length, the digest')
  assert.equal(hashContent(built.bytes).toString(), built.id)
  assert.deepEqual(
    Uint8Array.from(built.bytes.subarray(built.bytes.length - 64)),
    signature,
    'the envelope ends in the signature it was sealed with',
  )
})

test('a claim declaring a key refuses to identity-sign', () => {
  const pubkey = Uint8Array.from(Buffer.from('ed01' + '11'.repeat(32), 'hex'))
  assert.throws(
    () =>
      newClaim({
        type: 'contribution/contributor',
        content: {
          kind: 'inline',
          bytes: pubkey,
          size: pubkey.length,
          encoding: 'application/octet-stream',
        },
        createdAt: AT_ROOT,
      }),
    RankeBuildError,
  )
})

test('a signer whose key the claim does not declare is refused', () => {
  const declared = Uint8Array.from(Buffer.from('ed01' + '11'.repeat(32), 'hex'))
  const other = Uint8Array.from(Buffer.from('ed01' + '22'.repeat(32), 'hex'))
  assert.throws(
    () =>
      newClaim({
        type: 'contribution/contributor',
        content: {
          kind: 'inline',
          bytes: declared,
          size: declared.length,
          encoding: 'application/octet-stream',
        },
        createdAt: AT_ROOT,
        signer: { pubkey: other, sign: () => new Uint8Array(64) },
      }),
    RankeBuildError,
  )
})

// --- idempotency ---

// §Idempotency: identical claims produce identical ids, so writes are idempotent and
// deduplication is free. That holds only while a build draws on nothing but its input —
// no clock, no counter, and no randomness in whatever seals the claim. The property is
// load-bearing rather than incidental: an id is what a reference names, so a build that
// varied would mint a second name for one claim and break every reference to the first.
test('building the same claim twice yields the same bytes and id', () => {
  const contributor = root()
  const input = {
    type: 'source/note',
    contributor,
    createdAt: AT_NOTE,
    height: 1,
    fields: { title: 'a register', b: 'sorts before aa' },
    content: {
      kind: 'inline' as const,
      bytes: enc.encode('a parish register'),
      size: 17,
      encoding: 'text/plain',
    },
  }
  const first = newClaim(input)
  const second = newClaim(input)
  assert.equal(second.id, first.id, 'the id')
  assert.deepEqual(second.bytes, first.bytes, 'the stored bytes')
})

// The same over a claim carrying edges, where an ordering that depended on anything but
// the edges themselves would show: they are sorted by id, so two builds must agree on
// both the order and every id in it.
test('an edge-bearing claim is built identically twice', () => {
  const contributor = root()
  const target = newClaim({ type: 'source/note', contributor, createdAt: AT_ROOT, height: 1 })
  const input = {
    type: 'derivation/summary',
    contributor,
    createdAt: AT_DERIVED,
    height: 2,
    edges: [
      { reference: target.id, type: 'derivation/note', fields: { name: 'source' } },
      { reference: target.id, type: 'derivation/scan', fields: { name: 'scan' } },
    ],
  }
  const first = newClaim(input)
  const second = newClaim(input)
  assert.equal(second.id, first.id, 'the id')
  assert.deepEqual(second.bytes, first.bytes, 'the stored bytes')
  assert.deepEqual(
    second.claim.edges.map((e) => e.reference),
    first.claim.edges.map((e) => e.reference),
    'the edge order',
  )
})

// The bound on the two above: a build that ignored its input would pass them both. One
// field apart is one claim apart, and the ids must differ.
test('a claim differing in one field gets a different id', () => {
  const contributor = root()
  const base = { type: 'source/note', contributor, createdAt: AT_NOTE, height: 1 }
  const plain = newClaim(base)
  const titled = newClaim({ ...base, fields: { title: 'a register' } })
  const later = newClaim({ ...base, createdAt: AT_DERIVED })
  assert.notEqual(titled.id, plain.id, 'a field changes the id')
  assert.notEqual(later.id, plain.id, 'a timestamp changes the id')
})

// --- the rules ---

function root() {
  return contributorFrom(newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT }).claim)
}

test('a claim other than a root contributor states a contributor', () => {
  assert.throws(() => newClaim({ type: 'source/note', createdAt: AT_ROOT }), RankeBuildError)
})

// A derivation, entity or relation claim once had to carry a derivation/* edge, and the
// spec has retired the rule. The ADT rules are the definition of valid, so a claim with
// no provenance edge is admitted — the builder refusing it would refuse a valid claim.
test('a claim with no provenance edge is admitted', () => {
  for (const type of ['derivation/summary', 'entity/person', 'relation/family', 'source/note']) {
    const built = newClaim({ type, contributor: root(), createdAt: AT_ROOT, height: 1 })
    assert.equal(built.claim.type, type)
    assert.equal(
      built.claim.edges.filter((e) => e.typeClass === 'derivation').length,
      0,
      `${type} carries no derivation edge`,
    )
  }
})

test('content and its encoding travel together', () => {
  const contributor = root()
  assert.throws(
    () =>
      newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_ROOT,
        height: 1,
        content: { kind: 'inline', bytes: enc.encode('x'), size: 1, encoding: '' },
      }),
    RankeBuildError,
    'content without an encoding',
  )
  assert.throws(
    () =>
      newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_ROOT,
        height: 1,
        content: { kind: 'inline', bytes: enc.encode('xyz'), size: 99, encoding: 'text/plain' },
      }),
    RankeBuildError,
    'a size that is not the bytes carried',
  )
})

test('an unknown class is refused', () => {
  assert.throws(() => newClaim({ type: 'nonsense/x', createdAt: AT_ROOT }), RankeBuildError)
  assert.throws(() => newEdge({ reference: fx.ids.source!, type: 'source/x' }), RankeBuildError)
})

test('a relation edge states its direction, and nothing else may', () => {
  assert.throws(
    () => newEdge({ reference: fx.ids.source!, type: 'relation/family' }),
    RankeBuildError,
    'a relation edge with no direction',
  )
  assert.throws(
    () => newEdge({ reference: fx.ids.source!, type: 'derivation/note', relationDirection: 1 }),
    RankeBuildError,
    'a direction outside relation/*',
  )
  newEdge({ reference: fx.ids.source!, type: 'relation/family', relationDirection: -1 })
})

// `R-DSTRUCT` names four subtypes, each being what another rule reads: a contributor's
// pubkey (`V-SIG`), the chain to the initial table (`V-ARCHIVE`), a gap's explanation
// (`R-DGAP`), a key's window (`R-DEXPIRY`).
test('the four structural subtypes take no delete_by', () => {
  for (const sub of ['contributor', 'branches', 'delete', 'expiry']) {
    assert.throws(
      () =>
        newClaim({
          type: `contribution/${sub}`,
          contributor: root(),
          createdAt: AT_ROOT,
          height: 1,
          fields: { delete_by: '2030-01-01T00:00:00.000000000Z' },
        }),
      RankeBuildError,
      sub,
    )
  }
})

// The bound on the rule above: a contribution subtype is open vocabulary (`V-TYPE`), so
// an application's own may schedule its removal like any other claim. Refusing by class
// made every contribution/* undeletable, which `R-DSTRUCT` does not say.
test('an open contribution subtype may schedule its deletion', () => {
  const built = newClaim({
    type: 'contribution/annotation',
    contributor: root(),
    createdAt: AT_ROOT,
    height: 1,
    fields: { delete_by: '2030-01-01T00:00:00.000000000Z' },
  })
  assert.equal(built.claim.fields.delete_by, '2030-01-01T00:00:00.000000000Z')
})

// `R-DPLANNED`: the target's schedule travels with the reference, so an edge takes it from
// the claim it names.
test('an edge carries its target delete_by', () => {
  const contributor = root()
  const scheduled = newClaim({
    type: 'source/note',
    contributor,
    createdAt: AT_ROOT,
    height: 1,
    fields: { delete_by: '2030-01-01T00:00:00.000000000Z' },
  })
  const e = newEdge({
    reference: scheduled.id,
    type: 'derivation/note',
    referenced: scheduled.claim,
  })
  assert.equal(e.fields?.delete_by, '2030-01-01T00:00:00.000000000Z')
})

test('a diff claim names every edge beyond the singletons', () => {
  const contributor = root()
  const base = newClaim({ type: 'source/note', contributor, createdAt: AT_ROOT, height: 1 })
  assert.throws(
    () =>
      newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_NOTE,
        height: 2,
        diffOf: base.id,
        edges: [{ reference: base.id, type: 'derivation/note' }],
      }),
    RankeBuildError,
    'an unnamed edge on a diff claim',
  )
  newClaim({
    type: 'source/note',
    contributor,
    createdAt: AT_NOTE,
    height: 2,
    diffOf: base.id,
    edges: [{ reference: base.id, type: 'derivation/note', fields: { name: 'body' } }],
  })
})

test('a claim carries one contributor edge', () => {
  const contributor = root()
  assert.throws(
    () =>
      newClaim({
        type: 'source/note',
        contributor,
        createdAt: AT_ROOT,
        height: 1,
        edges: [{ reference: contributor.id, type: 'contribution/contributor' }],
      }),
    RankeBuildError,
  )
})

test('an invalid field name is refused', () => {
  assert.throws(
    () => newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT, fields: { Upper: 'x' } }),
    RankeBuildError,
  )
})

// `dated` denotes an interval rather than an instant (`V-DATED`), so — unlike createdAt — a
// value wider than a bare RFC 3339 timestamp is admitted, and the claim keeps it as given.
test('dated is EDTF or an RFC 3339 instant, and travels through unchanged', () => {
  const contributor = root()
  const { claim } = newClaim({
    type: 'source/note',
    contributor,
    createdAt: AT_SOURCE,
    dated: '2014-06-15T09:30:00+02:00',
  })
  assert.equal(claim.dated, '2014-06-15T09:30:00+02:00')

  const undated = newClaim({ type: 'source/note', contributor, createdAt: AT_SOURCE }).claim
  assert.equal(undated.dated, undefined, 'absence is no violation — dated is optional')

  assert.throws(
    () => newClaim({ type: 'source/note', contributor, createdAt: AT_SOURCE, dated: 'whenever' }),
    RankeBuildError,
  )
})

// --- helpers ---

test('heightOf is one above the highest it cites', () => {
  const a = newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT }).claim
  assert.equal(heightOf(), 0)
  assert.equal(heightOf(a), 1)
})

test('edgeIdOf is H(S(e))', () => {
  const e = newEdge({ reference: fx.ids.source!, type: 'derivation/note' })
  assert.equal(parseId(edgeIdOf(e)).algorithm(), 'sha2-256', 'an edge id is a hash, never a signature')
  // The claim that carries it reports the same id, so the two paths agree.
  const built = newClaim({
    type: 'derivation/note',
    contributor: root(),
    createdAt: AT_ROOT,
    height: 2,
    edges: [{ reference: fx.ids.source!, type: 'derivation/note' }],
  })
  const carried = decodeClaim(built.bytes, built.id, { edgeIds: true }).edges.find(
    (x) => x.reference === fx.ids.source,
  )
  assert.equal(carried?.id, edgeIdOf(e))
})

test('normalizeCreatedAt holds the canonical timestamp form', () => {
  assert.equal(normalizeCreatedAt(new Date('2026-01-02T03:04:05.123Z')), '2026-01-02T03:04:05.123000000Z')
  assert.equal(normalizeCreatedAt(AT_ROOT), AT_ROOT)
  assert.throws(() => normalizeCreatedAt('2026-01-02T03:04:05Z'), RankeBuildError)
  assert.throws(() => normalizeCreatedAt('2026-01-02T03:04:05.123Z'), RankeBuildError)
})

// A mock graph is what this exists for: a keyless contributor and claims resting on
// each other, every id being the hash of what it contains.
test('a mock graph builds and reads back', () => {
  const rootClaim = newClaim({ type: 'contribution/contributor', createdAt: AT_ROOT })
  const contributor = contributorFrom(rootClaim.claim)
  const sources = [0, 1, 2].map((i) =>
    newClaim({
      type: 'source/note',
      contributor,
      createdAt: AT_NOTE,
      height: 1,
      fields: { title: `note ${i}` },
    }),
  )
  const summary = newClaim({
    type: 'derivation/summary',
    contributor,
    createdAt: AT_DERIVED,
    height: 2,
    edges: sources.map((s) => ({ reference: s.id, type: 'derivation/note' })),
  })

  assert.equal(new Set(sources.map((s) => s.id)).size, 3, 'distinct claims get distinct ids')
  assert.equal(summary.claim.edges.length, 4, 'three sources plus the contributor')
  assert.equal(summary.claim.height, 2)
  for (const s of sources) {
    assert.ok(summary.claim.edges.some((e) => e.reference === s.id))
  }
})

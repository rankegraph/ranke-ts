# ranke-ts

TypeScript reader for the **Ranke-Graph** ADT (spec §4) — a content-addressed,
provenance-carrying graph of attributed claims.

The project home, papers, and cross-language conformance suite live at
[github.com/flocko-motion/ranke-graph](https://github.com/flocko-motion/ranke-graph).
[ranke-go](https://github.com/flocko-motion/ranke-go) is the reference
implementation; this repository mirrors the part of it a browser needs, file for
file and name for name, so the two can be read side by side.

## Scope

- decode the canonical CBOR of a claim into its node, edges, fields and content
- decode the JSON projection, arriving at the same claim
- read a result run as it streams — cbor-seq (RFC 8742) and json-seq (RFC 7464) —
  whichever `output.detail` asked for: claims, ids, or routes of ids
- build claims, encoding them to the bytes ranke-go encodes them to
- build, check and encode a RankeQL query
- the closed type vocabularies and the wire alias tables
- ids: the SHA2-256 multihash framing and the multibase string form

It holds no private keys and stores nothing. Two further omissions are
deliberate:

- **Diff materialisation** stays server-side. A `contribution/diff` claim
  carries a delta, and resolving it means walking the chain — work a server
  does once for every reader.
- **Query execution** is RankeDB's. A client sends queries, so the `Query` type,
  its encoder and its shape checks belong here; answering one needs the graph and
  a planner, which do not.

## Building claims

`newClaim` assembles a claim and computes its id over the canonical bytes — the
same bytes ranke-go produces, which the tests assert byte for byte.

```ts
import { contributorFrom, heightOf, newClaim } from '@flocko-motion/ranke'

const root = newClaim({ type: 'contribution/contributor', createdAt: at })
const alice = contributorFrom(root.claim)

const note = newClaim({
  type: 'source/note',
  contributor: alice,
  content: { kind: 'inline', bytes, size: bytes.length, encoding: 'text/plain' },
  fields: { title: 'a note' },
  height: heightOf(root.claim),
  createdAt: at,
})

note.id      // "bciq…" — H(S(v)), since nothing signed it
note.bytes   // exactly what the id commits to
note.claim   // the same claim a decode of those bytes yields
```

Two claims above are **identity-signed**: with no key involved the id is the hash
itself, which §5.7 admits wherever the contributor publishes none. That is what a
mock graph wants, and it is also the only case a keyless library can reproduce
whole — which is how the builder is tested against ranke-go.

**A key stays with the application.** Pass a `signer` and the library never sees
it:

```ts
const signed = newClaim({
  type: 'contribution/contributor',
  content: { kind: 'inline', bytes: pubkey, size: pubkey.length, encoding: 'application/octet-stream' },
  createdAt: at,
  signer: { pubkey, sign: (message) => /* Ed25519 over these 34 bytes */ },
})
```

The message handed to `sign` is the 34-byte SHA2-256 **multihash** of S(v), not
the bare digest — that is what ranke-go signs, so a WebCrypto caller must pass
those bytes through unchanged.

The builder enforces what construction can: the type vocabularies, the
inline-or-addressed content rule with its mandatory encoding, the §3.5 provenance
invariant, one contributor edge and one diff edge, named edges on a diff claim,
the canonical edge order, R-DPLANNED on an edge whose target is scheduled, and that a
claim declaring a key cannot identity-sign.

## Queries

`Query` is generated from ranke-graph's released `rql.schema.json` — the same
document ranke-go implements and ranke-db's `openapi.yaml` references — so
TypeScript holds no second copy of the read language.

```ts
import { EncodeQuery, ValidateQuery, type Query } from '@flocko-motion/ranke'

const q: Query = {
  select: { branch: 'project_x', path: [{ edges: ['derivation/*'], max: 3 }] },
  where: { field: 'type', test: { glob: 'source/*' } },
  output: { encoding: 'cbor' },
  limit: { results: 200, time: '5s' },
}

const body = EncodeQuery(q) // validates, then renders the canonical JSON
```

`ValidateQuery` applies the same rules ranke-go does, so both reach one verdict,
and a `RankeQueryError` carries the `code` of the rule broken — `ErrQueryHops`,
`ErrQueryWhereForm`, and the rest, named as ranke-go names them. Two of those
rules ranke-go enforces when a read runs; catching them here saves the round trip
the server would spend refusing.

It checks shape as well as meaning. TypeScript's excess-property check fires only
on an object literal in a typed slot, so a query from `JSON.parse`, a URL
parameter or a form arrives unchecked — and a plain-JavaScript caller has no
checking at all. An unrecognised key or a value of the wrong kind is therefore a
refusal here, matching what ranke-go's decoder rejects, and the error names the
path:

```
ErrQueryUnknownField  select.path[0].hops: unknown key; this block admits edges, dir, min, max, nodes
ErrQueryType          limit.results: expected a whole number, got string "5"
```

Three values exist on ranke-go's side and not on the wire: `output.encoding`
`native`, and `execution.report` `error` and `warn`. The schema excludes all
three, so the generated type refuses them without a rule of its own.

## Install

```sh
npm install @flocko-motion/ranke
```

## A decoded claim is plain data

Decoding hands back a frozen data object, not an instance with accessors:

```ts
const claim = decodeClaim(bytes, id)

claim.id                  // "b5uawx4g…" — a string
claim.type                // "source/register"
claim.fields.title        // the claim's own fields, by name
claim.edges[0].reference  // also a string
claim.edges[0].fields.name
claim.createdAt           // "2026-01-01T00:00:00.000000000Z"
claim.createdAtMs         // 1767225600000, for sorting
```

Three consequences worth knowing:

**Ids are strings on a claim, and on an edge's `reference`.** They are used as
graph node keys and `Map` keys, at a few hundred thousand at a time, where peak
heap decides throughput. `Id` remains the type for parsing, framing and
`algorithm()` — reach for `parseId(claim.id)` when you want the payload rather
than the name.

**`created_at` comes back twice.** The RFC 3339 string is the value of record,
because the claim's id commits to it and a JavaScript `Date` cannot hold its
nanoseconds. `createdAtMs` is the lossy convenience for sorting and display.

**Fields are a plain record, keyed as the taxonomy names them.** The wire
aliases are resolved during decoding, so `.n` has already become `name`.

This is the one place the library departs from mirroring ranke-go, whose
`Claim`, `Node` and `Edge` are interfaces with methods. Go needs an interface to
seal a struct; TypeScript gets the same guarantee from `readonly` at no runtime
cost, and an object per accessor is a cost a browser pays for nothing.

## Record keys

A claim serializes as a CBOR map under the numeric keys `V-SER` fixes, and a tool
rendering those bytes needs them by name. `record_keys.ts` exports the table:

```ts
import { NodeRecordKeys, EdgeRecordKeys, recordKeyName } from '@flocko-motion/ranke'

NodeRecordKeys.get(9)            // "created_at"
NodeRecordKeys.get(6)            // "content"
EdgeRecordKeys.get(12)           // "reference"
recordKeyName('node', 12)        // undefined — 12 is an edge slot
recordKeyName('edge', 14)        // undefined — no such slot yet
```

Keys 1 to 8 are the slots a node and an edge share, so one number means one thing
in either record; a node then takes 9 to 11 and an edge 12 to 13. An unassigned
number has no name, so a reader shows it as the number rather than guessing.

The codec reads these same constants, which is what makes the exported table the
one a decode uses. Never transcribe it: a second copy of the numbering is free to
drift from the encoder, and an id is computed over the encoded bytes.

## Design

**Zero runtime dependencies.** Everything ships in the package, including
SHA-256, so a browser pulls no supply chain to read a claim.

**Streaming is the primary path.** A result run is thousands of records arriving
over a `ReadableStream`, so the sequence readers (cbor-seq, json-seq) yield them
as bytes land and a whole-buffer `decodeClaim` is the special case. A reader
distinguishes an incomplete record, where it waits for the next chunk, from a
malformed one, where it stops.

**A record is not always a claim.** `output.detail` and `output.shape` decide what
one carries, so pick the reader for what you asked for:

```ts
readClaims(body, 'cbor')   // detail: claims | graph
readIds(body)              // detail: id — a bare id per record, or a route per record
readRecords(body, 'json')  // any detail: each record tagged by kind
readRawRecords(body, 'json') // the framing alone, for a payload this library
                             // does not yet name
```

`readRecords` yields `claim`, `claim_id`, `path_id` or `report` — the kinds of
ranke-go's `ResultKind`. A run with `execution.report` set appends one report
record after the last result, which `readClaims` passes over and `readRecords`
hands you.

**Synchronous throughout.** `crypto.subtle` would make every digest a promise
and every decode async; a hand-rolled digest keeps one code path across
browsers, Node, Deno and workers.

**Types are erased, so decoding validates.** Bytes from a server are untrusted
and an interface guarantees nothing at run time. The decoder checks CBOR
canonicity, the closed vocabularies, and the inline/external content rule
itself; the types sit on top as a convenience.

**The alias tables are normative.** Ids are computed over the aliased bytes, so
an entry that differs from ranke-go's gives one claim two encodings.

**Reference data is generated, never transcribed.** ranke-go is the reference
implementation, so its output is the specification rather than a sample of it.
`tools/` holds Go programs that emit it — claims in both encodings, Go's
`path.Match` over 476 pattern/name pairs, and ranke-go's verdict on 43 queries.
Each records the ranke-go release it came from, and the suite refuses a set that
names no release. A hand-copied fixture is one nibble from testing the wrong
thing, which is how this rule was learnt.

**Conformance runs against the published set.** ranke-graph releases
`ranke-testdata.tar.gz`, whose manifest names 14 claim cases and 2 content blobs
and what each must do. The suite fetches it and holds this library to it, so
conformance is measured against the spec's artifact rather than against agreement
with a sibling. Thirteen of the sixteen are decidable without a key: every valid
decode, a malformed id, a height that does not follow, a reference that resolves
nowhere, an identity Sign whose signer publishes a key, and both blobs against
the hash they are filed under. The three that turn on a signature are named
individually in the test, so a case becoming undecidable for a new reason fails
rather than passes quietly. Set `RANKE_TESTDATA_DIR` to work offline.

## Development

Node 22 or newer. Node runs the TypeScript sources directly by stripping types,
so the tests need no build step.

```sh
make docs       # fetch the papers and the spec — run this first
make install
make test       # with a floor: node --test exits 0 on an empty glob
make typecheck  # sources and tests
make build      # emit dist/ with .d.ts
make verify     # the four above, as a release must pass them
```

`make docs` comes first because `verify` runs `scripts/rule-citations.sh`, which reads
the spec from `docs/papers/` — gitignored, so a bare checkout fails the gate rather than
passing blind. The gate holds every rule id a comment cites to one the spec declares, and
every declared rule to either a citation or a line in `scripts/rule-citations.allow`
saying why it has none. It says nothing about whether a citation is *true*; a text
comparison cannot. `R-DELBY` sat at five sites and `R-QHOPS` at one, each spelled
consistently and naming no rule at all, which is what the gate exists to catch.

`tsconfig.json` sets `erasableSyntaxOnly`, which holds the source to the subset
Node can strip: no `enum`, no `namespace`, no parameter properties. String
unions stand in for enums, which also keeps the emitted values identical to
ranke-go's constants.

`make bench` prints a performance baseline: microseconds per claim for a build
broken down by stage, and bytes and peak RSS for a decode. It asserts nothing and
stays out of `verify`, since a host that swings by a quarter between two runs of one
build would fail a timing assertion at random. Each run names the ranke-go release it
was measured against, and prints beside its own figures a recorded pair taken on one
host with `src/id.ts` flattened and not — so the ids a decode holds have a measured
cost, and a run says which way the numbers went.

```sh
make bench                              # 20000 iterations over 2000 claims
make bench ITERATIONS=2000 CLAIMS=1000  # a quicker look
```

Two steps need a toolchain beyond npm, so both are deliberate rather than part of
`verify`:

```sh
make fixtures         # regenerate the reference data (needs Go)
make pull-rql-schema  # take ranke-graph's released RQL schema
make generate         # regenerate src/query.ts from the committed schema
```

Taking a new ranke-go release means bumping `tools/go.mod` and running
`make fixtures`; a test then fails wherever the two implementations moved apart.

`package.json` carries `0.0.0` in the tree, and the git tag carries the version.
The release workflow stamps the tag's number into the package immediately before
it publishes — `.github/workflows/release.yml`, the "Set version from the tag"
step — so npm receives the right number and no commit has to be cut to bump it.
The tag is therefore the one place a version lives, as in ranke-go and
ranke-graph, where a module version is its tag. JSON takes no comments, so this
note stands in for one.

```sh
make version  # the latest release tag, which is the version this tree answers to
```

## Licence

Apache 2.0. See [LICENSE](LICENSE).

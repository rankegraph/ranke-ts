# Requirements for new Agents

Run `make docs` FIRST, then read `docs/papers/*`. That's the precondition to do
anything in this repo.

Run it even when `docs/papers/` is already there. The directory is gitignored, so
whatever it holds came from some earlier fetch and carries no date you can see: it
reads exactly like a current copy at any age. Fetching costs one command, and an
answer given against a stale spec is worth nothing. An agent has already audited
this library's rule citations against a copy it found rather than fetched.

When starting to plan a change, *always RE-read* the relevant sections in the docs.
Agents tend to forget details from the papers. The papers specify all details, so no
guessing required.

`make verify` runs `scripts/rule-citations.sh`, which needs the fetched spec and
fails without it — so a bare checkout cannot pass the gate blind.

# ranke-go is the reference

`../ranke-go` is the reference implementation. This library mirrors it: same
filenames, same identifiers, same order within a file. Read the Go file before
writing or changing the TypeScript one, and cite it as `file.go:line`.

Where the two must differ, the divergence is stated in a comment at the point it
happens. Those that exist so far:

- **A decoded claim is plain data**, with string ids and a plain field record,
  where ranke-go's `Claim`/`Node`/`Edge` are interfaces with methods. Go needs an
  interface to seal a struct; `readonly` does it here for free, and a browser
  holding 300k claims pays for every accessor object. See README.md.
- Closed vocabularies are string unions here, where Go uses a named string type
  plus a separate validator.
- `internal/sha256.ts` and `internal/cbor.ts` have no Go counterpart: ranke-go
  takes both from libraries (multiformats, fxamacker/cbor).
- The CBOR reader tells an incomplete record from a malformed one, which a
  browser stream needs and a Go `io.Reader` gets from `io.ErrUnexpectedEOF`.

# Scope

Reading claims a server served, building claims, and building the queries that ask
for them. No key material, no storage, no diff materialisation, no query
*execution* — see README.md for why each is out.

Signing is injected: a `Signer` turns the 34-byte multihash of S(v) into a
signature, so an application's key never enters this library. Without one a claim
is identity-signed, which §5.7 admits wherever the contributor publishes no key.

A client sends queries, so the RankeQL `Query` type, its encoder and its shape
checks belong here; executing one needs the graph and is RankeDB's. Mirror
`query.go` and `query_codec.go` (minus `DecodeQuery` — nothing browser-side
receives a query), never `query_default.go`.

`src/query.ts` is GENERATED from the committed `schema/rql.schema.json` — never
edit it. `make pull-rql-schema` takes a new release, `make generate` regenerates,
and `make check-generated` refuses a release where the two drifted apart. A
transcribed copy would give TypeScript its own version of the read language.

A feature that would hold key material or reach a store does not belong here.

The encoder must produce ranke-go's bytes exactly: an id is computed over them, so
one byte apart is a different claim. `codec_encode_test.ts` re-encodes every fixture
and compares against `nodePreimage` of ranke-go's own output, which needs no key;
`claim_builder_test.ts` rebuilds the identity-signed fixtures and compares ids.
Never change the encoder without those passing.

# The alias tables are normative

Ids are computed over the aliased bytes. An entry differing from ranke-go's gives
one claim two encodings, which no test downstream can repair. Never re-map an
existing entry; append only.

# Tooling

- `npm test` — `node --test`, which runs the `.ts` sources directly
- `npm run typecheck` — covers sources *and* tests; `npm run build` emits only what ships
- `use brokkr instead of grep` (brokkr --help), same as in ranke-go
- No `sed` and no python for editing files. Manual edits.
- No compound shell commands — one command per call, so a failure is legible.

# Writing code

- Comments are short. Two lines is already long; a 10-line block is wrong.
  Say why, not what.
- Say what a thing IS, not what it is not.
- No `enum`, no `namespace`, no parameter properties: `erasableSyntaxOnly` holds
  the source to what Node can strip, so tests need no build step.
- String unions over enums, so the emitted values match ranke-go's constants.

# Tests

- A test must not do the system's work for it. If a test calls the thing that
  production forgets to call, the test passes and reality fails.
- Prefer an **oracle** to a fixture. `node:crypto` is the oracle for SHA-256;
  ranke-go is the oracle for ids, encodings, type globs and query verdicts.
- **Never transcribe reference data by hand.** `tools/` holds Go programs that
  emit it and `make fixtures` runs them. A hand-copied record is one nibble from
  testing the wrong thing; that is how this rule was learnt, and the same day a
  hand-written glob matcher shipped an infinite loop that the generated
  `path.Match` table caught at once.
- An artifact must trace to a **released** ranke-go, never a working copy, and the
  version is recorded in the file. `tools/go.mod` therefore carries no `replace`
  and no `go.work`: take new behaviour by releasing ranke-go and bumping the
  requirement.
- `vectors_test.ts` runs ranke-graph's reference claims, which are the spec's artifact
  and the only reference data here with cases that must be REFUSED. Agreement on
  what to accept says nothing about what a reader lets through. A case this
  library cannot decide is named individually, never skipped by category.
  They come from the clone `make spec` takes, beside the spec itself, so the rules and
  the claims exercising them are always from one moment. Sourcing them from a release
  let the two drift, and a changed spec that ought to break this library passed.
- An unreachable artifact set is a failure, not a skip: silently not checking
  conformance is the one outcome worse than a red run.

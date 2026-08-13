import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

import type { Query } from './query.ts'
import { EncodeQuery, RankeQueryError, ValidateQuery } from './query_codec.ts'

// query_oracle.json holds ranke-go's verdict on each query, given as the canonical
// JSON both implementations read. ranke-go is the reference implementation, so this
// is the specification of the validator: where the two differ, ranke-ts is wrong.
interface Verdict {
  label: string
  query: unknown
  accepted: boolean
  code?: string
  /** Every sentinel ranke-go's errors.Is matches, since one condition may answer to two. */
  codes?: string[]
  detail?: string
}

interface OracleFile {
  note: string
  rankeGo: string
  verdicts: Verdict[]
}

const oracle: OracleFile = JSON.parse(
  readFileSync(new URL('./testing/query_oracle.json', import.meta.url), 'utf8'),
)

// The table is generated from a list in tools/queryoracle, so its size is pinned
// rather than floored: a floor would let cases be deleted without anything noticing,
// and a case removed is coverage removed.
const CASES = 66
const REFUSALS = 41

test('the oracle comes from a released ranke-go and is whole', () => {
  assert.match(oracle.rankeGo, /^v\d+\.\d+\.\d+$/, 'a released version, not a substituted path')
  assert.equal(oracle.verdicts.length, CASES, 'update CASES when adding a case, deliberately')
  assert.equal(oracle.verdicts.filter((v) => !v.accepted).length, REFUSALS)

  // ranke-go once clamped a negative min instead of refusing it, and this library
  // inherited that. The case keeps the gap shut in both.
  const negative = oracle.verdicts.find((v) => v.label === 'a negative min')
  assert.ok(negative !== undefined, 'the negative-hops case is missing from the oracle')
  assert.equal(
    negative.accepted,
    false,
    `ranke-go ${oracle.rankeGo} accepts a negative min, so it predates the hops fix — ` +
      'release ranke-go, bump tools/go.mod, and rerun scripts/fixtures.sh',
  )
})

// The rule ranke-go enforces when a read runs (archive.go validateSelect) rather than
// in ValidateQuery, which the oracle calls. ranke-ts folds it in, since a client that
// catches it saves the round trip the server would spend refusing.
const READ_TIME_RULES = new Set(['ErrQueryScanShape'])

// The verdict a client cares about: would the server take this query. Disagreeing
// either way is a defect — accepting what ranke-go refuses wastes a round trip, and
// refusing what it accepts makes a legal query unsendable.
test('ValidateQuery agrees with ranke-go on every case', () => {
  const disagreements: string[] = []
  for (const v of oracle.verdicts) {
    let refusal: RankeQueryError | null = null
    try {
      ValidateQuery(v.query as Query)
    } catch (err) {
      if (!(err instanceof RankeQueryError)) throw err
      refusal = err
    }
    const accepted = refusal === null
    if (accepted === v.accepted) continue
    // Refusing early under a read-time rule is the intended strictness; anything else
    // is a divergence.
    if (v.accepted && refusal !== null && READ_TIME_RULES.has(refusal.code)) continue
    disagreements.push(
      `${v.label}: ranke-go ${v.accepted ? 'accepted' : 'refused'}, ranke-ts ` +
        `${accepted ? 'accepted' : `refused (${refusal?.code})`}`,
    )
  }
  assert.deepEqual(disagreements, [])
})

// The fold is deliberate, so the read-time rule must actually fire on the case that
// breaks it — which is what keeps the escape hatch above from widening.
test('the read-time scan rule is caught before sending', () => {
  const scan = '{"select":{"branch":"main"},"output":{"shape":"path"}}'
  try {
    ValidateQuery(JSON.parse(scan) as Query)
    assert.fail(`expected ErrQueryScanShape for ${scan}`)
  } catch (err) {
    assert.ok(err instanceof RankeQueryError)
    assert.equal(err.code, 'ErrQueryScanShape')
  }
  // A path makes the route explicit, so the rule does not apply.
  ValidateQuery({ select: { branch: 'main', path: [{}] }, output: { shape: 'path' } })
})

// A path-less claim anchors the frontier the closure is taken from (`R-QANCHOR`), so it is
// a read of what one claim reaches. ranke-go once refused it as a traversal with no
// start, and this library inherited that; the case keeps the refusal from returning.
test('a path-less claim is a legal read', () => {
  const anchored: Query = {
    select: { branch: 'main', claim: 'bciqlu6awx6hqdt7kifaubxs5vyrchmadmgrzmf32ts2bb73b6iablli' },
  }
  ValidateQuery(anchored)
})

// Where ranke-go named the rule, ranke-ts must name the same one: a client switching
// on the code needs one vocabulary, not two that happen to overlap.
test('a refusal names the same rule ranke-go names', () => {
  const mismatches: string[] = []
  for (const v of oracle.verdicts) {
    if (v.accepted || v.code === undefined || v.code === '') continue
    try {
      ValidateQuery(v.query as Query)
      continue // the accept/refuse test above reports this
    } catch (err) {
      if (!(err instanceof RankeQueryError)) throw err
      if (err.code !== v.code) {
        mismatches.push(`${v.label}: ranke-go ${v.code}, ranke-ts ${err.code}`)
      }
    }
  }
  assert.deepEqual(mismatches, [])
})

// A condition two rules both name answers to both, so the whole matching set is
// compared. Comparing only the first would let one side drop the second rule and
// still pass, which is the pairing going unnoticed.
test('a refusal answers to every rule ranke-go matches', () => {
  const mismatches: string[] = []
  for (const v of oracle.verdicts) {
    if (v.accepted || v.codes === undefined || v.codes.length === 0) continue
    try {
      ValidateQuery(v.query as Query)
      continue
    } catch (err) {
      if (!(err instanceof RankeQueryError)) throw err
      const got = [...err.codes].sort()
      const want = [...v.codes].sort()
      if (got.join(',') !== want.join(',')) {
        mismatches.push(`${v.label}: ranke-go [${want}], ranke-ts [${got}]`)
      }
      for (const code of v.codes) {
        assert.ok(err.is(code as never), `${v.label}: is(${code})`)
      }
    }
  }
  assert.deepEqual(mismatches, [])
})

// The two cases ranke-go refuses while decoding rather than validating, so its
// sentinel table does not classify them. ranke-ts has no decode step, so it must
// catch both in the validator or let a bad query through.
test('the unclassified refusals are still caught', () => {
  for (const v of oracle.verdicts) {
    if (v.accepted || (v.code !== undefined && v.code !== '')) continue
    assert.throws(() => ValidateQuery(v.query as Query), RankeQueryError, v.label)
  }
})

// --- EncodeQuery ---

const MINIMAL: Query = { select: { branch: 'main' } }

test('EncodeQuery renders the canonical JSON', () => {
  assert.equal(EncodeQuery(MINIMAL), '{"select":{"branch":"main"}}')
})

test('EncodeQuery validates before it renders', () => {
  assert.throws(() => EncodeQuery({ select: { branch: '' } }), RankeQueryError)
  assert.throws(
    () => EncodeQuery({ select: { branch: 'main', path: [{ min: 3, max: 2 }] } }),
    RankeQueryError,
  )
})

// An absent field stays absent: every default is stated in the schema, so what a
// caller's silence becomes is the server's to decide.
test('EncodeQuery keeps an omitted field omitted', () => {
  const encoded = JSON.parse(EncodeQuery(MINIMAL)) as Record<string, unknown>
  assert.deepEqual(Object.keys(encoded), ['select'])
})

// An empty array or object says nothing a missing key does not, and a wire read by a
// machine treats the two alike.
test('EncodeQuery drops empty containers', () => {
  const encoded = EncodeQuery({ select: { branch: 'main', path: [] }, order: [] })
  assert.equal(encoded, '{"select":{"branch":"main"}}')
})

// An explicit empty `in` set is an operator, not an empty container: dropping it
// would turn a valid comparison into one with no operator at all.
test('EncodeQuery keeps an explicit empty in set', () => {
  const q: Query = { select: { branch: 'main' }, where: { field: 'a', test: { in: [] } } }
  const back = JSON.parse(EncodeQuery(q)) as { where: { test: Record<string, unknown> } }
  assert.ok('in' in back.where.test, 'the operator survives')
})

test('EncodeQuery round-trips a query with every block set', () => {
  const q: Query = {
    select: {
      branch: '$universe',
      head: 'bciqlu6awx6hqdt7kifaubxs5vyrchmadmgrzmf32ts2bb73b6iablli',
      path: [{ edges: ['derivation/*'], dir: 'uses', min: 0, max: 3, nodes: ['source/*'] }],
    },
    where: { or: [{ field: 'height', test: { ge: 2 } }, { not: { field: 'a', test: { glob: 'x*' } } }] },
    output: {
      shape: 'path',
      detail: 'claims',
      form: 'original',
      encoding: 'cbor',
      content: { max: 4096, overflow: 'cutoff' },
    },
    order: [{ field: 'height', compare: 'numeric', dir: 'desc' }],
    limit: { results: 100, time: '5s' },
    execution: { layer: 'neo4j', report: 'info' },
  }
  assert.deepEqual(JSON.parse(EncodeQuery(q)), q)
})

test('a refusal names its field in the wire form', () => {
  try {
    ValidateQuery({ select: { branch: 'main', path: [{}, { min: 9, max: 1 }] } })
    assert.fail('expected a refusal')
  } catch (err) {
    assert.ok(err instanceof RankeQueryError)
    assert.equal(err.field, 'select.path[1]', 'the offending step is named')
    assert.equal(err.code, 'ErrQueryHops')
  }
})

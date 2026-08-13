// package: ranke / query_codec
// type:    io
// job:     a Query to the canonical JSON rql.schema.json fixes, plus the shape checks a query
// must pass before it is sent
// limits:  shape only; which claims a read returns is RankeDB's (ranke-go -> query_default.go)
//
// Mirrors ranke-go's query_codec.go, minus DecodeQuery: nothing browser-side receives
// a query, only sends one. The scan rule comes from ranke-go's archive.go instead,
// where a read enforces it — catching it here saves the round trip, which is what
// a client-side validator is for.

import type {
  Comparison,
  Execution,
  Limit,
  Order,
  Output,
  PathStep,
  Query,
  Select,
  Where,
} from './query.ts'

/**
 * QueryErrorCode names the rule a query broke, matching ranke-go's sentinel of the
 * same name so both sides report one verdict under one vocabulary.
 */
export type QueryErrorCode =
  | 'ErrQueryNoScope'
  | 'ErrQueryNoHead'
  | 'ErrQueryScanShape'
  | 'ErrQueryWhereForm'
  | 'ErrQueryComparisonForm'
  | 'ErrQueryHops'
  | 'ErrQueryEnum'
  // A bound and an enumeration fail differently, and a caller switching on the code
  // reads ErrQueryEnum as a mistyped string.
  | 'ErrQueryBounds'
  // ranke-go refuses these while decoding, so neither mirrors a sentinel.
  | 'ErrQueryUnknownField'
  | 'ErrQueryType'

/** RankeQueryError reports a query that would be refused. */
export class RankeQueryError extends Error {
  override readonly name: string = 'RankeQueryError'
  /** The rule broken, which is what an error message names. */
  readonly code: QueryErrorCode
  /**
   * Every rule this refusal answers to, `code` first. A condition two rules both
   * name carries both, so a caller watching one need not know the other — the
   * counterpart of ranke-go's errors.Is matching two sentinels.
   */
  readonly codes: readonly QueryErrorCode[]
  /** The field the rule applies to, in the wire's dotted form. */
  readonly field: string

  constructor(code: QueryErrorCode, field: string, detail: string, ...also: QueryErrorCode[]) {
    super(`${field}: ${detail}`)
    this.code = code
    this.codes = [code, ...also]
    this.field = field
  }

  /** is reports whether this refusal answers to a rule, as errors.Is does. */
  is(code: QueryErrorCode): boolean {
    return this.codes.includes(code)
  }
}

const DIRS = ['provenance', 'uses', 'connections'] as const
const SHAPES = ['single', 'path'] as const
// "graph" asked for the closed graph, a claim cut down to the edges among the results,
// so R-QDETAIL dropped it: id or claims.
const DETAILS = ['id', 'claims'] as const
const FORMS = ['original', 'materialized'] as const
// Three values the schema excludes because only a Go caller may set them: the native
// encoding asks for Go objects, and report's error and warn are Go-side thresholds.
const ENCODINGS = ['json', 'cbor'] as const
const REPORTS = ['info', 'debug', 'trace'] as const
const COLLATIONS = ['numeric', 'lexical'] as const
const DIRECTIONS = ['asc', 'desc'] as const
// A claim keeps every field it carries either way, so no value stands in for content
// left out — which is why "reference" left this vocabulary.
const OVERFLOWS = ['cutoff', 'omit'] as const

const OPERATORS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'in', 'glob'] as const

// The keys each block admits: the schema says additionalProperties: false throughout,
// and ranke-go decodes with DisallowUnknownFields.
const KEYS = {
  query: ['select', 'where', 'output', 'order', 'limit', 'execution'],
  select: ['branch', 'head', 'claim', 'path'],
  pathStep: ['edges', 'dir', 'min', 'max', 'nodes'],
  output: ['shape', 'detail', 'form', 'content', 'encoding'],
  content: ['max', 'overflow'],
  orderKey: ['field', 'compare', 'dir'],
  limit: ['results', 'time'],
  execution: ['layer', 'report'],
  whereAnd: ['and'],
  whereOr: ['or'],
  whereNot: ['not'],
  whereLeaf: ['field', 'test'],
} as const

/**
 * ValidateQuery holds a query to the schema's rules plus the two it cannot state:
 * a step's min against its max (R-QSTEPS), and what a scan may ask for.
 *
 * The types already refuse a bad enum at compile time, so this earns its keep on a
 * query assembled at run time — from a form, a URL, or stored state.
 */
export function ValidateQuery(q: Query): void {
  // Shape before meaning: a query from a form, a URL or JSON.parse reaches here with
  // no type checking behind it.
  checkObject('', q, KEYS.query)
  validateSelect(q)
  if (q.where !== undefined) validateWhere(q.where, 'where')
  if (q.output !== undefined) validateOutput(q.output)
  if (q.order !== undefined) validateOrder(q.order)
  if (q.limit !== undefined) validateLimit(q.limit)
  if (q.execution !== undefined) validateExecution(q.execution)
}

// checkObject holds a block to being an object carrying only the keys it admits.
function checkObject(field: string, v: unknown, keys: readonly string[]): void {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new RankeQueryError('ErrQueryType', field === '' ? 'query' : field, `expected an object, got ${kindOf(v)}`)
  }
  for (const key of Object.keys(v)) {
    if (!keys.includes(key)) {
      throw new RankeQueryError(
        'ErrQueryUnknownField',
        field === '' ? key : `${field}.${key}`,
        `unknown key; this block admits ${keys.join(', ')}`,
      )
    }
  }
}

function checkString(field: string, v: unknown): void {
  if (v !== undefined && typeof v !== 'string') {
    throw new RankeQueryError('ErrQueryType', field, `expected a string, got ${kindOf(v)}`)
  }
}

// checkInt admits what Go's decoder admits for an int field: a whole number.
function checkInt(field: string, v: unknown): void {
  if (v === undefined) return
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new RankeQueryError('ErrQueryType', field, `expected a whole number, got ${kindOf(v)}`)
  }
}

function checkArray(field: string, v: unknown): void {
  if (v !== undefined && !Array.isArray(v)) {
    throw new RankeQueryError('ErrQueryType', field, `expected a list, got ${kindOf(v)}`)
  }
}

function kindOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'a list'
  if (typeof v === 'object') return 'an object'
  return `${typeof v} ${JSON.stringify(v)}`
}

// checkTypeGlobs is where a bare string slips through most easily: `edges: "a/*"`
// reads correctly and is a string where a list belongs.
function checkTypeGlobs(field: string, v: unknown): void {
  checkArray(field, v)
  if (v === undefined) return
  for (const [i, entry] of (v as unknown[]).entries()) {
    checkString(`${field}[${i}]`, entry)
  }
}

// validateSelect checks the generator, including the rule ranke-go enforces at read time
// in archive.go: a scan reaches claims by no stated route.
function validateSelect(q: Query): void {
  const sel: Select | undefined = q.select
  if (sel === undefined) {
    throw new RankeQueryError('ErrQueryNoScope', 'select.branch', 'a scope is mandatory')
  }
  checkObject('select', sel, KEYS.select)
  checkString('select.branch', sel.branch)
  checkString('select.head', sel.head)
  checkString('select.claim', sel.claim)
  checkArray('select.path', sel.path)
  if (sel.branch === undefined || sel.branch === '') {
    throw new RankeQueryError('ErrQueryNoScope', 'select.branch', 'a scope is mandatory')
  }
  if (sel.branch === '$universe' && sel.head === undefined) {
    throw new RankeQueryError(
      'ErrQueryNoHead',
      'select.head',
      'required under $universe, which confines nothing and so offers no head to fall back on',
    )
  }
  // ranke-go parses these while decoding, so a malformed id is refused there; the
  // schema's pattern is what a client can check without the payload's framing.
  checkId('select.head', sel.head)
  checkId('select.claim', sel.claim)
  const path = sel.path ?? []
  path.forEach((step, i) => validateStep(step, `select.path[${i}]`))
  if (path.length > 0) return

  // A scan. A path-less `claim` stands: it anchors the frontier the closure is taken
  // from (R-QANCHOR), which is a route of its own.
  if (q.output?.shape === 'path') {
    throw new RankeQueryError(
      'ErrQueryScanShape',
      'output.shape',
      'a scan reaches claims by no stated route, so the shape must be single',
    )
  }
}

// validateStep checks dir and hops. A max of 0 is unbounded, so only a bounded max
// can sit under min.
function validateStep(step: PathStep, field: string): void {
  checkObject(field, step, KEYS.pathStep)
  checkTypeGlobs(`${field}.edges`, step.edges)
  checkTypeGlobs(`${field}.nodes`, step.nodes)
  checkString(`${field}.dir`, step.dir)
  checkInt(`${field}.min`, step.min)
  checkInt(`${field}.max`, step.max)
  oneOf(`${field}.dir`, step.dir, DIRS)
  // A hop count is bounded at zero. Zero itself is admissible: min 0 carries the
  // starting set through, max 0 leaves the step unbounded. A negative breaks that
  // bound as well as the step rule, so it answers to either.
  if (step.min !== undefined && step.min < 0) {
    throw new RankeQueryError(
      'ErrQueryHops',
      `${field}.min`,
      `${step.min} is negative`,
      'ErrQueryBounds',
    )
  }
  if (step.max !== undefined && step.max < 0) {
    throw new RankeQueryError(
      'ErrQueryHops',
      `${field}.max`,
      `${step.max} is negative`,
      'ErrQueryBounds',
    )
  }
  const min = step.min ?? 1
  // A floor above a bounded ceiling breaks no bound, so it stays the step rule alone.
  if (step.max !== undefined && step.max > 0 && min > step.max) {
    throw new RankeQueryError(
      'ErrQueryHops',
      field,
      `min ${min} is above a bounded max ${step.max}, so the step admits no hop count`,
    )
  }
}

// validateWhere holds every node of the tree to exactly one form. The union expresses
// that in the type; a value from outside the type system still has to be checked.
function validateWhere(w: Where, field: string): void {
  if (typeof w !== 'object' || w === null || Array.isArray(w)) {
    throw new RankeQueryError('ErrQueryType', field, `expected an object, got ${kindOf(w)}`)
  }
  const node = w as Record<string, unknown>
  const forms = ['and', 'or', 'not'].filter((k) => node[k] !== undefined)
  const leaf = node.field !== undefined || node.test !== undefined
  if (forms.length + (leaf ? 1 : 0) !== 1) {
    throw new RankeQueryError(
      'ErrQueryWhereForm',
      field,
      `exactly one of and | or | not | {field, test}, got ${forms.length + (leaf ? 1 : 0)}`,
    )
  }
  if (leaf) {
    checkObject(field, node, KEYS.whereLeaf)
    if (node.field === undefined || node.test === undefined) {
      throw new RankeQueryError(
        'ErrQueryWhereForm',
        field,
        'a leaf carries both a field and a test',
      )
    }
    checkString(`${field}.field`, node.field)
    validateComparison(node.test as Comparison, `${field}.test`)
    return
  }
  if (node.and !== undefined) {
    checkObject(field, node, KEYS.whereAnd)
    checkArray(`${field}.and`, node.and)
    ;(node.and as unknown[]).forEach((sub, i) => validateWhere(sub as Where, `${field}.and[${i}]`))
  }
  if (node.or !== undefined) {
    checkObject(field, node, KEYS.whereOr)
    checkArray(`${field}.or`, node.or)
    ;(node.or as unknown[]).forEach((sub, i) => validateWhere(sub as Where, `${field}.or[${i}]`))
  }
  if (node.not !== undefined) {
    checkObject(field, node, KEYS.whereNot)
    validateWhere(node.not as Where, `${field}.not`)
  }
}

// validateComparison holds a comparison to one operator. An explicit empty `in` set
// counts, being present.
function validateComparison(c: Comparison, field: string): void {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) {
    throw new RankeQueryError('ErrQueryType', field, `expected an object, got ${kindOf(c)}`)
  }
  const node = c as Record<string, unknown>
  // An unrecognised operator leaves none applied, so the count already refuses it.
  const set = OPERATORS.filter((op) => node[op] !== undefined)
  if (set.length === 1 && set[0] === 'in') checkArray(`${field}.in`, node.in)
  if (set.length === 1 && set[0] === 'glob') checkString(`${field}.glob`, node.glob)
  if (set.length !== 1) {
    throw new RankeQueryError(
      'ErrQueryComparisonForm',
      field,
      `exactly one operator (${OPERATORS.join(' | ')}), got ${set.length}`,
    )
  }
}

function validateOutput(o: Output): void {
  checkObject('output', o, KEYS.output)
  for (const axis of ['shape', 'detail', 'form', 'encoding'] as const) {
    checkString(`output.${axis}`, o[axis])
  }
  oneOf('output.shape', o.shape, SHAPES)
  oneOf('output.detail', o.detail, DETAILS)
  oneOf('output.form', o.form, FORMS)
  oneOf('output.encoding', o.encoding, ENCODINGS)
  if (o.content === undefined) return
  checkObject('output.content', o.content, KEYS.content)
  checkInt('output.content.max', o.content.max)
  checkString('output.content.overflow', o.content.overflow)
  // An absent overflow is omit (R-QCONTENT), so a cap alone is a whole content pair.
  oneOf('output.content.overflow', o.content.overflow, OVERFLOWS)
  // A byte cap is a count, which the schema bounds at zero.
  if (o.content.max === undefined || o.content.max < 0) {
    throw new RankeQueryError('ErrQueryBounds', 'output.content.max', 'a byte cap is non-negative')
  }
}

function validateOrder(order: Order): void {
  checkArray('order', order)
  order.forEach((key, i) => {
    checkObject(`order[${i}]`, key, KEYS.orderKey)
    checkString(`order[${i}].field`, key.field)
    checkString(`order[${i}].compare`, key.compare)
    checkString(`order[${i}].dir`, key.dir)
    if (key.field === undefined || key.field === '') {
      throw new RankeQueryError('ErrQueryEnum', `order[${i}].field`, 'a sort key names a field')
    }
    oneOf(`order[${i}].compare`, key.compare, COLLATIONS)
    oneOf(`order[${i}].dir`, key.dir, DIRECTIONS)
  })
}

function validateLimit(limit: Limit): void {
  checkObject('limit', limit, KEYS.limit)
  checkInt('limit.results', limit.results)
  checkString('limit.time', limit.time)
  // A cap is a count, which the schema bounds at zero. Zero is the unbounded read.
  if (limit.results !== undefined && limit.results < 0) {
    throw new RankeQueryError('ErrQueryBounds', 'limit.results', 'a cap is non-negative')
  }
  if (limit.time === undefined) return
  // The grammar admits a sign, which the schema's pattern omits and Go's ParseDuration
  // takes — so a negative budget parses and then fails the bound, as it does upstream.
  if (!SIGNED_DURATION.test(limit.time)) {
    throw new RankeQueryError(
      'ErrQueryEnum',
      'limit.time',
      `a duration is a decimal sequence with unit suffixes (ns, us, ms, s, m, h), or a bare 0 — got ${JSON.stringify(limit.time)}`,
    )
  }
  if (limit.time.startsWith('-') && !ZERO_DURATION.test(limit.time)) {
    throw new RankeQueryError(
      'ErrQueryBounds',
      'limit.time',
      `a budget is non-negative — got ${JSON.stringify(limit.time)}`,
    )
  }
}

function validateExecution(exec: Execution): void {
  checkObject('execution', exec, KEYS.execution)
  checkString('execution.layer', exec.layer)
  checkString('execution.report', exec.report)
  oneOf('execution.report', exec.report, REPORTS)
}

// The duration grammar the schema fixes — "5s", "1m30s", or a bare "0" — widened by
// the sign Go's ParseDuration takes, so what parses upstream parses here.
const SIGNED_DURATION = /^[+-]?(0|([0-9]+(\.[0-9]+)?(ns|us|ms|s|m|h))+)$/
// Zero however it is spelled: "-0s" is zero, so it clears the bound.
const ZERO_DURATION = /^[+-]?(0|(0+(\.0+)?(ns|us|ms|s|m|h))+)$/

// The multibase framing the schema fixes. Whether the payload's own framing parses is
// parseId's answer, and needs the bytes.
const ID = /^b[a-z2-7]+$/

function checkId(field: string, id: string | undefined): void {
  if (id === undefined) return
  if (!ID.test(id)) {
    throw new RankeQueryError(
      'ErrQueryEnum',
      field,
      `an id is multibase base32, matching ${ID.source} — got ${JSON.stringify(id)}`,
    )
  }
}

function oneOf(field: string, got: string | undefined, allowed: readonly string[]): void {
  if (got === undefined) return
  if (!allowed.includes(got)) {
    throw new RankeQueryError(
      'ErrQueryEnum',
      field,
      `${JSON.stringify(got)} is outside the set the schema fixes (${allowed.join(' | ')})`,
    )
  }
}

/**
 * EncodeQuery renders a query as the canonical JSON, validating first so an invalid
 * query never reaches the wire. An absent field stays absent: what a caller's silence
 * becomes is the server's to decide, and every default is stated in the schema.
 */
export function EncodeQuery(q: Query): string {
  ValidateQuery(q)
  return JSON.stringify(q, (key, value: unknown) => {
    // An operator's presence is the signal, so `in: []` is a comparison against the
    // empty set rather than an empty container. Dropping it would leave a comparison
    // applying no operator at all.
    if ((OPERATORS as readonly string[]).includes(key)) return value
    // Elsewhere an empty array or object says nothing a missing key does not, and a
    // wire read by a machine treats the two alike.
    if (Array.isArray(value) && value.length === 0) return undefined
    if (isEmptyObject(value)) return undefined
    return value
  })
}

function isEmptyObject(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v).length === 0
  )
}

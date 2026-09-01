// package: ranke / taxonomy
// type:    logic
// job:     EDTF Level 1 parsing for `dated` (`V-DATED`), including its own date-and-time
// form, wider than `V-TIME`'s fixed-width created_at
// limits:  Level 1 only: no sets, no individual-component qualification, no exponential years
//
// Mirrors ranke-go's edtf.go, function for function, so the two grammars can be read side by
// side. ranke-go also exports edtfMidpointMs/TemporalMidpointMs, projecting a span to the
// millisecond a storage layer sorts `compare: temporal` on (R-QTEMPORAL) — a query-execution
// concern this library holds none of (see README), so no counterpart is offered here.

/**
 * validateDated reports whether s is acceptable as a node's `dated`: an RFC 3339 instant, or
 * an EDTF Level 1 value (`V-DATED`). A predicate rather than a thrower — ranke-go returns an
 * error here; the refusal belongs to the door that reports it, RankeDecodeError at the codec
 * and RankeBuildError at the builder (the same split time_fields.ts uses).
 */
export function validateDated(s: string): boolean {
  return edtfSpan(s) !== null
}

/**
 * edtfSpan returns the half-open millisecond span [start, end) s denotes, or null when s is
 * neither an instant nor a valid EDTF Level 1 value.
 */
export function edtfSpan(s: string): readonly [start: number, end: number] | null {
  // EDTF's own date-and-time form, wider than V-TIME's fixed-width created_at, which
  // `dated` is explicitly outside of (V-DATED).
  const t = parseRFC3339Instant(s)
  if (t !== null) return [t, t]
  return parseEDTFLevel1(s)
}

// The RFC 3339 date-time production, any fractional-second width (or none) and either Z or a
// numeric offset — wider than V-TIME's fixed nine digits and mandatory Z.
const rfc3339Instant = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/

// parseRFC3339Instant returns epoch milliseconds for s in that production, or null when s
// does not match or names no real instant (a component out of range, e.g. February 30th).
function parseRFC3339Instant(s: string): number | null {
  const m = rfc3339Instant.exec(s)
  if (m === null) return null
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i]))
  const frac = m[7]
  const zone = m[8]!
  const ms = frac === undefined ? 0 : Number(`${frac}000`.slice(0, 3))
  const t = new Date(0)
  t.setUTCFullYear(year!, month! - 1, day)
  t.setUTCHours(hour!, minute!, second!, ms)
  // A component out of range rolls the date over, so reading every one back is what ranges
  // them — the same check validRFC3339Nano makes.
  if (
    t.getUTCFullYear() !== year ||
    t.getUTCMonth() !== month! - 1 ||
    t.getUTCDate() !== day ||
    t.getUTCHours() !== hour ||
    t.getUTCMinutes() !== minute ||
    t.getUTCSeconds() !== second
  ) {
    return null
  }
  if (zone === 'Z') return t.getTime()
  const offsetMin = (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
  return t.getTime() - offsetMin * 60_000
}

// edtfPoint is one parsed EDTF Level 1 endpoint, exactly one shape populated: a season, an
// unspecified-digit year (spanYears > 0), or a year with an optional month and day.
interface EdtfPoint {
  readonly year: number
  readonly hasMonth: boolean
  readonly month: number
  readonly hasDay: boolean
  readonly day: number
  readonly season: number // 21-24; 0 when this point is not a season
  readonly spanYears: number // > 0 for an unspecified-digit year (10^(number of trailing X's))
}

const zeroPoint: EdtfPoint = {
  year: 0,
  hasMonth: false,
  month: 0,
  hasDay: false,
  day: 0,
  season: 0,
  spanYears: 0,
}

/**
 * parseEDTFLevel1 parses a full `dated` value: a single point, an A/B interval whose either
 * side may be empty (unknown) or `..` (open), or R-QTEMPORAL's own shorthand for an open
 * bound written directly against the concrete side with no `/` at all (`..2005`, `2020..`).
 * Either open form extends one calendar year past the edge of the concrete bound it faces.
 */
function parseEDTFLevel1(s: string): readonly [number, number] | null {
  if (s === '') return null
  if (s.includes('/')) return parseEDTFSlashInterval(s)
  if (s.startsWith('..') && s.length > 2) {
    const rp = parseEDTFPoint(s.slice(2))
    if (rp === null) return null
    const [rs, re] = pointSpanMs(rp)
    return [timeShiftYearsMs(rs, -1), re]
  }
  if (s.endsWith('..') && s.length > 2) {
    const lp = parseEDTFPoint(s.slice(0, -2))
    if (lp === null) return null
    const [ls, le] = pointSpanMs(lp)
    return [ls, timeShiftYearsMs(le, 1)]
  }
  const p = parseEDTFPoint(s)
  return p === null ? null : pointSpanMs(p)
}

// parseEDTFSlashInterval parses the ISO 8601-2 A/B form, either side empty (unknown) or `..`
// (open).
function parseEDTFSlashInterval(s: string): readonly [number, number] | null {
  const slash = s.indexOf('/')
  const left = s.slice(0, slash)
  const right = s.slice(slash + 1)
  const openLeft = left === '' || left === '..'
  const openRight = right === '' || right === '..'

  let start: number
  let end: number
  if (openLeft && openRight) {
    return null // neither side has anything for the other to face
  } else if (openLeft) {
    const rp = parseEDTFPoint(right)
    if (rp === null) return null
    const [rs, re] = pointSpanMs(rp)
    ;[start, end] = [timeShiftYearsMs(rs, -1), re]
  } else if (openRight) {
    const lp = parseEDTFPoint(left)
    if (lp === null) return null
    const [ls, le] = pointSpanMs(lp)
    ;[start, end] = [ls, timeShiftYearsMs(le, 1)]
  } else {
    // both concrete
    const lp = parseEDTFPoint(left)
    const rp = parseEDTFPoint(right)
    if (lp === null || rp === null) return null
    ;[start] = pointSpanMs(lp)
    ;[, end] = pointSpanMs(rp)
  }
  return start >= end ? null : [start, end]
}

/**
 * parseEDTFPoint parses one endpoint: a trailing `?`/`~`/`%` qualifier is accepted and
 * dropped (span math ignores it — R-QTEMPORAL's tie-break on it is out of scope), then a
 * letter-prefixed year (`Y170000002`), an unspecified-digit year (`201X`, `20XX`, `2XXX`), or
 * `year[-month[-day]]`, month 21-24 read as a season.
 */
function parseEDTFPoint(raw: string): EdtfPoint | null {
  if (raw === '') return null
  let s = raw
  if (s[s.length - 1] === '?' || s[s.length - 1] === '~' || s[s.length - 1] === '%') {
    s = s.slice(0, -1)
  }
  if (s === '') return null

  if (s[0] === 'Y') {
    const year = parseSignedInt(s.slice(1))
    return year === null ? null : { ...zeroPoint, year }
  }
  if (s.length === 4) {
    const p = parseUnspecifiedYear(s)
    if (p !== null) return p
  }

  let neg = false
  let rest = s
  if (rest[0] === '-') {
    neg = true
    rest = rest.slice(1)
  }
  const parts = rest.split('-')
  if (parts[0]!.length !== 4 || !allDigits(parts[0]!)) return null
  const year = neg ? -Number(parts[0]) : Number(parts[0])

  switch (parts.length) {
    case 1:
      return { ...zeroPoint, year }
    case 2: {
      const mm = parseTwoDigits(parts[1]!)
      if (mm === null) return null
      if (mm >= 21 && mm <= 24) return { ...zeroPoint, year, season: mm }
      if (mm < 1 || mm > 12) return null
      return { ...zeroPoint, year, hasMonth: true, month: mm }
    }
    case 3: {
      const mm = parseTwoDigits(parts[1]!)
      if (mm === null || mm < 1 || mm > 12) return null
      const dd = parseTwoDigits(parts[2]!)
      if (dd === null || dd < 1 || dd > 31) return null
      return { ...zeroPoint, year, hasMonth: true, month: mm, hasDay: true, day: dd }
    }
    default:
      return null
  }
}

/**
 * parseUnspecifiedYear reads a 4-character year with 1 to 3 trailing 'X's (`201X` the decade,
 * `20XX` the century, `2XXX` the millennium); null for a plain year (0 X's) or one masked
 * past its first digit.
 */
function parseUnspecifiedYear(s: string): EdtfPoint | null {
  let x = 0
  while (x < s.length && s[s.length - 1 - x] === 'X') x++
  if (x === 0 || x >= s.length) return null
  const digits = s.slice(0, s.length - x)
  if (!allDigits(digits)) return null
  const mult = 10 ** x
  return { ...zeroPoint, year: Number(digits) * mult, spanYears: mult }
}

// pointSpanMs is p's own half-open millisecond span, the precision it carries: a year covers
// its year, a season its three months, a day just that day.
function pointSpanMs(p: EdtfPoint): readonly [number, number] {
  if (p.spanYears > 0) return [dateMs(p.year, 1, 1), dateMs(p.year + p.spanYears, 1, 1)]
  if (p.season !== 0) {
    switch (p.season) {
      case 21:
        return [dateMs(p.year, 3, 1), dateMs(p.year, 6, 1)]
      case 22:
        return [dateMs(p.year, 6, 1), dateMs(p.year, 9, 1)]
      case 23:
        return [dateMs(p.year, 9, 1), dateMs(p.year, 12, 1)]
      default: // 24: December through February, crossing into year+1
        return [dateMs(p.year, 12, 1), dateMs(p.year + 1, 3, 1)]
    }
  }
  if (p.hasDay) {
    const start = dateMs(p.year, p.month, p.day)
    return [start, timeShiftDaysMs(start, 1)]
  }
  if (p.hasMonth) return [dateMs(p.year, p.month, 1), dateMs(p.year, p.month + 1, 1)]
  return [dateMs(p.year, 1, 1), dateMs(p.year + 1, 1, 1)]
}

// dateMs is UTC midnight of year-month-day, out-of-range month or day normalised the way
// ranke-go's time.Date rolls them into the next unit.
function dateMs(year: number, month: number, day: number): number {
  const t = new Date(0)
  t.setUTCFullYear(year, month - 1, day)
  t.setUTCHours(0, 0, 0, 0)
  return t.getTime()
}

function timeShiftDaysMs(ms: number, days: number): number {
  const t = new Date(ms)
  t.setUTCDate(t.getUTCDate() + days)
  return t.getTime()
}

// timeShiftYearsMs shifts a millisecond edge by whole calendar years — the "one year"
// R-QTEMPORAL extends an open or unknown interval bound by, leap years included.
function timeShiftYearsMs(ms: number, years: number): number {
  const t = new Date(ms)
  t.setUTCFullYear(t.getUTCFullYear() + years)
  return t.getTime()
}

function allDigits(s: string): boolean {
  return s.length > 0 && /^[0-9]+$/.test(s)
}

function parseTwoDigits(s: string): number | null {
  return s.length === 2 && allDigits(s) ? Number(s) : null
}

function parseSignedInt(s: string): number | null {
  if (s === '') return null
  const neg = s[0] === '-'
  const rest = neg ? s.slice(1) : s
  if (!allDigits(rest)) return null
  const n = Number(rest)
  return neg ? -n : n
}

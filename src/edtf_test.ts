import assert from 'node:assert/strict'
import test from 'node:test'

import { edtfSpan, validateDated } from './edtf.ts'

// Mirrors ranke-go's edtf_test.go: the same cases, so an implementation gap shows as a
// difference here rather than only downstream, in the conformance manifest.

function ms(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day)
}

// msAt is ms with a time of day, for the spans an instant bounds.
function msAt(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

test('edtfSpan pins the span each accepted form denotes', () => {
  const cases: ReadonlyArray<readonly [string, string, number, number]> = [
    ['year', '2014', ms(2014, 1, 1), ms(2015, 1, 1)],
    ['year-month', '2014-06', ms(2014, 6, 1), ms(2014, 7, 1)],
    ['december rolls the year over', '2014-12', ms(2014, 12, 1), ms(2015, 1, 1)],
    ['year-month-day', '2014-06-11', ms(2014, 6, 11), ms(2014, 6, 12)],
    ['decade', '201X', ms(2010, 1, 1), ms(2020, 1, 1)],
    ['century', '20XX', ms(2000, 1, 1), ms(2100, 1, 1)],
    ['millennium', '2XXX', ms(2000, 1, 1), ms(3000, 1, 1)],
    ['negative year', '-1985', ms(-1985, 1, 1), ms(-1984, 1, 1)],
    ['season spring', '2014-21', ms(2014, 3, 1), ms(2014, 6, 1)],
    ['season winter crosses the year', '2014-24', ms(2014, 12, 1), ms(2015, 3, 1)],
    ['uncertain qualifier ignored', '2014?', ms(2014, 1, 1), ms(2015, 1, 1)],
    ['approximate qualifier ignored', '2014~', ms(2014, 1, 1), ms(2015, 1, 1)],
    ['uncertain-approximate qualifier ignored', '2014%', ms(2014, 1, 1), ms(2015, 1, 1)],
    ['closed interval', '2014/2016', ms(2014, 1, 1), ms(2017, 1, 1)],
    ['open start extends one year before the bound it faces', '..2005', ms(2004, 1, 1), ms(2006, 1, 1)],
    ['unknown start, same as open', '/2005', ms(2004, 1, 1), ms(2006, 1, 1)],
    ['open end extends one year past the bound it faces', '2020..', ms(2020, 1, 1), ms(2022, 1, 1)],
    ['unknown end, same as open', '2020/', ms(2020, 1, 1), ms(2022, 1, 1)],
  ]
  for (const [name, value, start, end] of cases) {
    const span = edtfSpan(value)
    assert.ok(span !== null, `${name} (${JSON.stringify(value)}) should parse`)
    assert.equal(span[0], start, `${name}: start`)
    assert.equal(span[1], end, `${name}: end`)
  }
})

// EDTF's own Level 0 date-and-time form: `dated` is outside `V-TIME` (V-DATED), so a form
// V-TIME itself would refuse — no fraction, or a numeric offset rather than Z — is still a
// valid instant here.
test('edtfSpan admits EDTF Level 0 date-and-time, wider than V-TIME', () => {
  const noFraction = edtfSpan('1985-04-12T23:20:30Z')
  assert.ok(noFraction !== null)
  assert.equal(noFraction[0], Date.UTC(1985, 3, 12, 23, 20, 30))
  assert.equal(noFraction[1], noFraction[0], 'an instant is a zero-width span')

  const offset = edtfSpan('2014-06-15T12:00:00+02:00')
  assert.ok(offset !== null)
  assert.equal(offset[0], Date.UTC(2014, 5, 15, 10, 0, 0), 'a numeric offset normalises to UTC')
  assert.equal(offset[1], offset[0])
})

// An instant is an endpoint of the grammar like a date is, so the qualifiers and interval
// bounds Level 1 layers on top reach it too — the forms a caller wants when a real timestamp
// is uncertain or bounds a range.
test('a date-and-time point takes the Level 1 forms', () => {
  const cases: ReadonlyArray<readonly [string, string, number, number]> = [
    ['uncertain', '2004-01-01T10:10:10Z?', msAt(2004, 1, 1, 10, 10, 10), msAt(2004, 1, 1, 10, 10, 10)],
    [
      'approximate, over an offset',
      '2004-01-01T10:10:10+05:00~',
      msAt(2004, 1, 1, 5, 10, 10),
      msAt(2004, 1, 1, 5, 10, 10),
    ],
    [
      'interval between two instants',
      '2004-01-01T10:10:10Z/2004-01-01T18:00:00Z',
      msAt(2004, 1, 1, 10, 10, 10),
      msAt(2004, 1, 1, 18, 0, 0),
    ],
    [
      'instant against a coarser bound',
      '2004-01-01T10:10:10Z/2004-06',
      msAt(2004, 1, 1, 10, 10, 10),
      ms(2004, 7, 1),
    ],
    [
      'open end runs a year past the instant',
      '2004-01-01T10:10:10Z..',
      msAt(2004, 1, 1, 10, 10, 10),
      msAt(2005, 1, 1, 10, 10, 10),
    ],
    [
      'unknown start runs a year before it',
      '/2004-01-01T10:10:10Z',
      msAt(2003, 1, 1, 10, 10, 10),
      msAt(2004, 1, 1, 10, 10, 10),
    ],
  ]
  for (const [name, value, start, end] of cases) {
    const span = edtfSpan(value)
    assert.ok(span !== null, `${name} (${JSON.stringify(value)}) should parse`)
    assert.equal(span[0], start, `${name}: start`)
    assert.equal(span[1], end, `${name}: end`)
  }
})

test('edtfSpan admits a letter-prefixed year beyond 4 digits', () => {
  const positive = edtfSpan('Y12345')
  assert.ok(positive !== null)
  assert.equal(positive[0], ms(12345, 1, 1))
  assert.equal(positive[1], ms(12346, 1, 1))

  const negative = edtfSpan('Y-12345')
  assert.ok(negative !== null)
  assert.equal(negative[0], ms(-12345, 1, 1))
  assert.equal(negative[1], ms(-12344, 1, 1))
})

// Level 2 (sets, non-rightmost/non-year unspecified digits) and plain garbage are refused —
// V-DATED pins `dated` to Level 1.
test('edtfSpan refuses Level 2 and malformed values', () => {
  for (const v of [
    '',
    'whenever',
    '2014-13',
    '2014-00',
    '2014-06-32',
    '2014-06-00',
    '{2001,2002,2003}', // Level 2 sets
    '[2001,2002,2003]',
    '201X-01', // unspecified digits only apply to the year alone
    'XXXX', // no fixed digit at all is not meaningful
    '../..', // both bounds open faces nothing
    '2014/2010', // a backwards interval
    '2014--06', // malformed separator
    '2014-06-15T12:00:00', // a date-time needs a zone (Z or offset) to be an instant
    '2014-06-15T12:00:00?', // and a qualifier does not supply one
    '2014-06-15T25:00:00Z', // an hour outside the clock
    '2014-21T12:00:00Z', // a season is a quarter of a year, so no time of day falls in it
    'T12:00:00Z', // a time of day names no moment without its date
    '2014-06-15T12:00:00Z/2014-06-15T12:00:00Z', // an interval spanning nothing
  ]) {
    assert.equal(edtfSpan(v), null, JSON.stringify(v))
  }
})

test('validateDated agrees with edtfSpan', () => {
  for (const v of [
    '2014',
    '2014-06-11',
    '201X',
    '2014/2016',
    '2026-01-05T12:00:00.000000000Z',
    // A commit's author date, offset and all, held as uncertain — the case EDTF's
    // time-bearing forms exist for.
    '2004-01-01T10:10:10+05:00?',
  ]) {
    assert.ok(validateDated(v), v)
  }
  for (const v of ['whenever', '{2001,2002}']) {
    assert.ok(!validateDated(v), v)
  }
})

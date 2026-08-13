import assert from 'node:assert/strict'
import test from 'node:test'

import { FieldDeleteBy, FieldPubkeyExpiresAfter, FieldPubkeyValidFrom } from './field_taxonomy.ts'
import { checkTimestampFields, timeFields, validRFC3339Nano } from './time_fields.ts'

// `V-TIME` governs delete_by and the two pubkey bounds as well as created_at. ranke-go
// mirrors these in verify_time_test.go, where the same three fields went unparsed:
// delete_by was compared for equality and copied as a string, and a pubkey bound was
// parsed only as a side effect of signing something.

const CANONICAL = '2030-01-01T00:00:00.000000000Z'

test('the governed fields are the three optional ones', () => {
  assert.deepEqual([...timeFields], [FieldDeleteBy, FieldPubkeyValidFrom, FieldPubkeyExpiresAfter])
  assert.ok(!timeFields.includes('created_at'), 'created_at is a record slot, not a field')
})

test('validRFC3339Nano admits the one form', () => {
  for (const s of [
    CANONICAL,
    '2026-01-02T03:04:05.123456789Z',
    '2028-02-29T23:59:59.999999999Z', // a leap year has the day
  ]) {
    assert.ok(validRFC3339Nano(s), s)
  }
})

// Each of these is a timestamp some reader takes. Date.parse takes most of them, which
// is why the form is checked rather than the parse merely attempted.
test('validRFC3339Nano refuses everything else', () => {
  for (const s of [
    '',
    'whenever',
    '2026-01-02T03:04:05Z', // no fraction
    '2026-01-02T03:04:05.123Z', // milliseconds
    '2026-01-02T03:04:05.1234567890Z', // ten digits
    '2026-01-02T03:04:05.123456789+00:00', // an offset, where `V-TIME` fixes UTC
    '2026-01-02T03:04:05.123456789z', // a lowercase zone
    '2026-01-02 03:04:05.123456789Z', // a space for the T
    '2026-01-02',
    '2026-1-02T03:04:05.123456789Z', // an unpadded month
    '2026-13-02T03:04:05.123456789Z', // a month a year does not have
    '2026-02-30T03:04:05.123456789Z', // a day February does not have
    '2025-02-29T03:04:05.123456789Z', // 2025 is no leap year
    '2026-01-02T24:04:05.123456789Z', // an hour a day does not have
    '2026-01-02T03:60:05.123456789Z',
    '2026-01-02T03:04:60.123456789Z',
    ` ${CANONICAL}`,
    `${CANONICAL} `,
  ]) {
    assert.ok(!validRFC3339Nano(s), JSON.stringify(s))
  }
})

test('checkTimestampFields names the field that will not parse', () => {
  for (const name of timeFields) {
    assert.equal(checkTimestampFields({ [name]: 'whenever' }), `${name}=whenever`)
  }
})

// The control, so a green run is not green because the check refuses everything: all
// three fields are optional, and absence is no violation.
test('checkTimestampFields passes an absent or canonical value', () => {
  assert.equal(checkTimestampFields({}), null)
  assert.equal(checkTimestampFields({ title: 'a field of its own' }), null)
  for (const name of timeFields) {
    assert.equal(checkTimestampFields({ [name]: CANONICAL }), null, name)
  }
})

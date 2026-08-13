// package: ranke / taxonomy
// type:    logic
// job:     `V-TIME` for the optional timestamp fields — delete_by, pubkey_valid_from,
// pubkey_expires_after — refused at every door a claim arrives through; created_at is a
// record slot of its own, which the codec parses
// limits:  the form of one value, so an absent field is no violation and no timestamp is
// compared against another
//
// ranke-go returns an error here (time_fields.go). These are predicates: the error a
// refusal carries belongs to the door that reports it — RankeDecodeError at the codec,
// RankeBuildError at the builder.

import { FieldDeleteBy, FieldPubkeyExpiresAfter, FieldPubkeyValidFrom } from './field_taxonomy.ts'

/**
 * timeFields are the optional fields `V-TIME` governs. created_at is absent: it is its
 * own record slot rather than a field, and the codec parses it there.
 */
export const timeFields: readonly string[] = [
  FieldDeleteBy,
  FieldPubkeyValidFrom,
  FieldPubkeyExpiresAfter,
]

// The single form `V-TIME` admits: RFC 3339, UTC, fixed-width nanoseconds. Fixed width is
// what keeps S(v) byte-stable, so every implementation writes the one representation.
const rfc3339Nano = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{9}Z$/

/**
 * validRFC3339Nano reports whether s is a timestamp `V-TIME` admits: the canonical form,
 * naming a moment that exists. ranke-go's time.Parse ranges every component, so
 * 2026-02-30 and hour 24 are refused there and here.
 */
export function validRFC3339Nano(s: string): boolean {
  const m = rfc3339Nano.exec(s)
  if (m === null) return false
  const group = (i: number): number => Number(m[i])
  const [year, month, day] = [group(1), group(2), group(3)]
  const [hour, minute, second] = [group(4), group(5), group(6)]
  const t = new Date(0)
  // setUTCFullYear, where Date.UTC reads a year under 100 as 19xx.
  t.setUTCFullYear(year, month - 1, day)
  t.setUTCHours(hour, minute, second, 0)
  // A component out of range rolls the date over, so reading every one back is what
  // ranges them — February 30th arrives as March 2nd and says so.
  return (
    t.getUTCFullYear() === year &&
    t.getUTCMonth() === month - 1 &&
    t.getUTCDate() === day &&
    t.getUTCHours() === hour &&
    t.getUTCMinutes() === minute &&
    t.getUTCSeconds() === second
  )
}

/**
 * checkTimestampFields returns `name=value` for the first timestamp field that will not
 * parse, and null when every one present does. Absence is no violation — all three are
 * optional — so only a value that is there and unreadable is reported.
 */
export function checkTimestampFields(fields: Readonly<Record<string, string>>): string | null {
  for (const name of timeFields) {
    const v = fields[name]
    if (v === undefined) continue
    if (!validRFC3339Nano(v)) return `${name}=${v}`
  }
  return null
}

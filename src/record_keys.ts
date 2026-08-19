// package: ranke / record_keys
// type:    data
// job:     the numeric record keys `V-SER` fixes — the slot each of a node's and an edge's
// values serializes under, and the name that slot carries
// limits:  the numbering alone; what a slot holds is codec.ts's, and the field names inside
// the fields slot are field_taxonomy.ts's
//
// ranke-go has no counterpart: its numbering lives in cbor struct tags (`cbor:"9,keyasint"`)
// that the library never reads back as a table. The codec here hand-rolls CBOR, so the
// numbers are already constants — and a reader rendering raw bytes needs them by name, so
// they are exported rather than internal. codec.ts reads these, which is what makes the
// exported table the one a decode actually uses; a second copy would be free to drift.

/** RecordKind is the record a key belongs to: a node's or an edge's. */
export type RecordKind = 'node' | 'edge'

/** ClaimFileKeyNode is the key a claim file wraps its node record under. */
export const ClaimFileKeyNode = 1

// Keys 1 to 8 are the slots a node and an edge share, so one number means one thing in
// either record. A node then takes 9 to 11 and an edge 12 to 13 (`V-SER`).
export const RecordKeyTypeClass = 1
export const RecordKeyTypeSubtype = 2
export const RecordKeyEncodingClass = 3
export const RecordKeyEncodingSubtype = 4
export const RecordKeyContentHash = 5
export const RecordKeyContent = 6
export const RecordKeyContentSize = 7
export const RecordKeyFields = 8

/** The slots only a node carries. */
export const NodeKeyCreatedAt = 9
export const NodeKeyEdges = 10
export const NodeKeyHeight = 11

/** The slots only an edge carries. */
export const EdgeKeyReference = 12
export const EdgeKeyRelationDirection = 13

// The names. @tbl:keys writes the four type and encoding halves as prose ("type class");
// they are snake_case here so a caller prints every slot under one convention. The rest are
// the literal names the record and the JSON projection both use.
const sharedNames: ReadonlyArray<readonly [number, string]> = [
  [RecordKeyTypeClass, 'type_class'],
  [RecordKeyTypeSubtype, 'type_subtype'],
  [RecordKeyEncodingClass, 'encoding_class'],
  [RecordKeyEncodingSubtype, 'encoding_subtype'],
  [RecordKeyContentHash, 'content_hash'],
  [RecordKeyContent, 'content'],
  [RecordKeyContentSize, 'content_size'],
  [RecordKeyFields, 'fields'],
]

/**
 * NodeRecordKeys maps each numeric key of a node record to its name, for a reader
 * rendering raw bytes: key 9 is `created_at`, and 6 is `content`.
 */
export const NodeRecordKeys: ReadonlyMap<number, string> = new Map([
  ...sharedNames,
  [NodeKeyCreatedAt, 'created_at'],
  [NodeKeyEdges, 'edges'],
  [NodeKeyHeight, 'height'],
])

/** EdgeRecordKeys is the same for an edge record, whose own slots are 12 and 13. */
export const EdgeRecordKeys: ReadonlyMap<number, string> = new Map([
  ...sharedNames,
  [EdgeKeyReference, 'reference'],
  [EdgeKeyRelationDirection, 'relation_direction'],
])

/**
 * recordKeyName is the name a key carries in a record of this kind, and undefined for a
 * number the table does not assign — a key a later implementation added, which a reader
 * shows as the number alone rather than guessing at.
 */
export function recordKeyName(kind: RecordKind, key: number): string | undefined {
  return (kind === 'node' ? NodeRecordKeys : EdgeRecordKeys).get(key)
}

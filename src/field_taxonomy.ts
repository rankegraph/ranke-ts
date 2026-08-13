// package: ranke / taxonomy
// type:    logic
// job:     field-name/value size caps and the well-known field-name constants, enforced at
// claim/edge construction
// limits:  reference-impl caps (the paper leaves them open); the codec/verifier never reject an
// already-stored record (-> claim)

/**
 * Field-size caps (`R-FIELDS`); fields are metadata, so large data belongs in content.
 */
export const maxFieldNameLen = 128 // bytes, one field name
export const maxFieldValueLen = 64 * 1024 // bytes, one field value
export const maxFieldsPerRecord = 256 // fields on one node or edge

/**
 * Field is a node/edge field name: open user vocabulary over [a-z0-9_] with no
 * leading "_" (`R-FIELDS`). Charsets outside that are reserved system namespaces, e.g. ".".
 */
export type Field = string

// Aliases are bare; the codec adds the reserved "." prefix on the wire.
export const FieldName = 'name'
export const FieldNameAlias = 'n'
export const FieldEdges = 'edges'
export const FieldEdgesAlias = 'e'
export const FieldContent = 'content'
export const FieldContentAlias = 'c'
export const FieldContentSize = 'content_size'
export const FieldContentSizeAlias = 's'
export const FieldContentHash = 'content_hash'
export const FieldContentHashAlias = 'h'
export const FieldHeight = 'height'
export const FieldHeightAlias = 'H'
/**
 * FieldEdgesDiffOmit lists, on a diff claim, names of inherited edges to drop when
 * materialising, one per line — only named edges inherit. Overwrite/add is
 * re-stating the edge.
 */
export const FieldEdgesDiffOmit = 'edges_diff_omit'
export const FieldEdgesDiffOmitAlias = 'E'
/** FieldFieldsDiffOmit is the node-field analogue: newline-separated names. */
export const FieldFieldsDiffOmit = 'fields_diff_omit'
export const FieldFieldsDiffOmitAlias = 'F'
/**
 * FieldPubkeyValidFrom and FieldPubkeyExpiresAfter bound a contributor key's
 * validity (RFC 3339, paper 2 §Contributor Keys): a claim it signed is dated within
 * the closed window they describe. Either may stand alone.
 */
export const FieldPubkeyValidFrom = 'pubkey_valid_from'
export const FieldPubkeyValidFromAlias = 'v'
export const FieldPubkeyExpiresAfter = 'pubkey_expires_after'
export const FieldPubkeyExpiresAfterAlias = 'x'
/**
 * FieldDeleteBy schedules a claim's bytes for removal (RFC 3339, paper 2
 * §Deletion). Every edge referencing such a claim carries the date too, so the
 * schedule travels with the reference and explains the gap the deletion leaves.
 */
export const FieldDeleteBy = 'delete_by'
export const FieldDeleteByAlias = 'd'

/** splitLines parses a newline-separated list (a *_diff_omit field) into a set. */
export function splitLines(s: string): Set<string> {
  const out = new Set<string>()
  for (const line of s.split('\n')) {
    const t = line.trim()
    if (t !== '') out.add(t)
  }
  return out
}

/**
 * validFieldChars reports whether name is non-empty, is [a-z0-9_], and has no
 * leading "_". Node/edge subtypes share the charset (see checkSubtype).
 */
export function validFieldChars(name: string): boolean {
  if (name === '') return false
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    const lower = c >= 0x61 && c <= 0x7a // a-z
    const digit = c >= 0x30 && c <= 0x39 // 0-9
    if (lower || digit) continue
    if (c === 0x5f) {
      if (i === 0) return false // no leading underscore
      continue
    }
    return false
  }
  return true
}

/** validSubtype validates a node/edge subtype: [a-z0-9] then [a-z0-9_]. */
export function validSubtype(sub: string): boolean {
  return validFieldChars(sub)
}

/**
 * validEncodingSubtype validates an encoding (MIME) subtype: a leading
 * [A-Za-z0-9], then alphanumerics and the MIME specials "_", ".", "+", "-".
 */
export function validEncodingSubtype(sub: string): boolean {
  if (sub === '') return false
  for (let i = 0; i < sub.length; i++) {
    const c = sub.charCodeAt(i)
    const alnum =
      (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39)
    if (i === 0) {
      if (!alnum) return false // leading char must be alphanumeric
      continue
    }
    if (!(alnum || c === 0x5f || c === 0x2e || c === 0x2b || c === 0x2d)) return false
  }
  return true
}

/**
 * fieldNameToAlias maps a well-known field name to its bare alias (`V-ALIAS`); user
 * names pass through.
 */
export function fieldNameToAlias(n: string): string {
  switch (n) {
    case FieldName:
      return FieldNameAlias
    case FieldEdges:
      return FieldEdgesAlias
    case FieldContent:
      return FieldContentAlias
    case FieldContentSize:
      return FieldContentSizeAlias
    case FieldContentHash:
      return FieldContentHashAlias
    case FieldHeight:
      return FieldHeightAlias
    case FieldEdgesDiffOmit:
      return FieldEdgesDiffOmitAlias
    case FieldFieldsDiffOmit:
      return FieldFieldsDiffOmitAlias
    case FieldDeleteBy:
      return FieldDeleteByAlias
    case FieldPubkeyValidFrom:
      return FieldPubkeyValidFromAlias
    case FieldPubkeyExpiresAfter:
      return FieldPubkeyExpiresAfterAlias
    default:
      return n
  }
}

/** fieldNameFromAlias maps a bare alias back to its canonical field name. */
export function fieldNameFromAlias(c: string): string {
  switch (c) {
    case FieldNameAlias:
      return FieldName
    case FieldEdgesAlias:
      return FieldEdges
    case FieldContentAlias:
      return FieldContent
    case FieldContentSizeAlias:
      return FieldContentSize
    case FieldContentHashAlias:
      return FieldContentHash
    case FieldHeightAlias:
      return FieldHeight
    case FieldEdgesDiffOmitAlias:
      return FieldEdgesDiffOmit
    case FieldFieldsDiffOmitAlias:
      return FieldFieldsDiffOmit
    case FieldDeleteByAlias:
      return FieldDeleteBy
    case FieldPubkeyValidFromAlias:
      return FieldPubkeyValidFrom
    case FieldPubkeyExpiresAfterAlias:
      return FieldPubkeyExpiresAfter
    default:
      return c
  }
}

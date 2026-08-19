// package: ranke / codec_json
// type:    io
// job:     the JSON projection to a Claim — every record slot, content base64
// limits:  reads a claim; an id is verified against the CBOR form, whose bytes it was signed
// over (spec §Output). A read may also cap the content JSON inlines.

import type { Claim, Edge } from './claim.ts'
import { RankeDecodeError, parseCreatedAt } from './codec.ts'
import { type ContentRef, contentNone } from './content.ts'
import type { RelationDirection } from './edge_taxonomy.ts'
import { splitType } from './filter.ts'
import { checkTimestampFields } from './time_fields.ts'

/**
 * WireClaim is the JSON a read returns under `encoding: json`, as ranke-go's
 * EncodeJSON renders it. Fields nest, since a field name may be spelled like a
 * structural key and flattening would let it overwrite one.
 */
export interface WireClaim {
  id?: string
  type?: string
  created_at?: string
  height?: number
  encoding?: string
  content_size?: number
  content_hash?: string
  content?: string
  fields?: Record<string, string>
  edges?: WireEdge[]
}

/** WireEdge is one edge of a WireClaim. */
export interface WireEdge {
  type?: string
  reference?: string
  relation_direction?: number
  encoding?: string
  content_size?: number
  content_hash?: string
  content?: string
  fields?: Record<string, string>
}

/**
 * decodeClaimJSON turns one JSON record into a Claim, so a caller reads the same
 * shape whichever encoding it asked the server for.
 *
 * The id comes from the record, which the JSON form carries and the CBOR form does
 * not — a projection names the claim it reports.
 */
export function decodeClaimJSON(w: WireClaim): Claim {
  if (typeof w !== 'object' || w === null) {
    throw new RankeDecodeError('a JSON claim is an object')
  }
  const type = str(w.type, 'type')
  const { typeClass, typeSub } = splitType(type)
  const createdAt = str(w.created_at, 'created_at')

  return Object.freeze({
    id: w.id ?? '',
    type,
    typeClass,
    typeSub,
    createdAt,
    createdAtMs: parseCreatedAt(createdAt),
    height: num(w.height, 'height'),
    fields: wireFields(w.fields),
    content: wireContent(w),
    edges: Object.freeze((w.edges ?? []).map(decodeEdgeJSON)),
  })
}

function decodeEdgeJSON(w: WireEdge): Edge {
  const type = str(w.type, 'edge type')
  const { typeClass, typeSub } = splitType(type)
  const dir = w.relation_direction ?? 0
  if (dir !== 0 && dir !== 1 && dir !== -1) {
    throw new RankeDecodeError(`relation_direction is +1 or -1, got ${dir}`)
  }
  return Object.freeze({
    reference: str(w.reference, 'edge reference'),
    type,
    typeClass,
    typeSub,
    fields: wireFields(w.fields),
    relationDirection: dir as RelationDirection,
    content: wireContent(w),
  })
}

// wireFields holds a JSON record's fields to `V-TIME`, the projection being a door a claim
// arrives through as much as the CBOR form is.
function wireFields(f: Record<string, string> | undefined): Readonly<Record<string, string>> {
  const out = { ...(f ?? {}) }
  const bad = checkTimestampFields(out)
  if (bad !== null) throw new RankeDecodeError(`a timestamp is not RFC 3339 nanoseconds: ${bad}`)
  return Object.freeze(out)
}

// wireContent resolves the declaration a JSON record carries. Content is base64, as JSON
// renders bytes. It resolves the same three ways codec.ts's `content` does, the projection
// carrying the same information as the record it projects (`R-QENCODING`).
function wireContent(w: WireClaim | WireEdge): ContentRef {
  const encoding = w.encoding ?? ''
  const size = w.content_size ?? 0
  if (w.content !== undefined) {
    if (w.content_hash !== undefined) {
      throw new RankeDecodeError('a record declares both inline content and a content hash')
    }
    return Object.freeze({ kind: 'inline', bytes: base64(w.content), size, encoding })
  }
  if (w.content_hash !== undefined) {
    return Object.freeze({ kind: 'external', hash: w.content_hash, size, encoding })
  }
  // A size with neither the bytes nor an address: inline content the read withheld
  // (`R-QCONTENT`), which a server serves size-first so a client sees that content exists
  // and how long it is. External content always states its address, so this is never an
  // address the projection dropped. It holds an empty run of bytes rather than none, so a
  // reader compares lengths as ever and contentComplete tells it apart from whole content.
  if (size > 0) return Object.freeze({ kind: 'inline', bytes: new Uint8Array(0), size, encoding })
  return contentNone
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v === '') {
    throw new RankeDecodeError(`a JSON claim states no ${what}`)
  }
  return v
}

function num(v: unknown, what: string): number {
  if (v === undefined) return 0
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new RankeDecodeError(`${what} is a non-negative integer, got ${String(v)}`)
  }
  return v
}

// base64 decodes without Buffer, which a browser lacks. atob yields one character
// per byte, so the mapping back is direct.
function base64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

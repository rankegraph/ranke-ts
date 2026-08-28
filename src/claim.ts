// package: ranke / claim
// type:    data
// job:     the Claim and Edge a decode yields — plain frozen data, addressed by string ids
// limits:  shapes only; the bytes become these in codec.ts, and nothing here verifies an id

import type { ContentRef } from './content.ts'
import type { RelationDirection } from './edge_taxonomy.ts'

/**
 * Edge is a directed reference from the owning claim back to the older claim it
 * cites (spec §4.2). Part of exactly one claim; may carry its own content.
 */
export interface Edge {
  /** The edge's own id, H(S(e)) — absent unless the decode was asked for it. */
  readonly id?: string
  /** The claim this edge cites, as a multibase id string. */
  readonly reference: string
  /** "class/sub", e.g. "derivation/register" or "contribution/contributor". */
  readonly type: string
  readonly typeClass: string
  readonly typeSub: string
  /** The edge's own fields, keyed as the taxonomy names them; wire aliases resolved. */
  readonly fields: Readonly<Record<string, string>>
  /** RelationFrom (+1) or RelationTo (-1) on relation/* edges, 0 elsewhere (§4.7). */
  readonly relationDirection: RelationDirection
  readonly content: ContentRef
}

/**
 * Claim is one node with all its outgoing edges — the unit a read returns and the
 * unit an id addresses.
 *
 * Plain data by design: at the hundreds of thousands of claims a browser holds,
 * peak heap decides throughput, so ids are strings and fields a plain record. Use
 * parseId when you need an id's payload rather than its name.
 */
export interface Claim {
  /**
   * id(v) = Sign(H(S(v))), as a multibase string. Empty when the bytes arrived
   * without it: a claim's own record does not carry its id.
   */
  readonly id: string
  /** "class/sub", e.g. "source/register". */
  readonly type: string
  readonly typeClass: string
  readonly typeSub: string
  /**
   * RFC 3339 with nanoseconds, exactly as signed. This is the value of record: the
   * id commits to it, and a Date cannot hold nanosecond precision.
   */
  readonly createdAt: string
  /** createdAt in epoch milliseconds, for sorting and display. Lossy by construction. */
  readonly createdAtMs: number
  /** The generation number: 1 + max(reference heights), 0 for an initial node (§4.1). */
  readonly height: number
  /**
   * EDTF Level 1, or an RFC 3339 instant — the time the claim's subject stems from
   * (`V-DATED`). Absent when the node carries none. Unlike createdAt this denotes an
   * interval rather than an instant, so no lossy millisecond projection is offered here.
   */
  readonly dated?: string
  /** The claim's own fields, keyed as the taxonomy names them; wire aliases resolved. */
  readonly fields: Readonly<Record<string, string>>
  readonly content: ContentRef
  readonly edges: readonly Edge[]
}

/** getField returns a field's value, or undefined when the record lacks it. */
export function getField(r: Claim | Edge, name: string): string | undefined {
  return r.fields[name]
}

/** hasField reports whether the record carries a field of that name. */
export function hasField(r: Claim | Edge, name: string): boolean {
  return Object.hasOwn(r.fields, name)
}

/**
 * edgesOfType returns the claim's edges whose type satisfies a type-glob list —
 * the same patterns a query's `edges` takes (see matchTypeList).
 */
export function edgesOfType(c: Claim, ...patterns: string[]): Edge[] {
  return c.edges.filter((e) => matchTypeList(patterns, e.type))
}

/** isContributorEdge reports the one edge every non-initial claim carries (§4.3). */
export function isContributorEdge(e: Edge): boolean {
  return e.type === 'contribution/contributor'
}

/**
 * contributorOf returns the id of the claim holding the key that signed c, or null
 * for an initial node, which carries its own (§5.7).
 */
export function contributorOf(c: Claim): string | null {
  for (const e of c.edges) {
    if (isContributorEdge(e)) return e.reference
  }
  return null
}

// matchTypeList is re-exported from filter.ts to keep edgesOfType self-contained
// for a caller who imports only this module.
import { matchTypeList } from './filter.ts'
export { matchTypeList }

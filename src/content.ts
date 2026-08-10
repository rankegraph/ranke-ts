// package: ranke / content
// type:    data
// job:     where a record's content lives — inline bytes, an external address, or nothing
// limits:  describes content; fetching external bytes is the caller's, and verifying them
// needs the hash this only carries

/**
 * ContentKind states whether and where a record's content lives. ranke-go has this
 * as an int enum on Universe; a string union reads in a debugger and needs no table.
 */
export type ContentKind = 'none' | 'inline' | 'external'

export const ContentNone = 'none'
export const ContentInline = 'inline'
export const ContentExternal = 'external'

/**
 * ContentRef is a node's or edge's content declaration. `inline` and `hash` are
 * mutually exclusive (§Content): the claim id commits to inline bytes directly,
 * while external content is addressed and fetched.
 */
export type ContentRef =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'inline'
      /**
       * What this record holds, which a capped read may cut to a prefix or to nothing
       * (R-QCONTENT). Compare its length against `size` — see contentComplete.
       */
      readonly bytes: Uint8Array
      /** The content's full length, whatever `bytes` holds of it. */
      readonly size: number
      /** The media type, "class/sub" — mandatory wherever content is present. */
      readonly encoding: string
    }
  | {
      readonly kind: 'external'
      /** H(content), as a multibase id string. */
      readonly hash: string
      readonly size: number
      readonly encoding: string
    }

/** contentNone is the shared value for a record carrying nothing. */
export const contentNone: ContentRef = Object.freeze({ kind: ContentNone })

/** hasContent reports whether a record declares content at all. */
export function hasContent(c: ContentRef): boolean {
  return c.kind !== ContentNone
}

/** contentSize is the declared byte length, 0 without content. */
export function contentSize(c: ContentRef): number {
  return c.kind === ContentNone ? 0 : c.size
}

/** contentEncoding is the media type, "" without content. */
export function contentEncoding(c: ContentRef): string {
  return c.kind === ContentNone ? '' : c.encoding
}

/**
 * inlineBytes returns the bytes the record holds, or null when the content is not
 * inline — external content lives in the Universe and is fetched by its hash. An inline
 * content a read cut to nothing returns an empty array, that record holding no bytes.
 */
export function inlineBytes(c: ContentRef): Uint8Array | null {
  return c.kind === ContentInline ? c.bytes : null
}

/** contentHeld is how many bytes this record carries, of the `size` it declares. */
export function contentHeld(c: ContentRef): number {
  return c.kind === ContentInline ? c.bytes.length : 0
}

/**
 * contentComplete reports whether the record holds every byte it declares. A capped read
 * (R-QCONTENT) serves a prefix, which kind and size alone cannot distinguish from whole
 * content. External content is complete only once fetched; no content, trivially.
 */
export function contentComplete(c: ContentRef): boolean {
  switch (c.kind) {
    case ContentNone:
      return true
    case ContentExternal:
      return false
    default:
      return c.bytes.length === c.size
  }
}

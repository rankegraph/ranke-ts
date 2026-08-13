// package: testing / fixtures
// type:    data
// job:     the reference claims a decode is checked against, read from the generated file
// limits:  test support, excluded from the published build
//
// claim_fixtures.json is written by tools/fixtures, a Go program importing ranke-go.
// Nothing here is transcribed: a hand-copied record is one nibble away from testing
// the wrong thing, and this file exists because that happened.
//
// Regenerate with `scripts/fixtures.sh` whenever the record layout or the alias
// tables move. `refusals` holds records ranke-go's decode rejects; the wider negative
// set lives in ranke-graph's published testdata (see vectors_test.ts).

import { readFileSync } from 'node:fs'

export interface Fixture {
  readonly label: string
  readonly id: string
  /** EncodeCBOR(FormOriginal), hex. */
  readonly cbor: string
  /** EncodeJSON(FormOriginal). */
  readonly json: unknown
  /** Each edge's type and id, in the claim's canonical edge order. */
  readonly edges: ReadonlyArray<{ readonly type: string; readonly id: string }>
}

/**
 * Provenance names the ranke-go that produced these bytes. Without it a fixture set
 * traces to whatever was checked out at the time, so a regeneration part-way through
 * a change bakes in an unreleased encoder with nothing to show it.
 */
export interface Provenance {
  /** The ranke-go module version, e.g. "v0.15.0". */
  readonly rankeGo: string
  /**
   * A path that stood in for the released module. Its presence means the fixtures
   * reproduce nothing, so the suite refuses them.
   */
  readonly substituted?: string
}

/**
 * Capped is one claim as a read serves it under an `output.content` option
 * (R-QCONTENT) — the bytes a client actually receives when a query caps content, which
 * `EncodeCBOR` alone never produces.
 */
export interface Capped {
  readonly label: string
  readonly id: string
  /** The `max` asked for; -1 stands for an absent `content` section. */
  readonly cap: number
  /** The `overflow` asked for; "" where none was, which means omit. */
  readonly overflow: string
  /** The content's true length, taken from the claim that was built. */
  readonly size: number
  /**
   * content_size read back off the served record. It must equal `size` for every
   * option: were a capping engine to write the truncated length, the record would stop
   * verifying against its id and the shortfall would be unrecoverable.
   */
  readonly declared: number
  /** The bytes the served record carries, which is what the cap decided. */
  readonly inline: number
  readonly cbor: string
  readonly json: unknown
}

/**
 * Refusal is a record ranke-go's decode rejects. Agreement on the accepted set says
 * nothing about what a reader lets through, which is what these cases hold.
 */
export interface Refusal {
  readonly label: string
  readonly cbor: string
  /** ranke-go's message, for reading a failure: each library words a refusal its own way. */
  readonly error: string
}

interface FixtureFile {
  readonly note: string
  readonly provenance: Provenance
  readonly ids: Readonly<Record<string, string>>
  readonly fixtures: readonly Fixture[]
  readonly capped: readonly Capped[]
  readonly refusals: readonly Refusal[]
}

const file: FixtureFile = JSON.parse(
  readFileSync(new URL('./claim_fixtures.json', import.meta.url), 'utf8'),
)

/** ids names each fixture claim, plus the external content hash one edge carries. */
export const ids = file.ids

/** provenance names the ranke-go release these bytes came from. */
export const provenance: Provenance = file.provenance

export const all: readonly Fixture[] = file.fixtures

/** capped holds the source claim served under each content option R-QCONTENT admits. */
export const capped: readonly Capped[] = file.capped

/** refusals holds records ranke-go's decode rejects, each with the reason it gave. */
export const refusals: readonly Refusal[] = file.refusals

function byLabel(label: string): Fixture {
  const f = all.find((x) => x.label === label)
  if (f === undefined) throw new Error(`fixture ${label} is missing — regenerate the file`)
  return f
}

/** An initial node: a contributor claim whose content is its multikey pubkey. */
export const contributor = byLabel('contributor')
/** A source with inline content and three fields, two of which pin key ordering. */
export const source = byLabel('source')
/** An entity resting on the source it was read from. */
export const entity = byLabel('entity')
/**
 * The rich one: a relation claim whose edges carry a direction, their own fields,
 * inline content, and an external content address — every slot an edge holds.
 */
export const relation = byLabel('relation')
/** A limiting claim, which exercises the newly aliased contribution/delete subtype. */
export const deletion = byLabel('deletion')

// Identity-signed claims: id = H(S(v)), no key involved (§5.7). These are the only
// cases a keyless implementation can reproduce whole, id included, so they are what
// proves a builder rather than only an encoder.
export const identityRoot = byLabel('identity-root')
export const identityNote = byLabel('identity-note')
export const identityDerived = byLabel('identity-derived')

/** cborBytes decodes a fixture's hex. */
export function cborBytes(f: Fixture | Capped | Refusal): Uint8Array {
  const out = new Uint8Array(f.cbor.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(f.cbor.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

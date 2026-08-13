// package: ranke / taxonomy
// type:    logic
// job:     the closed edge-type vocabulary (§4.8) — classes, subtypes, and their compact aliases —
// with enumeration/validation helpers
// limits:  vocabulary only; edge construction and matching live elsewhere (-> edge, filter)

export const EdgeClassContribution = 'contribution'
export const EdgeClassContributionAlias = 'c'
export const EdgeClassDerivation = 'derivation'
export const EdgeClassDerivationAlias = 'd'
export const EdgeClassRelation = 'relation'
export const EdgeClassRelationAlias = 'r'

/** EdgeClass is the closed top-level vocabulary for edge types. */
export type EdgeClass =
  | typeof EdgeClassContribution
  | typeof EdgeClassDerivation
  | typeof EdgeClassRelation

/** EdgeClasses lists every edge class, for validation and enumeration. */
export const EdgeClasses: readonly EdgeClass[] = [
  EdgeClassDerivation,
  EdgeClassRelation,
  EdgeClassContribution,
]

/** validEdgeClass narrows an untrusted string to the closed vocabulary. */
export function validEdgeClass(c: string): c is EdgeClass {
  return (EdgeClasses as readonly string[]).includes(c)
}

/**
 * EdgeSubtype is a contribution/* edge subtype. Only contribution/* has a closed
 * subtype set; derivation/* and relation/* subtypes are open vocabulary.
 */
export type EdgeSubtype = string

export const EdgeSubtypeContributor = 'contributor'
export const EdgeSubtypeContributorAlias = 'c'
export const EdgeSubtypeHead = 'head'
export const EdgeSubtypeHeadAlias = 'h'
export const EdgeSubtypeBranches = 'branches'
export const EdgeSubtypeBranchesAlias = 'B'
export const EdgeSubtypeBranch = 'branch'
export const EdgeSubtypeBranchAlias = 'b'
export const EdgeSubtypePrune = 'prune'
export const EdgeSubtypePruneAlias = 'p'
export const EdgeSubtypeDiff = 'diff'
export const EdgeSubtypeDiffAlias = 'd'
// A limiting claim points at its target through an edge of its own class (paper 1
// §Type Vocabulary): delete documents a gap where bytes were, expiry names the last
// time a contributor's key is valid.
export const EdgeSubtypeDelete = 'delete'
export const EdgeSubtypeDeleteAlias = 'x'
export const EdgeSubtypeExpiry = 'expiry'
export const EdgeSubtypeExpiryAlias = 'e'

// Closed contribution/* edge type strings. Branch and Prune are edge-only — no
// claim counterpart.
export const EdgeTypeContributor = `${EdgeClassContribution}/${EdgeSubtypeContributor}`
export const EdgeTypeHead = `${EdgeClassContribution}/${EdgeSubtypeHead}`
export const EdgeTypeBranches = `${EdgeClassContribution}/${EdgeSubtypeBranches}`
export const EdgeTypeBranch = `${EdgeClassContribution}/${EdgeSubtypeBranch}`
export const EdgeTypePrune = `${EdgeClassContribution}/${EdgeSubtypePrune}`
export const EdgeTypeDiff = `${EdgeClassContribution}/${EdgeSubtypeDiff}`
export const EdgeTypeDelete = `${EdgeClassContribution}/${EdgeSubtypeDelete}`
export const EdgeTypeExpiry = `${EdgeClassContribution}/${EdgeSubtypeExpiry}`

/**
 * edgeClassToAlias / edgeClassFromAlias convert the closed edge classes; unknown
 * values pass through unchanged.
 */
export function edgeClassToAlias(c: string): string {
  switch (c) {
    case EdgeClassContribution:
      return EdgeClassContributionAlias
    case EdgeClassDerivation:
      return EdgeClassDerivationAlias
    case EdgeClassRelation:
      return EdgeClassRelationAlias
    default:
      return c
  }
}

export function edgeClassFromAlias(c: string): string {
  switch (c) {
    case EdgeClassContributionAlias:
      return EdgeClassContribution
    case EdgeClassDerivationAlias:
      return EdgeClassDerivation
    case EdgeClassRelationAlias:
      return EdgeClassRelation
    default:
      return c
  }
}

/**
 * edgeSubtypeToAlias / edgeSubtypeFromAlias convert the closed contribution/* edge
 * subtypes (`V-ALIAS`); open-vocabulary subtypes pass through unchanged.
 */
export function edgeSubtypeToAlias(s: string): string {
  switch (s) {
    case EdgeSubtypeContributor:
      return EdgeSubtypeContributorAlias
    case EdgeSubtypeHead:
      return EdgeSubtypeHeadAlias
    case EdgeSubtypeBranches:
      return EdgeSubtypeBranchesAlias
    case EdgeSubtypeBranch:
      return EdgeSubtypeBranchAlias
    case EdgeSubtypePrune:
      return EdgeSubtypePruneAlias
    case EdgeSubtypeDiff:
      return EdgeSubtypeDiffAlias
    case EdgeSubtypeDelete:
      return EdgeSubtypeDeleteAlias
    case EdgeSubtypeExpiry:
      return EdgeSubtypeExpiryAlias
    default:
      return s
  }
}

export function edgeSubtypeFromAlias(s: string): string {
  switch (s) {
    case EdgeSubtypeContributorAlias:
      return EdgeSubtypeContributor
    case EdgeSubtypeHeadAlias:
      return EdgeSubtypeHead
    case EdgeSubtypeBranchesAlias:
      return EdgeSubtypeBranches
    case EdgeSubtypeBranchAlias:
      return EdgeSubtypeBranch
    case EdgeSubtypePruneAlias:
      return EdgeSubtypePrune
    case EdgeSubtypeDiffAlias:
      return EdgeSubtypeDiff
    case EdgeSubtypeDeleteAlias:
      return EdgeSubtypeDelete
    case EdgeSubtypeExpiryAlias:
      return EdgeSubtypeExpiry
    default:
      return s
  }
}

/**
 * RelationDirection tags an entity's role on a relation/* edge (§4.7): zero = not
 * a relation edge, RelationFrom (+1) / RelationTo (-1) otherwise. All-from or
 * all-to expresses a symmetric relation.
 */
export type RelationDirection = 0 | 1 | -1

export const RelationFrom: RelationDirection = 1
export const RelationTo: RelationDirection = -1

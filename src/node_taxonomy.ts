// package: ranke / taxonomy
// type:    logic
// job:     the closed node-type vocabulary (§4.8) — classes, subtypes, and their compact aliases —
// with enumeration/validation helpers
// limits:  vocabulary only; node construction and content live elsewhere (-> node)

export const NodeClassContribution = 'contribution'
export const NodeClassContributionAlias = 'c'
export const NodeClassSource = 'source'
export const NodeClassSourceAlias = 's'
export const NodeClassDerivation = 'derivation'
export const NodeClassDerivationAlias = 'd'
export const NodeClassEntity = 'entity'
export const NodeClassEntityAlias = 'e'
export const NodeClassRelation = 'relation'
export const NodeClassRelationAlias = 'r'

/**
 * NodeClass is the closed top-level vocabulary for node types. Being closed, it is
 * a union here where ranke-go uses a named string type with a separate validator.
 */
export type NodeClass =
  | typeof NodeClassContribution
  | typeof NodeClassSource
  | typeof NodeClassDerivation
  | typeof NodeClassEntity
  | typeof NodeClassRelation

/** NodeClasses lists every node class, for validation and enumeration. */
export const NodeClasses: readonly NodeClass[] = [
  NodeClassContribution,
  NodeClassSource,
  NodeClassDerivation,
  NodeClassEntity,
  NodeClassRelation,
]

/** validNodeClass narrows an untrusted string to the closed vocabulary. */
export function validNodeClass(c: string): c is NodeClass {
  return (NodeClasses as readonly string[]).includes(c)
}

/**
 * NodeSubtype is the second-level node-type vocabulary (the "/sub" part). Only the
 * contribution/* subtypes below are closed; the rest is open vocabulary.
 */
export type NodeSubtype = string

// "branch" and "diff" are absent: both are edge subtypes alone. A branch is named by a
// contribution/branch edge on the table, and diff-ness lives in the contribution/diff
// edge, so no node carries either. @tbl:aliases still assigns them b and d — one table
// shared by nodes and edges — which the edge side holds.
export const NodeSubtypeBranches = 'branches'
export const NodeSubtypeBranchesAlias = 'B'
export const NodeSubtypeContributor = 'contributor'
export const NodeSubtypeContributorAlias = 'c'
export const NodeSubtypeHead = 'head'
export const NodeSubtypeHeadAlias = 'h'
// The limiting claims (paper 1 §Type Vocabulary). Each takes the letter its edge
// subtype takes, as contributor, head and diff already do.
export const NodeSubtypeDelete = 'delete'
export const NodeSubtypeDeleteAlias = 'x'
export const NodeSubtypeExpiry = 'expiry'
export const NodeSubtypeExpiryAlias = 'e'

// Closed contribution/* node type strings.
export const NodeTypeContributor = `${NodeClassContribution}/${NodeSubtypeContributor}`
export const NodeTypeHead = `${NodeClassContribution}/${NodeSubtypeHead}`
export const NodeTypeBranches = `${NodeClassContribution}/${NodeSubtypeBranches}`

/**
 * nodeClassToAlias maps a canonical node class to its single-char alias;
 * unknown / already-aliased values pass through unchanged.
 */
export function nodeClassToAlias(c: string): string {
  switch (c) {
    case NodeClassContribution:
      return NodeClassContributionAlias
    case NodeClassSource:
      return NodeClassSourceAlias
    case NodeClassDerivation:
      return NodeClassDerivationAlias
    case NodeClassEntity:
      return NodeClassEntityAlias
    case NodeClassRelation:
      return NodeClassRelationAlias
    default:
      return c
  }
}

/**
 * nodeClassFromAlias maps a single-char alias back to its canonical node class;
 * canonical / unknown values pass through unchanged.
 */
export function nodeClassFromAlias(c: string): string {
  switch (c) {
    case NodeClassContributionAlias:
      return NodeClassContribution
    case NodeClassSourceAlias:
      return NodeClassSource
    case NodeClassDerivationAlias:
      return NodeClassDerivation
    case NodeClassEntityAlias:
      return NodeClassEntity
    case NodeClassRelationAlias:
      return NodeClassRelation
    default:
      return c
  }
}

/**
 * nodeSubtypeToAlias / nodeSubtypeFromAlias convert the closed node subtypes;
 * open-vocabulary subtypes pass through unchanged.
 */
export function nodeSubtypeToAlias(s: string): string {
  switch (s) {
    case NodeSubtypeContributor:
      return NodeSubtypeContributorAlias
    case NodeSubtypeBranches:
      return NodeSubtypeBranchesAlias
    case NodeSubtypeHead:
      return NodeSubtypeHeadAlias
    case NodeSubtypeDelete:
      return NodeSubtypeDeleteAlias
    case NodeSubtypeExpiry:
      return NodeSubtypeExpiryAlias
    default:
      return s
  }
}

export function nodeSubtypeFromAlias(s: string): string {
  switch (s) {
    case NodeSubtypeContributorAlias:
      return NodeSubtypeContributor
    case NodeSubtypeBranchesAlias:
      return NodeSubtypeBranches
    case NodeSubtypeHeadAlias:
      return NodeSubtypeHead
    case NodeSubtypeDeleteAlias:
      return NodeSubtypeDelete
    case NodeSubtypeExpiryAlias:
      return NodeSubtypeExpiry
    default:
      return s
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  NodeClassContribution,
  NodeClassContributionAlias,
  NodeClassDerivation,
  NodeClassDerivationAlias,
  NodeClassEntity,
  NodeClassEntityAlias,
  NodeClassRelation,
  NodeClassRelationAlias,
  NodeClassSource,
  NodeClassSourceAlias,
  NodeSubtypeBranches,
  NodeSubtypeBranchesAlias,
  NodeSubtypeContributor,
  NodeSubtypeContributorAlias,
  NodeSubtypeDelete,
  NodeSubtypeDeleteAlias,
  NodeSubtypeExpiry,
  NodeSubtypeExpiryAlias,
  NodeSubtypeHead,
  NodeSubtypeHeadAlias,
  nodeClassFromAlias,
  nodeClassToAlias,
  nodeSubtypeFromAlias,
  nodeSubtypeToAlias,
  validNodeClass,
} from './node_taxonomy.ts'
import {
  EdgeSubtypeBranch,
  EdgeSubtypeBranchAlias,
  EdgeSubtypeDiff,
  EdgeSubtypeDiffAlias,
  edgeSubtypeFromAlias,
  edgeSubtypeToAlias,
} from './edge_taxonomy.ts'
import { checkAliasRoundTrip, checkSingleCharacter } from './testing/alias_check.ts'

// Foundation unit tests for the node wire aliases (§5.1). To optimise encoding size
// the reserved vocabulary has one-character short forms, and "an alias is
// semantically identical to its long form." testing/alias_check.ts holds the
// assertions that pin it, shared with the other taxonomy tests.

test('node class aliases', () => {
  checkAliasRoundTrip(
    new Map([
      [NodeClassContribution, NodeClassContributionAlias],
      [NodeClassSource, NodeClassSourceAlias],
      [NodeClassDerivation, NodeClassDerivationAlias],
      [NodeClassEntity, NodeClassEntityAlias],
      [NodeClassRelation, NodeClassRelationAlias],
    ]),
    nodeClassToAlias,
    nodeClassFromAlias,
    'madeupclass',
  )
})

test('node subtype aliases', () => {
  checkAliasRoundTrip(
    new Map([
      [NodeSubtypeContributor, NodeSubtypeContributorAlias],
      [NodeSubtypeBranches, NodeSubtypeBranchesAlias],
      [NodeSubtypeHead, NodeSubtypeHeadAlias],
      [NodeSubtypeDelete, NodeSubtypeDeleteAlias],
      [NodeSubtypeExpiry, NodeSubtypeExpiryAlias],
    ]),
    nodeSubtypeToAlias,
    nodeSubtypeFromAlias,
    'email', // open vocabulary
  )
})

// @tbl:aliases is ONE "type subtype" column that nodes and edges share, which this
// library splits across node_taxonomy.ts and edge_taxonomy.ts. Wherever both halves know
// a name or a letter they must say the same thing, or one claim's node and edge
// abbreviate the same subtype differently.
//
// A subtype only one half knows is legitimate — "branch" and "diff" are edge-only — so
// the check applies where they overlap. It catches a letter reused for two meanings,
// which is what splitting one table into two makes possible.
test('the subtype alias tables agree', () => {
  // Every subtype either table declares, so a name added to one and forgotten in the
  // other is still probed here.
  const names = ['contributor', 'head', 'branches', 'branch', 'diff', 'prune', 'delete', 'expiry']
  for (const name of names) {
    const node = nodeSubtypeToAlias(name)
    const edge = edgeSubtypeToAlias(name)
    if (node === name || edge === name) continue // one half passes the name through
    assert.equal(node, edge, `subtype ${JSON.stringify(name)} is abbreviated two ways`)
  }

  // The same agreement read back: a letter both halves decode must decode alike.
  for (let c = 'A'.charCodeAt(0); c <= 'z'.charCodeAt(0); c++) {
    const letter = String.fromCharCode(c)
    const node = nodeSubtypeFromAlias(letter)
    const edge = edgeSubtypeFromAlias(letter)
    if (node === letter || edge === letter) continue
    assert.equal(node, edge, `alias ${JSON.stringify(letter)} means two things`)
  }
})

// Removing the node-side "branch" and "diff" left @tbl:aliases untouched, so the edge
// side must still hold b and d.
test('the edge-only subtypes keep their letters', () => {
  assert.equal(edgeSubtypeToAlias(EdgeSubtypeBranch), 'b')
  assert.equal(edgeSubtypeToAlias(EdgeSubtypeDiff), 'd')
  assert.equal(edgeSubtypeFromAlias(EdgeSubtypeBranchAlias), 'branch')
  assert.equal(edgeSubtypeFromAlias(EdgeSubtypeDiffAlias), 'diff')
})

test('node aliases are a single character', () => {
  checkSingleCharacter(
    [NodeClassContribution, NodeClassSource, NodeClassDerivation, NodeClassEntity, NodeClassRelation],
    nodeClassToAlias,
  )
  checkSingleCharacter(
    [
      NodeSubtypeContributor,
      NodeSubtypeBranches,
      NodeSubtypeHead,
      NodeSubtypeDelete,
      NodeSubtypeExpiry,
    ],
    nodeSubtypeToAlias,
  )
})

test('validNodeClass admits the closed set and nothing else', () => {
  for (const c of [
    NodeClassContribution,
    NodeClassSource,
    NodeClassDerivation,
    NodeClassEntity,
    NodeClassRelation,
  ]) {
    assert.ok(validNodeClass(c), c)
  }
  // The aliases are a wire form, so they are not classes in their own right.
  for (const c of ['c', 's', 'd', 'e', 'r', '', 'Contribution', 'madeupclass']) {
    assert.ok(!validNodeClass(c), JSON.stringify(c))
  }
})

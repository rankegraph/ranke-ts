// package: ranke / query
// type:    data
// job:     the RankeQL query type — a read, stated declaratively
// limits:  the type only; encoding and the shape checks are query_codec.ts's, and executing
// a query needs the graph, which is RankeDB's (ranke-go -> query_default.go)
//
// GENERATED from schema/rql.schema.json by scripts/generate.sh. Do not edit: the
// schema is the read language's one definition, which ranke-go implements and
// ranke-db's openapi.yaml $refs. Take a new release with scripts/pull-rql-schema.sh,
// regenerate, and review the diff.

/**
 * A generator in four independent parts: branch is the scope, head the closure read, claim where the walk starts, path the traversal. Scope and start are independent because a walk runs both ways — a uses step reaches the claims that cite the current one, which lie above it, so the closure decides a reverse step's answer.
 */
export type Select = {
  [k: string]: unknown;
} & {
  /**
   * The mandatory scope, and every scope names a graph: a branch name confines to that branch, $archive to the whole Ranke-Archive, $universe applies no confinement and is privileged. An empty value is refused (R-QSCOPE).
   */
  branch: string;
  /**
   * The closure read: the query sees the intersection of the scope's graph and closure(head), so a head narrows a query. Required under $universe, which confines nothing and so offers no head to fall back on, and may name any claim the Universe holds there; optional under every other scope, where the scope's own head serves (R-QHEAD).
   */
  head?: string;
  /**
   * Anchors the frontier at the single claim it names, which must lie inside the closure. Absent, the frontier is every claim in the closure and the path is unanchored (R-QANCHOR).
   */
  claim?: string;
  /**
   * The traversal: a sequence of steps over frontiers, each frontier a set of claims. Each step's yield is the frontier the next starts from, and the no-repeat rule holds within a step and resets at each boundary, so membership is all a frontier carries (R-QFRONTIER). Absent, the generator returns the full outward closure of the frontier (R-QSTEPS).
   */
  path?: PathStep[];
};
/**
 * A glob over class/sub, e.g. derivation/* or entity/person. A leading - excludes. Exclusion decides: a type matching an excluded pattern is refused whatever the included patterns say, and a list of exclusions alone admits every other type (R-QSTEPS).
 */
export type TypeGlob = string;
/**
 * A boolean tree. Each node is exactly one of the and / or / not combinators over sub-trees, or a leaf naming a field and its test. Within a where, or is boolean; across generators it unions whole result sets. A leaf may name any field a claim carries, height included (V-HEIGHT).
 */
export type Where =
  | {
      /**
       * @minItems 1
       */
      and: [Where, ...Where[]];
    }
  | {
      /**
       * @minItems 1
       */
      or: [Where, ...Where[]];
    }
  | {
      not: Where;
    }
  | {
      /**
       * The field tested — any field a claim carries, height included.
       */
      field: string;
      test: Comparison;
    };
/**
 * A value a comparison tests against. How two values compare is the engine's, so the shape is unconstrained here.
 */
export type Value = unknown;
/**
 * Sort keys applied in priority order. Claims lacking a key's field sort last, and the archive's natural (created_at, id) order breaks any remaining ties, so the sort always resolves to a total order (R-QSORT).
 */
export type Order = OrderKey[];

/**
 * A read, evaluated in a fixed logical order: select generates the result set, where filters it, order sorts it, limit truncates it, output shapes and encodes each surviving claim (R-QEVAL).
 */
export interface Query {
  select: Select;
  where?: Where;
  output?: Output;
  order?: Order;
  limit?: Limit;
  execution?: Execution;
}
/**
 * One section of a path. edges bounds the walk: every hop must follow an edge whose type is listed. nodes bounds the answer: a step yields a claim only when its node's type is listed, whatever the nodes it crossed to reach it. min and max bound the hops. A min above a bounded max is refused by the implementation — a JSON Schema cannot compare two sibling values (R-QSTEPS).
 */
export interface PathStep {
  /**
   * Edge types every hop must match.
   */
  edges?: TypeGlob[];
  /**
   * provenance follows references outward, uses runs to the claims that cite this one, connections either way. Absent, provenance.
   */
  dir?: "provenance" | "uses" | "connections";
  /**
   * Fewest hops. Absent, 1 — a step moves at least one hop. 0 also yields the starting set, carrying the frontier through alongside what lies beyond it.
   */
  min?: number;
  /**
   * Most hops. 0, or absent, leaves the step unbounded: a step of at most zero hops would move nothing, so that reading has no use.
   */
  max?: number;
  /**
   * Node types the step may yield.
   */
  nodes?: TypeGlob[];
}
/**
 * One operator applied to one field. eq, ne, lt, le, gt and ge take a value, in a set, glob a shell-style wildcard. Exactly one is present.
 */
export interface Comparison {
  eq?: Value;
  ne?: Value;
  lt?: Value;
  le?: Value;
  gt?: Value;
  ge?: Value;
  /**
   * Set membership.
   */
  in?: Value[];
  /**
   * Shell-style wildcard.
   */
  glob?: string;
}
/**
 * Shapes each result along orthogonal axes. detail: claims with form: original and encoding: cbor reproduces the canonical serialization S(v) a claim's id is computed over, and is the only output form directly verifiable against that id (R-QCANON).
 */
export interface Output {
  /**
   * single yields the reached endpoints, one element each; path yields routes, each running outward from the frontier claim its walk began at (R-QSHAPE).
   */
  shape?: "single" | "path";
  /**
   * What each element carries: id (the id alone) or claims (the claim in full). Under shape: path it applies to every claim in the route (R-QDETAIL).
   */
  detail?: "id" | "claims";
  /**
   * Which field values a claim carries: original as written, a diff-overlaid claim's delta; materialized with any contribution/diff chain resolved over the predecessor it references, recursively to a base claim. A property of the values, hence orthogonal to detail and encoding (R-QFORM).
   */
  form?: "original" | "materialized";
  content?: OutputContent;
  /**
   * json is text with content base64-encoded, cbor is binary; the same information either way (R-QENCODING).
   */
  encoding?: "json" | "cbor";
}
/**
 * Inline content per claim. Absent, no content is inlined (R-QCONTENT).
 */
export interface OutputContent {
  /**
   * Cap in bytes on the content inlined per claim; 0 inlines every claim's content in full.
   */
  max: number;
  /**
   * What becomes of content past the cap: cutoff inlines the bytes up to it, omit inlines whole values only. Absent, omit. A claim keeps every field it carries either way (R-QCONTENT).
   */
  overflow?: "cutoff" | "omit";
}
export interface OrderKey {
  /**
   * The field sorted on — any field a claim carries, height included.
   */
  field: string;
  /**
   * How the values compare (R-QSORT).
   */
  compare?: "numeric" | "lexical";
  /**
   * Sort direction (R-QSORT).
   */
  dir?: "asc" | "desc";
}
/**
 * Bounds the read. A read cut short by either bound is a complete answer to the query as bounded, not an error (R-QLIMIT).
 */
export interface Limit {
  /**
   * Caps the claim count; 0 is unbounded.
   */
  results?: number;
  /**
   * The execution budget; 0 is unbounded.
   */
  time?: string;
}
/**
 * Where the query runs and how it reports on itself. These controls reach execution and diagnostics, and never the result set.
 */
export interface Execution {
  /**
   * Pins the query to one named storage or execution layer; absent, the backend chooses by capability.
   */
  layer?: string;
  /**
   * Report verbosity: info gives high-level stages, debug routing and translation, trace per-claim detail. Set, and only then, the stream carries one final report record after the last element, typed distinctly from result claims (R-QREPORT).
   */
  report?: "info" | "debug" | "trace";
}

// Command queryoracle emits ranke-go's verdict on a table of RQL queries, given as
// the canonical JSON both implementations read. ranke-go is the reference
// implementation, so this file is the specification of ranke-ts's validator rather
// than a sample of it.
//
// The verdict is the combined one a client cares about — would ranke-go accept this
// JSON as a query — so it runs DecodeQuery, which refuses the values only a Go caller
// may set, and then ValidateQuery.
//
// Regenerate with: go run ./queryoracle > ../src/testing/query_oracle.json
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"runtime/debug"

	ranke "github.com/flocko-motion/ranke-go"
)

const rankeGoModule = "github.com/flocko-motion/ranke-go"

type verdict struct {
	// Label says what the case exercises, so a disagreement reads as a sentence.
	Label string `json:"label"`
	// Query is the canonical JSON, verbatim — the input both sides start from.
	Query json.RawMessage `json:"query"`
	// Accepted is whether ranke-go took it.
	Accepted bool `json:"accepted"`
	// Code names the sentinel it was refused under, empty when accepted. A refusal
	// with no code is one this table does not classify.
	Code string `json:"code,omitempty"`
	// Codes is every sentinel errors.Is matches, since one condition may answer to two
	// rules. Recording only the first would leave that pairing untestable downstream.
	Codes []string `json:"codes,omitempty"`
	// Detail is ranke-go's message, for reading a failure rather than for asserting.
	Detail string `json:"detail,omitempty"`
}

// sentinels are the refusals a client can act on, in the order a check should
// report them: the first match names the rule.
var sentinels = []struct {
	code string
	err  error
}{
	{"ErrQueryNoScope", ranke.ErrQueryNoScope},
	{"ErrQueryNoHead", ranke.ErrQueryNoHead},
	{"ErrQueryScanShape", ranke.ErrQueryScanShape},
	{"ErrQueryWhereForm", ranke.ErrQueryWhereForm},
	{"ErrQueryComparisonForm", ranke.ErrQueryComparisonForm},
	{"ErrQueryHops", ranke.ErrQueryHops},
	{"ErrQueryBounds", ranke.ErrQueryBounds},
	{"ErrQueryEncoding", ranke.ErrQueryEncoding},
	{"ErrQueryEnum", ranke.ErrQueryEnum},
}

// classify returns every sentinel err matches, in table order, so the first is the
// rule an error message names and the rest are the ones it also answers to.
func classify(err error) []string {
	var out []string
	for _, s := range sentinels {
		if errors.Is(err, s.err) {
			out = append(out, s.code)
		}
	}
	return out
}

func main() {
	cases := []struct {
		label string
		query string
	}{
		// --- accepted ---
		{"the smallest read: a scope and nothing else", `{"select":{"branch":"main"}}`},
		{"$archive as the scope", `{"select":{"branch":"$archive"}}`},
		{
			"$universe with the head it requires",
			`{"select":{"branch":"$universe","head":"bciqlu6awx6hqdt7kifaubxs5vyrchmadmgrzmf32ts2bb73b6iablli"}}`,
		},
		{
			"a path with every step field",
			`{"select":{"branch":"main","path":[{"edges":["derivation/*","-derivation/scan"],` +
				`"dir":"connections","min":0,"max":4,"nodes":["entity/person"]}]}}`,
		},
		{"an unbounded step: max 0", `{"select":{"branch":"main","path":[{"max":0}]}}`},
		{"a two-step frontier pipeline", `{"select":{"branch":"main","path":[{"max":2},{"dir":"uses"}]}}`},
		{
			"a where leaf under every operator",
			`{"select":{"branch":"main"},"where":{"and":[` +
				`{"field":"a","test":{"eq":"x"}},{"field":"b","test":{"ne":1}},` +
				`{"field":"c","test":{"lt":2}},{"field":"d","test":{"le":3}},` +
				`{"field":"e","test":{"gt":4}},{"field":"f","test":{"ge":5}},` +
				`{"field":"g","test":{"in":["x","y"]}},{"field":"h","test":{"glob":"s*"}}]}}`,
		},
		{
			"an explicit empty in set, which is present and so counts",
			`{"select":{"branch":"main"},"where":{"field":"a","test":{"in":[]}}}`,
		},
		{
			"or and not nested",
			`{"select":{"branch":"main"},"where":{"or":[{"not":{"field":"a","test":{"eq":1}}},` +
				`{"field":"b","test":{"eq":2}}]}}`,
		},
		{
			"a false value survives, being present",
			`{"select":{"branch":"main"},"where":{"field":"a","test":{"eq":false}}}`,
		},
		{
			"every output axis",
			`{"select":{"branch":"main","path":[{}]},"output":{"shape":"path","detail":"claims",` +
				`"form":"original","encoding":"cbor","content":{"max":4096,"overflow":"cutoff"}}}`,
		},
		{"a zero content cap", `{"select":{"branch":"main"},"output":{"content":{"max":0,"overflow":"omit"}}}`},
		// An absent overflow is omit (R-QCONTENT), so a cap alone is a whole pair.
		{"a content cap with no overflow rule", `{"select":{"branch":"main"},"output":{"content":{"max":10}}}`},
		{
			"order, limit and execution",
			`{"select":{"branch":"main"},"order":[{"field":"height","compare":"numeric","dir":"desc"},` +
				`{"field":"title"}],"limit":{"results":200,"time":"1m30s"},` +
				`"execution":{"layer":"neo4j","report":"debug"}}`,
		},
		{"a bare zero duration means unbounded", `{"select":{"branch":"main"},"limit":{"time":"0"}}`},
		{"a fractional duration", `{"select":{"branch":"main"},"limit":{"time":"1.5s"}}`},
		{"results 0 means unbounded", `{"select":{"branch":"main"},"limit":{"results":0}}`},
		{"a scan may ask for shape single", `{"select":{"branch":"main"},"output":{"shape":"single"}}`},
		// A path-less claim anchors the frontier the closure is taken from (R-QANCHOR),
		// so it is a read of what one claim reaches rather than a traversal with no start.
		{
			"a path-less claim anchors the frontier",
			`{"select":{"branch":"main","claim":"bciqlu6awx6hqdt7kifaubxs5vyrchmadmgrzmf32ts2bb73b6iablli"}}`,
		},

		// --- refused ---
		{"no scope at all", `{"select":{}}`},
		{"an empty scope", `{"select":{"branch":""}}`},
		{"$universe without a head", `{"select":{"branch":"$universe"}}`},
		{"min above a bounded max", `{"select":{"branch":"main","path":[{"min":3,"max":2}]}}`},
		{"an unknown dir", `{"select":{"branch":"main","path":[{"dir":"sideways"}]}}`},
		{
			"a where node with two forms",
			`{"select":{"branch":"main"},"where":{"and":[{"field":"a","test":{"eq":1}}],` +
				`"or":[{"field":"b","test":{"eq":2}}]}}`,
		},
		{"a where node with no form", `{"select":{"branch":"main"},"where":{}}`},
		{"a leaf missing its test", `{"select":{"branch":"main"},"where":{"field":"a"}}`},
		{"a leaf missing its field", `{"select":{"branch":"main"},"where":{"test":{"eq":1}}}`},
		{
			"a comparison with two operators",
			`{"select":{"branch":"main"},"where":{"field":"a","test":{"eq":1,"ne":2}}}`,
		},
		{"a comparison with none", `{"select":{"branch":"main"},"where":{"field":"a","test":{}}}`},
		{"an unknown shape", `{"select":{"branch":"main"},"output":{"shape":"tree"}}`},
		{"an unknown detail", `{"select":{"branch":"main"},"output":{"detail":"everything"}}`},
		// "graph" asked for the closed graph, a claim cut down to the edges among the
		// results, and left the vocabulary when R-QDETAIL settled on id or claims.
		{"the retired graph detail", `{"select":{"branch":"main"},"output":{"detail":"graph"}}`},
		{"an unknown form", `{"select":{"branch":"main"},"output":{"form":"resolved"}}`},
		{"the native encoding, which only a Go caller may set", `{"select":{"branch":"main"},"output":{"encoding":"native"}}`},
		{"an unknown encoding", `{"select":{"branch":"main"},"output":{"encoding":"yaml"}}`},
		{"an unknown overflow rule", `{"select":{"branch":"main"},"output":{"content":{"max":10,"overflow":"wrap"}}}`},
		// "reference" left the vocabulary: it stood in for content a claim had, where
		// R-QCONTENT now has a claim keep every field either way.
		{"the retired reference overflow", `{"select":{"branch":"main"},"output":{"content":{"max":10,"overflow":"reference"}}}`},
		{"max 0 inlines content in full", `{"select":{"branch":"main"},"output":{"content":{"max":0,"overflow":"omit"}}}`},
		{"an unknown collation", `{"select":{"branch":"main"},"order":[{"field":"a","compare":"natural"}]}`},
		{"an unknown sort direction", `{"select":{"branch":"main"},"order":[{"field":"a","dir":"up"}]}`},
		{"a report level only a Go caller may set", `{"select":{"branch":"main"},"execution":{"report":"warn"}}`},
		{"an unknown report level", `{"select":{"branch":"main"},"execution":{"report":"everything"}}`},
		{"a duration in no stated unit", `{"select":{"branch":"main"},"limit":{"time":"5 seconds"}}`},
		{"a scan asking for a path shape", `{"select":{"branch":"main"},"output":{"shape":"path"}}`},
		{"an id that is not multibase base32", `{"select":{"branch":"$universe","head":"NOT-AN-ID"}}`},

		// --- refused while decoding: shape rather than value ---
		//
		// ranke-go refuses these through DisallowUnknownFields and the decoder's own
		// types, so they carry no sentinel. A validator that only checks enums, forms
		// and bounds accepts every one of them, which is the asymmetry these cases
		// exist to expose: a typo'd key would reach the wire and come back a 400.
		{"an unknown key at the top level", `{"select":{"branch":"main"},"selct":{"branch":"x"}}`},
		{"an unknown key inside select", `{"select":{"branch":"main","hed":"abc"}}`},
		{
			"an unknown key inside a path step",
			`{"select":{"branch":"main","path":[{"edges":["a/*"],"hops":3}]}}`,
		},
		{"an unknown key inside output", `{"select":{"branch":"main"},"output":{"shap":"single"}}`},
		{"an unknown key inside a comparison", `{"select":{"branch":"main"},"where":{"field":"a","test":{"equals":1}}}`},
		{"results as a string", `{"select":{"branch":"main"},"limit":{"results":"5"}}`},
		{"edges as a bare string", `{"select":{"branch":"main","path":[{"edges":"a/*"}]}}`},
		{"a branch that is not a string", `{"select":{"branch":123}}`},
		// The schema bounds four values at zero, so all four are asked. Enforcing only
		// some of them left one implementation stricter than the other, with nothing
		// able to see it.
		{"a negative min", `{"select":{"branch":"main","path":[{"min":-1}]}}`},
		{"a negative max", `{"select":{"branch":"main","path":[{"max":-1}]}}`},
		{"a negative results cap", `{"select":{"branch":"main"},"limit":{"results":-1}}`},
		{
			"a negative content cap",
			`{"select":{"branch":"main"},"output":{"content":{"max":-1,"overflow":"omit"}}}`,
		},
		// The schema's duration pattern admits no sign, yet time.ParseDuration does, so a
		// negative budget reaches the validator through the wire as well as from Go.
		{"a negative duration", `{"select":{"branch":"main"},"limit":{"time":"-5s"}}`},
		{"a signed zero duration", `{"select":{"branch":"main"},"limit":{"time":"-0s"}}`},
		{"a plus-signed duration", `{"select":{"branch":"main"},"limit":{"time":"+5s"}}`},
		{"min 0 carries the starting set through", `{"select":{"branch":"main","path":[{"min":0}]}}`},
		{"max 0 leaves the step unbounded", `{"select":{"branch":"main","path":[{"max":0}]}}`},
		{"a fractional results cap", `{"select":{"branch":"main"},"limit":{"results":1.5}}`},
		{"order as an object rather than a list", `{"select":{"branch":"main"},"order":{"field":"a"}}`},
		{"a path step that is not an object", `{"select":{"branch":"main","path":["derivation/*"]}}`},
	}

	out := struct {
		Note     string    `json:"note"`
		RankeGo  string    `json:"rankeGo"`
		Verdicts []verdict `json:"verdicts"`
	}{
		Note: "ranke-go's verdict on each query, given as the canonical JSON both " +
			"implementations read. Generated by tools/queryoracle; regenerate with " +
			"scripts/fixtures.sh after taking a new ranke-go release.",
		RankeGo: rankeGoVersion(),
	}

	for _, c := range cases {
		v := verdict{Label: c.label, Query: json.RawMessage(c.query)}
		q, err := ranke.DecodeQuery([]byte(c.query))
		if err == nil {
			err = ranke.ValidateQuery(q)
		}
		if err == nil {
			v.Accepted = true
		} else {
			v.Codes = classify(err)
			if len(v.Codes) > 0 {
				v.Code = v.Codes[0]
			}
			v.Detail = err.Error()
		}
		out.Verdicts = append(out.Verdicts, v)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		panic(err)
	}

	accepted := 0
	for _, v := range out.Verdicts {
		if v.Accepted {
			accepted++
		}
	}
	fmt.Fprintf(os.Stderr, "%d cases: %d accepted, %d refused\n",
		len(out.Verdicts), accepted, len(out.Verdicts)-accepted)
}

func rankeGoVersion() string {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	for _, d := range bi.Deps {
		if d.Path == rankeGoModule {
			if d.Replace != nil {
				return "substituted:" + d.Replace.Path
			}
			return d.Version
		}
	}
	return "unknown"
}

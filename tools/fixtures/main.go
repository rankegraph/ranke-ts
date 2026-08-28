package main

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"runtime/debug"
	"time"

	ranke "github.com/rankegraph/ranke-go"
)

const rankeGoModule = "github.com/rankegraph/ranke-go"

// provenance records which ranke-go produced these bytes, so an artifact traces to
// a version rather than to whatever was checked out at the time.
type provenance struct {
	// RankeGo is the module version, e.g. "v0.15.0".
	RankeGo string `json:"rankeGo"`
	// Substituted names a path that stood in for the released module. Its presence
	// means the fixtures reproduce nothing, and the test suite refuses them.
	Substituted string `json:"substituted,omitempty"`
}

func readProvenance() provenance {
	p := provenance{RankeGo: "unknown"}
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return p
	}
	for _, d := range bi.Deps {
		if d.Path != rankeGoModule {
			continue
		}
		p.RankeGo = d.Version
		if d.Replace != nil {
			p.Substituted = d.Replace.Path
		}
		break
	}
	return p
}

// Writes reference claims, in both encodings, as JSON on stdout. The TypeScript
// tests read this file, so nothing is transcribed by hand: ranke-go is the reference
// implementation, and these are its output.

type edgeRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type fixture struct {
	Label string `json:"label"`
	ID    string `json:"id"`
	// CBOR is Envelope(): the stored record, whose hash is the id (`V-ENV`, `V-ID`).
	// EncodeCBOR would give the payload inside it, which no id checks (`R-QCANON`).
	CBOR  string    `json:"cbor"`
	JSON  any       `json:"json"`
	Edges []edgeRef `json:"edges"`
}

// capped is one claim served under an output.content option (`R-QCONTENT`), so a client
// has reference bytes for a read that inlines part of a claim's content, or none of it.
// Cap is the max asked for, -1 standing for an absent content section.
//
// A served record is a serialized claim, not an envelope (`R-QDETAIL`), and ranke-go
// exports no decoder for one — DecodeClaim reads the envelope around it. So what the
// record HOLDS is not read back here. It does not need to be: the same record is emitted
// in both encodings, so the two readings check each other, and Size is what the declared
// length must equal in either.
type capped struct {
	Label    string `json:"label"`
	ID       string `json:"id"`
	Cap      int    `json:"cap"`
	Overflow string `json:"overflow"`
	Size     int    `json:"size"` // the content's true length, taken from the claim built
	CBOR     string `json:"cbor"`
	JSON     any    `json:"json"`
}

// refusal is a record ranke-go's decode REFUSES, so a reader is held to what it must
// reject as well as to what it must accept. Agreement on the accepted set says nothing
// about what a reader lets through.
type refusal struct {
	Label string `json:"label"`
	CBOR  string `json:"cbor"`
	// Error is ranke-go's message, for reading a failure rather than for asserting: the
	// two libraries word a refusal their own way.
	Error string `json:"error"`
}

// refuse encodes c and records what DecodeClaim makes of the bytes. It panics where the
// decode ACCEPTS them, since a refusal case that decodes cleanly asserts nothing.
func refuse(label string, c ranke.Claim) refusal {
	raw, err := c.Envelope()
	must(err)
	if _, err = ranke.DecodeClaim(c.ID(), raw); err == nil {
		panic("refusal case " + label + " decodes cleanly")
	}
	return refusal{Label: label, CBOR: hex.EncodeToString(raw), Error: err.Error()}
}

// serve runs a claim through the query encoder, which is what applies `R-QCONTENT`, and
// returns the record a read would deliver in each encoding.
func serve(c ranke.Claim, oc *ranke.OutputContent, enc ranke.ResultEncoding) []byte {
	results := []ranke.QueryResult{{Kind: ranke.KindClaimNative, ClaimNative: c}}
	must(ranke.EncodeResults(results, ranke.Output{
		Detail: ranke.DetailClaims, Form: ranke.FormOriginal, Encoding: enc, Content: oc,
	}))
	return results[0].ClaimEncoded
}

func main() {
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = byte(i)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	pubkey, err := ranke.EncodePublicKey(priv.Public())
	must(err)

	at := time.Date(2026, 1, 2, 3, 4, 5, 123456789, time.UTC)

	root, err := ranke.NewClaim(ranke.NodeContributor, nil).
		WithInlineContent(pubkey).
		WithEncoding(ranke.EncodingOctetStream).
		WithCreatedAt(at).
		Sign(priv)
	must(err)
	alice, err := root.AsContributor(context.Background(), nil, priv)
	must(err)

	src, err := ranke.NewClaim(ranke.TypeSource("register"), alice).
		WithInlineContent([]byte("a parish register")).
		WithEncoding(ranke.EncodingPlain).
		WithField("title", "Register of 1834").
		WithField("aa", "length-first ordering").
		WithField("b", "sorts before aa").
		WithCreatedAt(at.Add(time.Second)).
		WithHeight(ranke.HeightOf(alice)).
		Sign()
	must(err)

	prov, err := ranke.NewEdge(ranke.EdgeConfig{Reference: src.ID(), Type: ranke.TypeDerivation("register")})
	must(err)
	person, err := ranke.NewClaim(ranke.TypeEntity("person"), alice).
		WithEdges(prov).
		WithField("name", "Anna Weber").
		WithCreatedAt(at.Add(2 * time.Second)).
		WithHeight(ranke.HeightOf(alice, src)).
		Sign()
	must(err)

	rel, err := ranke.NewEdge(ranke.EdgeConfig{
		Reference:         person.ID(),
		TypeClass:         ranke.EdgeClassRelation,
		TypeSub:           "family",
		RelationDirection: ranke.RelationFrom,
		Fields:            map[string]string{ranke.FieldName: "mother", "certainty": "high"},
		InlineContent:     []byte("stated in the register"),
		Encoding:          ranke.EncodingPlain,
	})
	must(err)
	scanHash, err := ranke.HashContent([]byte("a scan of the page"))
	must(err)
	extEdge, err := ranke.NewEdge(ranke.EdgeConfig{
		Reference:   src.ID(),
		Type:        ranke.TypeDerivation("scan"),
		ContentHash: scanHash,
		ContentSize: 18,
		Encoding:    ranke.EncodingPNG,
	})
	must(err)
	family, err := ranke.NewClaim(ranke.TypeRelation("family"), alice).
		WithEdges(prov, rel, extEdge).
		WithCreatedAt(at.Add(3 * time.Second)).
		WithHeight(ranke.HeightOf(alice, src, person)).
		Sign()
	must(err)

	// A limiting claim, so the fixtures exercise the newly aliased subtypes.
	delEdge, err := ranke.NewEdge(ranke.EdgeConfig{
		Reference:  src.ID(),
		Type:       ranke.EdgeTypeDelete,
		Referenced: src,
	})
	must(err)
	deletion, err := ranke.NewClaim(ranke.NodeDelete, alice).
		WithEdges(delEdge).
		WithCreatedAt(at.Add(4 * time.Second)).
		WithHeight(ranke.HeightOf(alice, src)).
		Sign()
	must(err)

	// The identity-signed trio that stood here is gone. `Sign` is asymmetric (§Primitives)
	// and every contributor carries a pubkey, so a keyless claim is not a claim — and the
	// property those three carried, an id a keyless implementation can reproduce, now
	// belongs to every case: id(v) = H(S(env(v))) needs no key to recompute, and each
	// fixture records its signature so a builder can be held to the bytes as well.

	// Records `V-TIME` refuses, built through the public API: the builder ranges no
	// timestamp field, so a claim carrying an unreadable one encodes, and the decode is
	// what refuses it.
	const badTime = "whenever"
	var refusals []refusal
	for _, name := range []string{
		ranke.FieldDeleteBy, ranke.FieldPubkeyValidFrom, ranke.FieldPubkeyExpiresAfter,
	} {
		bad, err := ranke.NewClaim(ranke.TypeSource("note"), alice).
			WithField(name, badTime).
			WithCreatedAt(at.Add(20 * time.Second)).
			WithHeight(ranke.HeightOf(alice)).
			Sign(priv)
		must(err)
		refusals = append(refusals, refuse("a node's "+name+" will not parse", bad))
	}
	// The same on an edge, which is where `R-DPLANNED` keeps a copied delete_by.
	badEdge, err := ranke.NewEdge(ranke.EdgeConfig{
		Reference: src.ID(),
		Type:      ranke.TypeDerivation("note"),
		Fields:    map[string]string{ranke.FieldDeleteBy: badTime},
	})
	must(err)
	badEdgeClaim, err := ranke.NewClaim(ranke.TypeDerivation("summary"), alice).
		WithEdges(badEdge).
		WithCreatedAt(at.Add(21 * time.Second)).
		WithHeight(ranke.HeightOf(alice, src)).
		Sign(priv)
	must(err)
	refusals = append(refusals, refuse("an edge's delete_by will not parse", badEdgeClaim))

	out := struct {
		Note       string            `json:"note"`
		Provenance provenance        `json:"provenance"`
		Ids        map[string]string `json:"ids"`
		Fixtures   []fixture         `json:"fixtures"`
		Capped     []capped          `json:"capped"`
		Refusals   []refusal         `json:"refusals"`
	}{
		Note: "Generated by tools/fixtures, importing ranke-go — the reference " +
			"implementation, so these are the specification of a decode. Regenerate with " +
			"scripts/fixtures.sh when the record layout, the alias tables or the JSON " +
			"projection move; a test failing afterwards says the encodings diverged.",
		Provenance: readProvenance(),
		Ids: map[string]string{
			"contributor":     root.ID().String(),
			"source":          src.ID().String(),
			"entity":          person.ID().String(),
			"relation":        family.ID().String(),
			"deletion": deletion.ID().String(),
			"scanHash": scanHash.String(),
		},
		Refusals: refusals,
	}

	for _, c := range []struct {
		label string
		claim ranke.Claim
	}{
		{"contributor", root},
		{"source", src},
		{"entity", person},
		{"relation", family},
		{"deletion", deletion},
	} {
		cborBytes, err := c.claim.Envelope()
		must(err)
		jsonBytes, err := c.claim.EncodeJSON(ranke.FormOriginal)
		must(err)
		var projected any
		must(json.Unmarshal(jsonBytes, &projected))

		f := fixture{Label: c.label, ID: c.claim.ID().String(), CBOR: hex.EncodeToString(cborBytes), JSON: projected}
		for _, e := range c.claim.Edges() {
			f.Edges = append(f.Edges, edgeRef{Type: e.Type(), ID: e.ID().String()})
		}
		out.Fixtures = append(out.Fixtures, f)
	}

	// The same claim served under each content option `R-QCONTENT` admits. src carries
	// inline content, so every option shows on it.
	srcInline, err := src.Node().GetInlineContent()
	must(err)
	for _, cc := range []struct {
		label string
		oc    *ranke.OutputContent
	}{
		{"content absent, so none is inlined", nil},
		{"max 0, content in full", &ranke.OutputContent{Max: 0}},
		{"a cap the content overruns, cut at it", &ranke.OutputContent{Max: 4, Overflow: ranke.OverflowCutoff}},
		{"a cap the content overruns, omitted whole", &ranke.OutputContent{Max: 4, Overflow: ranke.OverflowOmit}},
		{"an absent overflow, which is omit", &ranke.OutputContent{Max: 4}},
		{"a cap the content fits", &ranke.OutputContent{Max: len(srcInline), Overflow: ranke.OverflowOmit}},
	} {
		cborBytes := serve(src, cc.oc, ranke.ResultCBOR)
		jsonBytes := serve(src, cc.oc, ranke.ResultJSON)
		var projected any
		must(json.Unmarshal(jsonBytes, &projected))

		f := capped{
			Label: cc.label, ID: src.ID().String(), Cap: -1,
			Size: len(srcInline),
			CBOR: hex.EncodeToString(cborBytes), JSON: projected,
		}
		if cc.oc != nil {
			f.Cap, f.Overflow = cc.oc.Max, string(cc.oc.Overflow)
		}
		out.Capped = append(out.Capped, f)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	must(enc.Encode(out))
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

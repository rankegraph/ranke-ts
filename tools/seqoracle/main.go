// Command seqoracle emits a framed result sequence for each payload kind and each
// encoding, as RankeDB serves one. The record payloads come from ranke-go — claims
// through EncodeCBOR/EncodeJSON, everything else through MarshalCBOR or json.Marshal
// — so the TypeScript reader is checked against the bytes the reference produces.
//
// The framing itself (RFC 7464 for json, RFC 8742 for cbor) is written here rather
// than imported: RankeDB's sequenceFraming is internal to its core package, and the
// two RFCs are published standards rather than a ranke choice. What is checked here is
// the payload encoding, which is where the two implementations could disagree.
//
// Regenerate with: go run ./seqoracle > ../src/testing/seq_oracle.json
package main

import (
	"bytes"
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

// stream is one framed sequence: what a reader must make of it, and its bytes.
type stream struct {
	Label string `json:"label"`
	// Encoding is the framing: "json" or "cbor".
	Encoding string `json:"encoding"`
	// Kinds is what each record carries, in order — the reader's expected answer.
	Kinds []string `json:"kinds"`
	// Ids is every id the sequence names, in order, flattened across routes.
	Ids []string `json:"ids,omitempty"`
	// Bytes is the framed sequence, hex.
	Bytes string `json:"bytes"`
}

func main() {
	claim := buildClaim()

	claimJSON, err := claim.EncodeJSON(ranke.FormOriginal)
	must(err)
	claimCBOR, err := claim.EncodeCBOR(ranke.FormOriginal)
	must(err)

	id := claim.ID().String()
	route := []string{id, id}

	report := ranke.QueryReport{
		StartedAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		Elapsed:   1500 * time.Millisecond,
		Results:   1,
		Truncated: false,
	}

	out := struct {
		Note    string   `json:"note"`
		RankeGo string   `json:"rankeGo"`
		Streams []stream `json:"streams"`
	}{
		Note: "Framed result sequences as RankeDB serves them, one per payload kind and " +
			"encoding. Every payload is encoded by ranke-go: a JSON record in a CBOR " +
			"sequence would mis-decode, so each framing carries its own form.",
		RankeGo: rankeGoVersion(),
	}

	for _, enc := range []string{"json", "cbor"} {
		claimBytes := claimJSON
		if enc == "cbor" {
			claimBytes = claimCBOR
		}

		out.Streams = append(out.Streams,
			stream{
				Label: "claims", Encoding: enc, Kinds: []string{"claim", "claim"},
				Bytes: frame(enc, claimBytes, claimBytes),
			},
			stream{
				Label: "ids", Encoding: enc, Kinds: []string{"claim_id", "claim_id"},
				Ids:   []string{id, id},
				Bytes: frame(enc, value(enc, id), value(enc, id)),
			},
			stream{
				Label: "routes of ids", Encoding: enc, Kinds: []string{"path_id"},
				Ids:   route,
				Bytes: frame(enc, value(enc, route)),
			},
			// A report trails the results, so a claim reader has to pass over it and a
			// record reader has to name it — in whichever encoding it arrives.
			stream{
				Label: "claims then a report", Encoding: enc, Kinds: []string{"claim", "report"},
				Bytes: frame(enc, claimBytes, value(enc, report)),
			},
			stream{
				Label: "ids then a report", Encoding: enc, Kinds: []string{"claim_id", "report"},
				Ids:   []string{id},
				Bytes: frame(enc, value(enc, id), value(enc, report)),
			},
		)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	must(enc.Encode(out))
}

// value encodes a payload that is not a claim, in the framing's own form.
func value(encoding string, v any) []byte {
	if encoding == "cbor" {
		b, err := ranke.MarshalCBOR(v)
		must(err)
		return b
	}
	b, err := json.Marshal(v)
	must(err)
	return b
}

// frame concatenates records: RFC 7464 brackets each with RS and LF, RFC 8742 needs no
// delimiter because a CBOR item is self-delimiting.
func frame(encoding string, records ...[]byte) string {
	var buf bytes.Buffer
	for _, rec := range records {
		if encoding == "json" {
			buf.WriteByte(0x1e)
		}
		buf.Write(rec)
		if encoding == "json" {
			buf.WriteByte('\n')
		}
	}
	return hex.EncodeToString(buf.Bytes())
}

// buildClaim makes one claim to frame. Every claim is signed (`V-SIG`), so the key is a
// fixed seed rather than absent — which keeps the bytes reproducible, the only property the
// keyless build was giving.
func buildClaim() ranke.Claim {
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
	contributor, err := root.AsContributor(context.Background(), nil, priv)
	must(err)

	claim, err := ranke.NewClaim(ranke.TypeSource("note"), contributor).
		WithInlineContent([]byte("a record in a sequence")).
		WithEncoding(ranke.EncodingPlain).
		WithField("title", "sequenced").
		WithCreatedAt(at.Add(time.Second)).
		WithHeight(ranke.HeightOf(contributor)).
		Sign(priv)
	must(err)
	return claim
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

func must(err error) {
	if err != nil {
		panic(err)
	}
}

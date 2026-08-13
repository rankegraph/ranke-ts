// Generators for the reference data the tests check against. A module of its own,
// so the npm package carries no Go dependency and `npm ci` stays untouched.
//
// A RELEASED ranke-go, deliberately, and never a local checkout: an artifact must
// trace to a version rather than to whatever someone had checked out, which is the
// rule ranke-graph's update-testdata follows. Take new behaviour by releasing
// ranke-go and bumping the require below; the version lands in the generated file's
// provenance, and the suite refuses fixtures that came from anything else.
module github.com/flocko-motion/ranke-ts/tools

go 1.26.2

require github.com/flocko-motion/ranke-go v0.20.0

require (
	github.com/fxamacker/cbor/v2 v2.9.2 // indirect
	github.com/klauspost/cpuid/v2 v2.2.10 // indirect
	github.com/minio/sha256-simd v1.0.0 // indirect
	github.com/mr-tron/base58 v1.3.0 // indirect
	github.com/multiformats/go-base32 v0.1.0 // indirect
	github.com/multiformats/go-base36 v0.2.0 // indirect
	github.com/multiformats/go-multibase v0.3.0 // indirect
	github.com/multiformats/go-multicodec v0.10.0 // indirect
	github.com/multiformats/go-multihash v0.2.3 // indirect
	github.com/multiformats/go-varint v0.0.6 // indirect
	github.com/spaolacci/murmur3 v1.1.0 // indirect
	github.com/x448/float16 v0.8.4 // indirect
	golang.org/x/crypto v0.0.0-20220525230936-793ad666bf5e // indirect
	golang.org/x/sys v0.44.0 // indirect
	lukechampine.com/blake3 v1.1.6 // indirect
)

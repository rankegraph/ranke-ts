# Changelog

What each release changed for someone who depends on this repository. A change
earns an entry when it alters what the repo requires, provides, or removes;
rewording does not.

## Unreleased

## v0.28.0 — 2026-09-02

### Added

- Reading a bookmark, the record locating an archive's moving head: `idSeq(index,
  seed)` computes the `id_seq(i, s)` slot it is filed under (`V-IDSEQ`),
  `decodeBookmark` holds a stored record to its shape (`V-BMENV`), and
  `bookmarkAt(slot, raw)` adds the check that the record's own `(i, s)` keys the slot
  it arrived at (`V-BMSLOT`). A `Bookmark` is plain frozen data with string ids, as a
  decoded claim is; a refusal is a `RankeBookmarkError`. Without this a client cannot
  find the head at all — `𝒰` resolves only backwards and offers no enumeration.
- `bookmarkEnvelopeParts` reads the COSE_Sign1 a bookmark is stored as, whose
  protected header carries `kid` alongside `alg` where a claim's carries `alg` alone.
- `formatTimestamp(date)` renders `V-TIME` form — RFC 3339, UTC, fixed-width
  nanoseconds — which is the one spelling a time comparison takes.
- `ErrQueryTimeOperand`: `ValidateQuery` holds a comparison on a time field to one
  spelling (`R-QTIMEOP`). `created_at`, `delete_by`, `pubkey_valid_from` and
  `pubkey_expires_after` take a `V-TIME` timestamp; `dated` takes an EDTF Level 1
  value; a number, a glob or a loosely written date is refused. The field picks the
  form rather than admitting either, so one instant has one spelling and a text
  comparison cannot land on two different seconds.

### Changed

- **The version is this library's own, no longer derived from the ranke-go it
  mirrors.** It was `ranke-ts 0.24.x` implements `ranke-go 0.24.x`, with only the patch
  free to drift. The number now says what a semantic version says — whether a change
  breaks a caller — so `make release` takes a bump word: `make release <major|minor|patch>`
  (aliases `breaking|feature|fix`). Which ranke-go a release mirrors is recorded in
  `tools/go.mod` and in every generated fixture's provenance, where it is checkable.
  Mirroring itself is unchanged, and `verify` still fails when the reference moves and
  this code has not.

### Removed

- `make next-version`, with the derivation it printed.

### Fixed

- An EDTF instant is an endpoint of the Level 1 grammar rather than a case ahead of
  it, so the forms Level 1 layers on top now reach it: `2004-01-01T10:10:10Z?`,
  `2004-01-01T10:10:10+05:00~`, an interval between two instants, and an open bound
  against one. A qualifier no longer stands in for the zone a date-and-time needs, so
  `2014-06-15T12:00:00?` is refused.
- The reference set's `𝒰_hist` cases are run: nine bookmark records the suite had no
  reader for, and so reported nothing about. Six are decided here, and the three that
  need a key or the whole list are named individually. The manifest loader now demands
  a list for each of the three keyspaces, since ranke-go leaves `bookmarks` omitempty
  and a set cut before they existed would otherwise read as one with no cases to run.

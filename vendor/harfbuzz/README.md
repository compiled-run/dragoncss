# Vendored HarfBuzz

- **Revision:** `fa2908bf16d2ccd6623f4d575455fea72a1a722b` (HarfBuzz 12.3.0), the `harfbuzz_revision` in Chromium's `DEPS`
  at tag 145.0.7632.6 (`src/third_party/harfbuzz-ng/src`).
- **Source:** https://codeload.github.com/harfbuzz/harfbuzz/tar.gz/fa2908bf16d2ccd6623f4d575455fea72a1a722b
  (SHA-256 of the tarball as downloaded on 2026-09-28: `baacae2d1b4300868d1936901b539020764a69e3f3c3ec4d93834df8494cc779`).
- **Contents:** the tarball's `src/` and `COPYING`, byte for byte, and its top-level `README.md` renamed to
  `README.upstream.md` (this file is Dragon's vendoring note, not upstream's). Nothing is modified; a re-download was
  compared with `diff -r` before committing. Dragon's shim and build live in `packages/text-shaper`.
- **Licence:** HarfBuzz's "Old MIT" licence (`COPYING`). Apps that ship dragon_hb carry this notice.
- **Updating:** only together with Chrome's pin, and only after the TXT1-0 gate passes again.

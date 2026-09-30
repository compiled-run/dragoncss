# Chrome ports registry

`docs/ports.json` lists every Chrome source file that Dragon's TypeScript cites, following the decision "Porting Chrome's algorithms (owner, 2026-09-30)" in `docs/decisions.md`. `packages/parity/test/chrome-ports.test.ts` checks it offline on every `pnpm test`.

## What an entry records

- `upstream`: the path in the Chromium tree at tag `145.0.7632.6`. Skia files are under `third_party/skia/` and come from the Skia revision that the tag's DEPS pins (`skiaRevision`).
- `citedAs`: old file names that Dragon comments still use (for example `ng_length_utils.cc`, which is `length_utils.cc` at the tag).
- `licence`: the kind of header on the file: `bsd-chromium` ("The Chromium Authors"), `bsd-skia`, `bsd-google`, `bsd-apple`, `bsd-other`, `mit-harfbuzz`, or `lgpl`. `licencePhrase` is the sentence in the header that sets the kind, and `copyright` is the header's first copyright lines.
- `fileSha256` and `headerSha256`: the sha256 of the whole file at the tag, and of its header (the file's leading comment lines up to the first code line, blank lines between comment blocks included, trailing blank lines dropped, ending with one newline). When Chrome moves to a new tag, a changed `fileSha256` shows which ports to diff and carry over.
- `ranges`: the upstream lines of the ported code. `cited` ranges come from the Dragon comment. `located` ranges are the definitions of the upstream functions or constants that the comment names. `whole-file` means the comment cites the file as a whole.
- `dragon`: each Dragon file and top-level declaration that cites the file (`symbol` is `null` when a file header cites it). `use` is `port` when the code reproduces the upstream code, and `reference` when a deviation record, report, test or capture script only points at it.
- `ruling`: present only on `lgpl` entries. These files are not ported under the decision. Each one is also named in the test's `KNOWN_LGPL_PENDING_RULING` list until the PM rules on it.

`notChrome` lists cited `.h` files that are not Chrome code (ICU headers and Dragon's own C header), with the files that cite them.

## What the test checks

- Every `.cc`, `.cpp` or `.h` file named in a comment or string of a TypeScript, Swift, Kotlin or Java file under `packages/`, `scripts/` or `examples/` (files git tracks or would track; generated output is skipped) resolves to exactly one entry (by full path, by a trailing part of the path, or by a `citedAs` name), and that entry lists the citing file.
- No entry is `lgpl` unless the test names it as a pending finding, and the licence phrase matches the kind.
- Every `dragon` file exists, every `symbol` is still declared in it, and the file still cites the entry.

## Adding a port

1. Cite the upstream file in the Dragon comment, with the full path when a bare name could match more than one entry.
2. Fetch the file at the tag: `curl -s "https://chromium.googlesource.com/chromium/src/+/refs/tags/145.0.7632.6/<path>?format=TEXT" | base64 -d > file` (Skia: `https://skia.googlesource.com/skia/+/<skiaRevision>/<path under third_party/skia>?format=TEXT`).
3. Read the header. If it is LGPL, do not port the file. Implement from the spec text and match Chrome by test.
4. Add the entry with `shasum -a 256 file` for `fileSha256`, the sha256 of the header for `headerSha256`, the line range, and the Dragon file and declaration.

# Chrome ports registry

`docs/ports.json` lists every Chrome source file that Dragon's TypeScript cites, following the decision "Porting Chrome's algorithms (owner, 2026-09-30)" in `docs/decisions.md`. `packages/parity/test/chrome-ports.test.ts` checks it offline on every `pnpm test`.

## What an entry records

- `upstream`: the path in the Chromium tree at tag `145.0.7632.6`. Skia files are under `third_party/skia/` and come from the Skia revision that the tag's DEPS pins (`skiaRevision`); V8 files are under `v8/` at the DEPS-pinned V8 revision (`v8Revision`).
- `citedAs`: old file names that Dragon comments still use (for example `ng_length_utils.cc`, which is `length_utils.cc` at the tag).
- `licence`: the kind of header on the file: `bsd-chromium` ("The Chromium Authors"), `bsd-skia`, `bsd-google`, `bsd-apple`, `bsd-other`, `mit-harfbuzz`, `fdlibm-sun` (the Sun Microsystems fdlibm notice in V8's `ieee754.cc`), or `lgpl`. `licencePhrase` is the sentence in the header that sets the kind, and `copyright` is the header's first copyright lines.
- `fileSha256` and `headerSha256`: the sha256 of the whole file at the tag, and of its header (the file's leading comment lines up to the first code line, blank lines between comment blocks included, trailing blank lines dropped, ending with one newline). When Chrome moves to a new tag, a changed `fileSha256` shows which ports to diff and carry over.
- `ranges`: the upstream lines of the ported code. `cited` ranges come from the Dragon comment. `located` ranges are the definitions of the upstream functions or constants that the comment names. `whole-file` means the comment cites the file as a whole.
- `dragon`: each Dragon file and top-level declaration that cites the file (`symbol` is `null` when a file header cites it). `use` is `port` when the code reproduces the upstream code, and `reference` when a deviation record, report, test or capture script only points at it.
- `ruling`: the T118J ruling (`docs/goals/milestone-2-proof/notes/T118J-lgpl-ruling.md`), required on every `lgpl` entry. `class` A means Dragon follows the spec or a Chrome observation, so its uses are `reference`. B means Dragon's code follows the LGPL code closely and must be rewritten clean-room (`task` T123); only these files are on the test's `KNOWN_LGPL_CLEAN_ROOM` list, and only they may keep a `port` use until T123 lands. C marks a port from a BSD file that replaces an LGPL one. `basis` gives the spec section or "Chrome observation", and `proof` lists the tests that pin the behaviour (`path`, `path:n`, `path:a-b` or `path#text`; each must exist). A ruling with no proof says why in its `note`.
- `note` and `attribution`: free text. `attribution` records a notice that must stay with the ported code (rapidhash, fdlibm).
- `noticeText`: the id, in `licenceTexts`, of the licence text that covers the file in `THIRD_PARTY_NOTICES.md`. `chromium-bsd` and `skia-bsd` are the Chromium and Skia LICENSE files; `header-bsd-N` are the BSD texts found in file headers (Apple and Google); `lgpl` entries have none.

`notChrome` lists cited files that are not Chrome code (ICU, JNI and C standard headers, HarfBuzz's build source and Dragon's own C header): `cited` holds each path exactly as a source file writes it, and `files` the files that cite it. Only those exact paths are exempt, so a Chrome file with the same name still needs an entry.

## What the test checks

- Every `.cc`, `.cpp`, `.mm` or `.h` file named in a comment, a string (multi-line strings included) or a C `#include <...>` of a code file under `packages/`, `scripts/` or `examples/` (TypeScript and JavaScript in every variant including `.tsx`, `.jsx` and `.d.ts`; Swift, Kotlin, Java, Zig, C-family, `.tsrx` and module maps; shell; files git tracks or would track; generated output is skipped) resolves to an exact `notChrome` path or to exactly one entry (by full path, by a trailing part of the path, or by a `citedAs` name), and that entry lists the citing file.
- Every `lgpl` entry has a ruling; none has a `port` use unless it is class B and on `KNOWN_LGPL_CLEAN_ROOM`; every proof file exists; the licence phrase matches the kind.
- A `bsd-other` or `fdlibm-sun` file's copyright line and every paragraph of its licence text stay in each Dragon file that ports it (compared without comment markers or line wrapping).
- Every tracked file in those directories is either scanned code or known data, so a new kind of code file fails the test until the scan covers it.
- `THIRD_PARTY_NOTICES.md` is exactly what `pnpm notices:gen` (`scripts/gen-third-party-notices.ts`) writes from `docs/ports.json` and `vendor/harfbuzz/COPYING`. The published `dragon` package ships it next to `LICENSE`.
- Every `dragon` file exists, every `symbol` is still declared in it, and the file still cites the entry.

## Adding a port

1. Cite the upstream file in the Dragon comment, with the full path when a bare name could match more than one entry.
2. Fetch the file at the tag: `curl -s "https://chromium.googlesource.com/chromium/src/+/refs/tags/145.0.7632.6/<path>?format=TEXT" | base64 -d > file` (Skia: `https://skia.googlesource.com/skia/+/<skiaRevision>/<path under third_party/skia>?format=TEXT`; V8: `https://chromium.googlesource.com/v8/v8/+/<v8Revision>/<path under v8>?format=TEXT`).
3. Read the header. If it is LGPL, do not port the file. Implement from the spec text and match Chrome by test.
4. Add the entry with `shasum -a 256 file` for `fileSha256`, the sha256 of the header for `headerSha256`, the line range, the Dragon file and declaration, and its `noticeText` (add the header's licence text to `licenceTexts` if it is a new one).
5. Run `pnpm notices:gen` and commit `THIRD_PARTY_NOTICES.md`.

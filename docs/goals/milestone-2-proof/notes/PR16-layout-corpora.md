# PR #16 (pr/layout-breadth-corpora): merge-readiness pass

Branch head cc614536 (from fb54bf70): merged origin/master (19f1f0fb, clean), 7ae922e3, cc614536. Not pushed.

## Rulings
- Ignore list: master's `.macroscope/ignore.md` already skips every corpus file (`**/probe/**`, `docs/research/**/*.json`) and the Blink notes (`docs/research/**/*.md`). The branch's three `docs/research/*-spike/probe/**` lines were redundant, so 7ae922e3 drops them and the PR no longer touches `.macroscope/`. Evidence: `python3 /tmp/reviewable.py origin/master HEAD origin/master` (master's rules) lists only scripts and the test.
- Reviewable size 162 KB (three capture scripts 152 KB, plus probe-common.ts and the test), a little over the ~150 KB guide. Kept as one PR: it already had a clean Macroscope round (0 unanswered, Correctness "no issues"), and splitting by family now would pay for three fresh reviews of the same code. Most of the bytes are case tables, which are code, so they can't be ignored.
- Macroscope findings 4130044843 and 4130044853 were already answered (Fixed in cb211de1). Checked in code: the after-grid text run is measured, and an unknown `--only` exits 1. cc614536 tightens the first so every environment is checked, not only env 0.

## Pre-PR audit (cc614536, tests in packages/parity/test/layout-probes.test.ts)
- Unchecked input: unknown CLI arguments now exit 1 before Chrome (a typo used to run a full overwrite). Duplicate case ids or data-p labels are rejected. The writing-mode PNG decoder is replaced by parity's decodePng, which checks the signature and filters. A glyph sample outside the screenshot throws. `--plants` handles a missing case, label or environment.
- Silent error paths: a writing-mode case with no Chrome-accepted modes throws. Bounds-less pixel reads no longer come back as light.
- Checks on a subset: the grid text-run check now covers all 24 environments.
- Cleanup on failure: page contexts close in a finally. Corpus files are written only after every family is captured.
- Regex JSON formatters that could rewrite string contents are replaced by a value walker (scripts/probe-common.ts). It reproduces all 15 committed float and writing-mode files byte for byte (tested).
- `--check` against Chrome 145.0.7632.6: all 35 corpus files are unchanged (grid 20, float 6, writing-mode 9).

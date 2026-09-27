# T040: retire auto-margin-overflow-cross-start; workflow check replaces the no-remote probe

Worker, claude-code, 2026-09-27. Result: done. Code commit 768b310 (on top of bfb4c20). Nothing pushed.

## What changed
- `packages/layout/src/chrome-deviations.ts`: removed the `auto-margin-overflow-cross-start` entry and `'autoMarginOverflowSpec'` from `DeviationFault`. The `contradicted` finding kind stays in the type so a future contradiction can still be recorded. The comment now says no entry is contradicted and that the M2 test requires every entry to be distinguished.
- `packages/layout/src/block.ts`: removed the `autoMarginOverflowSpec` engine fault (field, doc comment, `NO_ENGINE_FAULTS` entry).
- `packages/layout/src/flex.ts`: `crossAxisOffset` returns `ZERO` when `available <= 0`. It no longer takes `ctx`, which only the fault read. The comment says why the branch is safe (ruling 1): under wrap-reverse a multi-line line is as large as its largest item (§9.4 step 8), so the space there is 0 and both readings agree.
- `packages/parity/test/parity.test.ts`:
  - The M2 test now has one case per deviation. Each case asserts `finding.kind === 'distinguished'` and that the fault makes every registered node non-exact. The assertions for distinguished entries are unchanged. The `contradicted` path is gone.
  - "S5 records exactly one contradicted deviation" is replaced by "T040 (M2): every registered Chrome deviation is distinguished…". It asserts the three ids, all distinguished, their faults, and that `NO_ENGINE_FAULTS` has no `autoMarginOverflowSpec`.
  - The MF5 test now asserts that the retired entry is absent. It also checks that am-a..c and amc-a..c (flex-wrap-reverse) and amr-a..c (flex-auto-margins-reverse-overflow) are compared and exact at 1/64 px in every case, and that both fixtures pass.
- `packages/parity/test/platform.test.ts`: the "no remote" test (hardcoded `/opt/homebrew/bin/git`) is replaced by "runs only on workflow_dispatch and has no push step". This test reads only `.github/workflows/parity.yml`. It checks four things:
  - the only key in the `on:` block is `workflow_dispatch`
  - `permissions` is `contents: read`
  - the exact list of 10 step names
  - no step contains git push/commit/tag, a publish, docker push, gh release/pr, or a push/commit/deploy/publish/release action

  The test file no longer runs git at all, so git does not need to be resolved.

## Commands and results
| Command | Result |
|---|---|
| Baseline at bfb4c20: explicit clean, then `pnpm test` | 20 files, 792/792. Out copied to /tmp/t040/before-out |
| `pnpm typecheck` | exit 0 |
| `rm -rf packages/{layout,dragon}/{dist,dist-test,build,tsconfig.tsbuildinfo} packages/parity/dist packages/parity/out` (explicit paths), then `pnpm test` twice | exit 0 both times. 20 files, 791/791 both times (792 minus the merged contradicted test). `cmp` shows report.json, index.html and summary.md identical |
| `pnpm run parity:report` | exit 0. `cmp` shows all three files equal to the test run's. Output: 137/137 fixtures, 258/258 cases, 8671/8671 nodes exact, failed 0 |
| `node scripts/gen-granularity-fixtures.ts && node scripts/gen-baseline-source-matrix.ts && pnpm run grammar:gen && pnpm run ua:capture && pnpm run parity:capture && pnpm run layout:vectors && pnpm run profile:rows` | exit 0 |
| `/opt/homebrew/bin/git diff --exit-code -- packages/parity/expected packages/parity/emitted packages/parity/fixtures packages/parity/generated packages/layout/vectors packages/dragon/src` | exit 0. No untracked files outside the PM's docs |
| report.json before vs after (node, /tmp/t040/cmp.mjs) | Only the top-level `deviations` key differs. It equals the old array minus the auto-margin entry. The string "contradicted" is no longer present |
| `diff` summary.md before vs after | Only lost: the 3 auto-margin-overflow-cross-start rows and the "Finding for the final audit" paragraph |
| `grep -n "autoMarginOverflowSpec\|auto-margin-overflow-cross-start" packages/layout/src packages/parity/src` | no output (exit 1) |
| `chromeDeviations` | [half-leading-floor, distinguished], [min-max-end-margin, distinguished], [wrap-reverse-baseline-line, distinguished] |
| `pnpm exec vitest run packages/parity/test/parity.test.ts --reporter=verbose` | 177/177. The 3 M2 planted-fault tests, the MF5 node test (includes the 9 former nodes) and the T040 test all pass |
| /tmp clone of 768b310 with a second remote `t040-temp` (origin is also set), `pnpm install --offline --frozen-lockfile`, `pnpm exec vitest run packages/parity/test/platform.test.ts` | 12/12 pass |
| Planted in the clone: `push:` trigger; separately, a `git push` step | Each one fails the new test (1 failed). The workflow was restored afterwards |
| `git diff --name-only bfb4c20..HEAD` | 6 files, all within allowed_files |

## Notes
- Engine output is unchanged: `layout:vectors` produced no diff, and every node, including the 9 former ones, is still exact.
- A `-t "deviation"` filtered run fails because it skips the capture tests that fill `outcomes`. That is not a valid verify mode. The whole file was run instead.

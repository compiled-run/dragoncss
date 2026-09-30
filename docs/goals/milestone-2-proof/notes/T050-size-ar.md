# T050: SIZE-ar, Worker note

Worker, 2026-09-29.
- Worktree: /tmp/dragon-size-ar, branch size-ar.
- Base: bb87f427 (stacked on pr/v1-value-model, per the PM's dispatch).
- Commits: 02239513 (engine) and 68065ad6 (regenerated outputs); cef00a90 (compiler half), 40758fc2 (regenerated outputs) and 7241d8ec (wpt web.json reasons).
- Status: engine and compiler halves done and committed (§7–§9). The device step (verify 8) is pending the leases. One hunk remains: native-support.ts `STYLE_FIELDS`, after EMS.

## 1. Where Chrome's algorithm comes from

The Blink sources at tag 145.0.7632.6 (the GitHub mirror, raw.githubusercontent.com/chromium/chromium/145.0.7632.6) are:
- platform/geometry/physical_size.cc `LayoutRatioFromSizeF`;
- core/style/style_aspect_ratio.h;
- core/style/computed_style.h `LogicalAspectRatio`, `BoxSizingForAspectRatio`;
- core/layout/length_utils.cc: `BlockSizeFromAspectRatio`, `InlineSizeFromAspectRatio`, the transferred min/max, `ComputeInlineSizeForFragmentInternal`, `ComputeBlockSizeForFragmentInternal`, `ComputeMinAndMaxContentContributionInternal`;
- core/layout/block_node.cc `ComputeMinMaxSizes`;
- core/layout/absolute_utils.cc `CanComputeBlockSizeWithoutLayout`, `ComputeOofInlineDimensions`;
- core/layout/flex/flex_layout_algorithm.cc `ConstructAndAppendFlexItems`;
- core/layout/block_layout_algorithm.cc (end margins with a definite initial block size).

Probes in the pinned Chrome (/tmp/ar-probe, not committed) confirmed every rule below. Each probed number is pinned in packages/layout/test/ratio.test.ts (20 tests, all equal to Chrome).

## 2. Chrome's rules (what the engine now does)

**Layout ratio.**
- The ratio is two raw LayoutUnit integers.
  - If both parts are exact LayoutUnits, they are kept (16/9 becomes 1024/576).
  - If the parts are equal, the ratio is 1/1.
  - Anything else takes Blink's float continued fraction, which stops within 1e-6 or after 16 steps. So 0.7 becomes 7/10, 0.001/1.2345 becomes 1/1234 (not 1/1234.5), and 0.1/1.2345 becomes 171/2111.
- The compiler is to compute it with `layoutRatio` (Appendix). It reproduces 19 probed ratios exactly.
- It needs Math.fround and Math.trunc. The compiler's rounding guard (ua.test.ts, s4b.test.ts) allows those only in css/color.ts, fonts/** and forms/**. So it is parked here, not committed. Its natural home is packages/layout/src/units.ts, which is Blink geometry and the engine's one float file, called by the compiler at build time.
- A degenerate ratio (0/x, x/0) is auto for layout. Chrome still serialises it (`0 / 1`).

**Transfer.**
- The transfer is `MulDiv`: raw × part / part, truncated. So 100px at 7/3 is 42.84375, not 42.857.
- border-box sizes the border box; content-box and `auto && <ratio>` size the content box.
- In the border-box case the result is at least the border+padding.

**Block-level boxes.**
- Height auto: height = ratio(width), then min-height and max-height.
  - min-height auto is the automatic minimum size, which is the content height clamped by max-height. It does not apply in a scroll container.
  - The ratio height is definite for percentage children.
  - End margins neither escape nor count.
- Width auto with a resolvable height: width = ratio(height clamped by min/max-height). The automatic minimum is min-content. The box is centred by auto margins.
- Width auto either way: min-height and max-height transfer into the inline min and max, even for a stretched width (`min-height:300px` gives width 600).

**Flex items.**
- Column: the base size is ratio(item width).
  - A stretched width takes no transferred min/max (Blink kStretchExplicit).
  - The content size suggestion is max(ratio size, content height). So the item cannot shrink below the ratio unless it is a scroll container.
  - Its main size is definite (Blink AspectRatioProvidesBlockMainSize).
- Row: the base size is ratio(height) when the height resolves, or ratio(stretched cross size) in a single-line container with a definite cross size (a 60px-tall row gives an item width of 120).
  - Otherwise the base size is the content clamped by the transferred min/max.
  - The suggestion is max(transferred size, content min-content).
  - The cross size comes from the ratio unless the item stretches, in which case stretch wins.

**Absolutely positioned boxes.**
- Height auto: always the ratio. The ratio beats stretching between both block insets (`inset:0` in a 200×100 box gives 200×200).
- Width auto: the ratio from the height, or from the stretched block size when the width does not stretch. Otherwise the box stretches or shrinks to fit, and the transferred min/max apply.

**Intrinsic contributions.**
- The transferred size, when the height is definite, with the min-content automatic minimum.
- Otherwise the content clamped by the transferred min/max.

## 3. Engine changes

- ratio.ts (new) holds all the rules above.
- Call sites:
  - block.ts: the auto-height resolution, and the width of a block-level box with width auto;
  - position.ts: the auto width, and skipping the forced stretch;
  - intrinsic.ts: `inlineContribution`;
  - flex.ts: base size, suggestion, column fit-content width, and column definiteness.
- input.ts: required `aspectRatio: auto | { ratio | auto-ratio, width, height }` (raw LU). This follows the PM ruling.
- validate.ts:
  - ratio parts must be positive integers;
  - a percentage height, min-height or max-height beside a ratio is refused.

  The reason for the refusal: blockLevelInlineSize has no percentage basis, and adding one would change block.ts and layout.ts call signatures. The compiler is to report this case at build time.
- Two findings for other packages:
  - **The translator subset has no MulDiv.** `mulDiv` reuses units.ts `cumulativeShareTruncated`, which is exact up to 2^53 and truncates toward zero, with a sign wrapper. units.ts is outside allowed_files. A named `mulDiv` in units.ts would be clearer.
  - **A pre-existing flex bug.** A column item with a specified height and flex-shrink takes its content size suggestion from its specified height, not its content. Chrome: `#f{flex column; height:50px} #a{height:80px} #b{height:40px}` gives a 33.328125 / b 16.671875; the engine gives no shrink. This is outside SIZE-ar. It needs its own package.

## 4. Migration (PM ruling: required field, additive check)

- **Generators.**
  - layout:vectors, layout:dpr-vectors and layout:break-vectors regenerated 1684 vector files: 422 top-level, 421 × 3 DPR.
  - Snap and break vectors hold no style and are unchanged.
- **Calc goldens.** The 17 calc goldens (vectors/calc) have no generator; T009 kept them by hand. `scripts/check-additive-migration.ts --migrate-calc-goldens` inserts the neutral key mechanically.
- **The committed checker.**
  - `node scripts/check-additive-migration.ts bb87f427` reports: 4227 files at base, 1701 changed, 31813 `aspectRatio: {kind:'auto'}` keys added, and every other byte identical.
  - Each style object must gain the key; with the keys removed, the file must be byte-identical to base.
  - Two plants were caught: a changed output height, and a non-auto ratio.
- **Typed literals migrated.** helpers.ts, drop-field.ts, corpus.ts, harness.ts (it decodes the field on device), ios-layout.ts (lowers auto), the vectors README and vectors.test (41 → 42 fields).
- **Differential corpus.** corpus.ts now draws a ratio for about 10% of the random styles. 4827 of 20258 engine cases carry one, and 2460 of those lay out ok. corpus.json and corpus-dpr.json were regenerated by native:gen.

## 5. Verification (engine half)

- Verify 1, `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`:
  - typecheck is clean;
  - 2410 of 2411 tests pass across 105 of 106 files;
  - the one failure is lanes.test "every device lane ran": layout-vectors-device still carries the old corpus digests (08f13b75…/c7f2f5a4…). It clears only when the device step reruns.
- Verify 5 passed (exit 0):
  - layout:subset reports 0 violations;
  - native:gen writes 24 Swift and 22 Kotlin files;
  - native:swift and native:kotlin pass every suite. P1 digest 38f0cb30…; extended digest 9d708c07…, unchanged;
  - native:planted catches every plant on both targets.
- Verify 4, parity:report: 260/260 fixtures, 421/421 cases, failed 0.
- Verify 4, parity:dpr-report: 1263/1263 cases, exact at 2, 3 and 2.625, failed 0.
- `pnpm run parity:lanes -- --run-host` refreshed only the host digests. Every other lane reads the committed device dumps, and device-pixels is unchanged (ios 546, android 1397).
- Verify 2, 3, 6, 7 and 8 need the compiler half, because no fixture can use aspect-ratio yet.
  - Verify 3's `--diff-filter=MD` rule is replaced by the checker, per the PM.

## 6. Why the compiler half was blocked (resolved by the PM rulings, §7)

`aspect-ratio` has to become a real longhand (decisions.md) before any fixture, capture, profile row or north-star error can move. That needs files outside the amended allowed_files.

1. **scripts/gen-css-grammar.ts, and `pnpm run grammar:gen` for grammar.generated.ts.**
   - `initialValue` (analysis/computed.ts) throws for a longhand with no webref entry.
   - ua.test.ts requires `properties[p]` for every LONGHANDS entry.
   - Parsing alone would work today: the forked lexer already matches `aspect-ratio` through css-tree's built-in `auto || <ratio>`.
2. **packages/dragon/src/css/stylesheet.ts, `parseValue`.** `16 / 9` is three tokens, and a longhand with more than one value is refused as `multi`. It needs one hook beside `baselinePosition` and `familyValue` that calls a `<ratio>` parser in values.ts.
3. **The UA dataset.** `pnpm run ua:capture` regenerates packages/dragon/src/ua/*.generated.ts. ua.test.ts requires a captured UA value for every longhand on every tag.
4. **Pinned tests to retarget** (Throughput Rules): packages/dragon/test/seams.test.ts (LONGHANDS order) and test/ua.test.ts.
5. **Capture churn** (decisions.md rules it additive):
   - packages/parity/expected/**, expected-dpr/** (and expected-breaks/** and expected-pixels/** if they hold computed values) gain `"aspect-ratio": "auto"`;
   - emitted/** gains `aspect-ratio: auto;`.

   check-additive-migration.ts would gain these migrations: captures gain one computed key, and emitted bodies gain one declaration with a relaxed header.
6. **native-support.ts `STYLE_FIELDS`** after EMS, as the PM directed.
7. **packages/layout/src/units.ts** (append only), for `layoutRatio`, and preferably also a named `mulDiv`.

With those files, the rest is inside allowed_files:
- the box.ts entry;
- the values.ts `<ratio>` parser;
- the computed.ts serialisation (Chrome: `16 / 9`, `1.5 / 1`, `auto 2 / 1` for both orders, `0.5 / 1` for `calc(1/2)`, `1e-05 / 1`);
- web-css (emit only non-auto);
- ios-layout lowering through `layoutRatio`;
- the sizing-ratio fixtures, covering the demo's four contexts in ltr and rtl plus the percentage-block reject;
- profile rows;
- north-star:check.

## 7. Compiler half (PM rulings 1–7, cef00a90 and 40758fc2)

- **Longhand.** `aspect-ratio` is in the box family after `max-height` (box.ts), with its webref grammar (`scripts/gen-css-grammar.ts`, `pnpm run grammar:gen`). The seams LONGHANDS pin gains it; ua.test.ts needed no edit, and `pnpm run ua:capture` only added `"aspect-ratio": "auto"` for every key.
- **Parse (probed in the pinned Chrome, 46 values).** A hook in stylesheet.ts `parseValue` calls values.ts `ratioValue`:
  - `auto || <ratio>` in either order (`16/9 auto` is `auto 16 / 9`); a single number n is `n / 1`; `0`, `0/0` and `1/0` are kept (computed `0 / 1`, `0 / 0`, `1 / 0`), and layout treats them as auto;
  - invalid, as Chrome drops them: negative parts, a unit, two ratios, two autos, a second slash, auto inside the ratio;
  - refused (DRAGON_UNSUPPORTED_VALUE at the token): a math function inside the ratio (Chrome accepts `calc(1/2)`; Dragon does not evaluate one there).
- **Value.** A new CssValue kind `ratio { auto, width, height }`: computed serialisation (computed.ts), web output `auto 16 / 9` (web-css.ts), feature keys `aspect-ratio:<ratio>` and `aspect-ratio:auto && <ratio>`.
- **units.ts (append only).** `mulDiv` (Blink LayoutUnit::MulDiv, exact in int64 by a 16-bit split, truncating toward zero, clamped) and `layoutRatio` (Blink LayoutRatioFromSizeF, from the Chrome 145 source, float steps via Math.fround). ratio.ts now uses `mulDiv` (the old one lost exactness past 2^53). The validator caps ratio parts at INT_MAX so mulDiv stays exact. 41 of 42 Chrome heights (14 ratios, 3 widths, abspos so no float offset rounds them) equal `mulDiv(width, layoutRatio)`; the 42nd is a 33554431.98px box whose getBoundingClientRect float rounds to 33554432; 12 are pinned in ratio.test.ts.
- **Deviation from ruling 4: the lowering does not call `layoutRatio`.** The core may import @dragon/layout for types only (ua.test.ts "dependency boundaries"; @dragon/layout is private and a devDependency of the published `dragon`), and rounding is banned in dragon/src outside color.ts, fonts/** and forms/**. So:
  - values.ts `exactLayoutRatio` gives the ratios that need no float math: parts that are whole 64ths (raw ≤ 2^24, so also exact as float) are kept as raw LayoutUnits; equal parts are 64 / 64; a zero part is degenerate (auto). This is Blink's first two branches, with only `* 64` and `Number.isInteger`.
  - Every other ratio (0.7, 1.618…) is refused on every target at the declaration (computed-checks.ts): "Chrome converts a ratio whose parts are not whole multiples of 1/64 with a float continued fraction that Dragon does not compute at build time". Integer ratios (16 / 9, 4 / 3, 1, 21 / 9) and the demo's are all exact.
  - aspect-ratio.test.ts proves `exactLayoutRatio` equals `layoutRatio` on 8,000+ inputs wherever it gives a value.
  - **PM ruling (T050):** keep this fail-closed conversion. The rounding guard and the types-only boundary are deliberate; no exemption.
  - **Follow-up package, SIZE-ar-conv (not in T050):** the engine owns the conversion. The layout input carries the authored ratio parts as doubles, `layoutRatio` runs in the engine, and the inexact-ratio refusal goes away. It needs an input.ts change and a vector migration (docs/decisions.md, "Adding engine fields").
- **Percentage block size beside a ratio.** Refused on every target at the percentage's declaration (computed-checks.ts `checkAspectRatio`, also `calc()` holding %), beside a non-degenerate ratio only, mirroring validate.ts. Web is refused too, because reject fixtures need every output blocked and the house rule refuses on every target.
- **Files beyond the list** (accepted by the PM as listed). computed-checks.ts (the two refusals: the lowering alone can only refuse native targets); packages/dragon/test/aspect-ratio.test.ts (new); expected-breaks/** and expected-pixels/** new files (pixel manifest.json only gains entries); the fixture group sits before `values`, because values.test.ts pins `values` as the last group (the extended corpus keys on its prefix).

## 8. Fixtures and outputs

- **Group `sizing-ratio`** (fixture-groups/sizing.ts), all in ltr and rtl:
  - sizing-ratio-block: content-box, border-box and `auto 2 / 1` with padding and border, min-height and max-height clamps, width from a px height, auto margins, the automatic minimum with text, a scroll container, a % child of a ratio box, 7 / 3 truncation, a ratio box with width auto;
  - sizing-ratio-flex-row: a 60px single-line row (ratio from the stretched cross size), px heights, min-height transfer, content, align-self, auto-height row;
  - sizing-ratio-flex-column: stretched and px widths, min-height, align-items center with overflowing text, a fixed-height column with a scroll container;
  - sizing-ratio-abspos: width to height, height to width, `inset: 0` (200×200 in 200×100), top and bottom insets, % width with border, min-height;
  - sizing-ratio-demo: `.song-container` flex column with the `.record` (`clamp(16rem, 24vw, 24rem)`, ratio 1, flex, overflow hidden), `.record-label` (abspos, 36%, 0.4rem border) and `.record-center` (10%, 0.35rem border), and `.mini-video-shell` (16 / 9, `clamp(22.5rem, 24vw, 30rem)`, 1px border, overflow hidden, fixed as abspos until POSX-f) with a 100%-height player.
  - Rejects: reject-sizing-ratio-percent-height (`50%`), reject-sizing-ratio-inexact (`0.7`), reject-sizing-ratio-calc (`calc(1/2)`).
- **Every new case passed on the first capture:** 10 cases at DPR 1, 30 at the device DPRs, dual and layout lanes, breaks equal.
- **Additive proof.** `node scripts/check-additive-migration.ts bb87f427` (exit 0):
  - vectors: 4227 files at base, 1701 changed, 31813 neutral keys; 100 new files, all from the new fixtures;
  - captures (expected + expected-dpr): 1684 files, all changed, 31584 `"aspect-ratio": "auto"` keys, every other byte identical; 40 new files;
  - emitted: 317 files, all changed, 7278 `aspect-ratio: auto;` declarations, exactly one per rule after max-height, headers relaxed to any digest; 10 new files;
  - the checker also fails any file added since the base that no new fixture owns.
  - 8 plants, each exit 1 with its own message: vector-output, capture-box, capture-ratio, capture-missing-key, emitted-value, emitted-ratio, emitted-extra, stray-file (`--plant <name>`).
- **Profile rows** (profile:rows twice, fixed point): 1709 → 1745 rows per target; no row removed, no status changed, no proof case lost, existing rows gain only sizing-ratio-* cases. 14 aspect-ratio rows (block, flex row and column, abspos in block and flex row, relative in flex column; `auto && <ratio>` in block). **22 new non-aspect-ratio rows** come from the new fixtures proving existing features in new contexts (for example `width:<clamp()>@absolute-in-block`, `min-height:<length-px>@flex-column`, `border-*-width:<length-rem>@absolute-in-flex-row`, `overflow-*:hidden@absolute-in-block`). **PM ruling (T050): keep them.** They are real passing proofs, and verify 6's rule exists only to prevent unproven rows.
- **North star** (`pnpm run north-star:check`): 838 → 826 diagnostics; web and ios DRAGON_UNSUPPORTED_PROPERTY 68 → 63 (the 5 aspect-ratio declarations) and DRAGON_UNPROVEN_CONTEXT 30 → 22; no web or ios aspect-ratio error remains. Android: the 5 become DRAGON_UNSUPPORTED_VALUE (the android profile is all unsupported until a native android case passes).

## 9. Verification (compiler half)

- Verify 1: `pnpm install --frozen-lockfile` ok; `pnpm typecheck` clean; `pnpm test` 2444/2447 in 105/107 files. The 3 failures are device-lane tests that need the device step: lanes.test "every device lane ran" and device-failures.test ios and android (the committed device dumps cover 421 cases, not 431).
- Verify 2: second parity:capture and parity:dpr-capture runs leave expected, expected-dpr and emitted byte-identical (hash equal).
- Verify 3: replaced by the checker (§8); layout:vectors, dpr-vectors, break-vectors and native:gen rerun leave every file identical.
- Verify 4: parity:report 268/268 fixtures, 431/431 cases, failed 0, values 457322/457322; parity:dpr-report 1293/1293, exact at 2, 3 and 2.625, failed 0.
- Verify 5: layout:subset 0 violations; native:gen 24 Swift and 22 Kotlin files, P1 digest 38f0cb30… unchanged, extended digest 3d47d413… (new cases); native:swift and native:kotlin pass; native:planted 8/8 on both targets.
- `pnpm run parity:lanes -- --run-host`: exit 0; host lanes pass; device lanes "not run" until the device step.
- `pnpm wpt:check --target web`: 5 pass of 38054, unchanged. It first reported 10 not-runnable reason changes only (aspect-ratio reasons moved to the next refusal, and justify-content-006 moved from an unproven min-height context to a font refusal). Per the PM ruling, 7241d8ec rewrites only those 10 reasons in packages/wpt/expectations/web.json from the Chrome-free run, with a /tmp script that proves over the parsed files that all 38054 statuses and every other field are unchanged. wpt:check --target web now exits 0.
- **Left alone, as ruled:** native-support.ts `STYLE_FIELDS` (the one remaining hunk, after EMS) and the flex column-shrink bug (§3).
- **Self-audit (Landing work step 3):**
  - external input: CSS numbers are checked finite and non-negative; captured UA text that is not a ratio falls through to `other`, which the lowering refuses loudly; engine ratio parts are capped at INT_MAX by the validator;
  - silent error paths: none; a degenerate ratio lowering to auto is Blink's rule, and every other non-ratio value throws a LoweringError;
  - partial checks: the checker covers all of expected, expected-dpr, emitted and vectors, requires the key on every computed object and exactly one declaration per rule, and rejects stray new files; expected-breaks and expected-pixels are checked by hand (no existing file changed; the pixel manifest only gains entries);
  - cleanup: probes live in /tmp/ar-probe2, not committed.

## Appendix: `layoutRatio` (the first draft; the committed one is in units.ts)

```ts
const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

/** base::ClampedNumeric<int>: saturating int arithmetic. */
function clampInt(v: number): number {
  return Number.isNaN(v) ? 0 : v > INT_MAX ? INT_MAX : v < INT_MIN ? INT_MIN : v;
}

/** LayoutUnit(float): the float times 64, truncated toward zero and saturated. */
function layoutUnitRaw(v: number): number {
  return clampInt(Math.trunc(Math.fround(Math.fround(v) * 64)));
}

/**
 * Blink LayoutRatioFromSizeF (platform/geometry/physical_size.cc, Chrome 145) for a <ratio> of width / height: the layout ratio
 * as two raw LayoutUnit values, or null for a degenerate ratio, which layout treats as auto (StyleAspectRatio::GetType). A ratio
 * whose parts are exact LayoutUnits is kept; equal parts are 1 / 1; anything else is the continued-fraction convergent, in
 * float, that first comes within 1e-6 of width / height (16 iterations at most).
 */
export function layoutRatio(ratioWidth: number, ratioHeight: number): { readonly width: number; readonly height: number } | null {
  const f = Math.fround;
  const w = f(ratioWidth);
  const h = f(ratioHeight);
  const rw = layoutUnitRaw(w);
  const rh = layoutUnitRaw(h);
  const exact = (f(rw / 64) === w && f(rh / 64) === h) || w === 0 || h === 0;
  const direct = exact ? { width: rw, height: rh } : w === h ? { width: 64, height: 64 } : null;
  if (direct !== null) return direct.width === 0 || direct.height === 0 ? null : direct;
  const initial = f(w / h);
  let x = initial;
  let h0 = 0;
  let h1 = 1;
  let k0 = 1;
  let k1 = 0;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(x)) break;
    const estimate = f(f(h1) / k1);
    if (Math.abs(f(initial - estimate)) < f(0.000001)) break;
    const a = clampInt(Math.floor(x));
    const h2 = clampInt(clampInt(h1 * a) + h0);
    const k2 = clampInt(clampInt(k1 * a) + k0);
    if (h2 === INT_MAX || k2 === INT_MAX) break;
    h0 = h1;
    k0 = k1;
    h1 = h2;
    k1 = k2;
    x = f(1 / f(x - a));
  }
  const out = h1 === 0 || k1 === 0 ? { width: rw, height: rh } : { width: h1, height: k1 };
  return out.width <= 0 || out.height <= 0 ? null : out;
}
```

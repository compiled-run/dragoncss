# TW-SWEEP: every Tailwind CSS v4 utility through Dragon

Worker note, 2026-09-29. Branch `tw-sweep` (worktree /tmp/dragon-tw-sweep, from origin/master 0c7c9cdb). This is finding 1 of NG-NATIVE-comparison.md: every Tailwind utility either works or says why, checked against Chrome, kept as a ratchet.

## What was built

- **Package `@dragon/tailwind-sweep`** (packages/tailwind-sweep). `tailwindcss` is pinned at **4.3.3** as a dev dependency, so the lockfile entry is committed. The sweep checks the installed version against the pin and refuses to run on any other.
- **`pnpm run tw:sweep`** writes `packages/tailwind-sweep/snapshot/tailwind-4.3.3.json` (one line per utility) and `snapshot/summary.md`. It takes 4 to 8 minutes on this machine under load: 52,584 Dragon compiles over worker threads, then 562 Chrome checks. If any utility crashes the compiler, it writes nothing and exits 1.
- **Ignored data path.** The snapshot is committed under `packages/tailwind-sweep/snapshot/**`, and that path is added to `.macroscope/ignore.md`. The generator code is reviewed; its output is not.
- **Full ratchet in `pnpm test`** (`test/sweep.test.ts`, about 155 s alone on the 18-core Mac). It reruns all 23,286 utilities through Dragon and Chrome and fails when any outcome, companion, category or published code differs from the snapshot, or when the snapshot or summary text would change. The plant (`flex` compiled as `display: block` must be caught) is its own test. PM ruling 2026-09-29: the sampled ratchet a cloud session built was not adopted, because CI does not run this package, so a separate `tw:sweep --check` would be enforced nowhere, and the sample left most supported utilities unrendered by Chrome.

  Each sampled utility is compiled with its recorded companions and compared with its snapshot record. Chrome renders every sampled mismatch and 50 supported utilities chosen with the same seed. A target that compiled but was not rendered matches only a snapshot "supported". The plant (`flex` compiled as `display: block` must be caught) is its own test. A manual plant of two snapshot edits (flex ios refused, p-4 web supported) was reported as exactly those two diffs.
- **Unit tests** (`test/units.test.ts`, 31 tests) cover:
  - the shell pre-pass, including five malformed shells that must throw;
  - the rules reader;
  - companions (direct, through a feeding modifier, and none);
  - categories;
  - the Chrome parse condition;
  - refusal groups;
  - the snapshot round trip and diff;
  - the dual comparison (box, value, missing property, element list);
  - CSS.escape.
- **Determinism.** `pnpm run tw:sweep` was run twice and the second run changed nothing (cmp-identical snapshot and summary).

## Results (Tailwind 4.3.3, Chrome 145.0.7632.6)

23,286 utilities in 1,154 Tailwind roots. 3,006 of them are custom-property-only and are judged with their companion.

| target | supported | refused | invalid | mismatch |
|---|---:|---:|---:|---:|
| web | 562 (2.4%) | 22,723 (97.6%) | 1 | 0 |
| ios | 562 (2.4%) | 22,723 (97.6%) | 1 | 0 |
| android | 0 (0.0%) | 23,285 (100%) | 1 | 0 |

- **No crashes, and no mismatches.** Every utility that compiles is one Chrome agrees with.
- **Supported roots.** The 562 supported utilities cover 235 of the 1,154 roots.
- **As published** (before the shell pre-pass), 0 of 23,286 compile on any target: the `@layer` wrapper alone refuses them all.
- **The invalid one is `justify-baseline`.** Tailwind emits `justify-content: baseline`, and Chrome 145 drops it too.
- **`line-clamp-1` to `-6` are refused, not invalid.** Dragon calls `display: -webkit-box` invalid (the webref grammar), but Chrome parses it. The snapshot marks this `chrome-parses`: a grammar gap, like the ones listed in grid-computed.test.ts.

**Next to the WPT score** (packages/wpt/README.md, the same master):

| | WPT (web, 38,054 CSS files) | WPT Interop CSS (58 areas) | Tailwind 4.3.3 sweep (23,286 utilities) |
|---|---|---|---|
| web | 5 pass (numeric runnable 6) | 3 / 6,482 | 562 supported (2.4%) |
| ios | — | — | 562 supported (2.4%) |
| android | — | — | 0 |

**By category.** Each cell is supported / refused / invalid (mismatch is 0 everywhere). Categories follow Tailwind's docs sections. "Colours" takes every utility whose value is a theme colour, or `current`, `transparent` or `inherit`. Every other utility is filed by the first standard property it sets; a modifier takes its companion's category.

| category | utilities | web | ios | android |
|---|---:|---|---|---|
| layout | 1,551 | 43 / 1,508 / 0 | 43 / 1,508 / 0 | 0 / 1,551 / 0 |
| flexbox-grid | 513 | 127 / 385 / 1 | 127 / 385 / 1 | 0 / 512 / 1 |
| spacing | 1,308 | 97 / 1,211 / 0 | 97 / 1,211 / 0 | 0 / 1,308 / 0 |
| sizing | 1,015 | 141 / 874 / 0 | 141 / 874 / 0 | 0 / 1,015 / 0 |
| typography | 261 | 21 / 240 / 0 | 21 / 240 / 0 | 0 / 261 / 0 |
| colours | 14,842 | 70 / 14,772 / 0 | 70 / 14,772 / 0 | 0 / 14,842 / 0 |
| backgrounds | 151 | 0 / 151 / 0 | 0 / 151 / 0 | 0 / 151 / 0 |
| borders | 250 | 63 / 187 / 0 | 63 / 187 / 0 | 0 / 250 / 0 |
| effects | 1,178 | 0 / 1,178 / 0 | 0 / 1,178 / 0 | 0 / 1,178 / 0 |
| filters | 134 | 0 / 134 / 0 | 0 / 134 / 0 | 0 / 134 / 0 |
| tables | 111 | 0 / 111 / 0 | 0 / 111 / 0 | 0 / 111 / 0 |
| transitions-animation | 36 | 0 / 36 / 0 | 0 / 36 / 0 | 0 / 36 / 0 |
| transforms | 680 | 0 / 680 / 0 | 0 / 680 / 0 | 0 / 680 / 0 |
| interactivity | 1,246 | 0 / 1,246 / 0 | 0 / 1,246 / 0 | 0 / 1,246 / 0 |
| svg | 6 | 0 / 6 / 0 | 0 / 6 / 0 | 0 / 6 / 0 |
| accessibility | 4 | 0 / 4 / 0 | 0 / 4 / 0 | 0 / 4 / 0 |

## Biggest refused groups (for the roadmap)

Each utility is counted by its first blocking diagnostic on web; ios counts are identical. "Families" means distinct Tailwind roots, which removes the 291-colour multiplier.

| blocked by | utilities | families | owner on the board |
|---|---:|---:|---|
| Tailwind's sheet shell: `@layer`, `@property`, the `:host` arm, pseudo-element arms | **all 23,286 as published** | all | CASC (build-time layer flattening, registered custom properties) |
| `oklch()` colours (the whole v4 palette) | 4,004 | 14 | CASC/colour ("mix" row) |
| `calc()` (the v4 spacing scale is `calc(var(--spacing) * N)`) | 3,542 | 94 | V2a / CALC (value model) |
| `mask-image` (mask-* utilities, mostly colour × position) | 6,280 | 38 | FX (late) |
| `box-shadow` (shadow-*, ring-*, inset-*) | 1,489 | 8 | PNT1 T072 |
| `background-image` (gradients: bg-linear/radial/conic with from/via/to) | 964 | 8 | BG2 T074 |
| `translate`, `transform`, `scale`, `rotate` | 647 | 53 | PNT2 T073 |
| `filter`, `-webkit-backdrop-filter` | 425 | 19 | FX |
| colour properties not in the profile: `scrollbar-color`, `accent-color`, `caret-color`, `outline-color`, `text-decoration-color`, `fill`, `stroke` | 2,331 | 11 | PNT1 / TDEC / SVG |
| `::placeholder` (pseudo-element) | 291 | 1 | GEN / FORM |
| `scroll-margin-*`, `scroll-padding-*`, `cursor`, `touch-action` (interactivity) | 1,201 | 112 | not on the board (no layout effect; could compile as no-ops with proof) |
| viewport units (`*-screen`, `*-dvh`, and so on) | 71 | 71 | V2a |
| unproven contexts (insets on a static div, flex-item properties outside a flex container) | 153 | 107 | per-feature profile rows |

**Android** refuses every utility. Its profile has no rows yet, so even a web-supported utility like `flex` stops at `profile display:flex`.

**Order for the roadmap.** Most of Tailwind stays out of reach until the first three rows are done:

1. The sheet shell (all utilities as published).
2. `oklch()` (64% of utilities are colours).
3. `calc()` (every spacing and sizing step).

After those, the paint rows follow: shadows, gradients, transforms, filters.

## Rulings (research, decided here)

1. **Corpus.** "Every utility" means the class list of `tailwindcss@4.3.3`'s design system (`__unstable__loadDesignSystem(...).getClassList()`, the IntelliSense list). It is loaded from the package's own `theme.css` and `utilities.css` in their layers, without preflight. Variants and arbitrary values are out, because their space has no end. Each utility gets a fresh `compile().build([class])`, because `build` accumulates across calls.
2. **Shell pre-pass** (flatten.ts). Every published utility stops at `@layer`, which Dragon refuses. That gives no signal beyond one row, so the sweep lowers only the shell to what it means for one document, and leaves the utility rules byte for byte. This matches ng-native's pre-pass:
   - `@layer theme`/`utilities` are unwrapped: one sheet, and layer order equals source order.
   - The `@layer properties;` statement is dropped.
   - `@property` is replaced by Tailwind's own no-@property fallback, as `* { … }`. That rule is placed first, because the properties layer is lowest; a later `*` would beat a `:where()` utility of equal specificity.
   - `:root, :host` becomes `:root`. There is no shadow host in the document.
   - Any other shape throws, so a changed Tailwind shell cannot pass silently.
   - The published sheet is also compiled, and its blocking codes are kept per utility.
3. **Supported** means the target compiles with no error, and Chrome agrees.
   - Chrome renders the published sheet (not the swept one) and Dragon's web output, in the parity environment (400×300, DPR 1, ltr, Ahem root). It compares every element's border box and every standard computed property in `getComputedStyle`'s full list, on html, body, the utility's div and its two children. There is no tolerance.
   - The native outputs come from the same resolved result, so an ios target that compiles (profile-gated) is supported when web's check agrees.
   - A target that compiled while web did not would stop the run; none did.
4. **Custom-property-only utilities** (from-*, via-*, to-*, ring colours, shadow colours, space-x-reverse, snap-mandatory…) do nothing alone. Judged alone they would count as "supported" while being refused in use, so each is judged on one element with its companion:
   - The companion is the first utility in class-list order (roots without "-" first) whose standard declarations read, through var(), a custom property it sets.
   - Failing that, it is a feeding modifier plus that modifier's reader. For example `from-0%` is judged with `bg-conic` and `from-amber-50`.
   - A modifier that no utility reads would stop the run; none exists.
5. **Invalid** means Dragon calls the CSS invalid (`DRAGON_CSS_INVALID_VALUE`, `DRAGON_CSS_PARSE`, `DRAGON_SELECTOR_DROPPED`) and Chrome's `CSS.supports` drops the same declaration or selector. If Chrome parses it, the utility is refused and flagged `chrome-parses`. An invalid-code blocker that Chrome cannot judge statically (a value with `var()`) stops the run until the check is extended.
6. **The outcome recorded** is the first blocking diagnostic per target: its code, what it names (the source text or profile feature), its fix message, and a group for ranking. Diagnostics about the sweep's own config or fixture (`DRAGON_CONFIG_INVALID`, `DRAGON_INPUT_INVALID` and the like) stop the run. One such bug (an out-of-range `minSdk`) was caught this way on the first run.
7. **Environment.** The utility sits on a static block `div`. Context-sensitive utilities (insets without `position`, flex-item properties outside a flex container) are therefore refused with `DRAGON_UNPROVEN_CONTEXT` where Dragon has no proof for a static block. That is a true answer for this document, and it counts 153 utilities. Pairing them with a context is a possible follow-up.
8. **Speed fix in the compiler.** Every compile hashed the three support profiles (2.1 MB of canonical JSON) with a slow pure-JS SHA-256, about 250 ms per compile. The SHA now runs on int32 words, UTF-8 is written into a typed array, and each profile's canonical JSON is written once (`CanonicalText`). **Digest bytes are unchanged**, so no device evidence input changes. `digest.test.ts` checks the SHA against node:crypto at every length from 0 to 200 bytes and on 1 MB, and checks the lone-surrogate encoding against the old code-point encoder.
9. **Compiler bugs found and fixed** (tests in selectors.test.ts):
   - **Silent non-match.** A class selector kept css-tree's raw escaped name, so `.w-1\/2` and `.\61` never matched what Chrome matches. Names are now unescaped (css-syntax-3 §4.3.7).
   - **Class names refused by the tree input.** The tree input refused every class name that is not an ASCII identifier (2,135 Tailwind names: `w-1/2`, `p-0.5`, `@container`). docs/api.md never required that. A name is now one HTML class token: non-empty, with no ASCII white space.

## Verification

- After merging origin/master 1703b45b: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` passes, 114 files and 2,351 tests (the sweep ratchet included). Before the merge: 112 files and 2,324 tests.
- The device step was not run: no evidence input changed. Digest bytes are identical, and no profile, fixture or emitter changed.
- Reviewable diff: 94 KB in 22 files (`python3 /tmp/reviewable.py origin/master HEAD`).

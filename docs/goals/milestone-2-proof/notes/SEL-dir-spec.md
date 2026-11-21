# SEL-dir: the `:dir(ltr)` and `:dir(rtl)` pseudo-classes, as Chrome 145 matches them

Worker spec (2026-11-21) for review before implementation.

## Why

Markless's `@markless/ui` drawer family puts two `:dir(rtl)` rules in its own `<style>` (packages/headless/components/src/drawer/drawer.tsrx, about lines 491-496 at Markless e63329eb8):

```css
[ui-content][ui-orientation=horizontal]:dir(rtl) { translate: calc(var(--offset, 0) * -100%) 0; }
[ui-content][ui-orientation=horizontal][ui-start]:dir(rtl) { translate: calc(var(--offset, 0) * 100%) 0; }
```

Dragon refuses both with `:dir(rtl) is not supported` (css/selectors.ts parsePseudoClass, the last `refuse`), so the drawer family cannot build for phones. Drawer is the only `@markless/ui` family that uses `:dir(`.

## What Chrome 145 does (tag 145.0.7632.6, references only)

- **Parsing** (css_selector_parser.cc ConsumePseudo, `case kPseudoDir`):
  - the argument must be exactly one identifier, with optional whitespace around it;
  - `:dir()`, `:dir("rtl")`, `:dir(ltr rtl)` and `:dir(ltr, rtl)` are invalid, so Chrome drops the whole rule (or just that argument inside a forgiving `:is()`/`:where()`);
  - any identifier parses, `:dir(auto)` and `:dir(foo)` included.
- **Matching** (selector_checker.cc CheckPseudoClass, `case kPseudoDir`):
  - the argument is compared ASCII case-insensitively with `ltr` and `rtl`;
  - any other identifier matches nothing;
  - otherwise the element matches when `element.CachedDirectionality()` equals the argument. Specificity is that of a pseudo-class, (0,1,0).
- **Directionality is the HTML concept, not the CSS `direction` property** (HTML §3.2.6.4; element.cc and html_element.cc):
  - `dir="ltr"` or `dir="rtl"` (ASCII case-insensitive, IsValidDirAttribute) sets the element's directionality.
  - With no valid `dir`, the element takes its parent's directionality (ParentDirectionality). At the root it is `ltr`, the document default.
  - `dir="auto"`, and `<bdi>` without a valid `dir` (HasDirectionAuto), take it from the first strong character of the text. Text controls take it from their value.
  - `<input type=tel>` without `dir` is `ltr` and does not inherit (ElementAffectsDirectionality).
  - An invalid value (`dir=""`, `dir="foo"`) counts as missing, so the element inherits.
  - A CSS `direction: rtl` never changes `:dir()`. Dragon's rtl harness environment is exactly this case: it reaches Chrome as `:where(html){direction:rtl}` (docs/api.md §7), so in that environment `:dir(rtl)` matches nothing unless a `dir` attribute says otherwise.
- **What the `dir` attribute renders:**
  - a presentational hint `direction: <value>` for `ltr`/`rtl` (html_element.cc CollectStyleForPresentationAttribute, `kDirAttr`). It is author-level, below every author rule. An invalid value on `<body>` alone hints `direction: ltr`;
  - the UA rule `[dir=ltr i], [dir=rtl i], [dir=auto i] { unicode-bidi: isolate }` (html.css, "bidi-rendering" block). Most block tags already have that rule by tag. `dir=auto` adds `unicode-bidi: plaintext` on `textarea` and `pre`.
- **Invalidation** (HTMLElement::OnDirAttrChanged, Element::UpdateDirectionalityAndDescendant):
  - a `dir` change recomputes the cached directionality of the element and of every descendant that inherits it, stopping at descendants with their own `dir`;
  - it calls `PseudoStateChanged(kPseudoDir)` on each and recalculates the subtree's style.
  - The result is the style a fresh document with the new `dir` would get. Dragon builds that result per case at build time.

## What Dragon does today

- **The `dir` attribute is refused on every element.** attributes.ts OWNERS sends it to "the bidi package (dir sets direction and unicode-bidi)", and project.ts checkTemplates reports DRAGON_UNSUPPORTED_ATTRIBUTE. attributes.test.ts pins this.
- **`[dir=...]` attribute selectors** already match, case-insensitively (match.ts HTML_CASE_INSENSITIVE_ATTRIBUTES).
- **`direction` is a cascaded longhand.** At the root it comes from the environment direction (resolve.ts directionContext). Below the root it is inherited, and logical.ts picks flow-relative mappings from it.
  - The public createProject pins the environment direction to `ltr`. Only the parity lanes resolve in `rtl`.
- **`unicode-bidi`** is checked per native target by analysis/bidi.ts checkBidi. The UA isolate on an inline box in an rtl context is refused on native. A block-level isolate always compiles.
- **Matching** (analysis/match.ts) runs over each case's linked tree. Attributes are per assignment: link.ts picks each attribute's arm for every reachable assignment. So a `dir` that follows state is already a per-case fact, and nothing new is needed to support it.
- **Presentational hints** enter the cascade through analysis/elements/replaced.ts presentationalHints, with origin `presentational-hint`. Today that covers only replaced elements and SVG.

## Slice D1: `:dir(ltr|rtl)` decided from the `dir` attributes Dragon sees

One PR, with Chrome comparisons and the regen in its own commit.

1. **Parse** (css/selectors.ts): add a PseudoClass `{ kind: 'dir'; direction: 'ltr' | 'rtl' | null }`.
   - Store `null` for an identifier other than `ltr`/`rtl`. It is valid and matches nothing, as in Chrome.
   - A non-identifier or extra tokens is Chrome-invalid and goes through the existing `chromeInvalid` path: the rule is dropped, or refused inside a forgiving list.
   - `specificityOf` needs no change, since `:dir()` falls into the default (0,1,0) arm.
   - The valid/invalid split comes from Chrome, not from this spec: scripts/capture-selector-validity.ts gains a functional `:dir(...)` corpus (`ltr`, `RTL`, `auto`, `foo`, empty, `"rtl"`, `ltr rtl`, `ltr, rtl`), and the parser reads the generated table.
2. **Match** (analysis/match.ts): `directionality(path)` is the nearest ancestor-or-self with `dir` equal to `ltr` or `rtl` (ASCII case-insensitive), or `ltr` when there is none.
   - It reads only the linked attributes. It never reads the environment direction or the computed `direction`.
   - It works unchanged inside `:is()`, `:not()`, `:has()` and `of S`, because every match is structural over the case tree. `:dir()` inside `:has()` is therefore supported, not refused.
   - A planted fault `dirFromDirection` (faults/sel-dir.ts) matches against the computed direction instead. The rtl-environment cases must fail with it.
3. **Accept the `dir` attribute** with the values `ltr`/`rtl` on supported HTML tags, static or per assignment:
   - it adds the presentational hint `direction` (presentationalHints, generalised beyond replaced tags). It must reach the direction that logical.ts reads, as an author `direction` already does;
   - it adds the UA `unicode-bidi: isolate` of html.css. Q2 asks whether this is hand-applied or captured.
   - attributes.ts drops `dir` from OWNERS and handles it by value, and attributes.test.ts changes to match.
   - The existing checkBidi refusal covers a `<span dir=rtl>` on native unchanged.
4. **Native lowering:** no host work.
   - `:dir()` is decided per case at build time, like every other selector. The result is per-element computed values in each assignment's styles.
   - web-css.ts already writes `direction` and `unicode-bidi` on every element, so the compiled web rendering needs no `:dir()` and no `dir`.
   - On-device code matches nothing new. The only new native input is an rtl subtree inside an ltr root. The layout input already carries a direction per box, and Q5 asks whether the profiles' direction facet already covers this case.

## Refused, by name (DRAGON_UNSUPPORTED_ATTRIBUTE, in every target)

- `dir="auto"`, and so `<bdi>`, `textarea[dir=auto]` and `pre[dir=auto]`: the directionality depends on text content (HTML §3.2.6.4), which a later bidi slice owns. `<bdi>` and `<pre>` are unsupported tags already.
- A `dir` value other than `ltr`, `rtl` or `auto`, such as `""` or `foo`. It inherits directionality and hints `direction: ltr` on `<body>`. Q3 asks whether to refuse it or model it.
- `dir` on an SVG element: it gets no hint and inherits.
- Any arm of a state-dependent `dir` that is one of the above. checkTemplates already loops over every arm's value.

`:dir()` itself refuses nothing new. The `:focus-within`-style interaction refusals are unaffected.

## Parity fixtures (chrome-dual plus linux-dragon-layout)

Each fixture runs in both environment directions (`both(...)`) unless noted. Every rule writes a visible box property (width, margin, background), so the layout lane sees each match.

- **`selectors-dir`:**
  - an ltr page (no `dir`) and a `dir="rtl"` section;
  - a nested `dir="ltr"` override inside it, and an element without `dir` under the rtl ancestor;
  - `:dir(rtl).card`, `.card:dir(ltr)` and `:not(:dir(rtl))`;
  - `:is(:dir(rtl))` and `.a:has(:dir(rtl))`;
  - `:dir(RTL)` with `dir="RTL"`, and `:dir(foo)`, which matches nothing.
  - The rtl environment proves that `:dir()` follows `dir` and not `direction`.
- **`selectors-dir-drawer`:** the drawer's shape. `[ui-content][ui-orientation=horizontal]` with `position: fixed`, `inset-inline` and the two `:dir(rtl)` translate rules, once at the top level and once inside `dir="rtl"`, with `ui-start` present and absent.
- **`tree-selectors-dir-state`** (a tree fixture, which runs in both directions): a `dir` that follows a state over `rtl`, `ltr` and absent, with an inheriting child styled by `:dir()`.
- **`bidi-dir-attribute`:**
  - the hint loses to an author `direction`, and `:dir()` still follows `dir`;
  - the `[dir]` UA isolate on a block, and on an ltr `<span dir=ltr>`;
  - `dir="rtl"` on a block with flow-relative margins.
- **`selectors-dir-invalid`:** `:dir()`, `:dir("rtl")`, `:dir(ltr rtl)` and `:dir(ltr, rtl)` drop their rules.
- **Refusal fixtures:**
  - `reject-dir-auto`: `dir="auto"`;
  - `reject-dir-invalid-value`: `dir="foo"`;
  - `reject-selector-dir-forgiving`: `:is(:dir("rtl"), .a)`.

## Markless's need, measured against D1

- **A page without `dir`:** both drawer rules match no element, in every environment, as in Chrome. The `:dir` refusal is gone and the drawer builds for phones, unless another of its constructs is refused; that is not measured here.
- **A drawer inside a `dir="rtl"` page:** handled when the `dir="rtl"` is a static attribute on an element in the document Markless sends Dragon, such as the app's root `<div dir="rtl">`. Markless passes static attributes through (packages/mobile/src/style-input.ts, `attributes: { ...node.attributes }`).
- **Not handled:**
  - **`dir` on `<html>`:** Markless's style input starts at the root's children, so Dragon never sees an `<html dir>` and the page is ltr to Dragon. Markless must put `dir` on an element it sends.
  - **A bound `dir={...}`:** Markless's isNativeStyleStateAttribute (packages/serializer/src/native-view.ts) leaves `dir` out, so it never reaches Dragon. Dragon handles it per case, but Markless needs a follow-up to send it.
- **For Markless, not Dragon:** drawer-swipe.ts `isRightToLeft` reads the computed `direction`, while the CSS reads `:dir()`. They agree when rtl comes from `dir` and disagree when a page writes `direction: rtl` in CSS.

## Open questions for the Judge

1. **Order:** D1 could split into D1a (`:dir()` only, with `dir` still refused, so every element is ltr) and D1b (accept `dir`). D1a alone unblocks the drawer on ltr pages. One PR is proposed, because D1a's fixtures cannot show an rtl match.
2. **The `[dir]` UA rule:** should `unicode-bidi: isolate` be applied by hand from html.css, as applyHidden does, or captured as UA dataset rows keyed `<tag>[dir]` for every supported tag?
3. **Invalid `dir` values:** refuse them (proposed), or model them (inherit, plus `<body>`'s `direction: ltr` hint)?
4. **The device locale:** `:dir()` follows only `dir`, as in Chrome, and a phone's rtl locale stays out (proposed). Or should Dragon or Markless map the locale to a root `dir`?
5. **Native proof:** an rtl subtree inside an ltr root is a new mix for native. Do the profiles' rtl direction facet and its device rows cover it, or does `selectors-dir` need its own device rows?

## Judge verdict (2026-11-21)

Approved with the rulings and amendments below. Where they differ from the sections above, they win.

### Rulings

- **Q1 (order):** one PR, in separate commits: the capture table; parse, match and faults; the `dir` attribute with its hint and bidi; the fixtures, then the CI regen.
- **Q2 (the `[dir]` UA rule):** capture `dir`'s `unicode-bidi` effect per supported tag, plus an origin probe (`<span dir=rtl style='unicode-bidi:revert'>`). Do not hand-copy html.css. Blink may add it as a presentational hint in HTMLElement::CollectStyleForPresentationAttribute, skipping `bdi`, `bdo` and `output`.
- **Q3 (invalid values):** refuse invalid `dir` values. An enumerated value is not trimmed, so `dir=' rtl'` is invalid.
- **Q4 (device locale):** `:dir()` follows only `dir`, never the device locale.
- **Q5 (native proof):** native proof is missing for `fixed-in-*/rtl/cb-ltr` and `fixed-in-*/ltr/cb-rtl`. The fixtures must produce those layout rows.

### Amendments

- **A1 Parse:** the `:dir(...)` corpus goes in scripts/capture-selector-validity.ts, and the parser uses the table for `:dir()` (drop) and the identifiers. `dir` joins the non-functional corpus, so a bare `:dir` drops. `dir` joins escapes.ts PSEUDO_ARGUMENTS.
- **A2 Invalid fixtures** (this corrects §1 above, which sent them through `chromeInvalid`):
  - `selectors-dir-invalid` keeps only `:dir()` (dropped, DRAGON_SELECTOR_DROPPED).
  - `:dir("rtl")`, `:dir(ltr rtl)` and `:dir(ltr, rtl)` become reject fixtures pinned to DRAGON_CSS_PARSE, because css-tree fails to parse them.
  - `reject-selector-dir-forgiving` pins DRAGON_CSS_PARSE for `:is(:dir("rtl"), .a)`, plus a second case pinned to DRAGON_UNSUPPORTED_SELECTOR for `:is(:dir(), .a)`.
- **A3 Faults:** no `dirFromDirection`, since the matcher runs before the cascade. Add `dirNotInherited`, where only the element's own `dir` counts; it must fail the inheriting-child and nested-override cases. Add `dirCaseSensitive`, which must fail `dir=RTL`. `dirFromEnvironment` is optional.
- **A4 Direction hint:**
  - it sets elementDirection's `undeclared` for the element itself, not the parent's (logical.ts, resolve.ts directionContext);
  - it carries a stand-in declaration (`presentationHint: true`, span at the attribute), as svg.ts svgHintDeclaration and project.ts presentationHint do, so profile and support checks see it;
  - `direction: revert` on an element with `dir` rolls back to the parent's direction, and `revert-layer` rolls back to the hint. Test both, or refuse them by name.
- **A5 Tags:**
  - accept `dir=ltr|rtl` on the supported non-replaced, non-control HTML tags;
  - refuse `dir` on `html` (the root; `reject-dir-root`), because Chrome's environment author rule beats the hint;
  - refuse it on SVG tags, and on controls, replaced tags and `body`, unless a fixture proves them;
  - the refusal is written by value in project.ts checkTemplates, in every arm.
- **A6 unicode-bidi:** apply the captured table through the origin Chrome shows (the hint path, or the UA path after the cascade, like applyHidden), and only where `unicode-bidi` is defaulted. The revert probe pins the origin. checkBidi's existing native refusal of an inline `<span dir=rtl>` in an rtl context needs a reject or native-refusal fixture.
- **A7:** `bidi-dir-attribute` adds `<ul dir=rtl>`, where `padding-inline-start` becomes `padding-right`.
- **A8 Rounding:** the rtl-inside-ltr fixtures use fractional widths (for example 60% and odd px sizes) at DPR 2, 2.625 and 3. `selectors-dir-drawer` uses `--offset` 0 and a fraction such as 0.37.
- **A9 Native proof:** `selectors-dir-drawer` runs `both(layout)` with `position: fixed` inside `dir=rtl` under an ltr root, plus its mirror, so ios and android get `fixed-in-block/rtl/cb-ltr` and `fixed-in-block/ltr/cb-rtl` rows.
- **A10 State:** `tree-selectors-dir-state` gets an arm where the `dir` ancestor flips while a descendant's own `dir=ltr` stays. The native lanes cover the transition.
- **A11 More `selectors-dir` cases:** `:dir(auto)` matches nothing on an ltr page; `:nth-child(1 of :dir(rtl))`; `:dir(rtl)::before` on an rtl host.
- **A12 Markless path:** copy Markless e63329eb8's packages/mobile/proofs/u102-drawer-swipe/native-style-input.json into examples/markless-styles/input/drawer.native-style-input.json, and report its refusals on ios and android before and after, through `pnpm run markless:style-export`.
- **A13:** Markless follow-ups are not in this PR; the PR body lists them.
- **A14:** one PR, whose body states the measured reviewed size (outside the .macroscope/ignore.md paths). Split into D1a/D1b only if it is well over 150 KB.

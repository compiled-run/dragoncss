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

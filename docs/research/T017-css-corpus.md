# T017 CSS corpus: what Markless code actually uses

Method: `<style>` blocks extracted from `.tsrx` files (opening tag at line start, so prose mentions of `<style>` in comments are skipped; node_modules and dist excluded). Structure, declarations and at-rules parsed with postcss 8.5.28; every selector parsed with lightningcss 1.33.0 (typed selector AST); every block also run through lightningcss for validation. Units and function names are lexed from the postcss declaration value text (lexer, not typed values). Script: /private/tmp/t017/run.cjs, raw data: /private/tmp/t017/out.json.

Corpora: `ui` = packages/headless/components/src (families + scenarios); `websiteTsrx` = website .tsrx minus generated playground; `websiteGenerated` = website/components/docs/playground/generated (tool-emitted, heavy duplication, kept separate); `websiteGlobal` = website/styles/global.css + brand.css; `demos` = 84 .tsrx files, **zero `<style>` blocks** (demos style through linked .css files, out of scope of this corpus).

## Tier definitions used

- A: flex-only layout, compiler-resolved selectors: type, class, id, attribute (any operator), universal, `&` nesting, descendant/child combinators whose ancestor side is in the same component, state pseudo-classes (hover, active, focus, focus-visible, focus-within, disabled, checked, not, is, where, empty, open ...), @layer, @media, var(). Paint/text properties (color, background, border, font, box-shadow, transform, opacity, linear-gradient, color-mix) and position absolute/relative count as A. Web-only no-op properties (cursor, outline, pointer-events, user-select, touch-action ...) count as A and are listed separately.
- B: A plus display:block/grid/inline-grid/flow-root and grid-*/justify-items/justify-self/place-items/place-self (Taffy).
- C: anything with a blocker: anchor positioning (anchor-name, position-anchor, position-area, position-try*, anchor()), position fixed/sticky, display inline/inline-block/contents, float/clear/vertical-align, filter/backdrop-filter/mix-blend-mode/mask/clip-path, content, transition*/animation*, :has, structural pseudo-classes (:nth-child, :root ...), :dir, pseudo-elements, sibling combinators, @supports/@container context, cross-component context selectors (heuristic below).
- A declaration takes the worse of its own tier and its rule's selector/context tier. A rule takes the worst of its selector, context and declarations. Keyframe step rules are not counted as rules (the animation property is the blocker).

Cross-component heuristic: the compiler adds the scope class to each selector's subject compound only (packages/compiler/src/passes/public-render/style-scopes.ts:9), so the subject is always this module's markup, but ancestor/sibling compounds are unscoped and can match any component. A rule is flagged when some compound left of a combinator has no class that this same file uses as a subject class (and is not `&`). This over-flags (e.g. `p span` inside one component) and under-flags (a shared class name). Most flags are `html[...]`/`html.dark` root-state ancestors, reported separately.

## Tier shares

| corpus | files/blocks | rules A / B / C | decls A / B / C |
|---|---|---|---|
| ui | 21/47 | 73: 50 (68.5%) / 1 (1.4%) / 22 (30.1%) | 160: 121 (75.6%) / 1 (0.6%) / 38 (23.8%) |
| websiteTsrx | 42/43 | 1155: 707 (61.2%) / 117 (10.1%) / 331 (28.7%) | 2798: 2234 (79.8%) / 156 (5.6%) / 408 (14.6%) |
| websiteGenerated | 13/13 | 1101: 599 (54.4%) / 119 (10.8%) / 383 (34.8%) | 3294: 2636 (80.0%) / 167 (5.1%) / 491 (14.9%) |
| websiteGlobal | 2/2 | 124: 53 (42.7%) / 8 (6.5%) / 63 (50.8%) | 479: 289 (60.3%) / 10 (2.1%) / 180 (37.6%) |
| demos | 0/0 | 0: 0 (-) / 0 (-) / 0 (-) | 0: 0 (-) / 0 (-) / 0 (-) |

If `html[...]`/`html.dark` ancestors are treated as a resolvable root environment (theme/platform attribute on the app root): websiteTsrx moves 112 C rules (88 to A, 24 to B) -> A 795 (68.8%) / B 141 (12.2%) / C 219 (19.0%); websiteGenerated moves 13 -> C 370 (33.6%).

## Top C blockers (rule counts; a rule can carry several)

- ui: property position-anchor 8, property anchor-name 7, property position-area 7, position: fixed 6, cross-component context selector (heuristic) 3, pseudo-class :dir 2, anchor() function 1
- websiteTsrx: cross-component context selector (heuristic) 169, property transition 40, property animation 37, display: inline-block 32, @container context 29, display: inline 29, property animation-* 9, structural pseudo-class :nth-child 8, position: fixed 5, @supports context 4, position: sticky 3, property container-* 3, pseudo-element ::details-content 3, display: contents 2, anchor() function 2, property position-anchor 2, pseudo-element ::before 2, property content 2, property mask-* 2, property clear 1
- websiteGenerated: pseudo-class :has 265, @supports context 34, property transition 29, property position-area 22, property anchor-name 19, position: fixed 19, property position-anchor 19, property position-try-* 19, display: contents 13, sibling combinator 13, cross-component context selector (heuristic) 13, display: inline 3
- websiteGlobal: cross-component context selector (heuristic) 24, pseudo-element ::before 9, pseudo-element ::after 7, property transition 7, pseudo-class :has 6, structural pseudo-class :nth-child 6, property content 4, property filter 4, property animation 4, structural pseudo-class :root 3, display: inline-block 3, @supports context 3, property vertical-align 3, property mix-blend-mode 2, position: fixed 2, property transition-* 2, property float 2, property anchor-name 2, display: var(--sprite-light) 2, display: var(--sprite-dark) 2

Declaration-level blocker counts are in out.json (`blockersDecls`).

## Usage tables

### ui

- parse findings: none
- selector components: attribute 89, type 12, pseudo-class 11, class 5, combinator:descendant 3
- pseudo-classes: not 9, dir 2
- pseudo-elements: none
- attribute operators: exists 67, equal 20, prefix 2
- at-rules: @layer (block) 42
- @media/@container/@supports features: none
- display: flex 5, none 1, grid 1
- position: absolute 12, fixed 6, relative 5
- functions: var 19, calc 6, rgb 3, anchor 2, anchor-size 2
- units (lexed; data-URI noise such as "c", "csvg", "e" dropped): px 10, % 6, em 1, vmax 1
- rules with combinators: 3; flagged cross-component: 3
- properties top 40: position 23, touch-action 9, anchor-scope 8, position-anchor 8, display 7, anchor-name 7, position-area 7, translate 6, left 5, -webkit-user-select 4, user-select 4, inset 4, forced-color-adjust 4, flex-direction 4, inset-inline 3, inset-block 3, --ui-anchor 3, gap 3, inset-inline-start 3, inset-block-start 3, pointer-events 3, width 3, height 3, cursor 3, fill 2, stroke 2, overflow 2, inset-inline-end 2, inset-block-end 2, white-space 2, bottom 2, top 2, padding 2, flex 2, overscroll-behavior 1, letter-spacing 1, border 1, border-color 1, inline-size 1, block-size 1
- properties full list (44): --ui-anchor, -webkit-touch-callout, -webkit-user-select, anchor-name, anchor-scope, block-size, border, border-color, bottom, box-shadow, cursor, display, fill, flex, flex-direction, forced-color-adjust, gap, height, inline-size, inset, inset-block, inset-block-end, inset-block-start, inset-inline, inset-inline-end, inset-inline-start, left, letter-spacing, min-block-size, min-inline-size, overflow, overscroll-behavior, padding, pointer-events, position, position-anchor, position-area, stroke, top, touch-action, translate, user-select, white-space, width

### websiteTsrx

- parse findings: LC Unknown at rule: @anatomy-tree-selection; LC Unknown at rule: @keyboard-inspection; LC Unknown at rule: @keyboard-platforms; LC Unknown at rule: @keyboard-highlights; LC Unknown at rule: @anatomy-selection
- selector components: class 1327, attribute 641, combinator:descendant 517, type 280, nesting 147, pseudo-class 124, combinator:child 16, pseudo-element 6, universal 4
- pseudo-classes: focus-visible 30, hover 27, not 25, is 18, nth-child 8, disabled 7, active 5, last-child 3, focus 1
- pseudo-elements: details-content 3, before 2, webkit-scrollbar 1
- attribute operators: equal 553, exists 88
- at-rules: @keyframes 34, @media 25, @container 7, @supports 2, @anatomy-tree-selection 1, @keyboard-inspection 1, @keyboard-platforms 1, @keyboard-highlights 1, @property 1, @anatomy-selection 1
- @media/@container/@supports features: @media max-width 15, @media prefers-reduced-motion 8, @container max-width 6, @media min-width 3, @supports position-area 1, @supports position-anchor 1, @media max-height 1, @container min-width 1
- display: none 145, grid 98, flex 60, inline-block 32, inline 29, block 26, inline-flex 18, contents 2, revert 1, var(--sprite-light) 1, var(--sprite-dark) 1
- position: relative 21, absolute 13, fixed 5, sticky 3, static 1
- functions: var 530, rotate 110, translate 87, scale 83, color-mix 47, calc 35, minmax 28, min 15, repeat 11, rgb 7, translatey 6, linear 5, clamp 5, url 5, oklch 5, translatex 4, linear-gradient 3, scaley 3, rgba 3, anchor 2, drop-shadow 1, anchor-size 1, inset 1, matrix 1, attr 1
- units (lexed; data-URI noise such as "c", "csvg", "e" dropped): px 793, % 223, rem 184, em 168, deg 111, s 41, ms 38, fr 36, vw 8, ch 5, svh 3, vh 2
- rules with combinators: 480; flagged cross-component: 169
- properties top 40: display 413, transform 130, padding 128, font-size 127, background 110, width 108, gap 99, color 83, border 78, border-radius 67, height 64, align-items 62, margin 58, opacity 49, font 49, fill 47, cursor 45, position 43, transition 40, animation 37, stroke 36, font-weight 34, box-shadow 34, flex 32, stroke-width 32, line-height 30, text-align 29, grid-template-columns 29, overflow 26, outline 26, justify-content 23, min-height 22, font-family 21, outline-offset 21, grid-column 20, stroke-linecap 19, min-width 18, box-sizing 17, max-width 15, margin-bottom 15
- properties full list (179): --accent, --anatomy-selection-y, --branch-accent, --branch-height, --card-focus, --eye, --glaze, --ink, --key-fill, --key-opacity, --key-stroke, --keyboard-control-radius, --keyboard-control-shadow, --keyboard-key-depth, --keyboard-preview-depth, --light-raised, --lilac, --mug-height, --mug-width, --page-height, --paper, --path-ink, --picker-edge, --picker-wash, --plane-y, --select-shadow, --select-wash, --shadow-color, --snap, --spring, --story-ink, --story-paper, --story-pink, --story-purple, --tilt, --view, -webkit-box-decoration-break, accent-color, align-items, align-self, anchor-name, anchor-scope, animation, animation-delay, animation-duration, animation-name, animation-play-state, aspect-ratio, background, background-color, background-image, background-position, background-repeat, background-size, block-size, border, border-block-start, border-bottom, border-color, border-left, border-left-color, border-radius, border-right, border-top, border-width, bottom, box-decoration-break, box-shadow, box-sizing, clear, clip-path, color, color-scheme, container-type, content, content-visibility, cursor, display, fill, filter, flex, flex-direction, flex-wrap, font, font-family, font-size, font-style, font-variant-numeric, font-weight, gap, grid-area, grid-column, grid-row, grid-template-columns, height, inline-size, inset, inset-block-start, inset-inline, inset-inline-start, isolation, justify-content, justify-items, justify-self, left, letter-spacing, line-height, list-style, margin, margin-block, margin-block-end, margin-block-start, margin-bottom, margin-inline, margin-inline-start, margin-left, margin-top, mask-image, max-height, max-width, min-block-size, min-height, min-width, object-fit, object-position, opacity, order, outline, outline-offset, overflow, overflow-wrap, overflow-x, overflow-y, padding, padding-block, padding-block-end, padding-bottom, padding-inline, padding-inline-end, padding-inline-start, padding-left, padding-right, padding-top, place-content, place-items, pointer-events, position, position-anchor, position-area, position-try-fallbacks, right, rotate, scroll-snap-align, scroll-snap-type, scrollbar-width, stroke, stroke-dasharray, stroke-linecap, stroke-linejoin, stroke-width, text-align, text-decoration, text-decoration-color, text-decoration-thickness, text-overflow, text-shadow, text-transform, text-underline-offset, top, touch-action, transform, transform-origin, transition, user-select, vector-effect, visibility, white-space, width, z-index

### websiteGenerated

- parse findings: none
- selector components: class 2174, pseudo-class 1195, combinator:descendant 627, attribute 609, type 29, combinator:next-sibling 13, nesting 13, universal 3
- pseudo-classes: focus-visible 360, hover 290, has 265, is 258, empty 16, disabled 6
- pseudo-elements: none
- attribute operators: equal 478, exists 131
- at-rules: @media 43, @supports 22
- @media/@container/@supports features: @media max-width 29, @supports position-area 22, @media prefers-reduced-motion 14
- display: block 284, none 87, flex 60, grid 45, contents 13, inline-flex 10, inline-grid 3, inline 3
- position: relative 58, absolute 32, fixed 19
- functions: var 832, color-mix 108, minmax 26, calc 22, min 19, linear-gradient 13, rotate 12
- units (lexed; data-URI noise such as "c", "csvg", "e" dropped): em 588, px 364, % 146, rem 29, fr 26, ch 16, vw 16, ms 15, lh 13, deg 12
- rules with combinators: 501; flagged cross-component: 13
- properties top 40: display 505, color 201, padding 184, background 162, font-family 153, font-size 133, border 111, position 109, border-radius 102, line-height 85, --shiki-dark 84, gap 69, align-items 66, width 66, min-width 64, cursor 50, box-shadow 48, overflow 42, opacity 37, z-index 35, margin 35, inset 35, margin-block 35, border-block-start 33, justify-content 31, height 31, grid-area 29, white-space 29, transition 29, font 28, grid-template-columns 26, margin-block-end 26, margin-inline-start 26, max-height 26, min-height 26, grid-row 26, --pg-accent 26, --pg-wash 26, box-sizing 22, inset-inline-start 22
- properties full list (74): --pg-accent, --pg-edge, --pg-font, --pg-shadow, --pg-wash, --shiki-dark, align-items, align-self, anchor-name, anchor-scope, background, border, border-block-end, border-block-start, border-color, border-radius, box-shadow, box-sizing, color, cursor, display, flex, flex-wrap, font, font-family, font-size, font-weight, gap, grid-area, grid-row, grid-template-columns, height, inset, inset-block-end, inset-block-start, inset-inline-end, inset-inline-start, justify-content, justify-self, line-height, margin, margin-block, margin-block-end, margin-inline-start, max-height, max-width, min-height, min-width, opacity, outline, outline-offset, overflow, overflow-x, padding, padding-block-end, padding-block-start, place-items, pointer-events, position, position-anchor, position-area, position-try-fallbacks, tab-size, text-align, text-decoration, text-decoration-color, text-shadow, text-underline-offset, transform, transition, user-select, white-space, width, z-index

### websiteGlobal

- parse findings: none
- selector components: class 184, type 98, combinator:descendant 92, pseudo-class 56, attribute 22, pseudo-element 19, nesting 5, combinator:child 3, universal 1, combinator:next-sibling 1
- pseudo-classes: hover 15, is 10, focus-visible 7, has 6, nth-child 6, not 4, root 3, scope 1, active 1, focus 1, empty 1, first-child 1
- pseudo-elements: after 10, before 9
- attribute operators: equal 12, exists 10
- at-rules: @media 7, @font-face 3, @keyframes 3, @supports 2
- @media/@container/@supports features: @media prefers-reduced-motion 4, @media min-width 2, @media hover 1, @media pointer 1, @media max-width 1, @supports anchor-scope 1, @supports position-anchor 1
- display: block 9, flex 8, none 3, inline-block 3, var(--sprite-light) 2, var(--sprite-dark) 2, inline-flex 1, contents 1, grid 1, inline 1
- position: relative 5, absolute 4, fixed 2, static 1
- functions: var 169, oklch 21, color-mix 18, calc 17, clamp 14, url 8, rotate 4, cubic-bezier 2, blur 2, translatex 2, min 2, anchor 2, drop-shadow 2, scale 2, minmax 1, translate 1, translatey 1
- units (lexed; data-URI noise such as "c", "csvg", "e" dropped): rem 74, % 50, px 43, em 33, ms 18, vw 15, deg 7, ch 3, vh 2, dvh 1, fr 1
- rules with combinators: 61; flagged cross-component: 24
- properties top 40: display 31, color 21, font-size 21, background 19, padding 19, width 17, position 12, border-radius 11, margin 10, line-height 10, height 10, gap 10, transform 10, opacity 8, border 8, --shadow-color 7, flex 7, transition 7, font-family 6, min-height 6, background-image 6, align-items 6, margin-block 6, content 4, white-space 4, filter 4, max-width 4, overflow-x 4, box-shadow 4, animation 4, font-weight 3, z-index 3, cursor 3, right 3, top 3, max-height 3, padding-block 3, overflow 3, margin-top 3, border-bottom 3
- properties full list (148): --code-edge, --code-surface, --font-mono, --grain-fiber-blend, --grain-fiber-opacity, --grain-speck-blend, --grain-speck-opacity, --green-soft, --green-star, --header-height, --hover-wash, --ink, --mark, --marker-wash, --muted-ink, --on-accent, --on-mark, --paper, --pink, --purple, --quiet-fill, --raised, --shadow-color, --shadow-grow, --shadow-x, --shadow-y, --slab, --slab-ink, --space-2xl, --space-l, --space-m, --space-s, --space-s-l, --space-xl, --space-xs, --sprite-dark, --sprite-light, --step--1, --step--2, --step-0, --step-1, --step-2, --step-3, --step-5, --switch-off, --switch-on, --theme-toggle-size, --tinted, --tinted-quiet, --yellow, align-items, align-self, anchor-name, anchor-scope, animation, background, background-image, background-position, background-repeat, background-size, block-size, border, border-bottom, border-collapse, border-color, border-left, border-radius, border-top, bottom, box-shadow, color, content, cursor, display, filter, flex, flex-direction, flex-wrap, float, font, font-family, font-size, font-weight, gap, grid-template-columns, height, inline-size, inset, inset-block, inset-inline, justify-content, left, letter-spacing, line-height, list-style, margin, margin-block, margin-bottom, margin-inline, margin-top, max-height, max-width, min-height, min-width, mix-blend-mode, object-fit, object-position, opacity, outline, outline-offset, overflow, overflow-wrap, overflow-x, overflow-y, overscroll-behavior, padding, padding-block, padding-inline, padding-left, padding-top, pointer-events, position, position-anchor, right, rotate, scroll-behavior, scroll-margin-top, scrollbar-width, shape-outside, tab-size, text-align, text-decoration, text-decoration-color, text-decoration-thickness, text-shadow, text-transform, text-underline-offset, top, transform, transition, transition-delay, transition-duration, translate, user-select, vertical-align, white-space, width, z-index

## Readings

- @markless/ui is almost entirely attribute-selector CSS (82 attribute components, 1 class) inside `@layer` blocks (37). Its only C blockers are the overlay families: anchor positioning (anchor-name 7, position-anchor 8, position-area 7, anchor() 1) and `position: fixed` (6), plus `:dir(rtl)` (2) and one `[role^="menuitem"] [role="menu"]` nested-menu context rule. So a native tier that owns overlay placement (anchor + fixed as a platform popover/sheet primitive) leaves 5 of 73 ui rules in C (2 `:dir(rtl)`, the nested-menu rule, and 2 `[data-testid="toolbar"] button` rules in tour test scenarios), so about 93% of ui rules would compile.
- 29 of 160 ui declarations are web-only no-ops on native (touch-action, user-select, forced-color-adjust, pointer-events, cursor, overscroll-behavior); they are counted A here but need a "silently ignored" rule rather than an error.
- Website hand-written CSS: the biggest blockers are root-state ancestors (`html.dark &`, `html[data-mascot-*] &`: 153 of 169 cross flags), transitions/animations (86 rules), inline flow (`display: inline`/`inline-block`, 61), and `@container` (29). Generated playground CSS is dominated by `:has()` (265 rules).
- Grid/block (B) adds about 10% of rules on the website corpora and almost nothing for ui (1 rule).
- A counts are optimistic where compile-time resolution is assumed: `color-mix()` with `var()` arguments, `transform` functions, gradients and `box-shadow` are counted A.
- lightningcss rejects 5 unknown at-rules in website .tsrx (`@anatomy-selection`, `@anatomy-tree-selection`, `@keyboard-inspection`, `@keyboard-platforms`, `@keyboard-highlights`); postcss accepts them. Not investigated further.

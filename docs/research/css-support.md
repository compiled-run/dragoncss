# CSS support across web, iOS, Android and email

## Summary

**What you can style the same way everywhere (web, iPhone, Android):**
- boxes: sizes, margins, padding, solid borders, rounded corners and one outset shadow;
- solid colours, `light-dark()`, simple linear and radial gradients, opacity;
- flex layout;
- grid and normal block layout, but only if we ship Taffy. Taffy is the layout library the app would include; the alternative, Yoga, has no grid;
- text: font family, size (in `rem` it follows the phone's text-size setting), weight, colour, alignment, line clamping and ellipsis;
- 2D transforms, simple transitions, custom properties, `calc`/`min`/`max`/`clamp`, width and dark-mode media queries, and safe areas.

**What differs even when it works:** text wrapping and line height, scrolling feel, shadow softness, gradients and focus rings follow each platform. They are close, not pixel-identical.

**What a phone build rejects with an error:**
- styles reaching into another component, sibling selectors and `:has()`;
- `inline-block` inside text, floats and tables;
- most filters and blend modes on iOS;
- keyframe animations, overlay placement and container queries until their later release;
- paint that can only be approximated, such as dashed borders, inset or multiple shadows, conic gradients and backdrop blur. These are marked "approx" in the tables and come later; the first release rejects them, except outlines.

**Email** is a much smaller list, built around table layout; Outlook for Windows has no flex, grid, rounded corners or shadows.

**How agents are stopped:** one list per platform says what works. The compiler, the editor and the docs all read that same list. Anything not on it is a build error with the file, the line and a fix, so an agent running `pnpm typecheck` sees it and corrects it. Nothing counts as supported until a test comparing the browser with the phone passes. Today no such tests exist, so every entry is still a proposal.

**Where the work runs:** everything at build time (reading CSS, deciding which rules apply, working out values, checking the list, writing the style tables) is TypeScript using yuku, packaged like yuku and consumed by the Markless compiler. On the phone, only a small Swift (later Kotlin) routine applies the tables when conditions change, and layout uses a prebuilt native library (Taffy, or Yoga).

## Details

Simple boxes, solid colors, basic text styling, explicit lengths and percentages are the useful common ground. Even there, email client limits and native font measurements need tests. Taffy lets web and native apps share flex, grid and block layout; email needs a smaller profile built around authored tables and styles resolved at build time.

Text wrapping, line height, scroll physics, shadows, gradients and focus cues differ by platform. “Exact” means the specified behavior within a measured tolerance, not identical pixels. This report does not prove cross-target rendering.

Some features cannot work in the proposed first release: cross-component native selectors, sibling selectors, :has(), layout transitions and arbitrary browser filters on iOS. Native inline text cannot silently become a browser box. Email cannot rely on scripting or on CSS missing from selected clients. Unsupported cases need errors and authored fallbacks.

Agents are stopped by compiler/typecheck failures backed by the same support data as editor diagnostics and documentation. Unknown features fail closed. A mapping without a passing conformance test stays proposed; these documents enable no native or email support today.

## Reading the tables

These are **proposed first-release authoring outcomes**, based on the [property evidence](T029-support-evidence.md) and [guardrail design](T030-agent-guardrails.md). The [revised styling design](T018-styling-design.md) and [restricted CSS direction](T025-styling-direction.md) take precedence where engine capabilities exceed release scope. Layout-changing approximations are refused. Text caveats describe native metrics, not equal browser line breaks.

**exact:** same contract within a future measured tolerance. **caveat:** stated restriction or required lowering. **approx:** intentionally different paint with a warning and fallback; these are later paint approximations that the first release rejects, except outlines. **unsupported:** build error. **no-effect:** candidate omission, accepted only after tests prove unchanged layout, paint, hit testing and accessibility. Every native/email classification is proposed, including no-effect.

Native layout assumes Taffy, explicit web defaults and adapters satisfying the stated conditions. Native text measurement and Android device-pixel rounding still change geometry. Unreleased position work is not a released dependency. Web is the browser reference, subject to an owner-selected browser floor, not a browser certification.

Email uses a conservative proposed set from the evidence: Gmail web/iOS, Apple Mail iOS, classic Outlook Windows, Outlook.com and Yahoo. Classic Outlook uses Word; it is not new Outlook. Source tests range from 2019 to 2026, so old results need fresh checks. A grouped caveat permits only its stated subset, never every value. Untested subcases fail closed. Table conversion and VML need separate proof; author table markup meanwhile.

The [JSON draft](css-support-profile.draft.json) maps each support-table row to iOS and email entries. Operational status stays unsupported; proposedStatus records the table class, maturity is proposed, and tests is empty. Illustrative test IDs from the research have not been treated as existing tests.

## Layout and sizing

Source: [property/platform evidence](T029-support-evidence.md#41-layout); release restrictions follow the linked styling design.

| Feature | Web | iOS | Android | Email |
|---|---|---|---|---|
| <a id="flex"></a>Flex layout | **exact** — Browser reference. | **exact** — Taffy flex; explicit CSS defaults. | **exact** — Taffy flex; explicit CSS defaults. | **unsupported** — Classic Outlook lacks flex; author table markup. |
| <a id="grid"></a>Grid layout | **exact** — Browser reference. | **exact** — Taffy grid; no subgrid/masonry. | **exact** — Taffy grid; no subgrid/masonry. | **unsupported** — Classic Outlook lacks grid; Gmail track properties also fail. |
| <a id="block"></a>Block flow and margin collapsing | **exact** — Browser reference. | **exact** — Taffy block algorithm; set display explicitly. | **exact** — Taffy block algorithm; set display explicitly. | **caveat** — Normal block markup; Word margin behavior unverified. |
| <a id="flow-root"></a>Flow root | **exact** — Browser reference. | **exact** — Taffy formatting context. | **exact** — Taffy formatting context. | **unsupported** — No separate client evidence. |
| <a id="display-none"></a>Display none | **exact** — Browser reference. | **exact** — Remove from layout. | **exact** — Remove from layout. | **caveat** — Classic Outlook partial; test hidden content. |
| <a id="inline"></a>Inline text | **exact** — Browser reference. | **caveat** — Attributed runs only when inline in every state; native metrics. | **caveat** — Attributed runs only when inline in every state; native metrics. | **caveat** — HTML text runs; client typography differs. |
| <a id="inline-box"></a>Inline-block and inline-flex | **exact** — Browser reference. | **unsupported** — Row heuristics change layout; use explicit flex container. | **unsupported** — Row heuristics change layout; use explicit flex container. | **caveat** — Inline-block works; inline-flex fails in Gmail. Prefer table cells. |
| <a id="contents"></a>Display contents | **exact** — Browser reference. | **caveat** — Proposed build flattening; preserve handles/semantics; no Taffy value. | **caveat** — Proposed build flattening; preserve handles/semantics; no Taffy value. | **unsupported** — No common-client proof. |
| <a id="table"></a>Table layout | **exact** — Browser reference. | **unsupported** — No Taffy/Yoga table algorithm; use flex/grid. | **unsupported** — No Taffy/Yoga table algorithm; use flex/grid. | **caveat** — Author HTML tables; CSS table roles alone do not prove compatibility. |
| <a id="flex-direction"></a>Flex direction/wrapping | **exact** — Browser reference. | **exact** — Taffy with web defaults. | **exact** — Taffy with web defaults. | **unsupported** — Gmail/classic Outlook lack required subproperties. |
| <a id="flex-size"></a>Flex grow/shrink/basis | **exact** — Browser reference. | **exact** — Taffy length/percentage/auto and cited intrinsic basis values. | **exact** — Taffy length/percentage/auto and cited intrinsic basis values. | **unsupported** — Subproperties not separately tested. |
| <a id="experimental-flex"></a>Balanced flex wrapping/line count | **unsupported** — Browser availability unverified; experimental. | **unsupported** — Taffy capability alone is not shared support. | **unsupported** — Taffy capability alone is not shared support. | **unsupported** — No client proof. |
| <a id="alignment"></a>Flex/grid alignment and first baseline | **exact** — Browser reference. | **caveat** — Supported Taffy alignment; baseline uses native metrics; last baseline errors. | **caveat** — Supported Taffy alignment; baseline uses native metrics; last baseline errors. | **unsupported** — Gmail/classic Outlook alignment limits. |
| <a id="gap"></a>Row/column gap | **exact** — Browser reference. | **exact** — Flex/grid; percentage basis must be supported. | **exact** — Flex/grid; percentage basis must be supported. | **unsupported** — Gmail partial; classic Outlook lacks gap. Use cell padding. |
| <a id="order"></a>Order | **exact** — Browser reference. | **unsupported** — No engine algorithm; author intended semantic order. | **unsupported** — No engine algorithm; author intended semantic order. | **unsupported** — No common-client proof. |
| <a id="grid-tracks"></a>Grid tracks, repeat, named lines/areas | **exact** — Browser reference. | **exact** — Taffy supports fr, minmax, auto-fill/fit and names. | **exact** — Taffy supports fr, minmax, auto-fill/fit and names. | **unsupported** — Gmail/classic Outlook lack track syntax. |
| <a id="grid-placement"></a>Grid placement and dense flow | **exact** — Browser reference. | **exact** — Taffy line/span placement and row/column/dense flow. | **exact** — Taffy line/span placement and row/column/dense flow. | **unsupported** — No common-client proof. |
| <a id="subgrid"></a>Subgrid | **caveat** — Browser support exists; exact version claims unverified. | **unsupported** — Not implemented in cited engines. | **unsupported** — Not implemented in cited engines. | **unsupported** — No client proof. |
| <a id="masonry"></a>Masonry / grid-lanes | **unsupported** — Experimental browser status unverified. | **unsupported** — Not implemented in cited engines. | **unsupported** — Not implemented in cited engines. | **unsupported** — No client proof. |
| <a id="spacing"></a>Margins/padding, including auto margins | **exact** — Browser reference. | **exact** — Taffy; pin version for percentage fixes. | **exact** — Taffy; pin version for percentage fixes. | **caveat** — Prefer cell padding; Outlook rejects auto margins and has spacing limits. |
| <a id="float"></a>Float and clear | **exact** — Browser reference. | **unsupported** — Box floats exist, but text wrap does not; use flex/grid. | **unsupported** — Box floats exist, but text wrap does not; use flex/grid. | **unsupported** — Classic Outlook lacks float; use tables. |
| <a id="normal-position"></a>Static/relative positioning | **exact** — Browser reference. | **caveat** — Static requires unreleased Taffy work or proven equivalent; relative released. | **caveat** — Static requires unreleased Taffy work or proven equivalent; relative released. | **unsupported** — Position declarations lack common support; use normal flow. |
| <a id="absolute"></a>Absolute positioning/insets | **exact** — Browser reference. | **caveat** — Containing-block hoisting needs unreleased Taffy work; reject unproven cases. | **caveat** — Containing-block hoisting needs unreleased Taffy work; reject unproven cases. | **unsupported** — Gmail/classic Outlook cannot use positioned layout. |
| <a id="fixed"></a>Fixed positioning | **exact** — Browser reference. | **unsupported** — First release rejects it; later headless overlay backend needs proof. | **unsupported** — First release rejects it; later headless overlay backend needs proof. | **unsupported** — Keep email content in flow. |
| <a id="sticky"></a>Sticky positioning | **exact** — Browser reference. | **unsupported** — Main lays out as static; scroll adapter and conformance still needed. | **unsupported** — Main lays out as static; scroll adapter and conformance still needed. | **unsupported** — Most clients lack it. |
| <a id="z-index"></a>Z-index | **exact** — Browser reference. | **caveat** — Sibling paint order only; reject cross-subtree stacking assumptions. | **caveat** — Sibling paint order only; reject cross-subtree stacking assumptions. | **unsupported** — Gmail/classic Outlook lack it. |
| <a id="clip"></a>Hidden/clip overflow | **exact** — Browser reference. | **exact** — Clip adapter; rounded clipping needs separate paint proof. | **exact** — Clip adapter; rounded clipping needs separate paint proof. | **unsupported** — Partial support cannot reliably hide content. |
| <a id="scroll"></a>Auto/scroll overflow | **exact** — Browser reference. | **caveat** — Native scroll view/physics; auto maps to engine scroll. | **caveat** — Native scroll view/physics; auto maps to engine scroll. | **unsupported** — Some clients cannot reach hidden content; let email grow. |
| <a id="scroll-controls"></a>Snap, smooth scrolling, overscroll | **exact** — Browser reference. | **unsupported** — Native analogues change behavior; define and test before support. | **unsupported** — Native analogues change behavior; define and test before support. | **unsupported** — Use normal email flow. |
| <a id="size"></a>Width/height and min/max lengths | **exact** — Browser reference. | **exact** — Taffy sizing relative to native text measurements. | **exact** — Taffy sizing relative to native text measurements. | **caveat** — Width/height have Outlook caveats; min/max not uniform. Use table sizing. |
| <a id="intrinsic"></a>Width/height intrinsic keywords | **exact** — Browser reference. | **exact** — Taffy 0.14; native text metrics determine intrinsic sizes. | **exact** — Taffy 0.14; native text metrics determine intrinsic sizes. | **unsupported** — Classic Outlook lacks intrinsic sizing. |
| <a id="intrinsic-limits"></a>Min/max intrinsic keywords | **exact** — Browser reference. | **unsupported** — Not implemented in cited Taffy/Yoga; choose lengths. | **unsupported** — Not implemented in cited Taffy/Yoga; choose lengths. | **unsupported** — No client proof. |
| <a id="auto-min"></a>Flex automatic minimum | **exact** — Browser reference. | **exact** — Taffy automatic minimum; Yoga main requires errata configuration. | **exact** — Taffy automatic minimum; Yoga main requires errata configuration. | **unsupported** — No client proof. |
| <a id="ratio"></a>Aspect ratio | **exact** — Browser reference. | **exact** — Taffy ratio algorithm. | **exact** — Taffy ratio algorithm. | **unsupported** — Gmail/classic Outlook lack it; give dimensions. |
| <a id="box-sizing"></a>Box sizing | **exact** — Browser reference. | **exact** — Emit content-box unless authored otherwise; Taffy defaults border-box. | **exact** — Emit content-box unless authored otherwise; Taffy defaults border-box. | **unsupported** — Classic Outlook lacks it; calculate table dimensions. |
| <a id="logical"></a>Logical spacing/insets | **exact** — Browser reference. | **caveat** — Resolve current direction; update physical edges on direction change. | **caveat** — Resolve current direction; update physical edges on direction change. | **caveat** — Raw logical spacing unsupported; proposed build lowering to physical edges. |
| <a id="direction"></a>Direction | **exact** — Browser reference. | **exact** — Taffy ltr/rtl layout; bidi values require separate tests. | **exact** — Taffy ltr/rtl layout; bidi values require separate tests. | **caveat** — Broad support; verify mixed-direction content. |
| <a id="vertical-layout"></a>Vertical writing and columns | **exact** — Browser reference. | **unsupported** — No native layout contract; use horizontal flow. | **unsupported** — No native layout contract; use horizontal flow. | **unsupported** — Classic Outlook lacks these layouts. |
| <a id="contain-paint"></a>Paint containment | **exact** — Browser reference. | **caveat** — Behavioral clipping, never a no-op. | **caveat** — Behavioral clipping, never a no-op. | **unsupported** — No client proof. |
| <a id="contain-other"></a>Other containment/content visibility | **exact** — Browser reference. | **unsupported** — First-release errors; omission changes behavior. | **unsupported** — First-release errors; omission changes behavior. | **unsupported** — No client proof. |
| <a id="will-change"></a>Will-change hint | **exact** — Browser reference. | **no-effect** — Candidate omission only; needs layout/paint/hit-test/accessibility proof. | **no-effect** — Candidate omission only; needs layout/paint/hit-test/accessibility proof. | **unsupported** — No client proof. |
| <a id="anchors"></a>Anchor positioning | **caveat** — Depends on browser floor. | **unsupported** — Placement records/headless overlay backend are later work. | **unsupported** — Placement records/headless overlay backend are later work. | **unsupported** — Use normal flow. |

## Paint, borders and effects

Source: [property/platform evidence](T029-support-evidence.md#42-box-and-paint); release restrictions follow the linked styling design.

| Feature | Web | iOS | Android | Email |
|---|---|---|---|---|
| <a id="colors"></a>Solid colors | **exact** — Browser reference. | **exact** — Build conversion of named/hex/rgb/hsl. | **exact** — Build conversion of named/hex/rgb/hsl. | **caveat** — Prefer hex; rgb syntax partial in Gmail/Outlook. |
| <a id="wide-colors"></a>Wide-gamut colors | **exact** — Browser reference. | **caveat** — Native conversion; screen gamut differs. | **caveat** — Wide-gamut Color API 26+; screen gamut differs. | **unsupported** — Fold to tested sRGB literal. |
| <a id="mix"></a>Color mixing/relative color | **exact** — Browser reference. | **caveat** — Constants fold; evaluator supports srgb/oklab/oklch, default hue only; re-resolve layer paint. | **caveat** — Constants fold; evaluator supports srgb/oklab/oklch, default hue only; re-resolve layer paint. | **caveat** — Only constants folded to literals; dynamic expressions error. |
| <a id="appearance"></a>Light-dark/color scheme | **exact** — Browser reference. | **caveat** — Native appearance; CGColor paint must re-resolve on traits. | **caveat** — Native appearance; CGColor paint must re-resolve on traits. | **unsupported** — No common dynamic appearance contract; use explicit colors. |
| <a id="opacity"></a>Opacity | **exact** — Browser reference. | **caveat** — Group behavior needs tests; iOS group-opacity default unverified. | **caveat** — Overlapping children may need an offscreen layer. | **unsupported** — Classic Outlook lacks opacity; precompute colors/images. |
| <a id="visibility"></a>Hidden visibility | **exact** — Browser reference. | **exact** — Hidden view retains layout space. | **exact** — Hidden view retains layout space. | **unsupported** — Gmail/classic Outlook lack it. |
| <a id="border"></a>Solid borders and per-side paint | **exact** — Browser reference. | **caveat** — Uniform border direct; per-side joins require custom drawing. | **caveat** — Uniform border direct; per-side joins require custom drawing. | **caveat** — Classic Outlook partial; prefer simple uniform border. |
| <a id="pattern-border"></a>Dashed/dotted/double borders | **exact** — Browser reference. | **approx** — Dash/corner geometry differs; CSS dash wording unverified. Use solid borders. | **approx** — Dash/corner geometry differs; CSS dash wording unverified. Use solid borders. | **unsupported** — Pattern support not tested separately; use solid borders. |
| <a id="other-border"></a>3D borders/border images | **exact** — Browser reference. | **unsupported** — Use solid borders. | **unsupported** — Use solid borders. | **unsupported** — Border image fails in Gmail/classic Outlook. |
| <a id="radius"></a>Uniform/per-corner/elliptical radii | **exact** — Browser reference. | **caveat** — Uniform direct; path masks and CSS clamping need adapter work. | **caveat** — Per-corner mapping; elliptical x/y interpretation unverified; clamp radii. | **unsupported** — Classic Outlook lacks radius; VML needs separate proof. |
| <a id="corners"></a>Corner shape | **caveat** — Chrome availability unverified. | **approx** — Continuous native corners differ; use normal border-radius. | **unsupported** — No native mapping in evidence. | **unsupported** — No client proof. |
| <a id="rounded-clip"></a>Rounded overflow with shadow | **exact** — Browser reference. | **caveat** — Wrapper needed for exterior shadow; clipping otherwise clips it. | **caveat** — Outline clipping API 21; shape limits need tests. | **unsupported** — No client proof. |
| <a id="outline"></a>Outlines/focus rings | **exact** — Browser reference. | **approx** — Extra paint; system-ring policy open. Preserve accessible focus cue. | **approx** — Extra paint; system-ring policy open. Preserve accessible focus cue. | **unsupported** — Classic Outlook lacks outline. |
| <a id="shadow"></a>Single outset shadow/spread | **exact** — Browser reference. | **caveat** — Blur times 0.5; spread via path; compare with browser. | **caveat** — Elevation insufficient; custom blur/offset/color drawing. | **unsupported** — Gmail web/classic Outlook lack shadow. |
| <a id="other-shadows"></a>Inset/multiple shadows | **exact** — Browser reference. | **approx** — Extra masked layers; use one tested outset shadow or border. | **approx** — Custom drawing; RN OS precedents are not Markless guarantees. | **unsupported** — No common shadow support. |
| <a id="gradients"></a>Linear/radial gradients | **exact** — Browser reference. | **caveat** — Compute geometry; sampled stops proposed; interpolation details unverified. | **caveat** — Shader geometry; radial ellipse scaling unverified. | **unsupported** — Classic Outlook lacks gradients; use solid fill/image. |
| <a id="other-gradients"></a>Conic/repeating gradients | **exact** — Browser reference. | **approx** — Expanded stops/conic layer need tolerance tests; use solid fill/image. | **approx** — Sweep/repeat shaders need geometry conversion. | **unsupported** — No common gradient support. |
| <a id="gradient-hints"></a>Gradient hints/color spaces | **exact** — Browser reference. | **caveat** — Build sampling proposed; interpolation assumptions unverified. | **caveat** — Build sampling proposed; interpolation assumptions unverified. | **unsupported** — Use prepared image. |
| <a id="background"></a>Background images, sizing, repeats and layers | **exact** — Browser reference. | **caveat** — Adapter rectangles/layers; asynchronous loading. | **caveat** — Adapter rectangles/layers; asynchronous loading. | **unsupported** — Classic Outlook/multiple-value limits; prefer content images. |
| <a id="text-fill"></a>Background clipped to text | **exact** — Browser reference. | **approx** — Text mask/shader differs; use solid text color. | **approx** — Text mask/shader differs; use solid text color. | **unsupported** — Classic Outlook lacks it. |
| <a id="simple-filter"></a>Opacity/drop-shadow filters | **exact** — Browser reference. | **caveat** — Alpha or alpha-shaped layer shadow. | **caveat** — Alpha or alpha-shaped layer shadow. | **unsupported** — Gmail/classic Outlook lack filters. |
| <a id="filter"></a>Blur and other color filters | **exact** — Browser reference. | **unsupported** — No public general CALayer filters; RN brightness is not general support. | **caveat** — RenderEffect API 31; adapter/effect tests required. | **unsupported** — Gmail/classic Outlook lack filters. |
| <a id="backdrop"></a>Backdrop blur | **exact** — Browser reference. | **approx** — System materials add tint/vibrancy; use opaque fill or accept material. | **approx** — Evidence cites backdrop API 37.2; earlier OS needs another approach. | **unsupported** — Gmail/classic Outlook lack it. |
| <a id="backdrop-other"></a>Other backdrop effects | **exact** — Browser reference. | **unsupported** — No public CALayer backgroundFilters. | **caveat** — Evidence cites effect chains only at 37.2+. | **unsupported** — No client proof. |
| <a id="blends"></a>Blend modes | **exact** — Browser reference. | **unsupported** — No public iOS layer compositingFilter. | **caveat** — BlendMode API 29; composition tests required. | **unsupported** — Classic Outlook lacks blends. |
| <a id="isolation"></a>Isolation | **exact** — Browser reference. | **unsupported** — No supported iOS blend contract; do not assume omission. | **unsupported** — Native isolation semantics not evidenced. | **unsupported** — No client proof. |
| <a id="masks"></a>Clip paths/masks | **exact** — Browser reference. | **unsupported** — Native shape/image masks possible, but accepted support is later. | **unsupported** — Native shape/image masks possible, but accepted support is later. | **unsupported** — Gmail/classic Outlook lack masks. |
| <a id="tint"></a>Appearance/accent/caret colors | **exact** — Browser reference. | **approx** — Native tint is subset; keep headless parts authored. Use supported paint. | **approx** — Native tint is subset; keep headless parts authored. Use supported paint. | **unsupported** — No shared email control contract. |
| <a id="cursor"></a>Cursor on touch-only devices | **exact** — Browser reference. | **no-effect** — Candidate omission only on touch-only iPhone; iPad pointer separate. | **no-effect** — Candidate omission only without mouse; pointer profile separate. | **unsupported** — No client proof. |

## Text and interaction

Source: [property/platform evidence](T029-support-evidence.md#43-text); release restrictions follow the linked styling design.

| Feature | Web | iOS | Android | Email |
|---|---|---|---|---|
| <a id="font-face"></a>Custom fonts/font-face | **exact** — Browser reference. | **caveat** — Bundle/register fonts; loading/fallback differ. | **caveat** — Bundle/register fonts; loading/fallback differ. | **unsupported** — Gmail lacks downloaded fonts; use fallback families. |
| <a id="system-font"></a>System fonts/fallback | **exact** — Browser reference. | **caveat** — SF Pro/native fallback; Core Text cascade detail unverified. | **caveat** — Roboto or OEM fallback; OEM choice unverified. | **caveat** — Installed fallback families; client metrics differ. |
| <a id="font-size"></a>Font size | **exact** — Browser reference. | **caveat** — Point/relative units; Dynamic Type choice open. | **caveat** — dp versus sp/scaling policy open. | **caveat** — Outlook/Yahoo partial; verify values. |
| <a id="font-style"></a>Weight/italic | **exact** — Browser reference. | **caveat** — Use real faces; synthetic styles differ. | **caveat** — Weight API-level claim unverified; synthetic styles differ. | **caveat** — Basic styling has Outlook/Yahoo caveats. |
| <a id="font-features"></a>Font features/variants | **exact** — Browser reference. | **caveat** — Core Text features; each value needs tests. | **caveat** — Feature settings; each value needs tests. | **unsupported** — Advanced support unverified. |
| <a id="line-height"></a>Number/length line height | **exact** — Browser reference. | **caveat** — Half-leading compensation needed; exact offset formula unverified. | **caveat** — API 28 line height; padding/fallback spacing change geometry. | **caveat** — Classic Outlook partial. |
| <a id="normal-leading"></a>Normal line height | **exact** — Browser reference. | **caveat** — Native metrics determine size. | **caveat** — Native metrics/padding determine size. | **caveat** — Client fonts determine size. |
| <a id="letter-spacing"></a>Letter spacing | **exact** — Browser reference. | **exact** — Point kern after conversion; glyph metrics differ. | **exact** — Convert to em; recompute with font size. | **caveat** — Broad support with partial-client caveats. |
| <a id="word-spacing"></a>Word spacing | **exact** — Browser reference. | **unsupported** — No direct native attribute; no layout approximation. | **unsupported** — No direct native attribute; no layout approximation. | **unsupported** — No client proof. |
| <a id="text-align"></a>Text alignment/justification | **exact** — Browser reference. | **caveat** — Basic mapping; justification algorithms differ. | **caveat** — Justification API 26; algorithm differs. | **caveat** — Outlook/Yahoo partial; prefer simple alignment. |
| <a id="decoration"></a>Underline/strike-through | **exact** — Browser reference. | **exact** — Native attributed run/span decoration. | **exact** — Native attributed run/span decoration. | **caveat** — Source conflicts on classic Outlook; verify rather than promise. |
| <a id="decoration-detail"></a>Decoration color/style/thickness/offset | **exact** — Browser reference. | **approx** — Offset-control limits unverified; use simple decoration. | **approx** — Custom spans required; use simple decoration. | **unsupported** — Gmail thickness unsupported; shared detail contract absent. |
| <a id="case"></a>Text transform | **exact** — Browser reference. | **caveat** — Runtime locale-aware conversion; capitalize rules differ. | **caveat** — Runtime locale-aware conversion; capitalize rules differ. | **caveat** — Broad support; locale behavior needs tests. |
| <a id="ellipsis"></a>Ellipsis/nowrap | **exact** — Browser reference. | **caveat** — Single-line truncation; metrics differ. | **caveat** — Single-line truncation; metrics differ. | **unsupported** — Classic Outlook lacks ellipsis; author short content. |
| <a id="line-clamp"></a>Line clamping | **caveat** — Prefixed/unprefixed syntax depends on browser floor. | **caveat** — Native max lines; test truncation/accessibility. | **caveat** — Native max lines; test truncation/accessibility. | **unsupported** — No client proof. |
| <a id="whitespace"></a>Pre/pre-wrap/pre-line | **exact** — Browser reference. | **caveat** — Preserve whitespace with native wrapping. | **caveat** — Preserve whitespace with native wrapping. | **unsupported** — Classic Outlook lacks required behavior. |
| <a id="breaking"></a>Word breaking/hyphenation | **exact** — Browser reference. | **unsupported** — Algorithms differ; char-wrapping details unverified. Define behavior first. | **unsupported** — API 33 word styles/API 23 hyphenation are not proof of equal breaks. | **unsupported** — Client/language differences need fallback. |
| <a id="balance"></a>Balanced/pretty wrapping | **exact** — Browser reference. | **unsupported** — UIKit has no balanced strategy; omission is not no-effect. | **unsupported** — API 23 balanced strategy differs; no shared promise. | **unsupported** — Gmail/classic Outlook lack it. |
| <a id="text-shadow"></a>Text shadow | **exact** — Browser reference. | **approx** — One shadow per run, blur times 0.5; use one tested shadow. | **approx** — One shadow, blur times 0.866; use one tested shadow. | **unsupported** — Gmail/classic Outlook lack it. |
| <a id="bidi"></a>Unicode bidi | **exact** — Browser reference. | **caveat** — Native direction mapping; embedding/override values need separate proof. | **caveat** — Native direction mapping; embedding/override values need separate proof. | **caveat** — Broad bidi support; verify mixed scripts. |
| <a id="vertical-align"></a>Super/sub and inline image alignment | **exact** — Browser reference. | **caveat** — Font/baseline offsets; attachments need their own proof. | **caveat** — Font/baseline offsets; attachments need their own proof. | **caveat** — Broad support; client baseline differences remain. |
| <a id="selection"></a>Text selection | **exact** — Browser reference. | **caveat** — Text view choice affects selection/links; cannot drop silently. | **caveat** — setTextIsSelectable; preserve focus/accessibility. | **unsupported** — No shared selection-control contract. |
| <a id="inline-paint"></a>Box paint on inline runs | **exact** — Browser reference. | **unsupported** — Padding/border/radius on text runs are first-release errors. | **unsupported** — Padding/border/radius on text runs are first-release errors. | **caveat** — HTML inline paint needs client tests. |
| <a id="pointer-events"></a>Pointer-events auto/none | **exact** — Browser reference. | **caveat** — Skip self but retain tappable auto child; focus/accessibility unchanged. | **caveat** — Skip self but retain tappable auto child; focus/accessibility unchanged. | **unsupported** — No email interaction proof. |

## Transforms and motion

Source: [property/platform evidence](T029-support-evidence.md#44-transforms-transitions-animations); release restrictions follow the linked styling design.

| Feature | Web | iOS | Android | Email |
|---|---|---|---|---|
| <a id="transform"></a>2D translate/scale/rotate | **exact** — Browser reference. | **exact** — Native affine mapping. | **exact** — Native affine mapping. | **unsupported** — Gmail/classic Outlook lack transforms. |
| <a id="matrix"></a>Skew/general affine matrix | **exact** — Browser reference. | **exact** — Native affine mapping. | **unsupported** — View alternatives unverified; no direct property. | **unsupported** — No common-client proof. |
| <a id="transform-origin"></a>Transform origin | **exact** — Browser reference. | **exact** — Anchor-point compensation / Android pivot required. | **exact** — Anchor-point compensation / Android pivot required. | **unsupported** — No client proof. |
| <a id="three-d"></a>3D transforms/preserve-3d | **exact** — Browser reference. | **unsupported** — Later contract; CATransformLayer preserve-3d claim unverified. | **unsupported** — Partial transforms; no general matrix3d/preserve-3d. | **unsupported** — No client proof. |
| <a id="transition"></a>Explicit paint/compositor transitions | **exact** — Browser reference. | **caveat** — Computed-value diffs, interruption/cancellation need oracle tests. | **caveat** — Computed-value diffs, interruption/cancellation need oracle tests. | **unsupported** — Gmail/classic Outlook lack transitions. |
| <a id="layout-transition"></a>All/layout transitions | **exact** — Browser reference. | **unsupported** — First-release errors; list opacity/transform instead. | **unsupported** — First-release errors; list opacity/transform instead. | **unsupported** — No common-client proof. |
| <a id="timing"></a>Easing/steps/linear timing | **exact** — Browser reference. | **caveat** — Bezier curves map; sampled steps/linear need timing tests. | **caveat** — Bezier curves map; sampled steps/linear need timing tests. | **unsupported** — No client proof. |
| <a id="keyframes"></a>Keyframes/animation properties | **exact** — Browser reference. | **unsupported** — Later extension in accepted design, despite native APIs. | **unsupported** — Later extension in accepted design, despite native APIs. | **unsupported** — Gmail/classic Outlook lack animation. |
| <a id="new-motion"></a>Discrete, view, scroll-driven motion | **caveat** — Availability depends on browser floor. | **unsupported** — Undesigned/later; native analogues are not CSS support. | **unsupported** — Undesigned/later; native analogues are not CSS support. | **unsupported** — No common-client proof. |

## Units, values and conditions

Source: [property/platform evidence](T029-support-evidence.md#45-units-functions-variables-queries); release restrictions follow the linked styling design.

| Feature | Web | iOS | Android | Email |
|---|---|---|---|---|
| <a id="common-units"></a>px, percentages, em, absolute lengths | **exact** — Browser reference. | **caveat** — px maps to pt/dp; em follows font basis; absolute units fold at CSS ratio. | **caveat** — px maps to pt/dp; em follows font basis; absolute units fold at CSS ratio. | **caveat** — Broad unit support; property/client limits still apply. |
| <a id="rem"></a>Root-relative units | **exact** — Browser reference. | **caveat** — Root size/accessibility scaling choice open. | **caveat** — Root size/accessibility scaling choice open. | **unsupported** — Classic Outlook lacks rem; build-resolve lengths. |
| <a id="viewport"></a>Viewport units | **exact** — Browser reference. | **caveat** — Root view size; native height variants coincide. | **caveat** — Root view size; native height variants coincide. | **unsupported** — Classic Outlook lacks viewport units. |
| <a id="metric-units"></a>Font-metric/container units | **exact** — Browser reference. | **unsupported** — Later; measurement/container passes not proven. | **unsupported** — Later; measurement/container passes not proven. | **unsupported** — No common-client proof. |
| <a id="time-angle"></a>Time/angle units | **exact** — Browser reference. | **exact** — Convert at build; consuming declaration must pass. | **exact** — Convert at build; consuming declaration must pass. | **unsupported** — No client proof. |
| <a id="math"></a>Constant calc/min/max/clamp | **exact** — Browser reference. | **exact** — Fold typed constants. | **exact** — Fold typed constants. | **caveat** — Emit supported literal, never unresolved client math. |
| <a id="mixed-calc"></a>Percentage-plus-length calc | **exact** — Browser reference. | **caveat** — Taffy percentage-basis callback; indefinite cases error. | **caveat** — Taffy percentage-basis callback; indefinite cases error. | **unsupported** — Unknown client layout cannot be build-folded. |
| <a id="constant-vars"></a>Constant variables/var | **exact** — Browser reference. | **caveat** — Compute at declaring element; cycles/invalid values follow CSS. | **caveat** — Compute at declaring element; cycles/invalid values follow CSS. | **caveat** — Fully resolve/inline; emit no variables/var. |
| <a id="dynamic-vars"></a>Conditional/inline variables | **exact** — Browser reference. | **caveat** — Logical-tree inheritance; unknown shorthand arity errors. | **caveat** — Logical-tree inheritance; unknown shorthand arity errors. | **unsupported** — No email state evaluator; emit static content. |
| <a id="registration"></a>Property registration | **exact** — Browser reference. | **unsupported** — Typed evaluator suggested, registration semantics unproven. | **unsupported** — Typed evaluator suggested, registration semantics unproven. | **unsupported** — No client proof. |
| <a id="wide-keywords"></a>Inherit/initial/unset | **exact** — Browser reference. | **caveat** — Computed pipeline; invalid computed value acts as unset. | **caveat** — Computed pipeline; invalid computed value acts as unset. | **unsupported** — Raw support unverified; lower to literals. |
| <a id="revert"></a>Revert/revert-layer | **exact** — Browser reference. | **unsupported** — First-release errors. | **unsupported** — First-release errors. | **unsupported** — No client proof. |
| <a id="media-size"></a>Size/orientation/resolution queries | **exact** — Browser reference. | **caveat** — Window/trait inputs; each mapping needs tests. | **caveat** — Window/trait inputs; each mapping needs tests. | **unsupported** — Classic Outlook lacks queries; fallback stands alone. |
| <a id="media-appearance"></a>Color scheme/reduced motion queries | **exact** — Browser reference. | **exact** — Subscribe to native settings; repaint dependencies. | **exact** — Subscribe to native settings; repaint dependencies. | **unsupported** — Gmail/classic Outlook lack these conditions. |
| <a id="media-pointer"></a>Hover/pointer queries | **exact** — Browser reference. | **caveat** — Actual pointer availability, not device-name guessing. | **caveat** — Actual pointer availability, not device-name guessing. | **unsupported** — Not common-client behavior. |
| <a id="media-contrast"></a>Contrast/forced-colors queries | **exact** — Browser reference. | **unsupported** — High contrast is not forced-colors; per-value behavior unresolved. | **unsupported** — High contrast is not forced-colors; per-value behavior unresolved. | **unsupported** — No client proof. |
| <a id="media-os"></a>Proposed OS condition | **caveat** — Proposed Markless extension, not browser CSS. | **caveat** — Build-folded target; proposed compiler extension. | **caveat** — Build-folded target; proposed compiler extension. | **unsupported** — Recipient OS unknown; select email at build. |
| <a id="container"></a>Size/style container queries | **exact** — Browser reference. | **unsupported** — Extra layout pass/style-query semantics deferred. | **unsupported** — Extra layout pass/style-query semantics deferred. | **unsupported** — No client proof. |
| <a id="supports"></a>Supports queries | **exact** — Browser reference. | **caveat** — Fold from proven profile before checking retained branches. | **caveat** — Fold from proven profile before checking retained branches. | **caveat** — Fold from email profile; emit no unresolved query. |
| <a id="layers"></a>Layers/nesting | **exact** — Browser reference. | **caveat** — Flatten supported selectors; statically order normal rules. | **caveat** — Flatten supported selectors; statically order normal rules. | **caveat** — Flatten/order/inline only statically matched rules. |
| <a id="environment"></a>Safe-area/keyboard values | **caveat** — Keyboard inset support depends on browser. | **caveat** — Only named safe-area/keyboard insets; subscribe to geometry. | **caveat** — Only named safe-area/keyboard insets; subscribe to geometry. | **unsupported** — No common recipient environment; static spacing. |
| <a id="important"></a>Important declarations | **exact** — Browser reference. | **unsupported** — Reversed layer priority is later; first-release error. | **unsupported** — Reversed layer priority is later; first-release error. | **caveat** — Partial client support; prefer inline specificity and test. |

## Selectors and ownership

Source: [property/platform evidence](T029-support-evidence.md#5-selectors-brief-the-rule-is-in-t025); release restrictions follow the linked styling design.

| Feature | Web | iOS | Android | Email |
|---|---|---|---|---|
| <a id="own-selectors"></a>Own type/class/id/attribute | **exact** — Browser reference. | **exact** — Own element, including forwarded class and own ui-* state. | **exact** — Own element, including forwarded class and own ui-* state. | **caveat** — Basic selectors broad; attributes partial; inline static matches. |
| <a id="ancestors"></a>Same-component child/descendant | **exact** — Browser reference. | **caveat** — Prove component ownership; logical ancestor flags. | **caveat** — Prove component ownership; logical ancestor flags. | **caveat** — Statically resolve/inline; client child-selector limits remain. |
| <a id="root"></a>Document-root declarations/app-root conditions | **exact** — Browser reference. | **caveat** — Declarations only in document component; root conditions allowed elsewhere. | **caveat** — Declarations only in document component; root conditions allowed elsewhere. | **caveat** — Resolve static root tokens/matches at build. |
| <a id="cross-component"></a>Cross-component ancestry/misplaced root | **caveat** — Browser selectors remain; scoped misplaced root does not become global. | **unsupported** — Forward own-element class; put shared tokens on document root. | **unsupported** — Forward own-element class; put shared tokens on document root. | **unsupported** — No static lowering proof for these contexts. |
| <a id="states"></a>Active/focus/hover/disabled/checked/dir | **exact** — Browser reference. | **caveat** — Own state; hover needs pointer, focus-visible keyboard/D-pad. | **caveat** — Own state; hover needs pointer, focus-visible keyboard/D-pad. | **unsupported** — Dynamic states lack common-client support. |
| <a id="compound"></a>Not/is/where | **exact** — Browser reference. | **caveat** — Expand entirely to supported conditions. | **caveat** — Expand entirely to supported conditions. | **unsupported** — Gmail excludes not; shared proof absent. |
| <a id="structural"></a>Sibling/has/structural | **exact** — Browser reference. | **unsupported** — First-release errors, even local siblings; use own-state attributes. | **unsupported** — First-release errors, even local siblings; use own-state attributes. | **unsupported** — Client limits; use explicit static classes. |
| <a id="pseudo-elements"></a>Generated content/first letter/first line | **exact** — Browser reference. | **unsupported** — No first-release native contract; author explicit elements. | **unsupported** — No first-release native contract; author explicit elements. | **unsupported** — Gmail/classic Outlook lack them. |
| <a id="unknown"></a>Unknown selectors/at-rules | **unsupported** — No verified browser-floor claim for unknown syntax. | **unsupported** — Missing profile entry fails build. | **unsupported** — Missing profile entry fails build. | **unsupported** — Missing client/lowering proof fails checking. |

## What Taffy versus Yoga changes

Taffy is preferred because it implements flex, grid and block flow with margin collapsing. Yoga has flex; grid style types are not a grid algorithm. Choosing Yoga removes grid, requires explicit acceptance of block-as-flex-column behavior, and rejects runtime percentage-plus-length calculations. This changes the authoring contract. [Engine evidence](T029-support-evidence.md#3-layout-engines-what-each-one-implements)

| Consequence | Taffy | Yoga |
|---|---|---|
| Defaults | Emit CSS block/content-box when required; engine defaults are flex/border-box. | UseWebDefaults changes direction, align-content and shrink, not position; set position and sizing explicitly. |
| Layout breadth | Flex/grid/block; cited version lacks subgrid, masonry, order, tables, last baseline and intrinsic min/max keywords. | Flex; no proven grid algorithm or real block/margin collapse. |
| Positioning | Released 0.14 differs from main; static, containing-block hoisting and sticky/fixed records need a pinned, proven version. | Static/relative/absolute; automatic minimum-size correction is main-only with configured errata. |
| Calculations | Mixed percentages use the host callback with a valid basis. | Constants fold; dynamic mixed percentage/length values cannot simply pass through. |
| Remaining work | Text measurement, paint, scrolling, accessibility and overlays. | Same responsibilities; engine choice does not solve them. |

The proposed gate is at most **1 MB added download over Yoga** and **1.25× Yoga layout time**, measured on the oldest supported iPhone using a 1,000-node screen including 200 measured text nodes. Neither budget has been measured here. A prebuilt xcframework would avoid requiring Rust tooling from app authors. Pin a tested revision or wait for a release; do not advertise main-only features as shipped. [Design and budgets](T018-styling-design.md#34-evaluator-layout-and-colors)

The compiler proves ownership, expands values and emits per-component style tables. Swift/Kotlin evaluators update computed values on the authored parent tree; platform adapters own layout and paint. Core graph state stays host-independent. Keep profile facts and protocol constants with their owners, not copied into adapters. Build the styling package inside Markless until a stable format, web/iOS conformance and a second consumer justify separation. [Architecture](T018-styling-design.md#3-architecture), [package direction](T025-styling-direction.md#5-new-project-or-not)

## Agent guardrails

One versioned profile per target owns property/value, unit, function, selector, context and at-rule support. Compiler checking, editor diagnostics, generated tables, agent guidance and support queries must consume that same data. Native/email default to unsupported. Remove provably false target branches, expand proven shorthand alternatives, then check retained declarations. Unknown ownership, unknown values or dynamic shorthand arity produce a file/line error, reason and concrete fix. [Proposed checker](T030-agent-guardrails.md#34-one-profile-drives-five-things)

The JSON wraps the research profile shape in a draft bundle. Each target retains target, profileVersion, default, properties, units, functions, selectors and atRules. Extensions record maturity, proposed status, provenance and report-row coverage. Site docs URLs are proposed publishing destinations; reportRef links to this local report. Wildcards, typed/context patterns and grouped any entries are research descriptors: they need explicit value/context refinement before activation, not an executable matcher. Property, value, unit, function argument, context, OS/client version and selector must each pass; a general row cannot override a rejected subcase.

Promotion requires real passing test IDs, target OS/client versions, measured tolerance and reviewed restrictions. Exact/caveat rows need browser-to-target comparisons. Approx rows need measured paint differences and diagnostic tests. No-effect needs omission equivalence. Unsupported rows need rejection fixtures before a production profile ships. Proposed entries never satisfy supports queries; release tooling must reject this draft rather than use proposedStatus as live support. **These two files implement none of those checks.** [Conformance design](T030-agent-guardrails.md#34-one-profile-drives-five-things)

The enforcing surfaces, strongest first:

1. **Build/typecheck and CI failure.** Located errors name target, value, reason and fix. Native errors cannot be silenced by an allow comment. The command must run; prose alone cannot force it.
2. **Editor diagnostics.** Reuse compiler errors while writing. The inspected TypeScript plugin currently exposes parse failures; the style/semantic diagnostic path needs implementation.
3. **A short rule in agent context.** State the selector restriction, point to the support lookup and require the check. Do not preload a large table.
4. **On-demand CLI, skill or MCP lookup.** Useful for planning; optional invocation cannot enforce support. The proposed markless support command does not exist yet.
5. **Generated documentation and llms.txt.** Explain differences; no evidence proves automatic consultation.
6. **Completion ranking.** Helps discovery, especially for people; cannot reject code.

This ranking comes from the [guardrail evidence](T030-agent-guardrails.md#5-which-surface-actually-stops-an-agent-ranked-with-evidence), including conflicting context-file studies. Their percentages do not predict Markless success. MCP invocation rates and the separate VS Code extension remain unverified. The proposed style phase/codes, target configuration, query CLI and drift checks remain implementation work; passing current typecheck does not prove those features exist.

For example, transition: all 120ms should suggest explicitly listed opacity/transform transitions. A :has() selector should suggest an own-element state attribute. A static email variable can become a literal; a runtime-dependent variable must fail. These are diagnostic examples, not executed fixtures. [Examples](T030-agent-guardrails.md#4-what-people-and-agents-see)

## Open questions

Confirm the engine, email clients, text scaling and early diagnostics; I recommend Taffy, an explicit client list, a deliberate accessibility policy and early target errors.

**Layout engine:** Prefer Taffy because grid and block preserve more CSS. Confirm budgets and choose a released or pinned version after device measurements.

**Email clients:** Confirm the recipient-client set because classic Outlook requires authored tables or separately proven layout lowering.

**Text size:** Decide how relative units follow accessibility text size because this changes layout, not just paint.

**Errors during web development:** Show configured native-target errors early while blocking only that target's build; decide whether app-wide typecheck fails for any configured target.

Researched defaults: restricted raw CSS and style tables; package inside Markless; overlays/keyframes/container queries deferred; no layout-changing approximations. Package name/home, browser floor, diagnostic phase/codes, schema versioning and generated docs URLs remain implementation decisions. [Open points](T030-agent-guardrails.md#6-open-points-for-t031-and-the-owner)

Evidence still needed: browser/UIKit/Android/email fixtures; released-versus-main Taffy positioning; native metrics/line-height/fallback; Android pixel rounding; gradient interpolation and sampling error; dashed-border wording; elliptical radii; Android matrix mapping; iOS group-opacity defaults and decoration offsets. Chromium precision, exact browser-version claims and Chrome-generated Taffy fixtures remain unverified in the source. Focus-ring replacement, pointer-device contexts, minimum OS versions and the omission list also need tests. [Evidence gaps](T029-support-evidence.md#8-open-questions-and-gaps)

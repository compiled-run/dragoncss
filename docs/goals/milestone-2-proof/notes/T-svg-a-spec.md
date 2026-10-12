# SVG-a: inline SVG drawn natively (coverage-rank lane 16, reach 395). Binding worker spec (PM ruling 2026-10-05)

Read AGENTS.md, docs/goals/milestone-2-proof/lane-contract.md, and the REPL-a notes (T051-repl-a.md, T048-repl0.md). Base: origin/master.
PM ruling: interior-sample pixel proof plus Chrome-proven outline geometry (the PNT2 transform precedent), and two sequential,
unstacked PRs, SVG-a1 then SVG-a2.

## Scope

**Supported, end of SVG-a2:**
- An `<svg>` element in an HTML tree, laid out as a block-level replaced box on REPL-a's replaced-box model:
  - `display: block`, or blockified as a flex item;
  - sized by the `width` and `height` attributes (presentational hints with author CSS winning, as for img) or by CSS;
  - with no size, the default object size 300x150.
- `viewBox` (four numbers, positive width and height) with the initial `preserveAspectRatio` (xMidYMid meet).
- Children `<path d>`, `<rect x y width height>` and `<circle cx cy r>`, as direct children of the `<svg>`.
- `fill`, `stroke` and `stroke-width` as CSS properties: a new `svg` property family, all inherited, with Chrome's initial
  values black, none and 1px. They are also presentation attributes on svg, path, rect and circle, which author rules beat.
  - fill and stroke take `<color>` (currentcolor included) or `none`.
  - stroke-width takes a non-negative px length, or a unitless number (CSS allows the SVG quirk), computed to px.
- Path data: the full SVG 1.1 / SVG 2 path grammar (M, L, H, V, C, S, Q, T, A, Z, absolute and relative, implicit
  repetition). Arcs are converted to cubics per SVG 2 Appendix B.2.4, as Blink does.
- Painting: fill, then stroke (the initial `paint-order`), non-zero fill rule, the initial butt cap, miter join and miter
  limit 4.
  - iOS: a CAShapeLayer per shape (fill layer, then stroke layer).
  - Android: a Dragon view drawing an android.graphics.Path with Paint FILL then STROKE.

**Measured facts** (Chrome 145, probe in /tmp/dragon-svg-a1/packages/parity/zz-probe.mts):
- `<svg>` with no size: 300x150.
- With only a viewBox: it fills the container width, with height from the ratio (refused in a1, below).
- `width="24" height="12" viewBox="0 0 24 24"`: getScreenCTM is [0.5 0 0 0.5 6 y] (meet, centred).
- getBBox is the tight bounds of the fill geometry (cubic and arc extrema, not control points).
- A shape's getBoundingClientRect is that bbox mapped through the CTM.
- `stroke-width` computes to "2px" from the attribute "2"; initial fill rgb(0, 0, 0), stroke none, stroke-width 1px.
- Inherited fill reaches the shapes from any ancestor.

## Refused (each has a reject fixture and a named package)

| Case | Code | Package |
|---|---|---|
| An inline-level `<svg>` (display inline, the default) | DRAGON_UNSUPPORTED_VALUE (REPL-a's inline-replaced message) | INL2 (inline replaced) |
| `<svg>` with a viewBox but without both width and height | DRAGON_UNSUPPORTED_VALUE | SVG-ratio |
| width or height attribute other than a number or px | DRAGON_UNSUPPORTED_VALUE | SVG-units |
| `stroke-dasharray`, `stroke-dashoffset` | DRAGON_UNSUPPORTED_PROPERTY (they are unknown properties today; the message names the package) | SVG-dash |
| `fill-opacity`, `stroke-opacity`, `opacity` on a shape | DRAGON_UNSUPPORTED_PROPERTY or VALUE | SVG-opacity |
| `<g>`, `<use>`, `<defs>`, `<symbol>`, `<text>`, `<line>`, `<polyline>`, `<polygon>`, `<ellipse>`, `<image>`, gradients, patterns, `<clipPath>`, `<mask>`, `<style>` | DRAGON_UNSUPPORTED_ELEMENT | SVG-b (structure), SVG-paint (servers) |
| `fill`/`stroke` `url()` and the context-* keywords | DRAGON_UNSUPPORTED_VALUE | SVG-paint |
| A `transform` attribute or CSS transform on an svg child, and `preserveAspectRatio` | DRAGON_UNSUPPORTED_ATTRIBUTE | SVG-transform |
| `stroke-linejoin`, `stroke-linecap`, `stroke-miterlimit` other than initial, and `fill-rule: evenodd` | DRAGON_UNSUPPORTED_PROPERTY | SVG-stroke |
| `rx`/`ry` on rect | DRAGON_UNSUPPORTED_ATTRIBUTE | SVG-b |
| A percentage stroke-width (relative to the normalized diagonal) | DRAGON_UNSUPPORTED_VALUE | SVG-units |
| Text or non-shape elements inside `<svg>`, and an `<svg>` nested in an `<svg>` | DRAGON_UNSUPPORTED_ELEMENT | SVG-b |
| SVG on native in SVG-a1 (until SVG-a2 lands) | DRAGON_UNSUPPORTED_ELEMENT [ios, android] | SVG-a2 |

## Proof

1. **Layout** (existing lanes): the `<svg>` box is compared with Chrome as every replaced box is: the host engine lane, and
   chrome-dual exact.
2. **Computed values** (chrome-dual): fill, stroke and stroke-width on every element, authored against compiled, exact.
3. **Outline geometry, strict.**
   - Dragon's SVG geometry module (TypeScript, translated with the engine in SVG-a2) computes, for every shape:
     - the user-space path, as Blink's Path holds it (arcs as cubics);
     - its tight bounds, as Skia's SkPath::computeTightBounds computes them in float32;
     - the CTM (the svg content box's position and the viewBox transform);
     - the shape's client rect.
   - The capture records getBBox, getScreenCTM and getBoundingClientRect of every shape.
   - They must be equal as doubles, with no allowance.
   - A planted fault for each of these must fail its fixtures: arcs as lines, control-point bounds, viewBox ignored, and
     meet as slice.
4. **Pixels (SVG-a2, device):** a paint-samples module `svg.ts`. It adds sample points at least 2 device px from every
   shape edge and every stroke edge (computed from the proven outline), plus points outside every shape inside the svg box.
   Each point's expected colour is the Chrome screenshot pixel. The unchanged pixel gate applies.
   - Planted faults: stroke under fill, fill rule even-odd, stroke width not scaled by the viewBox, and fill and stroke
     colours swapped. Each must fail device-pixels.
5. All fixtures run ltr and rtl, at DPR 1 (host), 2, 2.625 and 3.

**Support rows:**
- `element:svg`, `element:path`, `element:rect`, `element:circle`;
- `fill:<color>|none`, `stroke:<color>|none`, `stroke-width:<length>`;
- `attribute:viewBox`.
Each row names its passing fixtures. Web rows come with SVG-a1; ios and android rows come with SVG-a2's device run.

## Split

- **SVG-a1 (compiler and web), off master:**
  - the fixture reader's svg subtree (foreign elements, self-closing tags, case-kept attribute names);
  - the tags, attributes and refusals;
  - the svg property family;
  - svg as a replaced box (its children are fallback content to layout);
  - presentation attributes as hints;
  - the geometry module with its strict differential;
  - web CSS output;
  - fixtures `svg-basic` (path, rect and circle), `svg-viewbox` (meet offsets, in px and unitless), `svg-paint` (inheritance,
    currentcolor, attribute against CSS precedence, none) and `svg-flex` (svg as a flex item), each ltr and rtl;
  - the reject fixtures and the web rows.
  - Native targets refuse svg as SVG-a2.
- **SVG-a2 (native), off master after a1 merges:**
  - the geometry module as an engine root (translated, TS = Swift = Kotlin vectors);
  - the shape lowering and emitters for UIKit and Android;
  - paint-samples `svg.ts` and its plants;
  - the native rows after the driver's device run.

Each PR stays at or under about 150 KB reviewed.

## Ports and licences

Blink's svg/ and layout/svg/ files are LGPL (KDE): class A references, implemented from SVG 2 and pinned by the Chrome
differential. Skia's SkPath bounds and SkGeometry extrema code is BSD and may be ported. Every cited file is registered in docs/ports.json.

## Stop conditions

- The strict differential disagrees with Chrome and the cause can't be shown with evidence.
- getBoundingClientRect at a fractional DPR needs Chrome's zoom path, and that path can't be reproduced exactly.

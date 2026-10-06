# Shared layout vectors

Each `<case>.json` here is one passing parity case, written only by `pnpm run layout:vectors` from the committed Chrome captures of the reference platform. A vector is what a port of the layout engine (Swift, Kotlin) must reproduce exactly. `packages/layout/test/vectors.test.ts` runs every vector, and the example below, through `validateLayoutInput` and `layout`.

## File

```
{ "platform": string, "measurer": string, "input": LayoutInput, "output": LayoutRect[] }
```

- `platform`: the capture platform of the Chrome reference the case passed against (`process.platform-process.arch`, for example `darwin-arm64`).
- `measurer`: the text measurer key, `measurerFor(platform).key`. `ahem/darwin-arm64` is the Ahem measurer with the darwin-arm64 platform rules (`platform-rules.ts`). A platform with no registered rules has no measurer: `measurerFor` refuses it with `no-platform-rules`.
- The four keys are required and there are no others.

## Input (`LayoutInput`, `src/input.ts`)

Every field is required and there are no defaults: the compiler writes every value, and `validateLayoutInput` rejects a missing key, an extra key, an unknown tag or a non-finite number.

- `viewport` `{ width, height }` in CSS px, the initial containing block. `devicePixelRatio`: border widths snap to whole device px.
- The environment (V2 of the value model): `viewportUnits` `{ small, large, dynamic }`, each a `{ width, height }` in CSS px that viewport units of that kind read (plain `vw` reads `large`); `safeArea` `{ top, right, bottom, left }` in CSS px, the insets `env(safe-area-inset-*)` reads; `rootFontSize`, the root element's specified font size in CSS px, which `rem` reads. The compiler writes the reference environment: every size the viewport, no safe area, and the root's font size at text scale 1; a host writes the device's.
- `root`: a `LayoutBox` `{ kind: "box", id, boxType: "element" | "anonymous", style: LayoutStyle, strut, children }`. Children are all boxes (and replaced leaves) or all inline-level (text leaves, inline boxes and line breaks). The compiler wraps mixed content in anonymous boxes `<element>:anon<k>`; the engine never creates boxes. `strut` is the box's own `{ font, lineHeight }` when its children are inline-level (CSS2 §10.8.1), and null otherwise; every text leaf has the font and line-height of its parent, the strut or its inline box.
- An inline box is `{ kind: "inline", id, style, font, lineHeight, children }`: an element with `display: inline`, whose children are inline-level. A line break (`<br>`) is `{ kind: "br", id, font, lineHeight }`. The engine refuses both (`inline-box`) until the inline core lays them out.
- `style` has all 45 `LayoutStyle` fields. `verticalAlign` is `{ kind: "keyword", value }` for a CSS2 §10.8.1 keyword, a length, a percentage or a calculation; the compiler writes `baseline`. Lengths are tagged `{ kind: "px", value }` (CSS px), `{ kind: "percent", value }` (100 is the whole basis), or keywords such as `{ kind: "auto" }`, `{ kind: "none" }`, `{ kind: "normal" }` and `{ kind: "content" }`, as each field allows. Enumerations are strings; flexGrow, flexShrink and order are numbers. An order that is not a whole number (a math function, which the compiler sends unrounded) is rounded half toward +infinity and clamped to the int range by the engine, as Blink's ComputeInteger does. `grid` is the grid container's tracks, placement flow and justify-items (input.ts GridContainerStyle) on a `display: "grid"` box and `null` elsewhere; `gridItem` is the resolved placement and justify-self (GridItemStyle) on each in-flow child of a grid container and `null` elsewhere.
- `aspectRatio` is `{ kind: "auto" }`, or Blink's layout ratio `{ kind: "ratio" | "auto-ratio", width, height }` in raw LayoutUnit values (positive integers; `auto-ratio` is `auto && <ratio>`, which sizes the content box). A percentage height, min-height or max-height beside a ratio is refused.
- The four border widths also take `{ kind: "device-px", value }`: an initial line width (no width declared, or a border shorthand that omits it), which Chrome keeps in device px at every pixel ratio (rule R5 below).
- A text leaf is `{ kind: "text", id: "<element>:text<k>", text, font, lineHeight, whiteSpaceCollapse: "collapse", textWrapMode }`. The text is already collapsed, and the leaf carries every inherited text property itself. `font` is `{ family: "Ahem", size, specifiedSize, absoluteSize }`: `specifiedSize` is the specified font size as a calculation leaf or tree at zoom 1 (below), `absoluteSize` is false for a size derived through `em` or `%` from a keyword size (Chrome's 6px minimum logical font size applies to it), and `size` is the computed size the compiler found at the reference environment, which the environment pass recomputes. `lineHeight` is `normal`, a `number`, `px`, a `percent` of the font size, or a `calc`.
- Ids are unique. Parents come before children, and children are in document order. `order` and the reverse flex directions are applied by the engine, never by reordering the input.

## Output (`LayoutRect[]`)

- Each rect is `{ id, parent, x, y, width, height }`, in LU: integers of 1/64 px, Blink's LayoutUnit (33.3px is 2131 LU). `x` and `y` are relative to the parent's border box. `parent` is null for the root.
- Order: first the in-flow boxes in preorder. Each box comes before its children, and each text leaf is followed by its line fragments `<leaf>:line<j>` (one per line, parent the leaf). Then each absolutely positioned box, after its parent and containing block, followed by its own subtree in the same order.
- Absolute positions are the sums of the parent offsets in integers (`absoluteRects`). They are converted to px only for comparison.

## Example

A 33.3px box with a 1px top border, 2px top padding and a 5px left margin, holding "AB CD" in 10px Ahem, which wraps onto two lines.

Input:

```json vector-input
{
 "viewport": {
  "width": 400,
  "height": 300
 },
 "devicePixelRatio": 1,
 "viewportUnits": {
  "small": {
   "width": 400,
   "height": 300
  },
  "large": {
   "width": 400,
   "height": 300
  },
  "dynamic": {
   "width": 400,
   "height": 300
  }
 },
 "safeArea": {
  "top": 0,
  "right": 0,
  "bottom": 0,
  "left": 0
 },
 "rootFontSize": 16,
 "root": {
  "kind": "box",
  "id": "html",
  "boxType": "element",
  "style": {
   "display": "block",
   "position": "static",
   "top": {
    "kind": "auto"
   },
   "right": {
    "kind": "auto"
   },
   "bottom": {
    "kind": "auto"
   },
   "left": {
    "kind": "auto"
   },
   "overflowX": "visible",
   "overflowY": "visible",
   "direction": "ltr",
   "boxSizing": "content-box",
   "width": {
    "kind": "auto"
   },
   "height": {
    "kind": "auto"
   },
   "minWidth": {
    "kind": "auto"
   },
   "minHeight": {
    "kind": "auto"
   },
   "maxWidth": {
    "kind": "none"
   },
   "maxHeight": {
    "kind": "none"
   },
   "marginTop": {
    "kind": "px",
    "value": 0
   },
   "marginRight": {
    "kind": "px",
    "value": 0
   },
   "marginBottom": {
    "kind": "px",
    "value": 0
   },
   "marginLeft": {
    "kind": "px",
    "value": 0
   },
   "paddingTop": {
    "kind": "px",
    "value": 0
   },
   "paddingRight": {
    "kind": "px",
    "value": 0
   },
   "paddingBottom": {
    "kind": "px",
    "value": 0
   },
   "paddingLeft": {
    "kind": "px",
    "value": 0
   },
   "borderTopWidth": {
    "kind": "px",
    "value": 0
   },
   "borderRightWidth": {
    "kind": "px",
    "value": 0
   },
   "borderBottomWidth": {
    "kind": "px",
    "value": 0
   },
   "borderLeftWidth": {
    "kind": "px",
    "value": 0
   },
   "flexDirection": "row",
   "flexWrap": "nowrap",
   "flexGrow": 0,
   "flexShrink": 1,
   "flexBasis": {
    "kind": "auto"
   },
   "order": 0,
   "justifyContent": "normal",
   "alignItems": "normal",
   "alignSelf": "auto",
   "alignContent": "normal",
   "rowGap": {
    "kind": "normal"
   },
   "columnGap": {
    "kind": "normal"
   },
   "textAlign": "start",
   "aspectRatio": {
    "kind": "auto"
   },
   "verticalAlign": {
    "kind": "keyword",
    "value": "baseline"
   },
   "grid": null,
   "gridItem": null
  },
  "strut": null,
  "children": [
   {
    "kind": "box",
    "id": "box",
    "boxType": "element",
    "style": {
     "display": "block",
     "position": "static",
     "top": {
      "kind": "auto"
     },
     "right": {
      "kind": "auto"
     },
     "bottom": {
      "kind": "auto"
     },
     "left": {
      "kind": "auto"
     },
     "overflowX": "visible",
     "overflowY": "visible",
     "direction": "ltr",
     "boxSizing": "content-box",
     "width": {
      "kind": "px",
      "value": 33.3
     },
     "height": {
      "kind": "auto"
     },
     "minWidth": {
      "kind": "auto"
     },
     "minHeight": {
      "kind": "auto"
     },
     "maxWidth": {
      "kind": "none"
     },
     "maxHeight": {
      "kind": "none"
     },
     "marginTop": {
      "kind": "px",
      "value": 0
     },
     "marginRight": {
      "kind": "px",
      "value": 0
     },
     "marginBottom": {
      "kind": "px",
      "value": 0
     },
     "marginLeft": {
      "kind": "px",
      "value": 5
     },
     "paddingTop": {
      "kind": "px",
      "value": 2
     },
     "paddingRight": {
      "kind": "px",
      "value": 0
     },
     "paddingBottom": {
      "kind": "px",
      "value": 0
     },
     "paddingLeft": {
      "kind": "px",
      "value": 0
     },
     "borderTopWidth": {
      "kind": "px",
      "value": 1
     },
     "borderRightWidth": {
      "kind": "px",
      "value": 0
     },
     "borderBottomWidth": {
      "kind": "px",
      "value": 0
     },
     "borderLeftWidth": {
      "kind": "px",
      "value": 0
     },
     "flexDirection": "row",
     "flexWrap": "nowrap",
     "flexGrow": 0,
     "flexShrink": 1,
     "flexBasis": {
      "kind": "auto"
     },
     "order": 0,
     "justifyContent": "normal",
     "alignItems": "normal",
     "alignSelf": "auto",
     "alignContent": "normal",
     "rowGap": {
      "kind": "normal"
     },
     "columnGap": {
      "kind": "normal"
     },
     "textAlign": "start",
     "aspectRatio": {
      "kind": "auto"
     },
     "verticalAlign": {
      "kind": "keyword",
      "value": "baseline"
     },
     "grid": null,
     "gridItem": null
    },
    "strut": {
     "font": {
      "family": "Ahem",
      "size": 10,
      "specifiedSize": {
       "kind": "px",
       "value": 10
      },
      "absoluteSize": true
     },
     "lineHeight": {
      "kind": "normal"
     }
    },
    "children": [
     {
      "kind": "text",
      "id": "box:text0",
      "text": "AB CD",
      "font": {
       "family": "Ahem",
       "size": 10,
       "specifiedSize": {
        "kind": "px",
        "value": 10
       },
       "absoluteSize": true
      },
      "lineHeight": {
       "kind": "normal"
      },
      "whiteSpaceCollapse": "collapse",
      "textWrapMode": "wrap"
     }
    ]
   }
  ]
 }
}
```

Output with measurer `ahem/darwin-arm64`:

```json vector-output
[
 {
  "id": "html",
  "parent": null,
  "x": 0,
  "y": 0,
  "width": 25600,
  "height": 1472
 },
 {
  "id": "box",
  "parent": "html",
  "x": 320,
  "y": 0,
  "width": 2131,
  "height": 1472
 },
 {
  "id": "box:text0",
  "parent": "box",
  "x": 0,
  "y": 192,
  "width": 1280,
  "height": 1280
 },
 {
  "id": "box:text0:line0",
  "parent": "box:text0",
  "x": 0,
  "y": 0,
  "width": 1280,
  "height": 640
 },
 {
  "id": "box:text0:line1",
  "parent": "box:text0",
  "x": 0,
  "y": 640,
  "width": 1280,
  "height": 640
 }
]
```

## Device pixel ratios

Native lanes run at DPR 2 and 3 on both platforms, and at 2.625 on Android as a named extra (never a substitute). Chrome is captured at those ratios with `--force-device-scale-factor=N` and a context `deviceScaleFactor` of N (`pnpm run parity:dpr-capture`, into `packages/parity/expected-dpr/<platform>/dpr-<N>`), guarded by a zoom check: a 0.5px border must compute to 0.5px, 0.333333px and 0.380952px.

**The zoom model** (`layout.ts` `zoomInput`). At DPR N the engine multiplies every CSS length by N on entry (`zoomCssPx`, in double), computes font sizes as `fround(fround(size) * N)` (`zoomFontSize`), applies the font rules to the zoomed size, and lays out in zoomed px with `devicePixelRatio` 1, so borders snap to whole zoomed px. A zoomed px is a device px: output LU are 1/64 device px, and CSS px = LU / (64 * N). At DPR 1 an input with no calculation and no font to resolve is used as given, so the model is the identity. A `device-px` border width is not multiplied.

**The five engine rules** (Chrome 145.0.7632.6, notes/T010-p2-triage.md), applied at every DPR, DPR 1 included:

- R1: the initial containing block is `ceil(viewport * N)` device px (`zoomViewportPx`; measured, 790.125 gives 791).
- R2: a px line-height is `LayoutUnit::FromFloatRound(float(px))` (`fromFloatRound`).
- R3: a number line-height is `MinimumValueForLength(percent, FromFloatRound(computed font size))` (`lineHeightFromNumber`).
- R4: in min-content, each word of a text item is `ShapeResult::CachedWidth`: `ceil(advance sum to its end) - ceil(advance sum to its start)` in LU (`cachedRangeWidth`, through the measurer's `measureRange`). A word at the item start is the plain snapped width.
- R5: an initial line width is `{ kind: "device-px", value: 3 }` (the UA dataset's medium), written by the compiler; the Chrome deviation `initial-line-width-unzoomed` is registered in `src/chrome-deviations-dpr.ts`.

**The environment pass** (`environment.ts`, called by `zoomInput`; V1 of the value model, notes/T006-value-model-spec.md). The zoom model above is its first half. Its second half resolves every `{ "kind": "calc", "expr", "range" }` length at every DPR, DPR 1 included, as Blink's style resolution does (`css_length_resolver.cc`, `css_math_expression_node.cc` at 145.0.7632.6):

- the compiler writes the calculation after Blink's parse-time simplification, with CSS-level leaves: `px` (absolute units already in px), `percent`, `number`, `viewport` (`vw`, `vh`, `vmin`, `vmax`; `vi` and `vb` arrive as width and height), `em` (the element's specified font size, or the root's for `rem`), and `sum`, `product`, `invert`, `min`, `max` and `clamp`; a subtracted term arrives negated;
- each leaf becomes zoomed px in double: `px * z`, `value * (V / 100) * z` for viewport units, `value * float(fontSize * z)` for `em`;
- a calculation with no percentage is evaluated in double and stored as a float `px`; one whose only dimension is a percentage becomes a `percent`; any other becomes `{ "kind": "pixels-and-percent" }` when its sums and products by a number allow it, and otherwise a tree of `number` and `pixels-and-percent` leaves. The engine evaluates both at layout in float against the percentage basis (`calc.ts`); a percentage against an indefinite basis makes a height auto and a max none, and a min resolves against 0.

- R6: viewport units read `float(ceil(w * N) / N)` CSS px, the whole device px window of R1 over the zoom (`viewportUnitBase`): at 2.625 a 300px viewport is 788 / 2.625 px for `vh`. It is registered in `src/platform-rules.ts` as the DPR platform rule `viewport-device-ceil`.

**Fonts and font-relative lengths** (V2 of the value model, notes/T012-v2-spec.md; measured on the pinned Chrome, notes/T026-v2a-value-model.md). The pass also resolves every text run's font and the font-relative leaves:

- more leaves: `viewport` names the viewport it reads (`size`: `small`, `large` or `dynamic`); `rem` is `value * float(rootFontSize * z)`; `env` is `value` times the inset of its `side`, a px literal as Blink substitutes it; `font-metric` (`ex`, `ch`, `cap`) and `lh` carry the font (and line height) they read;
- a specified font size is evaluated at zoom 1 in CSS px and stored as a float: a length or a calculation without a percentage in double, clamped non-negative; `font-percent` is `float(value * parent / 100)` of the parent's specified size; `font-calc` evaluates its calculation, in float, against the parent's specified size. `em` reads the specified size of its `fontSize`, never the computed one;
- the computed size is `float(specified * z)`, 0 below float epsilon, capped at 10000px, and at least 6px when `absoluteSize` is false (Chrome's minimum logical font size);
- `ex`, `ch` and `cap` are `metric / z * zoom` in float, the metric of the font instance at the truncated computed size: the x-height `float(size * float(xHeight / unitsPerEm))` (the bounds of glyph x), the cap height `float(size * capHeight / unitsPerEm)` and the advance of `0` (`fontMetricLengths`); inside a font size the zoom is 1 and the font is the parent's;
- `lh` is the computed line height of its font over `z` times the zoom: `normal` is the rounded ascent + descent + line gap, a number is its percent of `LayoutUnit(computed size)` (truncated, unlike R3), a percentage is `float(float(size * int(percent)) / 100)`, and px or a calculation is its stored float;
- a text run's `percent` or `calc` line height becomes `px` at the zoom (a calculation with a percentage resolves against `LayoutUnit(computed size)`).

**Calc goldens.** `calc/<name>.json` has the four keys of a top-level vector: one engine vector per (verify) point of the value model (engine-value-model-plan.md §2), named in `test/calc.test.ts` and, where a values fixture holds the same element, checked against the Chrome capture in `packages/parity/test/values.test.ts`. They are hand-picked, not regenerated by `layout:vectors`.

**Files.** `pnpm run layout:dpr-vectors` writes, from the committed DPR captures and only for cases whose every node matches Chrome exactly in zoomed LU:

- `dpr-<N>/<case>.json`: the same four keys as a top-level vector; `input.devicePixelRatio` is N and `output` is in zoomed LU. Each DPR folder has the same case ids as the top level.
- `dpr-<N>/snap/<case>.json`: `{ "platform", "devicePixelRatio", "input", "output" }`, where `input` is that vector's output and `output` is `snapEdges(input)`: per rect `{ id, left, top, right, bottom, width, height }` in whole device px. The snap rule is `floor((lu + 32) / 64)` on absolute edges (parent offsets summed in integers, right and bottom with the saturating add), and sizes are the distances between snapped edges. Values stay numbers.

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
- `root`: a `LayoutBox` `{ kind: "box", id, boxType: "element" | "anonymous", style: LayoutStyle, children }`. Children are all boxes or all text leaves. The compiler wraps mixed text in anonymous boxes `<element>:anon<k>`; the engine never creates boxes.
- `style` has all 41 `LayoutStyle` fields. Lengths are tagged `{ kind: "px", value }` (CSS px), `{ kind: "percent", value }` (100 is the whole basis), or keywords such as `{ kind: "auto" }`, `{ kind: "none" }`, `{ kind: "normal" }` and `{ kind: "content" }`, as each field allows. Enumerations are strings; flexGrow, flexShrink and order are numbers.
- The four border widths also take `{ kind: "device-px", value }`: an initial line width (no width declared, or a border shorthand that omits it), which Chrome keeps in device px at every pixel ratio (rule R5 below).
- A text leaf is `{ kind: "text", id: "<element>:text<k>", text, font: { family: "Ahem", size }, lineHeight, whiteSpaceCollapse: "collapse", textWrapMode }`. The text is already collapsed, and the leaf carries every inherited text property itself.
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
   "textAlign": "start"
  },
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
     "textAlign": "start"
    },
    "children": [
     {
      "kind": "text",
      "id": "box:text0",
      "text": "AB CD",
      "font": {
       "family": "Ahem",
       "size": 10
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

**The zoom model** (`layout.ts` `zoomInput`). At DPR N the engine multiplies every CSS length by N on entry (`zoomCssPx`, in double), computes font sizes as `fround(fround(size) * N)` (`zoomFontSize`), applies the font rules to the zoomed size, and lays out in zoomed px with `devicePixelRatio` 1, so borders snap to whole zoomed px. A zoomed px is a device px: output LU are 1/64 device px, and CSS px = LU / (64 * N). At DPR 1 the input is used as given, so the model is the identity. A `device-px` border width is not multiplied.

**The five engine rules** (Chrome 145.0.7632.6, notes/T010-p2-triage.md), applied at every DPR, DPR 1 included:

- R1: the initial containing block is `ceil(viewport * N)` device px (`zoomViewportPx`; measured, 790.125 gives 791).
- R2: a px line-height is `LayoutUnit::FromFloatRound(float(px))` (`fromFloatRound`).
- R3: a number line-height is `MinimumValueForLength(percent, FromFloatRound(computed font size))` (`lineHeightFromNumber`).
- R4: in min-content, each word of a text item is `ShapeResult::CachedWidth`: `ceil(advance sum to its end) - ceil(advance sum to its start)` in LU (`cachedRangeWidth`, through the measurer's `measureRange`). A word at the item start is the plain snapped width.
- R5: an initial line width is `{ kind: "device-px", value: 3 }` (the UA dataset's medium), written by the compiler; the Chrome deviation `initial-line-width-unzoomed` is registered in `src/chrome-deviations-dpr.ts`.

**Files.** `pnpm run layout:dpr-vectors` writes, from the committed DPR captures and only for cases whose every node matches Chrome exactly in zoomed LU:

- `dpr-<N>/<case>.json`: the same four keys as a top-level vector; `input.devicePixelRatio` is N and `output` is in zoomed LU. Each DPR folder has the same case ids as the top level.
- `dpr-<N>/snap/<case>.json`: `{ "platform", "devicePixelRatio", "input", "output" }`, where `input` is that vector's output and `output` is `snapEdges(input)`: per rect `{ id, left, top, right, bottom, width, height }` in whole device px. The snap rule is `floor((lu + 32) / 64)` on absolute edges (parent offsets summed in integers, right and bottom with the saturating add), and sizes are the distances between snapped edges. Values stay numbers.

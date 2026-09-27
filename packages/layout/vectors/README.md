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

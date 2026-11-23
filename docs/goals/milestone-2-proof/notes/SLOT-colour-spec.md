# SLOT-colour: a colour the app computes while it runs reaches the phone as four numbers, as Chrome 145 paints it through var()

Worker spec (2026-11-23) for review before implementation. Measured on master 2c460cb251. The Markless side was read on ~/wt/markless/text-parent (c66ec1448).

## Judge verdict (2026-11-23)

- **Approved: CS1 only, amended** (D1 below). CS2 and CS3 are parked until the owner rules on Q1.
- **Q1.** Pending the owner, because it changes public text: the family writes rgb()/rgba() with number holes.
- **Q2.** Markless's call. By default the family returns one template per style, and the thumb's branch on its `channel` prop becomes `styleByState`.
- **Q3.** The closed grammar, only if CS2 is revived.
- **Q4.** Markless folds a hole whose inputs are all fixed props into fixed text. Sampling a colour slot's four channels in one compile is rejected.
- **Q5.** A separate task, SLOT-transitions, refuses a property a slot moves when it has a transition or an animation, for every slot, before colorpicker ships.
- **Q6.** Keep `dragon.markless-plan/1` only if a current harness refuses unknown slot types by name.
- **Q7.** Keep R5.
- **Q8.** Planted faults stay on the build side.
- **Q9.** Agreed.
- **Q10.** Follow-ups by name.
- **One analysis.** Parsing a value at run time is not scanning code. But three hand-written parsers would still break "protocol facts are imported" and Dragon's "on-device code never parses CSS", so a revived CS2 uses one TypeScript parser translated to the phones, plus an owner exception.
- **Licensing.** No Blink code is copied.
- **Proof standard.** A binding rule is proven only by Chrome at values the build never sampled, including one that separates the accepted rule from its nearest wrong neighbour (0.7). Colour pixels are checked at DPR 2 and 3 over white.
- **Follow-up.** Refuse a number slot that reaches an rgb() channel or alpha inside calc(), once the F1 `within` fact exists (today `channel(0, 1)` fits such a channel falsely).

## Why

`colorpicker` is the last @markless/ui family with no native owner. Markless refuses it at build time with "a `style` that follows state whose text is not known when the app is built (only numbers in it may follow state)" (markless packages/compiler/src/passes/native-view.ts:5324-5326).

The family writes two inline styles that follow state (markless packages/headless/components/src/colorpicker/colorpicker-math.ts:481-501):

- **The root** (`rootStyleText`, :481-491, bound at colorpicker.tsrx:415-431; each swatch reuses it, :991-1006):
  - `--colorpicker-value: <colour>`. `cssText` (:285-288) writes `#RRGGBB`, or `rgba(r, g, b, a)` when alpha is on and below 1. It never writes hsl(): `hslText` exists but `cssText` does not call it.
  - `--colorpicker-hue: <n>`;
  - `--colorpicker-pure: #RRGGBB` (`hexText` of the hue at full saturation and brightness);
  - `--colorpicker-x: <n>%` and `--colorpicker-y: <n>%`;
  - `--colorpicker-alpha: <n>`.
- **The thumb** (`thumbStyleText`, :493-501, bound at colorpicker.tsrx:786-818): `--colorpicker-x/-y` for the area's thumb, or `--colorpicker-offset` for a rail's thumb. Which one depends on the thumb's `channel` prop.

These custom properties are public API. App stylesheets read them through var(). For example, note.md:204 suggests `[ui-channel="saturation"] { background: linear-gradient(to right, #fff, var(--colorpicker-pure)); }`, and the family's own sheet places the thumbs with `left: var(--colorpicker-offset)` and `left: var(--colorpicker-x); bottom: var(--colorpicker-y)` (colorpicker.tsrx:849-860).

The numeric properties already fit Dragon's typed slots. The two colours do not. A slot is a number (packages/parity/src/markless-slots.ts:8, `MarklessSlot = { id, initial, integer? }`), and the hole's text in a colour is a string the app builds with `toString(16)` (colorpicker-math.ts:251-254), so no number in it follows state.

## What Chrome 145 does (tag 145.0.7632.6)

### The model (css-variables-1, css-color-4)

- **An unregistered custom property holds tokens, not a colour.** Its computed value is its specified token sequence with var() substituted (css-variables-1 §2). `getComputedStyle(main).getPropertyValue('--v')` gives the text as written: `#3399FF`, `rgba(51, 153, 255, 0.5)` (probe below). It inherits as tokens.
- **The using property parses the substituted tokens with its own grammar,** at computed-value time (§3.1). `background-color: var(--v)` then computes to an absolute colour: `rgb(51, 153, 255)` from either spelling of the same colour.
- **Invalid at computed-value time.** If the substituted text does not parse, the declaration behaves as `unset` (§3.1). For example, `background-color` goes to transparent, `color` inherits, and `width` goes to auto.
- **Legacy colours keep 8-bit channels and alpha.** Dragon's color.ts already models this, and the probe confirms it:
  - each channel is clamped and rounded half away from zero (color.ts:64-67 `round8`);
  - alpha is `round8(clamp(a, 0, 1) × 255)` (color.ts:111-115 `alpha8`). 0.501 computes to 0.5 (128/255), 0.002 to 0.004 (1/255), and 0.999 to opaque.
- **Paint.** The colour fills with source-over, and a border paints over its own background, which is clipped to the border box by default. So a translucent border over a translucent background composites twice: [102, 179, 255] over white at alpha 0.5, against [153, 204, 255] for the background alone.
- **A registered property** (`@property --v { syntax: '<color>' }`) computes to a colour on the element that declares it. Its serialization becomes `rgba(51, 153, 255, 0.5)`, and a transition or animation can interpolate it.
- **A change through the style attribute starts transitions.** Setting `style="--v: …"` from script changes the using property's computed value, so a `transition: background-color` on the user starts a CSSTransition (probe: `transition-on-change`).

### Probe (Chrome 145.0.7632.6, darwin-arm64, `launchChrome(2)` and `launchChrome(3)`)

The script is in ~/wt/scratch-op/colorslots/probe.ts, and its output in probe.out. `main` carries the style attribute. `.b` is a 40px box with a 10px `border: solid var(--v)` and `background-color: var(--v)`. `.t` takes `color: var(--v)` and a currentcolor border. Pixels are read from the screenshot over white. DPR 2 and 3 gave identical values in every row.

| Case | `--v` (and the user) | Computed | Pixel (background, border) |
| --- | --- | --- | --- |
| hex | `#3399FF` | rgb(51, 153, 255) everywhere | 51,153,255 / 51,153,255 |
| rgba 0.5 | `rgba(51, 153, 255, 0.5)` | rgba(…, 0.5) | 153,204,255 / 102,179,255 |
| rgba 0.3 | `…, 0.3)` | rgba(…, 0.3) | 193,224,255 / 149,202,255 |
| rgba 0.1 | `…, 0.1)` | rgba(…, 0.1) | 234,245,255 / 215,236,255 |
| alpha rounding | `…, 0.501)`, `…, 0.002)`, `…, 0.999)` | 0.5, 0.004, opaque rgb() | as 0.5 / 254,255,255 / opaque |
| fractional channels | `rgb(10.5, 20.49, 254.5)` | rgb(11, 20, 255) | 11,20,255 |
| out of range | `rgb(300, -4, 128)` | rgb(255, 0, 128) | 255,0,128 |
| hex alpha | `#3399FF80` | rgba(…, 0.5) | as rgba 0.5 |
| text joined after the colour | `rgba(51, 153, 255, 0.5)80` | invalid: transparent background, black text and border | white |
| the same join after hex | `#3399FF` + `80` | `#3399FF80`, valid and translucent | as rgba 0.5 |
| color-mix() | `color-mix(in srgb, var(--v) 50%, white)` | `color(srgb 0.6 0.8 1)` | 153,204,255 |
| relative colour | `rgb(from var(--v) r g b / 0.5)` | `color(srgb 0.2 0.6 1 / 0.5)` | 153,204,255 |
| gradient stop | `linear-gradient(to right, #fff, var(--v))` | stop rgb(51, 153, 255) | interpolated |
| shadow | `box-shadow: 0 0 0 4px var(--v)` | `rgb(51, 153, 255) 0px 0px 0px 4px` | 51,153,255 |
| chain | `--w: var(--v); background-color: var(--w)` | rgb(51, 153, 255) | 51,153,255 |
| not a colour property | `width: var(--v)` | invalid: width auto (0px here) | — |
| a number slot in hsl() | `hsl(var(--h) 100% 50%)`, h 210.5 | rgb(0, 125, 255) | 0,125,255 |
| registered `<color>` | `@property --v`, `rgba(51, 153, 255, 0.5)` | custom `rgba(51, 153, 255, 0.5)` | — |
| transition | `transition: background-color 10s`, then `--v` set from script | the old colour, and one running `background-color` transition | — |

What the probe shows:

- **Two spellings of one colour are the same value** in every colour position: hex against rgb()/rgba(), comma against space syntax, and fractional or out-of-range channels.
- **The spelling matters in exactly two cases:** text joined onto the colour's own tokens (the join is valid after hex and invalid after rgba()), and anything that reads the custom property's text instead of its value. Nothing on the phone reads the text.

## What Dragon does today

### How slots reach writes

- **The input** (markless-slots.ts:7-24):
  - `slots: [{ id, initial, integer? }]`;
  - an element's `styleTemplate`, text and `{ slot }` holes (:10), or `styleByState` (docs/markless-native-styles.md:128);
  - checkSlots (:52-95) checks both.
- **Each hole is written as JavaScript writes the number** (`filledStyle`, :98-99, `String(n)`). The CSS around it decides its type. `filledAtInitial` (markless-style-input.ts:315-332) writes every template at the initial values for the export itself.
- **Sampling** (markless-style-input.ts:690-733).
  - `sampleOf` compiles the whole input at one set of values. It keeps, per target and assignment, each engine-input box's style (`engineStyles`, markless-slots.ts:156-170), each export node's writes and frames, and `other`, the tree with the styles taken out.
  - slotBindings (:178-279) compiles each slot alone at SLOT_SAMPLES (:27-30), which are below zero and from zero up. It then compiles every slot at once at each sample position (`together`).
- **Fitting** (fitRule, :133-148). Every number that moves (numberDiff, :104-128) must follow one rule exactly at every sample of its piece. The rule's c and k come from the samples at 0 and 1 (or at -1 and -2 below zero). The candidates are:
  - `line`, c + k·s;
  - `line32`, the same rounded to a 32-bit float;
  - `channel`, the 8-bit channel of an rgb() number, **tried only as `['channel', 0, 1]`** (:146).
- **The records.** A style field gives a `SlotField` (:19, :225-245) and a write number gives a `SlotWrite` (:21, :246-265). A piece where a sample does not compile gives a `SlotRefusal` (:23, :182-190).
- **Build-time refusals:**
  - a slot that changes the box tree or which nodes there are (:213-214);
  - a field or write two slots move ("a value follows one slot", :204-208);
  - a number no rule fits (:240, :261);
  - slots whose values together differ from each slot alone (:268-272);
  - bindings that do not give the export at the initial values (:273-274).
- **The plan** gains `slots` as `[id, 'number' | 'integer']`, and per assignment `slotFields`, `slotWrites` and `slotRefusals` (markless-style-input.ts:740). The harness reads the plan back at build (checkPlan, :741-742). The build also lays every sample out with the phone's function and compares the frames (:743-753).
- **On the phone** (packages/translate/harness/harness.ts):
  - planSlots (:3650-3661) and slotValues/slotList (:3664-3686) read the slots and the line's values, as hex bit patterns;
  - slotFields, slotWrites and slotRefusals (:3688-3753) read the bindings;
  - slotValue (:3795-3800) computes **`channel8(c + k·s)`** for a channel rule. So the harness already applies a general c and k, and only the build's fitRule narrows `channel` to (0, 1);
  - slottedRoot (:3834-3846) patches the engine input;
  - writeNumbers (:4314-4328) returns `[node, kind, path, value]` for each bound write number after the boxes, and the host applies them (markless StyleExport.swift:686-700).

### How a custom property holding a number reaches a var() use

The slots example (examples/markless-styles/input/slots.native-style-input.json) shows the existing route. `h1` carries `--x: <slot:x>%`, and `.thumb { left: var(--x, 0%) }` reads it:

- **At build,** custom properties are text. computeCustoms (packages/dragon/src/analysis/variables.ts:86-138) resolves each element's custom properties and inherits them downward. substituteDeclaration (:157-181) substitutes a using declaration (substituteSteps, :42-68, with `/**/` separators so tokens never merge) and parses the result against the property's grammar (`parseSubstitutedValue`). A result that does not parse is unset, as in Chrome.
- **The slot machinery sees only the outcome.** It compiles at sample values and records which engine-input numbers and write numbers moved. It never knows which var() carried the slot.

### Colours through custom properties already resolve at build, through the same route

- `h8` carries `--tone: rgb(<slot:red> 120 <slot:blue>)`, and `.swatch { color: var(--tone); background-color: var(--tone) }` reads it.
- The substituted `rgb()` is parsed by parseColorValue (color.ts:608) into Rgba8 (color.ts:10).
- Each write's `color.r` and `color.b` fit `['channel', 0, 1]`. This includes the swatch's background, its currentcolor borders, and the label's text and borders by inheritance (markless-slots.test.ts:58-62).
- At values the build never sampled, the Chrome comparison checks the background and text colours exactly (markless-slots.test.ts:108-120).

So a colour made of number holes inside rgb() already works for r, g and b. Two things are missing:

1. **Alpha.** `rgb(10 20 30 / var(--a))` is refused (markless-slots.test.ts:181-185, "is not a straight line or an rgb() channel … at ["color","alpha"]"). Alpha is `round8(255·a)`, which is `channel` with k = 255, but fitRule tries only k = 1.
2. **A colour whose text is a string** (hex, or an rgba() the app formats). No hole in it is a number.

### What the phones run that parses colour text: nothing

- **Dragon's colour parser is build-time only.** color.ts depends on css-tree (:3) and is not in the translator's engine roots.
- **The engine takes numbers.** On the device, `legacyColorFromCss` (packages/layout/src/rt-interpolate.ts:146-150) and the harness's `rtColor` (harness.ts:2534-2538) take `[r, g, b, alpha]` numbers.
- **AGENTS.md forbids it:** "On-device code never parses CSS or matches selectors". So the Dragon harness cannot take colour text.
- **Markless has no runtime colour parser.** Its slot evaluators refuse any value that is not a finite number: runtime.ts:1678-1682, Runtime.swift:1524-1527, Runtime.kt:1870. The family's own `parseColor` (colorpicker-math.ts:186-220) is app code that converts into HSB with two-decimal rounding (rgbToHsb, :91-110), so it cannot give the channels the app wrote.

### Existing gaps this spec touches (sites checked: markless-slots.ts, markless-style-input.ts:690-760, docs/markless-native-styles.md:127-128)

- **Transitions.** No check refuses a slot that moves a property with a transition, for number slots either. Chrome starts the transition (probe), and the phone writes the end value at once. The only animation check near slots is the @for-row one (markless-style-input.ts:846-852).
- **The canvas.** `canvas` and `bodyBackground` (rootPaint, markless-style-input.ts:1245) are not part of a SlotSample. A slot cannot reach them today, because input nodes sit inside `body` and custom properties inherit only downward. This spec keeps it that way (see the refusals).

## The design

**A colour slot is four number slots that the app gives as one colour.** Markless's runtime turns the colour text the app computed into `[r, g, b, alpha]` as the text spells them. Dragon fills the hole with a canonical `rgb()` text of those four numbers at build time. It binds each channel with the existing sampling, and the phone writes the bound numbers as it does today. No CSS text reaches Dragon's on-device code, and the hue/saturation/brightness-to-RGB conversion stays in the app's JS.

### D1. Alpha through the channel rule (fitRule)

- **The change (as amended by the Judge).** fitRule (markless-slots.ts:146) keeps `line` and `line32` with the fitted c and k, and for `channel` tries only the fixed `['channel', 0, 1]` and then `['channel', 0, 255]`, never a fitted c and k: a fitted k = 128 matches every sample of `calc(a * 0.5)` and is wrong at 0.7 (round(89.6) = 90, where Chrome gives round(89.25) = 89). Such an alpha is refused by name. The harness already computes `channel8(c + k·s)` (harness.ts:3795-3800), so the wire and the harness do not change.
- **Why it fits.** Alpha is `round8(clamp(a, 0, 1) × 255)` (color.ts:111-115), and `channel8(0 + 255·a)` is the same double for a in [0, 1]. It clamps the same way outside that range.
- **Chrome checks alpha already.** The `--size` alpha test at markless-slots.test.ts:181-185 stops refusing. It becomes a binding test plus a Chrome comparison of the alpha at values the build never sampled. That is the reason for changing that test.
- **The risk** is a function that equals one of the two channel rules at every sample and differs elsewhere. The proof is Chrome at alphas the build never sampled: 0.3, 0.7, 0.002, 0.501 and 0.999.

### D2. The input and the plan

- **The input slot:** `{ id, colour: true, initial: [r, g, b, alpha] }`.
  - The four numbers are what the app's colour text says: r, g and b on the 0-255 scale (so `#3399FF` is 51, 153, 255), and alpha on the 0-1 scale (so `#3399FF80` has alpha 128/255).
  - Each must be finite. `integer` is not allowed on a colour slot.
  - checkSlots (markless-slots.ts:52-95) and MarklessSlot (:8) gain the variant.
- **The hole is the same `{ slot }` part.** filledStyle (:98-99) writes a colour slot's hole as `rgb(R G B / A)`, each number as `String(n)`. For the grammar in M3 this is exactly the value Chrome computes for the app's own text (probe rows hex, rgba, fractional, out of range, hex alpha).
- **The hole's position** (refusal R1). The hole must be one declaration's whole value. This is checked on the declarations that parseStyleAttribute (packages/dragon/src/css/stylesheet.ts:180) gives for the filled text, by value span, and never by scanning the template.
- **The plan's `slots`.** A colour slot becomes four consecutive entries `[id, 'red']`, `[id, 'green']`, `[id, 'blue']`, `[id, 'alpha']`. In `slotFields` and `slotWrites`, the slot index counts these entries, so every binding stays a binding of one number.
  - harness planSlots (:3650-3661) accepts the four types as `number` values: no whole-number check.
  - It refuses a colour id whose four entries are not consecutive, in that order.
  - The plan stays `dragon.markless-plan/1`, because the new types appear only in plans that have colour slots (Q6).
- **The export's `slots`** keep `{ id, colour: true, initial }`. Markless gives four values per colour slot, in the plan's order.

### D3. Sampling

A colour slot is sampled one channel at a time, with the other channels and every other slot at their initial values. Its samples (`COLOUR_SAMPLES`, beside SLOT_SAMPLES) are:

- r, g, b: below zero [-1, -2, -7.25, -100.5]; from zero up [0, 1, 0.1, 2.5, 10.5, 100.5, 127.5, 200.4, 254.5, 300];
- alpha: below zero [-1, -2, -0.25]; from zero up [0, 1, 0.1, 0.25, 0.5, 0.501, 0.75, 0.999, 2.5].

The together compiles (:192-197) move every channel of every slot at once, which is where coupling between channels shows.

### D4. Refusals, by name, at build time

**R1. The colour's text is joined with other text.** The hole is not one declaration's whole value. Examples: `--v: <slot>80` or `background: linear-gradient(white, <slot>)`. The message: "`<slot>` is joined with other text in its style attribute (`…`), and what that text means depends on how the app spells the colour (`#3399FF80` is a colour, `rgba(…)80` is invalid)".

**R2. A colour function or relative colour around a var() that reads a colour slot.** This covers color-mix(), `rgb(from var(--v) …)` and every relative colour, light-dark(), and a var() inside rgb()/hsl()/hwb()/lab()/lch()/oklab()/oklch()/color(). The message: "`--v` holds the colour slot `<slot>`, and `<property>` uses it inside `<function>()`, which computes a new colour from its channels".

**R3. A var() that reads a colour slot in a longhand that does not take it as a whole colour.** The message: "`--v` holds the colour slot `<slot>` and reaches `<property>`, which does not take a colour there". This includes a colour slot in a non-colour property, which Chrome makes invalid at computed-value time (probe: `width`). The colour positions allowed:

- `color`, `background-color`;
- `border-*-color`, `outline-color`, `text-decoration-color`, `column-rule-color`;
- a gradient stop's colour;
- a `box-shadow` or `text-shadow` colour;
- SVG `fill` and `stroke` colours.

Each is allowed only where the existing compile resolves it to write numbers.

**R4. A transition or animation on a longhand a colour slot reaches.** The message: "`<property>` of `<node>` has a transition, which Chrome runs when the slot changes, and the phone writes the new colour at once". The check uses the export's own `anim` entries (the ones markless-style-input.ts:846-852 already reads). Q5 asks whether number slots get the same refusal.

**R5. A registered custom property holding a colour slot.** `@property` with any syntax gives the property a computed value and lets it animate. Refused for now (Q7).

**R6. Coupled channels.** These are already refused by the together check (:268-272) and by fitRule. The message gains the colour slot's channel name. Known cases:

- `inset`, `outset`, `groove` and `ridge` borders: darkColor and lightColor scale every channel by the largest one (color.ts:738-772);
- SVG `fill-opacity` and `stroke-opacity` applied to the alpha byte (svgPaintAlpha, color.ts:777-779).

R2 and R3 need one new fact from the analyzer, so that the checks never re-read CSS text:

- **(F1) The functions around each var().** parseVarParts (packages/dragon/src/css/variables.ts:160-229) already tracks open brackets. It records, for each `var` part, `within`: the lowercased names of the functions that enclose the reference, outermost first.
- **(F2) Which custom properties a substitution read, transitively.** substituteSteps (analysis/variables.ts:42-68) already yields every name it looks up. computeCustoms (:86-138) and substituteDeclaration (:157-181) keep, per element, `reads: Map<name, within>`. This holds for each custom property and each substituted declaration. A custom property's reads carry through to the declarations that read it, with the functions around each step joined.
- **The check.** The Markless slot path asks this of the compile at the initial values: every substituted declaration on the slot's element or its descendants whose `reads` include a custom property that the colour hole fills.

### D5. What does not change

- Number slots, styleByState (docs/markless-native-styles.md:128), the row slots of markless-row-slots.test.ts, the box-tree rules, and the frames check at every sample (markless-style-input.ts:743-753).
- **The text.** A colour does not change how text shapes, so the known follow-up at docs/markless-native-styles.md:127 does not grow.

## The Markless contract

### M1. The analyzer (markless packages/compiler/src/passes/native-view.ts)

- **Today.** stylePartsOf (:169-195) joins literal text and templates. It makes a hole only of an expression that can only be a number (mayBeNumber, :138-152). While a style is read, a helper whose body is one `return` of a template is inlined (:3245-3251, :4906). `rootStyleText` is two statements ending in `[...].join('; ')`, so it is not inlined, and the whole style is refused (:5324-5326).
- **New: a colour hole.** A hole whose expression is text the build cannot see (a call such as `cssText(color, withAlpha)` or `hexText(…)`) becomes a colour hole: `{ slot }`, with a payload slot `{ id, value, colour: true }`. Markless need not prove the hole's position. Dragon refuses it by name (R1), and the runtime refuses text that is not a colour (M3).
- **Seeing the family's text.** Either the analyzer learns `[template, …].join(literal)` and a helper with local `const`s, or the family writes rootStyleText and thumbStyleText as one returned template each. Q2 asks which. With either, these become number holes through the helpers that already inline (:3245):
  - `trim(color.h)` (a template of `round(value, 2)`);
  - `percent(…)` (a template of a number and `%`);
  - `round(color.a, 3)`.
- **The thumb's branch on its `channel` prop** (colorpicker-math.ts:493-501) is a choice of template. It needs to be fixed at build per instance, or given as `styleByState` (docs/markless-native-styles.md:128).
- **Swatches** (colorpicker.tsrx:991-1006) call rootStyleText on their own fixed `value` prop. A swatch whose colour never changes should be folded to fixed text. Otherwise each swatch adds two colour slots and four number slots (Q4).

### M2. The style input (markless packages/mobile/src/style-input.ts)

- **Payload `slots`** (:92-97) gain `{ id, colour: true, initial: [r, g, b, alpha] }`. `initial` is the mount value parsed by M3 (:690-700, where today it reads `mounted.slots()`).
- **A row's colour slot** takes its first row's value, as number slots do (:694-697). With no row at mount it takes `[0, 0, 0, 1]`.

### M3. The runtime: colour text to four numbers

Markless parses the text, in each of its three slot evaluators: runtime.ts:1666-1690, Runtime.swift:1514-1532 and Runtime.kt:1859-1875. Dragon's on-device code cannot parse it, and the app produced the text.

**The grammar is closed.** It is what the family writes, plus the common hand-written forms:

- `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, with hex digits in either case. Each nibble is doubled. Alpha is the byte / 255, or 1 when absent.
- `rgb(` or `rgba(`, with an ASCII case-insensitive name. Either 3 comma-separated numbers and an optional comma and alpha, or 3 space-separated numbers and an optional `/ alpha`.
  - A number is a CSS `<number>` (sign, digits, fraction, exponent). Percentages and `none` are refused.
  - The numbers are passed as written, without clamping or rounding. Dragon's channel rule rounds them as Chrome does (probe: fractional and out of range).
- `transparent` gives `[0, 0, 0, 0]`.
- No white space around the colour, as the family writes it.

**Everything else is refused at run time, by name:** "style slot `<id>` is `"<text>"`: a colour slot takes #hex, rgb() or rgba() with numbers". This covers named colours, currentcolor, hsl(), hwb(), lab(), lch(), oklab(), oklch(), color(), color-mix(), var() and malformed text. A refusal is a runtime error, as the number check is today.

**One reference for three parsers.** Dragon publishes `colourSlotChannels(text)` (packages/parity/src/markless-colour-text.ts, built on color.ts's parse of the same grammar) and a vector file generated from it (examples/markless-styles/colour-slot-vectors.generated.json). Each vector is a text and its four numbers, or the refusal. Markless pins its three parsers to the vectors, so the grammar is imported, not restated. Every vector's computed colour is also checked against Chrome (CS3).

### M4. The layout call

The host passes four values per colour slot in `slots` (StyleExport.swift:686-700 and its Kotlin twin), as hex bit patterns, in the plan's order. Rows carry four per colour slot too (:715). Nothing else in the line changes.

## Fixtures

### Where they run

- **A new test,** packages/parity/test/markless-colour-slots.test.ts, in the style of markless-slots.test.ts:68-125, with a new input, examples/markless-styles/input/colour-slots.native-style-input.json.
- **Each case runs three ways at values the build never sampled:**
  1. the phone's function (`runMarklessLayout` with the values) must give exactly the writes and frames of a fresh export of the same input with those values written in (`filledAtInitial`);
  2. that export must pass the Chrome comparison on both targets;
  3. every colour write the slot moves must equal Chrome's computed colour exactly, and the Chrome pixel at the box's centre must be that colour composited over white, as markless-root-paint.test.ts checks.
- **Ratios 2 and 3** (`launchChrome(2)` and `(3)`). The plan records text only at PLAN_DENSITIES (packages/parity/src/markless-plan.ts:24), and both ratios are in both targets' lists.

### The page

`main` carries `styleTemplate: ["--v: ", { slot: "slot:v" }, "; --a: ", { slot: "slot:a" }]`. `slot:v` is a colour slot and `slot:a` is a number. Its children:

1. `.bg { background-color: var(--v) }`;
2. `.border { border: 4px solid var(--v); background-color: white }`, and `.both`, which has the same border over `background-color: var(--v)`, so that the double composite shows;
3. `.text { color: var(--v); border: 2px solid; text-decoration: underline }`, where the currentcolor border and decoration follow by inheritance;
4. `.chain { --w: var(--v); background-color: var(--w) }`;
5. `.alpha { background-color: rgb(10 20 30 / var(--a)) }`, the number-slot alpha (D1);
6. `.stop { background-image: linear-gradient(to right, #fff, var(--v)) }` and `.shadow { box-shadow: 0 0 0 4px var(--v) }`. These are included only where the existing compile emits their writes as numbers; otherwise they are listed as a follow-up by name.

### Values (each as the app's text, then the four numbers M3 gives)

- `#3399FF` → 51, 153, 255, 1;
- `rgba(51, 153, 255, 0.5)`, `0.3`, `0.1` → the translucent rows of the probe;
- `rgba(51, 153, 255, 0.501)`, `0.002`, `0.999` → the alpha steps;
- `rgb(10.5, 20.49, 254.5)` → rounding half away from zero;
- `rgb(300, -4, 128)` → clamping;
- `#3399FF80` → hex alpha;
- `transparent`;
- the same colour as `#3399ff` and as `rgb(51 153 255 / 1)` → the same writes.

### Refusal tests (no Chrome)

- R1 to R6, each by its message.
- M3's runtime refusals, through the vectors: named, hsl(), percent, `none`, white space, malformed.
- The plan reader refuses four colour entries out of order, and a colour slot with `integer`.

### Planted faults (build-side, set only by the test; harness faults are Q8)

- **`colourChannelsSwapped`**: filledStyle writes `rgb(B G R / A)`. Every Chrome comparison with r ≠ b must fail. The build oracle alone would not catch it, because the bindings are fitted from the faulty compile.
- **`colourAlphaAsPercent`**: the canonical text writes the alpha as `A%`, so 0.5 becomes 0.5%. Every translucent case must fail in Chrome, and so must the opaque case at alpha 1 (1% is 3/255).
- **`channelFitUnit`**: fitRule's channel stays (0, 1), which is today's rule. The alpha cases must be refused at build, and the case-5 test must fail.
- **A harness fault, if the Judge accepts one (Q8)**: `channelUnrounded`, where slotValue returns c + k·s for a channel rule. The fractional and alpha cases must fail through Chrome, not only through the build.

## Slices

- **CS1, alpha through the channel rule** (D1).
  - The change is fitRule (markless-slots.ts:146), the rewritten markless-slots.test.ts:181-185 (a binding test at those alphas against the export and Chrome, plus the `calc(var(--size, 1) * 0.5)` refusal), and docs/markless-native-styles.md:127 (the channel rule's wording).
  - The proof is markless-slots.test.ts, markless-style-choice.test.ts and markless-row-slots.test.ts, unchanged except :181-185, plus a regen that changes no expected file.
  - About 8-12 KB reviewed.
- **CS2, the colour slot** (D2-D4, F1-F2).
  - markless-slots.ts: the type, checkSlots, filledStyle, COLOUR_SAMPLES, the expansion into channels and the R6 wording.
  - markless-style-input.ts: plan.slots entries, the R1 position check, the R2-R5 checks and the export's `slots`.
  - css/variables.ts (F1) and analysis/variables.ts (F2).
  - harness.ts planSlots, with the translated Harness.swift and Harness.kt regenerated (not reviewed).
  - Unit tests for the refusals and the plan reader in markless-slots.test.ts, and F1/F2 tests in packages/dragon/test (variables).
  - About 55-75 KB reviewed.
- **CS3, the reference parser and the Chrome fixtures.**
  - markless-colour-text.ts and its generated vectors (generated output, not reviewed: `*.generated.*`);
  - colour-slots.native-style-input.json;
  - markless-colour-slots.test.ts: the page, values, ratios 2 and 3, the pixel checks and the faults;
  - the docs/markless-native-styles.md entry.
  - About 30-45 KB reviewed. It stacks on CS2.
- **Total: about 95-130 KB reviewed,** with each PR far under the 150 KB limit. CS1 can land alone and is useful alone: the family's `--colorpicker-alpha` read inside rgb() binds after it.
- **The Markless side (M1-M4)** is separate Markless PRs after CS2 lands. It does not count against Dragon's reviews.

### Files

- packages/parity/src/markless-slots.ts, packages/parity/src/markless-style-input.ts, packages/parity/src/markless-colour-text.ts (new)
- packages/dragon/src/css/variables.ts, packages/dragon/src/analysis/variables.ts
- packages/translate/harness/harness.ts, plus the generated Harness.swift and Harness.kt
- packages/parity/test/markless-slots.test.ts, packages/parity/test/markless-colour-slots.test.ts (new), and the variables test in packages/dragon/test
- examples/markless-styles/input/colour-slots.native-style-input.json (new), examples/markless-styles/colour-slot-vectors.generated.json (new)
- docs/markless-native-styles.md

## Build cost

- **Compiles per colour slot.** Each channel compiles at 13 (r, g, b) or 12 (alpha) samples, so one colour slot costs about 51 compiles. Today a number slot costs 10.
- **The colorpicker root** has two colour slots and four number slots: about 140 compiles, plus about 10 together compiles. The area thumb adds two number slots and a rail thumb adds one.
- **Each swatch left as slots** adds about 140 more (Q4).
- **The time per compile** is measured on the CS3 page before landing CS2. The number goes in the PR body.

## Open questions for the Judge

1. **A colour slot, or the family writes numbers.** The alternative needs no new slot kind: the family writes `rgb(${r} ${g} ${b} / ${a})` with number holes, and CS1 alone binds it. The cost is that the public `--colorpicker-value` text changes from `#3399FF` to `rgb(51 153 255 / 1)` for script readers, and that any app writing a hex string stays refused. The design principles say the developer should never need to know a platform difference, which favours the colour slot. Proposed: the colour slot (D2), with CS1 first either way.
2. **How Markless sees rootStyleText.** The analyzer learns `[…].join()` and local `const`s, or the family writes one returned template. This is a Markless ruling; it blocks M1, not Dragon's slices.
3. **The runtime grammar.** Hex, rgb()/rgba() with numbers, and `transparent` (proposed). Adding hsl() would put Chrome's float hslTo8 (color.ts:143-156) into three runtimes, and named colours would add a 148-entry table to each. Proposed: no, until an app needs them.
4. **Swatches and fixed colours.** Should Markless fold a hole whose inputs are all fixed props into fixed text (proposed)? Or should Dragon sample a colour slot's four channels in one compile, with distinct values per channel, to cut its cost to about 13 compiles?
5. **Transitions on slot-moved properties.** R4 refuses them for colour slots. The same gap exists for number slots today: the sites checked were markless-slots.ts, markless-style-input.ts:690-760 and :846-852. Should CS2 refuse them for every slot, or should it be its own task?
6. **The plan version.** Do four new slot types keep the plan at `dragon.markless-plan/1`, as an optional field did in ROW-text-space Q2?
7. **A registered colour custom property.** R5 refuses it. A registered `<color>` is the same value with a computed colour, so it could be allowed without transitions, with a fixture. Allow it in CS3, or keep it refused?
8. **A harness planted fault.** As in ROW-text-space Q4: FAULT_KEYS (harness.ts:1267) are engine faults. Should `channelUnrounded` be a test-only field of the line, or should the fault proof stay on the build side?
9. **The hue rail.** `hsl(var(--colorpicker-hue) 100% 50%)` stays refused as not a straight line (probe: the hue row), since `--colorpicker-pure` gives the pure colour as a colour slot. Is that scope right, given that a rainbow rail is a fixed gradient?
10. **Gradient stops and shadows.** Case 6 assumes the existing compile emits a gradient stop's colour and a box-shadow colour as write numbers on the Markless path. If either is not a write there, should CS3 list it as a follow-up by name, or add it?

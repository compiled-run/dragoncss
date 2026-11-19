# System fonts on Markless native targets

Owner direction, 2026-11-18 (docs/decisions.md, "System fonts on Markless native targets"): a Markless page whose text is in
`system-ui`, `sans-serif`, `serif`, `monospace`, or no `font-family` at all is laid out by Dragon with each phone's own font,
measured at build time on the build machine, and drawn on the phone by that platform font at Dragon's positions. Nothing is bundled.
Out of scope: drift between OS versions, phone makers' replacement fonts, and the run-time text size setting.

## Which font each generic is

Measured 2026-11-18 by element widths of 6 strings at 12, 16, 17, 24 and 28 px, weights 400 and 700, against Core Text (iOS
simulator) and Paint (Android emulator) widths of candidate fonts. Probe sources: packages/parity/test/system-fonts/probes; the
probe numbers the tests read: packages/parity/test/system-fonts/{ios-coretext,android-paint}.json.

What is committed differs by platform. android-paint.json keeps Chrome's and the WebView's own element widths and line heights.
ios-coretext.json keeps Safari's line heights and which generics Safari matched to each face, but not Safari's element widths: the
iOS width deltas in the table below were computed by the probe run against Safari widths that were not committed, so nothing in
the repo shows them.

| CSS | Safari, iOS 27.2 (simulator, runtime 24B8117) | Chrome 133, Android 36 (emulator image `google_apis` arm64) |
|---|---|---|
| `system-ui` | San Francisco (`.SFUI-Regular`, `.SFUI-Bold`), max width delta 3e-5 px | Roboto (`Roboto-Regular.ttf`, variable, wght 400/700) |
| `sans-serif` | Helvetica, Helvetica-Bold (delta 0); weights 100 to 300 pick Helvetica-Light (not measured) | Roboto |
| `serif` | Times New Roman (delta 0) | Noto Serif (`NotoSerif-Regular.ttf`, `NotoSerif-Bold.ttf`) |
| `monospace` | Courier, Courier-Bold (delta 0; Courier New ties on widths, its line height does not) | Droid Sans Mono (regular only; bold is synthetic) |
| no `font-family` | Times New Roman | Noto Serif (Chrome's default, Times New Roman, is aliased to `serif` in fonts.xml). The Android WebView differs: Roboto |

The table is packages/parity/src/system-fonts/web-generics.ts. Only weights 400 and 700 were measured in Safari. For the other
weights Dragon picks a face the way CSS font matching does (css-fonts-4 §5.2) among the role's faces. For `sans-serif`, `serif`
and `monospace` those faces are every upright face of the family in the iOS runtime's font files, at the weight each file declares;
a test reads the runtime's files to check the list. Helvetica has a third upright face, Helvetica-Light (weight 300), so weights
100 to 300 draw it. Whether Safari draws the same faces at those weights has not been measured.

## What Dragon reads at build time

- **iOS**: Core Text on the build Mac, through a Swift helper (packages/parity/src/system-fonts/coretext-helper.swift) compiled into
  `node_modules/.cache/dragon-system-fonts` on first use and driven synchronously from TypeScript. Off macOS it refuses by name. The
  Mac's Core Text gives the iOS simulator's glyph ids and positions for every face above (0 differing glyphs, positions within
  5e-5 px). San Francisco's vertical metrics differ (the Mac's SFNS: ascender 1980, descender 432; iOS's SFUI: 1950, 494), so they
  are read from `System/Library/Fonts/Core/SFUI.ttf` of the newest iOS simulator runtime on the machine (`DRAGON_IOS_RUNTIME_ROOT`
  overrides).
- **Android**: the SDK's emulator system image `system-images;android-36;google_apis;arm64-v8a` (`DRAGON_ANDROID_SYSTEM_IMAGE`
  overrides). system.img is a GPT disk whose `super` partition holds liblp logical partitions; Dragon reads the `system` partition's
  ext4 file system (packages/parity/src/system-fonts/android-image.ts) for `/system/etc/fonts.xml` and `/system/fonts/*`, caching
  each file with its SHA-256 under `node_modules/.cache/dragon-system-fonts`. Text is shaped with Dragon's HarfBuzz on the font file at
  the instance fonts.xml names.

## Safari's rules Dragon follows on iOS

- **Spaces**: a space gets the font's own space advance, dropping kerning Core Text puts on the space glyph (Times New Roman and
  Helvetica regular otherwise differ by up to 0.506 px). The tests check Dragon against this rule (`spaceRuleWidth` in
  ios-coretext.json, computed from Core Text), not against Safari. The Safari widths of Times New Roman and Helvetica the rule was
  derived from are not committed. The one committed Safari width the rule changes is an author font's: Lato Regular at 18 px,
  "Lato for the body, regular weight", 257.193 CSS px in Safari (packages/parity/test/markless-web-font.test.ts), which is the
  rule's width; Core Text's own line width is 256.824.
- **Size**: Safari shapes at the CSS size and scales by the device ratio; San Francisco's optical size and tracking follow the size,
  so Dragon shapes at the CSS size too.
- **Line metrics**: ascent, descent and leading are each Core Text's value rounded up in CSS px; Helvetica's ascent also gains
  0.15 × (ascent + descent), rounded up. With `line-height: normal` the leading is split evenly above and below the glyphs.

## The export

A system face is named by its request, `system:<role>:<weight>[:italic]` (roles `system-ui`, `sans-serif`, `serif`, `monospace`,
`default`; weights 100 to 900), in the font writes and glyph runs. `fonts` lists only bundled faces; `systemFonts` lists each system
face with how each target's host rebuilds it:

```json
{ "id": "system:system-ui:700",
  "ios": { "face": { "kind": "system", "weight": 0.4, "design": "default" } },
  "android": { "file": "Roboto-Regular.ttf", "index": 0, "axes": { "ital": 0, "wdth": 100, "wght": 700 }, "sha256": "9ca9…" } }
```

iOS `kind: "system"` is `UIFont.systemFont(ofSize:weight:)` at that `UIFont.Weight`; `kind: "name"` is
`CTFontCreateWithName(postScriptName)`. Android is `/system/fonts/<file>` at those axes.

## Refused

- A weight other than the nine, `font-style: oblique`, and italic where the platform has no italic face (iOS: none listed).
- Where Chrome would synthesize: bold over a face lighter than 600 (Android `monospace` bold), and oblique.
- Text Core Text draws with a fallback font (a code point the face lacks), and right-to-left text in a system face.
- `ui-serif`, `ui-monospace` and other family names are not system faces.

## Comparisons

- **Safari and Chrome on the phones** (`pnpm run markless:style-web-column`): the export's frames against the boxes the phone's own
  browser lays the same document out at, in device px.
- **Chrome on the Mac** (`markless:style-compare`): for Android, Chrome loads the image's font files as web fonts. Chrome on the Mac
  does not draw iOS's system faces as Safari does (other line metric rounding, Helvetica and Times metric adjustments, San
  Francisco without Core Text's tracking), so an iOS target with system faces is refused there and compared with Safari instead.

## Licence

Apple's published font licence (developer.apple.com/fonts) covers the downloadable San Francisco files, for mock-ups of Apple-platform
interfaces, without embedding. It does not address reading glyph metrics of the installed system font through Core Text at build time.
Dragon treats that position as unknown: it ships no font file and no font data, only glyph ids and positions in the export, and the
phone draws with its own installed font.

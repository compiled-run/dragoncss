# Markless counter: component CSS as native data

The first Markless native proof component (a heading and one styled button), compiled by Dragon for `ios` and `android`.

- `counter.html`: the component's element tree and CSS. Transcribed by hand from the Markless `.tsrx` until Markless hands
  Dragon its tree from its analyzer; the `data-dragon-id` values are the Markless compiler's host ids.
- `tools/export.ts` (`node --conditions=dragon-internal examples/markless-counter/tools/export.ts`): writes
  `out/counter.native-style.json`, the lowered per-backend writes for every node and each box's frame from the reference
  layout engine at the proof devices (iPhone 17 simulator, 402 pt at 3x; Pixel 7 emulator, 411 dp at 2.625), in device px.
- `tools/chrome-compare.ts`: compares those frames with Chrome's boxes at the same viewport and ratio under the device lanes'
  gate (`GATE_DEVICE_PX`). Writes `out/chrome-compare.json`. Today every box matches within 0.0005 device px.

This compares Dragon's build-time layout with Chrome. It does not compare the device's pixels; the native hosts that apply the
export live in Markless (`packages/mobile`).

## Any Markless component: `tools/markless-style.ts`

`node --conditions=dragon-internal examples/markless-counter/tools/markless-style.ts <input.json> <output.json>` reads the
style input Markless writes from its compiler's facts (`markless.native-style-input/0`: the element tree with ids and
classes, each text node's first string, the component's scoped CSS, and the boolean states that decide a class) and writes
`dragon.native-style-export/1`: per proof device, one complete node list per combination of those states, with `initial`
and the transition table `next[a][s][v]`. State keys are the Markless cell ids. Each combination is laid out as its own
element tree, in a document with no body margin and the pinned "Dragon Sans" as the initial font.

`tools/markless-style-compare.ts <input.json> <export.json> <report.json>` compares every frame of every assignment with
Chrome under `GATE_DEVICE_PX`. On the Markless ladder's rungs 2 and 4: 14 and 36 boxes, none outside 1 device px.

CSS native cannot honour yet is a build error, as anywhere in Dragon: the ladder's first rung 2 failed with
`DRAGON_UNSUPPORTED_VALUE` (a `<button>` left `inline-block`) and `DRAGON_UNSUPPORTED_FONT` (the user-agent control font).

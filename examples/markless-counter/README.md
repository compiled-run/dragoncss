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

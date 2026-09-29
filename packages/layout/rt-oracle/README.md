# rt oracle

Captured from Chrome 145.0.7632.6 (Playwright 1.58.2) by `pnpm run rt:oracle` (scripts/capture-rt-oracle.ts). Do not edit.

- `timing.json`: records `[combo, timeMs, progress, iteration]`: `getComputedTiming()` of a paused
  `new Animation(new KeyframeEffect(el, null, timing))` after `currentTime = timeMs`; `progress` and `iteration` are the
  IEEE-754 bits (hex) of `progress` and `currentIteration`, or null.
- `easing.json`: records `[easing, timeMs, progress]`, the same for each timing function over one 1000 ms iteration, `fill: both`.
- `hold.json`: records `[combo, timeMs, progress, iteration]` of animations paused at `timeMs` and read after three animation
  frames: the hold time keeps them in place while the timeline advances.
- `interp.json`: records `[case, timeMs, progress, value]`: `getComputedStyle` of
  `el.animate([{p: from, easing: keyframeEasing}, {p: to}], {duration: 1000, fill: both, easing})` paused at `timeMs`,
  on a 250.5 x 97.25 px block; `progress` is the effect progress bits.

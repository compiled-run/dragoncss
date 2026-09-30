# T096 PocketJS keyframes and yui540 (Scout findings; PM rulings)

Scratch: /tmp/sc-motion. PocketJS source is in /tmp/sc-motion/pj (MIT); yui540/css-animations is in /tmp/sc-motion/ca.

## PocketJS

- **What it compiles to.** Tailwind-shaped keyframes become per-property segment tables (styles.bin), sampled every 1/60 s tick (engine/core/src/anim.rs).
- **Where it differs from Chrome:**
  - the easing solver is f32 Newton with epsilon 1e-5 and no spline guess;
  - colour is interpolated unpremultiplied;
  - delays are rounded to 60 Hz frames;
  - `%` and `alternate` are refused;
  - it adds a non-CSS loop extension.
- **Fidelity proof.** No browser oracle. Its PNG goldens are its own output.
- **Adopt:**
  - frames as a pure function of time;
  - loud build errors for anything it can't compile;
  - exact bezier parameters for the named easings;
  - comma-list precedence;
  - attribution enforced by tests.
- **Avoid:** the numerics above, frame-rounded delays, and the loop extension.
- **Permission precedent.** apps/motions/ATTRIBUTION.md: PocketJS ported yui540.com/motions 53, 56, 30 and 64 under per-work permission, with an on-screen "(yui540)" credit. yui540.com is "© 2026 yui540" with no open licence.

## yui540

- **Licences.**
  - github.com/yui540/css-animations is MIT: 12 dated works, pure CSS/HTML.
  - Other MIT repos exist but were not inspected.
  - Kyoizon has no licence.
- **Ranked candidates:**

  | Rank | Work (date) | Needs |
  |---|---|---|
  | 1 | 糸 (04-22) | CASC |
  | 2 | 回転 (05-02) | BG2, CASC |
  | 3 | 波紋 (04-25) | BG2, CASC, TXT1 |
  | 4 | 飛び出す (04-18) | BG2, TXT1 |
  | 5 | 急ブレーキ (04-17) | 3D PNT2, TXT1 |
  | 6 | ヘッドフォン (05-14) | FX, BG2 |
  | 7 | ぴょんぴょん (04-29) | SVG |
  | 8 | いいね3 (06-07) | SVG |
  | 9 | ブックマーク3 (06-08) | FX, PNT2, SVG |
  | 10 | 猫ちゃん2 (06-09) | FX, REPL; confirm the PNG licence |

- **Features seen.** `translate(%)` everywhere; no `steps()` and no `alternate` found.

## PM rulings (research-based)

1. **Vendor MIT css-animations works only.** Keep the LICENSE text and a "(yui540)" credit, enforced by an attribution test. Never vendor yui540.com/motions.
2. **Courtesy permission.** Asking yui540 for courtesy permission, as PocketJS did, is an external action and the owner's call. The MIT licence does not require it.
3. **ANIM-b gets clean-room technique fixtures:** % translate, overshoot beziers, staggered delays, infinite loops, comma-list fills, and 3D rotate.
4. **Motion proof method** (added to ANIM-b):
   - **Clocks.** Chrome's frozen timeline (setPlaybackRate(0) plus currentTime) against the device's virtual clock. One advance(t) must equal N small steps, byte for byte.
   - **Sample times:**
     - t=0;
     - d ± 1 ms;
     - keyframe offsets ± 1 ms;
     - segment midpoints;
     - bezier steepest points and extrema;
     - iteration edges (i = 1, 2 and 1000);
     - the active end ± 1 ms, and after it;
     - pause and resume;
     - 60 Hz and 120 Hz grids.
   - **Compared at each sample:** getComputedTiming bits, getComputedStyle strings against device-applied, device-frames, and device-pixels.
   - **12 plants:** wrongEasing, phaseShift, delayDropped, delayRoundedToFrame, perKeyframeEasingIgnored, iterationOffByOne, directionIgnored, fillForwardsDropped, pauseClockRuns, percentAgainstWrongBox, colorUnpremultiplied, infiniteLoopFmodDrift. Each must fail a computed sample and move at least 1 device px.
5. **Order for real works.** 糸 after CASC; 回転 and 波紋 after BG2; the SVG, FX and REPL works wait for those packages.

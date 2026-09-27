# Owner decisions

These are recorded 2026-09-26. The owner said "take the recommendations", so each entry below is the recommendation the research made. Change any of them by editing this file and noting the date.

## Direction

- **Separate project:** Dragon CSS lives in its own repo. The npm package is `dragon`, published as `1.0.0-alpha.x` prereleases. Markless is the first user.
- **Regular CSS is the one authoring model.** On native targets, a selector may test only its own element, parents in the same component, and app-wide conditions. Anything else is a build error with a fix. StyleX-style object input is not added, unless the agent evaluation shows it helps.
- **Compile straight to native properties,** using platform mechanisms where they exist. The only on-device library is layout (Taffy, if its measurement passes). Any runtime helper Dragon needs ships as part of the generated output or a small runtime; see the API design for the exact boundary.
- **Build-time code is TypeScript.** The CSS analyzer is built in TypeScript inside Dragon, and moves into yuku (Zig) only if measurements require it. It stays internal in 1.x; only `explain()` is public.
- **Every target is a backend.** The core speaks only CSS. Backends choose among six kinds of technique: native property, Dragon-owned paint, shader, text-engine hook, build-time fold, runtime helper. They prefer proven fidelity first, then cost.

## Pitfalls handled by design (docs/research/pitfalls.md §6)

1. **Build the web preview from the compiled result** when a native target is configured. Tests also render the author's original CSS in Chrome and require the same boxes. Where an approved web change, such as `vh` becoming `dvh`, legitimately changes boxes, that change is tested against its own stated reference.
2. **Fail the type check for any configured target.** The web page keeps rendering while the developer fixes the error.
3. **Copy Chrome's built-in element styles onto native,** captured from Chrome's computed values. New projects start with a reset that applies to both platforms.
4. **Withdrawing support:** a warning period is allowed only while the old implementation is still available and still proven at the fidelity it advertised. A support row that loses its proof or its output blocks immediately, following the fail-closed rule. This is a correction from the Codex API review.
5. **Text size:** `rem` sizes follow the phone's text-size setting and `px` sizes don't. Every component is tested at the largest text size automatically. Text clipped by a fixed-height box at that size is a warning.

## Platforms (docs/research/platform-playbook.md §7.2)

6. **Minimum versions:** iOS 15, Android 10 (API 29), macOS 13, with higher tiers for newer techniques. Device share at these versions is still to be confirmed.
7. **Text strategy:** the native text engines handle breaking, shaping, fallback, right-to-left, selection, accessibility and editing. Dragon owns the line box, meaning each line's height and baseline, with Chrome's rounding, set through each engine's per-line hooks.
8. **Expensive techniques are allowed,** such as paint islands, snapshot blur and live backdrop blur. Every use is listed in the build summary.
9. **Scroll snap counts as "caveat"** when snap positions match Chrome and the motion is native.
10. **macOS stays in the model and the support profile now.** It is built after iOS and Android.
11. **First platform:** iOS with UIKit views, then Android. Email is a parallel, low-cost track. The web view shell is only a fallback for individual screens.

## Testing (docs/research/testing-plan.md)

12. **The tests live in the Dragon repo.** Markless runs a smaller set of its own components through them.
13. **Tolerance:** boxes must match within one physical screen pixel. Text-heavy tests may carry a measured allowance that is written into the test. Tolerances change only with owner approval.
14. **The iPhone simulator lane starts report-only.** It becomes blocking after two weeks without unexplained failures.
15. **No paid email-client screenshot service** until the email target is being built.

## API (docs/api.md)

16. **Framework source readers:** frameworks provide their element trees first. Optional Dragon-maintained source readers (TSRX, JSX, HTML) come after milestone 1.
17. **Changing style values:** the first release supports a known set of states, such as on/off or open/closed. Arbitrary changing numbers, like progress from 0 to 1, come later with their own rules and tests.
18. **Bundled fonts** use shared line heights and baselines on web and native, adopted only after tests prove the differences they cause are explained.
19. **Minimum versions in configuration** default to decision 6. Projects only state them to raise the floor.
20. **Researched defaults in `docs/api.md`:** public lookups are limited to `explain` and support queries in milestone 1. The interface for adding platform implementations stays private until several Dragon implementations pass their tests.

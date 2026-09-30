# T049: FORM-0, control data and value model (Worker note)

Worker note, 2026-09-28. Binding spec: notes/T045-repl-form-spec.md §3 P2, with rulings R11 to R15.
- Worktree `/tmp/dragon-form0`, branch `form0-control-data`.
- BASE is master 41cc750. The branch has one local commit (sha in the receipt). Nothing was pushed.

## What landed

| File | What it is |
|---|---|
| `scripts/capture-form-data.ts` | Chrome 145.0.7632.6 capture through the imported `launchChrome`/`openPage`, with CDP. Supports `--check` and `--plant thumb-unmirrored\|step-tie-down\|devolve-ignored`. |
| `packages/dragon/src/forms/decimal.ts` | A port of Blink `Decimal` (platform/wtf/decimal.cc): 18-digit coefficient; Blink's Round, division rounding and ToString. |
| `forms/range-value.ts` | Range value sanitisation, default value and ratio (range_input_type.cc, step_range.cc/.h, html_parser_idioms.cc). |
| `forms/range-geometry.ts` | Thumb offset (block_layout_algorithm.cc `AdjustSliderThumbInlineOffset`), rtl mirror, and LayoutUnit truncation helpers. |
| `forms/button-inner.ts` | The button content model and its block centring shift (see ruling F1). |
| `forms/appearance.ts` | The devolve rule (layout_theme.cc `IsControlStyled`), extended with the range thumb's own appearance (ruling F3). |
| `forms/appearance.generated.ts` | The R11 probe table, with the Blink citation. |
| `forms/ua-shadow.generated.ts` | UA rules of the range container, track and thumb (from `CSS.getMatchedStylesForNode`, user-agent origin), plus the themed thumb size (16x16) and the size of a `none` thumb. |
| `forms/compare.ts`, `faults.ts`, `index.ts` | The comparison shared by the script and the test, and the three planted faults. |
| `packages/dragon/test/forms/chrome-145/*.json` | range-value (6300 rows), range-geometry (348 cases), button (1296 cases), devolve (9 cases at DPR 2). |
| `packages/dragon/test/forms/forms.test.ts` | 14 tests (details below). |

The 14 tests prove:
- N/N equality with Chrome;
- each fault flips at least one comparison;
- the button matrix tells the two models apart;
- the R11 table;
- the UA shadow pins;
- Decimal and value unit cases.

`--check` results, all at 0 LU:

| Comparison | Result |
|---|---|
| range-value | 6648/6648 (6300 matrix rows plus 348 geometry cases) |
| range-geometry | 696/696 (thumb x and thumb y for each of the 348 cases) |
| button-inner | 1728/1728 child rects |
| appearance | 9/9 |

Plants: `thumb-unmirrored` gives 145 mismatches, `step-tie-down` 415 and `devolve-ignored` 2. Each exits 1.

The capture is byte-stable: two runs and `--check` produce identical output. A full capture takes about 2 s.

**CDP `pierce:true` exposes the user-agent shadow root** as `#document-fragment` with shadowRootType `user-agent`. Its structure is:
- the container: a div with no id;
- the track: a div with pseudo `-webkit-slider-runnable-track` and id `track`;
- the thumb: a div with id `thumb`.

`DOM.getBoxModel` works on all three, so the stop_if about unexposed shadow nodes does not apply.

## Rulings (decision-by-research; Blink sources read at tag 145.0.7632.6 through the GitHub chromium mirror)

**F1. R12's button "anonymous inner box" is outdated for Chrome 145. The reference follows the current Blink rule.**

Evidence from the Blink source:
- `html_button_element.cc:59-74`: `CreateLayoutObject` returns an ordinary container for display flex, inline-flex, grid, inline-grid, grid-lanes and layout custom. For every other display it returns a plain `LayoutBlockFlow`.
- `layout/forms/layout_button.cc` no longer exists, and neither does `UpdateAnonymousChildStyle`.
- The centring comes from `html.css:435-438`, `button { -internal-align-content-block: center }`.
- `block_layout_algorithm_utils.cc:185-203` (`AlignBlockContent`) applies it: contents move by free space / 2, with free space clamped at 0 for buttons (safe). This check comes before the author's `align-content`, so an author `align-content` does not change it.

Measured in Chrome 145:
- A block button with `flex-direction: column` still centres its contents, so no flex properties are copied.
- A `display:flex` button with `align-items: flex-start` and `min-height` puts its children at the top, so there is no inner box.
- A 15px button with 18px of content puts it at offset 0 (the safe clamp).
- 60.046875px gives an offset of 25.015625, the truncating LayoutUnit half.

The reference model is `buttonContentModel(display)`: `container` or `block-centred`, plus `buttonContentShift`. FORM-a should implement the button as a block container with this safe shift, or as the flex or grid container it is. There is no anonymous box. This is a refinement of R12 after the Blink re-check, not a Chrome/reference disagreement, so it is not a stop.

**F2. The range value model is Blink's, and it follows HTML with these specifics:**
- The step base is the `min` attribute, else the `value` attribute, else 0 (`InputType::FindStepBase`).
- A max below min becomes min (`EnsureMaximum`), so `min=50 max=10` gives the value 50.
- `step="any"` means no stepping. An invalid, 0 or negative step means 1.
- A tie rounds away from zero (`Decimal::Round`, first dropped digit). Values of at least `min` always tie upward.
- Arithmetic is decimal: 0.1 x 3 is exactly 0.3. The serialisation is Blink's, so `value="1e1"` reads back as `"1e+1"`.

The matrix is captured from parsed markup (`innerHTML`, attributes in the order type, min, max, step, value). The reason: with script-built inputs, `setAttribute('max', …)` after `type=range` re-sanitises an already stored non-dirty value (`SanitizeValueInResponseToMinOrMaxAttributeChange`). That makes `max=10` with no value read `"10"`, where markup gives `"5"`. Dragon compiles markup, so markup order is the model. Script-time attribute mutation belongs to FORM-a's typed value event work and is out of scope here.

**F3. R11 for range needs the thumb's own appearance.**
- html.css at Chrome 145 gives `::-webkit-slider-thumb { appearance: auto }`, not `inherit`.
- An input with `appearance:none` therefore still gets a themed thumb (the probe's centre pixel is #0075ff).

The probe table (appearance.generated.ts) is:

| Control | Author styles | Result |
|---|---|---|
| button | none | theme |
| button | background-color | css |
| button | border | css |
| button | appearance-none | css |
| range | none | theme |
| range | background-color | theme |
| range | border | theme |
| range | appearance-none (input and thumb) | css |
| range | input-none-thumb-auto | theme |

This agrees with R11 ("the thumb and track take their own appearance"). FORM-a's fixtures and the demo must set `appearance:none` on `::-webkit-slider-thumb`. The demo does.

The probe works like this:
- Each control is compared at 11 device-pixel points (centre, outer and inner border rows, corners) against a div twin with the control's computed background, border and radii.
- `css` means every point is equal. Themed buttons differ at every border point: the theme draws a 1px #767676 rounded border on #efefef, where the CSS twin draws a 2px outset border.

**F4. What the thumb geometry covers.** For a thumb with zero inline margins:
- ltr: `thumb.x = track content x + LayoutUnit(ratio x (track content width − thumb width))`;
- rtl: `thumb.x = track content right − thumb width − offset`;
- `thumb.y = track content top`.

The details:
- `LayoutUnit(double)` truncates.
- The ratio is `Decimal.ToDouble` of (value − min)/(max − min), and 0 when min = max.
- This holds for appearance auto, none and inherit on the input and thumb.
- It holds for themed and author thumb sizes, and for input width, height, padding, border and box-sizing, and track height, padding and border.

Container and track placement are the engine's normal flex layout of the UA shadow styles. FORM-a proves them with the same captured boxes, which are already in range-geometry.json.

## Deviations from the P2 text (inside allowed_files)

1. `button-inner.ts` models F1 (content model plus safe shift), not an anonymous inner-box style.
2. Range devolve sets: `appearance-none` sets none on the input and the thumb, and a range-only set, `input-none-thumb-auto`, was added (F3).
3. The range value matrix is built from parsed markup (F2).
4. `src/forms` uses `truncate(x) = x - x % 1` and `divLU`, not `Math.trunc`. The reason is that `packages/dragon/test/ua.test.ts` and `s4b.test.ts` forbid `Math.(round|floor|ceil|trunc|fround)` in `src/**` outside `css/color.ts` and `src/fonts/**`. Those test files are outside allowed_files, so they were not retargeted.
   - This is LayoutUnit arithmetic ported from Blink, the same reason `src/fonts/**` is exempt by path.
   - **Integrator/PM: consider adding a `src/forms/` path exemption** (or moving the helpers into the layout package at FORM-a) rather than relying on the `%` form.
5. The script carries its own 40-line screenshot PNG decoder. The parity tsconfig typechecks `scripts/`, and `packages/wpt/src/png.ts` is outside that project, so it cannot be imported. `playwright` types are derived from `launchChrome`/`openPage`, because `playwright` is not resolvable from `scripts/`.

No existing file changed. No pinned test was retargeted.

## R14 interaction conventions (evidence only)

**iOS:**
- **UIControl touch tracking.** `beginTracking/continueTracking/endTracking` give `.touchUpInside` only while the touch stays inside the control's bounds plus the system retention margin, and `.touchUpOutside` / `.touchCancel` on drag-out or system cancel. Sources: https://developer.apple.com/documentation/uikit/uicontrol and https://developer.apple.com/documentation/uikit/uicontrol/event/touchupinside
- **Accessibility traits.**
  - `UIAccessibilityTraitButton` is documented at https://developer.apple.com/documentation/uikit/uiaccessibilitytraits/button
  - `.adjustable` requires `accessibilityIncrement()`/`accessibilityDecrement()`: https://developer.apple.com/documentation/uikit/uiaccessibilitytraits/adjustable
  - `accessibilityValue` is at https://developer.apple.com/documentation/objectivec/nsobject/1615117-accessibilityvalue
- **Gesture arbitration.** `gestureRecognizerShouldBegin(_:)` lets the range decline to begin unless the pan is mainly horizontal, so the enclosing UIScrollView keeps vertical scrolls: https://developer.apple.com/documentation/uikit/uigesturerecognizerdelegate/gesturerecognizershouldbegin(_:)
- **Haptics.** UISlider and UIButton produce no haptic by default. `UIFeedbackGenerator` is opt-in: https://developer.apple.com/documentation/uikit/uifeedbackgenerator

**Android:**
- **Clicks.** `View.setClickable` with `performClick()` plays the click sound through `playSoundEffect(SoundEffectConstants.CLICK)` when sound effects are enabled. Touch slop (`ViewConfiguration.getScaledTouchSlop`) cancels the pressed state once the pointer leaves the view. Sources: https://developer.android.com/reference/android/view/View#performClick() and https://developer.android.com/reference/android/view/ViewConfiguration#getScaledTouchSlop()
- **Parent interception.** `ViewParent.requestDisallowInterceptTouchEvent(true)`, after slop with |dx| > |dy|, stops a parent ScrollView from stealing the drag: https://developer.android.com/reference/android/view/ViewParent#requestDisallowInterceptTouchEvent(boolean)
- **Accessibility.** `AccessibilityNodeInfo.setClassName("android.widget.SeekBar")`, `RangeInfo.obtain(RANGE_TYPE_FLOAT, min, max, current)`, `AccessibilityAction.ACTION_SET_PROGRESS`, and `ACTION_SCROLL_FORWARD/BACKWARD` match AbsSeekBar's own node. `android.widget.Button` is the class name TalkBack announces as "Button". Sources: https://developer.android.com/reference/android/view/accessibility/AccessibilityNodeInfo.RangeInfo and https://developer.android.com/reference/android/view/accessibility/AccessibilityNodeInfo.AccessibilityAction#ACTION_SET_PROGRESS
- **Keyboard.** Hardware keyboard DPAD_CENTER, ENTER and SPACE activate a clickable, focusable View via `KeyEvent.isConfirmKey`: https://developer.android.com/reference/android/view/KeyEvent#isConfirmKey(int)
- **Haptics.** SeekBar performs no haptic feedback by default.

**Web semantics of the range (Chrome, R14 "tap jumps then drags").** `RangeInputType::HandleMouseDownEvent` calls `thumb->DragFrom(point)` for any press on the input or its shadow nodes other than the thumb itself (range_input_type.cc:173-194). A press on the track therefore jumps the value, then drags.

**Missing evidence (unchanged from T045):** the iOS real-touch path (XCUITest). None of these conventions was exercised on a device in FORM-0.

## Verification

The P2 verify list was run in worktree `/tmp/dragon-form0` at commit 13523e4 (the tree is identical to fe53de4; only the commit message was amended).

| Verify | Result |
|---|---|
| 1. install, typecheck, test | install and typecheck green. See the timeouts below. |
| 2. two captures, then `git diff --exit-code` | exit 0 |
| 3. `--check` | exit 0: range-value 6648/6648, range-geometry 696/696, button-inner 1728/1728, appearance 9/9 |
| 4. three plants | each exits 1 |
| 5. `parity:capture` and `north-star:check` | no diff (north-star 123/291 declarations, 33/62 elements, unchanged) |
| 6. changed files and remotes | the diff is only the 16 allowed files. `git remote -v` shows `origin` (github compiled-run/dragoncss). That remote was already configured in the shared repo. Nothing was added or pushed. |

**Test timeouts under load (throughput rule).** Load averages were 30 to 80.

The full `pnpm test` run was 69 files green, 1519 tests passed and 6 timed out at 120 s. The timeouts were in dist, lanes, native-compare, native-host and parity.test.ts.

Rerunning those 5 files:
- With `--testTimeout=900000`: 280/280 passed.
- At the default timeout: 279/280. Only the parity determinism test (S5 (c)) still timed out at 120 s.

**At BASE 41cc750, the same file at the same load gives the same result:** 236/237, with the determinism timeout at 120 s. That test does not import `src/forms` (nothing in the compiler, parity or lanes does). It is a load timeout, not a change from this branch.

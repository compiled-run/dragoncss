# North-star app: the Markless music player

Dragon's north-star screen (docs/decisions.md, "Course corrections", item 4). It must eventually run end to end on iPhone and
Android and be verified visually against Chrome, and against WPT where tests exist. [GAPS.md](GAPS.md) maps every CSS feature,
element, selector and at-rule the screen uses to its Dragon status, its implementation route on iOS and Android, and its proof.

## Source

| | |
|---|---|
| Repository | Markless, local checkout `/Users/jacksm5pro/dev/open-source/markless` (read-only; nothing in Markless was edited) |
| Demo | `demos/music-player-ssr`: `src/styles.css`, `src/components/*.tsrx`, `pages/index.tsrx`, `src/data.ts` |
| Markless HEAD | `7da890b4db72341cc0f41d5f72f6360eb73ab807` (`git -C markless rev-parse HEAD`) |
| Last commit touching the demo | `9d324340c2bfc5df5c868bbe5910b844d10cdd2d` (2026-09-25) |
| Licence | MIT, Copyright (c) 2026 Jack Shelton. The full text is in [LICENSE-markless](LICENSE-markless) and applies to `styles.css` and the markup in `snapshot.html`. |

## Files

| File | What it is |
|---|---|
| `styles.css` | The demo's `src/styles.css`, copied verbatim: 557 lines, sha256 `df2541474405c49ba6954dd42d4866a288912efaaaf7f2438342b6bbeec0dc4c`. |
| `snapshot.html` | A static snapshot of the rendered element tree in the main state: library closed, paused, track one selected, with the real data from `src/data.ts` inlined. It links `styles.css` the way the demo's `document.tsrx` does. |
| `tools/snapshot.ts` | Reads the snapshot. Derives the other two screen states by exact, counted class and text edits, and the four free states (`FREE_STATES`, `freeStateHtml`) by composing them. Converts the snapshot to the parity fixture HTML subset. |
| `tools/css-inventory.ts` | Lists every declaration (with its span, rule and at-rule) and every feature the stylesheet uses, with use counts. |
| `tools/lane-manifest.ts` | The north-star device lane's case manifest: the platform matrix and the derived case list. |
| `tools/lane-states.ts` | The DOM class and text edits that turn one free state into another, diffed from the two state snapshots. |
| `tools/cover-png.ts` | The dependency-free generator of the 1280x720 PNG cover stand-ins. |
| `tools/capture-chrome.ts` | Renders the Chrome reference of the lane (`pnpm run north-star:capture`). |
| `tools/check.ts` | Runs the Dragon check (`pnpm run north-star:check`). |
| `lane/manifest.json` | The lane manifest written out: matrix, cases and per-platform, per-DPR counts. |
| `covers/<videoId>.png` | The cover stand-ins, committed so native apps bundle the exact bytes Chrome decoded. |
| `chrome/<platform>/dpr-<d>/` | Per case: the viewport PNG and the JSON dump. `chrome/pixel-manifest.json` lists every file with its sha256. |
| `dragon/north-star-check.json` | The Dragon check output. It is deterministic: no timestamps or host data, and byte-identical across runs. |

### How the snapshot was made

The tree was transcribed by hand from `pages/index.tsrx` and the components, with the JSX whitespace rules applied: there is no
whitespace between elements, and multi-line text is collapsed to single spaces. The demo's SSR was not run, because running it
would write Vite caches into Markless. Line breaks in `snapshot.html` fall inside tags (`<div\n>`), so they add no text nodes.

What was stripped or changed:

- **The YouTube iframe.** The demo's `youtube-controller.ts` loads the IFrame API and swaps `.youtube-player-target` for an
  `<iframe>`. The snapshot keeps `.youtube-player-target` empty as the **video placeholder**. Its box is exactly the iframe's
  box: `.youtube-player-target` and `.youtube-player iframe` share one rule (`display: block; height: 100%; width: 100%`). It
  fills the 16:9 `.mini-video-shell` inside its 1px border: 358x200.5 CSS px at 390 wide.
- **All scripts.** That covers the controller, the router scripts, the hydration and the `onClick` handlers. The `attach`,
  `onClick` and `onToggleLibrary` props render no attributes.
- **The data attributes the controller reads are kept as SSR renders them:** `data-video-id`, `data-color-start` and
  `data-color-end` are string values. `data-playing="false"`, `data-command="cue"` and `data-command-version="0"` are the
  initial state values. How Markless serialises the boolean `data-playing` was not verified.
- **The controller's inline styles are not applied.** It sets `.track`'s background to the same gradient the stylesheet gives
  track one, and sets `.animate-track`'s `translateX(0%)`, which equals the stylesheet value in the paused state. So the
  snapshot is visually identical without them.
- **Cover images.** They keep their real `https://i.ytimg.com/.../maxresdefault.jpg` URLs. Captures serve a deterministic
  1280x720 PNG stand-in in the track's two colours (`covers/<videoId>.png`, from `tools/cover-png.ts`), which has the
  thumbnail's intrinsic size and aspect ratio. YouTube thumbnails are not committed.

### Screen states

| State | Change (as the components make it) |
|---|---|
| `main` | The snapshot as written. |
| `library-open` | `libraryStatus = true`: `.App.library-active`, `.library.active-library` and `.library-button.active`. |
| `playing` | `isPlaying = true`: `.record.rotating`, `.play.active` and the pause icon `❚❚`. |

## North-star device lane: the Chrome side (`pnpm run north-star:capture`)

The lane itself (the native hosts, the runner and the four NS lanes per target) is NS-LANE, after P5. This directory holds its
case manifest and its Chrome oracle. Nothing here needs Dragon output.

### Matrix

Each root is a fixed CSS viewport. The device runner stops rather than crop.

| Platform | Viewport (CSS px) | DPR | PNG (device px) |
|---|---|---|---|
| iOS | 390x844 | 2, 3 | 780x1688, 1170x2532 |
| Android | 412x915 | 2, 2.625, 3 | 824x1830, 1082x2402, 1236x2745 |

### Cases

`tools/lane-manifest.ts` derives the cases, and `lane/manifest.json` records them. There are 20 cases per platform and DPR, 100
captures in all:

- **Free states** (8): `libraryStatus` x `isPlaying` (`main`, `library-open`, `playing`, `library-open-playing`), each at
  scroll top and at scroll end (`<state>-top`, `<state>-end`).
- **Forced states** (5): one per `:hover` or `:focus` selector in `styles.css`: `.library-button`, `.play-control button`,
  `.library-song`, `.youtube-disclosure a` and `input[type='range']`. These are captured in the steady state at scroll top,
  in `main`, except `.library-song`, which is captured with the library open (`FORCED_BASE_STATE`).
  - The pseudo-class is forced with CDP `CSS.forcePseudoState`, and the transitions it starts are finished.
  - The target is the first subject match whose declared properties change under the pseudo-class. If no match changes, the
    first match is used. The dump records the target and whether it changed.
  - The first `.library-song` is `.selected`, whose background wins over `:hover`, so the target is `library-song-2`.
  - `input[type='range']:focus` only sets `outline: none`, so it changes nothing (`changed: false`).
- **Frames** (7):
  - `album-spin` paused and playing, at 0 ms and 5000 ms;
  - the library transition opening and closing, at 250 ms;
  - playing until 5000 ms, then paused, read at 6000 ms. This shows the paused phase: the record is still at 90deg.

### Deterministic frames

- **Virtual clock.** Before the page loads, CDP `Animation.setPlaybackRate(0)` stops the document timeline. After load,
  every animation is paused at `currentTime` 0. After that, time moves only by setting `currentTime`:
  - running CSS animations (by their computed `animation-play-state`) and all transitions advance by the step;
  - a state change is applied as the class and text edits of `tools/lane-states.ts`, and the transitions it starts are held
    at 0.
- **Why the timeline is stopped.** Without it, a spinning record that was composited even briefly rasterizes differently
  from run to run.
- **Byte-identical runs.** Two consecutive captures are byte-identical: PNGs, dumps and manifests.

### Per capture

- **`<case>.png`:** the viewport, from CDP `Page.captureScreenshot` with `captureBeyondViewport` false. There is no
  full-page capture, because resizing the viewport changes every `vh` value.
- **`<case>.json`** (`dragon-north-star-lane-chrome/1`) contains:
  - for every `data-dragon-id` element: `getBoundingClientRect` and the computed value of every property the stylesheet uses,
    plus the core longhands (`values` in `properties` order);
  - for every text node (ids as in the parity captures, `<id>:text<k>`): its line rects, and each line's `start` and `end`
    offset in UTF-16 units. This is P5's method: single-code-unit Range rects grouped by line, where a code unit with no rect
    joins the current line, so the lines partition the text;
  - the platform fonts per element, from CDP `CSS.getPlatformFontsForNode`;
  - the clock of every animation and transition, the scroll position, the `:root` custom properties, and the forced target.

### Pixel manifest (`chrome/pixel-manifest.json`)

The manifest records:

- the Chrome version and the Playwright version;
- the host;
- the flags per DPR: `chromeArgsAt(d)` from `packages/parity/src/chrome.ts`, unchanged;
- the zoom-guard value per DPR;
- the context options;
- the sha256 and size of every PNG and dump;
- the cover stand-ins with their sha256;
- the case counts;
- the raster rule;
- the font key.

**Raster rule.** A PNG side is `ceil(css px x DPR)`. The non-integral Android root, 412 x 2.625 = 1081.5, rasterizes to 1082,
and 915 x 2.625 = 2401.875 rasterizes to 2402. The rule is checked on every committed PNG.

**Font key and staleness.** The font key is the sha256 of the sorted, distinct platform fonts that Chrome rendered text with
(family, PostScript name, custom or not).

- `font-family: 'Lato', sans-serif` names a font the demo never loads, so Chrome uses the host's `sans-serif`. On the darwin
  capture host that is Helvetica, with LucidaGrande and ZapfDingbatsITC as fallbacks for the symbols.
- A native lane build whose font key, or whose cover stand-in sha256, differs from this manifest is comparing against a
  **stale** reference. A stale reference counts as a failure, never a pass.
- The key changes when TXT1-C pins the `sans-serif` face and the reference is re-captured with it.

### Test

`packages/parity/test/north-star-reference.test.ts` checks the following without Chrome:

- the committed reference matches the manifest: the case list is the derivation, and every listed file is present, with
  nothing else under `chrome/`;
- every sha256, PNG size and dump identity;
- the line-offset partition;
- the font key;
- the cover PNGs regenerate byte-identically and decode to the generator's pixels.

### Size

The reference is about 27.7 MB: 100 PNGs plus dumps, and 0.16 MB of covers.

## Dragon check (`pnpm run north-star:check`)

- **Pipeline:** the snapshot goes through the parity fixture reader (`fixtureToInput`), exactly as HTML parity fixtures do.
  The public `createProject` compiles it with targets `web` and `ios` (minimum `'15.0'`). Android is not public until P4.
- **Why three passes:** Dragon treats every target-less error as fatal to the per-case analysis. On this screen that hides the
  contextual, font and at-rule diagnostics. The check therefore runs three offset-preserving passes (authored, at-rules
  unwrapped, context probe), described at the top of `tools/check.ts`.
- **Output:** the command prints the diagnostic count, the declaration support percentage and the element count, and writes
  `dragon/north-star-check.json`.

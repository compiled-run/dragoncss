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
| `tools/snapshot.ts` | Reads the snapshot. Derives the other two screen states by exact, counted class and text edits. Converts the snapshot to the parity fixture HTML subset. Serves the cover stand-ins. |
| `tools/css-inventory.ts` | Lists every declaration (with its span, rule and at-rule) and every feature the stylesheet uses, with use counts. |
| `tools/capture-chrome.ts` | Renders the Chrome reference (`pnpm run north-star:capture`). |
| `tools/check.ts` | Runs the Dragon check (`pnpm run north-star:check`). |
| `chrome/<device>/` | Chrome screenshots and per-element box dumps. |
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
  1280x720 SVG stand-in in the track's two colours (`coverStandIn`), which has the thumbnail's intrinsic size and aspect ratio.
  YouTube thumbnails are not committed.

### Screen states

| State | Change (as the components make it) |
|---|---|
| `main` | The snapshot as written. |
| `library-open` | `libraryStatus = true`: `.App.library-active`, `.library.active-library` and `.library-button.active`. |
| `playing` | `isPlaying = true`: `.record.rotating`, `.play.active` and the pause icon `❚❚`. |

## Chrome reference (`pnpm run north-star:capture`)

- **Chrome build:** the pinned parity build, Chrome 145.0.7632.6 from Playwright 1.58.2 (chromium-1208), through
  `packages/parity/src/chrome.ts`, with the lane's flags at `--force-device-scale-factor=N`. The lane's zoom guard runs before
  each device.
- **Devices:** `iphone-390x844-dpr3` and `android-412x915-dpr2.625`, both with `isMobile`, `hasTouch` and `colorScheme: dark`.
- **Network:** closed. Only the page, `styles.css` and the cover stand-ins are served.
- **Screenshots:** for each device and state, `<state>.png` is the viewport at scroll 0 and `<state>-bottom.png` is the viewport
  scrolled to the end. There is no full-page capture, because full-page screenshots resize the viewport, which changes every
  `vh` value.
- **Animations:** disabled in screenshots, so the spinning record is at its start frame.
- **Box dumps:** `<state>.boxes.json` holds, for every `data-dragon-id` element, its `getBoundingClientRect`, the client rects
  of its text lines, and the computed value of every property the stylesheet uses plus core layout longhands. The `:root` custom
  properties are dumped as well.

The fonts are host-dependent. `font-family: 'Lato', sans-serif` names a font the demo never loads, so Chrome uses the host's
`sans-serif`. The committed captures come from a darwin host (Helvetica). A native comparison needs one pinned open font for
both sides. See GAPS.md, section 1.

## Dragon check (`pnpm run north-star:check`)

- **Pipeline:** the snapshot goes through the parity fixture reader (`fixtureToInput`), exactly as HTML parity fixtures do.
  The public `createProject` compiles it with targets `web` and `ios` (minimum `'15.0'`). Android is not public until P4.
- **Why three passes:** Dragon treats every target-less error as fatal to the per-case analysis. On this screen that hides the
  contextual, font and at-rule diagnostics. The check therefore runs three offset-preserving passes (authored, at-rules
  unwrapped, context probe), described at the top of `tools/check.ts`.
- **Output:** the command prints the diagnostic count, the declaration support percentage and the element count, and writes
  `dragon/north-star-check.json`.

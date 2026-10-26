# App screens

Five screens written the way an app developer would write them for Dragon: plain HTML and one stylesheet each, with custom
properties, flex and grid, safe-area insets, `:active` and `:focus` states, transitions, shadows, radii, images and fonts. No
`:hover` (touch screens have none). They are fixtures for lanes: compile them, see what refuses, fix it, compile again.

| Screen | What it exercises |
|---|---|
| `pages/onboarding.html` | `@font-face` brand font, gradient background, image with shadow, page dots, pressed buttons, `:focus-visible` |
| `pages/settings.html` | grouped lists, toggles (`input[type=checkbox]` with `appearance: none`, `::after` knob, `:checked`), sticky blurred app bar, dark mode, ellipsis |
| `pages/signup.html` | text, email and password inputs, `select`, checkbox, `::placeholder`, `:focus`, `:invalid`, `:disabled`, `accent-color` |
| `pages/article.html` | long-form text in a declared face, bold and italic, `blockquote`, `code` and `pre`, `figure`, `ch` measure, sticky header |
| `pages/feed.html` | scroll-snapped chips, cards with images and avatars, `-webkit-line-clamp`, image grid, fixed tab bar, `::after` badge |

## The check

`pnpm app-screens` prints `N of 5 screens compile on iOS / M of 5 on Android`, then each screen's remaining refusals grouped
into blockers. It reports and never fails: no screen compiles natively yet. A screen compiles on a target when its authored
input has no error for that target.

## Tools

- `tools/check.ts` compiles every screen through the public `createProject` (web, iOS 15, Android 31, with Dragon's recommended
  font map) and writes every diagnostic to `out/<screen>.json`. A target-less error stops Dragon's per-case analysis, so the
  check neutralises what each target-less error names (blanks the declaration or rule, retags an unsupported element as a div,
  drops an unsupported attribute) and compiles again until none is left. It also writes `out/<screen>.ahem.json`, the same
  screen with every font set to Ahem, to show what is left once real fonts are accepted natively.
  `pnpm app-screens [--ahem] [screen ...]` (the Ahem run is written only with `--ahem`)
- `tools/blockers.ts` groups the iOS errors into blockers and ranks them by how many screens they break.
  `node examples/app-screens/tools/blockers.ts [authored|ahem]`
- `tools/shoot.ts` renders the Chrome 145 reference at 390x844 (DPR 3) and 412x915 (DPR 2.625) into `out/chrome/`.
  `CHROME=<chrome-headless-shell 145.0.7632.6> node examples/app-screens/tools/shoot.ts`

`tools/page.ts` reads a screen into the parity fixture subset: it gives every element a `data-dragon-id` and boolean attributes an
explicit empty value. Images are the music player's cover stand-ins, copied to `pages/img/`.

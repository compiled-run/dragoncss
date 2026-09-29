# Dragon CSS homepage drafts: shared brief

**Concept (owner):** the homepage is a message on a scroll, addressed to the reader, for example *"Dear Lord Developer, ..."*. The mood is Camelot: King Arthur, Merlin, the Round Table. It is interactive, so visitors stay engaged. The letter makes the claims, and the interactive pieces let the reader test them.

## Shared assets (read-only for variant builders)

- **`assets/parchment.css`**: the parchment recreated from the owner's reference sheet (`assets/icon-sheet.png`).
  - `.sheet` is a torn piece of parchment. Add `.gridded` for the faint grid with star marks.
  - `.rod` is a rolled scroll end.
  - Colour variables: `--ink`, `--brick`, `--gold`, `--sage`, `--slate`.
  - Font variables: `--display`, `--text`, `--mono`.
  - `.ink-in` animates ink onto the page. Set `--ink-delay` and `--ink-dur` per element.
  - `.seal-badge` has `.caveat` and `.unsupported` variants.
- **`assets/parchment.js`**: include once per page. It injects the `#deckle` torn-edge filter and the `#ink-bleed` filter.
- **`assets/icons/*.png`**: 25 hand-inked icons with transparent backgrounds: dragon, crown, shield, banner, scroll, sword, helm, castle, spellbook, potion, laurel, letter, hourglass, compass, torch, chest, map, scales, branch, egg, moon, sun, cloud, mountains, tower.

## Fonts

The final font is still being researched. Always use `var(--display)` and `var(--text)` so it can be swapped in one place. Code and numbers always use `var(--mono)`.

Do NOT use any of these; the owner rejected them:
- Jacquard, Grenze, Unifraktur, Uncial Antiqua;
- Fondamento, Eagle Lake, Almendra, IM Fell;
- Cinzel, Alegreya, Cormorant, Garamond;
- MedievalSharp, Macondo, Elsie, Pirata, Texturina, Kurale.

## Real facts you may state

These come from milestone 1 and are true. Don't invent other numbers.

- Regular CSS is compiled at build time into native view properties. It is proven against Chrome, number by number, never by screenshots.
- Dragon has its own TypeScript layout engine (block, flex, text, positioning, right-to-left).
- 137 test fixtures and 258 cases pass. 8,671 of 8,671 boxes match Chrome exactly, to 1/64 px. 339,080 computed values are identical between the author's CSS and Dragon's output.
- Support labels are `exact`, `caveat` and `unsupported`. Nothing is marked supported without a passing test.
- Current work (milestone 2): iOS and Android at parity. Native engines are generated from the one TypeScript engine, and each device lane is checked against Chrome.
- Install: `npm install dragon`. The package isn't published yet; mark it "coming soon" if shown.

**Interactive demos** that don't run the real compiler must say so in small type, for example *"illustration"*. Never fake a claim.

## Page requirements

- **Files:** each variant is one self-contained HTML file at `design/homepage/<nn>-<slug>.html`. It links `assets/parchment.css`, `assets/parchment.js` and the icons by relative path.
- **Dependencies:** none. No external JS. Google Fonts are not allowed (see Fonts above).
- **Letter copy:** open with a salutation such as *"Dear Lord Developer,"*, in light old-English flavour that stays readable. Keep the letter short: under 180 words. Sign it, for example, *"By the hand of the Dragon, Keeper of the Styles"*, with a wax seal.
- **Required elements:**
  - at least one engaging interaction;
  - a visible "skip the ceremony" link (`.skip`) that goes to a plain summary section;
  - `prefers-reduced-motion` respected;
  - a readable mobile layout (single column below 760px).
- **Ink animation:** use it for the letter, with `.ink-in` or better (for example, word-by-word or line-by-line writing).
- **Verify before finishing:** screenshot each page with `node /tmp/shot.mjs "file://<abs path>" /tmp/<slug>.png 1280 900`. Also take a mobile shot at 390 wide. Look at both, fix what's broken, and iterate until it looks good.

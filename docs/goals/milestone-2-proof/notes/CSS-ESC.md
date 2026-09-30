# CSS-ESC: decode CSS escapes as Chrome 145 does

Branch `css-esc` (worktree /tmp/dragon-css-esc), from origin/master 1211f422. Source: the CSS-ESC proposal in T113-grid-g0.md and the #24 audit (escaped ids and attributes refused).

## What changed

- **New `packages/dragon/src/css/escapes.ts`** (tokenizer level):
  - `decodeName` implements css-syntax-3 §4.3.7.
  - `serializeIdentifier` implements CSSOM "serialize an identifier". It moved here from grid-values.ts.
  - `preprocessInput` does the in-place preprocessing: U+0000, and an escape at the end of the input.
  - `canonicalizeEscapes` rewrites a css-tree tree once, before any keyword or grammar matching. Each identifier, function name, unit, hash name, selector name and attribute flag becomes the serialization of its decoded value. The walker is iterative.
- **`stylesheet.ts`**:
  - Preprocesses the input and canonicalizes each tree, only when the text holds a backslash. This covers stylesheets and substituted values.
  - Decodes property names (`\63 olor`), custom property names (`--\61` is `--a`) and `!\69mportant`.
  - Reports a literal U+0000 (see the rulings).
- **`variables.ts`**: a `var()` reference names the decoded identifier (`var(--\61)`, `var(\2d\2d a)`).
- **`selectors.ts`**: classes, ids, type names, attribute names, values and flags are decoded. An escaped `\|` in an attribute name is not a namespace separator.
- **`values.ts`**: a one-identifier `font-family` is the decoded family name.
- **Refusals removed:**
  - #22: escaped custom property names, in declarations and in `var()`.
  - #23: the grid hook's `escaped()` refusal for escaped function names, units and keywords.
  - #24: escaped `#id` and attribute selectors.

## Rulings

1. **Canonical form.** The canonical form of a name is the CSSOM serialization of its decoded value. Keywords therefore match as plain text, and custom idents and line names keep a valid serialization (`[\31 foo]`, `[\61 bc]` is `[abc]`), as Chrome serializes them. Consumers that need the value decode it: classes, ids, attributes, custom property names and family names.
2. **A unit is serialized as an identifier.** When the decoded unit would read as an exponent, its leading `e`/`E` stays escaped (`1\65 3` is not `1e3`). Chrome drops `width: 1\65 3`, and so does Dragon.
3. **Escaped surrogates, `\0` and values past U+10FFFF are U+FFFD.** A literal lone surrogate in the input is kept. Chrome 145 matches `#\uD800` only against the same surrogate, not U+FFFD (probed).
4. **A literal U+0000 is DRAGON_CSS_PARSE.** A Chrome 145 probe with `querySelector` and `CSSStyleSheet` shows it reads a literal NUL differently by position:
   - As U+FFFD: inside a name (`.a<NUL>`, `div<NUL>`), and at an identifier start after `.`.
   - As no name code point: right after `#` and after a leading `-` (`#<NUL>`, `#<NUL>a` and `.-<NUL>` are invalid).
   - Kept raw in a custom property's serialization.

   Dragon reports the first NUL and otherwise reads it as U+FFFD, so it never guesses.
5. **An escape at the end of the input is U+FFFD.** css-tree drops it, so `preprocessInput` replaces a trailing backslash outside a string or comment with U+FFFD, in place. Every offset holds.
6. **A functional pseudo-class with an escaped name** (`:\6e ot(`) has its Raw argument parsed as css-tree would have under the decoded name, at its own offsets. The An+B parser in css-tree cannot read escapes (`:nth-child(\6f dd)`), so such an argument stays Raw and is refused. This is a documented refusal: Chrome parses it.

## Proof

**`packages/parity/test/css-escapes.test.ts`** runs a differential check against the pinned Chrome 145.0.7632.6 through three gates, and eight plants must each be caught.

1. **13732 twins.** The set covers:
   - every keyword that the webref grammar of each subset property reaches;
   - every subset property name, the CSS-wide keywords, 14 function forms and 24 units;
   - hash colours, `!important`, custom property names, baseline pairs, family names and grid names.

   Each is escaped with a rotating mix of spellings: hex escapes followed by space, tab, LF, CRLF or FF; six-digit hex with no white space; identity escapes; uppercase. Chrome must read each twin exactly as its plain spelling (rule `cssText`), and so must Dragon: every declaration, longhand and diagnostic must be equal.
2. **72 edges.** These cover NUL, surrogates, values past U+10FFFF, astral escapes, escapes at EOF, hex escapes followed by two white spaces or CRLF, 6- and 7-digit hex, escaped exponent and percent signs, escaped `#`, grid names, escaped property names, `var()` spellings, escaped `url(`, and the former GRAMMAR_GAPS.
   - Dragon's accepted declarations must compute as Chrome's authored rule, with the same declared longhands and priorities.
   - Its invalid ones must be dropped by Chrome.
   - A refusal must be of a value Chrome drops, or be listed.
3. **59 selectors.** Dragon's matches must equal `Element.matches()` on four elements that carry decoded names: `1a`, `a�`, U+1F600, `x:y`, `-`, `--`, `a|b`, U+10FFFF and U+FFFD attributes.

**Listed exceptions.** Each is an error or refusal the author sees, never a wrong value:
- `background: u\72l(x.png)`: css-tree reads an escaped `url(` as a function.
- `width: var(--x\` at EOF: the `var()` splitter rejects a `var(` left open at the end of the input. The same happens without an escape; this was already true.
- `[data-a=\` at EOF: css-tree reports a block left open at EOF.
- `:n\74h-child(\6f dd)`: see ruling 6.
- `\73ubgrid`: the subgrid refusal.
- `div:\68over`: interactive state.

**`packages/dragon/test/escapes.test.ts`** covers:
- decoding, including CRLF, zero, surrogates, values past U+10FFFF and EOF;
- CSSOM serialization;
- canonical trees, including the exponent unit;
- deep (1000) and wide (200000) trees without recursion;
- `preprocessInput` in strings and comments;
- the U+0000 diagnostic span;
- escaped property names, `!important` and CSS-wide keywords.

## Changed tests and why

All retargets follow from Dragon now decoding escapes; none loosens a tolerance.

- **`grid.test.ts`**: the fail-closed test becomes a decoded-value test.
  - `2\65m \72 epeat(2, 1\66r) \6d in-content` is `2em repeat(2, 1fr) min-content`.
  - `\73 pan 2` is `span 2`, and `span \61uto` and `\64 efault` are invalid, as in Chrome.
  - The old example `\72epeat(` is really U+072E + `peat`, because `e` is a hex digit. It is now `\72 epeat(`.
- **`selectors.test.ts`**: the three "holds an escape" refusals become an acceptance test of decoded compounds.
- **`cascade-var.test.ts`**:
  - `--a\62: 1px` is now declared, not refused.
  - A new test checks decoded custom property names in declarations and `var()`.
- **`grid-computed.test.ts`**:
  - The 11 escape entries leave `GRAMMAR_GAPS`.
  - The 6 escape refusals leave the refusal list, and `\73ubgrid` joins it as the subgrid refusal.
  - `edgesAccepted` goes from 162 to 176: 10 former gaps and 4 former refusals are now accepted and compute like Chrome.
- **`grid-fuzz/compare.ts`**:
  - The hook-alone path canonicalizes as the driver does.
  - Escapes are no longer a documented gap.

## Verification

The head is the merge of origin/master 1703b45b (#27) into `css-esc`, with no conflicts.

- `pnpm install --frozen-lockfile && pnpm typecheck`: clean.
- `pnpm test`: 2313 of 2316 tests pass across 113 files. The three failures were 120 s timeouts while the load average was about 60 to 70, in:
  - `dist`, the Worker compile case;
  - `lanes`, in the `iosLayoutProjection` case;
  - `native-host`, the every-layout-case case.
- Rerun one file at a time, all three pass: 6/6, 19/19 and 6/6. The command raised `--testTimeout=600000` on the command line only; no committed timeout changed.
- Before the merge, the same pattern held: the timed-out `lanes-records`, `lanes`, `native-compare` and `native-host` passed 10/10, 19/19, 13/13 and 6/6 when rerun alone.
- These suites compile stylesheets without a backslash, and the escape walker skips such stylesheets.
- The dragon suite, `css-escapes`, `grid-computed` and `grid-fuzz` pass: 39 files, 713 tests.
- `wpt:check --target web`: every entry matches the committed expectations.
- **Generated outputs** (run before the merge, all exit 0, no file changed):
  - `profile:rows`, `native:gen`, `north-star:check`;
  - `parity:capture`.

  No fixture or example stylesheet holds a backslash or U+0000, so no capture or profile changes, and the device step is not needed.
- The reviewable diff is 86 KB.

## Follow-ups (not escapes)

- A `var(` or other block left open at the end of the stylesheet is refused, where Chrome closes it.
- css-tree overflows its stack on a value nested about 3000 deep with no `var()`. The walker added here is iterative.

## PR #28 round 1 (3653363877e7c7bcc71d704ab2cb2702b6538660)

**Finding 4139507864 is a real bug, and it is fixed.** Inside a string, `preprocessInput` stepped over only two code units for a backslash followed by CRLF. That left the `\n` to close the string. With `"A\<CRLF>B\` at the end of the input, the final escape was then read as U+FFFD, but it belongs to the still-open string, where it is dropped. css-syntax-3 §3.3 makes CRLF one newline, so an escaped CRLF is now three code units.

**The Chrome differential gains 8 edges; the edge count goes from 72 to 80.** Each is an end-of-input string holding an escaped CRLF, CR, LF or FF, tested as a `font-family` value and as a custom property, plus an unquoted identifier and a raw CRLF string. On the old code they fail: Chrome computes `"AB"` and Dragon computed `"AB�"`. They pass now.

**Re-audit of escapes.ts for "CRLF counted as two newlines":**
- `decodeName` already consumes CRLF as one white space after a hex escape.
- In a name, a backslash before a newline is not an escape, so css-tree ends the identifier there.
- Outside strings, `preprocessInput` stepping past a backslash and the newline after it changes nothing, since a newline cannot be the final code unit there.
- `variables.ts` `stringEnd` already treats an escaped CRLF as three code units.

No other instance.

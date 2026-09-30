# T113 GRID G0: compiler support for grid (done; device step pending)

Worktree /tmp/dragon-grid-g0, branch grid-g0-compiler, stacked on pr/casc-logical at 044f60c6 (BASE). Two local commits, nothing pushed:
- 92a0e3ea: source, tests, fixtures and the grammar script. It also carries the regenerated grammar.generated.ts.
- 638ca4fb: regenerated outputs. The commit message names every command that produced them.

The first attempt stopped on two stop conditions:
- Real longhands add keys to every capture.
- scripts/gen-css-grammar.ts was outside allowed_files.

The PM ruled option A: real longhands, provided a committed checker proves the change additive. The same ruling widened allowed_files.

## What changed

**Longhands (properties/grid.ts).** There are 12:
- grid-template-columns, grid-template-rows and grid-template-areas
- grid-auto-columns, grid-auto-rows and grid-auto-flow
- grid-row-start, grid-row-end, grid-column-start and grid-column-end
- justify-items and justify-self

The table, the grammar script and the seams pins all append the family after the logical family, in a separate block after where WM-0's lines will go.

**Shorthands.** There are 8: grid, grid-template, grid-row, grid-column and grid-area, plus Chrome's legacy aliases grid-gap, grid-row-gap and grid-column-gap, which map to the existing gap longhands.

**Values (css/grid-values.ts, hooked from parseValue).** On top of the webref grammar, Dragon applies the parse rules Chrome 145 applies:
- An auto-repeat takes only fixed sizes.
- A line name may not be span or auto.
- An areas string must be rectangular, with the same number of cells in each row and no invalid characters.
- In justify-self, `safe normal` is dropped.
- `baseline` must come after `first` or `last`, never before.

`ParsedValue.invalid` gained an optional `reason`, so the message names the rule that was broken.

**Canonical forms.**
- Grid lines are written span, then integer, then name.
- Areas are written one space apart, with runs of dots collapsed to one.
- grid-template merges the line names that meet between area rows (`[y] [z]` becomes `[y z]`).
- The grid shorthand's auto-flow form is supported.
- justify-* values use Chrome's serialized form (`first baseline` becomes `baseline`, `center legacy` becomes `legacy center`).

**Refusals.** These are DRAGON_UNSUPPORTED_VALUE, reported on the token:
- subgrid;
- math functions nested inside a track list;
- units that cannot be converted at build time (vw and the like), also when nested.

masonry is not in the grammar, so it is DRAGON_CSS_INVALID_VALUE.

**The grid layout gate.**
- display: grid and display: inline-grid have no profile row, so they stay refused as DRAGON_UNSUPPORTED_VALUE.
- The existing reject-display-grid fixture is unchanged.

**Computed values (analysis/computed.ts and resolve.ts).**
- Lengths inside track lists compute to px: em and rem against the element's and the root's font size, and absolute units by their fixed ratio.
- justify-items `legacy` computes to the parent's `legacy <position>` when it has one, and to `normal` otherwise.

**Fixtures (fixture-groups/grid.ts).** Two layout fixtures, each run in ltr and rtl:
- grid-inert-placement
- grid-inert-templates

Eight reject fixtures:
- inline-grid
- subgrid
- masonry
- areas that are not rectangular
- an auto-repeat of a flexible size
- calc() inside minmax()
- justify-self on a block child
- justify-items: center

The alias fixture (grid-gap on a flex container) is not inert: the flex layout depends on the alias mapping correctly.

**Why justify-* is proven only where Chrome ignores it.** A Chrome probe showed that Chrome 145 aligns block-level children and absolutely positioned boxes by justify-self and justify-items:
- `justify-self: center` moves a 50px block child to x = 75.
- `justify-items: legacy center` does the same.

Chrome ignores both on flex items.

So only these rows are proven:
- justify-self: auto and normal in block; many values on flex items.
- justify-items: normal, legacy and initial.

justify-self on a block child is refused with DRAGON_UNPROVEN_CONTEXT, which is the reject-grid-justify-self-block fixture.

## Proof

**test/grid.test.ts (19 tests).** Registry, parse and expansion, invalid and refused values, computed values, and compile. It also runs a live Chrome 145 dual computed check:
- **Inputs.** All 2,515 distinct grid, justify and gap declarations of the G-P corpus, copied to test/data from pr/layout-breadth-corpora at fb54bf70, plus 167 edge declarations.
- **Accepted values.** For every value Dragon accepts, Chrome computes the authored value and Dragon's longhands identically:
  - 2,510 of the 2,515 corpus declarations are accepted. The other 5 are subgrid or calc refusals, and they are pinned.
  - 119 of the 167 edge declarations are accepted.
- **Invalid values.** Every value Dragon calls invalid is one Chrome drops. The one pinned exception is `justify-items: anchor-center`: Chrome parses it, but it is missing from the webref grammar, so Dragon refuses a value Chrome accepts. It never accepts a value Chrome drops.
- **Plants.** All four are caught: lineEndNotCopied, autoRepeatTakesFlex, denseDropped and areaRowNamesNotMerged.

**Additive checker (packages/dragon/test/tools/check-grid-additive.ts, run with a base commit).** Against 044f60c6 it reports PASS:
- Captures: 1,380 were checked (345 expected, 1,035 expected-dpr). Each computed record gains exactly the 12 longhands, in order. With those removed, each file is byte-identical to BASE.
- Emitted CSS: 241 files were checked. The header's compilation hash may change. Every rule gains exactly the 12 declarations, at its end, and nothing else changes.
- UA tables: the 2 files only gain lines for the new longhands.
- Pixel manifest: it only gains entries for the new cases.
- Byte-identical: every existing layout vector, break vector, Chrome break file and PNG.
- Stale files: none. Every base capture and every emitted file did change.
- Plants: the checker catches all five. They were a box value, an existing computed value, a vector byte, a UA value and a manifest size, each changed, plus a declaration dropped from an emitted file. After the plants, the tree was restored and the checker passes clean.

## Verify

**typecheck.** Pass.

**test.** 99 files, 2,110 tests: 2,107 pass and 3 fail. All three failures wait on the device step for the 4 new layout cases:
- device-failures.test ios
- device-failures.test android
- lanes.test "every device lane ran (P5)"

`parity:lanes --run-host` recorded the device lanes as not run, because their case lists grew from 345 to 349.

**Device step pending.** It needs `parity:lanes -- --run-device` on both leases.

**Baseline at BASE.** 98 files, 2,067 tests, all passing.

**Captures twice, no diff on the second.** After both commits, this whole chain ran again and left the tree clean (0 changed files):

```
grammar:gen
ua:capture
parity:capture
parity:dpr-capture
profile:rows
layout:vectors
layout:dpr-vectors
layout:break-vectors
native:gen
parity:break-capture
parity:pixel-capture --recheck 1
parity:report
parity:dpr-report
parity:lanes --run-host
```

capture and profile:rows reach a fixed point on the second pass.

**parity:report.**
- 217/217 fixtures, 349/349 cases, failed 0.
- Dual lane: 502,272/502,272 values.

**parity:dpr-report.** 1,047/1,047 cases, failed 0.

**parity:break-capture.** 1,047/1,047 cases equal.

**parity:lanes.** "agree on ios and android".

**Existing device-pixels failures.** Already failing at BASE, before this change (537 on iOS, 1,375 on Android).

**profile:rows (declared rows only).**
- Each of web, ios and android goes from 1,613 to 1,765 rows: 152 added, all grid or justify.
- No row was removed and no status changed.
- In web and ios, 62 existing rows gained the new case ids. android has no proofs, so none changed there.

**native:gen.** No Swift or Kotlin diff (digest ae0f4087…). corpus-dpr.json was regenerated for the new case counts (91, 1,047 and 1,047).

**wpt:check (refusals only shrink).**
- No status changed: 5 pass of 38,054 files. There is no new refusal and no pass became a fail.
- 387 not-runnable reasons changed. Before, every one was DRAGON_UNSUPPORTED_PROPERTY on a grid or justify property: grid-template-columns 176, grid-column 66, grid 63, grid-auto-flow 27, grid-template-rows 17, justify-items 12, grid-template 8, grid-auto-columns 6, justify-self 5, grid-auto-rows 4, grid-gap 2, grid-template-areas 1.
- The next blockers are now:
  - font 183
  - writing-mode 74
  - display: grid 50
  - float 17
  - outline 10
  - subgrid 6
  - margin-trim 4
  - repeat(auto-fill, auto), which Chrome also drops, 4
  - elements (br, pre, input)

## Deviations

- **reject-grid-line-order became reject-grid-auto-repeat-flex.** The webref grammar already rejects `a span 2`, so that fixture would not have exercised a Chrome-only rule.
- **web.json** was written from a Chrome-free run by a one-off /tmp script (not committed), as WM-0 did. Only not-runnable reasons were rewritten.
- **Regenerated outputs beyond the directories the ruling listed,** all shown to be additive or new-only by the checker:
  - src/ua/*.generated.ts, from ua:capture
  - src/profiles/*
  - out/lanes.json
  - translate/corpus-dpr.json
  - the new files in layout/vectors, layout/break-vectors, expected-breaks and expected-pixels, plus the manifest entries for the new cases
- **The grid corpus is copied, not referenced.** Its distinct declarations were copied to test/data/grid-corpus-declarations.json, because the corpus is not on this branch.
- **Added beyond the listed properties:** the three legacy gap aliases, and an optional reason on ParsedValue.invalid.

## PR #23 review rounds (branch pr/grid-g0)

**Round 1 (f8a7bf0f).**
- **4136491292:** as filed, not a bug. css-tree keeps identifiers in their escaped form, so names are written back escaped, and a Chrome probe shows `[\31 foo]` round-trips. The related real bug is fixed: keyword and reserved-name checks now decode escapes.
- **4136491296:** fixed. subgrid is refused only as the top-level track-list keyword.
- **4136491301:** not a bug. A lone surrogate falls inside the `u` range, so non-BMP names already worked. Area rows are now scanned by code point anyway.

**Merge (d24f6c5e, 13924733).** origin/master (#24) was merged in and all outputs regenerated to a fixed point. The additive checker passes against origin/master. In the device step, device-pixels gained 22 entries on iOS and 29 on Android, all in the grid-inert cases, and none were removed.

**Round 2 (3f7532a0), 4137250474.** Per the PM ruling, grid values fail closed on escapes:
- An escaped function name, unit or keyword is DRAGON_UNSUPPORTED_VALUE.
- Custom line names and area strings keep their escaped text.
- Through a declaration, the webref grammar already dropped every example in the finding. The grid hook now refuses them on its own as well.

## Proposed follow-up package: CSS-ESC (all properties)

**Problem.** Dragon matches keywords, function names and units on their escaped source text, for every property:
- The webref lexer does not decode escapes, so `display: \62 lock` and `justify-self: \63 enter` are DRAGON_CSS_INVALID_VALUE, although Chrome accepts them.
- The grid hook now fails closed on the same input.

This errs toward refusing, never toward a wrong acceptance.

**Scope.** Decode identifiers, function names and units as css-syntax-3 §4.3.11 requires, before grammar matching and before classification. Custom identifiers keep a serialization that round-trips (the CSSOM "serialize an identifier" rules).

**Proof.** A dual computed check over escaped spellings of every keyword in the subset. Then remove the fail-closed grid refusal and the pinned grammar-gap list in grid-computed.test.ts.

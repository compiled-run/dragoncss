# T068 DTXT, typed dynamic-text slots (Judge, recorded by PM)

**DT-1. Text slots are format templates over typed integer inputs.**
- A slot is `{node, kind: 'text', template, inputs}`. Fields are `{id}` or `{id:0N}`, ASCII digits only; inputs are integer ranges.
- The demo's slot is `'{m}:{s:02}'` with m in 0-999 and s in 0-59: 60,000 strings, each equal to Markless `formatTime`.
- Because the domain is finite, the build proves coverage, script, collapse and transform for every string, and the width proof is exhaustive. The limit is 100k strings per slot.
- Free text is refused as `DRAGON_UNSUPPORTED_DYNAMIC_TEXT`; that is DTXT2, later.

**DT-2. A write re-runs layout.**
- The setter validates the inputs, formats the text (rt-text-format.ts, translated), replaces the leaf, and re-runs the whole engine with `shapedMeasurer` and the HarfBuzz `GlyphShaper`.
- There are no width tables. The only allowed memo is keyed by (face sha256, size, string).
- Writes in one host turn batch into one layout, and the result is independent of write order.
- A text write is not a style change, so it fires no transitions.

**DT-3. Proof.**
- **(a) Width oracle.** An exhaustive Chrome width oracle covers:
  - all 60k strings, in Lato 400 and Dragon Sans 400 at 16px, DPR 1;
  - a boundary list at DPR 2, 2.625 and 3 and at 14 and 20px.

  `shapedMeasurer` must equal Chrome on every string.
- **(b) Boundary fixtures.** Chrome is set by script, with a static twin as a check. Values: 0:00, 0:09, 0:10, 1:11, 3:07, 8:08, 9:59, 10:00, 59:59, 99:59, 100:00, 999:59. Rows use the portrait and landscape demo forms plus a Dragon Sans row, in ltr and rtl at every DPR, across all five lanes.
- **(c) Dense device grid.** Device frames must equal host frames.
- **(d) Planted faults.** padDropped, minutesWrapped, textDomainUnchecked, widthCacheByLength (caught on Dragon Sans), textSlotNoRelayout, textSlotStaleGlyphs, shapeCacheByLength, textSlotDomainUncheckedDevice, slotWriteOrderDependent.

**DT-4.** DTXT and SOV share one slot schema and typed-input guard, and FORM-a reuses them. DTXT and SOV are serial against each other.

**Reflow finding.** Lato digits are tabular: "0:00" is 31.84px and "10:00" is 41.12px, against the 40px portrait min-width. So 9:59 to 10:00 reflows both bands.

**Order.**
- DTXT-0 runs now: new files only, no device lease.
- DTXT-1 comes after TXT1a-2, SELD-R1 and DTXT-0, and after T034 for the NS cases. It is serial against SOV.

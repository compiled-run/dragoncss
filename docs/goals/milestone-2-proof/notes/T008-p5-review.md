# T008 Judge review of P5 (recorded by PM from the Judge's receipt)

**Decision: approved, with one must-fix (MF1).** Commit the full device-failures-{ios,android}.json lists, which total ios 515 (245 at DPR 3, 270 at DPR 2) and android 1341 (261 at DPR 2, 857 at 2.625, 223 at 3). Add a test that their counts equal lanes.json.

**Re-verified:**
- typecheck, and tests 1605/1605;
- breaks 966/966, byte-identical;
- host lanes;
- require-all names exactly the two device-pixels lanes;
- the 4 lane plants;
- smoke 3/3 on both platforms;
- glyph-offset-1 caught on both, with a thin margin.

No loosened gate and no strict-tier change were found. The three runs were runner timing faults, so the P5a/P5b split is not triggered.

**Failure buckets:**

| Bucket | What it is | iOS | Android | Owner |
|---|---|---|---|---|
| B1 | Dashed and dotted border geometry | 68 | 82 | P6a |
| B2 | CSS2 Appendix E paint order (positioned boxes above in-flow siblings; overflowing inline text above later backgrounds) | 70 | 113 | PNT1 |
| B3 | Glyph-edge raster: Chrome's darwin Ahem fringe of 0.2-0.5 px and seam fill; box-rule points land on glyph antialiasing | 377 | 1146 | SC-GLYPH Scout, then a Judge ruling (sampler inset vs raster port), then P6a-g |

- Double borders pass.
- The glyph plant catch should compare against the clean run.

**P6a package (binding):**
- dashed and dotted borders per Blink 145 in device px, in a translated paint-dash.ts;
- promotion rule;
- outputs ready only with passing, non-stale lanes;
- native digest;
- a SystemInfo software-raster precondition;
- plants dash-phase-1 and dash-gap-unfitted.

The rest of the package is in the Judge receipt in this session's T008 record (allowed_files, verify, stop_if). Scratch: /tmp/t008-probe.

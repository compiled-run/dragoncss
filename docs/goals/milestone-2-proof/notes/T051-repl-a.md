# T051 REPL-a: worker note

Spec: notes/T045-repl-form-spec.md, the REPL-a section (binding), amended by T051J.

## State before T051J

The work is on branch repl-a in /tmp/dragon-repla, at 170ee17d7, stacked on size-ar 33ea62809, because Phase A needs aspect-ratio.

packages/layout/src/replaced.ts ports Blink's ComputeReplacedSizeInternal and ComputeObjectFitAndPositionRect (BSD). It equals Chrome on 264/264 sizing cases, and its destination rect is within 1 device px of the REPL-0 probe on 405/405 cases at DPR 2, 3 and 2.625. The plants are caught. It is not wired into layout yet.

## T051J amendment (Judge, 2026-10-01), PM accepted

- **Route 2a.** object-fit and object-position become real longhands: append them to gen-css-grammar.ts SUBSET, regenerate the grammar, rerun ua:capture, and append to the seams pin. This is required by decisions.md "Adding engine fields and CSS longhands" (T050/T113); computedExtra came before that ruling. A committed checker, scripts/check-object-fit-migration.ts (modelled on SIZE-ar's), proves that every existing capture, emitted body and UA entry differs only by the two neutral keys, at their initial values fill and 50% 50%. Its plants must fail.
- **Engine.** A new replaced leaf kind, with fields only on that kind, so no existing vector gains a key: the vector diff against BASE has no modified or deleted files.
  - intrinsic.ts: one replaced-contribution branch.
  - environment.ts: additive natural-size zoom and object-position resolution.
  - The harness gets an additive decoder.
  - block, flex and position change only at the replaced call sites.
- **Compiler.** It adds:
  - the img and iframe element rows (analysis/elements/replaced.ts) and the src, alt, width and height attribute rows;
  - a datasets.ts replacedKey accessor and one img[src]/iframe branch in resolve.ts;
  - the stylesheet.ts &lt;position&gt; hook, mirroring aspect-ratio;
  - the images option and digest;
  - DRAGON_REMOTE_IMAGE, which covers both remote-image and T048's unmapped-image, and DRAGON_UNSUPPORTED_IMAGE.

  Inline-level replaced boxes are refused, naming RF-INL. calc in object-position is refused.
- **North star.** check.ts gets an images option mapping the four i.ytimg.com covers to examples/music-player/covers/*.png, labelled as a stand-in (R1).
- **Native boundary.** Phase A lowers the replaced box's frame, border and background for native layout only. There is no image drawing, no web view and no contentMode or ScaleType (R6, R9). Phase B draws. The engine projection exists only while a native target compiles (project.ts nativeChecked), so a host-only native refusal is not an option.
- **Landing.** Phase A does not merge alone; A and B land together. This supersedes the spec P4 line "Phase A may merge alone".
- **Identity test.** replaced-identity.test.ts proves that every pre-existing FIXTURES case's resolved values, native layout input and web body (minus the two neutral declarations) deep-equal BASE.
- **Queue.** SIZE-ar moves up the landing queue, after the paint stack (it needs T116), because REPL-a and FORM-a stack on it. FORM-a Phase A now stacks on REPL-a Phase A.

The full worker_package (allowed_files, verify, stop_if) is in the T051J receipt and on the board under T051's constraints.

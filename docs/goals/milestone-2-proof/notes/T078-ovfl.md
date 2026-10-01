# T078 OVFL: worker note

Spec: notes/T046-paint-spec.md §5.8 (binding), amended by T078J. The branch is ovfl-a (the spec named it ovfl-scroll), stacked on inl1a-compiler b0c8fd13e (BASE), because Phase A edits the same files as INL1a. It catches up when INL1a and EMS merge.

## T078J amendment (Judge, 2026-10-01), PM accepted

**Design A, viewport propagation in the compiler.** The lowering (ios-layout.ts) takes html's overflow, or body's when html is visible on both axes. It writes the used value visible on the element it took the value from, and exports a pure viewportOverflow() for Phase B. The engine never sees tags, and no engine input field is added. propagationFromBody is a CompilerFaults entry, caught by the viewport-prop fixtures.

**Engine.**
- overflow-x/y gain auto, scroll and clip. auto, scroll and hidden make scroll containers.
- clip is not a scroll container and does not establish a BFC: it keeps margin collapsing and the automatic min size, proven against Chrome.
- Scrollable overflow follows css-overflow-3 §2.2 and Blink scrollable_overflow_calculator.cc, with zero gutter.
- Engine faults gutterReserved and overflowIgnoresPadding.
- layout()'s serialized boxes and every existing result stay byte-identical. The metrics come through a new unprinted field or an exported overflow.ts root.

**Compiler.**
- checkOverflow refuses only clip beside visible on one axis, as DRAGON_UNSUPPORTED_VALUE naming OVFL-c.
- The html/body refusals are removed.
- native-program clips when both axes are non-visible, with a ProgramError if exactly one is. At scroll offset 0 a scroll container draws like hidden.

**Fixtures.**
- reject-overflow-single-axis is retargeted to overflow-x: clip. Its BASE HTML becomes overflow-single-axis-hidden.
- reject-overflow-body, reject-overflow-scroll and reject-context-root-overflow are removed (REMOVED_AFTER_BASE, the reject-background-important precedent). They become the positive viewport-prop-body-hidden, overflow-scroll-basic and viewport-prop-html-x-hidden, captured from Chrome.
- New fixtures: clip margin collapse, clip flex min-size, the demo's html/body/.App pattern, end padding, nested scroll containers, rtl.

**Metrics.** scrollWidth, scrollHeight, clientWidth and clientHeight are captured into expected-scroll at DPR 1, 2, 3 and 2.625, through a new parity:scroll-capture CLI. They must match exactly after Chrome's integer snap.

**Corpus.** An engine-overflow suite is appended after engine-inline in corpus-dpr.ts. corpus.ts is not edited, so existing inputs don't move.

**Added files:**
- harness.ts: overflow literals, the FAULT_KEYS append and the suite dispatch;
- corpus-dpr.ts (append);
- generate.ts (one engineRoots entry, if needed);
- computed-checks.ts (checkOverflow);
- native-program.ts (two predicates);
- faults.ts (append);
- the milestone-1.ts and contexts.ts registry lines, and the four reject HTML files;
- fixture-reader.test.ts (REMOVED and RETARGETED) and seams.test.ts (MILESTONE_1_IDS and the sha pin);
- cli/scroll-capture.ts and a package.json script.

**Landing.** Phase A is host-done only and lands together with Phase B; the C10/C11 device steps move to Phase B. A follow-up, OVFL-c, adds single-axis clip natively.

The full worker_package is in the T078J receipt and on the board under T078's constraints.

## Phase A host-done (2026-10-01)

ovfl-a a2cf2d768 (f7c4b432d engine and translator, 3edad012d compiler, fixtures and metrics, a2cf2d768 regenerated outputs). 18 scroll cases equal Chrome's boxes and scroll metrics at DPR 1, 2, 3 and 2.625. The plants gutterReserved, overflowIgnoresPadding and propagationFromBody are caught. Swift and Kotlin engine-overflow 3000/3000. North star: iOS and web overflow diagnostics go to 0, and both-target support goes 165 -> 168. Tailwind web and iOS +9.

The PM accepted two files outside the T078J list: targets.ts (two lines declaring the engine-overflow suite) and .macroscope/ignore.md (the expected-scroll generated-output entry, per AGENTS step 3).

Phase B waits for EMS, PNT1 and SELD-R1 on master. native:encoders shows 13 invalid inline-* dumps, which are the INL1a regression being fixed in that lane, not OVFL.

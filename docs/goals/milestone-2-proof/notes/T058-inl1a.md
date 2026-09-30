# T058 INL1a: worker note

Spec: notes/T044-inl-spec.md §3 INL1a (binding), with the Judge amendment below.

## Stack (local branches, none pushed yet)

Each branch stacks on the one before it. All of them sit on `v2a-value-model` (T026), which sits on `pr/v1b-compiler-values`. Neither has merged, so no INL1a PR can open against master until both land (Landing work step 1: a PR diff against master would carry V1b and V2a).

1. `inl1a` (/tmp/dragon-inl1a): v2a-value-model with origin/inl-bf (#40) merged, regenerated outputs and a device run. It adds no INL1a source.
2. `inl1a-breaks` (/tmp/dragon-inl1a-breaks): soft wrap opportunities from Blink's rules, Blink's fit test, and `placeLines`, which replaces P5's buildRun/breakLines export; the `inline` fixture group (inline-breaks-*). It has its regenerated outputs, a device run, and an audit commit.
3. `inl1a-engine` (/tmp/dragon-inl1a-engine): R5 input (InlineBox, LineBreak, strut, verticalAlign), the inline core over items (CSS2 §10.8), and scripts/migrate-inline-input.ts for the hand-written inputs, plus an audit commit.
4. `inl1a-engine-corpus` (/tmp/dragon-inl1a-corpus): the engine-inline differential suite (3000 generated IFCs) in corpus-dpr.ts.
5. `inl1a-compiler` (/tmp/dragon-inl1a-compiler): the compiler, runtime and fixture theme. In progress.

The dead session's first stack is kept as `backup/inl1a-engine-corpus-a`, `backup/inl1a-compiler-wip-a` and `backup/inl1a-engine-da744`. The dead session left 1,821 half-regenerated output files in the engine worktree. They were discarded, and the regeneration was rerun from the committed sources.

## Judge ruling (2026-09-30): S16 amendment for the compiler theme

The compiler WIP stopped on stop_if: fixtures with inline boxes need S16-protected parity files. The Judge chose ruling (a) and rejected the INL1a-1 fallback split. Reason: on web too, `compareLayout` fails any fixture with a span. The engine emits `<span>:line<j>` rects, and capture.ts records no fragments for inline elements. So INL1a-1 could not prove web support either.

allowed_files gains exactly these hunks, and no other S16 path:

- packages/parity/src/capture.ts, captureFixture: for an element whose computed display is `inline` and which is not a `<br>`, one `<id>:line<j>` line node per `getClientRects()` rect.
- packages/parity/src/native-compare.ts, nodeKinds: walk InlineBox children. InlineBox and LineBreak are `element` nodes, TextLeaf is `text`.
- packages/parity/src/pixel-reference.ts, cssFontSizes: recurse into InlineBox children.
- packages/parity/src/compare.ts, anonymousBoxes: collect TextLeaf ids through InlineBox descendants. Only if a fixture needs it.
- packages/parity/test/*.test.ts: appends covering these hunks, no pin changes.

Added verify steps:

- S16 with these four files removed from its list. `git diff $BASE` of them touches only the named functions, and the receipt quotes the hunks.
- S7 empty, which proves capture.ts is additive.
- S8 failed 0 at every DPR.
- S14: existing case counts and verdicts are unchanged, and the new inline cases pass reference proof (a) and (d) on ios and android.
- A test that referenceDump labels an inline fixture's span and br `element` and nested text `text`, without throwing.
- Phase B S18.

Added stop_if conditions:

- An existing capture, report row, lanes check or pixel manifest entry changes.
- Another S16 path is needed (native-dump.ts, lanes.ts, device-lanes.ts).
- Chrome's getClientRects for a span or br disagrees with the engine's fragments, and Blink 145.0.7632.6 does not explain it.

## Audit rounds (Landing work step 3, before the first push)

- breaks: the family 3 probe is shape-checked, and any HTML entity other than `&quot;` throws. The letters-and-spaces cases are compared in rtl at every DPR. The plants are checked at every DPR. The parity plant test cannot pass vacuously. The Swift and Kotlin dump fail when a text view with lines has no metrics.
- engine: added the validator `leaf-font` rule and the strut-null guard. Margins now collapse through a formatting context with no line boxes. rtl refuses U+200B before a `<br>`. lowerFont checks the family. line-breaks.ts and its host programs throw on an unknown rect. The migration script is hardened. The refused INL-P cases are asserted unchanged, and the engine's leaves are checked against Chrome's in both directions.
- Findings answered without a change:
  - The translated harness does not call validateLayoutInput. validate.ts is TS-only, and every corpus line is validated when it is generated.
  - The flex-strut double error: both errors are true.
  - corpus.ts's random corpus has no inline items. The engine-inline suite in corpus-dpr.ts covers inline boxes, `<br>`s and plants.

## Second Judge amendment (T058J2, 2026-09-30), PM accepted

The first compiler WIP stopped on stop_if. It needed resolve.ts, blockify.ts and blockify.test.ts, and the engine-inline corpus needed S16 targets.ts and lanes.ts. The Judge approved them, limited as follows:

- (A) resolve.ts: only the new collapseInlineContext and isInlineBox, and resolveTree's pendingInline, gather and place changes. With no inline box and no `<br>`, collapseInlineContext must equal collapseInlineRun (tested over every existing text run plus a generated set).
- (B) blockify.ts: only checkInlineLevel's lift for display: inline, with its doc comment and message.
- (C) Retarget blockify.test.ts. The refusal pin proves atomic inlines are still refused and a span in a block container is accepted. The blockifySkipped pin fails through lowered input, not a displayOf difference.
- (D) phrasing-blockified.test.ts: the blockifySkipped pin still fails both cases in both directions, now on a named lane or node.
- (E) 8f21790db's dropInheritedText retarget is accepted with added asserts: the reason names the w1 text leaf and leaf-font, chrome-dual passes if it ran, and the unfaulted run passes.
- (F) Deviation 58b7f005c is accepted: callers use buildIfc then placeIfcLines. placeLines stays exactly placeIfcLines(buildIfc(...)), and a test proves them equal on the engine-inline and break-vector inputs.
- (G) targets.ts: one appended engine-inline extendedSuites entry, plus its ExtendedManifest field, only after T058L merges.
- (H) Delete scratch-cap.ts and scratch-inline.ts.
- An inline box whose white-space-collapse is not collapse is refused with a typed code.
- Stop if any existing fixture's resolved text, capture, vector output or emitted body changes, or if the lift lets through a tag or context INL1a does not support.

T058L (board T125) is a separate PR from master that lands first. lanes.ts SUITE_LINE is a closed list, so judgeHost drops an unknown suite without counting it. The fix matches any suite-shaped line, and master's lanes.json must stay byte-identical.

The full worker_package (allowed_files, verify, stop_if) is in the T058J2 receipt, which is copied into T058's constraints on the board.

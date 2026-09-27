// Places where Chrome 145 departs from the spec text and the engine follows Chrome. Each entry declares the branches of the
// deviation and names, per node, the branch it proves and its fixture; every node must match Chrome exactly at 1/64 px in the
// same run, and every declared branch needs at least one node. Each entry has a planted fault (EngineFaults) that applies the
// spec reading instead; for a distinguished entry it makes every registered node non-exact. blink cites the source at 145.0.7632.6.

export type DeviationFault = 'halfLeadingSpec' | 'minMaxEndMarginSpec' | 'wrapReverseBaselineSpec';

export type ChromeDeviation = {
  readonly id: string;
  readonly specSection: string;
  readonly spec: string;
  /** The Blink behaviour, citing file and lines at 145.0.7632.6, or "measured; source not located". */
  readonly blink: string;
  /** The planted engine fault that applies the spec reading. */
  readonly fault: DeviationFault;
  /**
   * distinguished: the spec fault makes every registered node non-exact. contradicted: S5 found the spec reading gives the same
   * result on every registered node, so the nodes do not show a departure from the spec (notes/T038-slice-5.md). No entry is
   * contradicted: T040 retired the auto-margin overflow entry, the only one S5 found, and its nodes stay in their fixtures as
   * ordinary compared nodes. The M2 test requires every entry to be distinguished.
   */
  readonly finding: { readonly kind: 'distinguished' } | { readonly kind: 'contradicted'; readonly detail: string };
  readonly branches: readonly { readonly id: string; readonly description: string }[];
  /** A node whose exact 1/64 px match with Chrome distinguishes Blink from the spec text on one branch. */
  readonly nodes: readonly { readonly branch: string; readonly fixture: string; readonly node: string }[];
  /**
   * Exact nodes of the same fixtures on which Chrome and the spec reading agree, kept as controls. They were registered as
   * distinguishing nodes before S5; the planted spec fault showed they are not (notes/T038-slice-5.md).
   */
  readonly controls: readonly { readonly fixture: string; readonly node: string; readonly relativeTo: string; readonly reason: string }[];
};

export const chromeDeviations: readonly ChromeDeviation[] = [
  {
    id: 'half-leading-floor',
    specSection: 'CSS2 §10.8.1',
    spec: 'Half the leading (line-height minus the font height) is added above and below the glyphs.',
    blink: 'third_party/blink/renderer/core/layout/inline/line_utils.cc lines 32-41 at 145.0.7632.6 (CalculateLeadingSpace): the ascent-side leading is ((line_height - LineHeight()) / 2).Floor(), and the descent side gets the rest.',
    fault: 'halfLeadingSpec',
    finding: { kind: 'distinguished' },
    branches: [
      { id: 'positive-odd-leading', description: 'an odd positive leading: 10px Ahem in a 25px line puts the glyph box at 7px, not 7.5px' },
      { id: 'negative-leading', description: 'a line-height below the glyph height: 10px Ahem in a 5px line puts the glyph box at -3px, not -2.5px, on every line' },
    ],
    nodes: [
      { branch: 'positive-odd-leading', fixture: 'text-ahem-single-line', node: 't3:text0' },
      { branch: 'negative-leading', fixture: 'text-line-height-multi-line', node: 'neg5:text0:line0' },
      { branch: 'negative-leading', fixture: 'text-line-height-multi-line', node: 'neg5:text0:line2' },
      { branch: 'negative-leading', fixture: 'text-line-height-multi-line', node: 'neg7:text0:line1' },
    ],
    controls: [],
  },
  {
    id: 'min-max-end-margin',
    specSection: 'CSS 2.1 §8.3.1, §10.6.3',
    spec: 'The bottom margin of a box with auto height and zero min-height collapses with the bottom margin of its last in-flow child, and the collapsed margin is outside the box. With a non-zero min-height they do not collapse, and the child margin counts toward the content height. max-height plays no part.',
    blink: 'third_party/blink/renderer/core/layout/block_layout_algorithm.cc at 145.0.7632.6: lines 1311-1316 leave the pending end margin out of the intrinsic block size, and lines 1365-1375 drop the end margin strut when the used block size differs from the intrinsic one (min-height or max-height changed it). Otherwise the strut collapses through the bottom, whatever min-height is.',
    fault: 'minMaxEndMarginSpec',
    finding: { kind: 'distinguished' },
    branches: [
      { id: 'dropped', description: 'min-height or max-height changes the content height: the end margins are dropped' },
      { id: 'collapsed-through', description: 'a non-zero min-height leaves the content height unchanged: the end margins still collapse through the parent bottom' },
    ],
    nodes: [
      { branch: 'dropped', fixture: 'margin-collapse-min-height', node: 'p9' },
      { branch: 'dropped', fixture: 'margin-collapse-min-height', node: 'x6' },
      { branch: 'collapsed-through', fixture: 'margin-collapse-min-height', node: 'p5' },
      { branch: 'collapsed-through', fixture: 'margin-collapse-min-height', node: 'x5' },
    ],
    controls: [
      { fixture: 'margin-collapse-min-height', node: 'p4', relativeTo: 'f4', reason: 'min-height 40px exceeds the content plus the child margin (32px), so both readings give 40px and the next sibling x4 at the same place' },
      { fixture: 'margin-collapse-min-height', node: 'p6', relativeTo: 'f6', reason: 'max-height 8px sets the box height in both readings; only the next sibling x6 shows the dropped margin' },
      { fixture: 'margin-collapse-min-height', node: 'p7', relativeTo: 'f7', reason: 'max-height 100px with zero min-height: Chrome collapses through, which is also the spec reading' },
    ],
  },
  {
    id: 'wrap-reverse-baseline-line',
    specSection: 'css-flexbox-1 §8.5',
    spec: "A flex container's first main-axis baseline comes from its first flex line: the shared baseline of that line's baseline-aligned items, or else the startmost item. Lines are numbered from cross-start, so under wrap-reverse the first line of a row container is the bottom one, and of a column container the inline-end one.",
    blink: 'third_party/blink/renderer/core/layout/flex/flex_layout_algorithm.cc at 145.0.7632.6: lines 1581-1583 (ApplyReversals) reverse the flex lines under wrap-reverse; lines 1759-1763 treat index 0 as the first line and call AccumulateLine only when !is_column_; lines 1945-1946 call AccumulateItem, whose first-line fallback (lines 88-96) is the first item of reversed line 0. So the baseline comes from the block-start line of a row and the inline-start line of a column.',
    fault: 'wrapReverseBaselineSpec',
    finding: { kind: 'distinguished' },
    branches: [
      { id: 'shared-baseline', description: 'the top line of a row has baseline-aligned items: the container baseline is their shared baseline, so a baseline-aligned sibling lines up with the top line' },
      { id: 'startmost-item', description: 'the top line of a row has no baseline-aligned item: the container baseline is its first item in flow order' },
      { id: 'column-wrap-reverse', description: 'an ltr column container: the baseline is the first item of the inline-start (left) line, the last flex line' },
      { id: 'column-wrap-reverse-rtl', description: 'an rtl column container: the baseline is the first item of the inline-start (right) line, the last flex line' },
    ],
    nodes: [
      { branch: 'shared-baseline', fixture: 'flex-baseline-nested-reverse', node: 'f2a' },
      { branch: 'shared-baseline', fixture: 'flex-order-baseline-wrap-reverse', node: 'o3a' },
      { branch: 'startmost-item', fixture: 'flex-baseline-nested-reverse', node: 'f1a' },
      { branch: 'startmost-item', fixture: 'flex-baseline-nested-reverse', node: 'f4a' },
      { branch: 'column-wrap-reverse', fixture: 'flex-baseline-column-wrap-reverse', node: 'x1' },
      { branch: 'column-wrap-reverse', fixture: 'flex-baseline-column-wrap-reverse', node: 'x3' },
      { branch: 'column-wrap-reverse-rtl', fixture: 'flex-baseline-column-wrap-reverse', node: 'x2' },
      { branch: 'column-wrap-reverse-rtl', fixture: 'flex-baseline-column-wrap-reverse', node: 'x4' },
    ],
    controls: [],
  },
];

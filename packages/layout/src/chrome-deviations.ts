// Places where Chrome 145 departs from the spec text and the engine follows Chrome. Each entry declares the branches of the
// deviation and names, per node, the branch it proves and its fixture; every node must match Chrome exactly at 1/64 px in the
// same run, and every declared branch needs at least one node.

export type ChromeDeviation = {
  readonly id: string;
  readonly specSection: string;
  readonly spec: string;
  readonly blink: string;
  readonly branches: readonly { readonly id: string; readonly description: string }[];
  /** A node whose exact 1/64 px match with Chrome distinguishes Blink from the spec text on one branch. */
  readonly nodes: readonly { readonly branch: string; readonly fixture: string; readonly node: string }[];
};

export const chromeDeviations: readonly ChromeDeviation[] = [
  {
    id: 'half-leading-floor',
    specSection: 'CSS2 §10.8.1',
    spec: 'Half the leading (line-height minus the font height) is added above and below the glyphs.',
    blink: 'InlineBoxState CalculateLeadingSpace floors the top half-leading to a whole px; the bottom gets the rest.',
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
  },
  {
    id: 'min-max-end-margin',
    specSection: 'CSS2 §8.3.1, §10.6.3',
    spec: 'A parent with auto height and non-zero min-height does not collapse its bottom margin with its last child; that margin then counts toward the parent content height.',
    blink: 'Chrome 145 (measured) leaves the end margins out of the auto height; they collapse through the parent bottom when min/max-height leave the height unchanged and are dropped when min/max-height change it.',
    branches: [
      { id: 'dropped', description: 'min-height or max-height changes the content height: the end margins are dropped' },
      { id: 'collapsed-through', description: 'min-height or max-height leaves the content height unchanged: the end margins collapse through the parent bottom' },
    ],
    nodes: [
      { branch: 'dropped', fixture: 'margin-collapse-min-height', node: 'p4' },
      { branch: 'collapsed-through', fixture: 'margin-collapse-min-height', node: 'p5' },
      { branch: 'dropped', fixture: 'margin-collapse-min-height', node: 'p6' },
      { branch: 'collapsed-through', fixture: 'margin-collapse-min-height', node: 'p7' },
      { branch: 'dropped', fixture: 'margin-collapse-min-height', node: 'p9' },
    ],
  },
  {
    id: 'auto-margin-overflow-cross-start',
    specSection: 'css-flexbox-1 §9.6 step 13',
    spec: 'When an item with auto cross-axis margins is larger than its flex line, the block-start or inline-start margin (whichever is in the cross axis) is set to zero, so the item is flush with the writing-mode start edge.',
    blink: 'Chrome 145 (measured) zeroes the cross-start margin instead: in a wrap-reverse container the item is flush with the cross-start edge, the writing-mode end edge.',
    branches: [
      { id: 'row-wrap-reverse', description: 'a row container: a 30px item in a 20px line sits flush with the bottom (cross-start), 10px above the top, not flush with the top (block-start)' },
      { id: 'column-wrap-reverse', description: 'an ltr column container: a 30px item in a 20px line sits flush with the right (cross-start), not the left (inline-start)' },
      { id: 'column-wrap-reverse-rtl', description: 'an rtl column container: a 30px item in a 20px line sits flush with the left (cross-start), not the right (inline-start)' },
    ],
    nodes: [
      { branch: 'row-wrap-reverse', fixture: 'flex-wrap-reverse', node: 'am-a' },
      { branch: 'row-wrap-reverse', fixture: 'flex-wrap-reverse', node: 'am-b' },
      { branch: 'row-wrap-reverse', fixture: 'flex-wrap-reverse', node: 'am-c' },
      { branch: 'column-wrap-reverse', fixture: 'flex-wrap-reverse', node: 'amc-a' },
      { branch: 'column-wrap-reverse', fixture: 'flex-wrap-reverse', node: 'amc-b' },
      { branch: 'column-wrap-reverse', fixture: 'flex-wrap-reverse', node: 'amc-c' },
      { branch: 'column-wrap-reverse-rtl', fixture: 'flex-auto-margins-reverse-overflow', node: 'amr-a' },
      { branch: 'column-wrap-reverse-rtl', fixture: 'flex-auto-margins-reverse-overflow', node: 'amr-b' },
      { branch: 'column-wrap-reverse-rtl', fixture: 'flex-auto-margins-reverse-overflow', node: 'amr-c' },
    ],
  },
  {
    id: 'wrap-reverse-baseline-line',
    specSection: 'css-flexbox-1 §8.5',
    spec: "A flex container's first main-axis baseline comes from its first flex line: the shared baseline of that line's baseline-aligned items, or else the startmost item. Lines are numbered from cross-start, so under wrap-reverse the first line of a row container is the bottom one.",
    blink: 'Chrome 145 (measured) takes the baseline of a wrap-reverse row container from its block-start (top) line, the last flex line.',
    branches: [
      { id: 'shared-baseline', description: 'the top line has baseline-aligned items: the container baseline is their shared baseline, so a baseline-aligned sibling lines up with the top line' },
      { id: 'startmost-item', description: 'the top line has no baseline-aligned item: the container baseline is its first item in flow order' },
    ],
    nodes: [
      { branch: 'shared-baseline', fixture: 'flex-baseline-nested-reverse', node: 'f2a' },
      { branch: 'shared-baseline', fixture: 'flex-order-baseline-wrap-reverse', node: 'o3a' },
      { branch: 'startmost-item', fixture: 'flex-baseline-nested-reverse', node: 'f1a' },
      { branch: 'startmost-item', fixture: 'flex-baseline-nested-reverse', node: 'f4a' },
    ],
  },
];

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
];

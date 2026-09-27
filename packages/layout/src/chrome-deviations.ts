// Places where Chrome 145 departs from the spec text and the engine follows Chrome. Each entry names the fixture that proves
// it and one node per branch of the deviation; every node must match Chrome exactly at 1/64 px in the same run.

export type ChromeDeviation = {
  readonly id: string;
  readonly specSection: string;
  readonly spec: string;
  readonly blink: string;
  readonly fixture: string;
  /** Per branch of the deviation, a node whose exact 1/64 px match with Chrome distinguishes Blink from the spec text. */
  readonly nodes: readonly { readonly branch: string; readonly node: string }[];
};

export const chromeDeviations: readonly ChromeDeviation[] = [
  {
    id: 'half-leading-floor',
    specSection: 'CSS2 §10.8.1',
    spec: 'Half the leading (line-height minus the font height) is added above and below the glyphs.',
    blink: 'InlineBoxState CalculateLeadingSpace floors the top half-leading to a whole px; the bottom gets the rest.',
    fixture: 'text-ahem-single-line',
    nodes: [{ branch: 'odd leading: 10px Ahem in a 25px line puts the glyph box at 7px, not 7.5px', node: 't3:text0' }],
  },
  {
    id: 'min-max-end-margin',
    specSection: 'CSS2 §8.3.1, §10.6.3',
    spec: 'A parent with auto height and non-zero min-height does not collapse its bottom margin with its last child; that margin then counts toward the parent content height.',
    blink: 'Chrome 145 (measured) leaves the end margins out of the auto height; they collapse through the parent bottom when min/max-height leave the height unchanged and are dropped when min/max-height change it.',
    fixture: 'margin-collapse-min-height',
    nodes: [
      { branch: 'dropped: min-height 40px raises the 12px content height', node: 'p4' },
      { branch: 'collapsed through: min-height 5px leaves the 12px content height unchanged', node: 'p5' },
      { branch: 'dropped: max-height 8px lowers the 12px content height', node: 'p6' },
      { branch: 'collapsed through: max-height 100px leaves the 12px content height unchanged', node: 'p7' },
      { branch: 'dropped: min-height 20px raises the 12px content height, followed by a sibling top margin', node: 'p9' },
    ],
  },
];

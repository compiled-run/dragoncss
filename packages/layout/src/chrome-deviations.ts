// Places where Chrome 145 departs from the spec text and the engine follows Chrome. Each entry names the fixture that proves it.

export type ChromeDeviation = {
  readonly id: string;
  readonly specSection: string;
  readonly spec: string;
  readonly blink: string;
  readonly fixture: string;
  /** The node whose exact 1/64 px match with Chrome distinguishes Blink from the spec text. */
  readonly node: string;
};

export const chromeDeviations: readonly ChromeDeviation[] = [
  {
    id: 'half-leading-floor',
    specSection: 'CSS2 §10.8.1',
    spec: 'Half the leading (line-height minus the font height) is added above and below the glyphs.',
    blink: 'InlineBoxState CalculateLeadingSpace floors the top half-leading to a whole px; the bottom gets the rest.',
    fixture: 'text-ahem-single-line',
    node: 't3:text0',
  },
  {
    id: 'min-max-end-margin',
    specSection: 'CSS2 §8.3.1, §10.6.3',
    spec: 'A parent with auto height and non-zero min-height does not collapse its bottom margin with its last child; that margin then counts toward the parent content height.',
    blink: 'Chrome 145 (measured) leaves the end margins out of the auto height; they collapse through the parent bottom when min/max-height leave the height unchanged and are dropped when min/max-height change it.',
    fixture: 'margin-collapse-min-height',
    node: 'p9',
  },
];

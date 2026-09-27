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
];

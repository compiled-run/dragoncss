// Planted faults local to the forms reference functions; the Chrome comparison must catch each one.

export type FormFaults = {
  /** The thumb offset is added from the track's left edge in rtl too (range-geometry). */
  readonly thumbUnmirrored: boolean;
  /** A value exactly half-way between two step values rounds down instead of up (range-value). */
  readonly stepTieDown: boolean;
  /** Author background and border never devolve a themed control to CSS painting (appearance). */
  readonly devolveIgnored: boolean;
};

export const NO_FORM_FAULTS: FormFaults = { thumbUnmirrored: false, stepTieDown: false, devolveIgnored: false };

export const FORM_FAULT_NAMES: readonly (keyof FormFaults)[] = Object.keys(NO_FORM_FAULTS) as (keyof FormFaults)[];

/** The --plant names of the capture script, one per fault. */
export const FORM_PLANTS: Readonly<Record<string, keyof FormFaults>> = {
  'thumb-unmirrored': 'thumbUnmirrored',
  'step-tie-down': 'stepTieDown',
  'devolve-ignored': 'devolveIgnored',
};

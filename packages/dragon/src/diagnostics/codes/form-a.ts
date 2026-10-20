// FORM-a: a button or range input on a native target, drawn as Chrome draws it but not yet interactive or exposed as a control.
import { diagnosticFeature, manual } from '../entry.ts';

export const FORM_A = diagnosticFeature(
  [
    'DRAGON_CONTROL_STATIC_NATIVE',
  ],
  {
    DRAGON_CONTROL_STATIC_NATIVE: { severity: 'warning', message: 'This form control is drawn on iOS and Android but is not interactive and is not exposed to accessibility as a control.', why: 'Dragon compiles styles, not behaviour: like a link, a button needs the app to handle its activation, and a range shows the value it was compiled with, with no thumb drag. The native views carry no button or adjustable accessibility role yet, so a screen reader reads a button\'s label as static text.', computedWhy: null, fix: manual('Handle the control in the app', 'Attach the activation (or a value gesture for a range) and the accessibility role to the control\'s view in the app until Dragon emits them.') },
  },
);

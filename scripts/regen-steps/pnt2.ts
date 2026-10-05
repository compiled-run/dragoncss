// PNT2: transforms: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import { FIXTURES, FONTS, pnpm, type RegenFeature } from './step.ts';

export const PNT2: RegenFeature = {
  // Chrome's computed transform and content quads of every transforms case (transform-capture.ts), which pnt2-quads.test reads.
  steps: [{ after: 'ua', step: { name: 'quads', argv: pnpm('parity:quads-capture'), outputs: ['packages/parity/expected-quads/**'], reads: [FIXTURES, FONTS] } }],
  outputs: {},
  manual: [],
};

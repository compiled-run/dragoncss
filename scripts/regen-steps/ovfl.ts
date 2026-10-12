// OVFL: scroll containers: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import { FIXTURES, FONTS, pnpm, type RegenFeature } from './step.ts';

export const OVFL: RegenFeature = {
  // Chrome's scroll metrics of the overflow and viewport-prop cases, captured only in an overlay scrollbar environment (R2).
  steps: [{ after: 'dpr-capture', step: { name: 'scroll-capture', argv: pnpm('parity:scroll-capture'), outputs: ['packages/parity/expected-scroll/**'], reads: [FIXTURES, FONTS] } }],
  outputs: {},
  manual: [],
};

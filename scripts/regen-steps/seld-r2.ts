// SELD-R2: the interaction traces: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import { FIXTURES, FONTS, pnpm, type RegenFeature } from './step.ts';

export const SELD_R2: RegenFeature = {
  // R14: Chrome's trace of every interaction group (CDP mouse, touch, key and forced input); trace-report.test reads them.
  steps: [{ after: 'hit-capture', step: { name: 'trace-capture', argv: pnpm('parity:trace-capture'), outputs: ['packages/parity/expected-traces/*.trace.json'], reads: [FIXTURES, FONTS], lists: ['packages/parity/expected-traces'] } }],
  outputs: {},
  manual: [],
};

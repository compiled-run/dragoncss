// TDEC: text decoration: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import { FIXTURES, FONTS, pnpm, type RegenFeature } from './step.ts';

export const TDEC: RegenFeature = {
  // TDEC-a: Chrome's decorated and strip-rule renderings of every decorated web-only case at each DPR.
  steps: [{ after: 'pixel-capture', step: { name: 'decoration-capture', argv: pnpm('parity:decoration-capture'), outputs: ['packages/parity/expected-decorations/**'], reads: [FIXTURES, FONTS] } }],
  outputs: {},
  manual: [],
};

// REPL-r1: an img whose src the app sets at run time: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import { FIXTURES, FONTS, pnpm, type RegenFeature } from './step.ts';

export const REPL_R: RegenFeature = {
  // Chrome's capture of every runtimeSrc fixture once per sample image (runtime-samples.ts); replaced-runtime.test reads them.
  steps: [{ after: 'dpr-capture', step: { name: 'runtime-capture', argv: pnpm('parity:runtime-capture'), outputs: ['packages/parity/expected-runtime/**'], reads: [FIXTURES, FONTS] } }],
  outputs: {},
  manual: [],
};

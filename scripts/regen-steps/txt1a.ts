// TXT1a: Latin text in real fonts: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import type { RegenFeature } from './step.ts';

// TXT1a-2 folds the text-latin cases into FIXTURES: capture, dpr-capture and break-capture write their captures with every other
// case's, and vectors and dpr-vectors also write the text-latin vectors and shape transcripts (TXT1a-1 R3) at each DPR.
export const TXT1A: RegenFeature = {
  steps: [],
  outputs: {
    vectors: ['packages/layout/vectors/text-latin/dpr-1/**'],
    'dpr-vectors': ['packages/layout/vectors/text-latin/dpr-2/**', 'packages/layout/vectors/text-latin/dpr-3/**', 'packages/layout/vectors/text-latin/dpr-2.625/**'],
  },
  manual: [],
};

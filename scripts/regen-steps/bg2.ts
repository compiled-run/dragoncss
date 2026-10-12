// BG2: gradients: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import type { RegenFeature } from './step.ts';

export const BG2: RegenFeature = {
  steps: [],
  outputs: {},
  manual: [
    { command: 'none: the gradient paint-vector cases, written by hand with the engine they test (paint-gradient.ts)', outputs: ['packages/layout/paint-vectors/gradient/inputs.jsonl'] },
    // R3: the capture host's libm, probed by a C program on darwin-arm64 (regen-on-CI runs on ubuntu).
    { command: 'pnpm libm:capture (on the darwin-arm64 capture host)', outputs: ['packages/dragon/src/paint-data/libm-darwin-arm64.generated.ts'] },
  ],
};

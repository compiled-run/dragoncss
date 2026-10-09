// BG2: gradients: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import type { RegenFeature } from './step.ts';

export const BG2: RegenFeature = {
  steps: [],
  outputs: {},
  manual: [{ command: 'none: the gradient paint-vector cases, written by hand with the engine they test (paint-gradient.ts)', outputs: ['packages/layout/paint-vectors/gradient/inputs.jsonl'] }],
};

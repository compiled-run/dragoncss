// PNT1: the radius, shadow, effects, stacking and outline paint modules: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import type { RegenFeature } from './step.ts';

export const PNT1: RegenFeature = {
  // The radius and shadow paint-vector inputs (paint-radius.ts and paint-shadow.ts cases through the harness), from their
  // generators; paint-vectors reads them.
  steps: [
    { after: 'anim-vectors', step: { name: 'paint-inputs-radius', argv: ['node', 'scripts/gen-paint-inputs-radius.ts'], outputs: ['packages/layout/paint-vectors/radius/inputs.jsonl'] } },
    { after: 'paint-inputs-radius', step: { name: 'paint-inputs-shadow', argv: ['node', 'scripts/gen-paint-inputs-shadow.ts'], outputs: ['packages/layout/paint-vectors/shadow/inputs.jsonl'] } },
  ],
  outputs: {},
  manual: [],
};

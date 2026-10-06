// CASC: cascade breadth: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import type { RegenFeature } from './step.ts';

export const CASC: RegenFeature = {
  steps: [],
  outputs: {},
  manual: [{ command: 'scripts/capture-property-names.ts', outputs: ['packages/dragon/src/css/property-names.generated.ts'] }],
};

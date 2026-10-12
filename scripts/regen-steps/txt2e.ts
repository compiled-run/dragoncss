// TXT2-e: text-transform: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import type { RegenFeature } from './step.ts';

export const TXT2E: RegenFeature = {
  steps: [],
  outputs: {},
  manual: [
    // The Unicode 16.0.0 case and word data, from the pinned UCD files (each checked by its SHA-256).
    { command: 'pnpm run case:gen', outputs: ['packages/dragon/src/analysis/case-data.generated.ts'] },
  ],
};

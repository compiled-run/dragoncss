// Markless native styles: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import { FIXTURES, FONTS, pnpm, type RegenFeature } from './step.ts';

export const MARKLESS_STYLES: RegenFeature = {
  // The ladder's native style exports carry the compile digest, which moves with the profiles profile-rows writes.
  // Each layout plan is read back through the translated harness, which markless-plan.ts loads by path.
  steps: [{ after: 'profile-rows', step: { name: 'markless-styles', argv: pnpm('native:style-export'), outputs: ['examples/markless-styles/out/**'], reads: [FIXTURES, FONTS], imports: ['packages/translate/harness/harness.ts'] } }],
  outputs: {},
  manual: [],
};

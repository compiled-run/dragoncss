// TXT1a: Latin text in real fonts: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import { FIXTURES, FONTS, type RegenFeature } from './step.ts';

export const TXT1A: RegenFeature = {
  // The text-latin vectors and their shape transcripts, from the committed text-latin captures (TXT1a-1, R3).
  steps: [{ after: 'dpr-vectors', step: { name: 'text-latin-vectors', argv: ['node', '--conditions=dragon-internal', 'packages/parity/src/cli/text-latin-capture.ts', '--vectors'], outputs: ['packages/layout/vectors/text-latin/**'], reads: [FIXTURES, FONTS, 'packages/parity/expected-text-latin/**'] } }],
  outputs: {},
  manual: [{ command: 'node --conditions=dragon-internal packages/parity/src/cli/text-latin-capture.ts (TXT1a-1; TXT1a-2 moves the captures into the regen steps)', outputs: ['packages/parity/expected-text-latin/**'] }],
};

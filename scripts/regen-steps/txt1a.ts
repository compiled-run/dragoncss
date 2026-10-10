// TXT1a: Latin text in real fonts: its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import { FIXTURES, FONTS, type RegenFeature } from './step.ts';

const CLI = 'packages/parity/src/cli/text-latin-capture.ts';

export const TXT1A: RegenFeature = {
  steps: [
    // The text-latin registry's Chrome captures, breaks and emitted CSS at every DPR, live (the web-only registries' captures, as
    // capture writes expected-fonts and expected-env); profile:rows reads them (expected-*).
    { after: 'capture', step: { name: 'text-latin-capture', argv: ['node', '--conditions=dragon-internal', CLI], outputs: ['packages/parity/expected-text-latin/**'], reads: [FIXTURES, FONTS] } },
    // The text-latin vectors and their shape transcripts, from the committed text-latin captures (TXT1a-1, R3).
    { after: 'dpr-vectors', step: { name: 'text-latin-vectors', argv: ['node', '--conditions=dragon-internal', CLI, '--vectors'], outputs: ['packages/layout/vectors/text-latin/**'], reads: [FIXTURES, FONTS, 'packages/parity/expected-text-latin/**'] } },
  ],
  outputs: {},
  manual: [],
};

// MQ-R1 (notes/T067 R4, R7 (a)): the resize traces (Chrome through setViewportSize) of the media-runtime scripts run right after
// capture and so before profile-rows, which reads them: the media rows it derives from them gate native @media in every later
// step's enforce-mode compile. The band suite's vectors run after hit-vectors, before native-gen reads them.
import { FIXTURES, FONTS, pnpm, type RegenFeature } from './step.ts';

export const MQ_R1: RegenFeature = {
  steps: [
    { after: 'capture', step: { name: 'resize-capture', argv: pnpm('parity:resize-capture'), outputs: ['packages/parity/expected-resize/**'], reads: [FIXTURES, FONTS] } },
    // The band suite's vectors: every media fixture's band table at root sizes around its thresholds; native-gen reads them.
    { after: 'hit-vectors', step: { name: 'band-vectors', argv: pnpm('parity:band-vectors'), outputs: ['packages/layout/rt-vectors/band/**'], reads: [FIXTURES, FONTS] } },
  ],
  outputs: {},
  manual: [],
};

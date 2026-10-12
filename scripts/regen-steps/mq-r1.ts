// MQ-R1 (notes/T067 R7 (a)): the resize traces (Chrome through setViewportSize) of the media-runtime scripts. They run right after
// capture and so before profile-rows, which reads them: the media rows it derives from them gate native @media in every later
// step's enforce-mode compile.
import { FIXTURES, FONTS, pnpm, type RegenFeature } from './step.ts';

export const MQ_R1: RegenFeature = {
  steps: [{ after: 'capture', step: { name: 'resize-capture', argv: pnpm('parity:resize-capture'), outputs: ['packages/parity/expected-resize/**'], reads: [FIXTURES, FONTS] } }],
  outputs: {},
  manual: [],
};

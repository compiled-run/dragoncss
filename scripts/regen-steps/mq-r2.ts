// MQ-R2 (notes/T067 R9, §4): the pointer suite's vectors, Chromium's own Java rule over every input device set (a JDK through
// JAVA_HOME, which the heavy lease exports), run beside the band suite's vectors and before native-gen reads them.
import { ENGINE_SOURCES, pnpm, type RegenFeature } from './step.ts';

export const MQ_R2: RegenFeature = {
  steps: [
    { after: 'band-vectors', step: { name: 'pointer-vectors', argv: pnpm('parity:pointer-vectors'), outputs: ['packages/layout/rt-vectors/pointer/**'], reads: ['packages/parity/java/**', ...ENGINE_SOURCES] } },
  ],
  outputs: {},
  manual: [],
};

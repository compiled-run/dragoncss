// MQ-R2 (notes/T067 R9, §4): the pointer suite's vectors are Chromium's own Java rule over every input device set. They need a JDK,
// which regen-on-ci's Chrome-side round has none of, so they are a MANUAL output: written by parity:pointer-vectors and held to the
// rule by pointer-vectors.test.ts (the port) and the translate corpus's pointer suite (Swift and Kotlin).
import type { RegenFeature } from './step.ts';

export const MQ_R2: RegenFeature = {
  steps: [],
  outputs: {},
  manual: [{ command: 'JAVA_HOME=<a JDK> pnpm run parity:pointer-vectors', outputs: ['packages/layout/rt-vectors/pointer/**'] }],
};

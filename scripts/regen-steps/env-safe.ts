// ENV-SAFE: env(safe-area-inset-*): its regen steps, extra outputs and MANUAL entries (scripts/regen.ts).
import type { RegenFeature } from './step.ts';

// parity:capture also writes the web-only env() captures and emitted CSS (packages/parity/src/env-run.ts).
export const ENV_SAFE: RegenFeature = { steps: [], outputs: { capture: ['packages/parity/expected-env/**'] }, manual: [] };

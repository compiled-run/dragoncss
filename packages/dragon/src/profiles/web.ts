import type { SupportProfile } from './types.ts';

/** Web has no Dragon emitter or web lane until S2, so nothing is proven and every feature is unsupported. */
export const webProfile: SupportProfile = { target: 'web', revision: 'm1-s1', rows: [] };

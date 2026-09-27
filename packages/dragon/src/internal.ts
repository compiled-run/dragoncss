// Internal entry for the parity harness, selected by the "dragon-internal" export condition. Not a public API.
import type { LayoutInput } from '@dragon/layout';
import { internalRecord } from './project.ts';
import type { Target } from './types.ts';

export * from './index.ts';
export { createProjectWith, COMPILER_VERSION } from './project.ts';
export type { InternalOptions } from './project.ts';
export type { LoweringFaults } from './lower/ios-layout.ts';
export { NO_FAULTS, REFERENCE_DEVICE_PIXEL_RATIO } from './lower/ios-layout.ts';
export { iosProfile } from './profiles/ios.ts';
export { webProfile } from './profiles/web.ts';
export type { Proof, ProfileRow, SupportProfile } from './profiles/types.ts';
export { statusOf } from './profiles/types.ts';
export { sha256Hex } from './digest.ts';
export { chromeVersion } from './ua/chrome-145.generated.ts';

export type LayoutProjection =
  | { readonly kind: 'ready'; readonly input: LayoutInput }
  | { readonly kind: 'blocked'; readonly reason: string };

/** The ios backend's layout projection for one environment; only a checked ios output has one. */
export function iosLayoutProjection(compiled: object, viewport: { readonly width: number; readonly height: number }): LayoutProjection {
  const record = internalRecord(compiled);
  if (record === undefined) return { kind: 'blocked', reason: 'not a compiled result from this package' };
  if (record.iosLayout === null) return { kind: 'blocked', reason: 'the ios output is blocked or not configured' };
  return { kind: 'ready', input: { viewport: { width: viewport.width, height: viewport.height }, root: record.iosLayout } };
}

/** Profile features the authored CSS used, per target, sorted. */
export function compiledFeatures(compiled: object, target: Target): readonly string[] {
  const record = internalRecord(compiled);
  if (record === undefined) return [];
  const f = record.featuresByTarget.get(target);
  return f === undefined ? [] : f;
}

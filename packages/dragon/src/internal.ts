// Internal entry for the parity harness, selected by the "dragon-internal" export condition. Not a public API.
import type { LayoutInput } from '@dragon/layout';
import type { ResolvedElement } from './analysis/resolve.ts';
import type { Rgba8 } from './css/color.ts';
import { TRANSPARENT } from './css/color.ts';
import type { ColorLonghand } from './css/properties.ts';
import { COLOR_LONGHANDS } from './css/properties.ts';
import { internalRecord } from './project.ts';
import type { Target } from './types.ts';

export * from './index.ts';
export { createProjectWith, COMPILER_VERSION } from './project.ts';
export type { InternalOptions } from './project.ts';
export type { CompilerFaults } from './faults.ts';
export { NO_FAULTS } from './faults.ts';
export { iosProfile } from './profiles/ios.ts';
export { webProfile } from './profiles/web.ts';
export type { Proof, ProofAspect, ProofLane, ProfileRow, SupportProfile } from './profiles/types.ts';
export { statusOf } from './profiles/types.ts';
export { sha256Hex } from './digest.ts';
export { chromeVersion } from './ua/chrome-145.generated.ts';
export type { ColorLonghand, Longhand } from './css/properties.ts';
export { COLOR_LONGHANDS, LONGHANDS } from './css/properties.ts';
export type { Rgba8 } from './css/color.ts';
export { parseComputedColor, serializeColor } from './css/color.ts';
export { WEB_CSS_PATH } from './emit/web-css.ts';

/** The reference environment of one parity case (docs/api.md §7): viewport and device pixel ratio are inputs, not constants. */
export type Environment = {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
};

export type LayoutProjection =
  | { readonly kind: 'ready'; readonly input: LayoutInput }
  | { readonly kind: 'blocked'; readonly reason: string };

/** The ios backend's layout projection for one environment; only a checked ios output has one. */
export function iosLayoutProjection(compiled: object, environment: Environment): LayoutProjection {
  const record = internalRecord(compiled);
  if (record === undefined) return { kind: 'blocked', reason: 'not a compiled result from this package' };
  if (record.iosLowered === null) return { kind: 'blocked', reason: 'the ios output is blocked or not configured' };
  return {
    kind: 'ready',
    input: {
      viewport: { width: environment.viewport.width, height: environment.viewport.height },
      devicePixelRatio: environment.devicePixelRatio,
      root: record.iosLowered,
    },
  };
}

/** Profile features the authored CSS used, per target, sorted. */
export function compiledFeatures(compiled: object, target: Target): readonly string[] {
  const record = internalRecord(compiled);
  if (record === undefined) return [];
  const f = record.featuresByTarget.get(target);
  return f === undefined ? [] : f;
}

/** Element id to the class the web output generated for it; null unless the web output is ready. */
export function webClassMap(compiled: object): ReadonlyMap<string, string> | null {
  const record = internalRecord(compiled);
  return record === undefined ? null : record.webClassOf;
}

export type ElementColors = { readonly [P in ColorLonghand]: Rgba8 };

// css-color-4 §4.4 and §6.3: used colours per element; transparent is rgba(0, 0, 0, 0) and currentcolor is the element's color.
function usedColors(el: ResolvedElement): ElementColors {
  const color = el.props.get('color');
  if (color === undefined || color.value.kind !== 'color') throw new Error(`${el.node.id}: color did not resolve to channels`);
  const own = color.value.value;
  const out = {} as { [P in ColorLonghand]: Rgba8 };
  for (const p of COLOR_LONGHANDS) {
    const v = (el.props.get(p) as NonNullable<typeof color>).value;
    if (v.kind === 'color') out[p] = v.value;
    else if (v.kind === 'keyword' && v.value === 'transparent') out[p] = TRANSPARENT;
    else if (v.kind === 'keyword' && v.value === 'currentcolor') out[p] = own;
    else throw new Error(`${el.node.id}: ${p} did not resolve to a colour`);
  }
  return out;
}

/** Dragon's resolved colour channels per element id; null when the input did not resolve. */
export function resolvedColors(compiled: object): ReadonlyMap<string, ElementColors> | null {
  const record = internalRecord(compiled);
  if (record === undefined || record.resolved === null) return null;
  const out = new Map<string, ElementColors>();
  const walk = (el: ResolvedElement): void => {
    out.set(el.node.id, usedColors(el));
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(record.resolved);
  return out;
}

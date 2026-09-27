// Internal entry for the parity harness, selected by the "dragon-internal" export condition. Not a public API.
import type { LayoutInput } from '@dragon/layout';
import type { ResolvedElement } from './analysis/resolve.ts';
import type { Rgba8 } from './css/color.ts';
import { TRANSPARENT } from './css/color.ts';
import type { ColorLonghand } from './css/properties.ts';
import { COLOR_LONGHANDS } from './css/properties.ts';
import type { InternalCase } from './project.ts';
import { caseByAssignment, internalRecord } from './project.ts';
import type { Assignment, Target } from './types.ts';

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
export { COLOR_LONGHANDS, LONGHANDS, PROPERTY_ASPECTS, PROPERTY_ROLE } from './css/properties.ts';
export type { Rgba8 } from './css/color.ts';
export { parseComputedColor, serializeColor } from './css/color.ts';
export { WEB_CSS_PATH } from './emit/web-css.ts';
export { CATALOGUE } from './diagnostics/catalogue.ts';
export type { CatalogueEntry } from './diagnostics/catalogue.ts';
export { DIAGNOSTIC_CODES } from './diagnostics/codes.ts';
export { applyFix } from './diagnostics/fix.ts';
export type { FixResult } from './diagnostics/fix.ts';
export { MAX_STATE_ASSIGNMENTS, assignmentKey } from './analysis/link.ts';
export type { FormattingContext } from './analysis/context.ts';

/** The reference environment of one parity case (docs/api.md §7): viewport and device pixel ratio are inputs, not constants. */
export type Environment = {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
};

export type LayoutProjection =
  | { readonly kind: 'ready'; readonly input: LayoutInput }
  | { readonly kind: 'blocked'; readonly reason: string };

function caseOf(compiled: object, assignment: Assignment): InternalCase | string {
  const record = internalRecord(compiled);
  if (record === undefined) return 'not a compiled result from this package';
  const c = caseByAssignment(record, assignment);
  return c === undefined ? `no reachable case for the assignment ${JSON.stringify(assignment)}` : c;
}

/** Dragon's reachable assignments, in its enumeration order, with the initial case marked. */
export function compiledCases(compiled: object): readonly { readonly assignment: Assignment; readonly isInitial: boolean }[] {
  const record = internalRecord(compiled);
  return record === undefined ? [] : record.cases.map((c) => ({ assignment: c.assignment, isInitial: c.isInitial }));
}

/** The ios backend's layout projection of one case for one environment; only a checked ios output has one. */
export function iosLayoutProjection(compiled: object, environment: Environment, assignment: Assignment): LayoutProjection {
  const c = caseOf(compiled, assignment);
  if (typeof c === 'string') return { kind: 'blocked', reason: c };
  if (c.iosLowered === null) return { kind: 'blocked', reason: 'the ios output is blocked or not configured' };
  return {
    kind: 'ready',
    input: {
      viewport: { width: environment.viewport.width, height: environment.viewport.height },
      devicePixelRatio: environment.devicePixelRatio,
      root: c.iosLowered,
    },
  };
}

/** Profile row keys ("<feature>@<context>") the case uses on a target, sorted. */
export function compiledFeatures(compiled: object, target: Target, assignment: Assignment): readonly string[] {
  const c = caseOf(compiled, assignment);
  if (typeof c === 'string') return [];
  const f = c.features.get(target);
  return f === undefined ? [] : f;
}

/** Element address to the web class of its resolved variant in this case; null unless the web output is ready. */
export function webClassMap(compiled: object, assignment: Assignment): ReadonlyMap<string, string> | null {
  const c = caseOf(compiled, assignment);
  return typeof c === 'string' ? null : c.webClassOf;
}

export type ElementColors = { readonly [P in ColorLonghand]: Rgba8 };

// css-color-4 §4.4 and §6.3: used colours per element; transparent is rgba(0, 0, 0, 0) and currentcolor is the element's color.
function usedColors(el: ResolvedElement): ElementColors {
  const color = el.props.get('color');
  if (color === undefined || color.value.kind !== 'color') throw new Error(`${el.element.address}: color did not resolve to channels`);
  const own = color.value.value;
  const out = {} as { [P in ColorLonghand]: Rgba8 };
  for (const p of COLOR_LONGHANDS) {
    const v = (el.props.get(p) as NonNullable<typeof color>).value;
    if (v.kind === 'color') out[p] = v.value;
    else if (v.kind === 'keyword' && v.value === 'transparent') out[p] = TRANSPARENT;
    else if (v.kind === 'keyword' && v.value === 'currentcolor') out[p] = own;
    else throw new Error(`${el.element.address}: ${p} did not resolve to a colour`);
  }
  return out;
}

/** Dragon's resolved colour channels per element address in one case; null when the case did not resolve. */
export function resolvedColors(compiled: object, assignment: Assignment): ReadonlyMap<string, ElementColors> | null {
  const c = caseOf(compiled, assignment);
  if (typeof c === 'string' || c.resolved === null) return null;
  const out = new Map<string, ElementColors>();
  const walk = (el: ResolvedElement): void => {
    out.set(el.element.address, usedColors(el));
    for (const ch of el.children) if (ch.kind === 'element') walk(ch);
  };
  walk(c.resolved);
  return out;
}

// Internal entry for the parity harness, selected by the "dragon-internal" export condition. Not a public API.
import type { LayoutInput } from '@dragon/layout';
import type { TextContext } from './analysis/context.ts';
import type { RootFont } from './analysis/resolve.ts';
import { textContext } from './analysis/context.ts';
import type { ResolvedElement } from './analysis/resolve.ts';
import type { Rgba8 } from './css/color.ts';
import type { CssValue } from './css/stylesheet.ts';
import { TRANSPARENT } from './css/color.ts';
import type { ColorLonghand, TextLonghand } from './css/properties.ts';
import { COLOR_LONGHANDS, TEXT_LONGHANDS } from './css/properties.ts';
import type { InternalCase } from './project.ts';
import { caseByAssignment, internalRecord, originOfValue } from './project.ts';
import { webrefVersion } from './css/grammar.generated.ts';
import type { Assignment, Origin, Target } from './types.ts';

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
export { chromeVersion } from './ua/chrome-145.darwin-arm64.generated.ts';
export type { UaDataset, UaDatasetChoice } from './ua/datasets.ts';
export { REFERENCE_PLATFORM, ReferencePlatformUnavailable, referenceDataset, uaDatasetFor } from './ua/datasets.ts';
export type { RootFont } from './analysis/resolve.ts';
export { COMMITTED_PROFILES } from './project.ts';
export type { SupportProfiles } from './project.ts';
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
export type { FormattingContext, TextContext } from './analysis/context.ts';
export { TEXT_LONGHANDS } from './css/properties.ts';
export type { TextLonghand } from './css/properties.ts';

/**
 * The reference environment of one parity case (docs/api.md §7): viewport, device pixel ratio and direction are inputs, not
 * constants. direction is resolved into the compiled result (InternalOptions.direction); the projection must name the same one.
 */
export type Environment = {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly direction: 'ltr' | 'rtl';
  /** The root font of the environment: 'ahem' in the parity fixture environment, 'ua-default' for fixtures that compare UA fonts. */
  readonly rootFont: RootFont;
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
  const record = internalRecord(compiled) as NonNullable<ReturnType<typeof internalRecord>>;
  if (record.direction !== environment.direction) return { kind: 'blocked', reason: `the result was resolved for direction ${record.direction}, not ${environment.direction}` };
  if (record.rootFont !== environment.rootFont) return { kind: 'blocked', reason: `the result was resolved for root font ${record.rootFont}, not ${environment.rootFont}` };
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
  if (color === undefined) throw new Error(`${el.element.address}: color did not resolve`);
  const own = colorChannels(color.value, el.element.address);
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

/** The channels of a resolved color value: a colour, or transparent (rgba(0, 0, 0, 0)); currentcolor on color resolves as inherit. */
function colorChannels(v: CssValue, address: string): Rgba8 {
  if (v.kind === 'color') return v.value;
  if (v.kind === 'keyword' && v.value === 'transparent') return TRANSPARENT;
  throw new Error(`${address}: color did not resolve to channels`);
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

/** One laid-out text node of a case (docs/api.md §10, projected literal text): who authored it and where it is inserted. */
export type TextTopologyEntry = {
  readonly address: string;
  /** The component whose template authored the text, and the template node id. */
  readonly component: string;
  readonly template: string;
  readonly origin: Origin;
  /** The instance that authored the text: projected text keeps its caller's. */
  readonly ownerInstance: string;
  /** The element the text is inserted under in the logical tree; its inherited styles come from here. */
  readonly insertionParent: string;
  readonly context: TextContext;
  readonly inherited: { readonly [P in TextLonghand]: Origin };
};

/** The text topology of one case, in document order: every text node that survives white-space collapsing. */
export function textTopology(compiled: object, assignment: Assignment): readonly TextTopologyEntry[] | null {
  const c = caseOf(compiled, assignment);
  if (typeof c === 'string' || c.resolved === null) return null;
  const root = c.resolved;
  const record = internalRecord(compiled) as NonNullable<ReturnType<typeof internalRecord>>;
  const out: TextTopologyEntry[] = [];
  const walk = (el: ResolvedElement, parent: ResolvedElement | null): void => {
    for (const ch of el.children) {
      if (ch.kind === 'element') {
        walk(ch, el);
        continue;
      }
      const inherited = {} as { [P in TextLonghand]: Origin };
      for (const p of TEXT_LONGHANDS) {
        const v = ch.props.get(p);
        inherited[p] = v !== undefined && v.origin === 'inherited'
          ? { kind: 'inherited', element: el.element.address, from: originOfValue(record, root, el.element.address, p) }
          : { kind: 'builtin', dataset: `@webref/css ${webrefVersion} initial`, entry: p };
      }
      out.push({
        address: ch.node.address,
        component: ch.node.owner,
        template: ch.node.node.id,
        origin: ch.node.node.origin,
        ownerInstance: ch.node.instance,
        insertionParent: el.element.address,
        context: textContext(el, parent),
        inherited,
      });
    }
  };
  walk(root, null);
  return out;
}

/** Dragon's resolved colour channels of every laid-out text node in one case, keyed by text address. */
export function resolvedTextColors(compiled: object, assignment: Assignment): ReadonlyMap<string, Rgba8> | null {
  const c = caseOf(compiled, assignment);
  if (typeof c === 'string' || c.resolved === null) return null;
  const out = new Map<string, Rgba8>();
  const walk = (el: ResolvedElement): void => {
    for (const ch of el.children) {
      if (ch.kind === 'element') walk(ch);
      else {
        const v = ch.props.get('color');
        if (v === undefined) throw new Error(`${ch.node.address}: color did not resolve`);
        out.set(ch.node.address, colorChannels(v.value, ch.node.address));
      }
    }
  };
  walk(c.resolved);
  return out;
}

// Internal entry for the parity harness, selected by the "dragon-internal" export condition. Not a public API.
import type { LayoutInput } from '@dragon/layout';
import type { TextContext } from './analysis/context.ts';
import type { RootFont } from './analysis/resolve.ts';
import { textContext } from './analysis/context.ts';
import type { ResolvedElement } from './analysis/resolve.ts';
import type { Rgba8 } from './css/color.ts';
import type { TextLonghand } from './css/properties.ts';
import { TEXT_LONGHANDS } from './css/properties.ts';
import type { ElementColors, NativeBackend, NativeProgram } from './lower/native-program.ts';
import { colorChannels, lowerNativePrograms, ProgramError, usedColors } from './lower/native-program.ts';
import { rootFontSizeOf } from './lower/ios-layout.ts';
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
export { androidProfile } from './profiles/android.ts';
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
export { BACKGROUND_RESET_LONGHANDS } from './css/properties/background.ts';
export type { BackgroundResetLonghand } from './css/properties/background.ts';
export { WRITING_MODE_RESET_LONGHANDS } from './css/properties/writing-mode.ts';
export type { WritingModeResetLonghand } from './css/properties/writing-mode.ts';
export type { Rgba8 } from './css/color.ts';
export { parseComputedColor, serializeColor } from './css/color.ts';
export { WEB_CSS_PATH } from './emit/web-css.ts';
export type { AtRuleContext } from './css/at-rules.ts';
export { preprocessInput } from './css/escapes.ts';
export { parseStylesheet } from './css/stylesheet.ts';
export { collectFontFaces } from './fonts/wire.ts';
export { CATALOGUE } from './diagnostics/catalogue.ts';
export type { CatalogueEntry } from './diagnostics/catalogue.ts';
export { DIAGNOSTIC_CODES } from './diagnostics/codes.ts';
export { applyFix } from './diagnostics/fix.ts';
export type { FixResult } from './diagnostics/fix.ts';
export { MAX_STATE_ASSIGNMENTS, assignmentKey } from './analysis/link.ts';
export type { FormattingContext, TextContext } from './analysis/context.ts';
export { TEXT_LONGHANDS } from './css/properties.ts';
export type { TextLonghand } from './css/properties.ts';
export type { BorderStyleName, NativeBackend, NativeProgram, ProgramNode, ProgramWrite, Technique, WriteKind } from './lower/native-program.ts';
export { BACKEND_TARGET, NATIVE_BACKENDS, NATIVE_CLASSES, PROGRAM_VERSIONS, VOCABULARY, WRITE_CSS } from './lower/native-program.ts';
export type { ExpectedDump, ExpectedEngine, ExpectedNode, NodeGeometry } from './emit/expected-dump.ts';
export { appliedKeyMap, appliedValue, borderDevicePx, cssCoverage, EXPECTED_SCHEMA, expectedDigest, expectedDump, programInput, textInstanceSize } from './emit/expected-dump.ts';
export type { EmitCase } from './emit/native-support.ts';
export { emitNativeSupport, NATIVE_SUPPORT_VERSION, SUPPORT_FILES, SUPPORT_PLANTS } from './emit/native-support.ts';
export type { SupportPlant } from './emit/native-support.ts';
export { emitUikitCases, UIKIT_EMITTER_VERSION } from './emit/uikit.ts';
export { emitAndroidViewsCases, ANDROID_VIEWS_EMITTER_VERSION } from './emit/android-views.ts';
export { ANDROID_MIN_SDK } from './project.ts';

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

/**
 * The native layout projection of one case for one environment, shared by every native target (native-strategy.md 3.9 item 13):
 * one lowered tree from the checked native output, so ios and android lay out the same engine input.
 */
export function nativeLayoutProjection(compiled: object, environment: Environment, assignment: Assignment): LayoutProjection {
  const c = caseOf(compiled, assignment);
  if (typeof c === 'string') return { kind: 'blocked', reason: c };
  const record = internalRecord(compiled) as NonNullable<ReturnType<typeof internalRecord>>;
  if (record.direction !== environment.direction) return { kind: 'blocked', reason: `the result was resolved for direction ${record.direction}, not ${environment.direction}` };
  if (record.rootFont !== environment.rootFont) return { kind: 'blocked', reason: `the result was resolved for root font ${record.rootFont}, not ${environment.rootFont}` };
  if (c.nativeLowered === null) return { kind: 'blocked', reason: 'the ios output is blocked or not configured' };
  if (c.resolved === null) return { kind: 'blocked', reason: 'the case did not resolve' };
  const viewport = { width: environment.viewport.width, height: environment.viewport.height };
  // The environment inputs are explicit literals of the reference environment: every viewport unit reads the viewport, no safe
  // area, and the compiler's root font size at text scale 1 (hosts read the real environment; notes/T012-v2-spec.md V2b).
  return {
    kind: 'ready',
    input: {
      viewport,
      devicePixelRatio: environment.devicePixelRatio,
      viewportUnits: { small: viewport, large: viewport, dynamic: viewport },
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      rootFontSize: rootFontSizeOf(c.resolved),
      root: c.nativeLowered,
    },
  };
}

/** The ios backend's layout projection: the shared native projection. */
export function iosLayoutProjection(compiled: object, environment: Environment, assignment: Assignment): LayoutProjection {
  return nativeLayoutProjection(compiled, environment, assignment);
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

export type { ElementColors } from './lower/native-program.ts';

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

export type NativePrograms =
  | { readonly kind: 'ready'; readonly programs: { readonly [B in NativeBackend]: NativeProgram } }
  | { readonly kind: 'blocked'; readonly reason: string };

/**
 * Both native backends' lowered programs of one case (docs/research/native-strategy.md 1.1): from the one nativeLowered tree and
 * the case's resolved paint values. Ready only when the result configures and checks both ios and android.
 */
export function nativePrograms(compiled: object, assignment: Assignment): NativePrograms {
  const c = caseOf(compiled, assignment);
  if (typeof c === 'string') return { kind: 'blocked', reason: c };
  const targets = (compiled as { targets?: Record<string, string> }).targets ?? {};
  for (const t of ['ios', 'android']) if (targets[t] !== 'checked') return { kind: 'blocked', reason: `the ${t} target is ${targets[t] === undefined ? 'not configured' : targets[t]}` };
  if (c.nativeLowered === null || c.resolved === null) return { kind: 'blocked', reason: 'the case has no native lowering' };
  try {
    return { kind: 'ready', programs: lowerNativePrograms(c.nativeLowered, c.resolved) };
  } catch (e) {
    if (e instanceof ProgramError) return { kind: 'blocked', reason: e.message };
    throw e;
  }
}

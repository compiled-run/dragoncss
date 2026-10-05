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
import { colorChannels, lowerNativePrograms, movingTransforms, ProgramError, usedColors } from './lower/native-program.ts';
import { rootFontSizeOf } from './lower/ios-layout.ts';
import type { InteractionPartition } from './analysis/interaction.ts';
import type { InternalCase } from './project.ts';
import { caseByAssignment, internalRecord, originOfValue } from './project.ts';
import { webrefVersion } from './css/grammar.generated.ts';
import type { Assignment, Origin, Target } from './types.ts';

// The public API without createProject, whose committed lanes verdict (create-project.ts) the harness passes itself.
export * from './api.ts';
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
export { appliedKeyMap, appliedValue, borderDevicePx, cssCoverage, EXPECTED_SCHEMA, expectedDigest, expectedDump, programInput, replacedGeometries, textInstanceSize } from './emit/expected-dump.ts';
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

/**
 * One case, or one of its interaction states (SELD-R2a) when state names a partition state key: the state's resolution and
 * lowering replace the case's. null is the case itself (the none state).
 */
function caseOf(compiled: object, assignment: Assignment, state: string | null = null): InternalCase | string {
  const record = internalRecord(compiled);
  if (record === undefined) return 'not a compiled result from this package';
  const c = caseByAssignment(record, assignment);
  if (c === undefined) return `no reachable case for the assignment ${JSON.stringify(assignment)}`;
  if (state === null) return c;
  const i = c.interaction.find((x) => x.value.key === state);
  return i === undefined ? `no interaction state ${state} in the case ${JSON.stringify(assignment)}` : { ...c, resolved: i.resolved, nativeLowered: i.nativeLowered };
}

/** The interaction partition of one case (SELD-R2a): its candidates, its states but none and its per-element state tables. */
export function interactionPartitionOf(compiled: object, assignment: Assignment): InteractionPartition | null {
  const c = caseOf(compiled, assignment);
  return typeof c === 'string' ? null : c.partition;
}

/** SELD-R2: whether a compile outside the parity lanes refuses this document on the native target (interactionLanes). */
export function laneOnlyNative(compiled: object, target: 'ios' | 'android'): boolean {
  return internalRecord(compiled)?.laneOnlyNative.includes(target) === true;
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
export function nativeLayoutProjection(compiled: object, environment: Environment, assignment: Assignment, state: string | null = null): LayoutProjection {
  const c = caseOf(compiled, assignment, state);
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
export function resolvedColors(compiled: object, assignment: Assignment, state: string | null = null): ReadonlyMap<string, ElementColors> | null {
  const c = caseOf(compiled, assignment, state);
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
export function resolvedTextColors(compiled: object, assignment: Assignment, state: string | null = null): ReadonlyMap<string, Rgba8> | null {
  const c = caseOf(compiled, assignment, state);
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
 * The elements whose transform changes at run time: between any two reachable assignments, and (MQ-R1) between any two @media
 * bands, since native switches bands at run time; so an img under one gets the direct draw in every band's program. Transitions and
 * animations come from the fold band's analysis: native refuses those that differ between bands.
 */
function movingOf(record: NonNullable<ReturnType<typeof internalRecord>>): ReadonlySet<string> {
  const resolved = record.bands === null ? record.cases.map((x) => x.resolved) : record.bands.cases.flat().map((x) => x.resolved);
  return movingTransforms(resolved, record.animation);
}

/**
 * Both native backends' lowered programs of one case (docs/research/native-strategy.md 1.1): from the one nativeLowered tree and
 * the case's resolved paint values. Ready only when the result configures and checks both ios and android.
 */
export function nativePrograms(compiled: object, assignment: Assignment, state: string | null = null): NativePrograms {
  const c = caseOf(compiled, assignment, state);
  if (typeof c === 'string') return { kind: 'blocked', reason: c };
  const targets = (compiled as { targets?: Record<string, string> }).targets ?? {};
  for (const t of ['ios', 'android']) if (targets[t] !== 'checked') return { kind: 'blocked', reason: `the ${t} target is ${targets[t] === undefined ? 'not configured' : targets[t]}` };
  if (c.nativeLowered === null || c.resolved === null) return { kind: 'blocked', reason: 'the case has no native lowering' };
  try {
    const record = internalRecord(compiled) as NonNullable<ReturnType<typeof internalRecord>>;
    return { kind: 'ready', programs: lowerNativePrograms(c.nativeLowered, c.resolved, record.images, movingOf(record)) };
  } catch (e) {
    if (e instanceof ProgramError) return { kind: 'blocked', reason: e.message };
    throw e;
  }
}

// SELD-R1a (notes/T047-runtime-spec.md §3.3): the state program, its runtime reference and the generated state runtime.
export type { LayoutChange, LayoutVariant, StateCase, StateDelta, StateFaults, StateProgram, StateVariable } from './lower/state-program.ts';
export { applyDelta, deriveStateProgram, MAX_STATE_TABLE_ASSIGNMENTS, NO_STATE_FAULTS, programAt, STATE_PROGRAM_VERSION, stateKey, StateProgramError, StateRuntime, StateValueError } from './lower/state-program.ts';
export type { ScriptCase, ScriptStep, StateEmit, WebClassTable, WebStateProgram } from './emit/runtime/state.ts';
export { emitStatePrograms, STATE_RUNTIME_VERSION, StateEmitError, typedSetters, valueKey, webStateModule, webStateProgram } from './emit/runtime/state.ts';
export { CLOCK_RUNTIME_VERSION, ClockError, VirtualClock } from './emit/runtime/clock.ts';
export { RUNTIME_MODULES } from './emit/runtime/index.ts';

// SELD-R1b (notes/T047-runtime-spec.md RT-9): the hit table and each element's hit facts.
export type { HitFact } from './emit/runtime/hit.ts';
export { HIT_FACTS_VERSION } from './emit/runtime/hit.ts';

/** The tags whose elements carry an activation handler (RT-9 tap dispatch): button, and a with an href (HTML §4.6.1). */
export const ACTIVATION_TAGS: readonly string[] = ['a', 'button'];
const activates = (tag: string, attributes: ReadonlyMap<string, string>): boolean => tag === 'button' || (tag === 'a' && attributes.has('href'));

/** Every element's hit facts in one case: computed pointer-events, whether it was inherited, and whether it has a handler. */
export function hitFacts(compiled: object, assignment: Assignment, state: string | null = null): ReadonlyMap<string, import('./emit/runtime/hit.ts').HitFact> | null {
  const c = caseOf(compiled, assignment, state);
  if (typeof c === 'string' || c.resolved === null) return null;
  const out = new Map<string, import('./emit/runtime/hit.ts').HitFact>();
  const walk = (el: ResolvedElement): void => {
    const v = el.props.get('pointer-events');
    if (v === undefined || v.value.kind !== 'keyword' || (v.value.value !== 'auto' && v.value.value !== 'none')) throw new Error(`${el.element.address}: pointer-events did not resolve to auto or none`);
    out.set(el.element.address, { pointerEvents: v.value.value, inherited: v.origin === 'inherited', activation: activates(el.element.tag, el.element.attributes) });
    for (const ch of el.children) if (ch.kind === 'element') walk(ch);
  };
  walk(c.resolved);
  return out;
}

// T065 ANIM-b1: the animation tables of a compile and the runtime animator's TypeScript reference.
export type { AnimationAnalysis, AnimValue } from './analysis/animations.ts';
export type { AnimProgram, SlotListing, TransitionSlot } from './lower/anim-program.ts';
export { ANIM_PROGRAM_VERSION, animTablesOf } from './lower/anim-program.ts';
import { lowerAnimProgram } from './lower/anim-program.ts';
export { lowerAnimProgram };
// T065: the TypeScript reference animator (packages/parity/src/anim-cases.ts) reads these.
export type { EasingValue } from './css/properties/animation.ts';
export { animationKind } from './css/animation-kinds.ts';

/** The animation tables of one state program: its cases' resolved trees in the program's assignment order. */
export function animProgramOf(compiled: object, assignments: readonly Assignment[]): import('./lower/anim-program.ts').AnimProgram | null {
  const record = internalRecord(compiled);
  if (record === undefined || record.animation === null) return null;
  const cases = assignments.map((a) => {
    const c = caseOf(compiled, a);
    if (typeof c === 'string' || c.resolved === null) throw new Error(`no resolved case for the assignment ${JSON.stringify(a)}`);
    return { key: c.key, resolved: c.resolved };
  });
  return lowerAnimProgram(record.animation, cases);
}

/** The animation features a compile uses (the support gate's keys in the animation context), sorted. */
export function animationFeatures(compiled: object): readonly string[] {
  const record = internalRecord(compiled);
  if (record === undefined || record.animation === null) return [];
  return [...new Set(record.animation.features.map((f) => f.feature))].sort();
}

// MQ-R1 (notes/T067-mq-r-spec.md R4, R5): the @media bands of the native output, their per-case programs and the band program.
export type { BandAnalysis, BandCase, BandRuntimeFaults } from './lower/band-program.ts';
export { BAND_KEY, BAND_PROGRAM_VERSION, BAND_STATE, bandAtom, bandOf, bandStateIndex, bandStateProgram, bandTableOf, BandProgramError, dependsOnViewport, ENV_INSTANCE, NO_BAND_RUNTIME_FAULTS, withBand } from './lower/band-program.ts';
export type { InternalBands } from './project.ts';
export { MEDIA_AT_RULE_FEATURE, MEDIA_CONTEXT, mediaFeatureKey } from './project.ts';
import { bandStateProgram as deriveBandProgram } from './lower/band-program.ts';
import { assignmentKey as keyOfAssignment } from './analysis/link.ts';
import { bandAt as partitionBandAt } from './media/index.ts';
import { MEDIA_AT_RULE_FEATURE as MEDIA_AT_RULE_FEATURE_KEY, mediaFeatureKey as mediaFeatureKeyOf } from './project.ts';
import type { BandRuntimeFaults } from './lower/band-program.ts';
import type { StateFaults, StateProgram } from './lower/state-program.ts';

/** The @media bands of a compile's native output: the band table, each band's condition and the per-case programs' band; null without @media. */
export function nativeBands(compiled: object): { readonly table: import('@dragon/layout').rtBand.BandTable; readonly conditions: readonly string[]; readonly initial: number } | null {
  const record = internalRecord(compiled);
  if (record === undefined || record.bands === null) return null;
  return { table: record.bands.table, conditions: record.bands.conditions, initial: record.bands.initial };
}

/** The media profile keys a compile's native output uses (T067 R13): the at-rule and each atom's feature, sorted; none without @media. */
export function mediaFeatures(compiled: object): readonly string[] {
  const bands = nativeBands(compiled);
  if (bands === null || bands.table.atoms.length === 0) return [];
  return [MEDIA_AT_RULE_FEATURE_KEY, ...[...new Set(bands.table.atoms.map((a) => a.feature))].map(mediaFeatureKeyOf)].sort();
}

/**
 * The band that holds a viewport by the compile-time partition (media/band.ts bandAt over CSS px): the independent reference the
 * runtime's band lookup is checked against; 0 without @media, null when no band holds it (only a planted partition leaves a gap).
 */
export function nativeBandOfViewport(compiled: object, viewport: { readonly width: number; readonly height: number }): number | null {
  const record = internalRecord(compiled);
  if (record === undefined) throw new Error('not a compiled result from this package');
  if (record.bands === null) return 0;
  return partitionBandAt(record.bands.partition, viewport)?.index ?? null;
}

/** Both native backends' programs of one case in one band (nativePrograms for the per-case programs' own band). */
export function nativeBandPrograms(compiled: object, assignment: Assignment, band: number): NativePrograms {
  const record = internalRecord(compiled);
  if (record === undefined) return { kind: 'blocked', reason: 'not a compiled result from this package' };
  if (record.bands === null) return band === 0 ? nativePrograms(compiled, assignment) : { kind: 'blocked', reason: `the compile has no @media bands, so no band ${band}` };
  const cases = record.bands.cases[band];
  if (cases === undefined) return { kind: 'blocked', reason: `no band ${band} (the compile has ${record.bands.cases.length})` };
  const targets = (compiled as { targets?: Record<string, string> }).targets ?? {};
  for (const t of ['ios', 'android']) if (targets[t] !== 'checked') return { kind: 'blocked', reason: `the ${t} target is ${targets[t] === undefined ? 'not configured' : targets[t]}` };
  const key = keyOfAssignment(assignment);
  const c = cases.find((x) => x.key === key);
  if (c === undefined) return { kind: 'blocked', reason: `no reachable case for the assignment ${JSON.stringify(assignment)} in band ${band}` };
  if (c.nativeLowered === null || c.resolved === null) return { kind: 'blocked', reason: `the case has no native lowering in band ${band}` };
  try {
    return { kind: 'ready', programs: lowerNativePrograms(c.nativeLowered, c.resolved, record.images, movingOf(record)) };
  } catch (e) {
    if (e instanceof ProgramError) return { kind: 'blocked', reason: e.message };
    throw e;
  }
}

/**
 * The band program of a compile for one backend: every reachable (assignment, band) pair's programs, env#band last, the initial
 * assignment in the per-case programs' band first. A compile without @media is one band.
 */
export function nativeBandProgram(compiled: object, backend: NativeBackend, faults?: StateFaults, bandFaults?: BandRuntimeFaults): StateProgram {
  const bands = nativeBands(compiled);
  const count = bands === null ? 1 : bands.table.bands.length;
  const cases = compiledCases(compiled).flatMap((c) => Array.from({ length: count }, (_, band) => {
    const p = nativeBandPrograms(compiled, c.assignment, band);
    if (p.kind !== 'ready') throw new Error(`no native programs for ${JSON.stringify(c.assignment)} in band ${band}: ${p.reason}`);
    return { assignment: c.assignment, isInitial: c.isInitial, band, program: p.programs[backend] };
  }));
  return deriveBandProgram(backend, cases, count, bands === null ? 0 : bands.initial, faults, bandFaults);
}

// SELD-R2 (notes/T064-seld-r2-spec.md): interaction states, their partition and the generated web conditions.
export type { ChainValue, FocusValue, ForcedPseudo, InteractionElement, InteractionKind, InteractionPartition, InteractionValue, StateMatch } from './analysis/interaction.ts';
export { chainStateOf, comboIndex, focusTargetOf, HIT_MODELLED, hitUnmodelledFact, isFocusable, MAX_INTERACTION_COMBINATIONS, MAX_INTERACTION_STATES, ruleIsInteractive, selectorIsInteractive, stateMembers } from './analysis/interaction.ts';
export type { InteractionState } from './analysis/match.ts';
export { NO_INTERACTION } from './analysis/match.ts';
export type { InteractionCondition, WebInteraction } from './emit/web-css.ts';
export { conditionsExclusive, gatedConditions, HOVER_MEDIA, interactionCondition, NO_HOVER_MEDIA } from './emit/web-css.ts';

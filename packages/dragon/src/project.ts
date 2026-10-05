// createProject: one configuration, complete snapshots, no publishable partial output (docs/api.md §2.1-2.2).
// Every reachable assignment is resolved, checked and lowered as its own case; nothing is deduplicated (docs/api.md §7).
import type { LayoutBox } from '@dragon/layout';
import { attributeRefusal } from './attributes.ts';
import { dimensionRefusal, iframeSrcRefusal } from './analysis/elements/replaced.ts';
import { compileImages, imageMapProblem } from './images/compile.ts';
import type { CompiledImages } from './images/compile.ts';
import type { ImageAssetMap } from './images/manifest.ts';
import { CanonicalText, canonicalJson, sha256Hex } from './digest.ts';
import { authored, diagnostic, unlocated } from './diagnostics/catalogue.ts';
import { webrefVersion } from './css/grammar.generated.ts';
import type { Longhand } from './css/properties.ts';
import { PROPERTY_ROLE } from './css/properties.ts';
import type { Declaration, EnclosedRules, Rule, RuleCondition } from './css/stylesheet.ts';
import { featureOf, parseStylesheet } from './css/stylesheet.ts';
import { splitNotApplicable } from './css/not-applicable.ts';
import type { UsedKey } from './analysis/context.ts';
import { usedKeys } from './analysis/context.ts';
import { checkComputed } from './analysis/computed-checks.ts';
import { inDomain, validateInput } from './analysis/input.ts';
import type { InteractionPartition, InteractionValue } from './analysis/interaction.ts';
import { emptyPartition, firstInteractionPseudo, stateMembers, hitUnmodelledFact, interactionCapRefusal, interactionPartition, interactionRefusals, interactionRuleOrigin, nativeInteractionRefusals, ruleIsInteractive } from './analysis/interaction.ts';
import type { Linked } from './analysis/link.ts';
import { assignmentKey, linkDocument } from './analysis/link.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue, RootFont } from './analysis/resolve.ts';
import type { AnimationAnalysis } from './analysis/animations.ts';
import { analyzeAnimations, gateAnimationFeatures, refuseBandedAnimations } from './analysis/animations.ts';
import { webAnimationsOf } from './lower/anim-program.ts';
import { valueText } from './emit/web-css.ts';
import * as cssTree from 'css-tree';
import type { KeyframesSource } from './css/at-rules/keyframes.ts';
import { parseKeyframesRules } from './css/at-rules/keyframes.ts';
import { resolveTree, SUPPORTED_TAGS, valueToString } from './analysis/resolve.ts';
import { ANDROID_VIEWS_EMITTER_VERSION } from './emit/android-views.ts';
import { emitNativeSupport, supportDigest } from './emit/native-support.ts';
import { UIKIT_EMITTER_VERSION } from './emit/uikit.ts';
import { emitWebCss } from './emit/web-css.ts';
import type { WebFontContext, WebInteraction } from './emit/web-css.ts';
import type { AtRuleContext } from './css/at-rules.ts';
import type { FamilyKeyContext } from './css/values.ts';
import { familyListText } from './css/values.ts';
import type { DeclaredFace, FontFaceIssue } from './fonts/font-face.ts';
import { GENERIC_KEYS, validateFontMap } from './fonts/font-map.ts';
import type { EntryResolution, FontMapError } from './fonts/font-map.ts';
import { foldFamily, selectionRequest } from './fonts/selection.ts';
import { fenceVariableInstance } from './fonts/variable-fence.ts';
import type { VariableFontRefusal } from './fonts/variable-fence.ts';
import { collectFontFaces, familySupport, pinnedFacesOf, projectFonts, renderedFaces, webFontOutput } from './fonts/wire.ts';
import type { FontWireProblem, ProjectedFonts } from './fonts/wire.ts';
import type { CompilerFaults } from './faults.ts';
import { LoweringError, lowerTree, textFontProblem } from './lower/ios-layout.ts';
import { PROGRAM_VERSIONS } from './lower/native-program.ts';
import type { Band, BandPartition } from './media/index.ts';
import { band, bandAt, evaluateInBand, featuresOfList } from './media/index.ts';
import { androidProfile } from './profiles/android.ts';
import { iosProfile } from './profiles/ios.ts';
import type { SupportProfile } from './profiles/types.ts';
import { provenContexts, statusOf, supportedValuesFor, supportedValuesIn } from './profiles/types.ts';
import { webProfile } from './profiles/web.ts';
import type { UaDataset } from './ua/datasets.ts';
import { REFERENCE_PLATFORM, ReferencePlatformUnavailable, uaDatasetFor } from './ua/datasets.ts';
import type {
  ArtifactState,
  Assignment,
  CheckReport,
  Compiled,
  Configured,
  Dependency,
  Diagnostic,
  GeneratedAsset,
  ExplainedCase,
  ExplainQuery,
  ExplainResult,
  FrontEndResult,
  Origin,
  Project,
  ProjectConfig,
  Span,
  Target,
  Targets,
  TreeNode,
} from './types.ts';

/** @internal */
export const COMPILER_VERSION = '1.0.0-alpha.0';
const KNOWN_TARGETS = ['web', 'ios', 'android'] as const;
type KnownTarget = (typeof KNOWN_TARGETS)[number];
/** The native targets, in the order their diagnostics are reported. */
const NATIVE_TARGETS = ['ios', 'android'] as const;

/** The API level range of the android target (docs/api.md §2.1). */
export const ANDROID_MIN_SDK = { min: 31, max: 36 } as const;

/** @internal Test-only replacement profiles may omit android, which then reads the committed android profile. */
export type SupportProfiles = { readonly web: SupportProfile; readonly ios: SupportProfile; readonly android?: SupportProfile };

/** Profiles copied and deep-frozen by snapshotProfile: the only profiles a project reads, for its checks and its digest alike. */
const profileSnapshots = new WeakSet<SupportProfile>();

/** A copy of plain data (objects, arrays, strings, numbers, booleans, null); anything else throws. */
function copyPlain(v: unknown): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(copyPlain);
  if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copyPlain(x)]));
  throw new Error(`a support profile holds ${typeof v}, not plain data`);
}

/** A deep-frozen copy of a profile (the profile itself when it is already one), so no caller can change it after a project reads it. */
function snapshotProfile(profile: SupportProfile): SupportProfile {
  if (profileSnapshots.has(profile)) return profile;
  const copy = deepFreeze(copyPlain(profile) as SupportProfile);
  profileSnapshots.add(copy);
  return copy;
}

/** The generated profiles are this module's own data: frozen in place, so they are their own snapshots. */
function ownSnapshot(profile: SupportProfile): SupportProfile {
  if (Object.isFrozen(profile)) throw new Error(`the ${profile.target} profile is already frozen, so it cannot be frozen whole here`);
  profileSnapshots.add(deepFreeze(profile));
  return profile;
}

/** @internal The committed support profiles, deep-frozen. */
export const COMMITTED_PROFILES: Required<SupportProfiles> = Object.freeze({ web: ownSnapshot(webProfile), ios: ownSnapshot(iosProfile), android: ownSnapshot(androidProfile) });

/** @internal The profile of one target. */
export function profileFor(profiles: SupportProfiles, t: KnownTarget): SupportProfile {
  return t === 'android' ? (profiles.android === undefined ? COMMITTED_PROFILES.android : profiles.android) : profiles[t];
}

function snapshotProfiles(profiles: SupportProfiles): Required<SupportProfiles> {
  return Object.freeze({ web: snapshotProfile(profiles.web), ios: snapshotProfile(profiles.ios), android: snapshotProfile(profileFor(profiles, 'android')) });
}

/**
 * @internal
 * One reachable assignment's results: stage-1 resolution, the ios lowering and the web class binding.
 */
export type InternalCase = {
  readonly key: string;
  readonly assignment: Assignment;
  readonly isInitial: boolean;
  readonly resolved: ResolvedElement | null;
  /** The native lowered layout tree (the ios lowering); border widths are computed CSS px, which the engine snaps for the environment's DPR. */
  readonly nativeLowered: LayoutBox | null;
  readonly webClassOf: ReadonlyMap<string, string> | null;
  /** Profile row keys ("<feature>@<context>") this case uses, per target, sorted. */
  readonly features: ReadonlyMap<Target, readonly string[]>;
  /** SELD-R2: the case's interaction partition (null when it did not resolve) and each distinct state but none, resolved and lowered. */
  readonly partition: InteractionPartition | null;
  readonly interaction: readonly InternalInteraction[];
};

/** @internal One interaction state of a case: its value, resolution and native lowering; the web classes are the case's. */
export type InternalInteraction = { readonly value: InteractionValue; readonly resolved: ResolvedElement; readonly nativeLowered: LayoutBox | null };

/**
 * @internal
 * Internal-only data kept beside a compiled result; never reachable from the public entry.
 */
export type InternalRecord = {
  readonly documentId: string | null;
  /** The environment direction every case was resolved for. */
  readonly direction: 'ltr' | 'rtl';
  /** The reference platform whose UA dataset the result was resolved with, and the root font of its environment. */
  readonly platform: string;
  readonly rootFont: RootFont;
  readonly profiles: Required<SupportProfiles>;
  readonly cases: readonly InternalCase[];
  readonly linked: Linked | null;
  /** The font context font-family feature keys were resolved against. */
  readonly fonts: FamilyKeyContext;
  /** T065: the transitions and animations of the native band's cases, null when the analysis did not run. */
  readonly animation: AnimationAnalysis | null;
  /**
   * SELD-R2: the native targets on which a compile outside the parity lanes refuses this document's interaction rules
   * (nativeInteractionRefusals). In a lanes compile those targets lower, but their cases prove no profile row users could use.
   */
  readonly laneOnlyNative: readonly ('ios' | 'android')[];
  /** REPL-a: the bytes of every drawable image src, for the native image paint. */
  readonly images: ReadonlyMap<string, Uint8Array>;
};

const records = new WeakMap<object, InternalRecord>();

/** @internal */
export function internalRecord(compiled: object): InternalRecord | undefined {
  return records.get(compiled);
}

/**
 * @internal
 * faults: seeded resolver and lowering errors. profiles 'derive' is used only by scripts/gen-profile-rows.ts: it records
 * row keys without enforcing the profiles, so the generator can find which cases pass before any row exists. direction: the
 * reference environment's direction (docs/api.md §7), which resolution gives the root; the public entry compiles for ltr.
 * platform: the reference platform whose Chrome UA dataset is read (REFERENCE_PLATFORM when absent); a platform with no dataset
 * is refused. rootFont: 'ahem' is the parity fixture environment, which sets the root font-family to Ahem (docs/api.md §10.1);
 * the public entry uses 'ua-default'. supportProfiles: test-only replacement profiles. foldViewport: the fixed viewport (CSS px)
 * the native output is resolved for when the stylesheet's @media rules split it into bands (MQ-a); absent in the public entry,
 * where native refuses such a sheet until MQ-R.
 */
/** One native target's committed lanes verdict (the shape profiles/native-lanes.ts is generated in). */
export type NativeLanesVerdict = { readonly recorded: boolean; readonly stale: readonly string[]; readonly notPassing: readonly string[] };
export type NativeLanes = { readonly ios: NativeLanesVerdict; readonly android: NativeLanesVerdict };

export type InternalOptions = {
  readonly faults: CompilerFaults;
  /**
   * The committed lanes verdict a native output is judged by (createProject passes profiles/native-lanes.ts). Without it a
   * checked native output is analysis-only and says the verdict was not given, never ready; the compiler itself does not
   * import the verdict, so a regen of lanes.json does not invalidate every compiling step.
   */
  readonly nativeLanes?: NativeLanes;
  readonly profiles: 'enforce' | 'derive';
  readonly direction: 'ltr' | 'rtl';
  readonly platform?: string;
  readonly rootFont?: RootFont;
  readonly supportProfiles?: SupportProfiles;
  readonly foldViewport?: Viewport;
  /**
   * SELD-R2: the parity lanes compile :hover, :active, :focus and :focus-visible on native, to prove each state's resolution ahead
   * of the native runtime; every other compile refuses them there (nativeInteractionRefusals).
   */
  readonly interactionLanes?: boolean;
};

type Viewport = { readonly width: number; readonly height: number };

type Resolved = {
  readonly faults: CompilerFaults;
  readonly profiles: 'enforce' | 'derive';
  readonly direction: 'ltr' | 'rtl';
  readonly rootFont: RootFont;
  readonly ua: UaDataset;
  /** Snapshots (snapshotProfile): the support checks and the digest read these same objects. */
  readonly supportProfiles: Required<SupportProfiles>;
  readonly foldViewport: Viewport | null;
  readonly interactionLanes: boolean;
  readonly nativeLanes: NativeLanes | null;
};

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v) && !(v instanceof Uint8Array) && !(v instanceof Map)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

/** The message of one font map problem. */
function fontMapMessage(e: FontMapError): string {
  switch (e.kind) {
    case 'unknown-generic':
      return `fonts.generics.${e.key} is not a generic family (the generics are ${GENERIC_KEYS.join(', ')})`;
    case 'invalid-entry':
      return e.key === '(map)' ? `fonts: ${e.reason}` : `fonts entry ${e.key}: ${e.reason}`;
    case 'invalid-face-descriptor':
      return `fonts entry ${e.key}: ${e.descriptor} "${e.text}" is not a valid @font-face descriptor value`;
    case 'pinned-family-conflict':
      return `fonts entries ${e.keys.join(', ')} pin the family "${e.family}" to different faces`;
  }
}

function validateConfig(config: { projectId: unknown; targets: unknown; fonts?: unknown; images?: unknown }): Diagnostic[] {
  const out: Diagnostic[] = [];
  const bad = (message: string, manual: string): void => {
    out.push(diagnostic('DRAGON_CONFIG_INVALID', { origin: unlocated('configuration'), message, manual }));
  };
  if (typeof config.projectId !== 'string' || config.projectId.length === 0) bad('projectId must be a non-empty string', 'Set projectId.');
  for (const k of Object.keys(config)) if (k !== 'projectId' && k !== 'targets' && k !== 'fonts' && k !== 'images') bad(`unknown configuration key "${k}"`, `Remove ${k}.`);
  if (config.images !== undefined) {
    const problem = imageMapProblem(config.images);
    if (problem !== null) bad(problem, 'Set images to { "<src>": "<snapshot asset id>" }.');
  }
  if (config.fonts !== undefined) {
    const v = validateFontMap(config.fonts);
    if (!v.ok) for (const e of v.errors) out.push(diagnostic('DRAGON_FONT_MAP_INVALID', { origin: unlocated('configuration fonts'), message: fontMapMessage(e) }));
  }
  const t = config.targets;
  if (typeof t !== 'object' || t === null || Object.keys(t).length === 0) {
    bad('targets must name at least one target', 'Configure { ios: { minimum: "15.0" } } or { web: {} }.');
    return out;
  }
  for (const [k, v] of Object.entries(t)) {
    if (!(KNOWN_TARGETS as readonly string[]).includes(k)) bad(`unknown target "${k}" (Dragon knows web, ios and android)`, 'Remove the target.');
    else if (k === 'android' && !validAndroid(v)) {
      bad(`android needs exactly { minSdk: <integer from ${ANDROID_MIN_SDK.min} to ${ANDROID_MIN_SDK.max}> }`, `Set android.minSdk to an integer API level from ${ANDROID_MIN_SDK.min} to ${ANDROID_MIN_SDK.max}, for example { android: { minSdk: ${ANDROID_MIN_SDK.min} } }.`);
    } else if (k === 'ios' && (typeof v !== 'object' || v === null || typeof (v as { minimum?: unknown }).minimum !== 'string' || Object.keys(v).length !== 1)) {
      bad('ios needs exactly { minimum: string }', 'Set ios.minimum, for example "15.0" (decision 6).');
    } else if (k === 'web' && (typeof v !== 'object' || v === null || Object.keys(v).length !== 0)) bad('web takes no options in milestone 1', 'Use web: {}.');
  }
  return out;
}

/** android is exactly { minSdk } with an integer API level in ANDROID_MIN_SDK. */
export function validAndroid(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Object.keys(v).length !== 1) return false;
  const m = (v as { minSdk?: unknown }).minSdk;
  return typeof m === 'number' && Number.isInteger(m) && m >= ANDROID_MIN_SDK.min && m <= ANDROID_MIN_SDK.max;
}

function blocksTarget(d: Diagnostic, t: Target): boolean {
  return d.severity === 'error' && (d.target === null || d.target === t);
}

/** Tags and attributes are checked on every template node, including both arms of every branch. */
function checkTemplates(nodes: readonly TreeNode[], diagnostics: Diagnostic[]): void {
  for (const n of nodes) {
    if (n.kind === 'element') {
      if (!SUPPORTED_TAGS.has(n.tag)) {
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ELEMENT', { origin: n.origin, message: `<${n.tag}> ${n.id} is not supported (supported: ${[...SUPPORTED_TAGS].join(', ')})` }));
      }
      for (const a of n.attributes) {
        const refusal = attributeRefusal(n.tag, a.name);
        if (refusal !== null) {
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ATTRIBUTE', { origin: a.origin, message: `attribute ${a.name} on ${n.id} is not supported: ${refusal}`, manual: 'Remove the attribute, or keep only rendering-neutral attributes (id, data-*, aria-*, role, title, ui-*); select state with a class or an attribute.' }));
        }
        for (const c of a.value) {
          if (c.value === null) continue;
          const dimension = dimensionRefusal(n.tag, a.name, c.value);
          if (dimension !== null) diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ATTRIBUTE', { origin: a.origin, message: `attribute ${a.name} on ${n.id} is not supported: ${dimension}`, manual: 'Give the attribute a width or height in CSS px, or set the size in CSS.' }));
          const src = iframeSrcRefusal(n.tag, a.name, c.value);
          if (src !== null) diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ATTRIBUTE', { origin: a.origin, message: `attribute ${a.name} on ${n.id} is not supported: ${src}`, manual: 'Give the iframe an absolute https URL.' }));
        }
      }
      checkTemplates(n.children, diagnostics);
    } else if (n.kind === 'branch') {
      checkTemplates(n.then, diagnostics);
      checkTemplates(n.else, diagnostics);
    } else if (n.kind === 'call') {
      for (const s of n.slots) checkTemplates(s.children, diagnostics);
    }
  }
}

const list = (values: readonly string[]): string => (values.length <= 1 ? values.join('') : `${values.slice(0, -1).join(', ')} or ${values[values.length - 1] as string}`);

/** The declaration text a shorthand-filled longhand came from, for messages (T005 rec 2). */
const setBy = (d: Declaration, property: Longhand): string => (d.property === property ? '' : ` (set by ${d.property}: ${d.text})`);

/**
 * Context-free check: every longhand any declaration sets, including shorthand-filled ones, needs a row in some context. The
 * message lists the property's supported values in each context the declaration applies in (T005 rec 6), from the used keys of
 * the resolved cases; with none known it lists the supported values in any context.
 */
function checkValues(rules: readonly Rule[], targets: readonly KnownTarget[], profiles: SupportProfiles, used: readonly UsedKey[] | ((t: KnownTarget) => readonly UsedKey[]), diagnostics: Diagnostic[], fonts: FamilyKeyContext, scope: RuleScope | null = null): void {
  const seen = new Set<Declaration>();
  for (const rule of rules) {
    // A rule Chrome drops never applies (css/selectors.ts), so its values need no support.
    if (rule.selectors.every((s) => s.dropped)) continue;
    // MQ-a: a rule is checked only for the targets whose band it applies in.
    const ruleTargets = scope === null ? targets : targets.filter((t) => scope(rule).includes(t));
    for (const d of rule.declarations) {
      if (seen.has(d)) continue;
      seen.add(d);
      for (const lh of d.longhands) {
        const feature = featureOf(lh.property, lh.value, fonts);
        // checkFamilies reports an unmapped family.
        if (feature === 'font-family:<unmapped>') continue;
        for (const t of ruleTargets) {
          const profile = profileFor(profiles, t);
          if (provenContexts(profile, feature).length > 0) continue;
          const values = supportedValuesFor(profile, lh.property);
          const contexts = [...new Set((typeof used === 'function' ? used(t) : used).filter((u) => u.declaration === d && u.property === lh.property).map((u) => u.context))].sort();
          const alternatives = contexts.length > 0
            ? contexts.map((ctx) => {
              const inCtx = supportedValuesIn(profile, lh.property, ctx);
              return inCtx.length > 0 ? `in ${ctx} use ${list(inCtx)}` : `no ${lh.property} value is proven in ${ctx}`;
            }).join('; ')
            : values.length > 0 ? `supported ${lh.property} values: ${list([...values].sort())}` : `no ${lh.property} value is supported`;
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin: authored(d.valueSpan),
            target: t,
            message: `${lh.property}: ${valueToString(lh.value)}${setBy(d, lh.property)} is unsupported (support profile ${profile.revision}); ${alternatives}`,
            manual: values.length > 0 ? `Use one of: ${values.join(', ')}.` : `Remove ${d.property}; ${t} supports no value of ${lh.property} yet.`,
            profile: { target: t, profileRevision: profile.revision, feature, context: null, status: 'unsupported' },
          }));
        }
      }
    }
  }
}

/** The lowering's font refusal, reported for every laid-out text node of every case, whether or not another error blocks ios. */
function checkFonts(root: ResolvedElement, diagnostics: Diagnostic[], reported: Set<string>, target: 'ios' | 'android', ahemDeclared: boolean): void {
  const walk = (el: ResolvedElement): void => {
    const display = (el.props.get('display') as ResolvedValue).value;
    if (display.kind === 'keyword' && display.value === 'none') return;
    for (const c of el.children) {
      if (c.kind === 'element') {
        walk(c);
        continue;
      }
      // Native draws its bundled Ahem, so an @font-face that declares Ahem for web would make the targets disagree: it blocks native.
      const message = textFontProblem(c) ?? (ahemDeclared ? `font-family Ahem on ${c.node.address} names the family an @font-face rule declares, while ${target} draws the bundled Ahem` : null);
      if (message === null) continue;
      const id = `${target}|${c.node.address}|font-family|${message}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_FONT', { origin: c.node.node.origin, message, target }));
    }
  };
  walk(root);
}

/** The fonts of one compilation: the projected map and manifest, the declared faces and the context feature keys resolve against. */
type ProjectFonts = {
  readonly projected: ProjectedFonts;
  readonly declaredFaces: readonly DeclaredFace[];
  readonly keys: FamilyKeyContext;
  /** False when the project declares no @font-face and has no font map: the web output is then exactly as before fonts. */
  readonly used: boolean;
};

const NO_FONTS: FamilyKeyContext = { map: null, declared: new Set() };

function variableMessage(r: VariableFontRefusal): string {
  switch (r.kind) {
    case 'variable-font-without-hvar':
      return `the variable font ${r.sha256.slice(0, 16)} has no HVAR table, so its advances at other instances are unknown`;
    case 'variable-font-not-validated':
      return `the variable font ${r.sha256.slice(0, 16)} is not in the validated set`;
    case 'variable-instance-not-validated':
      return `${r.font} ${r.axis} ${r.values.join(', ')} is outside the validated range ${r.validated === null ? '(the axis is not validated)' : `${r.validated[0]} to ${r.validated[1]}`}`;
    case 'variable-descriptor-settings':
      return `${r.font} has font-variation-settings in its @font-face rule, which Dragon does not apply`;
  }
}

/** The diagnostic of one @font-face issue, or null for a value Chrome keeps that needs no report. */
function fontIssueDiagnostic(issue: FontFaceIssue, origin: Origin, where: string): Diagnostic {
  switch (issue.kind) {
    case 'remote-url':
      return diagnostic('DRAGON_FONT_REMOTE_URL', { origin, message: `${where}: src url(${issue.url}) is a remote URL` });
    case 'local-font':
      return diagnostic('DRAGON_FONT_LOCAL', { origin, message: `${where}: src local(${issue.name}) names an installed font` });
    case 'unresolved-asset':
      return diagnostic('DRAGON_FONT_UNRESOLVED_ASSET', { origin, message: `${where}: src url(${issue.url}) does not resolve to an asset of the source snapshot` });
    case 'unreadable-font':
      return diagnostic('DRAGON_FONT_UNREADABLE', { origin, message: `${where}: src url(${issue.url.startsWith('data:') ? 'data:…' : issue.url}) is not a readable font (${issue.refusal.kind})` });
    case 'unsupported-descriptor':
      return diagnostic('DRAGON_FONT_UNSUPPORTED_DESCRIPTOR', { origin, message: `${where}: ${issue.descriptor}: ${issue.reason}` });
    case 'variable-font-refused':
      return diagnostic('DRAGON_FONT_VARIABLE_REFUSED', { origin, message: `${where}: ${variableMessage(issue.refusal)}` });
    case 'descriptor-not-applied':
      return diagnostic('DRAGON_FONT_DESCRIPTOR_NOT_APPLIED', { origin, message: `${where}: ${issue.descriptor} is kept in the web output but not applied to native text` });
    case 'no-effect':
      return diagnostic('DRAGON_FONT_DESCRIPTOR_NOT_APPLIED', { origin, message: `${where}: ${issue.descriptor} has no effect: ${issue.reason}` });
    case 'invalid-descriptor':
      return diagnostic('DRAGON_CSS_INVALID_VALUE', { origin, message: `${where}: "${issue.text}" is not a valid value for the ${issue.descriptor} descriptor, so Chrome drops it`, manual: `Use a value that matches the ${issue.descriptor} descriptor grammar (css-fonts-4 §4).` });
    case 'unknown-descriptor':
      return diagnostic('DRAGON_CSS_INVALID_VALUE', { origin, message: `${where}: ${issue.descriptor} is not an @font-face descriptor, so Chrome drops it`, manual: 'Remove the declaration.' });
    case 'rule-dropped':
      return diagnostic('DRAGON_CSS_INVALID_VALUE', { origin, message: `${where}: the rule has no valid ${issue.reason === 'missing-family' ? 'font-family' : 'src'}, so Chrome creates no font face from it`, manual: 'Give the rule a font-family and a src.' });
    case 'unexpected-content':
      return diagnostic('DRAGON_CSS_PARSE', { origin, message: `${where}: CSS ${issue.nodeType} inside @font-face is not a descriptor` });
  }
}

/** Every font problem of the compilation as a diagnostic; font map problems are reported by validateConfig. */
function fontDiagnostics(problems: readonly FontWireProblem[], diagnostics: Diagnostic[]): void {
  for (const p of problems) {
    if (p.kind === 'font-map-invalid') continue;
    if (p.kind === 'pinned-family-declared') {
      diagnostics.push(diagnostic('DRAGON_FONT_MAP_INVALID', { origin: unlocated('configuration fonts'), message: `fonts entries ${p.keys.join(', ')} pin the family "${p.family}", which an @font-face rule also declares; rename the pinned family` }));
      continue;
    }
    if (p.kind === 'face-not-in-manifest') throw new Error(`the web font face ${p.family} ${p.hash} is not in the font manifest`);
    const origin = p.source.kind === 'rule' ? authored(p.source.context.span) : unlocated(`configuration fonts entry ${p.source.key}, face ${p.source.face}`);
    const where = p.source.kind === 'rule' ? `@font-face ${p.source.order + 1}` : `fonts entry ${p.source.key} face ${p.source.face}`;
    diagnostics.push(fontIssueDiagnostic(p.issue, origin, where));
  }
}

/**
 * Collects the accepted @font-face rules (their src URLs resolved through the snapshot's asset resolutions from the stylesheet
 * that holds them), projects the font map and manifest, and reports every font problem.
 */
function compileFonts(input: FrontEndResult, rawMap: unknown, contexts: readonly AtRuleContext[], diagnostics: Diagnostic[]): ProjectFonts {
  const assets = new Map(input.snapshot.assets.map((a) => [a.id, a]));
  const collected = collectFontFaces(contexts, (specifier, context) => {
    const r = input.snapshot.resolutions.find((x) => x.kind === 'asset' && x.from.uri === context.span.source.uri && x.specifier === specifier);
    const a = r === undefined || r.to === null ? undefined : assets.get(r.to);
    return a === undefined ? null : { id: a.id, bytes: a.bytes };
  });
  const projected = projectFonts(rawMap, collected.results, input.snapshot.assets);
  fontDiagnostics([...collected.problems, ...projected.problems], diagnostics);
  const declaredFaces = collected.results.flatMap((r) => (r.face === null || r.face.source === null ? [] : [r.face]));
  const keys: FamilyKeyContext = { map: projected.map, declared: new Set(collected.results.flatMap((r) => (r.face === null ? [] : [r.face.family]))) };
  return { projected, declaredFaces, keys, used: rawMap !== undefined || contexts.length > 0 };
}

/**
 * Context-free check of every font-family declaration of a rule that applies: each entry of its list must be declared with
 * @font-face or be in the font map (pinned or platform); an unmapped entry is DRAGON_FONT_UNMAPPED_FAMILY for every target.
 * A value holding var() is keyed after substitution (computed-checks.ts).
 */
function checkFamilies(rules: readonly Rule[], fonts: FamilyKeyContext, faults: CompilerFaults, out: Diagnostic[], scope: { readonly of: RuleScope; readonly targets: readonly KnownTarget[] } | null = null): void {
  const seen = new Set<Declaration>();
  for (const rule of rules) {
    if (rule.selectors.every((sel) => sel.dropped)) continue;
    // MQ-a: a rule outside the native band blocks web only (scopedTo), one that applies in no configured output blocks nothing.
    const diagnostics: Diagnostic[] = [];
    for (const d of rule.declarations) {
      if (seen.has(d)) continue;
      seen.add(d);
      for (const lh of d.longhands) {
        const text = lh.property === 'font-family' ? familyListText(lh.value) : null;
        if (text === null) continue;
        const support = familySupport(text, fonts.map, fonts.declared);
        if (support === null) continue;
        if (support.kind === 'invalid') {
          diagnostics.push(diagnostic('DRAGON_CSS_INVALID_VALUE', { origin: authored(d.valueSpan), message: `font-family: ${d.text} is not a font-family list Chrome parses`, manual: 'Write a comma-separated list of family names and generic keywords.' }));
          continue;
        }
        if (!faults.unmappedFamilyAccepted) unmappedDiagnostics(support.resolutions, d.text, d.valueSpan, diagnostics);
      }
    }
    out.push(...(scope === null ? diagnostics : scopedTo(diagnostics, scope.of(rule), scope.targets)));
  }
}

/** The targets a rule applies in (MQ-a): web where any band applies it, native where the native band does. */
type RuleScope = (rule: Rule) => readonly KnownTarget[];

/**
 * Diagnostics raised for a subset of the configured targets: one for every target blocks every target (target null) as before;
 * for a proper subset, each diagnostic without a target is reported once per target in it, and one for another target is dropped.
 */
function scopedTo(ds: readonly Diagnostic[], scope: readonly KnownTarget[], targets: readonly KnownTarget[]): Diagnostic[] {
  if (targets.every((t) => scope.includes(t))) return [...ds];
  return ds.flatMap((d) => (d.target === null ? scope.map((t) => ({ ...d, target: t })) : scope.includes(d.target as KnownTarget) ? [d] : []));
}

/** Diagnostics of several passes in order, each once; a per-target one is dropped when the same diagnostic blocks every target. */
function mergePasses(passes: readonly (readonly Diagnostic[])[]): Diagnostic[] {
  const all = passes.flat();
  const keys = new Set(all.map((d) => JSON.stringify(d)));
  const out: Diagnostic[] = [];
  const emitted = new Set<string>();
  for (const d of all) {
    const key = JSON.stringify(d);
    if (emitted.has(key)) continue;
    if (d.target !== null && keys.has(JSON.stringify({ ...d, target: null }))) continue;
    emitted.add(key);
    out.push(d);
  }
  return out;
}

/** The unmapped-family diagnostics of one resolved font-family list, located at its value. */
function unmappedDiagnostics(resolutions: readonly EntryResolution[], text: string, valueSpan: Span, diagnostics: Diagnostic[]): void {
  for (const r of resolutions) {
    if (r.kind !== 'unmapped-family') continue;
    const name = r.entry.kind === 'generic' ? `the generic ${r.entry.keyword}` : `the family "${r.entry.name}"`;
    const fix = r.entry.kind === 'generic'
      ? `Pin ${r.entry.keyword} in the font map (fonts.generics["${r.entry.keyword}"]: { mode: "pinned", family, faces }, for example the recommended "Dragon Sans" faces), or map it with { mode: "platform" }.`
      : `Declare "${r.entry.name}" with an @font-face rule whose src is a bundled font file, or map it under fonts.families.`;
    diagnostics.push(diagnostic('DRAGON_FONT_UNMAPPED_FAMILY', { origin: authored(valueSpan), message: `font-family: ${text}: ${name} is neither declared with @font-face nor in the font map, so it would be a font installed on the machine`, manual: fix }));
  }
}

type TextFont = { readonly weight: number; readonly style: 'normal' | 'italic' };

/**
 * Per case, on every text node: a font-family value that holds var() is checked after substitution like checkFamilies checks the
 * others, and the variable-font fence (T028) runs at style resolution on the faces Chrome draws the text with (renderedFaces).
 * No author longhand sets font-weight or font-style, so they are the UA's, inherited (userAgentTextFonts: h1 to h6 bold, address italic).
 * Text in a display: none subtree is never drawn, so Chrome selects no face for it and the fence skips it, as checkFonts does; the
 * substitution check is per declaration, like checkFamilies, and runs everywhere.
 */
function checkCaseFonts(root: ResolvedElement, fonts: ProjectFonts, faults: CompilerFaults, ua: UaDataset, diagnostics: Diagnostic[], reported: Set<string>): void {
  const faces = [...fonts.declaredFaces, ...fonts.projected.pinned.flatMap((p) => (p.result.face === null ? [] : [p.result.face]))];
  const fence = faces.some((f) => f.source?.font.variable === true);
  const once = (id: string): boolean => {
    if (reported.has(id)) return false;
    reported.add(id);
    return true;
  };
  const walk = (el: ResolvedElement, inherited: TextFont, hiddenAbove: boolean): void => {
    const display = (el.props.get('display') as ResolvedValue).value;
    const hidden = hiddenAbove || (display.kind === 'keyword' && display.value === 'none');
    const tf = (ua.userAgentTextFonts as { readonly [tag: string]: { readonly [p: string]: string } | undefined })[el.element.tag] ?? {};
    const weight = tf['font-weight'] === undefined ? inherited.weight : Number(tf['font-weight']);
    const own: TextFont = { weight: Number.isFinite(weight) ? weight : inherited.weight, style: tf['font-style'] === undefined ? inherited.style : tf['font-style'] === 'italic' ? 'italic' : 'normal' };
    const declared = el.props.get('font-family') as ResolvedValue;
    const sub = declared.substitution;
    const subText = sub === undefined ? null : familyListText(declared.value);
    const subSupport = subText === null ? null : familySupport(subText, fonts.keys.map, fonts.keys.declared);
    if (sub !== undefined && subSupport !== null && once(`substituted|${sub.source.valueSpan.source.uri}|${sub.source.valueSpan.start}|${subText}`)) {
      if (subSupport.kind === 'invalid') diagnostics.push(diagnostic('DRAGON_CSS_INVALID_VALUE', { origin: authored(sub.source.valueSpan), message: `font-family: ${sub.source.text} substitutes to ${subText}, which is not a font-family list Chrome parses`, manual: 'Write a comma-separated list of family names and generic keywords.' }));
      else if (!faults.unmappedFamilyAccepted) unmappedDiagnostics(subSupport.resolutions, `${sub.source.text} (substituted: ${subText})`, sub.source.valueSpan, diagnostics);
    }
    for (const c of el.children) {
      if (c.kind === 'element') {
        walk(c, own, hidden);
        continue;
      }
      if (hidden) continue;
      const family = c.props.get('font-family') as ResolvedValue;
      const text = familyListText(family.value);
      const support = text === null ? null : familySupport(text, fonts.keys.map, fonts.keys.declared);
      if (support === null) continue;
      const size = (c.props.get('font-size') as ResolvedValue).value;
      if (!fence || support.kind !== 'resolved' || size.kind !== 'length' || size.unit !== 'px') continue;
      const request = selectionRequest(own.weight, 100, { kind: own.style });
      for (const { family: name, face } of renderedFaces(faces, support.resolutions, c.text, request)) {
        const refused = fenceVariableInstance(face, { weight: own.weight, stretch: 100, style: { kind: own.style }, specifiedSize: size.value, opticalSizing: 'auto' });
        if (refused === null) continue;
        const origin = family.declaration === null ? c.node.node.origin : authored(family.declaration.valueSpan);
        const message = `font-family ${name} at ${size.value}px on ${c.node.address}: ${variableMessage(refused)}`;
        if (once(`${message}|${JSON.stringify(origin)}`)) diagnostics.push(diagnostic('DRAGON_FONT_VARIABLE_REFUSED', { origin, message }));
      }
    }
  };
  walk(root, { weight: 400, style: 'normal' }, false);
}

/** One interaction state of a case, resolved and checked like the case (SELD-R2). */
type InteractionResult = { value: InteractionValue; resolved: ResolvedElement; used: UsedKey[] };
type CaseResult = { key: string; assignment: Assignment; isInitial: boolean; resolved: ResolvedElement | null; used: UsedKey[]; partition: InteractionPartition | null; interaction: InteractionResult[] };

/** A case's used keys with those of every interaction state, for the value checks' context lists. */
const allUsed = (c: CaseResult): UsedKey[] => [...c.used, ...c.interaction.flatMap((i) => i.used)];

/** What checkCases has reported, shared by every band's pass so a diagnostic is reported once. */
type Reported = { readonly contextual: Set<string>; readonly refused: Set<string>; readonly fonts: Set<string>; readonly fenced: Set<string> };
const freshReported = (): Reported => ({ contextual: new Set(), refused: new Set(), fonts: new Set(), fenced: new Set() });

/**
 * Resolves and checks every case: computed-value refusals, fonts, then (when enforcing) the contextual check, where a feature
 * proven only in other contexts blocks with the proven contexts, the alternatives in its own context (T005 rec 6) and, for a
 * shorthand-filled longhand, the shorthand and what to write instead (T005 rec 2).
 */
function checkCases(linked: Linked, rules: readonly Rule[], targets: readonly KnownTarget[], options: Resolved, diagnostics: Diagnostic[], projectFonts: ProjectFonts | null, seen: Reported = freshReported()): CaseResult[] {
  const { contextual: reported, refused, fonts, fenced } = seen;
  const keys = projectFonts === null ? NO_FONTS : projectFonts.keys;
  const out: CaseResult[] = [];
  const env = { direction: options.direction, rootFont: options.rootFont, ua: options.ua };
  // Every check of a case runs on each of its interaction states too, so a refusal inside a hover rule is reported (SELD-R2a).
  const check = (resolved: ResolvedElement): UsedKey[] => {
    checkComputed(resolved, targets, diagnostics, refused, options.profiles === 'derive' ? null : (t) => profileFor(options.supportProfiles, t as KnownTarget), keys);
    const ahemDeclared = projectFonts !== null && [...projectFonts.keys.declared].some((d) => foldFamily(d) === foldFamily('Ahem'));
    for (const t of NATIVE_TARGETS) if (targets.includes(t)) checkFonts(resolved, diagnostics, fonts, t, ahemDeclared);
    if (projectFonts !== null) checkCaseFonts(resolved, projectFonts, options.faults, options.ua, diagnostics, fenced);
    const used = usedKeys(resolved, keys);
    if (options.profiles !== 'derive') checkContexts(used);
    return used;
  };
  const checkContexts = (used: readonly UsedKey[]): void => {
    for (const u of used) {
      for (const t of targets) {
        const profile = profileFor(options.supportProfiles, t);
        if (statusOf(profile, u.feature, u.context) !== 'unsupported') continue;
        const proven = provenContexts(profile, u.feature);
        if (proven.length === 0) continue;
        const id = `${t}|${u.key}|${u.declaration.span.start}|${u.declaration.span.source.uri}`;
        if (reported.has(id)) continue;
        reported.add(id);
        const inCtx = supportedValuesIn(profile, u.property, u.context);
        const alternatives = inCtx.length > 0 ? `${u.property} values proven in ${u.context}: ${list(inCtx)}` : `no ${u.property} value is proven in ${u.context}`;
        let instead = '';
        if (u.declaration.property !== u.property) {
          const siblings = u.declaration.longhands.filter((lh) => lh.property !== u.property && PROPERTY_ROLE[lh.property] === PROPERTY_ROLE[u.property]
            && statusOf(profile, featureOf(lh.property, lh.value, keys), u.context) !== 'unsupported');
          instead = siblings.length > 0
            ? `; ${u.declaration.property} sets ${u.property}, which is unproven here, so write ${siblings.map((lh) => `${lh.property}: ${valueToString(lh.value)}`).join('; ')} instead of ${u.declaration.property}`
            : `; ${u.declaration.property} sets ${u.property}, which is unproven here, and none of the other longhands it sets is proven in ${u.context}`;
        }
        diagnostics.push(diagnostic('DRAGON_UNPROVEN_CONTEXT', {
          origin: authored(u.declaration.valueSpan),
          target: t,
          message: `${u.feature}${setBy(u.declaration, u.property)} on ${u.address} is used in the ${u.context} context, which is not proven (proven: ${proven.join(', ')}); ${alternatives}${instead}`,
          manual: `Use ${u.feature} only in a proven context (${proven.join(', ')}), or add a passing parity fixture for ${u.context}.`,
          related: [{ origin: authored(u.declaration.span), message: `declaration ${u.declaration.property}: ${u.declaration.text} applied to ${u.address}` }],
          profile: { target: t, profileRevision: profile.revision, feature: u.feature, context: u.context, status: 'unsupported' },
        }));
      }
    }
  };
  const interactive = rules.some(ruleIsInteractive);
  for (const c of linked.cases) {
    const resolved = resolveTree(c.root, rules, options.faults, env);
    const used = check(resolved);
    if (!interactive) {
      out.push({ key: c.key, assignment: c.assignment, isInitial: c.isInitial, resolved, used, partition: emptyPartition(c.root), interaction: [] });
      continue;
    }
    const built = interactionPartition(c.root, (ix) => resolveTree(c.root, rules, options.faults, env, ix), options.faults);
    if (built.over !== null) {
      // R7: refused (package SELD-R2s); the case keeps no interaction state.
      const refusal = interactionCapRefusal(assignmentLabel(c.assignment), built.over, rules, c.root.node.origin);
      if (!diagnostics.some((d) => d.code === refusal.code && d.message === refusal.message)) diagnostics.push(refusal);
      out.push({ key: c.key, assignment: c.assignment, isInitial: c.isInitial, resolved, used, partition: emptyPartition(c.root), interaction: [] });
      continue;
    }
    const partition = built.partition;
    const interaction = partition.states.map((value, k): InteractionResult => {
      const r = built.resolved[k] as ResolvedElement;
      return { value, resolved: r, used: check(r) };
    });
    out.push({ key: c.key, assignment: c.assignment, isInitial: c.isInitial, resolved, used, partition, interaction });
  }
  return out;
}

/** An assignment as the messages name it: state=value, comma-separated, or "(the initial assignment)" when it sets nothing. */
const assignmentLabel = (a: Assignment): string => (a.length === 0 ? '(the initial assignment)' : a.map((x) => `${x.state.state}=${String(x.value)}`).join(', '));

/**
 * R13: on native, a pointer-reachable interaction state needs Dragon's hit test, which models only the HIT_MODELLED paint facts.
 * A case with a reachable state and an unmodelled fact that compiles for the target (no error already refuses its declaration
 * there) refuses every interaction rule on that target, naming SELD-R2b. Run after the value checks, so a refused value is not
 * counted as compiled.
 */
function hitModelRefusals(cases: readonly CaseResult[], rules: readonly Rule[], targets: readonly KnownTarget[], options: Resolved, diagnostics: Diagnostic[]): void {
  // Outside the lanes every interaction rule is already refused on native (nativeInteractionRefusals).
  if (options.faults.hitUnmodelledNotRefused || !options.interactionLanes) return;
  const seen = new Set<string>();
  for (const t of NATIVE_TARGETS.filter((x) => targets.includes(x))) {
    const refusedAt = new Set(diagnostics.filter((d) => d.severity === 'error' && (d.target === null || d.target === t) && d.origin.kind === 'authored').map((d) => {
      const span = (d.origin as { span: { source: { uri: string }; start: number } }).span;
      return `${span.source.uri}|${span.start}`;
    }));
    const compiles = (v: ResolvedValue): boolean => v.declaration === null || ![v.declaration.span, v.declaration.valueSpan].some((sp) => refusedAt.has(`${sp.source.uri}|${sp.start}`));
    for (const c of cases) {
      const reachable = c.interaction.filter((i) => i.value.kind === 'reachable');
      if (c.resolved === null || reachable.length === 0) continue;
      const fact = [c.resolved, ...reachable.map((i) => i.resolved)].map((r) => hitUnmodelledFact(r, options.ua, compiles)).find((f) => f !== null) ?? null;
      if (fact === null) continue;
      for (const r of rules) {
        const pseudo = firstInteractionPseudo(r);
        if (pseudo === null) continue;
        const origin = interactionRuleOrigin(r, c.resolved.element.node.origin);
        const message = `:${pseudo} needs Dragon hit testing through ${fact.property} on ${fact.address}, which is not built yet (package SELD-R2b)`;
        const id = `${t}|${JSON.stringify(origin)}|${message}`;
        if (seen.has(id)) continue;
        seen.add(id);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', { origin, target: t, message, manual: `Keep ${fact.property} at its initial value in a document with :${pseudo} rules, or style the state with a component state until SELD-R2b.` }));
      }
    }
  }
}

/** The lowering key of an interaction state of a case. */
const interactionKey = (caseKey: string, v: InteractionValue): string => `${caseKey}\u0000${v.key}`;

/** The web output's view of a case's interaction states: each state's resolution and the candidates its condition names. */
function webInteraction(c: CaseResult): WebInteraction | undefined {
  if (c.partition === null || c.interaction.length === 0) return undefined;
  const members = stateMembers(c.partition);
  return { candidates: c.partition.candidates, states: c.interaction.map((i, k) => {
    const own = members[k];
    if (own === undefined || own.length === 0) throw new Error(`interaction state ${i.value.key} of ${c.key} stands for no combination`);
    return { members: own, root: i.resolved };
  }) };
}

/** The @media conditions of the sheet: each distinct at-rule once, in source order. */
function conditionsOf(rules: readonly Rule[]): RuleCondition[] {
  const out: RuleCondition[] = [];
  for (const r of rules) for (const c of r.condition ?? []) if (!out.includes(c)) out.push(c);
  return out;
}

type Bands = { readonly partition: Extract<BandPartition, { kind: 'bands' }>; readonly conditions: readonly RuleCondition[] };

/** The rules that apply in a band: every rule outside @media, and each rule whose conditions all hold in the band. */
function rulesIn(rules: readonly Rule[], bands: Bands | null, b: Band | null, faults: CompilerFaults): Rule[] {
  if (bands === null || b === null || faults.mediaConditionIgnored) return [...rules];
  return rules.filter((r) => (r.condition ?? []).every((c) => {
    const result = evaluateInBand(c.list, bands.partition, b);
    // The at-rule handler refuses every list with a refused feature, so a conditional rule's list always evaluates.
    if (result.kind === 'refused') throw new Error(`@media ${c.text} reached the band fold with a refused feature`);
    return result.matches;
  }));
}

/** The band the native output is resolved in: the one holding the fold viewport, else the first. */
function nativeBandIndex(bands: Bands | null, fold: Viewport | null, faults: CompilerFaults): number {
  if (bands === null || fold === null) return 0;
  const at = bandAt(bands.partition, faults.mediaBandOffByOne ? { width: fold.width + 1, height: fold.height } : fold);
  if (at === null) throw new Error(`no band holds the fold viewport ${fold.width}x${fold.height}`);
  return at.index;
}

/** The web output's font rewrite and @font-face prelude, and the assets the prelude references once it is emitted. */
function webFontsOf(fonts: ProjectFonts, faults: CompilerFaults): { context: WebFontContext; assets: () => GeneratedAsset[] } {
  let assets: GeneratedAsset[] = [];
  const context: WebFontContext = {
    map: fonts.keys.map,
    declared: fonts.keys.declared,
    rewrite: !faults.pinnedGenericNotRewritten,
    prelude: (usedPinned) => {
      const manifest = fonts.projected.manifest;
      if (manifest === null) throw new Error('the web output is ready but the fonts have no manifest');
      if (faults.fontFaceNotEmitted) return '';
      const out = webFontOutput(pinnedFacesOf(fonts.projected, usedPinned), fonts.declaredFaces, manifest);
      fontDiagnostics(out.problems, []);
      assets = out.assets.map((a) => ({ path: a.path, hash: a.hash, bytes: a.bytes }));
      return out.css;
    },
  };
  return { context, assets: () => assets };
}

const inside = (o: Origin, e: EnclosedRules): boolean =>
  o.kind === 'authored' && o.span.source.uri === e.span.source.uri && o.span.start >= e.span.start && o.span.end <= e.span.end;

const NATIVE_OUTPUT: { readonly [T in 'ios' | 'android']: { readonly backend: 'uikit' | 'android-views'; readonly emitter: string; readonly name: string; readonly language: string } } = {
  ios: { backend: 'uikit', emitter: UIKIT_EMITTER_VERSION, name: 'iOS', language: 'UIKit Swift' },
  android: { backend: 'android-views', emitter: ANDROID_VIEWS_EMITTER_VERSION, name: 'Android', language: 'Android Views Kotlin' },
};

/**
 * The digest of a native output: the compilation digest with that backend's emitter and program versions and its support
 * digest (P6a), so a change to the generated native code changes it. The web output keeps the compilation digest.
 */
export function nativeDigest(digest: string, t: 'ios' | 'android'): string {
  const o = NATIVE_OUTPUT[t];
  return sha256Hex(canonicalJson({ compilation: digest, emitter: o.emitter, program: PROGRAM_VERSIONS[o.backend], support: supportDigest(o.backend) }));
}

/**
 * A checked native target's output (P6a): ready only when the committed lanes verdict (profiles/native-lanes.ts, written by
 * pnpm run profile:rows from packages/parity/out/lanes.json) has every lane of that target passing and none stale; otherwise
 * analysis-only, naming why. A ready native output carries the backend's native support files.
 */
export function nativeOutputState(t: 'ios' | 'android', digest: string, verdict: NativeLanesVerdict | null): ArtifactState {
  const o = NATIVE_OUTPUT[t];
  const d = nativeDigest(digest, t);
  if (verdict === null) return { kind: 'analysis-only', digest: d, reason: `The ${o.name} output is analysis-only: no committed lanes verdict was given to this compilation, so the generated ${o.language} stays internal to the native lanes.` };
  if (verdict.recorded && verdict.stale.length === 0 && verdict.notPassing.length === 0) return { kind: 'ready', digest: d, files: emitNativeSupport(o.backend), assets: [] };
  const why = !verdict.recorded ? 'no committed lanes record proves it' : verdict.stale.length > 0 ? `its committed lanes are stale (${verdict.stale.join('; ')})` : `these lanes do not pass: ${verdict.notPassing.join('; ')}`;
  return { kind: 'analysis-only', digest: d, reason: `The ${o.name} output is analysis-only: its layout projection feeds the internal lanes, and the generated ${o.language} stays internal to the native lanes until every ${t} lane passes in a current committed lanes record; ${why}.` };
}

type Analysis<K extends string> = {
  readonly report: CheckReport<K>;
  readonly outputs: { [P in K]: ArtifactState };
  readonly record: InternalRecord;
  readonly linked: Linked | null;
};

/** Order-free input lists sorted canonically, so the digest does not depend on their order (S5 (c)). */
function canonicalInput(input: FrontEndResult): unknown {
  // Each entry is serialised once, as its sort key, and enters the digest as that text: assets hold megabytes of font bytes.
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map((x) => new CanonicalText(canonicalJson(x))).sort((a, b) => (a.json < b.json ? -1 : a.json > b.json ? 1 : 0)) : v);
  const raw = input as unknown as Record<string, unknown>;
  const snap = raw['snapshot'];
  const tree = raw['tree'];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  return {
    ...raw,
    snapshot: isObj(snap) ? { ...snap, sources: sorted(snap['sources']), assets: sorted(snap['assets']), resolutions: sorted(snap['resolutions']) } : snap,
    tree: isObj(tree) ? { ...tree, modules: sorted(tree['modules']), components: sorted(tree['components']), styles: sorted(tree['styles']) } : tree,
  };
}

/** Each profile snapshot's SHA-256 over its canonical JSON, computed once: profiles are megabytes, and a snapshot never changes. */
const profileDigests = new WeakMap<SupportProfile, string>();
function profileDigest(profile: SupportProfile): string {
  if (!profileSnapshots.has(profile)) throw new Error('profileDigest reads only profile snapshots');
  let d = profileDigests.get(profile);
  if (d === undefined) {
    d = `sha256:${sha256Hex(canonicalJson(profile))}`;
    profileDigests.set(profile, d);
  }
  return d;
}

/** A property name css-tree's default lexer knows (the MDN data it bundles): its css-tree.d.ts declares only what the parser uses. */
const isKnownProperty = (name: string): boolean => (cssTree as unknown as { readonly lexer: { getProperty(n: string): unknown } }).lexer.getProperty(name) !== null;

function analyze<K extends string>(config: { projectId: string; targets: object; fonts?: unknown; images?: ImageAssetMap }, configDiagnostics: readonly Diagnostic[], options: Resolved, input: FrontEndResult): Analysis<K> {
  const targets = Object.keys(config.targets).filter((k): k is KnownTarget => (KNOWN_TARGETS as readonly string[]).includes(k)).sort();
  const diagnostics: Diagnostic[] = [...configDiagnostics];
  const profiles = options.supportProfiles;
  const dependencies: Dependency[] = [];
  let linked: Linked | null = null;
  let cases: CaseResult[] = [];
  let fonts: ProjectFonts | null = null;
  let images: CompiledImages | null = null;
  // MQ-a: every band's cases, band 0 first (one entry for a sheet without @media), and the band the native output comes from.
  let bandCases: { readonly band: Band | null; readonly cases: CaseResult[] }[] = [];
  let animation: AnimationAnalysis | null = null;
  let laneOnlyNative: ('ios' | 'android')[] = [];
  let bands: Bands | null = null;
  let nativeBand = 0;
  const valid = configDiagnostics.length === 0 ? validateInput(input, config.projectId, diagnostics) : null;
  if (valid !== null) {
    const rules: Rule[] = [];
    const enclosed: EnclosedRules[] = [];
    const fontFaces: AtRuleContext[] = [];
    const keyframeSources: KeyframesSource[] = [];
    let order = 0;
    for (const useId of valid.document.styles) {
      const use = valid.styles.get(useId);
      if (use === undefined) continue;
      const src = valid.sources.get(use.css.source.uri);
      if (src === undefined) continue;
      dependencies.push({ kind: 'stylesheet', uri: src.ref.uri, hash: src.ref.hash });
      const sheet = { id: use.id, owner: valid.styleOwner.get(use.id) as string, scope: use.scope.kind };
      const before = enclosed.length;
      const parsed = parseStylesheet(src.text.slice(use.css.start, use.css.end), use.css, sheet, order, diagnostics, enclosed, fontFaces, keyframeSources);
      for (const r of [...parsed, ...enclosed.slice(before).flatMap((e) => e.rules)]) for (const d of r.declarations) order = Math.max(order, d.order + 1);
      rules.push(...parsed);
    }
    for (const s of [...valid.sources.values()].sort((a, b) => (a.ref.uri < b.ref.uri ? -1 : a.ref.uri > b.ref.uri ? 1 : 0))) dependencies.push({ kind: 'source', uri: s.ref.uri, hash: s.ref.hash });
    // T065: the @keyframes blocks parse with the stylesheet, so their refusals come whether or not the analysis runs.
    const keyframesRules = parseKeyframesRules(keyframeSources, diagnostics);
    // NA-NATIVE: a refusal of a listed property or rule blocks only web; native gets an info (css/not-applicable.ts).
    diagnostics.splice(0, diagnostics.length, ...splitNotApplicable(diagnostics, targets));
    diagnostics.push(...interactionRefusals(rules));
    const nativeRefusals = nativeInteractionRefusals(rules, NATIVE_TARGETS.filter((t) => targets.includes(t)));
    if (options.interactionLanes) laneOnlyNative = NATIVE_TARGETS.filter((t) => nativeRefusals.some((d) => d.target === t));
    else diagnostics.push(...nativeRefusals);
    const conditions = conditionsOf(rules);
    const partition = conditions.length === 0 ? null : band(conditions.map((c) => c.list));
    if (partition !== null && partition.kind === 'refused') {
      // The at-rule handler refuses the other band refusals per at-rule; only the band count is a property of the whole sheet.
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
        origin: authored((conditions[0] as RuleCondition).span),
        message: `the @media rules of this document split the viewport into ${partition.detail}, which is not supported until MQ-R`,
      }));
      rules.splice(0, rules.length, ...rules.filter((r) => r.condition === undefined));
    } else if (partition !== null) {
      bands = { partition, conditions };
      nativeBand = nativeBandIndex(bands, options.foldViewport, options.faults);
      if (partition.bands.length > 1 && options.foldViewport === null) {
        // Without a fold viewport the native output has no band to be resolved in (MQ-R adds the runtime choice).
        for (const t of NATIVE_TARGETS) {
          if (!targets.includes(t)) continue;
          for (const c of conditions) {
            if (featuresOfList(c.list).length === 0) continue;
            diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
              origin: authored(c.span),
              target: t,
              message: `@media ${c.text} selects rules by the viewport width or height, which the ${t} output does not support until MQ-R`,
            }));
          }
        }
      }
    }
    for (const c of valid.components.values()) checkTemplates(c.root, diagnostics);
    // MQ-a: each band is checked for the targets resolved in it (native in its band only, web in every band); a rule-level check
    // reports a rule for the targets of the bands it applies in, so nothing web-only blocks native and nothing native is lost.
    const bandList = bands === null ? [null] : bands.partition.bands;
    const passTargets = (k: number): readonly KnownTarget[] => (k === nativeBand ? targets : targets.filter((t) => t === 'web'));
    const bandRules = bandList.map((b) => new Set(rulesIn(rules, bands, b, options.faults)));
    const scopeOf: RuleScope = (r) => targets.filter((t) => bandRules.some((set, k) => passTargets(k).includes(t) && set.has(r)));
    fonts = compileFonts(input, config.fonts, fontFaces, diagnostics);
    checkFamilies(rules, fonts.keys, options.faults, diagnostics, { of: scopeOf, targets });
    const keys = fonts.keys;
    const valuesAt = diagnostics.length;
    linked = linkDocument(valid, { stateCollapse: options.faults.stateCollapse }, diagnostics);
    // An unsupported at-rule blocks every output but does not stop the analysis (T005 rec 3): every diagnostic comes in one pass.
    const fatal = diagnostics.some((d) => d.severity === 'error' && d.target === null && d.code !== 'DRAGON_UNSUPPORTED_AT_RULE');
    if (linked !== null && !fatal) {
      const found = linked;
      const projectFonts = fonts;
      // Native targets are checked only in their band (the first without a fold viewport, where MQ-R refuses them); web in every
      // band. Each pass reports on its own, its diagnostics without a target scoped to the pass's targets, then all are merged.
      const passes = bandList.map((b, k) => {
        const own: Diagnostic[] = [];
        const bandTargets = passTargets(k);
        const result = { band: b, cases: checkCases(found, [...(bandRules[k] as Set<Rule>)], bandTargets, options, own, projectFonts, freshReported()) };
        return { result, diagnostics: scopedTo(own, bandTargets, targets) };
      });
      bandCases = passes.map((p) => p.result);
      diagnostics.push(...mergePasses(passes.map((p) => p.diagnostics)));
      cases = (bandCases[nativeBand] as { cases: CaseResult[] }).cases;
      // REPL-a: the images every band's resolved cases reference, read once.
      const assetBytes = new Map(input.snapshot.assets.map((a) => [a.id, a.bytes] as const));
      images = compileImages(bandCases.flatMap((b) => b.cases.flatMap((c) => (c.resolved === null ? [] : [c.resolved]))), config.images, assetBytes, diagnostics);
      // T065 ANIM-b1: transitions and animations over the native band's cases, gated per target like every other value.
      animation = analyzeAnimations({ cases, rules: [...(bandRules[nativeBand] as Set<Rule>)], allRules: rules, keyframes: keyframesRules, faults: options.faults, knownProperty: isKnownProperty }, diagnostics);
      if (options.profiles === 'enforce') gateAnimationFeatures(animation, targets, (t) => profileFor(profiles, t as KnownTarget), diagnostics);
      if ((targets as readonly string[]).includes('web')) refuseBandedAnimations(rules, (r) => bandRules.every((set) => set.has(r)), diagnostics);
      if (options.profiles === 'enforce') {
        const values: Diagnostic[] = [];
        // A target's messages list the contexts of the bands it is resolved in.
        const usedOf = (t: KnownTarget): UsedKey[] => bandCases.filter((_, k) => passTargets(k).includes(t)).flatMap((r) => r.cases.flatMap(allUsed));
        checkValues(rules, targets, profiles, usedOf, values, keys, scopeOf);
        diagnostics.splice(valuesAt, 0, ...values);
      }
      hitModelRefusals(cases, [...(bandRules[nativeBand] as Set<Rule>)], targets, options, diagnostics);
      // T005 rec 3: the rules inside each unsupported at-rule are analysed with the block unwrapped, in a scratch pass whose
      // diagnostics located inside the at-rule become its related entries. Nothing from this pass is resolved into an output.
      if (enclosed.length > 0) {
        const scratch: Diagnostic[] = [];
        const unwrapped = enclosed.flatMap((e) => e.rules);
        checkFamilies(unwrapped, keys, options.faults, scratch);
        // The unwrapped rules are analysed as if their own @media conditions held, against the rules of every band, with the
        // targets the main pass checks there (native in its band only), so a diagnostic that only another band's cascade raises is kept.
        const scratchSeen = freshReported();
        const scratchLinked = linked;
        const scratchCases = (bands === null ? [null] : bands.partition.bands).flatMap((b, k) =>
          checkCases(scratchLinked, [...rulesIn(rules, bands, b, options.faults), ...unwrapped], k === nativeBand ? targets : targets.filter((t) => t === 'web'), options, scratch, fonts, scratchSeen),
        );
        if (options.profiles === 'enforce') checkValues(unwrapped, targets, profiles, scratchCases.flatMap(allUsed), scratch, keys);
        for (const e of enclosed) {
          const found = [...e.diagnostics, ...scratch.filter((d) => inside(d.origin, e))];
          const related = found.map((d) => ({ origin: d.origin, message: `${d.code}${d.target === null ? '' : ` [${d.target}]`}: ${d.message}` }));
          const at = diagnostics.indexOf(e.atRule);
          if (at >= 0 && related.length > 0) diagnostics[at] = { ...e.atRule, related: [...e.atRule.related, ...related] };
        }
      }
    } else if (linked !== null) {
      if (options.profiles === 'enforce') {
        const values: Diagnostic[] = [];
        checkValues(rules, targets, profiles, [], values, keys, scopeOf);
        diagnostics.splice(valuesAt, 0, ...values);
      }
      cases = linked.cases.map((c) => ({ key: c.key, assignment: c.assignment, isInitial: c.isInitial, resolved: null, used: [], partition: null, interaction: [] }));
      bandCases = [{ band: null, cases }];
    } else if (options.profiles === 'enforce') {
      const values: Diagnostic[] = [];
      checkValues(rules, targets, profiles, [], values, keys, scopeOf);
      diagnostics.splice(valuesAt, 0, ...values);
    }
  }
  // The font manifest enters the digest only when the project has fonts, so a project without them keeps its digest.
  const fontsDigest = fonts === null || options.faults.fontManifestOutOfDigest ? null : fonts.projected.digestInput;
  const digestInput = {
    compiler: COMPILER_VERSION,
    webref: webrefVersion,
    chrome: options.ua.chromeVersion,
    // The reference platform of the UA dataset and the environment's root font are compilation inputs (docs/api.md §10.1).
    platform: options.ua.platform,
    rootFont: options.rootFont,
    profiles: targets.map((t) => profileDigest(profileFor(profiles, t))),
    // MF2: a result compiled without enforcing the profiles must never share a digest with an enforced one.
    profilesMode: options.profiles,
    direction: options.direction,
    config,
    input: canonicalInput(input),
    ...(fontsDigest === null ? {} : { fonts: fontsDigest }),
    // The image manifest enters the digest only when the project has images or an image map, as fonts do.
    ...(images === null || images.digestInput === null ? {} : { images: images.digestInput }),
  };
  // A sheet with one band keeps its digest; with more, the bands and the fold viewport are compilation inputs (MQ-a).
  const multiBand = bands !== null && bands.partition.bands.length > 1;
  const digest = sha256Hex(canonicalJson(bands === null || !multiBand ? digestInput : {
    ...digestInput,
    media: { bands: bands.partition.bands.map((b) => b.condition), fold: options.foldViewport },
  }));
  // One native lowering shared by every configured native target that is not already blocked; its refusals block each of them.
  const lowered = new Map<string, LayoutBox>();
  const lowerFor = NATIVE_TARGETS.filter((t) => targets.includes(t) && !diagnostics.some((d) => blocksTarget(d, t)));
  if (lowerFor.length > 0 && cases.length > 0) {
    const reported = new Set<string>();
    const lowerings = cases.flatMap((c) => (c.resolved === null ? [] : [{ key: c.key, resolved: c.resolved }, ...c.interaction.map((i) => ({ key: interactionKey(c.key, i.value), resolved: i.resolved }))]));
    for (const c of lowerings) {
      try {
        lowered.set(c.key, lowerTree(c.resolved, options.faults, options.ua, images === null ? new Map() : images.naturals));
      } catch (e) {
        if (!(e instanceof LoweringError)) throw e;
        const id = `${e.nodeId}|${e.property}|${e.message}`;
        if (reported.has(id)) continue;
        reported.add(id);
        const origin = originOfAddress(c.resolved, e.nodeId);
        for (const t of lowerFor) diagnostics.push(diagnostic(e.property === 'font-family' ? 'DRAGON_UNSUPPORTED_FONT' : 'DRAGON_LOWERING_FAILED', { origin, message: e.message, target: t }));
      }
    }
  }
  const status = {} as { [P in K]: 'checked' | 'blocked' };
  const outputs = {} as { [P in K]: ArtifactState };
  let web: ReturnType<typeof emitWebCss> | null = null;
  for (const t of targets) {
    const blocking = diagnostics.filter((d) => blocksTarget(d, t));
    const key = t as unknown as K;
    status[key] = blocking.length > 0 || cases.length === 0 ? 'blocked' : 'checked';
    if (status[key] === 'blocked') outputs[key] = { kind: 'blocked', diagnostics: blocking };
    else if (t === 'ios' || t === 'android') outputs[key] = nativeOutputState(t, digest, options.nativeLanes === null ? null : options.nativeLanes[t]);
    else {
      const webFonts = fonts === null || !fonts.used ? null : webFontsOf(fonts, options.faults);
      const [base, ...extra] = bandCases.map((r) => ({ condition: r.band === null ? 'all' : r.band.condition, cases: r.cases.map((c) => ({ key: c.key, root: c.resolved as ResolvedElement, interaction: webInteraction(c) })) }));
      const first = base as { condition: string; cases: { key: string; root: ResolvedElement; interaction?: WebInteraction | undefined }[] };
      web = emitWebCss(first.cases, digest, webFonts === null ? null : webFonts.context, extra, animation === null ? null : webAnimationsOf(animation, valueText), first.condition, !options.faults.webHoverUngated);
      outputs[key] = { kind: 'ready', digest, files: web.files, assets: webFonts === null ? [] : webFonts.assets() };
    }
  }
  const byUri = (a: { ref: { uri: string } }, b: { ref: { uri: string } }): number => (a.ref.uri < b.ref.uri ? -1 : a.ref.uri > b.ref.uri ? 1 : 0);
  const report: CheckReport<K> = {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    revision: input.snapshot.revision,
    digest,
    sources: [...input.snapshot.sources].sort(byUri).map((s) => ({ ref: { ...s.ref }, text: s.text, displayPath: s.displayPath })),
    dependencies,
    diagnostics,
    targets: status,
  };
  const nativeChecked = NATIVE_TARGETS.some((t) => status[t as unknown as K] === 'checked');
  const webClasses = web === null ? null : web.classOf;
  return {
    report,
    outputs,
    linked,
    record: {
      documentId: linked === null ? null : linked.documentId,
      direction: options.direction,
      platform: options.ua.platform,
      rootFont: options.rootFont,
      profiles: { web: profiles.web, ios: profiles.ios, android: profileFor(profiles, 'android') },
      linked,
      fonts: fonts === null ? NO_FONTS : fonts.keys,
      animation,
      laneOnlyNative,
      images: images === null ? new Map() : images.bytes,
      cases: cases.map((c) => ({
        key: c.key,
        assignment: c.assignment,
        isInitial: c.isInitial,
        resolved: c.resolved,
        nativeLowered: nativeChecked ? (lowered.get(c.key) ?? null) : null,
        webClassOf: webClasses === null ? null : (webClasses.get(c.key) ?? null),
        features: new Map(targets.map((t) => [t, [...new Set(c.used.map((u) => u.key))].sort()])),
        partition: c.partition,
        interaction: c.interaction.map((i) => ({ value: i.value, resolved: i.resolved, nativeLowered: nativeChecked ? (lowered.get(interactionKey(c.key, i.value)) ?? null) : null })),
      })),
    },
  };
}

/** @internal */
export function findResolved(root: ResolvedElement, address: string): { el: ResolvedElement; parent: ResolvedElement | null } | null {
  const walk = (el: ResolvedElement, parent: ResolvedElement | null): { el: ResolvedElement; parent: ResolvedElement | null } | null => {
    if (el.element.address === address) return { el, parent };
    for (const c of el.children) {
      if (c.kind === 'element') {
        const hit = walk(c, el);
        if (hit !== null) return hit;
      }
    }
    return null;
  };
  return walk(root, null);
}

/** The authored origin of an element or text address; an anonymous box takes its enclosing element's. */
function originOfAddress(root: ResolvedElement, address: string): Origin {
  const text = /^(.*):(?:text|space)\d+$/.exec(address);
  const hit = findResolved(root, text === null ? address.replace(/:anon\d+$/, '') : (text[1] as string));
  if (hit === null) return unlocated(`node ${address}`);
  if (text === null) return hit.el.element.node.origin;
  const t = hit.el.children.find((c): c is ResolvedText => c.kind === 'text' && c.node.address === address);
  return t === undefined ? hit.el.element.node.origin : t.node.node.origin;
}

// docs/api.md §6.1: author values point at their declaration; inherited values name the element they came from; defaults
// are built-in datasets, never invented spans.
function valueOrigin(root: ResolvedElement, address: string, p: Longhand, chromeVersion: string): Origin {
  const hit = findResolved(root, address);
  if (hit === null) return unlocated(`node ${address}`);
  const v = hit.el.props.get(p) as ResolvedValue;
  if (v.declaration !== null) return authored(v.declaration.span);
  if (v.origin === 'inherited' && hit.parent !== null) return { kind: 'inherited', element: hit.parent.element.address, from: valueOrigin(root, hit.parent.element.address, p, chromeVersion) };
  if (v.origin === 'user-agent') return { kind: 'builtin', dataset: `chrome-${chromeVersion} computed`, entry: `${hit.el.element.tag} ${p}` };
  if (v.origin === 'presentational-hint') {
    const attribute = hit.el.element.node.attributes.find((a) => a.name === (p === 'aspect-ratio' ? 'width' : p));
    return attribute === undefined ? hit.el.element.node.origin : attribute.origin;
  }
  if (v.origin === 'environment') return { kind: 'builtin', dataset: 'reference environment', entry: `${p} ${valueToString(v.value)}` };
  return { kind: 'builtin', dataset: `@webref/css ${webrefVersion} initial`, entry: p };
}

/** explain's support entry: the row's status, with its environment note when the row has one. */
function supportOfRow(profile: SupportProfile, feature: string, context: string): ExplainedCase['support'] {
  const row = profile.rows.find((r) => r.feature === feature && r.context === context);
  const status = statusOf(profile, feature, context);
  return row?.note === undefined ? { feature, context, status } : { feature, context, status, note: row.note };
}

function explainIn<K extends string>(a: Analysis<K>, q: ExplainQuery<K>, chromeVersion: string): ExplainResult<K> {
  const target = q.target as string;
  if (!(target in a.report.targets)) {
    return { kind: 'invalid-query', diagnostics: [diagnostic('DRAGON_CONFIG_INVALID', { origin: unlocated('explain query'), message: `target ${target} is not configured`, manual: 'Query a configured target.' })] };
  }
  const linked = a.linked;
  const docId = a.record.documentId;
  if (linked === null || docId === null) return { kind: 'not-found', reason: 'the input did not link' };
  const problems: Diagnostic[] = [];
  const partial = q.assignment === undefined ? [] : q.assignment;
  for (const entry of partial) {
    const v = linked.free.find((f) => f.instance === entry.state.instance && f.state === entry.state.state);
    if (v === undefined) problems.push(diagnostic('DRAGON_STATE_UNKNOWN', { origin: unlocated('explain query'), message: `${entry.state.instance}.${entry.state.state} is not a free state of document ${docId}` }));
    else if (!inDomain(v.domain, entry.value)) problems.push(diagnostic('DRAGON_STATE_VALUE_DOMAIN', { origin: unlocated('explain query'), message: `${JSON.stringify(entry.value)} is not in the domain of ${v.instance}.${v.state}` }));
  }
  if (problems.length > 0) return { kind: 'invalid-query', diagnostics: problems };
  if (a.report.targets[q.target] === 'blocked') return { kind: 'not-found', reason: `${target} is blocked` };
  const rel = q.at.instance === docId ? '' : q.at.instance.startsWith(`${docId}/`) ? q.at.instance.slice(docId.length + 1) : null;
  if (rel === null) return { kind: 'not-found', reason: `no instance ${q.at.instance}` };
  const address = rel === '' ? q.at.node : `${rel}/${q.at.node}`;
  const p = q.property as Longhand;
  const out: ExplainedCase[] = [];
  for (const c of a.record.cases) {
    if (!partial.every((e) => c.assignment.some((x) => x.state.instance === e.state.instance && x.state.state === e.state.state && x.value === e.value))) continue;
    if (c.resolved === null) continue;
    const hit = findResolved(c.resolved, address);
    const v = hit === null ? undefined : hit.el.props.get(p);
    if (hit === null || v === undefined) continue;
    const used = v.declaration === null || v.declared === null ? null : usedKeys(c.resolved, a.record.fonts).find((u) => u.address === address && u.property === p);
    const profile = profileFor(a.record.profiles, target as KnownTarget);
    out.push({
      node: q.at.node,
      instance: q.at.instance,
      target,
      assignment: c.assignment,
      property: q.property,
      value: valueToString(v.value),
      // A presentational hint is author-level in the cascade (css-cascade-5 §6.1); its origin names the attribute.
      cascade: v.origin === 'presentational-hint' ? 'author' : v.origin,
      origin: valueOrigin(c.resolved, address, p, chromeVersion),
      losing: v.losing.map((d) => ({
        origin: authored(d.span),
        reason: d === v.forcedOver ? `the user agent forces ${q.property} on this element whatever the cascade says` : 'lower specificity or earlier in the style order',
      })),
      support: used === null || used === undefined ? null : supportOfRow(profile, used.feature, used.context),
    });
  }
  if (out.length === 0) return { kind: 'not-found', reason: `no ${q.property} on ${address} in any matching case` };
  return { kind: 'found', target: q.target, cases: out };
}

/** A fold viewport is a finite, non-negative size in CSS px. */
function checkedViewport(v: Viewport): Viewport {
  if (![v.width, v.height].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) throw new Error(`foldViewport must be a finite, non-negative width and height, got ${JSON.stringify(v)}`);
  return { width: v.width, height: v.height };
}

/** @internal */
export function createProjectWith<const T extends Targets>(config: ProjectConfig<T>, options: InternalOptions): Project<Configured<T>> {
  type K = Configured<T>;
  const platform = options.platform === undefined ? REFERENCE_PLATFORM : options.platform;
  const choice = uaDatasetFor(platform);
  if (choice.kind === 'refused') throw new ReferencePlatformUnavailable(platform, choice.reason);
  const resolved: Resolved = {
    faults: options.faults,
    profiles: options.profiles,
    direction: options.direction,
    rootFont: options.rootFont === undefined ? 'ua-default' : options.rootFont,
    ua: choice.dataset,
    supportProfiles: snapshotProfiles(options.supportProfiles === undefined ? COMMITTED_PROFILES : options.supportProfiles),
    foldViewport: options.foldViewport === undefined ? null : checkedViewport(options.foldViewport),
    interactionLanes: options.interactionLanes === true,
    nativeLanes: options.nativeLanes === undefined ? null : options.nativeLanes,
  };
  const configDiagnostics = validateConfig(config);
  const snapshotConfig = JSON.parse(JSON.stringify(config)) as { projectId: string; targets: object; fonts?: unknown; images?: ImageAssetMap };
  return deepFreeze({
    compile(input: FrontEndResult): Compiled<K> {
      const a = analyze<K>(snapshotConfig, configDiagnostics, resolved, input);
      const compiled: Compiled<K> = {
        ...a.report,
        outputs: a.outputs,
        explain: (q: ExplainQuery<K>) => deepFreeze(explainIn<K>(a, q, resolved.ua.chromeVersion)),
      };
      records.set(compiled, a.record);
      return deepFreeze(compiled);
    },
    check(input: FrontEndResult): CheckReport<K> {
      return deepFreeze(analyze<K>(snapshotConfig, configDiagnostics, resolved, input).report);
    },
  });
}


/** @internal The origin of one resolved value, with the dataset of the result it came from. */
export function originOfValue(record: InternalRecord, root: ResolvedElement, address: string, p: Longhand): Origin {
  const choice = uaDatasetFor(record.platform);
  return valueOrigin(root, address, p, choice.kind === 'ok' ? choice.dataset.chromeVersion : 'unknown');
}

/** @internal */
export function caseByAssignment(record: InternalRecord, assignment: Assignment): InternalCase | undefined {
  const key = assignmentKey(assignment);
  return record.cases.find((c) => c.key === key);
}

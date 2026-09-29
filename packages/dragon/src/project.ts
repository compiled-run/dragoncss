// createProject: one configuration, complete snapshots, no publishable partial output (docs/api.md §2.1-2.2).
// Every reachable assignment is resolved, checked and lowered as its own case; nothing is deduplicated (docs/api.md §7).
import type { LayoutBox } from '@dragon/layout';
import { attributeRefusal } from './attributes.ts';
import { CanonicalText, canonicalJson, sha256Hex } from './digest.ts';
import { authored, diagnostic, unlocated } from './diagnostics/catalogue.ts';
import { webrefVersion } from './css/grammar.generated.ts';
import type { Longhand } from './css/properties.ts';
import { PROPERTY_ROLE } from './css/properties.ts';
import type { Declaration, EnclosedRules, Rule } from './css/stylesheet.ts';
import { featureOf, parseStylesheet } from './css/stylesheet.ts';
import type { UsedKey } from './analysis/context.ts';
import { usedKeys } from './analysis/context.ts';
import { checkComputed } from './analysis/computed-checks.ts';
import { inDomain, validateInput } from './analysis/input.ts';
import type { Linked } from './analysis/link.ts';
import { assignmentKey, linkDocument } from './analysis/link.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue, RootFont } from './analysis/resolve.ts';
import { resolveTree, SUPPORTED_TAGS, valueToString } from './analysis/resolve.ts';
import { emitWebCss } from './emit/web-css.ts';
import type { CompilerFaults } from './faults.ts';
import { NO_FAULTS } from './faults.ts';
import { LoweringError, lowerTree, textFontProblem } from './lower/ios-layout.ts';
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
  ExplainedCase,
  ExplainQuery,
  ExplainResult,
  FrontEndResult,
  Origin,
  Project,
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

/** @internal The committed support profiles. */
export const COMMITTED_PROFILES: Required<SupportProfiles> = { web: webProfile, ios: iosProfile, android: androidProfile };

/** @internal The profile of one target. */
export function profileFor(profiles: SupportProfiles, t: KnownTarget): SupportProfile {
  return t === 'android' ? (profiles.android === undefined ? androidProfile : profiles.android) : profiles[t];
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
};

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
 * the public entry uses 'ua-default'. supportProfiles: test-only replacement profiles.
 */
export type InternalOptions = {
  readonly faults: CompilerFaults;
  readonly profiles: 'enforce' | 'derive';
  readonly direction: 'ltr' | 'rtl';
  readonly platform?: string;
  readonly rootFont?: RootFont;
  readonly supportProfiles?: SupportProfiles;
};

type Resolved = {
  readonly faults: CompilerFaults;
  readonly profiles: 'enforce' | 'derive';
  readonly direction: 'ltr' | 'rtl';
  readonly rootFont: RootFont;
  readonly ua: UaDataset;
  readonly supportProfiles: SupportProfiles;
};

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v) && !(v instanceof Uint8Array) && !(v instanceof Map)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

function validateConfig(config: { projectId: unknown; targets: unknown }): Diagnostic[] {
  const out: Diagnostic[] = [];
  const bad = (message: string, manual: string): void => {
    out.push(diagnostic('DRAGON_CONFIG_INVALID', { origin: unlocated('configuration'), message, manual }));
  };
  if (typeof config.projectId !== 'string' || config.projectId.length === 0) bad('projectId must be a non-empty string', 'Set projectId.');
  for (const k of Object.keys(config)) if (k !== 'projectId' && k !== 'targets') bad(`unknown configuration key "${k}"`, `Remove ${k}.`);
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
function checkValues(rules: readonly Rule[], targets: readonly KnownTarget[], profiles: SupportProfiles, used: readonly UsedKey[], diagnostics: Diagnostic[]): void {
  const seen = new Set<Declaration>();
  for (const rule of rules) {
    // A rule Chrome drops never applies (css/selectors.ts), so its values need no support.
    if (rule.selectors.every((s) => s.dropped)) continue;
    for (const d of rule.declarations) {
      if (seen.has(d)) continue;
      seen.add(d);
      for (const lh of d.longhands) {
        const feature = featureOf(lh.property, lh.value);
        for (const t of targets) {
          const profile = profileFor(profiles, t);
          if (provenContexts(profile, feature).length > 0) continue;
          const values = supportedValuesFor(profile, lh.property);
          const contexts = [...new Set(used.filter((u) => u.declaration === d && u.property === lh.property).map((u) => u.context))].sort();
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
function checkFonts(root: ResolvedElement, diagnostics: Diagnostic[], reported: Set<string>, target: 'ios' | 'android'): void {
  const walk = (el: ResolvedElement): void => {
    const display = (el.props.get('display') as ResolvedValue).value;
    if (display.kind === 'keyword' && display.value === 'none') return;
    for (const c of el.children) {
      if (c.kind === 'element') {
        walk(c);
        continue;
      }
      const message = textFontProblem(c);
      if (message === null) continue;
      const id = `${target}|${c.node.address}|font-family|${message}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_FONT', { origin: c.node.node.origin, message, target }));
    }
  };
  walk(root);
}

type CaseResult = { key: string; assignment: Assignment; isInitial: boolean; resolved: ResolvedElement | null; used: UsedKey[] };

/**
 * Resolves and checks every case: computed-value refusals, fonts, then (when enforcing) the contextual check, where a feature
 * proven only in other contexts blocks with the proven contexts, the alternatives in its own context (T005 rec 6) and, for a
 * shorthand-filled longhand, the shorthand and what to write instead (T005 rec 2).
 */
function checkCases(linked: Linked, rules: readonly Rule[], targets: readonly KnownTarget[], options: Resolved, diagnostics: Diagnostic[]): CaseResult[] {
  const reported = new Set<string>();
  const refused = new Set<string>();
  const fonts = new Set<string>();
  const out: CaseResult[] = [];
  for (const c of linked.cases) {
    const resolved = resolveTree(c.root, rules, options.faults, { direction: options.direction, rootFont: options.rootFont, ua: options.ua });
    checkComputed(resolved, targets, diagnostics, refused, options.profiles === 'derive' ? null : (t) => profileFor(options.supportProfiles, t as KnownTarget));
    for (const t of NATIVE_TARGETS) if (targets.includes(t)) checkFonts(resolved, diagnostics, fonts, t);
    const used = usedKeys(resolved);
    out.push({ key: c.key, assignment: c.assignment, isInitial: c.isInitial, resolved, used });
    if (options.profiles === 'derive') continue;
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
            && statusOf(profile, featureOf(lh.property, lh.value), u.context) !== 'unsupported');
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
  }
  return out;
}

const inside = (o: Origin, e: EnclosedRules): boolean =>
  o.kind === 'authored' && o.span.source.uri === e.span.source.uri && o.span.start >= e.span.start && o.span.end <= e.span.end;

type Analysis<K extends string> = {
  readonly report: CheckReport<K>;
  readonly outputs: { [P in K]: ArtifactState };
  readonly record: InternalRecord;
  readonly linked: Linked | null;
};

/** Order-free input lists sorted canonically, so the digest does not depend on their order (S5 (c)). */
function canonicalInput(input: FrontEndResult): unknown {
  const sorted = (v: unknown): unknown => (Array.isArray(v) ? [...v].sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0)) : v);
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

/** Each support profile's canonical JSON, written once: profiles are megabytes, and a profile is never changed after it is built. */
const profileTexts = new WeakMap<SupportProfile, CanonicalText>();
function profileText(profile: SupportProfile): CanonicalText {
  let t = profileTexts.get(profile);
  if (t === undefined) {
    t = new CanonicalText(canonicalJson(profile));
    profileTexts.set(profile, t);
  }
  return t;
}

function analyze<K extends string>(config: { projectId: string; targets: object }, configDiagnostics: readonly Diagnostic[], options: Resolved, input: FrontEndResult): Analysis<K> {
  const targets = Object.keys(config.targets).filter((k): k is KnownTarget => (KNOWN_TARGETS as readonly string[]).includes(k)).sort();
  const diagnostics: Diagnostic[] = [...configDiagnostics];
  const profiles = options.supportProfiles;
  const digest = sha256Hex(canonicalJson({
    compiler: COMPILER_VERSION,
    webref: webrefVersion,
    chrome: options.ua.chromeVersion,
    // The reference platform of the UA dataset and the environment's root font are compilation inputs (docs/api.md §10.1).
    platform: options.ua.platform,
    rootFont: options.rootFont,
    profiles: targets.map((t) => profileText(profileFor(profiles, t))),
    // MF2: a result compiled without enforcing the profiles must never share a digest with an enforced one.
    profilesMode: options.profiles,
    direction: options.direction,
    config,
    input: canonicalInput(input),
  }));
  const dependencies: Dependency[] = [];
  let linked: Linked | null = null;
  let cases: CaseResult[] = [];
  const valid = configDiagnostics.length === 0 ? validateInput(input, config.projectId, diagnostics) : null;
  if (valid !== null) {
    const rules: Rule[] = [];
    const enclosed: EnclosedRules[] = [];
    let order = 0;
    for (const useId of valid.document.styles) {
      const use = valid.styles.get(useId);
      if (use === undefined) continue;
      const src = valid.sources.get(use.css.source.uri);
      if (src === undefined) continue;
      dependencies.push({ kind: 'stylesheet', uri: src.ref.uri, hash: src.ref.hash });
      const sheet = { id: use.id, owner: valid.styleOwner.get(use.id) as string, scope: use.scope.kind };
      const before = enclosed.length;
      const parsed = parseStylesheet(src.text.slice(use.css.start, use.css.end), use.css, sheet, order, diagnostics, enclosed);
      for (const r of [...parsed, ...enclosed.slice(before).flatMap((e) => e.rules)]) for (const d of r.declarations) order = Math.max(order, d.order + 1);
      rules.push(...parsed);
    }
    for (const s of [...valid.sources.values()].sort((a, b) => (a.ref.uri < b.ref.uri ? -1 : a.ref.uri > b.ref.uri ? 1 : 0))) dependencies.push({ kind: 'source', uri: s.ref.uri, hash: s.ref.hash });
    for (const c of valid.components.values()) checkTemplates(c.root, diagnostics);
    const valuesAt = diagnostics.length;
    linked = linkDocument(valid, { stateCollapse: options.faults.stateCollapse }, diagnostics);
    // An unsupported at-rule blocks every output but does not stop the analysis (T005 rec 3): every diagnostic comes in one pass.
    const fatal = diagnostics.some((d) => d.severity === 'error' && d.target === null && d.code !== 'DRAGON_UNSUPPORTED_AT_RULE');
    if (linked !== null && !fatal) {
      cases = checkCases(linked, rules, targets, options, diagnostics);
      if (options.profiles === 'enforce') {
        const values: Diagnostic[] = [];
        checkValues(rules, targets, profiles, cases.flatMap((c) => c.used), values);
        diagnostics.splice(valuesAt, 0, ...values);
      }
      // T005 rec 3: the rules inside each unsupported at-rule are analysed with the block unwrapped, in a scratch pass whose
      // diagnostics located inside the at-rule become its related entries. Nothing from this pass is resolved into an output.
      if (enclosed.length > 0) {
        const scratch: Diagnostic[] = [];
        const unwrapped = enclosed.flatMap((e) => e.rules);
        const scratchCases = checkCases(linked, [...rules, ...unwrapped], targets, options, scratch);
        if (options.profiles === 'enforce') checkValues(unwrapped, targets, profiles, scratchCases.flatMap((c) => c.used), scratch);
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
        checkValues(rules, targets, profiles, [], values);
        diagnostics.splice(valuesAt, 0, ...values);
      }
      cases = linked.cases.map((c) => ({ key: c.key, assignment: c.assignment, isInitial: c.isInitial, resolved: null, used: [] }));
    } else if (options.profiles === 'enforce') {
      const values: Diagnostic[] = [];
      checkValues(rules, targets, profiles, [], values);
      diagnostics.splice(valuesAt, 0, ...values);
    }
  }
  // One native lowering shared by every configured native target that is not already blocked; its refusals block each of them.
  const lowered = new Map<string, LayoutBox>();
  const lowerFor = NATIVE_TARGETS.filter((t) => targets.includes(t) && !diagnostics.some((d) => blocksTarget(d, t)));
  if (lowerFor.length > 0 && cases.length > 0) {
    const reported = new Set<string>();
    for (const c of cases) {
      if (c.resolved === null) continue;
      try {
        lowered.set(c.key, lowerTree(c.resolved, options.faults, options.ua));
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
    else if (t === 'ios') outputs[key] = { kind: 'analysis-only', digest, reason: 'The iOS output is analysis-only: its layout projection feeds the internal lanes, and the generated UIKit Swift is internal to the native lanes until an iOS native case passes.' };
    else if (t === 'android') outputs[key] = { kind: 'analysis-only', digest, reason: 'The Android output is analysis-only: its layout projection feeds the internal lanes, and the generated Android Views Kotlin is internal to the native lanes until an Android native case passes.' };
    else {
      web = emitWebCss(cases.map((c) => ({ key: c.key, root: c.resolved as ResolvedElement })), digest);
      outputs[key] = { kind: 'ready', digest, files: web.files };
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
      cases: cases.map((c) => ({
        key: c.key,
        assignment: c.assignment,
        isInitial: c.isInitial,
        resolved: c.resolved,
        nativeLowered: nativeChecked ? (lowered.get(c.key) ?? null) : null,
        webClassOf: webClasses === null ? null : (webClasses.get(c.key) ?? null),
        features: new Map(targets.map((t) => [t, [...new Set(c.used.map((u) => u.key))].sort()])),
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
  if (v.origin === 'environment') return { kind: 'builtin', dataset: 'reference environment', entry: `${p} ${valueToString(v.value)}` };
  return { kind: 'builtin', dataset: `@webref/css ${webrefVersion} initial`, entry: p };
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
    const used = v.declaration === null || v.declared === null ? null : usedKeys(c.resolved).find((u) => u.address === address && u.property === p);
    const profile = profileFor(a.record.profiles, target as KnownTarget);
    out.push({
      node: q.at.node,
      instance: q.at.instance,
      target,
      assignment: c.assignment,
      property: q.property,
      value: valueToString(v.value),
      cascade: v.origin,
      origin: valueOrigin(c.resolved, address, p, chromeVersion),
      losing: v.losing.map((d) => ({ origin: authored(d.span), reason: 'lower specificity or earlier in the style order' })),
      support: used === null || used === undefined ? null : { feature: used.feature, context: used.context, status: statusOf(profile, used.feature, used.context) },
    });
  }
  if (out.length === 0) return { kind: 'not-found', reason: `no ${q.property} on ${address} in any matching case` };
  return { kind: 'found', target: q.target, cases: out };
}

/** @internal */
export function createProjectWith<const T extends Targets>(config: { projectId: string; targets: T }, options: InternalOptions): Project<Configured<T>> {
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
    supportProfiles: options.supportProfiles === undefined ? COMMITTED_PROFILES : options.supportProfiles,
  };
  const configDiagnostics = validateConfig(config);
  const snapshotConfig = JSON.parse(JSON.stringify(config)) as { projectId: string; targets: object };
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

export function createProject<const T extends Targets>(config: { projectId: string; targets: T }): Project<Configured<T>> {
  return createProjectWith(config, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' });
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

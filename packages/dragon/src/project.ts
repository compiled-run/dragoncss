// createProject: one configuration, complete snapshots, no publishable partial output (docs/api.md §2.1-2.2).
import type { LayoutBox } from '@dragon/layout';
import { canonicalJson, sha256Hex } from './digest.ts';
import { webrefVersion } from './css/grammar.generated.ts';
import type { Longhand } from './css/properties.ts';
import type { Declaration, Rule } from './css/stylesheet.ts';
import { diag, featureOf, parseStylesheet } from './css/stylesheet.ts';
import { validateInput } from './analysis/input.ts';
import type { ResolvedElement } from './analysis/resolve.ts';
import { resolveTree, SUPPORTED_TAGS, valueToString } from './analysis/resolve.ts';
import type { LoweringFaults } from './lower/ios-layout.ts';
import { LoweringError, lowerTree, NO_FAULTS } from './lower/ios-layout.ts';
import { iosProfile } from './profiles/ios.ts';
import type { SupportProfile } from './profiles/types.ts';
import { statusOf, supportedValuesFor } from './profiles/types.ts';
import { webProfile } from './profiles/web.ts';
import { chromeVersion } from './ua/chrome-145.generated.ts';
import type {
  ArtifactState,
  CheckReport,
  Compiled,
  Configured,
  Dependency,
  Diagnostic,
  ElementNode,
  ExplainQuery,
  ExplainResult,
  FrontEndResult,
  Project,
  Target,
  Targets,
} from './types.ts';

export const COMPILER_VERSION = '1.0.0-alpha.0';
const KNOWN_TARGETS = ['web', 'ios'] as const;
type KnownTarget = (typeof KNOWN_TARGETS)[number];

const PROFILES: { readonly [T in KnownTarget]: SupportProfile } = { web: webProfile, ios: iosProfile };

/** Internal-only data kept beside a compiled result; never reachable from the public entry. */
export type InternalRecord = {
  readonly iosLayout: LayoutBox | null;
  readonly featuresByTarget: ReadonlyMap<Target, readonly string[]>;
};

const records = new WeakMap<object, InternalRecord>();

export function internalRecord(compiled: object): InternalRecord | undefined {
  return records.get(compiled);
}

export type InternalOptions = { readonly faults: LoweringFaults };

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v) && !(v instanceof Uint8Array)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

function validateConfig(config: { projectId: unknown; targets: unknown }): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (typeof config.projectId !== 'string' || config.projectId.length === 0) {
    out.push(diag('DRAGON_CONFIG_INVALID', 'projectId must be a non-empty string', null, 'Set projectId.'));
  }
  const t = config.targets;
  if (typeof t !== 'object' || t === null || Object.keys(t).length === 0) {
    out.push(diag('DRAGON_CONFIG_INVALID', 'targets must name at least one target', null, 'Configure { ios: { minimum: "15.0" } } or { web: {} }.'));
    return out;
  }
  for (const [k, v] of Object.entries(t)) {
    if (!(KNOWN_TARGETS as readonly string[]).includes(k)) {
      out.push(diag('DRAGON_CONFIG_INVALID', `unknown target "${k}" (milestone 1 knows web and ios)`, null, 'Remove the target.'));
    } else if (k === 'ios' && (typeof v !== 'object' || v === null || typeof (v as { minimum?: unknown }).minimum !== 'string')) {
      out.push(diag('DRAGON_CONFIG_INVALID', 'ios needs { minimum: string }', null, 'Set ios.minimum, for example "15.0" (decision 6).'));
    } else if (k === 'web' && (typeof v !== 'object' || v === null || Object.keys(v).length !== 0)) {
      out.push(diag('DRAGON_CONFIG_INVALID', 'web takes no options in milestone 1', null, 'Use web: {}.'));
    }
  }
  return out;
}

function blocksTarget(d: Diagnostic, t: Target): boolean {
  return d.severity === 'error' && (d.targets.length === 0 || d.targets.includes(t));
}

function checkElements(el: ElementNode, diagnostics: Diagnostic[]): void {
  if (!SUPPORTED_TAGS.has(el.tag)) {
    diagnostics.push(diag('DRAGON_UNSUPPORTED_ELEMENT', `<${el.tag}> is not supported in milestone 1 (html, body, div)`, el.origin, 'Use a div.'));
  }
  for (const a of el.attributes) {
    diagnostics.push(diag('DRAGON_UNSUPPORTED_ATTRIBUTE', `attribute ${a.name} on ${el.id} is not supported in milestone 1`, el.origin, 'Move styling into the stylesheet and use classes.'));
  }
  for (const c of el.children) if (c.kind === 'element') checkElements(c, diagnostics);
}

/** Checks each explicitly authored longhand against every configured target's profile. */
function checkSupport(rules: readonly Rule[], targets: readonly KnownTarget[], diagnostics: Diagnostic[]): Map<Target, string[]> {
  const features = new Map<Target, string[]>();
  for (const t of targets) features.set(t, []);
  const seen = new Set<Declaration>();
  for (const rule of rules) {
    for (const d of rule.declarations) {
      if (seen.has(d)) continue;
      seen.add(d);
      for (const lh of d.longhands) {
        if (!lh.explicit) continue;
        const feature = featureOf(lh.property, lh.value);
        for (const t of targets) {
          const status = statusOf(PROFILES[t], feature);
          (features.get(t) as string[]).push(feature);
          if (status === 'unsupported') {
            const values = supportedValuesFor(PROFILES[t], lh.property);
            diagnostics.push(diag(
              'DRAGON_UNSUPPORTED_VALUE',
              `${lh.property}: ${valueToString(lh.value)} is unsupported on ${t} (support profile ${PROFILES[t].revision})`,
              d.valueSpan,
              values.length > 0 ? `Use one of: ${values.join(', ')}.` : `Remove ${d.property}; ${t} supports no value of ${lh.property} yet.`,
              [t],
            ));
          }
        }
      }
    }
  }
  for (const [t, list] of features) features.set(t, [...new Set(list)].sort());
  return features;
}

type Analysis<K extends string> = {
  readonly report: CheckReport<K>;
  readonly outputs: { [P in K]: ArtifactState };
  readonly resolved: ResolvedElement | null;
  readonly record: InternalRecord;
};

function analyze<K extends string>(config: { projectId: string; targets: object }, configDiagnostics: readonly Diagnostic[], options: InternalOptions, input: FrontEndResult): Analysis<K> {
  const targets = Object.keys(config.targets).filter((k): k is KnownTarget => (KNOWN_TARGETS as readonly string[]).includes(k));
  const diagnostics: Diagnostic[] = [...configDiagnostics];
  const digest = sha256Hex(canonicalJson({
    compiler: COMPILER_VERSION,
    webref: webrefVersion,
    chrome: chromeVersion,
    profiles: targets.map((t) => PROFILES[t]),
    config,
    input,
  }));
  let resolved: ResolvedElement | null = null;
  let features = new Map<Target, string[]>();
  let iosLayout: LayoutBox | null = null;
  const dependencies: Dependency[] = [];
  const valid = configDiagnostics.length === 0 ? validateInput(input, config.projectId, diagnostics) : null;
  if (valid !== null) {
    const rules: Rule[] = [];
    let order = 0;
    for (const useId of valid.document.styles) {
      const use = valid.tree.styles.find((s) => s.id === useId);
      if (use === undefined) continue;
      const src = valid.sources.get(use.css.source.uri);
      if (src === undefined) continue;
      dependencies.push({ kind: 'stylesheet', uri: src.ref.uri, hash: src.ref.hash });
      const parsed = parseStylesheet(src.text.slice(use.css.start, use.css.end), use.css, order, diagnostics);
      for (const r of parsed) for (const d of r.declarations) order = Math.max(order, d.order + 1);
      rules.push(...parsed);
    }
    for (const s of valid.sources.values()) dependencies.push({ kind: 'source', uri: s.ref.uri, hash: s.ref.hash });
    checkElements(valid.root, diagnostics);
    features = checkSupport(rules, targets, diagnostics);
    if (!diagnostics.some((d) => blocksTarget(d, 'ios') && d.targets.length === 0)) {
      resolved = resolveTree(valid.root, rules);
    }
    if (resolved !== null && targets.includes('ios') && !diagnostics.some((d) => blocksTarget(d, 'ios'))) {
      try {
        iosLayout = lowerTree(resolved, options.faults);
      } catch (e) {
        if (!(e instanceof LoweringError)) throw e;
        const node = findNode(valid.root, e.nodeId);
        diagnostics.push(diag(
          e.property === 'font-family' ? 'DRAGON_UNSUPPORTED_FONT' : 'DRAGON_LOWERING_FAILED',
          e.message,
          node === null ? null : node.origin,
          e.property === 'font-family' ? 'Set font-family: Ahem on text for the milestone-1 layout lane.' : null,
          ['ios'],
        ));
      }
    }
  }
  const status = {} as { [P in K]: 'checked' | 'blocked' };
  const outputs = {} as { [P in K]: ArtifactState };
  for (const t of targets) {
    const blocking = diagnostics.filter((d) => blocksTarget(d, t));
    const key = t as unknown as K;
    status[key] = blocking.length > 0 ? 'blocked' : 'checked';
    if (blocking.length > 0) outputs[key] = { kind: 'blocked', diagnostics: blocking };
    else if (t === 'ios') outputs[key] = { kind: 'analysis-only', digest, reason: 'Milestone 1 iOS output is analysis-only: its layout projection feeds the internal Linux lane; no Swift is emitted.' };
    else outputs[key] = { kind: 'analysis-only', digest, reason: 'The web emitter arrives in S2.' };
  }
  if (diagnostics.some((d) => d.severity === 'error' && d.targets.length === 0)) iosLayout = null;
  const report: CheckReport<K> = {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    revision: input.snapshot.revision,
    digest,
    sources: input.snapshot.sources.map((s) => ({ ref: { ...s.ref }, text: s.text, displayPath: s.displayPath })),
    dependencies,
    diagnostics,
    targets: status,
  };
  return { report, outputs, resolved, record: { iosLayout: status['ios' as K] === 'checked' ? iosLayout : null, featuresByTarget: features } };
}

function findNode(el: ElementNode, id: string): ElementNode | null {
  if (el.id === id) return el;
  for (const c of el.children) {
    if (c.kind === 'element') {
      const hit = findNode(c, id);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function explainIn<K extends string>(resolved: ResolvedElement | null, blocked: (t: K) => boolean, q: ExplainQuery<K>): ExplainResult<K> {
  if (resolved === null) return { kind: 'unknown', reason: 'the input did not resolve' };
  if (blocked(q.target)) return { kind: 'unknown', reason: `${q.target} is blocked` };
  const find = (el: ResolvedElement): ResolvedElement | null => {
    if (el.node.id === q.node) return el;
    for (const c of el.children) {
      if (c.kind === 'element') {
        const hit = find(c);
        if (hit !== null) return hit;
      }
    }
    return null;
  };
  const el = find(resolved);
  const v = el === null ? undefined : el.props.get(q.property as Longhand);
  if (el === null || v === undefined) return { kind: 'unknown', reason: `no ${q.property} on ${q.node}` };
  return { kind: 'resolved', target: q.target, node: q.node, property: q.property, value: valueToString(v.value), origin: v.origin, span: v.span };
}

export function createProjectWith<const T extends Targets>(config: { projectId: string; targets: T }, options: InternalOptions): Project<Configured<T>> {
  type K = Configured<T>;
  const configDiagnostics = validateConfig(config);
  const snapshotConfig = JSON.parse(JSON.stringify(config)) as { projectId: string; targets: object };
  return deepFreeze({
    compile(input: FrontEndResult): Compiled<K> {
      const a = analyze<K>(snapshotConfig, configDiagnostics, options, input);
      const compiled: Compiled<K> = {
        ...a.report,
        outputs: a.outputs,
        explain: (q: ExplainQuery<K>) => explainIn<K>(a.resolved, (t) => a.report.targets[t] === 'blocked', q),
      };
      records.set(compiled, a.record);
      return deepFreeze(compiled);
    },
    check(input: FrontEndResult): CheckReport<K> {
      return deepFreeze(analyze<K>(snapshotConfig, configDiagnostics, options, input).report);
    },
  });
}

export function createProject<const T extends Targets>(config: { projectId: string; targets: T }): Project<Configured<T>> {
  return createProjectWith(config, { faults: NO_FAULTS });
}

// createProject: one configuration, complete snapshots, no publishable partial output (docs/api.md §2.1-2.2).
// Every reachable assignment is resolved, checked and lowered as its own case; nothing is deduplicated (docs/api.md §7).
import type { LayoutBox } from '@dragon/layout';
import { canonicalJson, sha256Hex } from './digest.ts';
import { authored, diagnostic, unlocated } from './diagnostics/catalogue.ts';
import { webrefVersion } from './css/grammar.generated.ts';
import type { Longhand } from './css/properties.ts';
import type { Declaration, Rule } from './css/stylesheet.ts';
import { featureOf, parseStylesheet } from './css/stylesheet.ts';
import type { UsedKey } from './analysis/context.ts';
import { rowKey, usedKeys } from './analysis/context.ts';
import { checkComputed } from './analysis/computed-checks.ts';
import { inDomain, validateInput } from './analysis/input.ts';
import type { Linked } from './analysis/link.ts';
import { assignmentKey, linkDocument } from './analysis/link.ts';
import type { ResolvedElement, ResolvedText, ResolvedValue } from './analysis/resolve.ts';
import { resolveTree, SUPPORTED_TAGS, valueToString } from './analysis/resolve.ts';
import { emitWebCss } from './emit/web-css.ts';
import type { CompilerFaults } from './faults.ts';
import { NO_FAULTS } from './faults.ts';
import { LoweringError, lowerTree } from './lower/ios-layout.ts';
import { iosProfile } from './profiles/ios.ts';
import type { SupportProfile } from './profiles/types.ts';
import { provenContexts, statusOf, supportedValuesFor } from './profiles/types.ts';
import { webProfile } from './profiles/web.ts';
import { chromeVersion } from './ua/chrome-145.generated.ts';
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

export const COMPILER_VERSION = '1.0.0-alpha.0';
const KNOWN_TARGETS = ['web', 'ios'] as const;
type KnownTarget = (typeof KNOWN_TARGETS)[number];

const PROFILES: { readonly [T in KnownTarget]: SupportProfile } = { web: webProfile, ios: iosProfile };

/** One reachable assignment's results: stage-1 resolution, the ios lowering and the web class binding. */
export type InternalCase = {
  readonly key: string;
  readonly assignment: Assignment;
  readonly isInitial: boolean;
  readonly resolved: ResolvedElement | null;
  /** The ios lowered layout tree; border widths are computed CSS px, which the engine snaps for the environment's DPR. */
  readonly iosLowered: LayoutBox | null;
  readonly webClassOf: ReadonlyMap<string, string> | null;
  /** Profile row keys ("<feature>@<context>") this case uses, per target, sorted. */
  readonly features: ReadonlyMap<Target, readonly string[]>;
};

/** Internal-only data kept beside a compiled result; never reachable from the public entry. */
export type InternalRecord = {
  readonly documentId: string | null;
  /** The environment direction every case was resolved for. */
  readonly direction: 'ltr' | 'rtl';
  readonly cases: readonly InternalCase[];
};

const records = new WeakMap<object, InternalRecord>();

export function internalRecord(compiled: object): InternalRecord | undefined {
  return records.get(compiled);
}

/**
 * faults: seeded resolver and lowering errors. profiles 'derive' is used only by scripts/gen-profile-rows.ts: it records
 * row keys without enforcing the profiles, so the generator can find which cases pass before any row exists. direction: the
 * reference environment's direction (docs/api.md §7), which resolution gives the root; the public entry compiles for ltr.
 */
export type InternalOptions = { readonly faults: CompilerFaults; readonly profiles: 'enforce' | 'derive'; readonly direction: 'ltr' | 'rtl' };

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
    if (!(KNOWN_TARGETS as readonly string[]).includes(k)) bad(`unknown target "${k}" (milestone 1 knows web and ios)`, 'Remove the target.');
    else if (k === 'ios' && (typeof v !== 'object' || v === null || typeof (v as { minimum?: unknown }).minimum !== 'string' || Object.keys(v).length !== 1)) {
      bad('ios needs exactly { minimum: string }', 'Set ios.minimum, for example "15.0" (decision 6).');
    } else if (k === 'web' && (typeof v !== 'object' || v === null || Object.keys(v).length !== 0)) bad('web takes no options in milestone 1', 'Use web: {}.');
  }
  return out;
}

function blocksTarget(d: Diagnostic, t: Target): boolean {
  return d.severity === 'error' && (d.target === null || d.target === t);
}

const UI_ATTRIBUTE = /^ui-[a-z0-9-]+$/;

/** Tags and attributes are checked on every template node, including both arms of every branch. */
function checkTemplates(nodes: readonly TreeNode[], diagnostics: Diagnostic[]): void {
  for (const n of nodes) {
    if (n.kind === 'element') {
      if (!SUPPORTED_TAGS.has(n.tag)) {
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ELEMENT', { origin: n.origin, message: `<${n.tag}> ${n.id} is not supported in milestone 1 (html, body, div)` }));
      }
      for (const a of n.attributes) {
        if (!UI_ATTRIBUTE.test(a.name)) {
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ATTRIBUTE', { origin: a.origin, message: `attribute ${a.name} on ${n.id} is not supported; only ui-* attributes take part in matching` }));
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

/** Context-free check: every longhand any declaration sets, including shorthand-filled ones, needs a row in some context. */
function checkValues(rules: readonly Rule[], targets: readonly KnownTarget[], diagnostics: Diagnostic[]): void {
  const seen = new Set<Declaration>();
  for (const rule of rules) {
    for (const d of rule.declarations) {
      if (seen.has(d)) continue;
      seen.add(d);
      for (const lh of d.longhands) {
        const feature = featureOf(lh.property, lh.value);
        for (const t of targets) {
          const profile = PROFILES[t];
          if (provenContexts(profile, feature).length > 0) continue;
          const values = supportedValuesFor(profile, lh.property);
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin: authored(d.valueSpan),
            target: t,
            message: `${lh.property}: ${valueToString(lh.value)}${lh.explicit ? '' : ` (set by ${d.property})`} is unsupported on ${t} (support profile ${profile.revision})`,
            manual: values.length > 0 ? `Use one of: ${values.join(', ')}.` : `Remove ${d.property}; ${t} supports no value of ${lh.property} yet.`,
            profile: { target: t, profileRevision: profile.revision, feature, context: null, status: 'unsupported' },
          }));
        }
      }
    }
  }
}

type Analysis<K extends string> = {
  readonly report: CheckReport<K>;
  readonly outputs: { [P in K]: ArtifactState };
  readonly record: InternalRecord;
  readonly linked: Linked | null;
};

function analyze<K extends string>(config: { projectId: string; targets: object }, configDiagnostics: readonly Diagnostic[], options: InternalOptions, input: FrontEndResult): Analysis<K> {
  const targets = Object.keys(config.targets).filter((k): k is KnownTarget => (KNOWN_TARGETS as readonly string[]).includes(k));
  const diagnostics: Diagnostic[] = [...configDiagnostics];
  const digest = sha256Hex(canonicalJson({
    compiler: COMPILER_VERSION,
    webref: webrefVersion,
    chrome: chromeVersion,
    profiles: targets.map((t) => PROFILES[t]),
    // MF2: a result compiled without enforcing the profiles must never share a digest with an enforced one.
    profilesMode: options.profiles,
    direction: options.direction,
    config,
    input,
  }));
  const dependencies: Dependency[] = [];
  let linked: Linked | null = null;
  const cases: { key: string; assignment: Assignment; isInitial: boolean; resolved: ResolvedElement | null; used: UsedKey[] }[] = [];
  const valid = configDiagnostics.length === 0 ? validateInput(input, config.projectId, diagnostics) : null;
  if (valid !== null) {
    const rules: Rule[] = [];
    let order = 0;
    for (const useId of valid.document.styles) {
      const use = valid.styles.get(useId);
      if (use === undefined) continue;
      const src = valid.sources.get(use.css.source.uri);
      if (src === undefined) continue;
      dependencies.push({ kind: 'stylesheet', uri: src.ref.uri, hash: src.ref.hash });
      const sheet = { id: use.id, owner: valid.styleOwner.get(use.id) as string, scope: use.scope.kind };
      const parsed = parseStylesheet(src.text.slice(use.css.start, use.css.end), use.css, sheet, order, diagnostics);
      for (const r of parsed) for (const d of r.declarations) order = Math.max(order, d.order + 1);
      rules.push(...parsed);
    }
    for (const s of valid.sources.values()) dependencies.push({ kind: 'source', uri: s.ref.uri, hash: s.ref.hash });
    for (const c of valid.components.values()) checkTemplates(c.root, diagnostics);
    if (options.profiles === 'enforce') checkValues(rules, targets, diagnostics);
    linked = linkDocument(valid, { stateCollapse: options.faults.stateCollapse }, diagnostics);
    if (linked !== null && !diagnostics.some((d) => d.severity === 'error' && d.target === null)) {
      const reported = new Set<string>();
      const refused = new Set<string>();
      for (const c of linked.cases) {
        const resolved = resolveTree(c.root, rules, options.faults, { direction: options.direction });
        checkComputed(resolved, targets, diagnostics, refused);
        const used = usedKeys(resolved);
        cases.push({ key: c.key, assignment: c.assignment, isInitial: c.isInitial, resolved, used });
        if (options.profiles === 'derive') continue;
        // Contextual check: a feature proven only in other formatting contexts blocks with the proven contexts named.
        for (const u of used) {
          for (const t of targets) {
            const profile = PROFILES[t];
            if (statusOf(profile, u.feature, u.context) !== 'unsupported') continue;
            const proven = provenContexts(profile, u.feature);
            if (proven.length === 0) continue;
            const id = `${t}|${u.key}|${u.declaration.span.start}|${u.declaration.span.source.uri}`;
            if (reported.has(id)) continue;
            reported.add(id);
            diagnostics.push(diagnostic('DRAGON_UNPROVEN_CONTEXT', {
              origin: authored(u.declaration.valueSpan),
              target: t,
              message: `${u.feature} on ${u.address} is used in the ${u.context} context, which ${t} has not proven (proven: ${proven.join(', ')})`,
              manual: `Use ${u.feature} only in a proven context (${proven.join(', ')}), or add a passing parity fixture for ${u.context}.`,
              related: [{ origin: authored(u.declaration.span), message: `declaration applied to ${u.address}` }],
              profile: { target: t, profileRevision: profile.revision, feature: u.feature, context: u.context, status: 'unsupported' },
            }));
          }
        }
      }
    } else if (linked !== null) {
      for (const c of linked.cases) cases.push({ key: c.key, assignment: c.assignment, isInitial: c.isInitial, resolved: null, used: [] });
    }
  }
  const lowered = new Map<string, LayoutBox>();
  if (targets.includes('ios') && cases.length > 0 && !diagnostics.some((d) => blocksTarget(d, 'ios'))) {
    const reported = new Set<string>();
    for (const c of cases) {
      if (c.resolved === null) continue;
      try {
        lowered.set(c.key, lowerTree(c.resolved, options.faults));
      } catch (e) {
        if (!(e instanceof LoweringError)) throw e;
        const id = `${e.nodeId}|${e.property}|${e.message}`;
        if (reported.has(id)) continue;
        reported.add(id);
        const origin = originOfAddress(c.resolved, e.nodeId);
        diagnostics.push(diagnostic(e.property === 'font-family' ? 'DRAGON_UNSUPPORTED_FONT' : 'DRAGON_LOWERING_FAILED', { origin, message: e.message, target: 'ios' }));
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
    else if (t === 'ios') outputs[key] = { kind: 'analysis-only', digest, reason: 'Milestone 1 iOS output is analysis-only: its layout projection feeds the internal Linux lane; no Swift is emitted.' };
    else {
      web = emitWebCss(cases.map((c) => ({ key: c.key, root: c.resolved as ResolvedElement })), digest);
      outputs[key] = { kind: 'ready', digest, files: web.files };
    }
  }
  const report: CheckReport<K> = {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    revision: input.snapshot.revision,
    digest,
    sources: input.snapshot.sources.map((s) => ({ ref: { ...s.ref }, text: s.text, displayPath: s.displayPath })),
    dependencies,
    diagnostics,
    targets: status,
  };
  const iosChecked = status['ios' as K] === 'checked';
  const webClasses = web === null ? null : web.classOf;
  return {
    report,
    outputs,
    linked,
    record: {
      documentId: linked === null ? null : linked.documentId,
      direction: options.direction,
      cases: cases.map((c) => ({
        key: c.key,
        assignment: c.assignment,
        isInitial: c.isInitial,
        resolved: c.resolved,
        iosLowered: iosChecked ? (lowered.get(c.key) ?? null) : null,
        webClassOf: webClasses === null ? null : (webClasses.get(c.key) ?? null),
        features: new Map(targets.map((t) => [t, [...new Set(c.used.map((u) => u.key))].sort()])),
      })),
    },
  };
}

function findResolved(root: ResolvedElement, address: string): { el: ResolvedElement; parent: ResolvedElement | null } | null {
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
function valueOrigin(root: ResolvedElement, address: string, p: Longhand): Origin {
  const hit = findResolved(root, address);
  if (hit === null) return unlocated(`node ${address}`);
  const v = hit.el.props.get(p) as ResolvedValue;
  if (v.declaration !== null) return authored(v.declaration.span);
  if (v.origin === 'inherited' && hit.parent !== null) return { kind: 'inherited', element: hit.parent.element.address, from: valueOrigin(root, hit.parent.element.address, p) };
  if (v.origin === 'user-agent') return { kind: 'builtin', dataset: `chrome-${chromeVersion} computed`, entry: `${hit.el.element.tag} ${p}` };
  if (v.origin === 'environment') return { kind: 'builtin', dataset: 'reference environment', entry: `direction ${valueToString(v.value)}` };
  return { kind: 'builtin', dataset: `@webref/css ${webrefVersion} initial`, entry: p };
}

function explainIn<K extends string>(a: Analysis<K>, q: ExplainQuery<K>): ExplainResult<K> {
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
    const profile = PROFILES[target as KnownTarget];
    out.push({
      node: q.at.node,
      instance: q.at.instance,
      target,
      assignment: c.assignment,
      property: q.property,
      value: valueToString(v.value),
      cascade: v.origin,
      origin: valueOrigin(c.resolved, address, p),
      losing: v.losing.map((d) => ({ origin: authored(d.span), reason: 'lower specificity or earlier in the style order' })),
      support: used === null || used === undefined ? null : { feature: used.feature, context: used.context, status: statusOf(profile, used.feature, used.context) },
    });
  }
  if (out.length === 0) return { kind: 'not-found', reason: `no ${q.property} on ${address} in any matching case` };
  return { kind: 'found', target: q.target, cases: out };
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
        explain: (q: ExplainQuery<K>) => deepFreeze(explainIn<K>(a, q)),
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
  return createProjectWith(config, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr' });
}

export { valueOrigin };

export function caseByAssignment(record: InternalRecord, assignment: Assignment): InternalCase | undefined {
  const key = assignmentKey(assignment);
  return record.cases.find((c) => c.key === key);
}

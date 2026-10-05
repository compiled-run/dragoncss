// COVERAGE-RANK (notes/PM-2026-10-04.md): ranks candidate lanes by how much real-world CSS they unlock on native per unit of work.
// Usage comes from committed snapshots (chromestatus, Web Almanac figures, the Tailwind sweep, the music-player north star);
// Dragon's status per target comes from compiling every probe through the compiler, so the table follows master as features land.
//   node --conditions=dragon-internal scripts/coverage-rank.ts [--out <path>]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from '../packages/dragon/src/internal.ts';
import { ANDROID_MIN_SDK, createProjectWith, NO_FAULTS, REFERENCE_PLATFORM } from '../packages/dragon/src/internal.ts';
import { fixtureToInput, PROJECT_ID } from '../packages/parity/src/fixture-reader.ts';
import { ENVIRONMENT } from '../packages/parity/src/fixtures.ts';

const ROOT = join(import.meta.dirname, '..');
const DATA = join(ROOT, 'docs/goals/milestone-2-proof/data');
const DEFAULT_OUT = join(ROOT, 'docs/goals/milestone-2-proof/coverage-rank.md');
const TW_SNAPSHOT = join(ROOT, 'packages/tailwind-sweep/snapshot/tailwind-4.3.3.json');
const TARGETS = ['web', 'ios', 'android'] as const;
type Target = (typeof TARGETS)[number];
const SIZE_WEIGHT = { S: 1, M: 2, L: 4 } as const;
type Size = keyof typeof SIZE_WEIGHT;

// ---- input validation: every committed file is read through these checks, and a malformed one stops the run.

function fail(where: string, what: string): never {
  throw new Error(`coverage-rank: ${where}: ${what}`);
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function str(v: unknown, where: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(where, 'expected a non-empty string');
  return v;
}
function obj(v: unknown, where: string): Record<string, unknown> {
  if (!isObj(v)) fail(where, 'expected an object');
  return v;
}
function arr(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) fail(where, 'expected an array');
  return v;
}
function strings(v: unknown, where: string): string[] {
  return arr(v, where).map((x, i) => str(x, `${where}[${i}]`));
}
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (e) {
    return fail(path, `unreadable JSON (${(e as Error).message})`);
  }
}

type Probe = { readonly css: string; readonly html: string | null; readonly lane: string | null };
type Usage = { readonly kind: 'css'; readonly key: string } | { readonly kind: 'chromestatus'; readonly key: string } | { readonly kind: 'almanac'; readonly value: number; readonly ref: string } | null;
type FeatureSpec = { readonly id: string; readonly lane: string; readonly usage: Usage; readonly probes: readonly Probe[] };
type LaneSpec = { readonly id: string; readonly title: string; readonly size: Size; readonly status: string; readonly depends: string; readonly exact: ReadonlySet<string>; readonly patterns: readonly RegExp[] };
type Sample = { readonly ctx: string | null; readonly values: readonly { readonly v: string; readonly lane: string | null }[] } | { readonly probes: readonly Probe[] };
type Input = {
  readonly cssPopularity: string;
  readonly featurePopularity: string;
  readonly sources: Readonly<Record<string, string>>;
  readonly currentSince: string;
  readonly tailBelow: number;
  readonly body: string;
  readonly contexts: Readonly<Record<string, string>>;
  readonly pseudoProperties: ReadonlySet<string>;
  readonly samples: ReadonlyMap<string, Sample>;
  readonly sampleRules: readonly { readonly re: RegExp; readonly sample: Sample }[];
  readonly aliases: ReadonlyMap<string, string>;
  readonly naProposed: ReadonlyMap<string, string>;
  readonly naCandidates: ReadonlyMap<string, string>;
  readonly features: readonly FeatureSpec[];
  readonly lanes: readonly LaneSpec[];
  readonly twGroups: ReadonlyMap<string, string>;
};

function probeOf(v: unknown, where: string): Probe {
  const o = obj(v, where);
  return { css: str(o.css, `${where}.css`), html: o.html === undefined ? null : str(o.html, `${where}.html`), lane: o.lane === undefined ? null : str(o.lane, `${where}.lane`) };
}

function usageOf(v: unknown, where: string): Usage {
  if (v === null) return null;
  const o = obj(v, where);
  if (o.css !== undefined) return { kind: 'css', key: str(o.css, `${where}.css`) };
  if (o.chromestatus !== undefined) return { kind: 'chromestatus', key: str(o.chromestatus, `${where}.chromestatus`) };
  if (typeof o.almanac === 'number' && o.almanac >= 0 && o.almanac <= 1) return { kind: 'almanac', value: o.almanac, ref: str(o.ref, `${where}.ref`) };
  return fail(where, 'usage must be null, { css }, { chromestatus } or { almanac: 0..1, ref }');
}

function stringMap(v: unknown, where: string): Map<string, string> {
  return new Map(Object.entries(obj(v, where)).map(([k, x]) => [k, str(x, `${where}.${k}`)]));
}

function readInput(path: string): Input {
  const o = obj(readJson(path), path);
  if (o.schema !== 'dragon/coverage-rank-input@1') fail(path, 'schema must be dragon/coverage-rank-input@1');
  const src = obj(o.sources, 'sources');
  const almanac = stringMap(src.almanac, 'sources.almanac');
  const tailBelow = src.tailBelow;
  if (typeof tailBelow !== 'number' || !(tailBelow > 0 && tailBelow < 1)) fail('sources.tailBelow', 'expected a fraction');
  const currentSince = str(src.currentSince, 'sources.currentSince');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(currentSince)) fail('sources.currentSince', 'expected YYYY-MM-DD');
  const probe = obj(o.probe, 'probe');
  const contexts = stringMap(probe.contexts, 'probe.contexts');
  const samples = new Map<string, Sample>();
  const sampleOf = (raw: unknown, w: string): Sample => {
    const s = obj(raw, w);
    if (s.probes !== undefined) return { probes: arr(s.probes, `${w}.probes`).map((p, i) => probeOf(p, `${w}.probes[${i}]`)) };
    const ctx = s.ctx === undefined ? null : str(s.ctx, `${w}.ctx`);
    if (ctx !== null && !contexts.has(ctx)) fail(w, `unknown context ${ctx}`);
    const values = arr(s.values, `${w}.values`).map((x, i) => {
      if (typeof x === 'string') return { v: str(x, `${w}.values[${i}]`), lane: null };
      const e = obj(x, `${w}.values[${i}]`);
      return { v: str(e.v, `${w}.values[${i}].v`), lane: str(e.lane, `${w}.values[${i}].lane`) };
    });
    if (values.length === 0) fail(w, 'needs at least one value');
    return { ctx, values };
  };
  for (const [prop, raw] of Object.entries(obj(o.samples, 'samples'))) samples.set(prop, sampleOf(raw, `samples.${prop}`));
  const sampleRules = arr(o.sampleRules, 'sampleRules').map((raw, i) => ({ re: new RegExp(str(obj(raw, `sampleRules[${i}]`).re, `sampleRules[${i}].re`)), sample: sampleOf(raw, `sampleRules[${i}]`) }));
  const na = obj(o.naNative, 'naNative');
  const lanes = arr(o.lanes, 'lanes').map((raw, i): LaneSpec => {
    const w = `lanes[${i}]`;
    const l = obj(raw, w);
    const size = str(l.size, `${w}.size`);
    if (!(size in SIZE_WEIGHT)) fail(`${w}.size`, 'must be S, M or L');
    const props = strings(l.properties, `${w}.properties`);
    return {
      id: str(l.id, `${w}.id`), title: str(l.title, `${w}.title`), size: size as Size, status: str(l.status, `${w}.status`), depends: str(l.depends, `${w}.depends`),
      exact: new Set(props.filter((p) => !p.startsWith('re:'))),
      patterns: props.filter((p) => p.startsWith('re:')).map((p) => new RegExp(p.slice(3))),
    };
  });
  const laneIds = new Set(lanes.map((l) => l.id));
  if (laneIds.size !== lanes.length) fail('lanes', 'duplicate lane id');
  const checkLane = (id: string | null, where: string): void => {
    if (id !== null && !laneIds.has(id)) fail(where, `unknown lane ${id}`);
  };
  const features = arr(o.features, 'features').map((raw, i): FeatureSpec => {
    const w = `features[${i}]`;
    const f = obj(raw, w);
    const probes = arr(f.probes, `${w}.probes`).map((p, j) => probeOf(p, `${w}.probes[${j}]`));
    if (probes.length === 0) fail(w, 'needs at least one probe');
    const lane = str(f.lane, `${w}.lane`);
    checkLane(lane, `${w}.lane`);
    for (const p of probes) checkLane(p.lane, `${w}.probes`);
    return { id: str(f.id, `${w}.id`), lane, usage: usageOf(f.usage, `${w}.usage`), probes };
  });
  if (new Set(features.map((f) => f.id)).size !== features.length) fail('features', 'duplicate feature id');
  for (const [p, s] of [...samples, ...sampleRules.map((r) => [r.re.source, r.sample] as const)]) {
    if ('values' in s) for (const v of s.values) checkLane(v.lane, `samples.${p}`);
    else for (const pr of s.probes) checkLane(pr.lane, `samples.${p}`);
  }
  const twGroups = stringMap(o.twGroups ?? {}, 'twGroups');
  return {
    cssPopularity: str(src.cssPopularity, 'sources.cssPopularity'),
    featurePopularity: str(src.featurePopularity, 'sources.featurePopularity'),
    sources: Object.fromEntries(almanac),
    currentSince, tailBelow,
    body: str(probe.body, 'probe.body'),
    contexts: Object.fromEntries(contexts),
    pseudoProperties: new Set(strings(probe.pseudoProperties, 'probe.pseudoProperties')),
    samples, sampleRules,
    aliases: stringMap(o.aliases, 'aliases'),
    naProposed: stringMap(obj(na.proposed, 'naNative.proposed').items, 'naNative.proposed.items'),
    naCandidates: stringMap(obj(na.candidates, 'naNative.candidates').items, 'naNative.candidates.items'),
    features, lanes, twGroups,
  };
}

type Popularity = { readonly source: string; readonly fetched: string; readonly rows: readonly { readonly name: string; readonly date: string; readonly share: number }[] };

function readPopularity(path: string): Popularity {
  const o = obj(readJson(path), path);
  const rows = arr(o.rows, `${path}.rows`).map((r, i) => {
    const a = arr(r, `${path}.rows[${i}]`);
    const [name, date, share] = a;
    if (a.length !== 3 || typeof share !== 'number' || !(share >= 0 && share <= 1)) fail(`${path}.rows[${i}]`, 'expected [name, date, share 0..1]');
    return { name: str(name, `${path}.rows[${i}][0]`), date: str(date, `${path}.rows[${i}][1]`), share };
  });
  return { source: str(o.source, `${path}.source`), fetched: str(o.fetched, `${path}.fetched`), rows };
}

/**
 * The Tailwind sweep's refusal groups on iOS, utilities per group, largest first. The snapshot format is the sweep's
 * (packages/tailwind-sweep/src/snapshot.ts): per target "supported", ["refused", code, group, ...], ["invalid", ...] or
 * ["mismatch", ...], with "=web" repeating web's outcome.
 */
function twRefusalsOnIos(path: string): { readonly group: string; readonly n: number }[] {
  const o = obj(readJson(path), path);
  if (obj(o.meta, `${path}.meta`).schema !== 'dragon/tailwind-sweep@1') fail(path, 'meta.schema must be dragon/tailwind-sweep@1');
  const counts = new Map<string, number>();
  for (const [i, raw] of arr(o.utilities, `${path}.utilities`).entries()) {
    const u = obj(raw, `${path}.utilities[${i}]`);
    const ios = u.ios === '=web' ? u.web : u.ios;
    if (ios === 'supported') continue;
    const a = arr(ios, `${path}.utilities[${i}].ios`);
    if (a[0] === 'refused') {
      const group = str(a[2], `${path}.utilities[${i}].ios[2]`);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    } else if (a[0] !== 'invalid' && a[0] !== 'mismatch') fail(`${path}.utilities[${i}].ios`, `unknown outcome ${String(a[0])}`);
  }
  return [...counts].map(([group, n]) => ({ group, n })).sort((x, y) => y.n - x.n || x.group.localeCompare(y.group));
}

// ---- the compiler probe

const project = createProjectWith(
  { projectId: PROJECT_ID, targets: { web: {}, ios: { minimum: '15.0' }, android: { minSdk: ANDROID_MIN_SDK.min } } },
  { faults: NO_FAULTS, profiles: 'enforce', direction: ENVIRONMENT.direction, platform: REFERENCE_PLATFORM, rootFont: ENVIRONMENT.rootFont },
);

/** One probe's outcome on one target: supported, not applicable on native (an info-level verdict and no error), or its first blocking code. */
type Verdict = { readonly kind: 'ok' } | { readonly kind: 'na' } | { readonly kind: 'context'; readonly code: string } | { readonly kind: 'refused'; readonly code: string; readonly message: string };

const NA_CODE = /NOT_APPLICABLE|NA_NATIVE/;
/** Codes about the probe's own document rather than the CSS under test; one of them is a fault in this script's input. */
const HARNESS_CODES = new Set(['DRAGON_CONFIG_INVALID', 'DRAGON_INPUT_INVALID', 'DRAGON_PRODUCER_ERROR', 'DRAGON_INCOMPLETE_INPUT', 'DRAGON_SOURCE_HASH_MISMATCH', 'DRAGON_SPAN_INVALID', 'DRAGON_TREE_SCHEMA']);

let idCounter = 0;
function withIds(html: string): string {
  return html.replace(/<([a-z][a-z0-9]*)(?=[\s>])/g, (_m, tag: string) => `<${tag} data-dragon-id="e${(idCounter++).toString(36)}"`);
}

function runProbe(p: Probe, body: string): { readonly [T in Target]: Verdict } {
  if (p.css.includes('</style')) fail('probe', `css closes its <style>: ${p.css}`);
  const html = `<!DOCTYPE html>\n<html data-dragon-id="html"><head><style>\n${p.css}\n</style></head><body data-dragon-id="body">${withIds(p.html ?? body)}</body></html>\n`;
  let input: ReturnType<typeof fixtureToInput>;
  try {
    input = fixtureToInput('coverage-rank', html);
  } catch (e) {
    // The parity fixture reader takes an HTML subset; markup outside it (inline SVG) has no tree to compile, so nothing compiles.
    // Any other reader error is a fault in the probe itself.
    const message = (e as Error).message;
    if (!message.startsWith('unsupported markup')) fail('probe', `${p.css}: the fixture reader rejected the probe (${message})`);
    const v: Verdict = { kind: 'refused', code: 'FIXTURE_MARKUP', message };
    return { web: v, ios: v, android: v };
  }
  let diagnostics: readonly Diagnostic[];
  try {
    diagnostics = project.compile(input).diagnostics;
  } catch (e) {
    return fail('probe', `${p.css}: the compiler threw (${(e as Error).message})`);
  }
  const out = {} as { [T in Target]: Verdict };
  for (const t of TARGETS) {
    const mine = diagnostics.filter((d) => d.target === null || d.target === t);
    const errors = mine.filter((d) => d.severity === 'error');
    const harness = errors.find((d) => HARNESS_CODES.has(d.code));
    if (harness !== undefined) fail('probe', `${p.css}: ${harness.code} ${harness.message}`);
    const first = errors[0];
    if (first === undefined) out[t] = t !== 'web' && mine.some((d) => d.severity === 'info' && NA_CODE.test(d.code)) ? { kind: 'na' } : { kind: 'ok' };
    else if (errors.every((d) => d.code === 'DRAGON_UNPROVEN_CONTEXT')) out[t] = { kind: 'context', code: first.code };
    else out[t] = { kind: 'refused', code: first.code, message: first.message };
  }
  return out;
}

// ---- features: every current chromestatus property, plus the curated value, selector, at-rule and element features

type Row = {
  readonly id: string;
  readonly kind: 'property' | 'value' | 'selector' | 'at-rule' | 'element';
  readonly usage: number | null;
  readonly usageNote: string;
  readonly probes: readonly { readonly probe: Probe; readonly lane: string; readonly verdict: { readonly [T in Target]: Verdict } }[];
  readonly lane: string;
  readonly na: 'proposed' | 'candidate' | null;
  readonly sampled: 'curated' | 'initial value';
  readonly alias: string | null;
};

function normalise(name: string): string {
  if (name === 'variable') return '--*';
  if (name.startsWith('alias-webkit-')) return `-webkit-${name.slice('alias-webkit-'.length)}`;
  if (name.startsWith('alias-epub-')) return `-epub-${name.slice('alias-epub-'.length)}`;
  if (name.startsWith('alias-')) return name.slice('alias-'.length);
  if (name.startsWith('webkit-')) return `-webkit-${name.slice('webkit-'.length)}`;
  if (name.startsWith('epub-')) return `-epub-${name.slice('epub-'.length)}`;
  return name;
}

function laneOfProperty(lanes: readonly LaneSpec[], name: string): string | null {
  for (const l of lanes) if (l.exact.has(name)) return l.id;
  for (const l of lanes) if (l.patterns.some((re) => re.test(name))) return l.id;
  return null;
}

function supportedShare(row: Row, t: Target): number {
  return row.probes.filter((p) => p.verdict[t].kind === 'ok').length / row.probes.length;
}
const nativeShare = (row: Row): number => Math.min(supportedShare(row, 'ios'), supportedShare(row, 'android'));

function main(): void {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const [k, v] = [args[i] as string, args[i + 1]];
    if ((k !== '--out' && k !== '--json') || v === undefined || flags.has(k)) fail('arguments', 'usage: coverage-rank.ts [--out <markdown path>] [--json <probe dump path>]');
    flags.set(k, v);
  }
  const out = flags.get('--out') ?? DEFAULT_OUT;

  const input = readInput(join(DATA, 'coverage-rank-input.json'));
  const css = readPopularity(join(DATA, input.cssPopularity));
  const feat = readPopularity(join(DATA, input.featurePopularity));
  const webref = obj(readJson(join(ROOT, 'node_modules/@webref/css/css.json')), '@webref/css');
  const initial = new Map<string, string>();
  for (const p of arr(webref.properties, '@webref/css properties')) {
    const e = obj(p, '@webref/css property');
    if (typeof e.name === 'string' && typeof e.initial === 'string') initial.set(e.name, e.initial);
  }
  const descriptors = new Set<string>();
  for (const a of arr(webref.atrules, '@webref/css atrules')) for (const d of arr(obj(a, 'atrule').descriptors ?? [], 'descriptors')) descriptors.add(str(obj(d, 'descriptor').name, 'descriptor.name'));

  const featShare = new Map(feat.rows.map((r) => [r.name, r.share]));
  const current = css.rows.filter((r) => r.date >= input.currentSince);
  const cssShare = new Map(current.map((r) => [normalise(r.name), r.share]));
  const warnings: string[] = [];
  const rows: Row[] = [];
  const laneById = new Map(input.lanes.map((l) => [l.id, l]));

  // Properties. A property Dragon does not know is refused whatever its value, so its webref initial value is a sound probe;
  // a property Dragon accepts needs curated samples, and a missing one is listed as a warning.
  for (const r of current) {
    const name = normalise(r.name);
    if (name.endsWith(' (obsolete)') || (name !== '--*' && descriptors.has(name) && !initial.has(name))) continue;
    if (rows.some((x) => x.id === name)) continue;
    const lane = laneOfProperty(input.lanes, name);
    const sample = input.samples.get(name) ?? input.sampleRules.find((x) => x.re.test(name))?.sample;
    const probes: Probe[] = [];
    let sampled: Row['sampled'] = 'curated';
    const decl = (value: string): string => (input.pseudoProperties.has(name) ? `.u::before{${name}: ${value}}` : `.u{${name}: ${value}}`);
    if (sample !== undefined && 'probes' in sample) probes.push(...sample.probes);
    else if (sample !== undefined) for (const v of sample.values) probes.push({ css: `${sample.ctx === null ? '' : input.contexts[sample.ctx]}\n${decl(v.v)}`, html: null, lane: v.lane });
    else {
      sampled = 'initial value';
      probes.push({ css: decl(initial.get(name) ?? 'inherit'), html: null, lane: null });
    }
    const verdicts = probes.map((p) => ({ probe: p, verdict: runProbe(p, input.body) }));
    if (sampled === 'initial value' && verdicts.some((v) => TARGETS.some((t) => v.verdict[t].kind !== 'refused' || (v.verdict[t] as { code: string }).code !== 'DRAGON_UNSUPPORTED_PROPERTY'))) {
      warnings.push(`${name}: Dragon accepts the property, but it has no curated samples (probed with its initial value only)`);
    }
    const alias = input.aliases.get(name) ?? (r.name.startsWith('alias-webkit-') ? r.name.slice('alias-webkit-'.length) : null);
    const na = input.naProposed.has(name) ? 'proposed' : input.naCandidates.has(name) ? 'candidate' : null;
    const base = lane ?? (r.share < input.tailBelow ? 'TAIL' : 'UNASSIGNED');
    rows.push({
      id: name, kind: 'property', usage: r.share, usageNote: 'chromestatus', sampled, alias, na,
      lane: base,
      probes: verdicts.map((v) => ({ ...v, lane: v.probe.lane ?? base })),
    });
  }
  // Aliases: while the standard property is supported on native the alias is its own small lane; otherwise it lands with it.
  for (const [i, row] of rows.entries()) {
    if (row.alias === null) continue;
    const base = rows.find((x) => x.id === row.alias);
    const refusedAsName = row.probes.every((p) => p.verdict.ios.kind === 'refused' && p.verdict.ios.code === 'DRAGON_UNSUPPORTED_PROPERTY');
    const lane = base === undefined ? row.lane : refusedAsName && nativeShare(base) > 0 ? 'ALIAS' : row.lane === 'UNASSIGNED' || row.lane === 'TAIL' ? base.lane : row.lane;
    rows[i] = { ...row, lane, probes: row.probes.map((p) => ({ ...p, lane: p.probe.lane ?? lane })) };
  }
  for (const f of input.features) {
    const kind = f.id.startsWith('value:') ? 'value' : f.id.startsWith('selector:') ? 'selector' : f.id.startsWith('at-rule:') ? 'at-rule' : f.id.startsWith('element:') ? 'element' : fail(`feature ${f.id}`, 'id must start with value:, selector:, at-rule: or element:');
    let usage: number | null = null;
    let usageNote = 'no usage source';
    if (f.usage?.kind === 'chromestatus') {
      const s = featShare.get(f.usage.key);
      if (s === undefined) fail(`feature ${f.id}`, `no chromestatus feature counter ${f.usage.key} in the snapshot`);
      usage = s;
      usageNote = `chromestatus ${f.usage.key}`;
    } else if (f.usage?.kind === 'css') {
      const s = cssShare.get(normalise(f.usage.key));
      if (s === undefined) fail(`feature ${f.id}`, `no chromestatus CSS property ${f.usage.key}`);
      usage = s;
      usageNote = `chromestatus css ${f.usage.key}`;
    } else if (f.usage?.kind === 'almanac') {
      usage = f.usage.value;
      usageNote = `Web Almanac ${f.usage.ref}`;
    }
    const na = input.naProposed.has(f.id) ? 'proposed' : input.naCandidates.has(f.id) ? 'candidate' : null;
    rows.push({ id: f.id, kind, usage, usageNote, sampled: 'curated', alias: null, na, lane: f.lane, probes: f.probes.map((p) => ({ probe: p, lane: p.lane ?? f.lane, verdict: runProbe(p, input.body) })) });
  }
  for (const r of rows) if (r.probes.some((p) => p.lane === 'UNASSIGNED' && !(p.verdict.ios.kind === 'ok' && p.verdict.android.kind === 'ok'))) warnings.push(`${r.id} (${pct(r.usage)}): a probe that fails on native has no lane`);

  // ---- the Tailwind sweep and the north star, keyed to rows
  const twByRow = new Map<string, number>();
  const twUnmapped: { group: string; n: number }[] = [];
  for (const g of twRefusalsOnIos(TW_SNAPSHOT)) {
    const n = g.n;
    // A group names a property (property X, profile X:value, unproven context X:value, value X: ..., value multi-token X).
    const prop = /^(?:property|profile|unproven context|value multi-token|value) (-?[a-z][a-z-]*)(?::|$)/.exec(g.group)?.[1];
    const key = [...input.twGroups].find(([prefix]) => g.group.startsWith(prefix))?.[1] ?? (prop !== undefined && rows.some((r) => r.id === prop) ? prop : undefined);
    if (key === undefined) twUnmapped.push({ group: g.group, n });
    else twByRow.set(key, (twByRow.get(key) ?? 0) + n);
  }
  const ns = obj(readJson(join(ROOT, 'examples/music-player/dragon/north-star-check.json')), 'north-star-check.json');
  const nsByRow = new Map<string, number>();
  let nsTotal = 0;
  let nsNative = 0;
  for (const [i, d] of arr(ns.declarations, 'north-star-check.json declarations').entries()) {
    const e = obj(d, `north-star declarations[${i}]`);
    const prop = str(e.property, `north-star declarations[${i}].property`);
    nsTotal++;
    const blocked = e.ios !== 'supported' || e.android !== 'supported';
    if (!blocked) nsNative++;
    const key = prop.startsWith('--') ? '--*' : prop;
    if (blocked) nsByRow.set(key, (nsByRow.get(key) ?? 0) + 1);
  }

  // ---- headline
  const props = rows.filter((r) => r.kind === 'property');
  const weighted = (rs: readonly Row[], share: (r: Row) => number): number => {
    const den = rs.reduce((a, r) => a + (r.usage ?? 0), 0);
    return rs.reduce((a, r) => a + (r.usage ?? 0) * share(r), 0) / den;
  };
  const notProposedNa = props.filter((r) => r.na !== 'proposed');
  const headline = {
    web: weighted(props, (r) => supportedShare(r, 'web')),
    ios: weighted(props, (r) => supportedShare(r, 'ios')),
    android: weighted(props, (r) => supportedShare(r, 'android')),
    native: weighted(props, nativeShare),
    nativeNa: weighted(notProposedNa, nativeShare),
  };
  const top = props.filter((r) => (r.usage ?? 0) >= input.tailBelow);
  const count = (pred: (r: Row) => boolean): number => top.filter(pred).length;

  // ---- lanes: reach is the usage each lane would move to supported on native (or out of the denominator, for NA lanes)
  type LaneRank = { lane: LaneSpec; reach: number; tw: number; ns: number; items: { id: string; gain: number }[]; score: number };
  const ranks = new Map<string, LaneRank>(input.lanes.map((l) => [l.id, { lane: l, reach: 0, tw: 0, ns: 0, items: [], score: 0 }]));
  for (const r of rows) {
    const inLane = new Map<string, number>();
    for (const p of r.probes) {
      const native = p.verdict.ios.kind === 'ok' && p.verdict.android.kind === 'ok';
      if (!native) inLane.set(p.lane, (inLane.get(p.lane) ?? 0) + 1);
    }
    for (const [laneId, n] of inLane) {
      const lr = ranks.get(laneId);
      if (lr === undefined) {
        if (laneId !== 'UNASSIGNED') fail(r.id, `unknown lane ${laneId}`);
        continue;
      }
      const part = n / r.probes.length;
      const gain = (r.usage ?? 0) * part;
      lr.reach += gain;
      lr.tw += Math.round((twByRow.get(r.id) ?? 0) * part);
      lr.ns += Math.round((nsByRow.get(r.id) ?? 0) * part);
      lr.items.push({ id: r.id, gain });
    }
  }
  for (const lr of ranks.values()) {
    lr.items.sort((a, b) => b.gain - a.gain || a.id.localeCompare(b.id));
    lr.score = lr.reach / SIZE_WEIGHT[lr.lane.size];
  }
  const ranked = [...ranks.values()].filter((l) => l.lane.id !== 'TAIL' && l.reach > 0).sort((a, b) => b.score - a.score || b.reach - a.reach);

  const dump = flags.get('--json');
  if (dump !== undefined) {
    const verdictText = (v: Verdict): string => (v.kind === 'refused' ? `${v.code}: ${v.message}` : v.kind === 'context' ? v.code : v.kind);
    const json = rows.map((r) => ({ id: r.id, usage: r.usage, lane: r.lane, probes: r.probes.map((p) => ({ css: p.probe.css, html: p.probe.html, lane: p.lane, web: verdictText(p.verdict.web), ios: verdictText(p.verdict.ios), android: verdictText(p.verdict.android) })) }));
    writeFileSync(dump, `${JSON.stringify(json, null, 1)}\n`);
  }
  writeFileSync(out, render({ input, css, feat, headline, top, count, ranked, rows, twByRow, nsByRow, twUnmapped, nsTotal, nsNative, warnings, laneById }));
  process.stdout.write(`wrote ${out}\nnative ${(headline.native * 100).toFixed(1)}% (web ${(headline.web * 100).toFixed(1)}%); ${warnings.length} warnings\n${warnings.map((w) => `  ${w}\n`).join('')}`);
}

function pct(v: number | null): string {
  return v === null ? '-' : `${(v * 100).toFixed(1)}%`;
}

function cell(row: Row, t: Target): string {
  const n = row.probes.length;
  const ok = row.probes.filter((p) => p.verdict[t].kind === 'ok').length;
  const na = row.probes.filter((p) => p.verdict[t].kind === 'na').length;
  const firstBad = row.probes.map((p) => p.verdict[t]).find((v) => v.kind === 'refused' || v.kind === 'context');
  const code = firstBad === undefined ? '' : ` ${(firstBad as { code: string }).code.replace(/^DRAGON_/, '')}`;
  if (na === n) return 'n/a';
  if (ok === n) return 'yes';
  if (ok === 0 && na === 0) return `no${code}`;
  return `${ok}/${n}${code}`;
}

/** The lanes that would close the row's native gaps; the row's own lane when it has none. */
function laneCell(r: Row): string {
  const gaps = [...new Set(r.probes.filter((p) => !(p.verdict.ios.kind === 'ok' && p.verdict.android.kind === 'ok')).map((p) => p.lane))];
  return gaps.length === 0 ? (r.lane === 'UNASSIGNED' ? '' : r.lane) : gaps.join(', ');
}

type RenderArgs = {
  input: Input; css: Popularity; feat: Popularity;
  headline: { web: number; ios: number; android: number; native: number; nativeNa: number };
  top: readonly Row[]; count: (pred: (r: Row) => boolean) => number;
  ranked: readonly { lane: LaneSpec; reach: number; tw: number; ns: number; items: { id: string; gain: number }[]; score: number }[];
  rows: readonly Row[]; twByRow: ReadonlyMap<string, number>; nsByRow: ReadonlyMap<string, number>;
  twUnmapped: readonly { group: string; n: number }[]; nsTotal: number; nsNative: number; warnings: readonly string[];
  laneById: ReadonlyMap<string, LaneSpec>;
};

function render(a: RenderArgs): string {
  const { headline: h } = a;
  const full = a.count((r) => nativeShare(r) === 1);
  const part = a.count((r) => nativeShare(r) > 0 && nativeShare(r) < 1);
  const L: string[] = [];
  L.push('<!-- Generated by scripts/coverage-rank.ts (node --conditions=dragon-internal scripts/coverage-rank.ts). Do not edit; change data/coverage-rank-input.json and rerun. -->');
  L.push('# COVERAGE-RANK: which lanes unlock the most native CSS per unit of work');
  L.push('');
  L.push('## Headline');
  L.push('');
  L.push(`- **About ${(h.native * 100).toFixed(0)}% of real-world CSS property usage compiles on native today** (iOS ${pct(h.ios)}, Android ${pct(h.android)}; web ${pct(h.web)}).`);
  L.push(`- With the PM's proposed NA-NATIVE entries left out of the denominator: ${pct(h.nativeNa)}.`);
  L.push(`- Of the ${a.top.length} properties used on at least ${pct(a.input.tailBelow)} of page loads, ${full} compile on native for every probed value, ${part} for some values, and ${a.top.length - full - part} for none.`);
  L.push(`- Music player (north star): ${a.nsNative} of ${a.nsTotal} declarations compile on both native targets.`);
  L.push('');
  L.push('How the headline is computed: for every CSS property chromestatus reports (current counters only), its share of page loads times the share of its probe declarations that compile with no error on the target, summed and divided by the summed shares. Native is the lower of iOS and Android. A property used on 90% of pages that compiles for 3 of its 4 probed values adds 0.9 x 3/4. Shares overlap (one page uses many properties), so this is a usage-weighted average, not a share of pages.');
  L.push('');
  L.push('## Method');
  L.push('');
  L.push(`- **Usage.** Chrome's UseCounter data from chromestatus: CSS properties (${a.css.source}, fetched ${a.css.fetched}) and features such as selectors, at-rules and value functions (${a.feat.source}, fetched ${a.feat.fetched}), as the share of page loads. Counters whose last report predates ${a.input.currentSince} are dropped as retired. Where chromestatus has no counter (calc(), :hover, elements), the share is a Web Almanac figure, cited per row; these are 2022/2024 crawls, so treat them as rough. Rows used on under ${pct(a.input.tailBelow)} of page loads are tail.`);
  L.push('- **Dragon status.** Every row has one or more probe declarations (common real-world values, curated in data/coverage-rank-input.json), each compiled through the public compiler for web, iOS and Android in the parity environment, with support profiles enforced. A probe is supported on a target when it compiles there with no error. Properties without curated samples are probed with their webref initial value, which is sound only because Dragon refuses an unknown property whatever its value; the script warns when that assumption breaks. Nothing here restates a status: rerun the script and the table follows the code.');
  L.push('- **Status codes.** `yes` = every probe compiles; `k/n` = k of n probes do; `no CODE` = none, with the first blocking diagnostic; `UNPROVEN_CONTEXT` means the value exists in the profile but not in the probe\'s context; `n/a` = an info-level not-applicable-on-native verdict.');
  L.push('- **Lanes.** Each row (or each probe value) is assigned to one candidate lane. A lane\'s **reach** is the usage it would move to supported on native: the summed share of every row, times the share of that row\'s probes that fail on native and belong to the lane. **Size** is S (one PR, about a day), M (2 PRs) or L (4 or more), weighted 1, 2 and 4; **score** = reach / weight. TW is the number of Tailwind 4.3.3 utilities whose first iOS blocker falls in the lane (packages/tailwind-sweep/snapshot); NS counts the north-star declarations it would unblock on native. Lane sizes, dependencies and assignments are judgement and live in the input file.');
  L.push('- **NA-NATIVE.** Rows on the PM\'s proposed list are marked `NA (proposed)`; the further candidates found here are `NA? (candidate)` and need the owner\'s per-entry review. Neither counts as supported, and only the proposed list leaves the denominator, in the second headline figure.');
  L.push('');
  L.push('## Ranked lanes');
  L.push('');
  L.push('| # | lane | size | reach | score | TW | NS | status | depends on | unlocks (largest first) |');
  L.push('|---:|---|:-:|---:|---:|---:|---:|---|---|---|');
  for (const [i, r] of a.ranked.slice(0, 25).entries()) {
    const unlocks = r.items.slice(0, 7).map((x) => `${x.id} ${pct(x.gain)}`).join(', ') + (r.items.length > 7 ? `, +${r.items.length - 7} more` : '');
    L.push(`| ${i + 1} | **${r.lane.id}**: ${r.lane.title} | ${r.lane.size} | ${(r.reach * 100).toFixed(0)} | ${(r.score * 100).toFixed(0)} | ${r.tw} | ${r.ns} | ${r.lane.status} | ${r.lane.depends} | ${unlocks} |`);
  }
  if (a.ranked.length > 25) {
    L.push('');
    L.push(`Below the top 25: ${a.ranked.slice(25).map((r) => `${r.lane.id} (${(r.score * 100).toFixed(0)})`).join(', ')}.`);
  }
  L.push('');
  L.push('Reach and score are in percentage points of page-load share (summed over rows, so a lane can pass 100).');
  L.push('');
  if (a.warnings.length > 0) {
    L.push('## Warnings');
    L.push('');
    for (const w of a.warnings) L.push(`- ${w}`);
    L.push('');
  }
  L.push('## Appendix A: properties (chromestatus, current counters)');
  L.push('');
  L.push('| property | usage | web | ios | android | lane | TW | NS | note |');
  L.push('|---|---:|---|---|---|---|---:|---:|---|');
  const note = (r: Row): string => [r.na === 'proposed' ? 'NA (proposed)' : r.na === 'candidate' ? 'NA? (candidate)' : '', r.alias === null ? '' : `alias of ${r.alias}`, r.sampled === 'initial value' ? 'initial value probe' : ''].filter((s) => s !== '').join('; ');
  for (const r of a.rows.filter((x) => x.kind === 'property')) {
    if ((r.usage ?? 0) < 0.001) continue;
    L.push(`| ${r.id} | ${pct(r.usage)} | ${cell(r, 'web')} | ${cell(r, 'ios')} | ${cell(r, 'android')} | ${laneCell(r)} | ${a.twByRow.get(r.id) ?? ''} | ${a.nsByRow.get(r.id) ?? ''} | ${note(r)} |`);
  }
  L.push('');
  L.push(`Properties under 0.1% of page loads are left out of this table (they still count in the headline).`);
  L.push('');
  L.push('## Appendix B: values, selectors, at-rules and elements');
  L.push('');
  L.push('| feature | usage | source | web | ios | android | lane | note |');
  L.push('|---|---:|---|---|---|---|---|---|');
  for (const r of a.rows.filter((x) => x.kind !== 'property')) {
    L.push(`| ${r.id.replace(/\|/g, '\\|')} | ${pct(r.usage)} | ${r.usageNote} | ${cell(r, 'web')} | ${cell(r, 'ios')} | ${cell(r, 'android')} | ${laneCell(r)} | ${note(r)} |`);
  }
  L.push('');
  L.push('## Appendix C: Tailwind refusal groups not mapped to a row');
  L.push('');
  L.push(a.twUnmapped.length === 0 ? 'None.' : a.twUnmapped.slice(0, 40).map((g) => `\`${g.group}\` ${g.n}`).join('; ') + (a.twUnmapped.length > 40 ? `; +${a.twUnmapped.length - 40} more` : ''));
  L.push('');
  L.push('## Appendix D: probes');
  L.push('');
  L.push('Each row\'s probes are in docs/goals/milestone-2-proof/data/coverage-rank-input.json (`samples`, `features`, `probe.contexts`); a property without samples is probed as `.u{<property>: <webref initial value>}`. The probe document is the parity environment (400x300, DPR 1, ltr, Ahem root) with this body unless a probe gives its own:');
  L.push('');
  L.push('```html');
  L.push(a.input.body);
  L.push('```');
  L.push('');
  return `${L.join('\n')}\n`;
}

main();

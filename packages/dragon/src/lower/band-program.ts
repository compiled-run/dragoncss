// MQ-R1 (notes/T067-mq-r-spec.md R4, R5, R8): the @media bands of a native output. The compiler writes the band table (each
// width and height feature of the sheet as a typed atom, each band as the truth vector of all atoms) and folds every band into the
// state program as one more variable, env#band, internal to the runtime: every (assignment, band) pair is an assignment, so a band
// change is the same atomic delta a setter applies. The TypeScript reference of the runtime that switches bands is
// packages/parity/src/media-runtime.ts (the core imports the layout engine for types only). The device never cascades, matches or
// evaluates CSS; it evaluates the atoms (packages/layout/src/rt-band.ts) and looks the vector up.
import type { rtBand } from '@dragon/layout';
import type { Longhand } from '../css/properties.ts';
import type { CssValue } from '../css/values.ts';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { AnimationAnalysis, ElementAnimation, Listing } from '../analysis/animations.ts';
import type { ResolvedElement } from '../analysis/resolve.ts';
import { canonicalJson } from '../digest.ts';
import type { Band, BandPartition, Comparison, MediaFeature, MediaValue } from '../media/index.ts';
import { INITIAL_FONT_SIZE, resolveLength, serialiseFeature } from '../media/index.ts';
import type { Rule, RuleCondition } from '../css/stylesheet.ts';
import type { Assignment, Diagnostic, Scalar, Span } from '../types.ts';
import type { NativeBackend, NativeProgram } from './native-program.ts';
import type { StateCase, StateFaults, StateProgram } from './state-program.ts';
import { deriveStateProgram, MAX_STATE_TABLE_ASSIGNMENTS, NO_STATE_FAULTS, stateKey } from './state-program.ts';

export const BAND_PROGRAM_VERSION = 'dragon.band-program/1';

/** The band variable's instance: input validation refuses a document id starting with '@', so no authored state can share its key. */
export const ENV_INSTANCE = '@env';
export const BAND_STATE = 'band';
/** env#band (R5): the band index, a state program variable that is not an app setter and not in the binding manifest. */
export const BAND_KEY = stateKey(ENV_INSTANCE, BAND_STATE);

export class BandProgramError extends Error {}

// ---------------------------------------------------------------- the band table

const OPS: { readonly [C in Comparison]: rtBand.BandOp } = { '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '=': 'eq' };
/** `<value> <op> <feature>` read as `<feature> <reversed op> <value>`, as Chrome's ReverseOperator does. */
const REVERSED: { readonly [C in Comparison]: rtBand.BandOp } = { '<': 'gt', '<=': 'ge', '>': 'lt', '>=': 'le', '=': 'eq' };

function comparison(op: rtBand.BandOp, v: MediaValue, where: string): rtBand.BandComparison {
  if (v.kind === 'length') return { op, value: resolveLength(v.length, INITIAL_FONT_SIZE), num: 0, den: 0 };
  if (v.kind === 'ratio') return { op, value: 0, num: v.num, den: v.den };
  throw new BandProgramError(`${where}: a ${v.kind} value has no band comparison`);
}

/** One media feature as the typed atom the device evaluates; em and rem resolve against the initial 16px, as Chrome's do. */
export function bandAtom(f: MediaFeature): rtBand.BandAtom {
  const where = serialiseFeature(f);
  if (f.refused !== null) throw new BandProgramError(`${where} is refused, so it has no atom`);
  if (f.base !== 'width' && f.base !== 'height' && f.base !== 'orientation' && f.base !== 'aspect-ratio') throw new BandProgramError(`${where} is not a viewport feature`);
  const feature: rtBand.BandFeature = f.base;
  if (f.form === 'boolean') return { feature, comparisons: [], keyword: 'none' };
  if (feature === 'orientation') {
    const v = f.value;
    if (f.form !== 'plain' || v === null || v.kind !== 'ident' || (v.name !== 'portrait' && v.name !== 'landscape')) throw new BandProgramError(`${where}: orientation takes portrait or landscape`);
    return { feature, comparisons: [], keyword: v.name };
  }
  if (f.form === 'plain') {
    if (f.value === null) throw new BandProgramError(`${where}: a plain feature without a value`);
    return { feature, comparisons: [comparison(f.prefix === 'min' ? 'ge' : f.prefix === 'max' ? 'le' : 'eq', f.value, where)], keyword: 'none' };
  }
  const comparisons: rtBand.BandComparison[] = [];
  if (f.left !== null) comparisons.push(comparison(REVERSED[f.left.op], f.left.value, where));
  if (f.right !== null) comparisons.push(comparison(OPS[f.right.op], f.right.value, where));
  if (comparisons.length === 0) throw new BandProgramError(`${where}: a range without a comparison`);
  return { feature, comparisons, keyword: 'none' };
}

/** The band table of a partition: its atoms in atom order and every band's truth vector in band order. */
export function bandTableOf(partition: Extract<BandPartition, { kind: 'bands' }>): rtBand.BandTable {
  return { atoms: partition.atoms.map((a) => bandAtom(a.feature)), bands: partition.bands.map((b: Band) => [...b.truth]) };
}

/** 1/64 px: the slack Chrome gives >=, <= and = (rt-band.ts MEDIA_EPSILON; the core cannot import the engine's value). */
const SLACK = 1 / 64;

/** One comparison held exactly, or with Chrome's slack (a negative query holds only for > and >=, either way). */
function holdsAt(c: rtBand.BandComparison, v: number, slack: boolean): boolean {
  if (c.value < 0) return c.op === 'gt' || c.op === 'ge';
  const e = slack ? SLACK : 0;
  if (c.op === 'lt') return v < c.value;
  if (c.op === 'gt') return v > c.value;
  if (c.op === 'le') return v <= c.value + e;
  if (c.op === 'ge') return v >= c.value - e;
  return Math.abs(v - c.value) <= e;
}

/**
 * The width or height atoms whose truth values Chrome's 1/64 px slack (>=, <= and =) combines in a way the exact partition
 * (media/band.ts) never does, as the two atom texts of the first such combination; null when there is none. There the runtime
 * lookup would meet a truth vector no band has. Each atom's truth is piecewise constant on its axis with breakpoints at its
 * thresholds and 1/64 px either side, so evaluating both ways at every breakpoint and between them finds every combination.
 * MQ-R0 makes the partition itself take the slack, and with it this refusal goes.
 */
export function closeThresholds(partition: Extract<BandPartition, { kind: 'bands' }>): { readonly a: string; readonly b: string } | null {
  for (const axis of ['width', 'height'] as const) {
    const atoms = partition.atoms.flatMap((a) => (a.feature.base === axis ? [{ text: a.text, atom: bandAtom(a.feature) }] : []));
    if (atoms.length < 2) continue;
    const marks = [...new Set([0, ...atoms.flatMap((a) => a.atom.comparisons.flatMap((c) => (c.value < 0 ? [] : [c.value - SLACK, c.value, c.value + SLACK])))])].filter((v) => v >= 0).sort((x, y) => x - y);
    const points = [...marks, ...marks.slice(1).map((v, i) => (v + (marks[i] as number)) / 2), (marks[marks.length - 1] as number) + 1];
    const vector = (v: number, slack: boolean): boolean[] => atoms.map((a) => (a.atom.comparisons.length === 0 ? v !== 0 : a.atom.comparisons.every((c) => holdsAt(c, v, slack))));
    const exact = new Set(points.map((v) => vector(v, false).join()));
    for (const v of points) {
      const got = vector(v, true);
      if (exact.has(got.join())) continue;
      // Name two atoms whose pair of values the exact partition never has.
      for (let i = 0; i < atoms.length; i++) {
        for (let j = i + 1; j < atoms.length; j++) {
          if (!points.some((w) => {
            const x = vector(w, false);
            return x[i] === got[i] && x[j] === got[j];
          })) return { a: (atoms[i] as { text: string }).text, b: (atoms[j] as { text: string }).text };
        }
      }
      return { a: (atoms[0] as { text: string }).text, b: (atoms[1] as { text: string }).text };
    }
  }
  return null;
}

/** MQ-R1: the native refusal of closeThresholds, once per native target, at the first condition that uses either atom. */
export function refuseCloseThresholds(partition: Extract<BandPartition, { kind: 'bands' }>, conditions: readonly RuleCondition[], targets: readonly ('ios' | 'android')[], diagnostics: Diagnostic[]): void {
  const close = closeThresholds(partition);
  if (close === null || targets.length === 0) return;
  const c = conditions.find((x) => x.text.includes(close.a) || x.text.includes(close.b)) ?? conditions[0];
  if (c === undefined) return;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
      origin: authored(c.span),
      target: t,
      message: `@media ${close.a} and ${close.b} meet within 1/64 px, where Chrome's 1/64 px slack lets a viewport match a combination the ${t} bands do not hold yet (package MQ-R0)`,
      manual: 'Move the two thresholds at least 1/64 px apart (for example (max-width: 400px) with (min-width: 401px)).',
    }));
  }
}

/**
 * MQ-R1: the state table of a native output holds every (app assignment, band) pair, so the 64-assignment limit counts bands. A
 * sheet that splits a document past it is refused on each native target at its first @media, not left to fail when the program is built.
 */
export function refuseBandedStateSpace(assignments: number, bands: number, conditions: readonly RuleCondition[], targets: readonly ('ios' | 'android')[], diagnostics: Diagnostic[]): void {
  const c = conditions[0];
  if (bands <= 1 || assignments * bands <= MAX_STATE_TABLE_ASSIGNMENTS || c === undefined) return;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_STATE_SPACE_LIMIT', {
      origin: authored(c.span),
      target: t,
      message: `${assignments} reachable assignments in ${bands} @media bands are ${assignments * bands} (assignment, band) pairs, above the ${t} state table limit of ${MAX_STATE_TABLE_ASSIGNMENTS}`,
    }));
  }
}

/**
 * MQ-R1: a transition or animation declaration in a rule that does not apply in every @media band would give native per-band
 * transition and animation lists, which the native animator does not build yet (package MQ-Rt); refused on each native target.
 */
export function refuseBandedNativeAnimations(allRules: readonly Rule[], inEveryBand: (r: Rule) => boolean, targets: readonly ('ios' | 'android')[], diagnostics: Diagnostic[]): void {
  for (const rule of allRules) {
    if (inEveryBand(rule) || rule.selectors.every((sel) => sel.dropped)) continue;
    for (const d of rule.declarations) {
      if (d.animation === undefined) continue;
      for (const t of targets) {
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: authored(d.valueSpan),
          target: t,
          message: `${d.property} inside @media is unsupported on ${t}: transition and animation lists that differ between @media bands are not built yet (package MQ-Rt)`,
          manual: 'Declare the transition or animation outside @media, the same at every viewport size.',
        }));
      }
    }
  }
}

// ---------------------------------------------------------------- the band state program

/** One (assignment, band) pair's per-case program. */
export type BandCase = { readonly assignment: Assignment; readonly isInitial: boolean; readonly band: number; readonly program: NativeProgram };

/** Planted faults of the band runtime reference and its program; each must fail its own lane (notes/T067 §4 MQ-R1). */
export type BandRuntimeFaults = {
  /** A size change lays out at the new size before it applies the new band, so the frame shows the old band at the new size. */
  readonly bandStale: boolean;
  /** A size change neither lays out again nor takes the new viewport. */
  readonly resizeSkipsRelayout: boolean;
  /** Every delta of an assignment outside the initial band loses its last changed node record. */
  readonly bandDeltaDropped: boolean;
} & rtBand.BandFaults;

export const NO_BAND_RUNTIME_FAULTS: BandRuntimeFaults = { bandStale: false, resizeSkipsRelayout: false, bandDeltaDropped: false, bandBoundaryExclusive: false };

/** An assignment with env#band set to a band. */
export const withBand = (a: Assignment, band: number): Assignment => [...a, { state: { instance: ENV_INSTANCE, state: BAND_STATE }, value: band }];

/**
 * The state program of a tree case set over every band: one assignment per (app assignment, band), env#band last, the initial
 * assignment's in initialBand first; the 64-assignment cap counts bands too (StateProgramError beyond it).
 */
export function bandStateProgram(backend: NativeBackend, cases: readonly BandCase[], bands: number, initialBand: number, faults: StateFaults = NO_STATE_FAULTS, bandFaults: BandRuntimeFaults = NO_BAND_RUNTIME_FAULTS): StateProgram {
  if (!Number.isInteger(bands) || bands < 1) throw new BandProgramError(`a band program needs at least one band, got ${bands}`);
  if (!Number.isInteger(initialBand) || initialBand < 0 || initialBand >= bands) throw new BandProgramError(`initial band ${initialBand} is not one of the ${bands} bands`);
  for (const c of cases) {
    if (!Number.isInteger(c.band) || c.band < 0 || c.band >= bands) throw new BandProgramError(`a case in band ${c.band}, which is not one of the ${bands} bands`);
    if (c.assignment.some((a) => stateKey(a.state.instance, a.state.state) === BAND_KEY)) throw new BandProgramError(`an app assignment names ${BAND_KEY}`);
  }
  // Every app assignment must be present in every band, or a band change could reach an assignment the table lacks.
  const keys = (b: number): string[] => cases.filter((c) => c.band === b).map((c) => canonicalJson(c.assignment)).sort();
  const first = keys(0);
  for (let b = 1; b < bands; b++) if (canonicalJson(keys(b)) !== canonicalJson(first)) throw new BandProgramError(`band ${b} does not hold the same app assignments as band 0`);
  // Band-major order keeps band 0's assignments first, so the domain of env#band is 0, 1, ... in order.
  const ordered = [...cases].sort((a, b) => a.band - b.band);
  const stateCases: StateCase[] = ordered.map((c) => ({ assignment: withBand(c.assignment, c.band), isInitial: c.isInitial && c.band === initialBand, program: c.program }));
  const sp = deriveStateProgram(backend, stateCases, faults);
  if (!bandFaults.bandDeltaDropped) return sp;
  // Planted: the band deltas lose their last changed node record.
  return {
    ...sp,
    deltas: sp.deltas.map((d, i) => {
      const own = (sp.assignments[i] as { assignment: Assignment }).assignment.find((a) => stateKey(a.state.instance, a.state.state) === BAND_KEY)?.value;
      return own !== initialBand && d.changed.length > 0 ? { ...d, changed: d.changed.slice(0, -1) } : d;
    }),
  };
}

/** The index of env#band among the program's states; a program without it is not a band program. */
export function bandStateIndex(sp: StateProgram): number {
  const s = sp.states.findIndex((x) => x.key === BAND_KEY);
  if (s < 0) throw new BandProgramError(`the state program has no ${BAND_KEY} variable`);
  return s;
}

/** The band of an assignment of a band program. */
export function bandOf(sp: StateProgram, assignment: number): number {
  const a = sp.assignments[assignment];
  if (a === undefined) throw new BandProgramError(`no assignment ${assignment}`);
  const v = a.assignment.find((x) => stateKey(x.state.instance, x.state.state) === BAND_KEY)?.value;
  if (typeof v !== 'number') throw new BandProgramError(`assignment ${a.key} has no band`);
  return v;
}

// ---------------------------------------------------------------- R8: transitions started by size changes (until MQ-Rt)

const VIEWPORT_UNIT = /^(?:vw|vh|vi|vb|vmin|vmax|[sld]v(?:w|h|i|b|min|max))$/i;
const VIEWPORT_IN_TEXT = /\d(?:vw|vh|vi|vb|vmin|vmax|[sld]v(?:w|h|i|b|min|max))\b/i;

/** Whether a computed value depends on the viewport's size (vw, vh, vi, vb, vmin, vmax and the sv, lv and dv forms). */
export function dependsOnViewport(v: CssValue): boolean {
  if (v.kind === 'length') return VIEWPORT_UNIT.test(v.unit);
  if (v.kind === 'other') return VIEWPORT_IN_TEXT.test(v.text);
  return false;
}

/** Whether a listing starts a transition: listed with a positive combined duration (CSSTransitionData). */
const starts = (l: Listing | undefined): boolean => l !== undefined && l.mode === 'listed' && Math.max(l.duration, 0) + l.delay > 0;

function byAddress(root: ResolvedElement): Map<string, ResolvedElement> {
  const out = new Map<string, ResolvedElement>();
  const walk = (el: ResolvedElement): void => {
    out.set(el.element.address, el);
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return out;
}

/** The span of the declaration that lists an element's transitions. */
function transitionSpan(ea: ElementAnimation): Span | null {
  const d = ea.declarations.find((x) => [...(x.animation?.longhands.keys() ?? [])].some((p) => p.startsWith('transition'))) ?? ea.declarations[0];
  return d === undefined ? null : d.valueSpan;
}

/** One band's cases and their transition analysis, in the same case order in every band. */
export type BandAnalysis = { readonly cases: readonly { readonly key: string; readonly resolved: ResolvedElement | null }[]; readonly animation: AnimationAnalysis };

/**
 * R8: a transitioned property whose computed value differs between two bands of one assignment, or depends on the viewport size,
 * would start a transition on a size change in Chrome (notes/T067 M8, M9). MQ-Rt builds that; until then each native target
 * refuses it, once per element and property.
 */
export function refuseSizeTransitions(bands: readonly BandAnalysis[], targets: readonly ('ios' | 'android')[], diagnostics: Diagnostic[]): void {
  if (bands.length === 0 || targets.length === 0) return;
  const reported = new Set<string>();
  const first = bands[0] as BandAnalysis;
  first.cases.forEach((c, i) => {
    if (c.resolved === null) return;
    const trees = bands.map((b) => {
      const r = (b.cases[i] as BandAnalysis['cases'][number] | undefined)?.resolved ?? null;
      if (r === null || (b.cases[i] as { key: string }).key !== c.key) throw new BandProgramError(`band case ${i} is not ${c.key} in every band`);
      return byAddress(r);
    });
    const elements = bands.map((b) => b.animation.cases.find((x) => x.key === c.key)?.elements ?? new Map<string, ElementAnimation>());
    for (const [address, el] of trees[0] as Map<string, ResolvedElement>) {
      const listed = new Set<Longhand>();
      for (const e of elements) for (const [p, l] of e.get(address)?.listings ?? []) if (starts(l)) listed.add(p);
      for (const p of [...listed].sort()) {
        const values = trees.map((t) => t.get(address)?.props.get(p)?.value ?? null);
        const differs = values.some((v) => canonicalJson(v) !== canonicalJson(values[0]));
        const viewport = values.some((v) => v !== null && dependsOnViewport(v));
        if (!differs && !viewport) continue;
        const ea = elements.map((e) => e.get(address)).find((x) => x !== undefined);
        const span = ea === undefined ? null : transitionSpan(ea);
        const id = `${address}|${p}`;
        if (reported.has(id)) continue;
        reported.add(id);
        const origin = span === null ? el.element.node.origin : authored(span);
        for (const t of targets) {
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin,
            target: t,
            message: `transition on ${p} of ${address} would start when the screen size changes; transitions started by size changes are not built yet (package MQ-Rt)`,
            manual: viewport ? `${p} depends on the viewport size: give it a value without vw, vh, vmin or vmax, or remove ${p} from the transition.` : `${p} differs between @media bands: remove ${p} from the transition, or give it the same value at every viewport size.`,
          }));
        }
      }
    }
  });
}


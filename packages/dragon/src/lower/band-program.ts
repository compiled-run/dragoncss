// MQ-R1 (notes/T067-mq-r-spec.md R4, R5, R8): the @media bands of a native output. The compiler writes the band table (each
// width and height feature of the sheet as a typed atom, each band as the truth vector of all atoms) and folds every band into the
// state program as one more variable, env#band, internal to the runtime: every (assignment, band) pair is an assignment, so a band
// change is the same atomic delta a setter applies. MediaRuntime is the TypeScript reference of the generated runtime: a root size
// change computes the new band first, applies its delta, then lays out once at the new size. The device never cascades, matches or
// evaluates CSS; it evaluates the atoms (packages/layout/src/rt-band.ts) and looks the vector up.
import { rtBand } from '@dragon/layout';
import type { Longhand } from '../css/properties.ts';
import type { CssValue } from '../css/values.ts';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { AnimationAnalysis, ElementAnimation, Listing } from '../analysis/animations.ts';
import type { ResolvedElement } from '../analysis/resolve.ts';
import { canonicalJson } from '../digest.ts';
import type { Band, BandPartition, Comparison, MediaFeature, MediaValue } from '../media/index.ts';
import { INITIAL_FONT_SIZE, resolveLength, serialiseFeature } from '../media/index.ts';
import type { Assignment, Diagnostic, Scalar, Span } from '../types.ts';
import type { NativeBackend, NativeProgram } from './native-program.ts';
import type { StateCase, StateFaults, StateProgram } from './state-program.ts';
import { deriveStateProgram, NO_STATE_FAULTS, StateRuntime, stateKey } from './state-program.ts';

export const BAND_PROGRAM_VERSION = 'dragon.band-program/1';

/** The band variable's instance: '@' never starts a document id, so no authored state can share its key. */
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

export const NO_BAND_RUNTIME_FAULTS: BandRuntimeFaults = { bandStale: false, resizeSkipsRelayout: false, bandDeltaDropped: false, ...rtBand.NO_BAND_FAULTS };

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

// ---------------------------------------------------------------- the runtime reference

export type RootSize = { readonly widthPx: number; readonly heightPx: number };

/**
 * The TypeScript reference of the generated media runtime: a root of whole device px at a DPR, the state runtime over the band
 * program, and the viewport the engine lays out at (the root's px / dpr). Each size change is one event: the band of the new size
 * first, its delta through env#band if it changed, then one layout at the new size. App setters go through set(), which refuses
 * env#band. layouts counts the layouts a mount would run.
 */
export class MediaRuntime {
  readonly states: StateRuntime;
  readonly table: rtBand.BandTable;
  readonly dpr: number;
  private readonly faults: BandRuntimeFaults;
  private readonly bandState: number;
  private size: RootSize;
  private laidOutSize: RootSize;
  private laidOutProgram: NativeProgram;
  private count = 0;

  constructor(sp: StateProgram, table: rtBand.BandTable, dpr: number, root: RootSize, faults: BandRuntimeFaults = NO_BAND_RUNTIME_FAULTS, stateFaults: StateFaults = NO_STATE_FAULTS) {
    this.bandState = bandStateIndex(sp);
    const domain = (sp.states[this.bandState] as StateProgram['states'][number]).domain;
    if (domain.length !== table.bands.length || domain.some((v, k) => v !== k)) throw new BandProgramError(`${BAND_KEY} has the domain ${JSON.stringify(domain)}, not the ${table.bands.length} bands of the table`);
    this.table = table;
    this.dpr = dpr;
    this.faults = faults;
    this.states = new StateRuntime(sp, stateFaults);
    this.size = root;
    this.laidOutSize = root;
    // The mount's first render is in the root's own band.
    this.moveBand(this.bandAt(root));
    this.laidOutProgram = this.states.program();
    this.count = 1;
    this.states.onChange = () => {
      this.layout();
    };
  }

  /** The band the table gives a root size. */
  bandAt(root: RootSize): number {
    return rtBand.bandAtPx(this.table, root.widthPx, root.heightPx, this.dpr, this.faults);
  }

  get band(): number {
    return bandOf(this.states.sp, this.states.assignment);
  }

  get layouts(): number {
    return this.count;
  }

  /** An app setter: env#band is internal and cannot be set. */
  set(key: string, value: Scalar): void {
    if (key === BAND_KEY) throw new BandProgramError(`${BAND_KEY} is set by the root size, not by the app`);
    this.states.set(key, value);
  }

  /** One root size change: the new band's delta, then one layout at the new size. */
  resize(root: RootSize): void {
    if (this.faults.resizeSkipsRelayout) return;
    const to = this.bandAt(root);
    this.size = root;
    if (this.faults.bandStale) {
      // Planted: the layout at the new size runs before the band delta, and the band moves silently afterwards.
      this.layout();
      const listener = this.states.onChange;
      this.states.onChange = null;
      try {
        this.moveBand(to);
      } finally {
        this.states.onChange = listener;
      }
      return;
    }
    if (to === this.band) this.layout();
    else this.moveBand(to);
  }

  private moveBand(to: number): void {
    if (to !== this.band) this.states.set(BAND_KEY, to);
  }

  private layout(): void {
    this.laidOutSize = this.size;
    this.laidOutProgram = this.states.program();
    this.count++;
  }

  /** The program on screen: the records and engine input of the last layout. */
  program(): NativeProgram {
    return this.laidOutProgram;
  }

  /** The viewport of the last layout, in CSS px. */
  viewport(): { readonly width: number; readonly height: number } {
    return { width: this.laidOutSize.widthPx / this.dpr, height: this.laidOutSize.heightPx / this.dpr };
  }
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


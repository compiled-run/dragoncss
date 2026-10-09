// T065 R17: the frame case kind. A frame fixture is a tree fixture under packages/parity/fixtures whose id starts anim- or
// motion- and whose directory holds frames.json (dragon-frames/1): phases, each an optional state step and a span in ms. The
// sample times of each span are derived from the animator's running records (the T096 list): t = 0, each delay and active end
// ± 1 ms, keyframe offsets ± 1 ms and segment midpoints, the steepest point and extrema of each bezier, steps discontinuities
// ± 1 ms, iteration edges 1, 2 and 1000 ± 1 ms, the optional 60 and 120 Hz grids, and the span's end; a final settle follows.
// The same derivation feeds the Chrome capture and the device script, so they cannot disagree. Counts are printed, never pinned.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LayoutInput, TextMeasurer } from '@dragon/layout';
import { NO_ENGINE_FAULTS, resolveEnvironment, rtAnimations, rtAnimator, rtEasing, rtInterpolate, rtTiming, rtTransition } from '@dragon/layout';
import type { AnimProgram, Compiled, NativeProgram, ProgramNode, Rgba8, Scalar, StateProgram } from 'dragon';
import { animProgramOf, animTablesOf, compiledCases, deriveStateProgram, nativePrograms, programAt, stateKey, StateRuntime } from 'dragon';
import { tree } from './fixture-groups/define.ts';
import type { FixtureSpec } from './fixtures.ts';
import { nativeCompile, referenceMeasurer } from './native-host.ts';
import { compileFixture, webCssOf } from './pipeline.ts';
import { repoPath } from './paths.ts';

export const FRAMES_SCHEMA = 'dragon-frames/1';

export type FramePhase = { readonly set: readonly (readonly [string, Scalar])[]; readonly span: number; readonly grid: 60 | 120 | null };
export type FramesSpec = { readonly directions: readonly ('ltr' | 'rtl')[]; readonly viewports: readonly { readonly width: number; readonly height: number }[]; readonly phases: readonly FramePhase[] };
export type AnimFixture = { readonly id: string; readonly spec: FixtureSpec; readonly frames: FramesSpec };

const FIXTURES = (): string => repoPath('packages/parity/fixtures');

/** Reads and checks a frames.json: every field typed, spans finite and non-negative, grids 60 or 120. */
export function parseFrames(text: string, where: string): FramesSpec {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const fail = (m: string): never => {
    throw new Error(`${where}: ${m}`);
  };
  if (raw['schema'] !== FRAMES_SCHEMA) fail(`schema must be ${FRAMES_SCHEMA}`);
  const directions = raw['directions'];
  if (!Array.isArray(directions) || directions.length === 0 || !directions.every((d) => d === 'ltr' || d === 'rtl')) fail('directions must be a non-empty list of ltr and rtl');
  const viewports = raw['viewports'];
  if (!Array.isArray(viewports) || viewports.length === 0 || !viewports.every((v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && (n as number) > 0))) fail('viewports must be a non-empty list of [width, height] in whole px');
  const phases = raw['phases'];
  if (!Array.isArray(phases) || phases.length === 0) fail('phases must be a non-empty list');
  return {
    directions: directions as ('ltr' | 'rtl')[],
    viewports: (viewports as number[][]).map(([width, height]) => ({ width: width as number, height: height as number })),
    phases: (phases as Record<string, unknown>[]).map((p, i) => {
      const span = p['span'];
      if (typeof span !== 'number' || !Number.isFinite(span) || span < 0) fail(`phase ${i}: span must be a finite, non-negative number of ms`);
      const set = p['set'] ?? [];
      if (!Array.isArray(set) || !set.every((s) => Array.isArray(s) && s.length === 2 && typeof s[0] === 'string' && ['string', 'number', 'boolean'].includes(typeof s[1]))) fail(`phase ${i}: set must be a list of [state, value]`);
      const grid = p['grid'] ?? null;
      if (grid !== null && grid !== 60 && grid !== 120) fail(`phase ${i}: grid must be 60 or 120`);
      const extra = Object.keys(p).filter((k) => !['span', 'set', 'grid'].includes(k));
      if (extra.length > 0) fail(`phase ${i}: unknown keys ${extra.join(', ')}`);
      return { set: set as [string, Scalar][], span: span as number, grid: grid as 60 | 120 | null };
    }),
  };
}

/** Every frame fixture, by glob: a fixture directory anim-* or motion-* with frames.json. YUI-1 adds its own the same way. */
export function animFixtures(dir: string = FIXTURES()): AnimFixture[] {
  return readdirSync(dir).filter((f) => /^(anim|motion)-/.test(f) && existsSync(join(dir, f, 'frames.json'))).sort().map((id) => ({
    id,
    spec: tree(id),
    frames: parseFrames(readFileSync(join(dir, id, 'frames.json'), 'utf8'), `${id}/frames.json`),
  }));
}

/** One frame case: a fixture in one direction and viewport, its state program (uikit) and animation tables. */
export type AnimCase = {
  readonly id: string;
  readonly fixture: AnimFixture;
  readonly direction: 'ltr' | 'rtl';
  readonly viewport: { readonly width: number; readonly height: number };
  readonly compiled: Compiled<'ios' | 'android'>;
  /** The web compile of the same fixture and direction (derive mode) and its CSS, for the chrome-dual rendering. */
  readonly webCompiled: Compiled<'ios' | 'web'>;
  readonly webCss: string | null;
  readonly sp: StateProgram;
  readonly ap: AnimProgram;
};

const compiles = new Map<string, Compiled<'ios' | 'android'>>();

/** The frame cases of a fixture: one per direction and viewport, ids <fixture>[-rtl]@<w>x<h>. */
export function animCasesOf(fx: AnimFixture): AnimCase[] {
  return fx.frames.directions.flatMap((direction) => {
    const key = `${fx.id} ${direction}`;
    let compiled = compiles.get(key);
    if (compiled === undefined) {
      compiled = nativeCompile(fx.spec, direction);
      compiles.set(key, compiled);
    }
    const c = compiled;
    const assignments = compiledCases(c);
    const sp = deriveStateProgram('uikit', assignments.map((a, i) => {
      const p = nativePrograms(c, a.assignment);
      if (p.kind !== 'ready') throw new Error(`${fx.id}: no native programs for case ${i}: ${p.reason}`);
      return { assignment: a.assignment, isInitial: a.isInitial, program: p.programs.uikit };
    }));
    const ap = animProgramOf(c, sp.assignments.map((x) => x.assignment));
    if (ap === null) throw new Error(`${fx.id}: the compile has no animation analysis`);
    const webCompiled = compileFixture(fx.spec, undefined, 'derive', direction).compiled;
    const webCss = webCssOf(webCompiled);
    return fx.frames.viewports.map((viewport) => ({ id: `${fx.id}${direction === 'rtl' ? '-rtl' : ''}@${viewport.width}x${viewport.height}`, fixture: fx, direction, viewport, compiled: c, webCompiled, webCss, sp, ap }));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Scripts.

export type FrameStep =
  | { readonly kind: 'set'; readonly sets: readonly { readonly state: string; readonly value: Scalar }[] }
  | { readonly kind: 'advance'; readonly ms: number }
  | { readonly kind: 'dump'; readonly at: number; readonly settle: boolean };

/** The offsets (ms from now) a running transition's or animation's interesting points fall at, before filtering to the span. */
export function interestingOffsets(records: ReturnType<Animator['records']>): number[] {
  const out: number[] = [];
  const near = (ms: number): void => {
    out.push(ms - 1, ms, ms + 1);
  };
  const curve = (e: rtEasing.Easing, start: number, dur: number): void => {
    if (e.kind === 'steps') {
      const jumps = e.position === 'jump-both' ? e.steps + 1 : e.steps;
      for (let k = 1; k < jumps + (e.position === 'jump-none' ? 0 : 1); k++) near(start + (dur * k) / e.steps);
    }
    const b = e.bezier;
    if (b === null) return;
    // The steepest point and the y extrema, by sampling the parametric curve (the samples need only land near them).
    let steep = 0;
    let best = 0;
    for (let i = 1; i < 1000; i++) {
      const t = i / 1000;
      const dx = (3 * b.ax * t + 2 * b.bx) * t + b.cx;
      const dy = (3 * b.ay * t + 2 * b.by) * t + b.cy;
      const x = ((b.ax * t + b.bx) * t + b.cx) * t;
      if (dx > 1e-9 && Math.abs(dy / dx) > best) {
        best = Math.abs(dy / dx);
        steep = x;
      }
      const t0 = (i - 1) / 1000;
      const dy0 = (3 * b.ay * t0 + 2 * b.by) * t0 + b.cy;
      if (dy0 * dy < 0) out.push(start + dur * x);
    }
    out.push(start + dur * steep);
  };
  for (const t of records.transitions) {
    const s = t.held.seconds * 1000;
    const d = t.timing.delay * 1000;
    const dur = t.timing.duration * 1000;
    near(d - s);
    near(d + dur - s);
    out.push(d + dur / 2 - s);
    curve(t.timing.easing, d - s, dur);
  }
  for (const a of records.animations) {
    if (a.paused) continue;
    const s = a.held.seconds * 1000;
    const d = a.timing.delay * 1000;
    const dur = a.timing.duration * 1000;
    near(d - s);
    for (const i of [1, 2, 1000]) if (i <= a.timing.iterations) near(d + i * dur - s);
    for (const o of [0.25, 0.5, 0.6, 0.75]) out.push(d + o * dur - s);
    if (Number.isFinite(a.timing.iterations)) near(d + a.timing.iterations * dur - s);
    curve(a.timing.easing, d - s, dur);
  }
  return out;
}

/** The longest any running transition still needs (ms), for the settle step. */
function settleMs(records: ReturnType<Animator['records']>): number {
  let end = 0;
  for (const t of records.transitions) end = Math.max(end, (t.timing.delay + t.timing.duration - t.held.seconds) * 1000);
  return end + 1;
}

/** R18's pixel subset rule, plantable: the ms after an edge, and whether the settle is shot. */
export type PixelFaults = { readonly edgeMs: number; readonly settle: boolean };
export const NO_PIXEL_FAULTS: PixelFaults = { edgeMs: 1, settle: true };

/** At most this many pixel samples per device DPR over every frame case (R18). */
export const FRAME_PIXEL_CAP = 400;

/** R18's pixel offsets (ms from now), each an expression interestingOffsets also pushes: keyframe offsets + 1 ms, midpoints, active ends + 1 ms. */
export function pixelOffsets(records: ReturnType<Animator['records']>, faults: PixelFaults = NO_PIXEL_FAULTS): number[] {
  const out: number[] = [];
  // The keyframe offsets are 0 and 1 of the first iteration (the script samples no inner offset), so its one segment's midpoint.
  for (const t of records.transitions) {
    const s = t.held.seconds * 1000;
    const d = t.timing.delay * 1000;
    const dur = t.timing.duration * 1000;
    out.push(d - s + faults.edgeMs, d + dur - s + faults.edgeMs, d + dur / 2 - s);
  }
  for (const a of records.animations) {
    if (a.paused) continue;
    const s = a.held.seconds * 1000;
    const d = a.timing.delay * 1000;
    const dur = a.timing.duration * 1000;
    out.push(d - s + faults.edgeMs, d + 0.5 * dur - s);
    if (1 <= a.timing.iterations) out.push(d + 1 * dur - s + faults.edgeMs);
    if (Number.isFinite(a.timing.iterations)) out.push(d + a.timing.iterations * dur - s + faults.edgeMs);
  }
  return out;
}

/** The script of a frame case and its pixel subset (dump indexes), from one pass over the simulator. */
function derivedScript(c: AnimCase, faults: PixelFaults): { readonly steps: FrameStep[]; readonly pixels: number[] } {
  const sim = simulator(c);
  const steps: FrameStep[] = [];
  const pixels: number[] = [];
  let dumps = 0;
  const dump = (at: number, settle: boolean, pixel: boolean): void => {
    if (pixel) pixels.push(dumps);
    dumps++;
    steps.push({ kind: 'dump', at, settle });
  };
  // t = 0 is the first dump and the dump right after each state step.
  dump(0, false, true);
  let now = 0;
  for (const p of c.fixture.frames.phases) {
    if (p.set.length > 0) {
      const sets = p.set.map(([state, value]) => ({ state: stateKey('doc', state), value }));
      steps.push({ kind: 'set', sets });
      sim.set(sets);
      dump(now, false, true);
    }
    const records = sim.animator.records();
    const times = new Set<number>([p.span]);
    for (const t of interestingOffsets(records)) if (t > 0 && t <= p.span) times.add(t);
    if (p.grid !== null) for (let k = 1; (k * 1000) / p.grid <= p.span; k++) times.add((k * 1000) / p.grid);
    const marks = new Set(pixelOffsets(records, faults).filter((t) => t > 0 && t <= p.span));
    for (const t of marks) if (!times.has(t)) throw new Error(`${c.id}: the pixel sample ${t} ms into a phase is not a dump of the script`);
    let at = 0;
    for (const t of [...times].sort((a, b) => a - b)) {
      if (t - at <= 0) continue;
      steps.push({ kind: 'advance', ms: t - at });
      sim.animator.advance(t - at);
      dump(now + t, false, marks.has(t));
      at = t;
    }
    now += p.span;
  }
  const settle = settleMs(sim.animator.records());
  steps.push({ kind: 'advance', ms: settle });
  dump(now + settle, true, faults.settle);
  return { steps, pixels };
}

/** The script of a frame case: each phase's state step, then its derived samples; a settle dump past every transition's end. */
export function frameScript(c: AnimCase): FrameStep[] {
  return derivedScript(c, NO_PIXEL_FAULTS).steps;
}

/** R18: the ascending dump indexes of a frame case's script whose pixels are compared; refuses steps that are not its script. */
export function pixelSamples(c: AnimCase, steps: readonly FrameStep[], faults: PixelFaults = NO_PIXEL_FAULTS): number[] {
  const d = derivedScript(c, faults);
  if (JSON.stringify(d.steps) !== JSON.stringify(steps)) throw new Error(`${c.id}: the steps are not this case's frame script`);
  return d.pixels;
}

/** The pixel samples per device DPR over the cases; throws above FRAME_PIXEL_CAP. */
export function pixelSampleTotal(cases: readonly AnimCase[], faults: PixelFaults = NO_PIXEL_FAULTS): number {
  const n = cases.reduce((k, c) => k + pixelSamples(c, frameScript(c), faults).length, 0);
  if (n > FRAME_PIXEL_CAP) throw new Error(`${n} frame pixel samples per DPR, above the cap of ${FRAME_PIXEL_CAP} (R18)`);
  return n;
}

/** A frame case's state runtime and animator, mounted at the initial assignment (R7: animations start at first style). */
export function simulator(c: AnimCase, faults: rtEasing.RtFaults = rtEasing.NO_RT_FAULTS, anim: AnimFaults = NO_ANIM_FAULTS): { readonly rt: StateRuntime; readonly animator: Animator; set: (sets: readonly { readonly state: string; readonly value: Scalar }[]) => void } {
  const rt = new StateRuntime(c.sp);
  const animator = new Animator(c.sp, c.ap, c.viewport, referenceMeasurer(), faults, anim);
  return {
    rt,
    animator,
    set: (sets) => {
      // R4: a step that sets several states is one style change event.
      for (const s of sets) rt.set(s.state, s.value);
      animator.event(rt.assignment);
    },
  };
}

export type FrameDump = { readonly at: number; readonly settle: boolean; readonly assignment: number; readonly frame: AnimFrame; readonly program: NativeProgram };

/** The dumps of a script on the TypeScript reference: each dump's animated values and the live program with them applied. */
export function runFrameScript(c: AnimCase, steps: readonly FrameStep[], faults: rtEasing.RtFaults = rtEasing.NO_RT_FAULTS, anim: AnimFaults = NO_ANIM_FAULTS): FrameDump[] {
  const sim = simulator(c, faults, anim);
  const out: FrameDump[] = [];
  for (const s of steps) {
    if (s.kind === 'set') sim.set(s.sets);
    else if (s.kind === 'advance') sim.animator.advance(s.ms);
    else out.push({ at: s.at, settle: s.settle, assignment: sim.rt.assignment, frame: sim.animator.frame(), program: sim.animator.program(sim.rt.program()) });
  }
  return out;
}

/** The (node, property) pairs a case animates: every transition slot and every keyframe-animated base. */
export function trackedProperties(ap: AnimProgram): readonly { readonly node: string; readonly property: string }[] {
  const out = new Map<string, { node: string; property: string }>();
  for (const s of ap.slots) out.set(`${s.node}|${s.property}`, { node: s.node, property: s.property });
  for (const b of ap.bases) out.set(`${b.node}|${b.property}`, { node: b.node, property: b.property });
  // R9: the colours an animated colour reaches (inheriting descendants, currentcolor borders), compared as Chrome computes them.
  for (const c of ap.closure) for (const w of c.writes) out.set(`${w.node}|${w.property}`, { node: w.node, property: w.property });
  return [...out.values()];
}


// The runtime animator's TypeScript reference (T065 R2, R4, R7, R9, R16): the translated root packages/layout/src/rt-animator.ts
// over one state program's tables, so the frame lanes judge the very code the generated Swift and Kotlin run. The wrapper only
// supplies what the root takes as data: the tables (lower/anim-program.ts animTablesOf) and every assignment's engine input,
// resolved for the case's environment by the engine's own resolver (R14).

export const ANIM_RUNTIME_VERSION = 'dragon.runtime-anim/2';

/** Planted faults of the runtime (T065 §4); the rt ones are rtEasing.RtFaults. */
export type AnimFaults = rtAnimator.AnimatorFaults;

export const NO_ANIM_FAULTS: AnimFaults = rtAnimator.NO_ANIMATOR_FAULTS;

type AnimatedValue = rtInterpolate.AnimatedValue;

/** One frame's output: the value of every animated (node, property), keyed by trackKey, in the animator's order. */
export type AnimFrame = ReadonlyMap<string, AnimatedValue>;

export const trackKey = (node: string, property: string): string => `${node}|${property}`;

const frameOf = (entries: readonly rtAnimator.FrameEntry[]): AnimFrame => new Map(entries.map((e) => [trackKey(e.node, e.property), e.value]));
const entriesOf = (frame: AnimFrame): rtAnimator.FrameEntry[] => [...frame].map(([k, value]) => {
  const at = k.indexOf('|');
  return { node: k.slice(0, at), property: k.slice(at + 1), value };
});

/** Every assignment's engine input, resolved at DPR 1 for the environment (CSS px): where length endpoints come from. */
export function resolvedInputs(sp: StateProgram, viewport: { readonly width: number; readonly height: number }, measurer: TextMeasurer): LayoutInput[] {
  return sp.assignments.map((_, i) => {
    const p = programAt(sp, i);
    const v = { width: viewport.width, height: viewport.height };
    return resolveEnvironment({ viewport: v, devicePixelRatio: 1, viewportUnits: { small: v, large: v, dynamic: v }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: p.rootFontSize, root: p.root }, NO_ENGINE_FAULTS, measurer);
  });
}

/** The TypeScript reference animator over one state program and its animation tables, in one environment. */
export class Animator {
  private readonly tables: rtAnimator.AnimTables;
  private readonly inputs: readonly LayoutInput[];
  private readonly initial: number;
  private readonly faults: rtEasing.RtFaults;
  private readonly anim: AnimFaults;
  private state: rtAnimator.AnimatorState;

  constructor(sp: StateProgram, ap: AnimProgram, viewport: { readonly width: number; readonly height: number }, measurer: TextMeasurer, faults: rtEasing.RtFaults = rtEasing.NO_RT_FAULTS, anim: AnimFaults = NO_ANIM_FAULTS) {
    this.tables = animTablesOf(ap);
    if (this.tables.assignments !== sp.assignments.length) throw new Error(`the animation tables hold ${this.tables.assignments} assignments, the state program ${sp.assignments.length}`);
    this.inputs = resolvedInputs(sp, viewport, measurer);
    this.initial = sp.initial;
    this.faults = faults;
    this.anim = anim;
    this.state = rtAnimator.animatorStart(this.tables, this.inputs, sp.initial, faults, anim);
  }

  get assignment(): number {
    return this.state.current;
  }

  /** R4: one style change event, the setter having moved the state program from the current assignment to `to`. */
  event(to: number): void {
    this.state = rtAnimator.animatorEvent(this.state, this.tables, this.inputs, this.initial, to, this.faults, this.anim);
  }

  /** One lane step (R2): every running, unfinished transition and animation moves by ms. */
  advance(ms: number): void {
    this.state = rtAnimator.animatorAdvance(this.state, this.tables, this.inputs, this.initial, ms, this.faults, this.anim);
  }

  /** Every animated (node, property) value now, transitions and animations, in CSS px and legacy colour. */
  frame(): AnimFrame {
    return frameOf(rtAnimator.animatorFrame(this.state, this.tables, this.faults));
  }

  /** The running records (read only): what the lanes derive their sample times from (T065 R17). */
  records(): { readonly transitions: readonly rtTransition.RunningTransition[]; readonly animations: readonly rtAnimations.RunningAnimation[] } {
    return { transitions: this.state.transitions.filter((t): t is rtTransition.RunningTransition => t !== null && !rtTransition.transitionFinished(t)), animations: this.state.lists.flat() };
  }

  /** True while a transition runs or an animation is relevant: the display driver runs only then (R3). */
  busy(): boolean {
    return rtAnimator.animatorBusy(this.state);
  }

  /** The live program with the frame applied (R16): colours into writes with the R9 closure, lengths into the engine input. */
  program(base: NativeProgram): NativeProgram {
    return applyFrame(base, this.frame(), this.tables, this.anim);
  }
}

/** R9: a frame with the closure of its animated colours (rt-animator.ts closureFrame). */
export function closureFrame(frame: AnimFrame, ap: AnimProgram, anim: AnimFaults = NO_ANIM_FAULTS): AnimFrame {
  return frameOf(rtAnimator.closureFrame(entriesOf(frame), animTablesOf(ap), anim));
}

const SIDES = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];

/** Writes a frame into a program as the device writes it into its views and engine input: a new program, the base untouched. */
export function applyFrame(base: NativeProgram, frame: AnimFrame, tables: rtAnimator.AnimTables, anim: AnimFaults = NO_ANIM_FAULTS): NativeProgram {
  if (frame.size === 0) return base;
  const entries = entriesOf(frame);
  const colors = new Map<string, Rgba8>(rtAnimator.frameColors(entries, tables, anim).map((c) => [trackKey(c.node, c.property), c.rgba]));
  const nodes = base.nodes.map((n): ProgramNode => {
    const textColor = n.kind === 'text' && n.parent !== null ? colors.get(trackKey(n.parent, 'color')) : undefined;
    const writes = n.writes.map((w) => {
      if (w.kind === 'background-color') {
        const c = colors.get(trackKey(n.id, 'background-color'));
        return c === undefined ? w : { ...w, color: c };
      }
      if (w.kind === 'border-colors') {
        const sides = SIDES.map((p) => colors.get(trackKey(n.id, p)));
        if (sides.every((x) => x === undefined)) return w;
        return { ...w, colors: w.colors.map((c, i) => sides[i] ?? c) as unknown as typeof w.colors };
      }
      if (w.kind === 'text-color' && textColor !== undefined) return { ...w, color: textColor };
      return w;
    });
    return { ...n, writes };
  });
  return { ...base, nodes, root: rtAnimator.patchRoot(base.root, entries, tables) };
}

// ---------------------------------------------------------------- the animator suite's vectors (3b)

export const ANIMATOR_VECTORS_PATH = 'packages/layout/rt-vectors/animator/cases.json';

/** One frame case as the animator suite runs it: the tables, every assignment's resolved input, the script as animator steps. */
export type AnimatorVector = {
  readonly id: string;
  readonly tables: rtAnimator.AnimTables;
  readonly inputs: readonly LayoutInput[];
  readonly initial: number;
  readonly steps: readonly (readonly [string] | readonly [string, number])[];
};

/** A frame case's animator vector: each set step becomes one style change event to the assignment it reaches (R4). */
export function animatorVector(c: AnimCase): AnimatorVector {
  const rt = new StateRuntime(c.sp);
  const steps = frameScript(c).map((s): readonly [string] | readonly [string, number] => {
    if (s.kind === 'advance') return ['advance', s.ms];
    if (s.kind === 'dump') return ['dump'];
    for (const x of s.sets) rt.set(x.state, x.value);
    return ['event', rt.assignment];
  });
  return { id: c.id, tables: animTablesOf(c.ap), inputs: resolvedInputs(c.sp, c.viewport, referenceMeasurer()), initial: c.sp.initial, steps };
}

/** The vectors file: JSON has no infinity, so an infinite iteration count is "infinite" (the harness decodes it back). */
export function animatorVectorsJson(cases: readonly AnimCase[]): string {
  const vectors = cases.map(animatorVector);
  const text = JSON.stringify({ schema: 'dragon-animator-vectors/1', cases: vectors }, (k, v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      if (k !== 'iterations' || v !== Infinity) throw new Error(`the animator vectors hold ${String(v)} at ${k}`);
      return 'infinite';
    }
    return v;
  }, 1);
  return `${text}\n`;
}

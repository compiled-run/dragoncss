// T065 R17: the frame case kind. A frame fixture is a tree fixture under packages/parity/fixtures whose id starts anim- or
// motion- and whose directory holds frames.json (dragon-frames/1): phases, each an optional state step and a span in ms. The
// sample times of each span are derived from the animator's running records (the T096 list): t = 0, each delay and active end
// ± 1 ms, keyframe offsets ± 1 ms and segment midpoints, the steepest point and extrema of each bezier, steps discontinuities
// ± 1 ms, iteration edges 1, 2 and 1000 ± 1 ms, the optional 60 and 120 Hz grids, and the span's end; a final settle follows.
// The same derivation feeds the Chrome capture and the device script, so they cannot disagree. Counts are printed, never pinned.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Compiled, NativeProgram, Scalar, StateProgram } from 'dragon';
import { Animator, animProgramOf, compiledCases, deriveStateProgram, NO_ANIM_FAULTS, nativePrograms, stateKey, StateRuntime } from 'dragon';
import type { AnimFaults, AnimFrame, AnimProgram } from 'dragon';
import { rtEasing } from '@dragon/layout';
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

/** The script of a frame case: each phase's state step, then its derived samples; a settle dump past every transition's end. */
export function frameScript(c: AnimCase): FrameStep[] {
  const sim = simulator(c);
  const steps: FrameStep[] = [{ kind: 'dump', at: 0, settle: false }];
  let now = 0;
  for (const p of c.fixture.frames.phases) {
    if (p.set.length > 0) {
      const sets = p.set.map(([state, value]) => ({ state: stateKey('doc', state), value }));
      steps.push({ kind: 'set', sets });
      sim.set(sets);
      steps.push({ kind: 'dump', at: now, settle: false });
    }
    const times = new Set<number>([p.span]);
    for (const t of interestingOffsets(sim.animator.records())) if (t > 0 && t <= p.span) times.add(t);
    if (p.grid !== null) for (let k = 1; (k * 1000) / p.grid <= p.span; k++) times.add((k * 1000) / p.grid);
    let at = 0;
    for (const t of [...times].sort((a, b) => a - b)) {
      if (t - at <= 0) continue;
      steps.push({ kind: 'advance', ms: t - at });
      sim.animator.advance(t - at);
      steps.push({ kind: 'dump', at: now + t, settle: false });
      at = t;
    }
    now += p.span;
  }
  const settle = settleMs(sim.animator.records());
  steps.push({ kind: 'advance', ms: settle });
  steps.push({ kind: 'dump', at: now + settle, settle: true });
  return steps;
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
  return [...out.values()];
}

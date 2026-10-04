// pnpm run rt:oracle: captures Chrome 145's web-animations numerics into packages/layout/rt-oracle (getComputedTiming progress
// and currentIteration as IEEE-754 bits, getComputedStyle strings of held element.animate() interpolations) and writes the TS
// reference's outputs for the same inputs to packages/layout/rt-vectors (for the ANIM-a2 Swift and Kotlin equality).
// `-- --check` captures afresh, compares Chrome with the reference bit for bit and string for string and with the stored
// oracle byte for byte, prints the derived sample counts, and exits 1 on any difference.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { runAnimationScript } from '../packages/layout/src/rt-animations.ts';
import type { Easing, EasingSpec, RtFaults, StepPosition } from '../packages/layout/src/rt-easing.ts';
import { cubicBezier, easingFromSpec, LINEAR, NO_RT_FAULTS, solveBezier } from '../packages/layout/src/rt-easing.ts';
import type { AnimatedValue, LegacyColor, LengthValue, TransformOp, ValueRange } from '../packages/layout/src/rt-interpolate.ts';
import { interpolateValue, legacyColorFromCss, lengthPercent, lengthPx, rotateOp, scaleOp, serializeValue, TRANSPARENT, translateOp, ZERO_PX } from '../packages/layout/src/rt-interpolate.ts';
import type { RuleKeyframe } from '../packages/layout/src/rt-keyframes.ts';
import { groupFromRule, sampleKeyframeEffect } from '../packages/layout/src/rt-keyframes.ts';
import type { EffectTimingSpec, FillMode, PlaybackDirection, SecondsTiming } from '../packages/layout/src/rt-timing.ts';
import { advanceHeld, computeSecondsTiming, computeTiming, currentTimeAt, HELD_ZERO, seekPaused } from '../packages/layout/src/rt-timing.ts';
import type { ScriptStep } from '../packages/layout/src/rt-transition.ts';
import { runTransitionScript } from '../packages/layout/src/rt-transition.ts';

const ORACLE_DIR = repoPath('packages/layout/rt-oracle');
const VECTOR_DIR = repoPath('packages/layout/rt-vectors');
const BOX_WIDTH = 250.5;
const BOX_HEIGHT = 97.25;
/** Timeline seconds the reference advances before reading a held animation; Chrome's hold records are read three frames later. */
const HOLD_ELAPSED_SECONDS = 0.05;

// ---------------------------------------------------------------------------------------------------------------------
// Derived grids.

type TimingJson = Omit<EffectTimingSpec, 'easing' | 'iterations'> & { readonly iterations: number | 'Infinity'; readonly easing: EasingSpec; readonly css: string };

function linear(): EasingSpec {
  return { kind: 'linear', x1: 0, y1: 0, x2: 0, y2: 0, steps: 0, position: 'end' };
}
function bezier(x1: number, y1: number, x2: number, y2: number): EasingSpec {
  return { kind: 'cubic-bezier', x1, y1, x2, y2, steps: 0, position: 'end' };
}
function steps(n: number, position: StepPosition): EasingSpec {
  return { kind: 'steps', x1: 0, y1: 0, x2: 0, y2: 0, steps: n, position };
}
function easingCss(e: EasingSpec): string {
  if (e.kind === 'linear') return 'linear';
  if (e.kind === 'steps') return `steps(${e.steps}, ${e.position})`;
  return `cubic-bezier(${e.x1}, ${e.y1}, ${e.x2}, ${e.y2})`;
}

/** A deterministic LCG (Numerical Recipes constants), so the seeded control points are the same on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function easings(): { readonly name: string; readonly spec: EasingSpec }[] {
  const out: { name: string; spec: EasingSpec }[] = [];
  out.push({ name: 'linear', spec: linear() });
  out.push({ name: 'ease', spec: bezier(0.25, 0.1, 0.25, 1) });
  out.push({ name: 'ease-in', spec: bezier(0.42, 0, 1, 1) });
  out.push({ name: 'ease-out', spec: bezier(0, 0, 0.58, 1) });
  out.push({ name: 'ease-in-out', spec: bezier(0.42, 0, 0.58, 1) });
  out.push({ name: 'step-start', spec: steps(1, 'start') });
  out.push({ name: 'step-end', spec: steps(1, 'end') });
  // The demo's library transition is written `ease`; the same curve spelled as cubic-bezier.
  out.push({ name: 'demo-ease', spec: bezier(0.25, 0.1, 0.25, 1) });
  const special: readonly (readonly [number, number, number, number])[] = [
    [0, 0, 1, 1], [1, 0, 0, 1], [0, 1, 1, 0], [0.5, -1, 0.5, 2], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0.5, 0, 1], [1, 0, 1, 0.5],
    [0.1, 0.7, 1, 0.1], [0.68, -0.55, 0.265, 1.55], [0.3, -0.8, 0.7, 1.8], [0.01, 0.99, 0.99, 0.01],
  ];
  for (const [a, b, c, d] of special) out.push({ name: `special-${a}-${b}-${c}-${d}`, spec: bezier(a, b, c, d) });
  const rnd = lcg(0x5eed);
  const r3 = (lo: number, hi: number): number => Math.round((lo + (hi - lo) * rnd()) * 1000) / 1000;
  for (let i = 0; i < 24; i++) out.push({ name: `seeded-${i}`, spec: bezier(r3(0, 1), r3(-1.5, 2.5), r3(0, 1), r3(-1.5, 2.5)) });
  const positions: readonly StepPosition[] = ['jump-start', 'jump-end', 'jump-none', 'jump-both', 'start', 'end'];
  for (const n of [1, 2, 3, 5, 10]) for (const p of positions) if (!(p === 'jump-none' && n < 2)) out.push({ name: `steps-${n}-${p}`, spec: steps(n, p) });
  return out;
}

/** Times over one 1000 ms iteration: every 1/64, the step discontinuities of n in {2, 3, 5, 10} and a microsecond around them. */
function easingTimes(): number[] {
  const set = new Set<number>();
  for (let k = -4; k <= 68; k++) set.add((k * 1000) / 64);
  for (const n of [2, 3, 5, 10]) for (let k = 0; k <= n; k++) {
    const b = (k * 1000) / n;
    for (const d of [0, -0.001, 0.001, -0.0005, 0.0005]) set.add(b + d);
  }
  for (const t of [0.5, 1, 123.456, 333.3, 500.5, 666.7, 999, 999.9]) set.add(t);
  return [...set].sort((a, b) => a - b);
}

function timingCombos(): TimingJson[] {
  const out: TimingJson[] = [];
  const directions: readonly PlaybackDirection[] = ['normal', 'reverse', 'alternate', 'alternate-reverse'];
  const fills: readonly FillMode[] = ['none', 'forwards', 'backwards', 'both', 'auto'];
  const add = (delayMs: number, endDelayMs: number, durationMs: number, iterations: number | 'Infinity', iterationStart: number, direction: PlaybackDirection, fill: FillMode, easing: EasingSpec): void => {
    out.push({ delayMs, endDelayMs, durationMs, iterations, iterationStart, direction, fill, easing, css: easingCss(easing) });
  };
  for (const delay of [0, 500, -250]) for (const duration of [0, 1000, 333.3]) for (const iterations of [0, 0.5, 1, 2.5, 'Infinity'] as const) for (const direction of directions) for (const fill of fills) add(delay, 0, duration, iterations, 0, direction, fill, linear());
  for (const endDelay of [-200, 300]) for (const iterationStart of [0.25, 1.5]) for (const iterations of [1, 2.5, 3] as const) for (const direction of directions) add(100, endDelay, 400, iterations, iterationStart, direction, 'both', linear());
  // The before flag: steps at the phase boundaries in both directions, with and without fill.
  for (const e of [steps(1, 'start'), steps(3, 'jump-start'), steps(4, 'jump-both'), steps(2, 'end'), steps(3, 'jump-none')]) for (const direction of directions) for (const fill of ['none', 'both'] as const) for (const delay of [0, 200]) add(delay, 0, 500, 2, 0, direction, fill, e);
  for (const e of [bezier(0.25, 0.1, 0.25, 1), bezier(0.68, -0.55, 0.265, 1.55)]) for (const direction of directions) add(0, 0, 1000, 3, 0.5, direction, 'both', e);
  // T014: album-spin, 20 s linear infinite.
  add(0, 0, 20000, 'Infinity', 0, 'normal', 'none', linear());
  return out;
}

/** The held animations: every alternate-direction, fill-both combo at every third of its derived times. */
function holdInputs(): { readonly combo: number; readonly times: number[] }[] {
  return timingCombos()
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.fill === 'both' && c.direction === 'alternate')
    .map(({ c, i }) => ({ combo: i, times: comboTimes(c).filter((_, k) => k % 3 === 0) }));
}

/** Boundary-derived current times for one combo: every phase and iteration edge, a microsecond around each, and midpoints. */
function comboTimes(c: TimingJson): number[] {
  const iterations = c.iterations === 'Infinity' ? Infinity : c.iterations;
  const active = c.durationMs === 0 || iterations === 0 ? 0 : c.durationMs * iterations;
  const end = Math.max(c.delayMs + active + c.endDelayMs, 0);
  const edges = new Set<number>([0, c.delayMs, end]);
  if (Number.isFinite(active)) edges.add(c.delayMs + active);
  for (let k = 1; k <= 4; k++) edges.add(c.delayMs + k * c.durationMs);
  const out = new Set<number>();
  for (const b of edges) for (const d of [-100, -0.002, -0.0005, 0, 0.0005, 0.002, 37]) {
    const t = b + d;
    if (Number.isFinite(t)) out.add(t);
  }
  out.add(-1000);
  out.add(5000);
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------------------------
// Interpolation cases.

type InterpCase = {
  readonly id: string;
  readonly property: string;
  readonly fromCss: string;
  readonly toCss: string;
  readonly from: AnimatedValue;
  readonly to: AnimatedValue;
  readonly effectEasing: EasingSpec;
  /** A keyframe easing on the first keyframe, applied to the effect progress before interpolation. */
  readonly keyframeEasing: EasingSpec;
};

const EMPTY: AnimatedValue = { kind: 'opacity', number: 0, length: ZERO_PX, color: TRANSPARENT, ops: [] };
function opacity(v: number): AnimatedValue {
  return { ...EMPTY, kind: 'opacity', number: v };
}
function length(l: LengthValue): AnimatedValue {
  return { ...EMPTY, kind: 'length', length: l };
}
function angle(deg: number): AnimatedValue {
  return { ...EMPTY, kind: 'angle', number: deg };
}
function color(c: LegacyColor): AnimatedValue {
  return { ...EMPTY, kind: 'color', color: c };
}
function transform(ops: readonly TransformOp[]): AnimatedValue {
  return { ...EMPTY, kind: 'transform', ops };
}

function lengthCss(l: LengthValue): string {
  return l.kind === 'px' ? `${l.px}px` : `${l.percent}%`;
}
function opCss(o: TransformOp): string {
  if (o.fn === 'translate') return `translate(${lengthCss(o.x)}, ${lengthCss(o.y)})`;
  if (o.fn === 'translateX') return `translateX(${lengthCss(o.x)})`;
  if (o.fn === 'translateY') return `translateY(${lengthCss(o.y)})`;
  if (o.fn === 'rotate') return `rotate(${o.angle}deg)`;
  if (o.fn === 'scale') return `scale(${o.sx}, ${o.sy})`;
  if (o.fn === 'scaleX') return `scaleX(${o.sx})`;
  return `scaleY(${o.sy})`;
}
function transformCss(ops: readonly TransformOp[]): string {
  return ops.length === 0 ? 'none' : ops.map(opCss).join(' ');
}

function interpCases(): InterpCase[] {
  const out: InterpCase[] = [];
  const overshoot = bezier(0.3, -0.8, 0.7, 1.8);
  const add = (id: string, property: string, from: AnimatedValue, to: AnimatedValue, fromCss: string, toCss: string, effectEasing: EasingSpec = linear(), keyframeEasing: EasingSpec = linear()): void => {
    out.push({ id, property, fromCss, toCss, from, to, effectEasing, keyframeEasing });
  };
  const withOvershoot = (id: string, property: string, from: AnimatedValue, to: AnimatedValue, fromCss: string, toCss: string): void => {
    add(id, property, from, to, fromCss, toCss);
    add(`${id}~overshoot`, property, from, to, fromCss, toCss, overshoot);
  };
  for (const [a, b] of [[0, 1], [1, 0], [0.2, 0.9], [0.33, 0.77], [0.5, 0.5], [0.123456, 0.654321]] as const) withOvershoot(`opacity ${a} ${b}`, 'opacity', opacity(a), opacity(b), String(a), String(b));
  const dpx = (v: number): LengthValue => ({ kind: 'px', px: v, percent: 0 });
  const dpct = (v: number): LengthValue => ({ kind: 'percent', px: 0, percent: v });
  const lengths: readonly (readonly [LengthValue, LengthValue])[] = [
    [dpx(0), dpx(100)], [dpx(10), dpx(-33.3)], [dpct(0), dpct(100)], [dpct(12.5), dpct(87.5)],
    [dpx(10), dpct(50)], [dpx(0), dpct(50)], [dpct(0), dpx(20)], [dpx(-10), dpct(30)], [dpx(412), dpx(0)],
  ];
  for (const [a, b] of lengths) withOvershoot(`text-indent ${lengthCss(a)} ${lengthCss(b)}`, 'text-indent', length(a), length(b), lengthCss(a), lengthCss(b));
  for (const [a, b] of [[0, 360], [0, 90], [45, -45], [0.00005, 90], [10, 10.03125], [-720, 1080], [0, 0.00005]] as const) withOvershoot(`rotate ${a} ${b}`, 'rotate', angle(a), angle(b), `${a}deg`, `${b}deg`);
  const rgba = (r: number, g: number, b: number, a: number): { readonly c: LegacyColor; readonly css: string } => ({ c: legacyColorFromCss(r, g, b, a), css: a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})` });
  const clear = { c: TRANSPARENT, css: 'transparent' };
  const colors: readonly (readonly [{ readonly c: LegacyColor; readonly css: string }, { readonly c: LegacyColor; readonly css: string }])[] = [
    [clear, rgba(255, 0, 0, 1)], [rgba(0, 0, 255, 1), rgba(255, 255, 0, 1)], [rgba(255, 0, 0, 0.5), rgba(0, 0, 255, 0.25)],
    [rgba(10, 20, 30, 0.3), clear], [rgba(18, 52, 86, 1), rgba(250, 128, 114, 1)], [rgba(0, 128, 0, 0.8), rgba(200, 100, 50, 0.1)],
  ];
  for (const [a, b] of colors) withOvershoot(`color ${a.css} ${b.css}`, 'color', color(a.c), color(b.c), a.css, b.css);
  const pct = lengthPercent;
  const px = lengthPx;
  const lists: readonly (readonly [readonly TransformOp[], readonly TransformOp[]])[] = [
    [[rotateOp(0)], [rotateOp(360)]],
    [[], [scaleOp('scale', 1.08, 1.08)]],
    [[translateOp('translateX', pct(100), ZERO_PX)], [translateOp('translateX', pct(0), ZERO_PX)]],
    [[translateOp('translate', px(10), px(20))], [translateOp('translate', pct(50), px(-30))]],
    [[], [rotateOp(90), translateOp('translate', px(10), ZERO_PX)]],
    [[rotateOp(30), scaleOp('scale', 2, 2)], []],
    [[translateOp('translateX', px(10), ZERO_PX)], [translateOp('translateX', pct(50), ZERO_PX)]],
    [[scaleOp('scale', 1, 1)], [scaleOp('scale', 1.08, 1.08)]],
    [[translateOp('translateX', pct(100), ZERO_PX)], []],
    [[rotateOp(45)], [rotateOp(-45)]],
    [[translateOp('translateY', ZERO_PX, pct(25))], [translateOp('translate', px(10), px(5))]],
    [[rotateOp(0), translateOp('translate', px(0), px(0))], [rotateOp(720), translateOp('translate', pct(10), pct(-10))]],
    [[scaleOp('scaleX', 0.5, 1)], [scaleOp('scaleX', 3, 1)]],
    [[translateOp('translateX', pct(100), ZERO_PX), rotateOp(10)], [translateOp('translateX', pct(0), ZERO_PX)]],
  ];
  for (const [a, b] of lists) withOvershoot(`transform ${transformCss(a)} ${transformCss(b)}`, 'transform', transform(a), transform(b), transformCss(a), transformCss(b));
  // Keyframe easing after an overshooting effect easing: the curve's end gradients extrapolate outside [0, 1].
  for (const k of [bezier(0.25, 0.1, 0.25, 1), bezier(0.42, 0, 1, 1), bezier(0, 0, 0.58, 1), bezier(0, 0.5, 0, 1), bezier(1, 0, 1, 0.5), bezier(0, 0, 1, 1), bezier(1, 1, 1, 1)]) {
    add(`text-indent kf ${easingCss(k)}`, 'text-indent', length(dpx(0)), length(dpx(1000)), '0px', '1000px', overshoot, k);
  }
  return out;
}

function interpTimes(): number[] {
  const set = new Set<number>();
  for (let k = 0; k <= 64; k++) set.add((k * 1000) / 64);
  for (const t of [-100, 123.456, 333.3, 666.7, 999.9, 1100]) set.add(t);
  return [...set].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------------------------
// Chrome capture.

type TimingRecord = { readonly combo: number; readonly timeMs: number; readonly progress: string | null; readonly iteration: string | null };
type EasingRecord = { readonly easing: number; readonly timeMs: number; readonly progress: string | null };
type HoldRecord = { readonly combo: number; readonly timeMs: number; readonly progress: string | null; readonly iteration: string | null };
type InterpRecord = { readonly case: number; readonly timeMs: number; readonly progress: string | null; readonly value: string };

async function capture(): Promise<{ timing: TimingRecord[]; easing: EasingRecord[]; hold: HoldRecord[]; interp: InterpRecord[] }> {
  const browser = await launchChrome(1);
  try {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
    await page.setContent(`<!doctype html><html><head></head><body style="margin:0"><div id="t" style="width:${BOX_WIDTH}px;height:${BOX_HEIGHT}px"></div></body></html>`);
    await page.evaluate(() => {
      const dv = new DataView(new ArrayBuffer(8));
      (globalThis as unknown as { bits: (v: number | null | undefined) => string | null }).bits = (v) => {
        if (v === null || v === undefined) return null;
        dv.setFloat64(0, v);
        return dv.getBigUint64(0).toString(16).padStart(16, '0');
      };
    });
    const combos = timingCombos();
    const tjobs = combos.map((c, i) => ({ i, timing: { delay: c.delayMs, endDelay: c.endDelayMs, duration: c.durationMs, iterations: c.iterations === 'Infinity' ? Infinity : c.iterations, iterationStart: c.iterationStart, direction: c.direction, fill: c.fill, easing: c.css }, times: comboTimes(c) }));
    const timing = await page.evaluate((jobs) => {
      const bits = (globalThis as unknown as { bits: (v: number | null | undefined) => string | null }).bits;
      const el = document.getElementById('t') as HTMLElement;
      const out: { combo: number; timeMs: number; progress: string | null; iteration: string | null }[] = [];
      for (const j of jobs) {
        const eff = new KeyframeEffect(el, null, j.timing as KeyframeEffectOptions);
        const a = new Animation(eff, document.timeline);
        a.pause();
        for (const t of j.times) {
          a.currentTime = t;
          const ct = eff.getComputedTiming();
          out.push({ combo: j.i, timeMs: t, progress: bits(ct.progress), iteration: bits(ct.currentIteration) });
        }
        a.cancel();
      }
      return out;
    }, tjobs);
    const eas = easings();
    const etimes = easingTimes();
    const easing = await page.evaluate(
      ({ list, times }) => {
        const bits = (globalThis as unknown as { bits: (v: number | null | undefined) => string | null }).bits;
        const el = document.getElementById('t') as HTMLElement;
        const out: { easing: number; timeMs: number; progress: string | null }[] = [];
        list.forEach((css, i) => {
          const eff = new KeyframeEffect(el, null, { duration: 1000, fill: 'both', easing: css });
          const a = new Animation(eff, document.timeline);
          a.pause();
          for (const t of times) {
            a.currentTime = t;
            out.push({ easing: i, timeMs: t, progress: bits(eff.getComputedTiming().progress) });
          }
          a.cancel();
        });
        return out;
      },
      { list: eas.map((e) => easingCss(e.spec)), times: etimes },
    );
    // Hold time: paused animations must keep their current time while the timeline advances.
    const holdJobs = holdInputs().map((h) => ({ ...(tjobs[h.combo] as (typeof tjobs)[number]), times: h.times }));
    const hold = await page.evaluate(async (jobs) => {
      const bits = (globalThis as unknown as { bits: (v: number | null | undefined) => string | null }).bits;
      const el = document.getElementById('t') as HTMLElement;
      const held: { combo: number; timeMs: number; eff: KeyframeEffect; a: Animation }[] = [];
      for (const j of jobs) for (const t of j.times) {
        const eff = new KeyframeEffect(el, null, j.timing as KeyframeEffectOptions);
        const a = new Animation(eff, document.timeline);
        a.pause();
        a.currentTime = t;
        held.push({ combo: j.i, timeMs: t, eff, a });
      }
      const t0 = document.timeline.currentTime as number;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      const t1 = document.timeline.currentTime as number;
      if (!(t1 > t0)) throw new Error(`the document timeline did not advance (${t0} to ${t1})`);
      const out = held.map((h) => {
        const ct = h.eff.getComputedTiming();
        return { combo: h.combo, timeMs: h.timeMs, progress: bits(ct.progress), iteration: bits(ct.currentIteration) };
      });
      for (const h of held) h.a.cancel();
      return out;
    }, holdJobs);
    const cases = interpCases();
    const itimes = interpTimes();
    const interp = await page.evaluate(
      ({ list, times }) => {
        const bits = (globalThis as unknown as { bits: (v: number | null | undefined) => string | null }).bits;
        const el = document.getElementById('t') as HTMLElement;
        const out: { case: number; timeMs: number; progress: string | null; value: string }[] = [];
        list.forEach((c, i) => {
          const key = c.property.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
          const a = el.animate([{ [key]: c.from, easing: c.keyframeEasing }, { [key]: c.to }], { duration: 1000, fill: 'both', easing: c.effectEasing });
          a.pause();
          for (const t of times) {
            a.currentTime = t;
            out.push({ case: i, timeMs: t, progress: bits(a.effect?.getComputedTiming().progress), value: getComputedStyle(el).getPropertyValue(c.property) });
          }
          a.cancel();
        });
        return out;
      },
      { list: cases.map((c) => ({ property: c.property, from: c.fromCss, to: c.toCss, effectEasing: easingCss(c.effectEasing), keyframeEasing: easingCss(c.keyframeEasing) })), times: itimes },
    );
    return { timing, easing, hold, interp };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The TS reference over the same inputs.

const TRIG = { sin: Math.sin, cos: Math.cos };

function bitsOf(v: number | null): string | null {
  if (v === null) return null;
  const b = Buffer.alloc(8);
  b.writeDoubleBE(v);
  return b.toString('hex');
}

function specOf(c: TimingJson): EffectTimingSpec {
  return { ...c, iterations: c.iterations === 'Infinity' ? Infinity : c.iterations, easing: easingFromSpec(c.easing) };
}

/** The reference for an animation paused at `timeMs` (timeline time 0) and read `elapsedSeconds` of timeline time later. */
function referenceTiming(c: TimingJson, timeMs: number, elapsedSeconds: number = 0): { progress: string | null; iteration: string | null } {
  const t = computeTiming(specOf(c), currentTimeAt(seekPaused(timeMs, 0, 1), elapsedSeconds, NO_RT_FAULTS), NO_RT_FAULTS);
  return { progress: bitsOf(t.progress), iteration: bitsOf(t.currentIteration) };
}

function referenceInterp(c: InterpCase, timeMs: number): { progress: string | null; value: string } {
  const timing: EffectTimingSpec = { delayMs: 0, endDelayMs: 0, durationMs: 1000, iterations: 1, iterationStart: 0, direction: 'normal', fill: 'both', easing: easingFromSpec(c.effectEasing) };
  const t = computeTiming(timing, currentTimeAt(seekPaused(timeMs, 0, 1), 0, NO_RT_FAULTS), NO_RT_FAULTS);
  const p = t.progress ?? 0;
  const kf = c.keyframeEasing.kind === 'cubic-bezier' ? solveBezier(cubicBezier(c.keyframeEasing.x1, c.keyframeEasing.y1, c.keyframeEasing.x2, c.keyframeEasing.y2), p, NO_RT_FAULTS) : p;
  const v = interpolateValue(c.from, c.to, kf, NO_RT_FAULTS);
  return { progress: bitsOf(t.progress), value: v.refused ? 'refused' : serializeValue(v.value, BOX_WIDTH, BOX_HEIGHT, TRIG) };
}

// ---------------------------------------------------------------------------------------------------------------------
// ANIM-b (T065 R2): CSS transitions, @keyframes and animation lists on held elements. The page's animations run at playback
// rate 0 (CDP Animation.setPlaybackRate before load), so document.timeline stays at 0; a step either changes the element's
// class (one style change event) or sets `currentTime = currentTime + delta` on every running animation of the element. No
// animation is ever paused by script.

type ValueSpec = { readonly v: AnimatedValue; readonly css: string };
type ScriptJson = readonly (readonly ['s', number] | readonly ['a', number])[];
type ListingJson = { readonly mode: 'listed' | 'unlisted' | 'initial'; readonly delay: number; readonly duration: number; readonly easing: EasingSpec };
type TransitionCase = { readonly id: string; readonly property: string; readonly range: ValueRange; readonly states: readonly { readonly value: ValueSpec; readonly listing: ListingJson }[]; readonly steps: ScriptJson };
type RuleJson = readonly { readonly offset: number; readonly easing: EasingSpec | null; readonly value: ValueSpec | null }[];
type SecondsJson = { readonly delay: number; readonly duration: number; readonly iterations: number | 'Infinity'; readonly direction: PlaybackDirection; readonly fill: FillMode; readonly easing: EasingSpec };
type KeyframeCase = { readonly id: string; readonly property: string; readonly range: ValueRange; readonly underlying: ValueSpec; readonly rule: RuleJson; readonly timing: SecondsJson; readonly times: readonly number[] };
type EntryJson = { readonly name: string; readonly paused: boolean; readonly timing: SecondsJson };
type AnimationCase = { readonly id: string; readonly property: string; readonly range: ValueRange; readonly rules: readonly { readonly name: string; readonly rule: RuleJson }[]; readonly states: readonly { readonly base: ValueSpec; readonly entries: readonly EntryJson[] }[]; readonly steps: ScriptJson };

const vpx = (n: number): ValueSpec => ({ v: length(lengthPx(n)), css: `${n}px` });
const vop = (n: number): ValueSpec => ({ v: opacity(Math.fround(n)), css: String(n) });
const vrgba = (r: number, g: number, b: number, a: number): ValueSpec => ({ v: color(legacyColorFromCss(r, g, b, a)), css: a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})` });
const VCLEAR: ValueSpec = { v: color(TRANSPARENT), css: 'transparent' };
const EASE = bezier(0.25, 0.1, 0.25, 1);
const OVERSHOOT = bezier(0.5, -1, 0.5, 2);

function listed(duration: number, easing: EasingSpec, delay = 0): ListingJson {
  return { mode: 'listed', delay, duration, easing };
}
const UNLISTED_JSON: ListingJson = { mode: 'unlisted', delay: 0, duration: 0, easing: linear() };
const INITIAL_JSON: ListingJson = { mode: 'initial', delay: 0, duration: 0, easing: linear() };
const adv = (ms: number, n = 1): ScriptJson => Array.from({ length: n }, () => ['a', ms] as const);

function transitionCases(): TransitionCase[] {
  const out: TransitionCase[] = [];
  const two = (id: string, property: string, range: ValueRange, a: ValueSpec, b: ValueSpec, l: ListingJson, steps: ScriptJson): void => {
    out.push({ id, property, range, states: [{ value: a, listing: l }, { value: b, listing: l }], steps });
  };
  const flip = (n: number, ms: number): ScriptJson => Array.from({ length: n }, (_, i) => [['s', (i + 1) % 2] as const, ['a', ms] as const]).flat();
  two('opacity reversal (M5)', 'opacity', 'all', vop(0), vop(1), listed(0.5, EASE), [['s', 1], ['a', 250], ['s', 0], ['a', 100], ['s', 1], ['a', 50], ['s', 0], ['a', 1000], ['s', 1], ...adv(1000 / 60, 3), ['s', 0], ...adv(100, 6)]);
  out.push({ id: 'width interrupt, none, initial (M22, M23)', property: 'min-width', range: 'non-negative', states: [
    { value: vpx(0), listing: listed(1, linear()) }, { value: vpx(200), listing: listed(1, linear()) }, { value: vpx(50), listing: listed(1, linear()) },
    { value: vpx(200), listing: UNLISTED_JSON }, { value: vpx(0), listing: INITIAL_JSON }, { value: vpx(30), listing: INITIAL_JSON },
  ], steps: [['s', 1], ['a', 250], ['s', 2], ['a', 100], ['s', 1], ['a', 300], ['s', 3], ['a', 100], ['s', 0], ['a', 400], ['s', 4], ['a', 100], ['s', 5], ['a', 100], ['s', 1], ['a', 2000]] });
  out.push({ id: 'opacity delays (M19)', property: 'opacity', range: 'all', states: [
    { value: vop(0), listing: listed(1, linear(), 0.5) }, { value: vop(1), listing: listed(1, linear(), 0.5) }, { value: vop(0), listing: listed(1, linear(), -0.5) }, { value: vop(1), listing: listed(1, linear(), -0.5) },
  ], steps: [['s', 1], ['a', 250], ['a', 249], ['a', 1], ['a', 1], ['a', 250], ['s', 0], ['a', 300], ['s', 1], ['a', 2000], ['s', 2], ['a', 100], ['s', 3], ['a', 100], ['s', 2], ['a', 2000]] });
  for (const [prop, range, a, b] of [['min-height', 'non-negative', vpx(2), vpx(50)], ['text-indent', 'all', vpx(2), vpx(50)], ['min-width', 'non-negative', vpx(2), vpx(50)], ['background-color', 'all', vrgba(10, 10, 10, 1), vrgba(250, 250, 250, 1)], ['opacity', 'all', vop(0.2), vop(0.9)]] as const) {
    two(`${prop} overshoot (M26)`, prop, range, a, b, listed(1, OVERSHOOT), [['s', 1], ...adv(50, 6), ['s', 0], ...adv(50, 4), ['s', 1], ...adv(100, 12)]);
  }
  two('color transparent ease', 'background-color', 'all', VCLEAR, vrgba(0, 0, 255, 0.5), listed(0.3, EASE), [['s', 1], ...adv(30, 4), ['s', 0], ...adv(30, 4), ['s', 1], ...adv(100, 4)]);
  for (const p of ['jump-start', 'jump-end', 'jump-none', 'jump-both', 'start', 'end'] as const) {
    const steps4 = steps(4, p);
    two(`min-width steps(4, ${p}) delay`, 'min-width', 'non-negative', vpx(0), vpx(100), listed(1, steps4, 0.2), [['s', 1], ['a', 100], ['a', 99], ['a', 1], ['a', 1], ...[0, 1, 2, 3].flatMap(() => [['a', 248] as const, ['a', 1] as const, ['a', 1] as const]), ['a', 100]]);
  }
  two('min-width step-start negative delay', 'min-width', 'non-negative', vpx(0), vpx(100), listed(1, steps(1, 'start'), -0.25), [['s', 1], ['a', 1], ['a', 500], ['s', 0], ['a', 100], ['a', 1000]]);
  out.push({ id: 'zero duration', property: 'min-width', range: 'non-negative', states: [{ value: vpx(0), listing: listed(0, linear()) }, { value: vpx(100), listing: listed(1, linear()) }, { value: vpx(50), listing: listed(0, linear()) }, { value: vpx(100), listing: listed(0, linear(), -0.5) }], steps: [['s', 1], ['a', 200], ['s', 2], ['a', 100], ['s', 1], ['a', 100], ['s', 3], ['a', 100], ['s', 0], ['a', 100]] });
  two('width reversal chain', 'min-width', 'non-negative', vpx(0), vpx(100), listed(1, EASE), [['s', 1], ['a', 300], ['s', 0], ['a', 100], ['s', 1], ['a', 100], ['s', 0], ['a', 50], ['s', 1], ...adv(250, 6)]);
  two('opacity 60 Hz', 'opacity', 'all', vop(0), vop(1), listed(1, EASE), [['s', 1], ...adv(1000 / 60, 66)]);
  two('opacity 120 Hz flips', 'opacity', 'all', vop(0), vop(1), listed(0.25, EASE), flip(12, 1000 / 120 * 7));
  return out;
}

function keyframeTimes(t: SecondsJson, rule: RuleJson): number[] {
  const set = new Set<number>();
  const durMs = t.duration * 1000;
  const iters = t.iterations === 'Infinity' ? 3 : Math.ceil(t.iterations);
  const delayMs = t.delay * 1000;
  for (let k = -4; k <= 32 * iters + 4; k++) set.add(delayMs + (k * durMs) / 32);
  for (let i = 0; i < iters; i++) for (const kf of rule) for (const d of [-1, 0, 1]) set.add(delayMs + (i + kf.offset) * durMs + d);
  for (const d of [-1, 0, 1]) set.add(d);
  if (t.iterations === 'Infinity') for (const i of [1, 2, 1000]) for (const d of [-1, 0, 1]) set.add(delayMs + i * durMs + d);
  return [...set].filter((x) => x >= -2000).sort((a, b) => a - b);
}

function keyframeCases(): KeyframeCase[] {
  const out: KeyframeCase[] = [];
  const timing = (duration: number, easing: EasingSpec = linear(), extra: Partial<SecondsJson> = {}): SecondsJson => ({ delay: 0, duration, iterations: 1, direction: 'normal', fill: 'none', easing, ...extra });
  const add = (id: string, property: string, range: ValueRange, underlying: ValueSpec, rule: RuleJson, t: SecondsJson): void => {
    out.push({ id, property, range, underlying, rule, timing: t, times: keyframeTimes(t, rule) });
  };
  const kf = (offset: number, value: ValueSpec | null, easing: EasingSpec | null = null): RuleJson[number] => ({ offset, value, easing });
  add('offsets and easings', 'min-width', 'non-negative', vpx(10), [kf(0, vpx(0), bezier(0.42, 0, 1, 1)), kf(0.25, vpx(100), steps(3, 'jump-start')), kf(0.6, vpx(40), OVERSHOOT), kf(1, vpx(200))], timing(1));
  add('partial keyframe (M20)', 'opacity', 'all', vop(0.6), [kf(0.5, vop(0))], timing(1));
  add('from only', 'min-width', 'non-negative', vpx(80), [kf(0, vpx(10))], timing(1, EASE));
  add('to only', 'text-indent', 'all', vpx(-20), [kf(1, vpx(30))], timing(1, OVERSHOOT, { fill: 'both' }));
  add('zero-offset easing from another property', 'min-width', 'non-negative', vpx(10), [kf(0, null, steps(2, 'end')), kf(0.4, vpx(80))], timing(1, bezier(0.42, 0, 0.58, 1)));
  add('colours', 'background-color', 'all', vrgba(1, 2, 3, 1), [kf(0, vrgba(255, 0, 0, 0.5)), kf(0.25, vrgba(0, 128, 0, 0.25)), kf(1, vrgba(0, 0, 255, 1))], timing(1, EASE));
  add('padding overshoot (M26)', 'min-height', 'non-negative', vpx(0), [kf(0, vpx(2)), kf(1, vpx(50))], timing(1, OVERSHOOT));
  add('margin overshoot (M26)', 'text-indent', 'all', vpx(0), [kf(0, vpx(2)), kf(1, vpx(50))], timing(1, OVERSHOOT));
  add('2.5 alternate-reverse fill both', 'min-width', 'non-negative', vpx(5), [kf(0, vpx(0)), kf(1, vpx(100))], timing(0.4, EASE, { iterations: 2.5, direction: 'alternate-reverse', fill: 'both', delay: 0.2 }));
  add('before flag in keyframes', 'min-width', 'non-negative', vpx(5), [kf(0, vpx(0), steps(2, 'jump-start')), kf(1, vpx(100))], timing(1, linear(), { delay: 0.3, fill: 'backwards' }));
  add('duplicate offsets', 'min-width', 'non-negative', vpx(5), [kf(0, vpx(10)), kf(0.5, vpx(50), bezier(0.42, 0, 1, 1)), kf(0, vpx(0)), kf(0.5, vpx(70), steps(2, 'end')), kf(1, vpx(100))], timing(1));
  add('infinite edges', 'background-color', 'all', vrgba(0, 0, 0, 1), [kf(0, vrgba(0, 0, 0, 1)), kf(1, vrgba(200, 100, 50, 1))], timing(1, linear(), { iterations: 'Infinity' }));
  add('negative delay steps', 'min-width', 'non-negative', vpx(5), [kf(0, vpx(0)), kf(1, vpx(100))], timing(1, steps(4, 'jump-both'), { delay: -0.25, fill: 'both', direction: 'reverse' }));
  return out;
}

function entry(name: string, duration: number, extra: Partial<SecondsJson> & { paused?: boolean } = {}): EntryJson {
  const { paused = false, ...t } = extra;
  return { name, paused, timing: { delay: 0, duration, iterations: 'Infinity', direction: 'normal', fill: 'none', easing: linear(), ...t } };
}

function animationCases(): AnimationCase[] {
  const kf = (offset: number, value: ValueSpec): RuleJson[number] => ({ offset, value, easing: null });
  const up = { name: 'up', rule: [kf(0, vpx(0)), kf(1, vpx(100))] };
  const down = { name: 'down', rule: [kf(0, vpx(100)), kf(1, vpx(0))] };
  const mid = { name: 'mid', rule: [kf(0.5, vpx(300))] };
  const spin = { name: 'spin', rule: [kf(0, vpx(0)), kf(1, vpx(1000))] };
  const out: AnimationCase[] = [];
  out.push({ id: 'name change and in-place duration (M15, M17)', property: 'min-width', range: 'non-negative', rules: [up, down], states: [{ base: vpx(5), entries: [entry('up', 1)] }, { base: vpx(5), entries: [entry('down', 1)] }, { base: vpx(5), entries: [entry('up', 4)] }], steps: [['a', 300], ['s', 2], ['a', 100], ['s', 1], ['a', 250], ['s', 0], ['a', 10]] });
  out.push({ id: 'play state (M25)', property: 'min-width', range: 'non-negative', rules: [spin], states: [{ base: vpx(5), entries: [entry('spin', 20, { paused: true })] }, { base: vpx(5), entries: [entry('spin', 20)] }], steps: [['a', 1000], ['s', 1], ['a', 5000], ['s', 0], ['a', 1000], ['s', 1], ['a', 1000], ['s', 0], ['a', 500], ['s', 1], ...adv(1000 / 60, 3)] });
  out.push({ id: 'duplicate names', property: 'min-width', range: 'non-negative', rules: [up, down], states: [{ base: vpx(5), entries: [entry('up', 1), entry('down', 2), entry('up', 3)] }, { base: vpx(5), entries: [entry('down', 2), entry('up', 3)] }], steps: [['a', 400], ['s', 1], ['a', 100], ['s', 0], ['a', 100]] });
  out.push({ id: 'finished, paused and resumed', property: 'min-width', range: 'non-negative', rules: [up], states: [{ base: vpx(5), entries: [entry('up', 1, { iterations: 2, fill: 'both' })] }, { base: vpx(5), entries: [entry('up', 1, { iterations: 2, fill: 'both', paused: true })] }], steps: [['a', 1500], ['a', 600], ['a', 100], ['s', 1], ['a', 100], ['s', 0], ['a', 100]] });
  out.push({ id: 'stacked neutral keyframes', property: 'min-width', range: 'non-negative', rules: [up, mid], states: [{ base: vpx(10), entries: [entry('up', 1), entry('mid', 2)] }, { base: vpx(40), entries: [entry('up', 1), entry('mid', 2)] }], steps: [['a', 250], ['a', 250], ['s', 1], ['a', 250], ['a', 600]] });
  out.push({ id: 'missing keyframes and none', property: 'min-width', range: 'non-negative', rules: [up], states: [{ base: vpx(5), entries: [entry('nosuch', 1), entry('up', 1)] }, { base: vpx(5), entries: [entry('none', 1)] }, { base: vpx(5), entries: [entry('up', 1), entry('nosuch', 1)] }], steps: [['a', 200], ['s', 1], ['a', 100], ['s', 2], ['a', 100], ['s', 0], ['a', 100]] });
  out.push({ id: 'play-state lists', property: 'min-width', range: 'non-negative', rules: [up, down, mid], states: [
    { base: vpx(5), entries: [entry('up', 1, { paused: true }), entry('down', 1), entry('mid', 1, { paused: true })] },
    { base: vpx(5), entries: [entry('up', 1), entry('down', 1), entry('mid', 1)] },
    { base: vpx(5), entries: [entry('up', 1), entry('down', 1, { paused: true }), entry('mid', 1)] },
  ], steps: [['a', 100], ['s', 1], ['a', 100], ['s', 2], ['a', 100], ['s', 0], ['a', 100], ['s', 1], ['a', 100]] });
  return out;
}

/** Delta sequences for the held-time arithmetic: frame grids, odd steps, and exact sums. */
function advanceSequences(): number[][] {
  return [
    Array.from({ length: 120 }, () => 1000 / 60),
    Array.from({ length: 240 }, () => 1000 / 120),
    Array.from({ length: 100 }, () => 16.7),
    Array.from({ length: 100 }, () => 0.1),
    Array.from({ length: 64 }, () => 0.125),
    Array.from({ length: 50 }, () => 1),
    [5000, 1000, ...Array.from({ length: 10 }, () => 1000 / 60), 0.5, 3.3, 1e7 / 3, 1000 / 120, 7, 0.001],
  ];
}

function easingCssOf(e: EasingSpec): string {
  return easingCss(e);
}
function timingCss(t: SecondsJson): string {
  return `${t.duration}s ${easingCssOf(t.easing)} ${t.delay}s ${t.iterations === 'Infinity' ? 'infinite' : t.iterations} ${t.direction} ${t.fill}`;
}
function ruleCss(name: string, property: string, rule: RuleJson): string {
  return `@keyframes ${name}{${rule.map((k) => `${Math.round(k.offset * 100)}%{${k.value === null ? 'opacity:0.5' : `${property}:${k.value.css}`}${k.easing === null ? '' : `;animation-timing-function:${easingCssOf(k.easing)}`}}`).join('')}}`;
}
function listingCss(property: string, l: ListingJson): string {
  if (l.mode === 'initial') return '';
  if (l.mode === 'unlisted') return 'transition:none;';
  return `transition:${property} ${l.duration}s ${easingCssOf(l.easing)} ${l.delay}s;`;
}

type AnimCapture = {
  readonly advance: (string | null)[][];
  readonly keyframes: { readonly case: number; readonly timeMs: number; readonly progress: string | null; readonly value: string }[];
  readonly transitions: { readonly case: number; readonly readings: (readonly [string, string | null])[] }[];
  readonly animations: { readonly case: number; readonly readings: (readonly [readonly string[], readonly (string | null)[], readonly string[], string])[] }[];
};

async function captureAnim(): Promise<AnimCapture> {
  const tcases = transitionCases();
  const kcases = keyframeCases();
  const acases = animationCases();
  const css: string[] = ['@keyframes adv{from{opacity:0}to{opacity:1}}', '.adv{animation:adv 1000s linear infinite}'];
  tcases.forEach((c, i) => c.states.forEach((s, k) => css.push(`.t${i}.s${k}{${c.property}:${s.value.css};${listingCss(c.property, s.listing)}}`)));
  kcases.forEach((c, i) => {
    css.push(ruleCss(`k${i}`, c.property, c.rule));
    css.push(`.k${i}{${c.property}:${c.underlying.css};animation:${timingCss(c.timing)} k${i}}`);
  });
  acases.forEach((c, i) => {
    for (const r of c.rules) css.push(ruleCss(`a${i}-${r.name}`, c.property, r.rule));
    c.states.forEach((s, k) => {
      const list = (f: (e: EntryJson) => string): string => s.entries.map(f).join(', ');
      const t = (e: EntryJson): SecondsJson => e.timing;
      css.push(`.a${i}.s${k}{${c.property}:${s.base.css};animation-name:${list((e) => (e.name === 'none' ? 'none' : `a${i}-${e.name}`))};animation-duration:${list((e) => `${t(e).duration}s`)};animation-timing-function:${list((e) => easingCssOf(t(e).easing))};animation-delay:${list((e) => `${t(e).delay}s`)};animation-iteration-count:${list((e) => (t(e).iterations === 'Infinity' ? 'infinite' : String(t(e).iterations)))};animation-direction:${list((e) => t(e).direction)};animation-fill-mode:${list((e) => t(e).fill)};animation-play-state:${list((e) => (e.paused ? 'paused' : 'running'))}}`);
    });
  });
  const browser = await launchChrome(1);
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
    await page.setContent(`<!doctype html><html><head><style>${css.join('\n')}</style></head><body style="margin:0"></body></html>`);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    return await page.evaluate(
      ({ tjobs, kjobs, ajobs, seqs }) => {
        const dv = new DataView(new ArrayBuffer(8));
        const bits = (v: number | null | undefined): string | null => {
          if (v === null || v === undefined) return null;
          dv.setFloat64(0, v);
          return dv.getBigUint64(0).toString(16).padStart(16, '0');
        };
        const frozen = (): void => {
          if (document.timeline.currentTime !== 0) throw new Error(`document.timeline.currentTime is ${String(document.timeline.currentTime)}, not 0`);
        };
        const make = (cls: string): HTMLElement => {
          const el = document.createElement('div');
          el.className = cls;
          document.body.appendChild(el);
          getComputedStyle(el).width;
          return el;
        };
        const step = (el: HTMLElement, base: string, s: readonly ['s', number] | readonly ['a', number]): void => {
          if (s[0] === 's') el.className = `${base} s${s[1]}`;
          else for (const a of el.getAnimations()) if (a.playState === 'running') a.currentTime = Number(a.currentTime) + s[1];
          frozen();
        };
        const advance = seqs.map((deltas) => {
          const el = make('adv');
          const a = el.getAnimations()[0];
          if (a === undefined) throw new Error('the advance animation did not start');
          const out = deltas.map((d) => {
            a.currentTime = Number(a.currentTime) + d;
            frozen();
            return bits(Number(a.currentTime));
          });
          el.remove();
          return out;
        });
        const keyframes: { case: number; timeMs: number; progress: string | null; value: string }[] = [];
        kjobs.forEach((j, i) => {
          const el = make(`k${i}`);
          const a = el.getAnimations()[0];
          if (a === undefined) throw new Error(`keyframes case ${i} did not start`);
          for (const t of j.times) {
            // A sample whose iteration and fraction equal the previous one is not re-applied (KeyframeEffectModelBase::Sample),
            // so each read first moves to a time with another fraction.
            a.currentTime = j.prime;
            getComputedStyle(el).getPropertyValue(j.property);
            a.currentTime = t;
            frozen();
            keyframes.push({ case: i, timeMs: t, progress: bits(a.effect?.getComputedTiming().progress), value: getComputedStyle(el).getPropertyValue(j.property) });
          }
          el.remove();
        });
        const transitions = tjobs.map((j, i) => {
          const el = make(`t${i} s0`);
          const readings = j.steps.map((s) => {
            step(el, `t${i}`, s);
            const value = getComputedStyle(el).getPropertyValue(j.property);
            const ts = el.getAnimations().filter((a) => a instanceof CSSTransition);
            if (ts.length > 1) throw new Error(`transition case ${i} has ${ts.length} transitions`);
            const t = ts[0];
            return [value, t === undefined ? null : bits(Number(t.effect?.getComputedTiming().duration))] as const;
          });
          el.remove();
          return { case: i, readings };
        });
        const animations = ajobs.map((j, i) => {
          const el = make(`a${i} s0`);
          const readings = j.steps.map((s) => {
            step(el, `a${i}`, s);
            const value = getComputedStyle(el).getPropertyValue(j.property);
            const as = el.getAnimations().filter((a): a is CSSAnimation => a instanceof CSSAnimation);
            return [as.map((a) => a.animationName.replace(`a${i}-`, '')), as.map((a) => bits(Number(a.currentTime))), as.map((a) => a.playState), value] as const;
          });
          el.remove();
          return { case: i, readings };
        });
        return { advance, keyframes, transitions, animations };
      },
      { tjobs: tcases.map((c) => ({ property: c.property, steps: c.steps })), kjobs: kcases.map((c) => ({ property: c.property, times: c.times, prime: (c.timing.delay + c.timing.duration * 0.3712) * 1000 })), ajobs: acases.map((c) => ({ property: c.property, steps: c.steps })), seqs: advanceSequences() },
    );
  } finally {
    await browser.close();
  }
}

// The TS reference on the same scripts.

function easingOf(e: EasingSpec | null): Easing {
  return e === null ? LINEAR : easingFromSpec(e);
}
function secondsOf(t: SecondsJson): SecondsTiming {
  return { delay: t.delay, duration: t.duration, iterations: t.iterations === 'Infinity' ? Infinity : t.iterations, direction: t.direction, fill: t.fill, easing: easingFromSpec(t.easing) };
}
function ruleOf(rule: RuleJson): RuleKeyframe[] {
  return rule.map((k) => ({ offset: k.offset, hasEasing: k.easing !== null, easing: easingOf(k.easing), sets: k.value !== null, value: k.value === null ? EMPTY : k.value.v }));
}
function stepsOf(s: ScriptJson): ScriptStep[] {
  return s.map((x) => (x[0] === 's' ? { kind: 'state', state: x[1], deltaMs: 0 } : { kind: 'advance', state: 0, deltaMs: x[1] }));
}
function serialize(v: AnimatedValue): string {
  return serializeValue(v, BOX_WIDTH, BOX_HEIGHT, TRIG);
}

function referenceAdvance(deltas: readonly number[], faults: RtFaults = NO_RT_FAULTS): (string | null)[] {
  let h = HELD_ZERO;
  return deltas.map((d) => {
    h = advanceHeld(h, d, faults);
    return bitsOf(h.seconds * 1000);
  });
}

function referenceKeyframe(c: KeyframeCase, timeMs: number, faults: RtFaults = NO_RT_FAULTS): { progress: string | null; value: string } {
  const timing = secondsOf(c.timing);
  const t = computeSecondsTiming({ ...timing, easing: LINEAR }, timeMs / 1000, faults);
  const v = sampleKeyframeEffect(timing, timeMs / 1000, groupFromRule(ruleOf(c.rule), timing.easing), c.underlying.v, c.range, faults);
  return { progress: bitsOf(t.progress), value: v === null ? serialize(c.underlying.v) : v.refused ? 'refused' : serialize(v.value) };
}

function referenceTransitions(c: TransitionCase, faults: RtFaults = NO_RT_FAULTS): (readonly [string, string | null])[] {
  const states = c.states.map((s) => ({ value: s.value.v, listing: { mode: s.listing.mode, delay: s.listing.delay, duration: s.listing.duration, easing: easingFromSpec(s.listing.easing) } }));
  return runTransitionScript(states, c.range, stepsOf(c.steps), faults).map((r) => [serialize(r.value), r.durationMs === null ? null : bitsOf(r.durationMs)] as const);
}

function referenceAnimations(c: AnimationCase, faults: RtFaults = NO_RT_FAULTS): (readonly [readonly string[], readonly (string | null)[], readonly string[], string])[] {
  const names = new Set(c.rules.map((r) => r.name));
  const states = c.states.map((s) => ({ base: s.base.v, entries: s.entries.map((e) => ({ name: e.name, hasKeyframes: names.has(e.name), paused: e.paused, timing: secondsOf(e.timing) })) }));
  const rules = c.rules.map((r) => ({ name: r.name, keyframes: ruleOf(r.rule) }));
  return runAnimationScript(states, rules, c.range, stepsOf(c.steps), faults).map((r) => [r.names, r.currentTimesMs.map((t) => bitsOf(t)), r.playStates, serialize(r.value)] as const);
}

function animFiles(cap: AnimCapture | null): Map<string, string> {
  const seqs = advanceSequences();
  const tcases = transitionCases();
  const kcases = keyframeCases();
  const acases = animationCases();
  const files = new Map<string, string>();
  const advance = cap === null ? seqs.map((s) => referenceAdvance(s)) : cap.advance;
  const keyframes = cap === null ? kcases.flatMap((c, i) => c.times.map((t) => ({ case: i, timeMs: t, ...referenceKeyframe(c, t) }))) : cap.keyframes;
  const transitions = cap === null ? tcases.map((c, i) => ({ case: i, readings: referenceTransitions(c) })) : cap.transitions;
  const animations = cap === null ? acases.map((c, i) => ({ case: i, readings: referenceAnimations(c) })) : cap.animations;
  const about = cap === null ? 'The TS rt reference on the ANIM-b oracle inputs (pnpm run rt:oracle). Do not edit.' : 'Captured from Chrome 145.0.7632.6 at playback rate 0 by pnpm run rt:oracle (T065 R2: class changes and currentTime += delta on running animations). Do not edit.';
  files.set('advance.json', json({ about, sequences: seqs, records: advance.map((r, i) => [i, r]) }));
  files.set('keyframes.json', json({ about, box: { width: BOX_WIDTH, height: BOX_HEIGHT }, cases: kcases, records: keyframes.map((r) => [r.case, r.timeMs, r.progress, r.value]) }));
  files.set('transitions.json', json({ about, cases: tcases, records: transitions.map((r) => [r.case, r.readings]) }));
  files.set('animations.json', json({ about, cases: acases, records: animations.map((r) => [r.case, r.readings]) }));
  return files;
}

function compareAnim(cap: AnimCapture): { counts: Record<string, number>; failures: string[] } {
  const failures: string[] = [];
  const counts: Record<string, number> = { advance: 0, keyframes: 0, transitions: 0, animations: 0 };
  const seqs = advanceSequences();
  if (cap.advance.length !== seqs.length) failures.push(`advance: chrome ran ${cap.advance.length} of ${seqs.length} sequences`);
  cap.advance.forEach((got, i) => {
    const want = referenceAdvance(seqs[i] as number[]);
    if (got.length !== want.length) failures.push(`advance ${i}: chrome read ${got.length} of ${want.length} steps`);
    got.forEach((g, k) => {
      counts.advance = (counts.advance ?? 0) + 1;
      if (g !== want[k]) failures.push(`advance ${i} step ${k}: chrome ${g}, reference ${want[k]}`);
    });
  });
  const kcases = keyframeCases();
  const samples = kcases.reduce((n, c) => n + c.times.length, 0);
  if (cap.keyframes.length !== samples) failures.push(`keyframes: chrome read ${cap.keyframes.length} of ${samples} samples`);
  if (cap.transitions.length !== transitionCases().length || cap.animations.length !== animationCases().length) failures.push('chrome ran a different number of transition or animation scripts');
  for (const r of cap.keyframes) {
    counts.keyframes = (counts.keyframes ?? 0) + 1;
    const c = kcases[r.case] as KeyframeCase;
    const ref = referenceKeyframe(c, r.timeMs);
    if (ref.progress !== r.progress || ref.value !== r.value) failures.push(`keyframes ${c.id} t=${r.timeMs}: chrome ${r.progress} ${JSON.stringify(r.value)}, reference ${ref.progress} ${JSON.stringify(ref.value)}`);
  }
  const tcases = transitionCases();
  for (const r of cap.transitions) {
    const c = tcases[r.case] as TransitionCase;
    const want = referenceTransitions(c);
    if (r.readings.length !== want.length) failures.push(`transitions ${c.id}: chrome read ${r.readings.length} of ${want.length} steps`);
    r.readings.forEach((g, k) => {
      counts.transitions = (counts.transitions ?? 0) + 1;
      if (JSON.stringify(g) !== JSON.stringify(want[k])) failures.push(`transitions ${c.id} step ${k}: chrome ${JSON.stringify(g)}, reference ${JSON.stringify(want[k])}`);
    });
  }
  const acases = animationCases();
  for (const r of cap.animations) {
    const c = acases[r.case] as AnimationCase;
    const want = referenceAnimations(c);
    if (r.readings.length !== want.length) failures.push(`animations ${c.id}: chrome read ${r.readings.length} of ${want.length} steps`);
    r.readings.forEach((g, k) => {
      counts.animations = (counts.animations ?? 0) + 1;
      if (JSON.stringify(g) !== JSON.stringify(want[k])) failures.push(`animations ${c.id} step ${k}: chrome ${JSON.stringify(g)}, reference ${JSON.stringify(want[k])}`);
    });
  }
  return { counts, failures };
}

// ---------------------------------------------------------------------------------------------------------------------
// Files.

/** One line per list item; records are arrays in the order the README gives. */
function json(v: { readonly [k: string]: unknown }): string {
  const parts = Object.entries(v).map(([k, x]) => (Array.isArray(x) ? `${JSON.stringify(k)}:[\n${x.map((e) => JSON.stringify(e)).join(',\n')}\n]` : `${JSON.stringify(k)}:${JSON.stringify(x)}`));
  return `{${parts.join(',\n')}}\n`;
}

function oracleFiles(cap: Awaited<ReturnType<typeof capture>>): Map<string, string> {
  const easingList = easings();
  const cases = interpCases();
  const files = new Map<string, string>();
  files.set('README.md', [
    '# rt oracle',
    '',
    'Captured from Chrome 145.0.7632.6 (Playwright 1.58.2) by `pnpm run rt:oracle` (scripts/capture-rt-oracle.ts). Do not edit.',
    '',
    '- `timing.json`: records `[combo, timeMs, progress, iteration]`: `getComputedTiming()` of a paused',
    '  `new Animation(new KeyframeEffect(el, null, timing))` after `currentTime = timeMs`; `progress` and `iteration` are the',
    '  IEEE-754 bits (hex) of `progress` and `currentIteration`, or null.',
    '- `easing.json`: records `[easing, timeMs, progress]`, the same for each timing function over one 1000 ms iteration, `fill: both`.',
    '- `hold.json`: records `[combo, timeMs, progress, iteration]` of animations paused at `timeMs` and read after three animation',
    '  frames: the hold time keeps them in place while the timeline advances.',
    '- `interp.json`: records `[case, timeMs, progress, value]`: `getComputedStyle` of',
    '  `el.animate([{p: from, easing: keyframeEasing}, {p: to}], {duration: 1000, fill: both, easing})` paused at `timeMs`,',
    `  on a ${BOX_WIDTH} x ${BOX_HEIGHT} px block; \`progress\` is the effect progress bits.`,
    '',
  ].join('\n'));
  files.set('timing.json', json({ combos: timingCombos(), records: cap.timing.map((r) => [r.combo, r.timeMs, r.progress, r.iteration]) }));
  files.set('easing.json', json({ easings: easingList, records: cap.easing.map((r) => [r.easing, r.timeMs, r.progress]) }));
  files.set('hold.json', json({ combos: timingCombos(), records: cap.hold.map((r) => [r.combo, r.timeMs, r.progress, r.iteration]) }));
  files.set('interp.json', json({ box: { width: BOX_WIDTH, height: BOX_HEIGHT }, cases, records: cap.interp.map((r) => [r.case, r.timeMs, r.progress, r.value]) }));
  return files;
}

/** The reference's outputs on the oracle's inputs: what the translated Swift and Kotlin must reproduce (ANIM-a2). */
function vectorFiles(): Map<string, string> {
  const combos = timingCombos();
  const timing = combos.flatMap((c, i) => comboTimes(c).map((t) => ({ combo: i, timeMs: t, ...referenceTiming(c, t) })));
  const easingList = easings();
  const easing = easingList.flatMap((e, i) => easingTimes().map((t) => ({ easing: i, timeMs: t, progress: referenceTiming({ delayMs: 0, endDelayMs: 0, durationMs: 1000, iterations: 1, iterationStart: 0, direction: 'normal', fill: 'both', easing: e.spec, css: '' }, t).progress })));
  const cases = interpCases();
  const interp = cases.flatMap((c, i) => interpTimes().map((t) => ({ case: i, timeMs: t, ...referenceInterp(c, t) })));
  const hold = holdInputs().flatMap((h) => h.times.map((t) => ({ combo: h.combo, timeMs: t, ...referenceTiming(combos[h.combo] as TimingJson, t, HOLD_ELAPSED_SECONDS) })));
  const files = new Map<string, string>();
  files.set('README.md', ['# rt vectors', '', 'The TypeScript rt reference (packages/layout/src/rt-*.ts) on the rt oracle inputs, written by `pnpm run rt:oracle`.', 'ANIM-a2 requires the translated Swift and Kotlin to reproduce every record bit for bit and string for string. Do not edit.', '', '`hold.json` records animations paused at `timeMs` at timeline time 0 and read `elapsedSeconds` of timeline time later.', ''].join('\n'));
  files.set('timing.json', json({ combos, records: timing.map((r) => [r.combo, r.timeMs, r.progress, r.iteration]) }));
  files.set('easing.json', json({ easings: easingList, records: easing.map((r) => [r.easing, r.timeMs, r.progress]) }));
  files.set('interp.json', json({ box: { width: BOX_WIDTH, height: BOX_HEIGHT }, cases, records: interp.map((r) => [r.case, r.timeMs, r.progress, r.value]) }));
  files.set('hold.json', json({ elapsedSeconds: HOLD_ELAPSED_SECONDS, combos, records: hold.map((r) => [r.combo, r.timeMs, r.progress, r.iteration]) }));
  return files;
}

function compare(cap: Awaited<ReturnType<typeof capture>>): { counts: Record<string, number>; failures: string[] } {
  const combos = timingCombos();
  const easingList = easings();
  const cases = interpCases();
  const failures: string[] = [];
  const counts: Record<string, number> = { timing: 0, easing: 0, hold: 0, interp: 0 };
  for (const r of cap.timing) {
    counts.timing = (counts.timing ?? 0) + 1;
    const ref = referenceTiming(combos[r.combo] as TimingJson, r.timeMs);
    if (ref.progress !== r.progress || ref.iteration !== r.iteration) failures.push(`timing combo ${r.combo} t=${r.timeMs}: chrome ${r.progress}/${r.iteration}, reference ${ref.progress}/${ref.iteration}`);
  }
  for (const r of cap.hold) {
    counts.hold = (counts.hold ?? 0) + 1;
    const ref = referenceTiming(combos[r.combo] as TimingJson, r.timeMs, HOLD_ELAPSED_SECONDS);
    if (ref.progress !== r.progress || ref.iteration !== r.iteration) failures.push(`hold combo ${r.combo} t=${r.timeMs}: chrome ${r.progress}/${r.iteration}, reference ${ref.progress}/${ref.iteration}`);
  }
  for (const r of cap.easing) {
    counts.easing = (counts.easing ?? 0) + 1;
    const e = easingList[r.easing] as { spec: EasingSpec };
    const ref = referenceTiming({ delayMs: 0, endDelayMs: 0, durationMs: 1000, iterations: 1, iterationStart: 0, direction: 'normal', fill: 'both', easing: e.spec, css: '' }, r.timeMs);
    if (ref.progress !== r.progress) failures.push(`easing ${easingCss(e.spec)} t=${r.timeMs}: chrome ${r.progress}, reference ${ref.progress}`);
  }
  for (const r of cap.interp) {
    counts.interp = (counts.interp ?? 0) + 1;
    const c = cases[r.case] as InterpCase;
    const ref = referenceInterp(c, r.timeMs);
    if (ref.progress !== r.progress || ref.value !== r.value) failures.push(`interp ${c.id} t=${r.timeMs}: chrome ${r.progress} ${JSON.stringify(r.value)}, reference ${ref.progress} ${JSON.stringify(ref.value)}`);
  }
  return { counts, failures };
}

const check = process.argv.includes('--check');
const cap = await capture();
const animCap = await captureAnim();
const oracle = oracleFiles(cap);
const vectors = vectorFiles();
for (const [name, text] of animFiles(animCap)) oracle.set(name, text);
for (const [name, text] of animFiles(null)) vectors.set(name, text);
const { counts, failures } = compare(cap);
const anim = compareAnim(animCap);
failures.push(...anim.failures);
console.log(`rt:oracle samples: timing ${counts.timing}, easing ${counts.easing}, hold ${counts.hold}, interp ${counts.interp} (${timingCombos().length} timing combos, ${easings().length} easings, ${interpCases().length} interpolation cases)`);
console.log(`rt:oracle ANIM-b samples: advance ${anim.counts.advance}, keyframes ${anim.counts.keyframes}, transitions ${anim.counts.transitions}, animations ${anim.counts.animations} (${advanceSequences().length} advance sequences, ${keyframeCases().length} keyframe cases, ${transitionCases().length} transition scripts, ${animationCases().length} animation scripts)`);
if (check) {
  const stale: string[] = [];
  for (const [dir, files] of [[ORACLE_DIR, oracle], [VECTOR_DIR, vectors]] as const) {
    for (const [name, text] of files) {
      let stored = '';
      try {
        stored = readFileSync(join(dir, name), 'utf8');
      } catch {
        stored = '';
      }
      if (stored !== text) stale.push(join(dir, name));
    }
  }
  for (const f of failures.slice(0, 40)) console.log(`FAIL ${f}`);
  for (const s of stale) console.log(`STALE ${s}`);
  console.log(`rt:oracle --check: failed ${failures.length}, stale files ${stale.length}`);
  if (failures.length > 0 || stale.length > 0) process.exitCode = 1;
} else {
  for (const [dir, files] of [[ORACLE_DIR, oracle], [VECTOR_DIR, vectors]] as const) {
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of files) writeFileSync(join(dir, name), text);
  }
  for (const f of failures.slice(0, 40)) console.log(`FAIL ${f}`);
  console.log(`rt:oracle: wrote ${oracle.size} oracle and ${vectors.size} vector files; reference differs from Chrome on ${failures.length}`);
}

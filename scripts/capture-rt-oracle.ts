// pnpm run rt:oracle: captures Chrome 145's web-animations numerics into packages/layout/rt-oracle (getComputedTiming progress
// and currentIteration as IEEE-754 bits, getComputedStyle strings of held element.animate() interpolations) and writes the TS
// reference's outputs for the same inputs to packages/layout/rt-vectors (for the ANIM-a2 Swift and Kotlin equality).
// `-- --check` captures afresh, compares Chrome with the reference bit for bit and string for string and with the stored
// oracle byte for byte, prints the derived sample counts, and exits 1 on any difference.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import type { EasingSpec, StepPosition } from '../packages/layout/src/rt-easing.ts';
import { cubicBezier, easingFromSpec, NO_RT_FAULTS, solveBezier } from '../packages/layout/src/rt-easing.ts';
import type { AnimatedValue, LegacyColor, LengthValue, TransformOp } from '../packages/layout/src/rt-interpolate.ts';
import { interpolateValue, legacyColorFromCss, lengthPercent, lengthPx, rotateOp, scaleOp, serializeValue, TRANSPARENT, translateOp, ZERO_PX } from '../packages/layout/src/rt-interpolate.ts';
import type { EffectTimingSpec, FillMode, PlaybackDirection } from '../packages/layout/src/rt-timing.ts';
import { computeTiming, currentTimeAt, seekPaused } from '../packages/layout/src/rt-timing.ts';

const ORACLE_DIR = repoPath('packages/layout/rt-oracle');
const VECTOR_DIR = repoPath('packages/layout/rt-vectors');
const BOX_WIDTH = 250.5;
const BOX_HEIGHT = 97.25;

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
    const holdJobs = tjobs.filter((j) => combos[j.i]?.fill === 'both' && combos[j.i]?.direction === 'alternate').map((j) => ({ ...j, times: j.times.filter((_, k) => k % 3 === 0) }));
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

function referenceTiming(c: TimingJson, timeMs: number): { progress: string | null; iteration: string | null } {
  const t = computeTiming(specOf(c), currentTimeAt(seekPaused(timeMs, 0, 1), 0, NO_RT_FAULTS), NO_RT_FAULTS);
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
  const files = new Map<string, string>();
  files.set('README.md', ['# rt vectors', '', 'The TypeScript rt reference (packages/layout/src/rt-*.ts) on the rt oracle inputs, written by `pnpm run rt:oracle`.', 'ANIM-a2 requires the translated Swift and Kotlin to reproduce every record bit for bit and string for string. Do not edit.', ''].join('\n'));
  files.set('timing.json', json({ combos, records: timing.map((r) => [r.combo, r.timeMs, r.progress, r.iteration]) }));
  files.set('easing.json', json({ easings: easingList, records: easing.map((r) => [r.easing, r.timeMs, r.progress]) }));
  files.set('interp.json', json({ box: { width: BOX_WIDTH, height: BOX_HEIGHT }, cases, records: interp.map((r) => [r.case, r.timeMs, r.progress, r.value]) }));
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
    const ref = referenceTiming(combos[r.combo] as TimingJson, r.timeMs);
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
const oracle = oracleFiles(cap);
const vectors = vectorFiles();
const { counts, failures } = compare(cap);
console.log(`rt:oracle samples: timing ${counts.timing}, easing ${counts.easing}, hold ${counts.hold}, interp ${counts.interp} (${timingCombos().length} timing combos, ${easings().length} easings, ${interpCases().length} interpolation cases)`);
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

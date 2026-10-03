// The runtime animator (T065 R2, R4, R7, R9, R16): the TypeScript reference of what the generated Swift and Kotlin run. It holds
// one running transition per slot and one animation list per element (R20: records per slot and animation, never per assignment),
// takes one style change event per setter call or script step (R4), moves held times only through advanceHeld (R2), and patches
// the live program: colours into the node writes (with the R9 closure of inheriting and currentcolor writes), lengths into the
// engine input, which the mount lays out again (R16). Endpoints come from the state program's engine input, resolved for the
// environment by the engine's own resolver (R14), and from the animation tables (lower/anim-program.ts).
import type { LayoutBox, LayoutInput, LayoutStyle } from '@dragon/layout';
import { resolveEnvironment, NO_ENGINE_FAULTS, rtAnimations, rtEasing, rtInterpolate, rtTiming, rtTransition } from '@dragon/layout';
import type { AnimProgram, AnimValue, EasingValue, Longhand, NativeProgram, ProgramNode, Rgba8, SlotListing, StateProgram } from 'dragon';
import { animationKind, programAt } from 'dragon';
import type { TextMeasurer } from '@dragon/layout';

export const ANIM_RUNTIME_VERSION = 'dragon.runtime-anim/1';

/** Planted faults of the runtime (T065 §4); the rt ones are rtEasing.RtFaults. */
export type AnimFaults = {
  readonly transitionOnFirstStyle: boolean;
  readonly displayNoneKeepsTransition: boolean;
  readonly inheritedNotPropagated: boolean;
  readonly neutralKeyframeStale: boolean;
};

export const NO_ANIM_FAULTS: AnimFaults = { transitionOnFirstStyle: false, displayNoneKeepsTransition: false, inheritedNotPropagated: false, neutralKeyframeStale: false };

export class AnimRuntimeError extends Error {}

type AnimatedValue = rtInterpolate.AnimatedValue;
const EMPTY: AnimatedValue = { kind: 'opacity', number: 0, length: rtInterpolate.ZERO_PX, color: rtInterpolate.TRANSPARENT, ops: [] };

/** The rt easing of a compiled easing; linear() never reaches here (ANIM-L). */
export function rtEasingOf(e: EasingValue): rtEasing.Easing {
  if (e.kind === 'linear') return rtEasing.LINEAR;
  if (e.kind === 'steps') return rtEasing.stepsEasing(e.steps, e.position);
  if (e.kind === 'cubic-bezier') return rtEasing.cubicBezierEasing(e.x1, e.y1, e.x2, e.y2);
  throw new AnimRuntimeError(`easing ${e.text} reached the runtime`);
}

/** An endpoint as the rt interpolates it; a keyword or unresolved value is not interpolable (null). */
export function rtValueOf(v: AnimValue): AnimatedValue | null {
  if (v.kind === 'color') return { ...EMPTY, kind: 'color', color: rtInterpolate.legacyColor(v.r, v.g, v.b, v.alpha) };
  if (v.kind === 'length') return { ...EMPTY, kind: 'length', length: v.calc ? { kind: 'calc', px: Math.fround(v.px), percent: Math.fround(v.percent) } : v.percent !== 0 ? rtInterpolate.lengthPercent(v.percent) : rtInterpolate.lengthPx(v.px) };
  if (v.kind === 'keyword' && v.value === 'transparent') return { ...EMPTY, kind: 'color', color: rtInterpolate.TRANSPARENT };
  return null;
}

const STYLE_KEY = (p: Longhand): keyof LayoutStyle => p.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) as keyof LayoutStyle;

/** A length engine value as the rt holds it; auto, none and normal are not interpolable (null). */
function lengthOfStyle(v: unknown): AnimatedValue | null {
  const x = v as { kind: string; value?: number; expr?: { kind: string; pixels?: number; percent?: number } };
  if (x.kind === 'px') return { ...EMPTY, kind: 'length', length: rtInterpolate.lengthPx(x.value as number) };
  if (x.kind === 'percent') return { ...EMPTY, kind: 'length', length: rtInterpolate.lengthPercent(x.value as number) };
  if (x.kind === 'calc' && x.expr?.kind === 'pixels-and-percent') return { ...EMPTY, kind: 'length', length: { kind: 'calc', px: x.expr.pixels as number, percent: x.expr.percent as number } };
  return null;
}

/** An interpolated length as an engine value in CSS px; a mixed one is a calc() sum the environment pass resolves. */
function styleOfLength(l: rtInterpolate.LengthValue, range: 'all' | 'non-negative'): unknown {
  if (l.kind === 'px') return { kind: 'px', value: l.px };
  if (l.kind === 'percent') return { kind: 'percent', value: l.percent };
  return { kind: 'calc', expr: { kind: 'sum', terms: [{ kind: 'percent', value: l.percent }, { kind: 'px', value: l.px }] }, range };
}

function findBox(b: LayoutBox, id: string): LayoutBox | null {
  if (b.id === id) return b;
  for (const c of b.children) {
    if (c.kind !== 'box') continue;
    const f = findBox(c, id);
    if (f !== null) return f;
  }
  return null;
}

/** The colour as the device draws it: Chrome's serialised channels and 8-bit alpha (rt-interpolate.ts serializeColor). */
export function rgba8Of(c: rtInterpolate.LegacyColor): Rgba8 {
  const ch = (v: number): number => Math.round(v < 0 ? 0 : v > 255 ? 255 : v);
  const a = Math.floor(Math.fround(c.alpha + Math.fround(1e-7)) * 255 + 0.5);
  return { r: ch(c.r), g: ch(c.g), b: ch(c.b), alpha: a < 0 ? 0 : a > 255 ? 255 : a };
}

const zeroOf = (kind: 'length' | 'color'): AnimatedValue => ({
  kind,
  number: 0,
  length: rtInterpolate.ZERO_PX,
  color: rtInterpolate.TRANSPARENT,
  ops: [],
});

type Track = { readonly node: string; readonly property: Longhand; readonly kind: 'length' | 'color'; readonly range: 'all' | 'non-negative' };

/** One frame's output: the value of every animated (node, property), the strings Chrome's getComputedStyle would show. */
export type AnimFrame = ReadonlyMap<string, AnimatedValue>;

export const trackKey = (node: string, property: string): string => `${node}|${property}`;

/**
 * The TypeScript reference animator over one state program and its animation tables, in one environment (viewport and the
 * measurer the engine resolves fonts with).
 */
export class Animator {
  private readonly sp: StateProgram;
  private readonly ap: AnimProgram;
  private readonly faults: rtEasing.RtFaults;
  private readonly anim: AnimFaults;
  private readonly viewport: { readonly width: number; readonly height: number };
  private readonly measurer: TextMeasurer;
  private current: number;
  private readonly transitions: (rtTransition.RunningTransition | null)[];
  private readonly lists = new Map<string, rtAnimations.RunningAnimation[]>();
  private readonly lengthCache = new Map<number, LayoutInput>();
  /** The last composed animation values, kept while no animation's iteration or fraction changes (rt-animations.ts runAnimationScript). */
  private composed = new Map<string, AnimatedValue>();
  private keys = new Map<string, number[]>();

  constructor(sp: StateProgram, ap: AnimProgram, viewport: { readonly width: number; readonly height: number }, measurer: TextMeasurer, faults: rtEasing.RtFaults = rtEasing.NO_RT_FAULTS, anim: AnimFaults = NO_ANIM_FAULTS) {
    if (ap.assignments.length !== sp.assignments.length) throw new AnimRuntimeError(`the animation tables hold ${ap.assignments.length} assignments, the state program ${sp.assignments.length}`);
    this.sp = sp;
    this.ap = ap;
    this.viewport = viewport;
    this.measurer = measurer;
    this.faults = faults;
    this.anim = anim;
    this.current = sp.initial;
    this.transitions = ap.slots.map(() => null);
    // R7: animations start at first style, so the mounted tree shows their time-0 values.
    for (const a of ap.animations) this.lists.set(a.node, rtAnimations.updateAnimations([], this.entries(a.node, sp.initial), faults));
    this.recompose(true);
  }

  get assignment(): number {
    return this.current;
  }

  private rendered(node: string, i: number): boolean {
    const r = this.ap.rendered.find((x) => x.node === node);
    return r !== undefined && r.values[i] === true;
  }

  private entries(node: string, i: number): rtAnimations.AnimationEntry[] {
    const a = this.ap.animations.find((x) => x.node === node);
    const list = a === undefined || !this.rendered(node, i) ? [] : (a.lists[i] ?? []);
    return list.map((e) => ({ name: e.name, hasKeyframes: e.hasKeyframes, paused: e.paused, timing: { delay: e.delay, duration: e.duration, iterations: e.iterations, direction: e.direction as rtTiming.PlaybackDirection, fill: e.fill as rtTiming.FillMode, easing: rtEasingOf(e.easing) } }));
  }

  /** The engine input of an assignment resolved for the environment in CSS px (R14: the engine's own resolver). */
  private resolvedRoot(i: number): LayoutBox {
    const cached = this.lengthCache.get(i);
    if (cached !== undefined) return cached.root;
    const p = programAt(this.sp, i);
    const v = { width: this.viewport.width, height: this.viewport.height };
    const input: LayoutInput = { viewport: v, devicePixelRatio: 1, viewportUnits: { small: v, large: v, dynamic: v }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: p.rootFontSize, root: p.root };
    const resolved = resolveEnvironment(input, NO_ENGINE_FAULTS, this.measurer);
    this.lengthCache.set(i, resolved);
    return resolved.root;
  }

  /** A track's base value in an assignment: lengths from the resolved engine input, colours from the tables. */
  private base(t: Track, i: number, tableValue: AnimValue | null): AnimatedValue | null {
    if (t.kind === 'length') {
      const box = findBox(this.resolvedRoot(i), t.node);
      if (box === null) return null;
      const v = (box.style as unknown as Record<string, unknown>)[STYLE_KEY(t.property)];
      if (v === undefined) throw new AnimRuntimeError(`the engine input has no ${t.property} on ${t.node}`);
      return lengthOfStyle(v);
    }
    return tableValue === null ? null : rtValueOf(tableValue);
  }

  /** R4: one style change event, the setter having moved the state program from the current assignment to `to`. */
  event(to: number): void {
    const from = this.current;
    this.ap.slots.forEach((s, k) => {
      const shownBefore = this.rendered(s.node, from);
      const shownAfter = this.rendered(s.node, to);
      const running = this.transitions[k] ?? null;
      // R7: display: none cancels the subtree's transitions; an element's first style (new, or shown again) starts none.
      if (!shownAfter) {
        this.transitions[k] = this.anim.displayNoneKeepsTransition ? running : null;
        return;
      }
      // Planted displayNoneKeepsTransition: the transition outlives display: none and resumes when the element is shown again.
      if (!shownBefore && this.anim.displayNoneKeepsTransition && running !== null) return;
      const track: Track = { node: s.node, property: s.property, kind: s.kind, range: s.range };
      const stored = this.base(track, from, s.values[from] ?? null);
      // Planted transitionOnFirstStyle: a first style transitions from a zero value (0px, transparent) as if it had an old style.
      const before = stored === null && !shownBefore && this.anim.transitionOnFirstStyle ? zeroOf(s.kind) : stored;
      const after = this.base(track, to, s.values[to] ?? null);
      const listing = s.listings[to] as SlotListing | null;
      if (after === null || listing === null) {
        this.transitions[k] = null;
        return;
      }
      const smooth = before !== null && before.kind === after.kind;
      this.transitions[k] = rtTransition.updateTransition(running, {
        hasOldStyle: (shownBefore || this.anim.transitionOnFirstStyle) && before !== null,
        oldBase: before ?? after,
        after,
        smooth,
        listing: { mode: listing.mode, delay: listing.delay, duration: listing.duration, easing: rtEasingOf(listing.easing) },
        range: s.range,
      }, this.faults);
    });
    for (const a of this.ap.animations) {
      // R7: an element leaving display: none starts its animations again at time 0 (M7).
      const prev = this.rendered(a.node, from) ? (this.lists.get(a.node) ?? []) : [];
      this.lists.set(a.node, rtAnimations.updateAnimations(prev, this.entries(a.node, to), this.faults));
    }
    this.current = to;
    this.recompose(true);
  }

  /** One lane step (R2): every running, unfinished transition and animation moves by ms. */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new AnimRuntimeError(`advance(${ms}): a step must be a finite, non-negative number of milliseconds`);
    this.transitions.forEach((t, k) => {
      if (t !== null) this.transitions[k] = rtTransition.transitionFinished(t) ? null : rtTransition.advanceTransition(t, ms, this.faults);
    });
    for (const [node, list] of this.lists) this.lists.set(node, list.map((a) => rtAnimations.advanceAnimation(a, ms, this.faults)));
    this.recompose(false);
  }

  /** The iteration and fraction of every animation of a node (what KeyframeEffectModelBase::Sample compares). */
  private sampleKeys(list: readonly rtAnimations.RunningAnimation[]): number[] {
    return list.flatMap((a) => {
      const t = rtTiming.computeSecondsTiming(a.timing, a.held.seconds, this.faults);
      return [t.currentIteration ?? Number.NaN, t.progress ?? Number.NaN];
    });
  }

  private recompose(afterEvent: boolean): void {
    const next = new Map<string, AnimatedValue>();
    const nextKeys = new Map<string, number[]>();
    for (const b of this.ap.bases) {
      const list = this.lists.get(b.node) ?? [];
      const k = this.sampleKeys(list);
      nextKeys.set(b.node, k);
      const old = this.keys.get(b.node);
      const prior = this.composed.get(trackKey(b.node, b.property));
      const unchanged = !afterEvent && old !== undefined && old.length === k.length && old.every((x, i) => Object.is(x, k[i]));
      if (unchanged && prior !== undefined) {
        next.set(trackKey(b.node, b.property), prior);
        continue;
      }
      const ak = animationKind(b.property);
      if (ak.kind !== 'color' && ak.kind !== 'length') throw new AnimRuntimeError(`${b.property} has no animation writer`);
      const kind = ak.kind;
      const base = this.base({ node: b.node, property: b.property, kind, range: 'all' }, this.neutralAssignment(), b.values[this.neutralAssignment()] ?? null);
      if (list.length === 0) continue;
      const rules = this.ap.keyframes.map((r) => ({
        name: r.name,
        keyframes: r.blocks.flatMap((bl) => bl.offsets.map((offset) => {
          const v = bl.values.find((x) => x.property === b.property);
          return { offset, hasEasing: bl.easing !== null, easing: bl.easing === null ? rtEasing.LINEAR : rtEasingOf(bl.easing), sets: v !== undefined, value: v === undefined ? EMPTY : (rtValueOf(v.value) ?? EMPTY) };
        })),
      }));
      const range = ak.kind === 'length' ? ak.range : 'all';
      // Only animations whose @keyframes set the property take part in its effect stack.
      const setting = new Set(rules.filter((r) => r.keyframes.some((k) => k.sets)).map((r) => r.name));
      // An underlying value that does not interpolate (auto) is read only by a neutral keyframe, which then throws (ANIM-k).
      const v = rtAnimations.composeAnimations(list.filter((a) => setting.has(a.name)), rules, base ?? EMPTY, range, afterEvent, this.faults);
      if (v !== EMPTY) next.set(trackKey(b.node, b.property), v);
    }
    this.composed = next;
    this.keys = nextKeys;
  }

  /** The assignment whose base values neutral keyframes take: the current one (R10), or the initial one (planted neutralKeyframeStale). */
  private neutralAssignment(): number {
    return this.anim.neutralKeyframeStale ? this.sp.initial : this.current;
  }

  /** Every animated (node, property) value now, transitions and animations, in CSS px and legacy colour. */
  frame(): AnimFrame {
    const out = new Map<string, AnimatedValue>();
    this.ap.slots.forEach((s, k) => {
      const t = this.transitions[k];
      if (t === null || t === undefined) return;
      const v = rtTransition.transitionValue(t, s.range, this.faults);
      if (v !== null) out.set(trackKey(s.node, s.property), v);
    });
    for (const [k, v] of this.composed) out.set(k, v);
    return out;
  }

  /** The running records (read only): what the lanes derive their sample times from (T065 R17). */
  records(): { readonly transitions: readonly rtTransition.RunningTransition[]; readonly animations: readonly rtAnimations.RunningAnimation[] } {
    return { transitions: this.transitions.filter((t): t is rtTransition.RunningTransition => t !== null && !rtTransition.transitionFinished(t)), animations: [...this.lists.values()].flat() };
  }

  /** True while a transition runs or an animation is relevant: the display driver runs only then (R3). */
  busy(): boolean {
    return this.transitions.some((t) => t !== null && !rtTransition.transitionFinished(t)) || [...this.lists.values()].some((l) => l.some((a) => !a.paused && !rtAnimations.animationFinished(a)));
  }

  /** The live program with the frame applied (R16): colours into writes with the R9 closure, lengths into the engine input. */
  program(base: NativeProgram): NativeProgram {
    return applyFrame(base, this.frame(), this.ap, this.anim);
  }
}

const SIDES = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];

/**
 * R9: a frame with the closure of its animated colours: each inheriting descendant's colour and currentcolor border side takes its
 * source's value, unless the frame animates it itself. These are the values the program's writes show, and Chrome's computed ones.
 */
export function closureFrame(frame: AnimFrame, ap: AnimProgram, anim: AnimFaults = NO_ANIM_FAULTS): AnimFrame {
  const out = new Map(frame);
  if (anim.inheritedNotPropagated) return out;
  for (const c of ap.closure) {
    const v = frame.get(trackKey(c.source.node, c.source.property));
    if (v === undefined) continue;
    for (const w of c.writes) if (!out.has(trackKey(w.node, w.property))) out.set(trackKey(w.node, w.property), v);
  }
  return out;
}

/** Writes a frame into a program: a new program, the base untouched. */
export function applyFrame(base: NativeProgram, frame: AnimFrame, ap: AnimProgram, anim: AnimFaults = NO_ANIM_FAULTS): NativeProgram {
  if (frame.size === 0) return base;
  const colors = new Map<string, Rgba8>();
  const lengths = new Map<string, { property: Longhand; value: rtInterpolate.LengthValue }[]>();
  for (const [k, v] of closureFrame(frame, ap, anim)) {
    const [node, property] = k.split('|') as [string, Longhand];
    if (v.kind === 'color') colors.set(k, rgba8Of(v.color));
    else if (v.kind === 'length' && frame.has(k)) lengths.set(node, [...(lengths.get(node) ?? []), { property, value: v.length }]);
  }
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
  const patch = (b: LayoutBox): LayoutBox => {
    const ls = lengths.get(b.id);
    const children = b.children.map((c) => (c.kind === 'box' ? patch(c) : c));
    if (ls === undefined) return { ...b, children };
    const style = { ...b.style } as Record<string, unknown>;
    for (const l of ls) {
      const k = animationKind(l.property);
      style[STYLE_KEY(l.property)] = styleOfLength(l.value, k.kind === 'length' ? k.range : 'all');
    }
    return { ...b, style: style as unknown as LayoutStyle, children };
  };
  return { ...base, nodes, root: lengths.size === 0 ? base.root : patch(base.root) };
}

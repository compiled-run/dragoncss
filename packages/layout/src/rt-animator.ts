// The runtime animator of ANIM-b1 (T065 R2, R4, R7, R9, R10, R16): one state program's transitions and CSS animations over
// time, for the TypeScript reference and, translated, for the generated Swift and Kotlin runtimes, so the device and the host
// run one implementation. It holds one running transition per (element, property) slot and one animation list per element
// (R20), takes one style change event per setter call or script step (R4), moves held times only through advanceHeld (R2), and
// gives each frame's values: colours as Chrome draws them, with the R9 closure, and lengths patched into the engine input, which
// the caller lays out again (R16). The compiler's tables are plain data (EasingCode, ValueCode), so a device holds them as
// literals; length endpoints come from the engine input of each assignment, resolved for the environment by the engine's own
// resolver (R14).
import type { CalcExpr, GapValue, InsetValue, LayoutBox, LayoutInput, LayoutStyle, LengthCalc, MarginValue, MaxSizeValue, MinSizeValue, PaddingValue, Percent, Px, ReplacedLeaf, SizeValue, TextLeaf } from './input.ts';
import type { Easing, RtFaults, StepPosition } from './rt-easing.ts';
import { cubicBezierEasing, froundOf, LINEAR, stepsEasing } from './rt-easing.ts';
import type { AnimatedValue, LegacyColor, LengthValue, Rgba8Value, ValueRange } from './rt-interpolate.ts';
import { colorRgba8, intToString, legacyColor, lengthPercent, lengthPx, TRANSPARENT, ZERO_PX } from './rt-interpolate.ts';
import type { AnimationEntry, KeyframesRule, RunningAnimation } from './rt-animations.ts';
import { advanceAnimation, animationFinished, composeAnimations, updateAnimations } from './rt-animations.ts';
import type { RuleKeyframe } from './rt-keyframes.ts';
import type { FillMode, PlaybackDirection } from './rt-timing.ts';
import { computeSecondsTiming } from './rt-timing.ts';
import type { RunningTransition, TransitionListing } from './rt-transition.ts';
import { advanceTransition, transitionFinished, transitionValue, updateTransition } from './rt-transition.ts';

export class AnimatorError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`animator: ${detail}`);
    this.detail = detail;
  }
}

// ---------------------------------------------------------------- the tables (plain data the compiler writes)

export type EasingKind = 'linear' | 'cubic-bezier' | 'steps';

/** A compiled easing: linear, a cubic Bézier through (x1, y1) and (x2, y2), or steps(steps, position). */
export type EasingCode = {
  readonly kind: EasingKind;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly steps: number;
  readonly position: StepPosition;
};

export type ValueKind = 'color' | 'length' | 'none';

/** A compiled endpoint: a colour (channels 0 to 255, alpha 0 to 1), a length (px, %, or their calc() sum), or none. */
export type ValueCode = {
  readonly kind: ValueKind;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
  readonly px: number;
  readonly percent: number;
  readonly calc: boolean;
};

export type ListingMode = 'listed' | 'unlisted' | 'initial';

/** A slot's transition listing in one assignment; present is false where the node is absent. */
export type ListingCode = {
  readonly present: boolean;
  readonly mode: ListingMode;
  readonly delay: number;
  readonly duration: number;
  readonly easing: EasingCode;
};

export type TrackKind = 'length' | 'color';

/** One (element, property) transition slot: per assignment, the colour endpoint (lengths come from the input) and the listing. */
export type SlotTable = {
  readonly node: string;
  readonly property: string;
  readonly kind: TrackKind;
  readonly range: ValueRange;
  readonly values: readonly ValueCode[];
  readonly listings: readonly ListingCode[];
};

/** One entry of an element's animation list with its repeated longhands resolved. */
export type EntryCode = {
  readonly name: string;
  readonly hasKeyframes: boolean;
  readonly paused: boolean;
  readonly delay: number;
  readonly duration: number;
  readonly iterations: number;
  readonly direction: PlaybackDirection;
  readonly fill: FillMode;
  readonly easing: EasingCode;
};

/** An element's animation list per assignment (empty where the node is absent). */
export type AnimationTable = {
  readonly node: string;
  readonly lists: readonly (readonly EntryCode[])[];
};

export type KeyframeValue = { readonly property: string; readonly value: ValueCode };

/** One @keyframes block: its offsets, its own easing if it has one, and the values it sets. */
export type KeyframeBlock = {
  readonly offsets: readonly number[];
  readonly hasEasing: boolean;
  readonly easing: EasingCode;
  readonly values: readonly KeyframeValue[];
};

export type KeyframesTable = { readonly name: string; readonly blocks: readonly KeyframeBlock[] };

/** Whether a node is rendered (present and not under display: none) per assignment. */
export type RenderedTable = { readonly node: string; readonly values: readonly boolean[] };

/** A property an animation's @keyframes set on a node, with its kind and range and its colour endpoint per assignment. */
export type BaseTable = {
  readonly node: string;
  readonly property: string;
  readonly kind: TrackKind;
  readonly range: ValueRange;
  readonly values: readonly ValueCode[];
};

export type TrackRef = { readonly node: string; readonly property: string };

/** R9: an animated colour and the writes it reaches (inheriting descendants' colour, currentcolor border sides). */
export type ClosureTable = { readonly source: TrackRef; readonly writes: readonly TrackRef[] };

export type AnimTables = {
  readonly assignments: number;
  readonly slots: readonly SlotTable[];
  readonly animations: readonly AnimationTable[];
  readonly keyframes: readonly KeyframesTable[];
  readonly rendered: readonly RenderedTable[];
  readonly bases: readonly BaseTable[];
  readonly closure: readonly ClosureTable[];
};

/** Planted faults of the runtime (T065 §4); the rt ones are RtFaults. */
export type AnimatorFaults = {
  readonly transitionOnFirstStyle: boolean;
  readonly displayNoneKeepsTransition: boolean;
  readonly inheritedNotPropagated: boolean;
  readonly neutralKeyframeStale: boolean;
};

export const NO_ANIMATOR_FAULTS: AnimatorFaults = { transitionOnFirstStyle: false, displayNoneKeepsTransition: false, inheritedNotPropagated: false, neutralKeyframeStale: false };

// ---------------------------------------------------------------- the state

/** A base's last composed value, kept while no animation's iteration or fraction changes (KeyframeEffectModelBase::Sample). */
export type Composed = { readonly set: boolean; readonly value: AnimatedValue; readonly keys: readonly number[] };

export type AnimatorState = {
  readonly current: number;
  readonly transitions: readonly (RunningTransition | null)[];
  readonly lists: readonly (readonly RunningAnimation[])[];
  readonly composed: readonly Composed[];
};

/** One animated (node, property) value of a frame. */
export type FrameEntry = { readonly node: string; readonly property: string; readonly value: AnimatedValue };

/** One colour write of a frame, as the device draws it. */
export type ColorWrite = { readonly node: string; readonly property: string; readonly rgba: Rgba8Value };

const EMPTY: AnimatedValue = { kind: 'opacity', number: 0, length: ZERO_PX, color: TRANSPARENT, ops: [] };
const NO_COMPOSED: Composed = { set: false, value: EMPTY, keys: [] };

// ---------------------------------------------------------------- conversions

/** The rt easing of a compiled easing. */
export function easingOf(e: EasingCode): Easing {
  if (e.kind === 'steps') return stepsEasing(e.steps, e.position);
  if (e.kind === 'cubic-bezier') return cubicBezierEasing(e.x1, e.y1, e.x2, e.y2);
  return LINEAR;
}

/** An endpoint as the rt interpolates it; none is not interpolable (null). */
export function valueOf(v: ValueCode): AnimatedValue | null {
  if (v.kind === 'color') return { kind: 'color', number: 0, length: ZERO_PX, color: legacyColor(v.r, v.g, v.b, v.alpha), ops: [] };
  if (v.kind === 'length') {
    const l: LengthValue = v.calc ? { kind: 'calc', px: froundOf(v.px), percent: froundOf(v.percent) } : v.percent !== 0 ? lengthPercent(v.percent) : lengthPx(v.px);
    return { kind: 'length', number: 0, length: l, color: TRANSPARENT, ops: [] };
  }
  return null;
}

function zeroOf(kind: TrackKind): AnimatedValue {
  return { kind: kind, number: 0, length: ZERO_PX, color: TRANSPARENT, ops: [] };
}

/** The style of the box or replaced leaf (img, iframe) with an id. */
function findStyle(b: LayoutBox, id: string): LayoutStyle | null {
  if (b.id === id) return b.style;
  for (const c of b.children) {
    if (c.kind === 'replaced' && c.id === id) return c.style;
    if (c.kind !== 'box') continue;
    const f = findStyle(c, id);
    if (f !== null) return f;
  }
  return null;
}

type LengthField = SizeValue | MinSizeValue | MaxSizeValue | MarginValue | PaddingValue | GapValue | InsetValue;

/** The engine value of an admitted length longhand; a property without an animation writer throws. */
function styleLength(s: LayoutStyle, property: string): LengthField {
  if (property === 'top') return s.top;
  if (property === 'right') return s.right;
  if (property === 'bottom') return s.bottom;
  if (property === 'left') return s.left;
  if (property === 'width') return s.width;
  if (property === 'height') return s.height;
  if (property === 'min-width') return s.minWidth;
  if (property === 'min-height') return s.minHeight;
  if (property === 'max-width') return s.maxWidth;
  if (property === 'max-height') return s.maxHeight;
  if (property === 'margin-top') return s.marginTop;
  if (property === 'margin-right') return s.marginRight;
  if (property === 'margin-bottom') return s.marginBottom;
  if (property === 'margin-left') return s.marginLeft;
  if (property === 'padding-top') return s.paddingTop;
  if (property === 'padding-right') return s.paddingRight;
  if (property === 'padding-bottom') return s.paddingBottom;
  if (property === 'padding-left') return s.paddingLeft;
  if (property === 'row-gap') return s.rowGap;
  if (property === 'column-gap') return s.columnGap;
  throw new AnimatorError('the engine input has no length field for ' + property);
}

/** A length engine value as the rt holds it (resolved: px, %, or a pixels-and-percent calc); auto, none and normal are not interpolable (null). */
function lengthOfField(v: LengthField): AnimatedValue | null {
  if (v.kind === 'px') return { kind: 'length', number: 0, length: lengthPx(v.value), color: TRANSPARENT, ops: [] };
  if (v.kind === 'percent') return { kind: 'length', number: 0, length: lengthPercent(v.value), color: TRANSPARENT, ops: [] };
  if (v.kind === 'calc') {
    const e = v.expr;
    if (e.kind === 'pixels-and-percent') return { kind: 'length', number: 0, length: { kind: 'calc', px: e.pixels, percent: e.percent }, color: TRANSPARENT, ops: [] };
  }
  return null;
}

/** A length endpoint of a node in an assignment: its field in that assignment's resolved engine input, or null when absent. */
export function lengthBase(resolved: LayoutInput, node: string, property: string): AnimatedValue | null {
  const style = findStyle(resolved.root, node);
  if (style === null) return null;
  return lengthOfField(styleLength(style, property));
}

/** Whether a node is rendered in an assignment; the tables list every node of every assignment, so a missing one is corrupt tables. */
function rendered(t: AnimTables, node: string, i: number): boolean {
  for (const r of t.rendered) {
    if (r.node !== node) continue;
    const v = r.values[i];
    if (v === undefined) throw new AnimatorError('the rendered table of ' + node + ' has no assignment ' + intToString(i));
    return v;
  }
  throw new AnimatorError('the rendered table has no node ' + node);
}

function baseValue(kind: TrackKind, node: string, property: string, i: number, code: ValueCode | undefined, inputs: readonly LayoutInput[]): AnimatedValue | null {
  if (kind === 'length') {
    const input = inputs[i];
    if (input === undefined) throw new AnimatorError('no resolved engine input for assignment ' + intToString(i));
    return lengthBase(input, node, property);
  }
  if (code === undefined) return null;
  return valueOf(code);
}

function entriesOf(t: AnimTables, a: AnimationTable, i: number): AnimationEntry[] {
  const list = a.lists[i];
  if (list === undefined || !rendered(t, a.node, i)) return [];
  return list.map((e): AnimationEntry => ({ name: e.name, hasKeyframes: e.hasKeyframes, paused: e.paused, timing: { delay: e.delay, duration: e.duration, iterations: e.iterations, direction: e.direction, fill: e.fill, easing: easingOf(e.easing) } }));
}

function listingOf(l: ListingCode): TransitionListing {
  return { mode: l.mode, delay: l.delay, duration: l.duration, easing: easingOf(l.easing) };
}

/** The @keyframes rules as one property sees them: each block's offsets, easing and whether it sets the property. */
function rulesFor(t: AnimTables, property: string): KeyframesRule[] {
  return t.keyframes.map((r): KeyframesRule => {
    const keyframes: RuleKeyframe[] = [];
    for (const bl of r.blocks) {
      let sets = false;
      let value = EMPTY;
      for (const v of bl.values) {
        if (v.property !== property) continue;
        sets = true;
        const x = valueOf(v.value);
        value = x === null ? EMPTY : x;
      }
      for (const offset of bl.offsets) keyframes.push({ offset: offset, hasEasing: bl.hasEasing, easing: bl.hasEasing ? easingOf(bl.easing) : LINEAR, sets: sets, value: value });
    }
    return { name: r.name, keyframes: keyframes };
  });
}

/** Only animations whose @keyframes set the property take part in its effect stack. */
function ruleSetsByName(rules: readonly KeyframesRule[], name: string): boolean {
  for (const r of rules) {
    if (r.name !== name) continue;
    for (const k of r.keyframes) if (k.sets) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the animator

/** The iteration and fraction of every animation of a list (what KeyframeEffectModelBase::Sample compares). */
function sampleKeys(list: readonly RunningAnimation[], faults: RtFaults): number[] {
  const out: number[] = [];
  for (const a of list) {
    const c = computeSecondsTiming(a.timing, a.held.seconds, faults);
    out.push(c.currentIteration === null ? 0 / 0 : c.currentIteration);
    out.push(c.progress === null ? 0 / 0 : c.progress);
  }
  return out;
}

/** Equal key lists, NaN equal to NaN (Object.is). */
function sameKeys(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x !== y && !(x !== x && y !== y)) return false;
  }
  return true;
}

function listOfNode(t: AnimTables, lists: readonly (readonly RunningAnimation[])[], node: string): readonly RunningAnimation[] {
  for (let i = 0; i < t.animations.length; i++) {
    const a = t.animations[i];
    if (a !== undefined && a.node === node) {
      const l = lists[i];
      return l === undefined ? [] : l;
    }
  }
  return [];
}

function recompose(s: AnimatorState, t: AnimTables, inputs: readonly LayoutInput[], initial: number, afterEvent: boolean, faults: RtFaults, anim: AnimatorFaults): Composed[] {
  const neutral = anim.neutralKeyframeStale ? initial : s.current;
  return t.bases.map((b, bi): Composed => {
    const list = listOfNode(t, s.lists, b.node);
    const keys = sampleKeys(list, faults);
    const prior = s.composed[bi];
    if (!afterEvent && prior !== undefined && prior.keys.length > 0 && sameKeys(prior.keys, keys)) return { set: prior.set, value: prior.value, keys: keys };
    if (list.length === 0) return { set: false, value: EMPTY, keys: keys };
    const base = baseValue(b.kind, b.node, b.property, neutral, b.values[neutral], inputs);
    const rules = rulesFor(t, b.property);
    const stack = list.filter((a) => ruleSetsByName(rules, a.name));
    const v = composeAnimations(stack, rules, base === null ? EMPTY : base, b.range, afterEvent, faults);
    // An underlying value that does not interpolate (auto) is read only by a neutral keyframe, which then throws (ANIM-k).
    return { set: v.kind !== 'opacity', value: v, keys: keys };
  });
}

/** The animator at an assignment's first style: no transitions, every animation started at time 0 (R7). */
export function animatorStart(t: AnimTables, inputs: readonly LayoutInput[], initial: number, faults: RtFaults, anim: AnimatorFaults): AnimatorState {
  if (inputs.length !== t.assignments) throw new AnimatorError(intToString(inputs.length) + ' resolved engine inputs for ' + intToString(t.assignments) + ' assignments');
  const lists = t.animations.map((a) => updateAnimations([], entriesOf(t, a, initial), faults));
  const none: (RunningTransition | null)[] = [];
  for (let k = 0; k < t.slots.length; k++) none.push(null);
  const s: AnimatorState = { current: initial, transitions: none, lists: lists, composed: t.bases.map(() => NO_COMPOSED) };
  return { current: s.current, transitions: s.transitions, lists: s.lists, composed: recompose(s, t, inputs, initial, true, faults, anim) };
}

function slotEvent(t: AnimTables, sl: SlotTable, running: RunningTransition | null, from: number, to: number, inputs: readonly LayoutInput[], faults: RtFaults, anim: AnimatorFaults): RunningTransition | null {
  const shownBefore = rendered(t, sl.node, from);
  const shownAfter = rendered(t, sl.node, to);
  // R7: display: none cancels the subtree's transitions; an element's first style (new, or shown again) starts none.
  if (!shownAfter) return anim.displayNoneKeepsTransition ? running : null;
  // Planted displayNoneKeepsTransition: the transition outlives display: none and resumes when the element is shown again.
  if (!shownBefore && anim.displayNoneKeepsTransition && running !== null) return running;
  const stored = baseValue(sl.kind, sl.node, sl.property, from, sl.values[from], inputs);
  // Planted transitionOnFirstStyle: a first style transitions from a zero value (0px, transparent) as if it had an old style.
  const before = stored === null && !shownBefore && anim.transitionOnFirstStyle ? zeroOf(sl.kind) : stored;
  const after = baseValue(sl.kind, sl.node, sl.property, to, sl.values[to], inputs);
  const listing = sl.listings[to];
  if (after === null || listing === undefined || !listing.present) return null;
  const smooth = before !== null && before.kind === after.kind;
  const hasOld = (shownBefore || anim.transitionOnFirstStyle) && before !== null;
  return updateTransition(running, { hasOldStyle: hasOld, oldBase: before === null ? after : before, after: after, smooth: smooth, listing: listingOf(listing), range: sl.range }, faults);
}

/** R4: one style change event, the state program having moved from the current assignment to `to`. */
export function animatorEvent(s: AnimatorState, t: AnimTables, inputs: readonly LayoutInput[], initial: number, to: number, faults: RtFaults, anim: AnimatorFaults): AnimatorState {
  if (to < 0 || to >= t.assignments) throw new AnimatorError('no assignment ' + intToString(to) + ' (' + intToString(t.assignments) + ' assignments)');
  const from = s.current;
  if (s.transitions.length !== t.slots.length) throw new AnimatorError(intToString(s.transitions.length) + ' transition records for ' + intToString(t.slots.length) + ' slots');
  const transitions = s.transitions.map((r, k): RunningTransition | null => {
    const sl = t.slots[k];
    if (sl === undefined) throw new AnimatorError('no slot ' + intToString(k));
    return slotEvent(t, sl, r, from, to, inputs, faults, anim);
  });
  // R7: an element leaving display: none starts its animations again at time 0 (M7).
  const lists = t.animations.map((a, i) => {
    const l = s.lists[i];
    const prev = rendered(t, a.node, from) && l !== undefined ? l : [];
    return updateAnimations(prev, entriesOf(t, a, to), faults);
  });
  const next: AnimatorState = { current: to, transitions: transitions, lists: lists, composed: s.composed };
  return { current: to, transitions: transitions, lists: lists, composed: recompose(next, t, inputs, initial, true, faults, anim) };
}

/** One lane or display step (R2): every running, unfinished transition and animation moves by ms. */
export function animatorAdvance(s: AnimatorState, t: AnimTables, inputs: readonly LayoutInput[], initial: number, ms: number, faults: RtFaults, anim: AnimatorFaults): AnimatorState {
  if (!(ms >= 0) || ms === 1 / 0) throw new AnimatorError('advance: a step must be a finite, non-negative number of milliseconds');
  const transitions = s.transitions.map((r) => (r === null ? null : transitionFinished(r) ? null : advanceTransition(r, ms, faults)));
  const lists = s.lists.map((l) => l.map((a) => advanceAnimation(a, ms, faults)));
  const next: AnimatorState = { current: s.current, transitions: transitions, lists: lists, composed: s.composed };
  return { current: s.current, transitions: transitions, lists: lists, composed: recompose(next, t, inputs, initial, false, faults, anim) };
}

/** True while a transition runs or an animation is relevant: the display driver runs only then (R3). */
export function animatorBusy(s: AnimatorState): boolean {
  for (const r of s.transitions) if (r !== null && !transitionFinished(r)) return true;
  for (const l of s.lists) for (const a of l) if (!a.paused && !animationFinished(a)) return true;
  return false;
}

function indexOfEntry(out: readonly FrameEntry[], node: string, property: string): number {
  for (let i = 0; i < out.length; i++) {
    const e = out[i];
    if (e !== undefined && e.node === node && e.property === property) return i;
  }
  return -1;
}

/** Sets an entry: replaced in place when the (node, property) is there, appended otherwise (Map insertion order). */
function setEntry(out: readonly FrameEntry[], e: FrameEntry): FrameEntry[] {
  const i = indexOfEntry(out, e.node, e.property);
  if (i < 0) return [...out, e];
  return out.map((x, j) => (j === i ? e : x));
}

/** Every animated (node, property) value now: transitions, then animations (which win), in CSS px and legacy colour. */
export function animatorFrame(s: AnimatorState, t: AnimTables, faults: RtFaults): FrameEntry[] {
  let out: FrameEntry[] = [];
  let k = 0;
  for (const r of s.transitions) {
    const sl = t.slots[k];
    k++;
    if (sl === undefined || r === null) continue;
    const v = transitionValue(r, sl.range, faults);
    if (v !== null) out = setEntry(out, { node: sl.node, property: sl.property, value: v });
  }
  for (let i = 0; i < t.bases.length; i++) {
    const b = t.bases[i];
    const c = s.composed[i];
    if (b === undefined || c === undefined || !c.set) continue;
    out = setEntry(out, { node: b.node, property: b.property, value: c.value });
  }
  return out;
}

/**
 * R9: a frame with the closure of its animated colours: each inheriting descendant's colour and currentcolor border side takes its
 * source's value, unless the frame animates it itself. These are the values the views show, and Chrome's computed ones.
 */
export function closureFrame(frame: readonly FrameEntry[], t: AnimTables, anim: AnimatorFaults): FrameEntry[] {
  let out: FrameEntry[] = [...frame];
  if (anim.inheritedNotPropagated) return out;
  for (const c of t.closure) {
    const i = indexOfEntry(frame, c.source.node, c.source.property);
    const src = frame[i];
    if (i < 0 || src === undefined) continue;
    for (const w of c.writes) if (indexOfEntry(out, w.node, w.property) < 0) out = [...out, { node: w.node, property: w.property, value: src.value }];
  }
  return out;
}

/** The colour writes of a frame, with its closure, as the device draws them (Chrome's serialised channels and 8-bit alpha). */
export function frameColors(frame: readonly FrameEntry[], t: AnimTables, anim: AnimatorFaults): ColorWrite[] {
  const out: ColorWrite[] = [];
  for (const e of closureFrame(frame, t, anim)) if (e.value.kind === 'color') out.push({ node: e.node, property: e.property, rgba: colorRgba8(e.value.color) });
  return out;
}

/** An interpolated length as an engine value in CSS px; a mixed one is a calc() sum the environment pass resolves. */
function fieldOf(l: LengthValue, range: ValueRange): Px | Percent | LengthCalc {
  if (l.kind === 'px') return { kind: 'px', value: l.px };
  if (l.kind === 'percent') return { kind: 'percent', value: l.percent };
  const terms: CalcExpr[] = [{ kind: 'percent', value: l.percent }, { kind: 'px', value: l.px }];
  return { kind: 'calc', expr: { kind: 'sum', terms: terms }, range: range };
}

function withLength(s: LayoutStyle, property: string, l: LengthValue, range: ValueRange): LayoutStyle {
  const v = fieldOf(l, range);
  if (property === 'top') return { ...s, top: v };
  if (property === 'right') return { ...s, right: v };
  if (property === 'bottom') return { ...s, bottom: v };
  if (property === 'left') return { ...s, left: v };
  if (property === 'width') return { ...s, width: v };
  if (property === 'height') return { ...s, height: v };
  if (property === 'min-width') return { ...s, minWidth: v };
  if (property === 'min-height') return { ...s, minHeight: v };
  if (property === 'max-width') return { ...s, maxWidth: v };
  if (property === 'max-height') return { ...s, maxHeight: v };
  if (property === 'margin-top') return { ...s, marginTop: v };
  if (property === 'margin-right') return { ...s, marginRight: v };
  if (property === 'margin-bottom') return { ...s, marginBottom: v };
  if (property === 'margin-left') return { ...s, marginLeft: v };
  if (property === 'padding-top') return { ...s, paddingTop: v };
  if (property === 'padding-right') return { ...s, paddingRight: v };
  if (property === 'padding-bottom') return { ...s, paddingBottom: v };
  if (property === 'padding-left') return { ...s, paddingLeft: v };
  if (property === 'row-gap') return { ...s, rowGap: v };
  if (property === 'column-gap') return { ...s, columnGap: v };
  throw new AnimatorError('the engine input has no length field for ' + property);
}

function rangeOf(t: AnimTables, node: string, property: string): ValueRange {
  for (const sl of t.slots) if (sl.node === node && sl.property === property) return sl.range;
  for (const b of t.bases) if (b.node === node && b.property === property) return b.range;
  throw new AnimatorError('no table holds ' + node + ' ' + property);
}

function patchStyle(id: string, s: LayoutStyle, frame: readonly FrameEntry[], t: AnimTables): LayoutStyle {
  let style = s;
  for (const e of frame) if (e.node === id && e.value.kind === 'length') style = withLength(style, e.property, e.value.length, rangeOf(t, e.node, e.property));
  return style;
}

/** A replaced leaf (img, iframe) is sized by its style as a box is, so its lengths animate too. */
function patchChild(c: LayoutBox | TextLeaf | ReplacedLeaf, frame: readonly FrameEntry[], t: AnimTables): LayoutBox | TextLeaf | ReplacedLeaf {
  if (c.kind === 'box') return patchBox(c, frame, t);
  if (c.kind === 'replaced') return patchReplaced(c, frame, t);
  return c;
}

function patchReplaced(c: ReplacedLeaf, frame: readonly FrameEntry[], t: AnimTables): ReplacedLeaf {
  return { ...c, style: patchStyle(c.id, c.style, frame, t) };
}

function patchBox(b: LayoutBox, frame: readonly FrameEntry[], t: AnimTables): LayoutBox {
  const children = b.children.map((c) => patchChild(c, frame, t));
  return { ...b, style: patchStyle(b.id, b.style, frame, t), children: children };
}

/** R16: the engine input with the frame's lengths written in (its own entries only: a closure carries colours). */
export function patchInput(input: LayoutInput, frame: readonly FrameEntry[], t: AnimTables): LayoutInput {
  let any = false;
  for (const e of frame) if (e.value.kind === 'length') any = true;
  if (!any) return input;
  return { ...input, root: patchBox(input.root, frame, t) };
}

/** The engine input's root with the frame's lengths written in. */
export function patchRoot(root: LayoutBox, frame: readonly FrameEntry[], t: AnimTables): LayoutBox {
  return patchBox(root, frame, t);
}

/** A colour as the rt holds it, for tests and the TypeScript reference. */
export function colorOf(c: LegacyColor): Rgba8Value {
  return colorRgba8(c);
}

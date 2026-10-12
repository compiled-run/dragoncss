// The interaction runtime of SELD-R2 (notes/T064-seld-r2-spec.md R1, R6, R7, R8, R12, R15): which elements a real pointer, a
// touch, a key or the forced hook puts in :hover, :active, :focus and :focus-visible, and which compiled interaction state of the
// current app assignment that selects. The compiler writes each app assignment's tables (InteractionTables) from its partition
// (packages/dragon analysis/interaction.ts); the device runs these functions, translated, over those tables and the hit test's
// answers, and never matches a selector. A touch tap never hovers (R1); focus and activation follow the Chrome traces (R6, R8):
// mouse focus at press, touch focus at release, a touch the control consumes (the range) changes nothing, and a non-meta key after
// pointer focus turns focus-visible on. The focus-visible rule is implemented from selectors-4 §9.4 and the probes, not ported.

export class InteractionError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`interaction: ${detail}`);
    this.detail = detail;
  }
}

/**
 * One app assignment's interaction tables, per element in preorder (the element order of the partition):
 * - parent: the parent element, -1 for the root;
 * - focusable: a tap, click or key can focus it (R9);
 * - touchConsumesTap: its control consumes a touch, so a tap on it changes no focus (the range, P7);
 * - keyboardInput: pointer focus on it gives focus-visible (an element that may show a virtual keyboard, P6; none compiles yet);
 * - chainOf, activeChainOf: the hover and active dimension values its chain gives;
 * - pointerFocusOf, keyboardFocusOf: the focus dimension value of focus on it without and with focus-visible (-1: not focusable);
 * - forcedHoverOf and the other forced tables: the state forcing that pseudo-class on it alone gives (-1: none).
 * hoverValues, activeValues and focusValues are the dimension sizes, and combos maps each combination to its state (-1: none).
 */
export type InteractionTables = {
  readonly parent: readonly number[];
  readonly focusable: readonly boolean[];
  readonly touchConsumesTap: readonly boolean[];
  readonly keyboardInput: readonly boolean[];
  readonly chainOf: readonly number[];
  readonly activeChainOf: readonly number[];
  readonly pointerFocusOf: readonly number[];
  readonly keyboardFocusOf: readonly number[];
  readonly forcedHoverOf: readonly number[];
  readonly forcedActiveOf: readonly number[];
  readonly forcedFocusOf: readonly number[];
  readonly forcedFocusVisibleOf: readonly number[];
  readonly hoverValues: number;
  readonly activeValues: number;
  readonly focusValues: number;
  readonly combos: readonly number[];
};

export type PressKind = 'none' | 'mouse' | 'touch';
export type ForcedKind = 'none' | 'hover' | 'active' | 'focus' | 'focus-visible';

/**
 * The live interaction of one root. hover, active and focused are element indices (-1: none); the hover and active chains are
 * those elements and their ancestors. keyboard is the "had keyboard event" flag (R8). pointerIn: a hovering pointer is over the
 * view, so a layout change re-hits its last point (P11). exitPending: an Android hover exit waits a frame for a mouse press (R15).
 */
export type InteractionPointer = {
  readonly hover: number;
  readonly active: number;
  readonly focused: number;
  readonly focusVisible: boolean;
  readonly keyboard: boolean;
  readonly pointerIn: boolean;
  readonly pressing: PressKind;
  readonly exitPending: boolean;
  readonly forced: ForcedKind;
  readonly forcedElement: number;
};

/** Planted faults of the interaction runtime (R6, R8, R15); the host trace check and the device traces must catch each one. */
export type InteractionFaults = {
  /** A touch tap leaves a sticky hover chain, the behaviour R1 removes. */
  readonly tapSetsHover: boolean;
  /** The hover chain is the hovered element alone. */
  readonly hoverWithoutAncestors: boolean;
  /** A forced pseudo-class also applies to the forced element's ancestors. */
  readonly forcedSetsAncestors: boolean;
  /** A tap or click focuses the hit element even when it is not focusable. */
  readonly focusOnNonFocusable: boolean;
  /** Pointer focus also sets focus-visible. */
  readonly focusVisibleOnPointer: boolean;
  /** The active chain is the pressed element alone. */
  readonly activeWithoutAncestors: boolean;
  /** Releasing a press keeps the active chain. */
  readonly activeStaysAfterRelease: boolean;
  /** A touch focuses at press, not at release. */
  readonly focusAtTouchPress: boolean;
  /** A tap on a control that consumes touch (the range) still moves focus. */
  readonly rangeTapFocuses: boolean;
  /** A layout change under a stationary hovering pointer keeps the old hover chain. */
  readonly hoverNotRecomputedAfterLayout: boolean;
  /** Android's hover exit before a mouse press clears hover. */
  readonly hoverExitOnPress: boolean;
};

export const NO_INTERACTION_FAULTS: InteractionFaults = {
  tapSetsHover: false,
  hoverWithoutAncestors: false,
  forcedSetsAncestors: false,
  focusOnNonFocusable: false,
  focusVisibleOnPointer: false,
  activeWithoutAncestors: false,
  activeStaysAfterRelease: false,
  focusAtTouchPress: false,
  rangeTapFocuses: false,
  hoverNotRecomputedAfterLayout: false,
  hoverExitOnPress: false,
};

/** The interaction of a root nothing has touched: no hover, press, focus or forced pseudo-class. */
export function interactionStart(): InteractionPointer {
  return { hover: -1, active: -1, focused: -1, focusVisible: false, keyboard: false, pointerIn: false, pressing: 'none', exitPending: false, forced: 'none', forcedElement: -1 };
}

/** Throws unless the tables are consistent: every table one entry per element, every value inside its dimension or state list. */
export function checkInteractionTables(t: InteractionTables, states: number): void {
  const n = t.parent.length;
  if (n === 0) throw new InteractionError('the tables have no element');
  if (t.hoverValues < 1 || t.activeValues < 1 || t.focusValues < 1) throw new InteractionError('every dimension holds at least its none value');
  if (t.combos.length !== t.hoverValues * t.activeValues * t.focusValues) throw new InteractionError(`${t.combos.length} combinations for dimensions ${t.hoverValues} x ${t.activeValues} x ${t.focusValues}`);
  const lengths = [t.focusable.length, t.touchConsumesTap.length, t.keyboardInput.length, t.chainOf.length, t.activeChainOf.length, t.pointerFocusOf.length, t.keyboardFocusOf.length, t.forcedHoverOf.length, t.forcedActiveOf.length, t.forcedFocusOf.length, t.forcedFocusVisibleOf.length];
  for (const l of lengths) if (l !== n) throw new InteractionError(`a table has ${l} entries for ${n} elements`);
  for (let i = 0; i < n; i++) {
    const p = t.parent[i] as number;
    if (i === 0 ? p !== -1 : !(p >= 0 && p < i)) throw new InteractionError(`element ${i} has parent ${p}; the root comes first and parents precede children`);
    inRange(t.chainOf[i] as number, 0, t.hoverValues, `chainOf[${i}]`);
    inRange(t.activeChainOf[i] as number, 0, t.activeValues, `activeChainOf[${i}]`);
    inRange(t.pointerFocusOf[i] as number, 0, t.focusValues, `pointerFocusOf[${i}]`);
    const focusable = t.focusable[i] as boolean;
    inRange(t.keyboardFocusOf[i] as number, focusable ? 0 : -1, focusable ? t.focusValues : 0, `keyboardFocusOf[${i}]`);
    inRange(t.forcedHoverOf[i] as number, -1, states, `forcedHoverOf[${i}]`);
    inRange(t.forcedActiveOf[i] as number, -1, states, `forcedActiveOf[${i}]`);
    inRange(t.forcedFocusOf[i] as number, -1, states, `forcedFocusOf[${i}]`);
    inRange(t.forcedFocusVisibleOf[i] as number, -1, states, `forcedFocusVisibleOf[${i}]`);
  }
  for (let c = 0; c < t.combos.length; c++) inRange(t.combos[c] as number, -1, states, `combos[${c}]`);
  if ((t.combos[0] as number) !== -1) throw new InteractionError('the combination of three none values is the none state');
}

function inRange(v: number, lo: number, hi: number, what: string): void {
  if (!(Number.isInteger(v) && v >= lo && v < hi)) throw new InteractionError(`${what} is ${v}, outside [${lo}, ${hi})`);
}

function element(t: InteractionTables, e: number, what: string): number {
  if (!(Number.isInteger(e) && e >= -1 && e < t.parent.length)) throw new InteractionError(`${what}: no element ${e}`);
  return e;
}

/** The nearest focusable inclusive ancestor of e, which a tap or click focuses, or -1 (focus is cleared). */
export function focusTarget(t: InteractionTables, e: number, faults: InteractionFaults): number {
  if (faults.focusOnNonFocusable) return e;
  for (let x = e; x >= 0; x = t.parent[x] as number) if (t.focusable[x] as boolean) return x;
  return -1;
}

/** Pointer focus on the nearest focusable inclusive ancestor of hit: focus-visible only for keyboard input (R8, P5, P6). */
function pointerFocus(t: InteractionTables, s: InteractionPointer, hit: number, faults: InteractionFaults): InteractionPointer {
  const f = focusTarget(t, hit, faults);
  const visible: boolean = f >= 0 && (faults.focusVisibleOnPointer || (t.keyboardInput[f] as boolean));
  // SetFocused(kMouse) clears the keyboard flag (element.cc:8057-8058, reference).
  return { ...s, focused: f, focusVisible: visible, keyboard: false };
}

/** A hovering pointer (mouse, trackpad, pen hover) moved over hit (-1: over no element): hover is hit's chain (P1, P12). */
export function pointerMoved(t: InteractionTables, s: InteractionPointer, hit: number): InteractionPointer {
  const h = element(t, hit, 'pointerMoved');
  return { ...s, hover: h, pointerIn: h >= 0, exitPending: false };
}

/** The hovering pointer left the view or was hidden: hover is empty (P12). */
export function pointerExited(t: InteractionTables, s: InteractionPointer): InteractionPointer {
  element(t, -1, 'pointerExited');
  return { ...s, hover: -1, pointerIn: false, exitPending: false };
}

/** Android's ACTION_HOVER_EXIT: hover clears at the next frame unless a mouse press arrives first (R15). */
export function hoverExitStarted(t: InteractionTables, s: InteractionPointer): InteractionPointer {
  element(t, -1, 'hoverExitStarted');
  return { ...s, exitPending: true };
}

/** A display frame: a pending hover exit clears hover now (R15). */
export function interactionFrame(t: InteractionTables, s: InteractionPointer): InteractionPointer {
  return s.exitPending ? pointerExited(t, s) : s;
}

/** A mouse button press at hit: hover stays, the active chain is hit's, and focus moves at press (P4, P5). */
export function mousePressed(t: InteractionTables, s: InteractionPointer, hit: number, faults: InteractionFaults): InteractionPointer {
  const h = element(t, hit, 'mousePressed');
  // Android sends a hover exit before a mouse press; Chrome keeps hover during the press, so the press cancels the exit (R15).
  const kept: InteractionPointer = faults.hoverExitOnPress && s.exitPending ? pointerExited(t, s) : { ...s, exitPending: false };
  const focused: InteractionPointer = pointerFocus(t, kept, h, faults);
  return { ...focused, active: h, pressing: 'mouse' };
}

/** The mouse button was released: the active chain clears (P4). */
export function mouseReleased(t: InteractionTables, s: InteractionPointer, faults: InteractionFaults): InteractionPointer {
  element(t, -1, 'mouseReleased');
  return { ...s, active: faults.activeStaysAfterRelease ? s.active : -1, pressing: 'none' };
}

/** A finger, Pencil or stylus touched down at hit: the active chain is hit's; hover and focus do not change (R1, R6). */
export function touchPressed(t: InteractionTables, s: InteractionPointer, hit: number, faults: InteractionFaults): InteractionPointer {
  const h = element(t, hit, 'touchPressed');
  const pressed: InteractionPointer = { ...s, active: h, pressing: 'touch' };
  return faults.focusAtTouchPress ? touchFocus(t, pressed, h, faults) : pressed;
}

/** Tap focus: the nearest focusable inclusive ancestor, unless the hit control consumes the touch (P5, P7). */
function touchFocus(t: InteractionTables, s: InteractionPointer, hit: number, faults: InteractionFaults): InteractionPointer {
  if (hit >= 0 && (t.touchConsumesTap[hit] as boolean) && !faults.rangeTapFocuses) return s;
  return pointerFocus(t, s, hit, faults);
}

/** The touch lifted at hit, a tap: the active chain clears and focus moves at release; a tap never hovers (R1, P5). */
export function touchReleased(t: InteractionTables, s: InteractionPointer, hit: number, faults: InteractionFaults): InteractionPointer {
  const h = element(t, hit, 'touchReleased');
  const released: InteractionPointer = { ...s, active: faults.activeStaysAfterRelease ? s.active : -1, pressing: 'none' };
  const focused: InteractionPointer = faults.focusAtTouchPress ? released : touchFocus(t, released, h, faults);
  return faults.tapSetsHover ? { ...focused, hover: h } : focused;
}

/** The system cancelled the touch: the active chain clears and nothing else changes. */
export function touchCancelled(t: InteractionTables, s: InteractionPointer, faults: InteractionFaults): InteractionPointer {
  element(t, -1, 'touchCancelled');
  return { ...s, active: faults.activeStaysAfterRelease ? s.active : -1, pressing: 'none' };
}

/** A key went down. Any key without ctrl, alt or meta sets the keyboard flag and turns focus-visible on for the focused element (P9). */
export function keyPressed(t: InteractionTables, s: InteractionPointer, modified: boolean): InteractionPointer {
  element(t, -1, 'keyPressed');
  if (modified) return s;
  return { ...s, keyboard: true, focusVisible: s.focused >= 0 };
}

/** Keyboard focus moved to e (sequential navigation, P6e's glue): focus with focus-visible (P8); -1 leaves the document. */
export function keyboardFocused(t: InteractionTables, s: InteractionPointer, e: number): InteractionPointer {
  const f = element(t, e, 'keyboardFocused');
  if (f >= 0 && !(t.focusable[f] as boolean)) throw new InteractionError(`keyboardFocused: element ${f} is not focusable`);
  return { ...s, focused: f, focusVisible: f >= 0, keyboard: true };
}

/**
 * The tables changed (a committed app setter): remap gives each old element its index in the new tables (-1: it left the tree), and
 * an element that left the tree loses hover, press, focus and forcing.
 */
export function remapPointer(t: InteractionTables, s: InteractionPointer, remap: readonly number[]): InteractionPointer {
  const moved: InteractionPointer = { ...s, hover: remapped(t, remap, s.hover), active: remapped(t, remap, s.active), focused: remapped(t, remap, s.focused), forcedElement: remapped(t, remap, s.forcedElement) };
  const focusKept: InteractionPointer = moved.focused >= 0 ? moved : { ...moved, focusVisible: false };
  const pressKept: InteractionPointer = focusKept.active >= 0 ? focusKept : { ...focusKept, pressing: 'none' };
  return pressKept.forcedElement >= 0 ? pressKept : { ...pressKept, forced: 'none' };
}

/** The layout changed with hit the element now under the pointer's last point: a hovering pointer's chain follows it (P11). */
export function layoutChanged(t: InteractionTables, s: InteractionPointer, hit: number, faults: InteractionFaults): InteractionPointer {
  const h = element(t, hit, 'layoutChanged');
  if (!s.pointerIn || faults.hoverNotRecomputedAfterLayout) return s;
  return { ...s, hover: h };
}

function remapped(t: InteractionTables, remap: readonly number[], e: number): number {
  if (e < 0) return -1;
  if (e >= remap.length) throw new InteractionError(`remapPointer: element ${e} has no remap entry`);
  return element(t, remap[e] as number, 'remapPointer');
}

/** CSS.forcePseudoState: exactly e matches kind, and every real interaction is set aside until forcing stops (T047 RT-6(a)). */
export function forcePseudo(t: InteractionTables, s: InteractionPointer, kind: ForcedKind, e: number): InteractionPointer {
  const f = element(t, e, 'forcePseudo');
  if (kind === 'none') return { ...s, forced: 'none', forcedElement: -1 };
  if (f < 0) throw new InteractionError(`forcePseudo: ${kind} needs an element`);
  return { ...s, forced: kind, forcedElement: f };
}

/** Element e and its ancestors, root first: the hover or active chain of e (empty for -1). */
export function chainOf(t: InteractionTables, e: number): number[] {
  let out: number[] = [];
  for (let x = e; x >= 0; x = t.parent[x] as number) out = [x, ...out];
  return out;
}

/** The elements matching :hover, root first. */
export function hoverMatches(t: InteractionTables, s: InteractionPointer, faults: InteractionFaults): number[] {
  if (s.forced !== 'none') return s.forced === 'hover' ? forcedMatches(t, s, faults) : [];
  if (s.hover < 0) return [];
  return faults.hoverWithoutAncestors ? [s.hover] : chainOf(t, s.hover);
}

/** The elements matching :active, root first. */
export function activeMatches(t: InteractionTables, s: InteractionPointer, faults: InteractionFaults): number[] {
  if (s.forced !== 'none') return s.forced === 'active' ? forcedMatches(t, s, faults) : [];
  if (s.active < 0) return [];
  return faults.activeWithoutAncestors ? [s.active] : chainOf(t, s.active);
}

/** The element matching :focus, or -1. */
export function focusMatch(s: InteractionPointer): number {
  if (s.forced !== 'none') return s.forced === 'focus' ? s.forcedElement : -1;
  return s.focused;
}

/** The element matching :focus-visible, or -1. Chrome's forced focus-visible does not force :focus (P10). */
export function focusVisibleMatch(s: InteractionPointer): number {
  if (s.forced !== 'none') return s.forced === 'focus-visible' ? s.forcedElement : -1;
  return s.focusVisible ? s.focused : -1;
}

function forcedMatches(t: InteractionTables, s: InteractionPointer, faults: InteractionFaults): number[] {
  return faults.forcedSetsAncestors ? chainOf(t, s.forcedElement) : [s.forcedElement];
}

/** The combination index of the live interaction: (hover value * active values + active value) * focus values + focus value (R7). */
export function interactionCombo(t: InteractionTables, s: InteractionPointer): number {
  const h = s.hover < 0 ? 0 : (t.chainOf[s.hover] as number);
  const a = s.active < 0 ? 0 : (t.activeChainOf[s.active] as number);
  let f = 0;
  if (s.focused >= 0) f = s.focusVisible ? (t.keyboardFocusOf[s.focused] as number) : (t.pointerFocusOf[s.focused] as number);
  if (f < 0) throw new InteractionError(`element ${s.focused} is focused with focus-visible but is not keyboard focusable`);
  return (h * t.activeValues + a) * t.focusValues + f;
}

/** The interaction state the live interaction selects in the current app assignment: a forced state, or its combination's; -1 is none. */
export function interactionState(t: InteractionTables, s: InteractionPointer): number {
  if (s.forced === 'hover') return t.forcedHoverOf[s.forcedElement] as number;
  if (s.forced === 'active') return t.forcedActiveOf[s.forcedElement] as number;
  if (s.forced === 'focus') return t.forcedFocusOf[s.forcedElement] as number;
  if (s.forced === 'focus-visible') return t.forcedFocusVisibleOf[s.forcedElement] as number;
  return t.combos[interactionCombo(t, s)] as number;
}

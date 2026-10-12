// SELD-R2 PR 3 (notes/T064-seld-r2-spec.md R1, R6, R8, R15): the interaction runtime's rules on synthetic tables, and every plant.
import { describe, expect, it } from 'vitest';
import type { InteractionFaults, InteractionPointer, InteractionTables } from '../src/rt-interaction.ts';
import * as rt from '../src/rt-interaction.ts';

// 0 html > 1 body > 2 div > 3 button > 4 span; 1 body > 5 range input, 6 text input, 7 p (not focusable).
const T: InteractionTables = {
  parent: [-1, 0, 1, 2, 3, 1, 1, 1],
  focusable: [false, false, false, true, false, true, true, false],
  touchConsumesTap: [false, false, false, false, false, true, false, false],
  keyboardInput: [false, false, false, false, false, false, true, false],
  // Hover candidates: 2 (div) and 7 (p); active candidate 3; focus candidates 3, 5, 6, focus-visible candidates 3, 6.
  chainOf: [0, 0, 1, 1, 1, 0, 0, 2],
  activeChainOf: [0, 0, 0, 1, 1, 0, 0, 0],
  pointerFocusOf: [0, 0, 0, 1, 1, 2, 4, 0],
  keyboardFocusOf: [-1, -1, -1, 3, -1, 2, 4, -1],
  forcedHoverOf: [-1, -1, 0, -1, -1, -1, -1, 1],
  forcedActiveOf: [-1, -1, -1, 2, -1, -1, -1, -1],
  forcedFocusOf: [-1, -1, -1, 3, -1, 4, 5, -1],
  forcedFocusVisibleOf: [-1, -1, -1, 6, -1, -1, 5, -1],
  hoverValues: 3,
  activeValues: 2,
  focusValues: 5,
  // Every combination its own state but the none one; states 0..6 above are reused for the forced cases.
  combos: Array.from({ length: 30 }, (_, i) => i - 1),
};
const STATES = 29;
const OK = rt.NO_INTERACTION_FAULTS;
const plant = (name: keyof InteractionFaults): InteractionFaults => ({ ...OK, [name]: true });
const start = (): InteractionPointer => rt.interactionStart();
const matches = (s: InteractionPointer, f: InteractionFaults = OK): [number[], number[], number, number] => [rt.hoverMatches(T, s, f), rt.activeMatches(T, s, f), rt.focusMatch(s), rt.focusVisibleMatch(s)];

describe('rt-interaction (SELD-R2 PR 3)', () => {
  it('accepts consistent tables and refuses inconsistent ones', () => {
    expect(() => rt.checkInteractionTables(T, STATES)).not.toThrow();
    expect(() => rt.checkInteractionTables({ ...T, parent: [-1, 0, 1, 2, 3, 1, 1, 9] }, STATES)).toThrow(/parent/);
    expect(() => rt.checkInteractionTables({ ...T, combos: T.combos.slice(1) }, STATES)).toThrow(/combinations/);
    expect(() => rt.checkInteractionTables({ ...T, keyboardFocusOf: [0, -1, -1, 3, -1, 2, 4, -1] }, STATES)).toThrow(/keyboardFocusOf\[0\]/);
    expect(() => rt.checkInteractionTables({ ...T, combos: [0, ...T.combos.slice(1)] }, STATES)).toThrow(/none state/);
    expect(() => rt.checkInteractionTables(T, 3)).toThrow(/forced|combos/);
  });

  it('a hovering pointer hovers the hit chain and leaving clears it (P1, P12)', () => {
    const s = rt.pointerMoved(T, start(), 4);
    expect(matches(s)).toEqual([[0, 1, 2, 3, 4], [], -1, -1]);
    expect(rt.interactionCombo(T, s)).toBe(1 * 2 * 5);
    expect(matches(rt.pointerExited(T, s))).toEqual([[], [], -1, -1]);
    expect(matches(rt.pointerMoved(T, s, -1))).toEqual([[], [], -1, -1]);
    expect(matches(rt.pointerMoved(T, start(), 4), plant('hoverWithoutAncestors'))).toEqual([[4], [], -1, -1]);
  });

  it('a mouse press activates the chain and focuses the nearest focusable ancestor at press; release clears active (P4, P5)', () => {
    const s = rt.mousePressed(T, rt.pointerMoved(T, start(), 4), 4, OK);
    expect(matches(s)).toEqual([[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], 3, -1]);
    expect(rt.interactionState(T, s)).toBe((1 * 2 + 1) * 5 + 1 - 1);
    expect(matches(rt.mouseReleased(T, s, OK))).toEqual([[0, 1, 2, 3, 4], [], 3, -1]);
    expect(matches(rt.mouseReleased(T, s, plant('activeStaysAfterRelease')))[1]).toEqual([0, 1, 2, 3, 4]);
    expect(matches(rt.mousePressed(T, start(), 4, plant('activeWithoutAncestors')), plant('activeWithoutAncestors'))[1]).toEqual([4]);
    // A press on no focusable element clears focus (P5).
    expect(rt.focusMatch(rt.mousePressed(T, s, 7, OK))).toBe(-1);
    expect(rt.focusMatch(rt.mousePressed(T, s, 7, plant('focusOnNonFocusable')))).toBe(7);
  });

  it('a touch never hovers, focuses at release, and a consuming control changes no focus (R1, P5, P7)', () => {
    const down = rt.touchPressed(T, start(), 4, OK);
    expect(matches(down)).toEqual([[], [0, 1, 2, 3, 4], -1, -1]);
    const up = rt.touchReleased(T, down, 4, OK);
    expect(matches(up)).toEqual([[], [], 3, -1]);
    expect(rt.hoverMatches(T, rt.touchReleased(T, down, 4, plant('tapSetsHover')), OK)).toEqual([0, 1, 2, 3, 4]);
    expect(rt.focusMatch(rt.touchPressed(T, start(), 4, plant('focusAtTouchPress')))).toBe(3);
    const range = rt.touchReleased(T, rt.touchPressed(T, up, 5, OK), 5, OK);
    expect(rt.focusMatch(range)).toBe(3);
    expect(rt.focusMatch(rt.touchReleased(T, rt.touchPressed(T, up, 5, OK), 5, plant('rangeTapFocuses')))).toBe(5);
    expect(matches(rt.touchCancelled(T, down, OK))).toEqual([[], [], -1, -1]);
  });

  it('focus-visible: pointer focus only on keyboard input, a non-meta key turns it on, keyboard focus sets it (R8, P6, P8, P9)', () => {
    const clicked = rt.mouseReleased(T, rt.mousePressed(T, start(), 3, OK), OK);
    expect(rt.focusVisibleMatch(clicked)).toBe(-1);
    expect(rt.focusVisibleMatch(rt.mousePressed(T, start(), 3, plant('focusVisibleOnPointer')))).toBe(3);
    expect(rt.focusVisibleMatch(rt.mousePressed(T, start(), 6, OK))).toBe(6);
    expect(rt.focusVisibleMatch(rt.keyPressed(T, clicked, true))).toBe(-1);
    const keyed = rt.keyPressed(T, clicked, false);
    expect(rt.focusVisibleMatch(keyed)).toBe(3);
    expect(rt.interactionCombo(T, keyed)).toBe(3);
    // Pointer focus clears the keyboard flag (element.cc:8057-8058, reference).
    expect(rt.mousePressed(T, keyed, 3, OK).keyboard).toBe(false);
    expect(rt.focusVisibleMatch(rt.keyboardFocused(T, start(), 5))).toBe(5);
    expect(() => rt.keyboardFocused(T, start(), 7)).toThrow(/not focusable/);
  });

  it('Android hover exit waits a frame and a mouse press cancels it (R15)', () => {
    const hovered = rt.pointerMoved(T, start(), 2);
    const pressed = rt.mousePressed(T, rt.hoverExitStarted(T, hovered), 2, OK);
    expect(rt.hoverMatches(T, rt.interactionFrame(T, pressed), OK)).toEqual([0, 1, 2]);
    expect(rt.hoverMatches(T, rt.interactionFrame(T, rt.hoverExitStarted(T, hovered)), OK)).toEqual([]);
    expect(rt.hoverMatches(T, rt.mousePressed(T, rt.hoverExitStarted(T, hovered), 2, plant('hoverExitOnPress')), OK)).toEqual([]);
  });

  it('a layout change re-hits a hovering pointer and a remap drops elements that left (P11)', () => {
    const hovered = rt.pointerMoved(T, start(), 2);
    expect(rt.hoverMatches(T, rt.layoutChanged(T, hovered, 7, OK), OK)).toEqual([0, 1, 7]);
    expect(rt.hoverMatches(T, rt.layoutChanged(T, hovered, 7, plant('hoverNotRecomputedAfterLayout')), OK)).toEqual([0, 1, 2]);
    expect(rt.hoverMatches(T, rt.layoutChanged(T, rt.touchPressed(T, start(), 2, OK), 7, OK), OK)).toEqual([]);
    const focused = rt.keyPressed(T, rt.mousePressed(T, hovered, 3, OK), false);
    const moved = rt.remapPointer(T, focused, [0, 1, -1, -1, -1, 5, 6, 7]);
    expect(matches(moved)).toEqual([[], [], -1, -1]);
    expect(moved.pressing).toBe('none');
    expect(() => rt.remapPointer(T, focused, [0, 1])).toThrow(/remap entry/);
  });

  it('a forced pseudo-class applies to exactly its element and sets real interaction aside (T047 RT-6(a))', () => {
    const real = rt.mousePressed(T, rt.pointerMoved(T, start(), 4), 4, OK);
    const forced = rt.forcePseudo(T, real, 'hover', 7);
    expect(matches(forced)).toEqual([[7], [], -1, -1]);
    expect(rt.interactionState(T, forced)).toBe(1);
    expect(rt.hoverMatches(T, forced, plant('forcedSetsAncestors'))).toEqual([0, 1, 7]);
    expect(rt.interactionState(T, rt.forcePseudo(T, real, 'focus-visible', 3))).toBe(6);
    expect(rt.focusMatch(rt.forcePseudo(T, real, 'focus-visible', 3))).toBe(-1);
    expect(matches(rt.forcePseudo(T, forced, 'none', -1))).toEqual(matches(real));
    expect(() => rt.forcePseudo(T, real, 'hover', -1)).toThrow(/needs an element/);
  });

  it('refuses elements outside the tables', () => {
    expect(() => rt.pointerMoved(T, start(), 8)).toThrow(/no element 8/);
    expect(() => rt.mousePressed(T, start(), 1.5, OK)).toThrow(/no element/);
  });
});

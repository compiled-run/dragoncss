// SELD-R2 PR 3 (notes/T064-seld-r2-spec.md R6, R7, R12): the host interaction check over every interaction fixture, and its plants.
import { rtInteraction } from '@dragon/layout';
import type { InteractionFaults } from '@dragon/layout';
import { describe, expect, it } from 'vitest';
import { InteractionRuntime } from '../src/interaction-runtime.ts';
import { BACKEND_OF } from '../src/native-host.ts';
import { checkInteractions, deriveTrace, groupHit, interactionGroups, interactionProgramOf, levelInputs } from '../src/interaction-cases.ts';

const plant = (name: keyof InteractionFaults): InteractionFaults => ({ ...rtInteraction.NO_INTERACTION_FAULTS, [name]: true });

describe('interaction runtime, host check (SELD-R2 PR 3)', () => {
  it('every (app, state) program and every derived trace step equals the compiler and the R6 rules', () => {
    const r = checkInteractions();
    expect(r.failures).toEqual([]);
    expect(interactionGroups().map((g) => g.id)).toEqual(expect.arrayContaining(['interaction-hover', 'interaction-hover-rtl', 'interaction-focus', 'interaction-active', 'interaction-combo']));
    expect(r.programs).toBeGreaterThan(0);
    expect(r.steps).toBeGreaterThan(0);
  }, 600_000);

  // focusVisibleOnPointer, focusAtTouchPress, rangeTapFocuses and hoverNotRecomputedAfterLayout need a focusable element, a range or
  // a hover that moves the hovered box away, which no compiled fixture has before FORM-a; packages/layout/test/rt-interaction.test.ts
  // catches all four on synthetic tables.
  for (const name of ['tapSetsHover', 'hoverWithoutAncestors', 'forcedSetsAncestors', 'focusOnNonFocusable', 'activeWithoutAncestors', 'activeStaysAfterRelease', 'hoverExitOnPress'] as const) {
    it(`catches the ${name} plant`, () => {
      expect(checkInteractions(plant(name)).failures.length).toBeGreaterThan(0);
    }, 600_000);
  }

  it('raises onInteractionChange at most once per step, naming both (app, state) pairs (R16)', () => {
    let total = 0;
    for (const g of interactionGroups()) {
      const backend = BACKEND_OF.ios;
      const inputs = levelInputs(g, backend);
      const ip = interactionProgramOf(g, backend, inputs);
      const rt = new InteractionRuntime(ip, groupHit(g, inputs));
      let events: [number, number, number, number][] = [];
      rt.onInteractionChange = (fromApp, from, toApp, to) => events.push([fromApp, from, toApp, to]);
      for (const s of deriveTrace(g, ip, inputs, backend)) {
        const before: [number, number] = [rt.assignment, rt.state];
        events = [];
        rt.step(s);
        const changed = (rt.assignment !== before[0] || rt.state !== before[1]) && !(before[1] < 0 && rt.state < 0);
        expect(events, `${g.id} ${s.kind}`).toEqual(changed ? [[before[0], before[1], rt.assignment, rt.state]] : []);
        total += events.length;
      }
    }
    expect(total).toBeGreaterThan(2);
  }, 600_000);
});

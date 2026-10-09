// SELD-R2 PR 3 (notes/T064-seld-r2-spec.md R6, R7, R12): the host interaction check over every interaction fixture, and its plants.
import { rtInteraction } from '@dragon/layout';
import type { InteractionFaults } from '@dragon/layout';
import { describe, expect, it } from 'vitest';
import { InteractionRuntime } from 'dragon';
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

  it('raises onInteractionChange once per committed state change, with the old and new state (R16)', () => {
    const g = interactionGroups().find((x) => x.id === 'interaction-hover');
    if (g === undefined) throw new Error('no interaction-hover group');
    const backend = BACKEND_OF.ios;
    const inputs = levelInputs(g, backend);
    const ip = interactionProgramOf(g, backend, inputs);
    const rt = new InteractionRuntime(ip, groupHit(g, inputs));
    const events: [number, number, number][] = [];
    rt.onInteractionChange = (app, from, to) => events.push([app, from, to]);
    const seen: number[] = [rt.state];
    for (const s of deriveTrace(g, ip, inputs, backend)) seen.push(rt.step(s).state);
    const changes = seen.flatMap((x, i) => (i > 0 && x !== seen[i - 1] ? [[ip.program.initial, seen[i - 1] as number, x]] : []));
    expect(changes.length).toBeGreaterThan(2);
    expect(events).toEqual(changes);
  }, 600_000);
});

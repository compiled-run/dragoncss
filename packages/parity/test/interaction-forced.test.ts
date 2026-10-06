// SELD-R2: the forced cases. INTERACTION_FORCED lives outside FixtureSpec, so no existing case or count moves; each forced case
// is one distinct interaction state of one case, forcing what a real pointer, press or focus gives (or the one element of a forced
// state); its committed Chrome reference exists.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectedPath } from '../src/committed.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { INTERACTION_FORCED } from '../src/fixture-groups/interaction.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { forcedCases } from '../src/pipeline.ts';

const spec = (id: string) => {
  const s = FIXTURES.find((f) => f.id === id);
  if (s === undefined) throw new Error(`no fixture ${id}`);
  return s;
};

describe('forced cases', () => {
  it('are only the registry\'s fixtures\', and leave the counted cases as they are', () => {
    expect([...INTERACTION_FORCED]).toEqual(['interaction-hover', 'interaction-focus', 'interaction-active', 'interaction-combo']);
    for (const f of FIXTURES) if (!INTERACTION_FORCED.has(f.id)) expect(forcedCases(f), f.id).toEqual([]);
    expect(casesOf(spec('interaction-hover'), fixtureInput(spec('interaction-hover'))).map((c) => c.id)).toEqual(['interaction-hover', 'interaction-hover-rtl']);
  });

  it('force a hover or active chain on every element of the chain, and a single forced pseudo-class on one element', () => {
    const hover = forcedCases(spec('interaction-hover'));
    expect(hover.map((c) => c.id)).toEqual([0, 1, 2, 3, 4].map((k) => `interaction-hover~ix${k}`).concat([0, 1, 2, 3, 4].map((k) => `interaction-hover~ix${k}-rtl`)));
    expect(hover[1]?.forced).toEqual([{ address: 'html', pseudo: 'hover' }, { address: 'body', pseudo: 'hover' }, { address: 'card', pseudo: 'hover' }]);
    const focus = forcedCases(spec('interaction-focus'));
    const three = [
      ['[["wrap"],[],null,null]', [{ address: 'html', pseudo: 'hover' }, { address: 'body', pseudo: 'hover' }, { address: 'wrap', pseudo: 'hover' }]],
      ['[[],[],"f",null]', [{ address: 'f', pseudo: 'focus' }]],
      ['[[],[],null,"g"]', [{ address: 'g', pseudo: 'focus-visible' }]],
    ];
    expect(focus.map((c) => [c.interaction, c.forced])).toEqual([...three, ...three]);
    // A hover and a press at once force both chains; a press on q alone (without its ancestor p) is a forced state of its own.
    const combo = forcedCases(spec('interaction-combo')).find((c) => c.interaction === '[["a"],["b"],null,null]');
    expect(combo?.forced).toEqual([...['html', 'body', 'a'].map((address) => ({ address, pseudo: 'hover' })), ...['html', 'body', 'b'].map((address) => ({ address, pseudo: 'active' }))]);
    expect(forcedCases(spec('interaction-active')).filter((c) => !c.id.endsWith('-rtl')).map((c) => c.forced?.length)).toEqual([3, 4, 3, 4, 7, 7, 1]);
  });

  it('each have a committed Chrome reference', () => {
    for (const id of INTERACTION_FORCED) for (const c of forcedCases(spec(id))) expect(existsSync(expectedPath(c.id, REFERENCE_PLATFORM)), c.id).toBe(true);
  });
});

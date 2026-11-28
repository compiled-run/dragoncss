// Factored states (markless-state-groups-model.ts): the elements and interaction states a group gets.
import { afterEach, describe, expect, it } from 'vitest';
import { variant, byAB, expectCombines } from './markless-state-groups-model.ts';

afterEach(() => {
  delete process.env['DRAGON_STATE_GROUPS'];
});

describe('factored states', { timeout: 600_000 }, () => {
  it('gives a group the elements its states change only under :hover, :active or :focus', () => {
    // h6 depends on state a only through its :hover colour.
    const text = variant((v) => {
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'button', parent: 'h0', attributes: { type: 'button' }, classByState: byAB((a) => (a ? 't x mk-g' : 't mk-g')) },
        { kind: 'text', id: 'h6:text0', parent: 'h6', text: 'Gamma' },
      );
      v.css += '\n.x.mk-g:hover { background-color: #ff0000; }\n';
    });
    expect(expectCombines(text, true)).toBeGreaterThan(200);
  });

  it('pairs interaction states by the element a touch or pointer is on, not by what they match', () => {
    // A hovered .x child matches one more element than a hovered plain child, so its states' match sets differ with state a.
    const text = variant((v) => {
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'div', parent: 'h0', attributes: { class: 'p mk-g' } },
        { kind: 'element', id: 'h7', element: 'div', parent: 'h6', attributes: {}, classByState: byAB((a) => (a ? 'c x mk-g' : 'c mk-g')) },
        { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'Child' },
      );
      v.css += '\n.c.mk-g { color: #000000; }\n.p.mk-g:hover > .c.mk-g { color: #ff0000; }\n.p.mk-g:hover > .c.x.mk-g:hover { color: #000000; }\n';
    });
    expect(expectCombines(text, true)).toBeGreaterThan(200);
  });
});

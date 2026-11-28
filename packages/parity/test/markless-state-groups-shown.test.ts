// Factored states (markless-state-groups-model.ts): what hovers through another group, and the states a shown select option gets.
import { afterEach, describe, expect, it } from 'vitest';
import type { ExportTarget } from '../src/native-style-export.ts';
import { exportOf, variant, byAB, expectCombines } from './markless-state-groups-model.ts';

afterEach(() => {
  delete process.env['DRAGON_STATE_GROUPS'];
});

describe('factored states', { timeout: 600_000 }, () => {
  it("hovers a group's element through a child only another group shows", () => {
    // h6's :hover colour follows state b; its child h7 exists only while branch-site:1 shows it, so b's table has no h7.
    const text = variant((v) => {
      v.branches.push({ id: 'branch-site:1', domain: ['0', '1'], initial: '1' });
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'div', parent: 'h0', attributes: {}, classByState: byAB((_a, b) => (b ? 'q y mk-g' : 'q mk-g')) },
        { kind: 'element', id: 'h7', element: 'div', parent: 'h6', attributes: { class: 'kid mk-g' }, arm: { branch: 'branch-site:1', index: 0 } },
        { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'Inside', arm: { branch: 'branch-site:1', index: 0 } },
      );
      v.css += '\n.q.mk-g { padding: 4px; }\n.q.y.mk-g:hover { background-color: #ff0000; }\n.kid.mk-g { padding: 2px; }\n';
    });
    expect(expectCombines(text, true)).toBeGreaterThan(200);
  });

  it("gives a select's shown option the states of every option", () => {
    const text = variant((v) => {
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'select', parent: 'h0', attributes: { class: 'pick mk-g' } },
        { kind: 'element', id: 'h7', element: 'option', parent: 'h6', attributes: {}, attributesByState: { disabled: byAB((a) => (a ? '' : null)) } },
        { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'One' },
        { kind: 'element', id: 'h8', element: 'option', parent: 'h6', attributes: {}, attributesByState: { disabled: byAB((_a, b) => (b ? '' : null)) } },
        { kind: 'text', id: 'h8:text0', parent: 'h8', text: 'Two' },
        { kind: 'element', id: 'h9', element: 'option', parent: 'h6', attributes: {} },
        { kind: 'text', id: 'h9:text0', parent: 'h9', text: 'Three' },
      );
      v.css += '\n.pick.mk-g { appearance: none; font-family: inherit; font-size: 16px; border: 1px solid #222222; background-color: #ffffff; }\n';
    });
    const g = exportOf(text, true, false).targets.ios as ExportTarget;
    expect(g.groups?.some((x) => x.groupStates.includes('state:a') && x.groupStates.includes('state:b'))).toBe(true);
    expect(expectCombines(text, true)).toBeGreaterThan(0);
  });
});

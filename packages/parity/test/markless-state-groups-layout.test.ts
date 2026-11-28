// Factored states (markless-state-groups-model.ts): texts, borders, paragraphs and layer order laid out from the tables.
import { afterEach, describe, expect, it } from 'vitest';
import type { ExportAssignment, ExportGroup, ExportTarget } from '../src/native-style-export.ts';
import { composedNodes } from '../src/state-groups.ts';
import type { GroupProduct } from '../src/state-groups.ts';
import { systemFontsFor } from '../src/system-fonts/provider.ts';
import { runMarklessRowsLayout, TEXT, exportOf, variant, byAB, paintOrders, expectCombines } from './markless-state-groups-model.ts';

afterEach(() => {
  delete process.env['DRAGON_STATE_GROUPS'];
});

describe('factored states', { timeout: 600_000 }, () => {
  it('lays a text out where its branch moves it into an anonymous box', () => {
    const text = variant((v) => {
      v.branches.push({ id: 'branch-site:1', domain: ['0', '1'], initial: '1' });
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'div', parent: 'h0', attributes: {} },
        { kind: 'text', id: 'h6:text0', parent: 'h6', text: 'Hello there' },
        { kind: 'element', id: 'h7', element: 'div', parent: 'h6', attributes: {}, arm: { branch: 'branch-site:1', index: 0 } },
        { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'Block', arm: { branch: 'branch-site:1', index: 0 } },
      );
    });
    expect(expectCombines(text, true)).toBeGreaterThan(0);
  });

  it("lays a box's dashed border out with the colours its group gives it", () => {
    const text = variant((v) => {
      v.css += '\n.t.mk-g { border-style: dashed; }\n.t.mk-g[aria-pressed="true"] { border-left-color: rgba(255, 0, 0, 0.5); }\n';
    });
    expect(expectCombines(text, true)).toBeGreaterThan(0);
  });

  it('does not refuse a paragraph that only one group changes beside text no group changes', () => {
    const text = variant((v) => {
      v.branches.push({ id: 'branch-site:1', domain: ['0', '1'], initial: '1' });
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'p', parent: 'h0', attributes: { class: 'note mk-g' } },
        { kind: 'text', id: 'h6:text0', parent: 'h6', text: 'Hello ' },
        { kind: 'text', id: 'h6:text1', parent: 'h6', text: 'there', arm: { branch: 'branch-site:1', index: 0 } },
      );
    });
    // The engine refuses two texts in one paragraph today; the group rule must not be what refuses it.
    expect(() => exportOf(text, true, false)).not.toThrow('changes with more than one group of states');
  });

  it('refuses a paragraph whose text two groups change, which a phone could not shape', () => {
    const text = variant((v) => {
      v.nodes.push(
        { kind: 'element', id: 'h6', element: 'p', parent: 'h0', attributes: { class: 'note mk-g' } },
        { kind: 'element', id: 'h7', element: 'span', parent: 'h6', attributes: {}, classByState: byAB((a) => (a ? 'bold mk-g' : 'mk-g')) },
        { kind: 'text', id: 'h7:text0', parent: 'h7', text: 'One' },
        { kind: 'text', id: 'h6:text0', parent: 'h6', text: ' and ' },
        { kind: 'element', id: 'h8', element: 'span', parent: 'h6', attributes: {}, classByState: byAB((_a, b) => (b ? 'bold mk-g' : 'mk-g')) },
        { kind: 'text', id: 'h8:text0', parent: 'h8', text: 'two' },
      );
      v.css += '\n.bold.mk-g { font-weight: 700; }\n';
    });
    expect(() => exportOf(text, true, false)).toThrow('changes with more than one group of states, and a phone shapes a paragraph only as Dragon laid it out');
  });

  it('orders layer items of two groups no table shows together by layer, z-index and tree order', () => {
    // The panel (z-index 2, state a) and the other arm's note (z-index 3, branch-site:0) are never in one table; the bar is in all.
    const text = variant((v) => {
      v.css = v.css.split('\n').filter((l) => !l.includes(':hover') && !l.includes(':active') && !l.includes(':focus')).join('\n');
      v.nodes.push({ kind: 'element', id: 'h6', element: 'div', parent: 'h0', attributes: { class: 'bar mk-g' } }, { kind: 'text', id: 'h6:text0', parent: 'h6', text: 'Bar' });
      v.css += '\n.panel.mk-g { position: relative; z-index: 2; }\n.note.mk-g { position: relative; }\n.other.mk-g { z-index: 3; }\n.bar.mk-g { position: relative; z-index: 1; }\n.t.mk-g[aria-pressed="true"] { position: relative; z-index: 4; }\n';
    });
    const g = exportOf(text, true, false).targets.ios as ExportTarget;
    const order = paintOrders(composedNodes(g, { ...(g.assignments[0] as ExportAssignment).values, 'state:a': true, 'branch-site:0': '1' }));
    expect(order['html']?.indexOf('h2')).toBeLessThan(order['html']?.indexOf('h5') as number);
    expect(expectCombines(text, true)).toBeGreaterThan(0);
  });

  it("lays a page's live texts out in the tree every table gives (a text the app changes, in the page's and a group's box)", () => {
    const product = exportOf(TEXT, false, true);
    const grouped = exportOf(TEXT, true, true);
    for (const t of ['ios', 'android'] as const) {
      const p = product.targets[t] as ExportTarget;
      const g = grouped.targets[t] as ExportTarget;
      const sk = g.product as GroupProduct;
      const dpr = ((p.plan as NonNullable<ExportTarget['plan']>).densities[0] as { dpr: number }).dpr;
      const texts = [['h1:text0', 'Alpha, renamed at run time'], ['h3:text0', 'Beta, a longer label than the build laid out']];
      const live = (x: ExportTarget, extra: object): string => runMarklessRowsLayout(JSON.stringify({ dpr, viewport: p.viewport, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, plan: x.plan, rows: [], texts, ...extra }), systemFontsFor(t, dpr).shaper as never);
      const key = (v: Readonly<Record<string, unknown>>): string => JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]]));
      sk.assignments.forEach((tuple) => {
        // Each group gives only its own states' values; the page's entry every other.
        const values = Object.assign({}, ...tuple.map((e, ti) => {
          const a = (((ti === 0 ? g : (g.groups as readonly ExportGroup[])[ti - 1]) as ExportTarget).assignments[e] as ExportAssignment).values;
          return ti === 0 ? a : Object.fromEntries(((g.groups as readonly ExportGroup[])[ti - 1] as ExportGroup).groupStates.map((st) => [st, a[st]]));
        }));
        const i = p.assignments.findIndex((a) => key(a.values) === key(values));
        const want = live(p, { assignment: i });
        expect(want.startsWith('["ok"'), want.slice(0, 200)).toBe(true);
        expect(live(g, { assignment: tuple[0], groups: tuple.slice(1) }), `${t} ${key(values)}`).toBe(want);
      });
    }
  });
});

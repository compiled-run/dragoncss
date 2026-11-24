// A write that names another node (a paint-order host) names it by the input's id, as the export names the nodes, even when
// Dragon lays the page out under ids of its own (an input id that is not a Dragon id, such as a component edge's).
import { describe, expect, it } from 'vitest';
import type { ExportAssignment } from '../src/native-style-export.ts';
import { marklessStyleExport } from '../src/markless-style-input.ts';

const SHELL = JSON.stringify({
  version: 'markless.native-style-input/0',
  component: 'Shell',
  nodes: [
    { kind: 'element', id: 'component-edge:0/h0', element: 'div', parent: null, attributes: { class: 'shell' } },
    { kind: 'element', id: 'component-edge:0/h2', element: 'header', parent: 'component-edge:0/h0', attributes: { class: 'bar' } },
    { kind: 'element', id: 'component-edge:0/component-edge:2', element: 'div', parent: 'component-edge:0/h2', attributes: { class: 'pill' } },
    { kind: 'text', id: 'component-edge:0/component-edge:2:text0', parent: 'component-edge:0/component-edge:2', text: 'New note' },
  ],
  css: 'body { margin: 0; font-family: sans-serif; } .bar { position: relative; padding: 8px; } .pill { padding: 4px 12px; background: #2a9d8f; } .pill:active { opacity: 0.8; transform: scale(0.96); }',
  states: [],
});
const PILL = 'component-edge:0/component-edge:2';

type PaintOrder = { readonly kind: 'paint-order'; readonly host: string };
const paintOrders = (a: ExportAssignment): (readonly [string, PaintOrder])[] =>
  a.nodes.flatMap((n) => n.writes.filter((w): w is PaintOrder => w['kind'] === 'paint-order').map((w) => [n.id, w] as const));

describe('node ids in the writes of the Markless style export', () => {
  it('names the pressed pill paint-order host by its page id, an ancestor the state exports', () => {
    const { exported } = marklessStyleExport(SHELL, 'shell.native-style-input.json', undefined, 'system');
    for (const t of ['ios', 'android'] as const) {
      const x = exported.targets[t]!;
      const states = x.interaction?.levels.flatMap((l) => l.states) ?? [];
      let pressed = 0;
      for (const a of [...x.assignments, ...states]) {
        const parent = new Map(a.nodes.map((n) => [n.id, n.parent]));
        for (const [id, w] of paintOrders(a)) {
          const ancestors: string[] = [];
          for (let p = parent.get(id) ?? null; p !== null; p = parent.get(p) ?? null) ancestors.push(p);
          expect(ancestors, `${t} ${id}`).toContain(w.host);
          if (id === PILL) {
            expect(w.host, t).toBe('component-edge:0/h2');
            pressed++;
          }
        }
      }
      expect(pressed, t).toBeGreaterThan(0);
    }
  });
});

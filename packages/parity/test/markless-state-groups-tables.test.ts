// Factored states (markless-state-groups-model.ts): each input combined and stepped as a host does, and the tables written slim.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExportAssignment, ExportTarget } from '../src/native-style-export.ts';
import { mergedOrder } from '../src/state-groups.ts';
import type { PooledInteraction } from '../src/state-groups.ts';
import { repoPath } from '../src/paths.ts';
import { TEXT, exportOf, expectCombines, expectProduct } from './markless-state-groups-model.ts';

afterEach(() => {
  delete process.env['DRAGON_STATE_GROUPS'];
});

describe('factored states', { timeout: 600_000 }, () => {
  it('orders the ids of several lists as each list does', () => {
    expect(mergedOrder([['a', 'c'], ['b', 'c'], ['a', 'b']])).toEqual(['a', 'b', 'c']);
    expect(() => mergedOrder([['a', 'b'], ['b', 'a']])).toThrow('both before and after');
  });

  for (const name of ['groups', 'arms', 'tabs']) {
    it(`combines ${name}'s tables into every assignment and interaction state, nodes and layout`, () => {
      expect(expectCombines(readFileSync(repoPath(`examples/markless-styles/input/${name}.native-style-input.json`), 'utf8'), true)).toBeGreaterThan(0);
    });
  }

  it("writes a group's tables slim: its owned nodes, and what each interaction state changes", () => {
    const g = exportOf(TEXT, true, false).targets.ios as ExportTarget;
    const nodes = (g.assignments[0] as ExportAssignment).nodes.length;
    for (const x of g.groups ?? []) {
      const owned = new Set(x.owned.filter((o) => o.startsWith('node:')).map((o) => o.slice('node:'.length)));
      for (const a of x.assignments) expect(a.nodes.every((n) => owned.has(n.id))).toBe(true);
      for (const st of (x.interaction as unknown as PooledInteraction | undefined)?.states ?? []) expect(st.nodes.length).toBeLessThan(nodes);
    }
    const pooled = g.interaction as unknown as PooledInteraction;
    for (const st of pooled.states) expect(st.nodes.length).toBeLessThan(nodes);
    // A state two levels share is written once.
    expect(pooled.states.length).toBeLessThan(pooled.levels.reduce((n, l) => n + l.states.length, 0));
  });

  for (const name of ['groups', 'arms', 'tabs']) {
    it(`steps ${name}'s product skeleton as a host does: every combination, transition and interaction event`, () => {
      expect(expectProduct(readFileSync(repoPath(`examples/markless-styles/input/${name}.native-style-input.json`), 'utf8'))).toBeGreaterThan(0);
    });
  }
});

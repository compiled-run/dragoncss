// Factored states (markless-state-groups-model.ts): a group's rows per @media band.
import { afterEach, describe, expect, it } from 'vitest';
import type { ExportGroup, ExportTarget } from '../src/native-style-export.ts';
import { TEXT, exportOf, variant, byAB, expectCombines, expectProduct } from './markless-state-groups-model.ts';

afterEach(() => {
  delete process.env['DRAGON_STATE_GROUPS'];
});

describe('factored states', { timeout: 600_000 }, () => {
  it('gives a group whose elements style alike in every @media band one row per assignment', () => {
    const g = exportOf(TEXT, true, false).targets.ios as ExportTarget;
    expect((g.groups ?? []).map((x) => [x.groupStates, x.assignments.length])).toEqual([[['state:a'], 4], [['state:b'], 4], [['branch-site:0'], 2]]);
  });

  it('gives a group one row per assignment and band class, where bands style its elements alike, and steps them as the unfactored page', () => {
    // Four bands, min-width and dark.
    const text = variant((v) => {
      v.css += '\n@media (prefers-color-scheme: dark) { .panel.mk-g { background-color: #333333; } }\n';
    });
    const g = exportOf(text, true, false).targets.ios as ExportTarget;
    const bandsOf = (x: ExportGroup): readonly unknown[] | null => x.states.find((st) => st.key === '@env#band')?.domain ?? null;
    // state:a changes the panel, which the dark band styles too, so its four bands are four classes; state:b changes only its
    // button, which reads the width alone, so it holds the light bands below and above 500px; the branch's elements read neither.
    expect((g.groups ?? []).map((x) => [x.groupStates, x.assignments.length, bandsOf(x)])).toEqual([[['state:a'], 8, [0, 1, 2, 3]], [['state:b'], 4, [0, 2]], [['branch-site:0'], 2, null]]);
    // The phone reads the product, which maps each band to its class's rows, and no classes.
    expect((g.groups ?? []).map((x) => 'bandClasses' in x)).toEqual([false, false, false]);
    expect(expectCombines(text, true)).toBeGreaterThan(0);
    expect(expectProduct(text)).toBeGreaterThan(0);
  });

  it("keeps a band of its own for a group that changes only a text, whose parent the dark band colours", () => {
    const text = variant((v) => {
      v.css += '\n@media (prefers-color-scheme: dark) { .note.mk-g { color: #ffffff; } }\n';
      (v.nodes as unknown[]).push(
        { kind: 'element', id: 'h6', element: 'p', parent: 'h0', attributes: { class: 'note mk-g' } },
        { kind: 'text', id: 'h6:text0', parent: 'h6', text: 'Off', textByState: byAB((_, b) => (b ? 'On' : 'Off')) as { when: Record<string, boolean>; value: string }[] },
      );
    });
    const g = exportOf(text, true, false).targets.ios as ExportTarget;
    const b = (g.groups ?? []).find((x) => x.groupStates.includes('state:b'));
    // state:b's button reads the width and its text's paragraph the colour scheme, so its four bands are four classes.
    expect(b?.states.find((st) => st.key === '@env#band')?.domain).toEqual([0, 1, 2, 3]);
    expect(expectCombines(text, true)).toBeGreaterThan(0);
  });
});

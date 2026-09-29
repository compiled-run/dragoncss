// var() in direction and in flow-relative properties (css-variables-1 §3.1, css-logical-1 §3, css-writing-modes-4 §2.1). Custom
// properties resolve first, then direction, then the flow-relative mappings of that direction. Every expectation was read from
// Chrome 145.0.7632.6; the parity fixtures var-direction and var-logical (fixture-groups/cascade-var.ts) prove them.
import { describe, expect, it } from 'vitest';
import type { LinkedElement } from '../src/analysis/link.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { resolveTree, valueToString } from '../src/analysis/resolve.ts';
import type { Longhand } from '../src/css/properties.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { NO_FAULTS } from '../src/faults.ts';
import type { Diagnostic } from '../src/types.ts';
import { referenceDataset } from '../src/ua/datasets.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const origin = { kind: 'unlocated', reason: 'test' } as const;
const el = (id: string, classes: string[], children: LinkedElement[] = [], tag = 'div'): LinkedElement => ({
  kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: classes.map((name) => ({ owner: 'o', sheet: 'sheet', name })), attributes: new Map(), children,
  node: { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin },
});

/** Resolves html > body > (children) in the ltr environment and returns a reader of computed values by element id. */
function resolve(css: string, children: LinkedElement[], faults: CompilerFaults = NO_FAULTS): (id: string, p: Longhand) => string {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics);
  expect(diagnostics).toEqual([]);
  const root = resolveTree(el('html', [], [el('body', [], children, 'body')], 'html'), rules, faults, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  const find = (e: ResolvedElement, id: string): ResolvedElement | null => {
    if (e.element.address === id) return e;
    for (const c of e.children) if (c.kind === 'element') {
      const hit = find(c, id);
      if (hit !== null) return hit;
    }
    return null;
  };
  return (id, p) => valueToString(((find(root, id) as ResolvedElement).props.get(p) as { value: Parameters<typeof valueToString>[0] }).value);
}

describe('direction with var()', () => {
  const css = '.defr { --d: rtl; } .use { direction: var(--d); } .local { --d: rtl; direction: var(--d); } .miss { direction: var(--missing); } .bad { --bad: 10px; direction: var(--bad); } .fb { direction: var(--missing, rtl); } .b { margin-inline-start: 10px; }';

  it('substitutes an inherited or local custom property before computing direction, and maps logical properties with it', () => {
    const at = resolve(css, [el('p', ['defr'], [el('a', ['use', 'b']), el('k', [], [el('k1', ['use', 'b'])])]), el('l', ['local', 'b']), el('f', ['fb', 'b'])]);
    for (const id of ['a', 'k1', 'l', 'f']) {
      expect(at(id, 'direction'), id).toBe('rtl');
      expect([at(id, 'margin-right'), at(id, 'margin-left')], id).toEqual(['10px', '0px']);
    }
  });

  it('an invalid var() in direction is invalid at computed-value time: unset, the parent direction', () => {
    const at = resolve(css, [el('p', ['local'], [el('m', ['miss', 'b']), el('x', ['bad', 'b'])])]);
    for (const id of ['m', 'x']) {
      expect(at(id, 'direction'), id).toBe('rtl');
      expect([at(id, 'margin-right'), at(id, 'margin-left')], id).toEqual(['10px', '0px']);
    }
  });

  it('planted fault directionBeforeVar: direction ignores the var() declaration and the logical mapping takes the wrong side', () => {
    const at = resolve(css, [el('l', ['local', 'b'])], { ...NO_FAULTS, directionBeforeVar: true });
    expect([at('l', 'margin-right'), at('l', 'margin-left')]).toEqual(['0px', '10px']);
  });
});

describe('flow-relative properties holding var()', () => {
  const css = '.c { --m: 11px; --p: 8px; } .rtl { direction: rtl; } .mis { margin-right: 5px; margin-inline-start: var(--m); } .mi { margin-inline: var(--m) var(--p); } .miss { margin-right: 6px; margin-left: 5px; margin-inline-start: var(--missing); } .fb { margin-inline-start: var(--missing, 9px); }';
  const tree = (): LinkedElement[] => [
    el('c1', ['c'], [el('a1', ['mis']), el('a2', ['mi']), el('a3', ['miss']), el('a4', ['fb'])]),
    el('c2', ['c', 'rtl'], [el('b1', ['mis']), el('b2', ['mi']), el('b3', ['miss']), el('b4', ['fb'])]),
  ];
  const sides = (at: (id: string, p: Longhand) => string, id: string): [string, string] => [at(id, 'margin-left'), at(id, 'margin-right')];

  it('map to the physical side of the element direction only', () => {
    const at = resolve(css, tree());
    expect(sides(at, 'a1')).toEqual(['11px', '5px']);
    expect(sides(at, 'b1')).toEqual(['0px', '11px']);
    expect(sides(at, 'a2')).toEqual(['11px', '8px']);
    expect(sides(at, 'b2')).toEqual(['8px', '11px']);
    expect(sides(at, 'a4')).toEqual(['9px', '0px']);
    expect(sides(at, 'b4')).toEqual(['0px', '9px']);
  });

  it('an invalid var() is unset on that direction\'s side only', () => {
    const at = resolve(css, tree());
    expect(sides(at, 'a3')).toEqual(['0px', '6px']);
    expect(sides(at, 'b3')).toEqual(['5px', '0px']);
  });

  it('planted fault varLogicalBothSides: the declaration also wins the other side', () => {
    const at = resolve(css, tree(), { ...NO_FAULTS, varLogicalBothSides: true });
    expect(sides(at, 'a1')).toEqual(['11px', '11px']);
    expect(sides(at, 'b2')).not.toEqual(['8px', '11px']);
  });
});

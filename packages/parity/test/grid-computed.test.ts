// GRID G0 dual computed check, which needs the pinned Chrome and so sits with the other Chrome suites, not the platform-free ones.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { GRID_LONGHANDS } from '../../dragon/src/css/properties/grid.ts';
import type { Declaration } from '../../dragon/src/css/stylesheet.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/grid.css', revision: 'r1', hash: 'sha256:0' };

function declare(property: string, value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; span: string | null } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const d = diagnostics[0];
  const span = d !== undefined && d.origin.kind === 'authored' ? css.slice(d.origin.span.start, d.origin.span.end) : null;
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, span };
}

// The dual computed check: every grid declaration of the G-P corpus and the edge list, rendered by Chrome as authored and as
// Dragon's longhands on a block box, must compute identically; every value Dragon calls invalid must be dropped by Chrome. Four
// planted faults in Dragon's longhands must each be caught by the same comparison.
describe('grid family: Chrome 145 computed values', () => {
  const load = async <T>(file: string): Promise<T> => (await import(new URL(`../src/${file}`, import.meta.url).href)) as T;
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };
  type Item = { readonly p: string; readonly v: string; readonly code: string | null; readonly longhands: readonly (readonly [string, string])[] };
  type Seen = { readonly parsed: boolean; readonly dropped: readonly string[]; readonly diff: readonly string[] };

  const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../dragon/test/data/${file}`, import.meta.url), 'utf8'));
  const corpus = Object.entries((read('grid-corpus-declarations.json') as { declarations: Record<string, string[]> }).declarations).flatMap(([p, vs]) => vs.map((v) => [p, v] as const));
  const edges = (read('grid-edge-declarations.json') as { declarations: [string, string][] }).declarations;
  const item = ([p, v]: readonly [string, string]): Item => {
    const { declaration, diagnostics } = declare(p, v);
    return { p, v, code: diagnostics[0]?.code ?? null, longhands: (declaration?.longhands ?? []).map((l) => [l.property, valueToString(l.value)] as const) };
  };
  const COMPARED = [...GRID_LONGHANDS, 'row-gap', 'column-gap'];
  /** Values Chrome parses that the webref grammar lacks, so Dragon reports them invalid: a refusal, never a wrong acceptance. */
  const GRAMMAR_GAPS = ['justify-items: anchor-center'];

  const judge = (items: readonly Item[], seen: readonly Seen[]): string[] => items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === null) {
      const out: string[] = [];
      if (!s.parsed) out.push(`${it.p}: ${it.v}: accepted, Chrome drops it`);
      if (s.dropped.length > 0) out.push(`${it.p}: ${it.v}: Chrome drops Dragon's ${s.dropped.join(', ')}`);
      out.push(...s.diff.map((d) => `${it.p}: ${it.v}: ${d}`));
      return out;
    }
    if (it.code === 'DRAGON_CSS_INVALID_VALUE' && s.parsed && !GRAMMAR_GAPS.includes(`${it.p}: ${it.v}`)) return [`${it.p}: ${it.v}: invalid, Chrome parses it`];
    return [];
  });

  it('the corpus and edge declarations compute like Chrome, invalid values are ones Chrome drops, and the plants are caught', async () => {
    const real = [...corpus, ...edges].map(item);
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'lineEndNotCopied', items: real.filter((it) => ['grid-row', 'grid-column', 'grid-area'].includes(it.p) && !it.v.includes('/') && it.code === null).map((it) => ({ ...it, longhands: it.longhands.map(([l, v]) => [l, l.endsWith('-end') ? 'auto' : v] as const) })) },
      { name: 'autoRepeatTakesFlex', items: [{ p: 'grid-template-columns', v: 'repeat(auto-fill, 1fr)', code: null, longhands: [['grid-template-columns', 'repeat(auto-fill, 1fr)']] }] },
      { name: 'denseDropped', items: real.filter((it) => it.v.includes('dense') && it.code === null).map((it) => ({ ...it, longhands: it.longhands.map(([l, v]) => [l, l === 'grid-auto-flow' ? v.replace(/ ?dense/, '') || 'row' : v] as const) })) },
      { name: 'areaRowNamesNotMerged', items: real.filter((it) => it.p === 'grid-template' && it.v.includes('[y] [z]')).map((it) => ({ ...it, longhands: it.longhands.map(([l, v]) => [l, v.replace('[y z]', '[y] [z]')] as const) })) },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = await load<{ launchChrome: () => Promise<Browser> }>('chrome.ts');
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div id="a" style="font-size:10px"></div><div id="c" style="font-size:10px"></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's longhands on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const L = ${JSON.stringify(COMPARED)};
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) { e.removeAttribute('style'); e.style.fontSize = '10px'; }
        a.style.setProperty(it.p, it.v);
        const parsed = a.style.getPropertyValue(it.p) !== '';
        for (const [l, v] of it.longhands) c.style.setProperty(l, v);
        const dropped = it.longhands.filter(([l]) => c.style.getPropertyValue(l) === '').map(([l, v]) => l + ': ' + v);
        const ca = getComputedStyle(a), cc = getComputedStyle(c);
        const diff = it.code !== null ? [] : L.filter((l) => ca.getPropertyValue(l) !== cc.getPropertyValue(l)).map((l) => l + ' authored "' + ca.getPropertyValue(l) + '" Dragon "' + cc.getPropertyValue(l) + '"');
        return { parsed, dropped, diff };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    const [realSeen, ...plantSeen] = seen;
    expect(judge(real, realSeen as Seen[])).toEqual([]);
    const accepted = (items: readonly Item[]): number => items.filter((it) => it.code === null).length;
    expect({ corpus: corpus.length, accepted: accepted(real.slice(0, corpus.length)), edges: edges.length, edgesAccepted: accepted(real.slice(corpus.length)) }).toEqual({ corpus: 2515, accepted: 2510, edges: 167, edgesAccepted: 119 });
    expect(real.filter((it) => it.code !== null && it.code !== 'DRAGON_CSS_INVALID_VALUE').map((it) => `${it.code as string} ${it.p}: ${it.v}`)).toEqual([
      'DRAGON_UNSUPPORTED_VALUE column-gap: calc(5% + 2px)',
      'DRAGON_UNSUPPORTED_VALUE grid-template-columns: calc(20% + 3.3px) 1fr',
      'DRAGON_UNSUPPORTED_VALUE grid-template-columns: subgrid',
      'DRAGON_UNSUPPORTED_VALUE grid-template-columns: subgrid [x] [y] [z]',
      'DRAGON_UNSUPPORTED_VALUE grid-template-rows: subgrid',
      'DRAGON_UNSUPPORTED_VALUE grid-template-columns: subgrid',
      'DRAGON_UNSUPPORTED_VALUE grid-template-columns: subgrid [a] repeat(2, [b])',
      'DRAGON_UNSUPPORTED_VALUE grid-template-columns: calc(10px + 5%)',
      'DRAGON_UNSUPPORTED_VALUE grid-template: subgrid / 10px',
    ]);
    planted.forEach((p, i) => {
      expect(p.items.length, p.name).toBeGreaterThan(0);
      expect(judge(p.items, plantSeen[i] as Seen[]).length, p.name).toBeGreaterThan(0);
    });
  });
});


// GRID G1c dual computed check of place-content, place-items and place-self (css/place.ts), which needs the pinned Chrome.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import type { PlaceShorthand } from '../../dragon/src/css/place.ts';
import { PLACE_SHORTHANDS, splitPlace } from '../../dragon/src/css/place.ts';
import type { Declaration } from '../../dragon/src/css/stylesheet.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/place.css', revision: 'r1', hash: 'sha256:0' };

function declare(property: string, value: string): { declaration: Declaration | null; diagnostics: Diagnostic[] } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics };
}

// Every alignment word and two-word value, valid or not for each longhand, so each shorthand meets every pair of them.
const WORDS = [
  'normal', 'stretch', 'baseline', 'first baseline', 'last baseline', 'center', 'start', 'end', 'self-start', 'self-end', 'flex-start',
  'flex-end', 'left', 'right', 'space-between', 'space-around', 'space-evenly', 'auto', 'legacy', 'legacy left', 'center legacy',
  'safe center', 'unsafe end', 'anchor-center', 'first', 'bogus',
];
const VALUES = [...WORDS, ...WORDS.flatMap((a) => WORDS.map((b) => `${a} ${b}`))];
const COMPARED = Object.values(PLACE_SHORTHANDS).flat();
/**
 * Values Chrome parses that Dragon reports invalid, a refusal and never a wrong acceptance: anchor-center is missing from the
 * webref grammar, and Blink's ConsumeBaseline and ConsumeFirstBaseline (css_parsing_utils.cc) consume a leading first and keep
 * going when no baseline follows, so Chrome reads first center as center.
 */
const grammarGap = (v: string): boolean => v.includes('anchor-center') || /^first (?!baseline)/.test(v);

// The dual check: every place-* value, rendered by Chrome as authored and as Dragon's longhands, must compute identically; every
// value Dragon calls invalid must be dropped by Chrome. Three planted faults in Dragon's longhands must each be caught.
describe('place-* shorthands: Chrome 145 computed values', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };
  type Item = { readonly p: string; readonly v: string; readonly code: string | null; readonly longhands: readonly (readonly [string, string])[] };
  type Seen = { readonly parsed: boolean; readonly dropped: readonly string[]; readonly diff: readonly string[] };

  const item = (p: string, v: string): Item => {
    const { declaration, diagnostics } = declare(p, v);
    return { p, v, code: diagnostics[0]?.code ?? null, longhands: (declaration?.longhands ?? []).map((l) => [l.property, valueToString(l.value)] as const) };
  };
  const judge = (items: readonly Item[], seen: readonly Seen[]): string[] => items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === null) {
      const out: string[] = [];
      if (!s.parsed) out.push(`${it.p}: ${it.v}: accepted, Chrome drops it`);
      if (s.dropped.length > 0) out.push(`${it.p}: ${it.v}: Chrome drops Dragon's ${s.dropped.join(', ')}`);
      out.push(...s.diff.map((d) => `${it.p}: ${it.v}: ${d}`));
      return out;
    }
    if (it.code === 'DRAGON_CSS_INVALID_VALUE' && s.parsed && !grammarGap(it.v)) return [`${it.p}: ${it.v}: invalid, Chrome parses it`];
    return [];
  });

  it('every value computes like Chrome, invalid values are ones Chrome drops, and the plants are caught', { timeout: 120_000 }, async () => {
    const real = Object.keys(PLACE_SHORTHANDS).flatMap((p) => VALUES.map((v) => item(p, v)));
    const accepted = real.filter((it) => it.code === null);
    // first baseline is baseline (css-align-3 §4.2), so swapping the two spellings changes nothing.
    const same = (v: string): string => (v === 'first baseline' ? 'baseline' : v);
    // One value, which the justify longhand takes again.
    const single = (it: Item): boolean => splitPlace(it.p as PlaceShorthand, it.v.split(' '))?.align.length === it.v.split(' ').length;
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'axesSwapped', items: accepted.filter((it) => same((it.longhands[0] as [string, string])[1]) !== same((it.longhands[1] as [string, string])[1])).map((it) => ({ ...it, longhands: [[(it.longhands[0] as [string, string])[0], (it.longhands[1] as [string, string])[1]], [(it.longhands[1] as [string, string])[0], (it.longhands[0] as [string, string])[1]]] as const })) },
      { name: 'singleNotCopied', items: accepted.filter((it) => single(it) && (it.longhands[1] as [string, string])[1] !== 'normal').map((it) => ({ ...it, longhands: [it.longhands[0] as [string, string], [(it.longhands[1] as [string, string])[0], 'normal']] as const })) },
      { name: 'baselineNotStart', items: accepted.filter((it) => it.p === 'place-content' && it.v.endsWith('baseline')).map((it) => ({ ...it, longhands: [it.longhands[0] as [string, string], ['justify-content', 'normal']] as const })) },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="display:grid"><div id="a"></div><div id="c"></div></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's longhands on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const L = ${JSON.stringify(COMPARED)};
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
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
    const counts = Object.fromEntries(Object.keys(PLACE_SHORTHANDS).map((p) => {
      const of = real.filter((it) => it.p === p);
      const by = (code: string | null): number => of.filter((it) => it.code === code).length;
      return [p, { accepted: by(null), invalid: by('DRAGON_CSS_INVALID_VALUE'), unsupported: by('DRAGON_UNSUPPORTED_VALUE'), parsedByChrome: of.filter((_, i) => (realSeen as Seen[])[real.indexOf(of[i] as Item)]?.parsed).length }];
    }));
    expect(counts).toEqual({
      'place-content': { accepted: 157, invalid: 491, unsupported: 54, parsedByChrome: 216 },
      'place-items': { accepted: 245, invalid: 417, unsupported: 40, parsedByChrome: 331 },
      'place-self': { accepted: 267, invalid: 397, unsupported: 38, parsedByChrome: 315 },
    });
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE' && grammarGap(it.v) && (realSeen as Seen[])[real.indexOf(it)]?.parsed).length).toBe(61);
    planted.forEach((p, i) => {
      expect(p.items.length, p.name).toBeGreaterThan(0);
      // Every planted item is caught, not just some.
      expect(p.items.filter((it, k) => judge([it], [(plantSeen[i] as Seen[])[k] as Seen]).length > 0).length, p.name).toBe(p.items.length);
    });
  });
});

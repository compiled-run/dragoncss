// The container-type, container-name and container grammars against Chrome 145 (css/properties/container-query.ts): Dragon takes a
// value as valid exactly when Chrome parses it, and the longhands Dragon sets compute as Chrome computes the authored value. Each
// planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { CONTAINER_QUERY_LONGHANDS } from '../../dragon/src/css/properties/container-query.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/container-query.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly p: string; readonly v: string; readonly code: string | null; readonly longhands: readonly (readonly [string, string])[] };
type Seen = { readonly parsed: boolean; readonly diff: readonly string[] };

function item(p: string, v: string): Item {
  const css = `.a { ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${p}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const longhands = code !== null ? [] : (rules[0]?.declarations[0]?.longhands ?? []).map((l) => [l.property, valueToString(l.value)] as const);
  return { p, v, code, longhands };
}

const VALUES: readonly (readonly [string, string])[] = [
  ...['normal', 'NORMAL', 'size', 'inline-size', 'INLINE-SIZE', 'scroll-state', 'inline-size scroll-state', 'scroll-state inline-size', 'scroll-state size', 'anchored',
    'anchored size', 'inline-size anchored', 'size scroll-state anchored'].map((v) => ['container-type', v] as const),
  ...['none', 'NONE', 'card', 'Card', 'a b', 'b a', 'a a', 'normal', 'auto', '-x', 'inherit-x'].map((v) => ['container-name', v] as const),
  ...['none', 'NONE', 'card', 'card / inline-size', 'a b / size scroll-state', 'none / normal', 'NONE/NORMAL', 'card/size', 'normal / normal', 'auto / inline-size', 'INLINE-SIZE'].map((v) => ['container', v] as const),
  // Chrome 145 drops size beside inline-size, normal beside a type, a repeated type, none, and the names none, and, not, or and default
  // and a string or a comma.
  ...['size inline-size', 'normal size', 'none', 'inline-size inline-size', 'block-size', '0'].map((v) => ['container-type', v] as const),
  ...['none none', 'and', 'not', 'or', 'a none', 'default', 'a, b', '"a"', 'a default', '1'].map((v) => ['container-name', v] as const),
  ...['none /', '/ normal', 'card / none', 'card / normal size', 'and / size', 'a / b'].map((v) => ['container', v] as const),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  if (seen.length !== items.length) return [`Chrome returned ${String(seen.length)} readings for ${String(items.length)} items`];
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${it.p}: ${it.v}`;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code !== null) return [`${at}: unexpected ${it.code}`];
    if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
    return s.diff.map((d) => `${at}: ${d}`);
  });
}

describe('container-type, container-name and container: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, its longhands compute alike, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'typeReadAsInitial', items: [{ p: 'container', v: 'none / size', code: null, longhands: [['container-name', 'none'], ['container-type', 'normal']] }] },
      { name: 'nameLowercased', items: [{ p: 'container-name', v: 'Card', code: null, longhands: [['container-name', 'card']] }] },
      { name: 'repeatedNameDropped', items: [{ p: 'container-name', v: 'a a', code: null, longhands: [['container-name', 'a']] }] },
      { name: 'anchoredDropped', items: [{ p: 'container-type', v: 'anchored', code: 'DRAGON_CSS_INVALID_VALUE', longhands: [] }] },
      { name: 'reservedNameAccepted', items: [{ p: 'container-name', v: 'and', code: null, longhands: [['container-name', 'and']] }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's longhands on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const L = ${JSON.stringify(CONTAINER_QUERY_LONGHANDS)};
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.p, it.v);
        const parsed = a.style.getPropertyValue(it.p) !== '';
        for (const [l, v] of it.longhands) c.style.setProperty(l, v);
        const ca = getComputedStyle(a), cc = getComputedStyle(c);
        const diff = it.code !== null ? [] : L.filter((l) => ca.getPropertyValue(l) !== cc.getPropertyValue(l)).map((l) => l + ' Chrome ' + ca.getPropertyValue(l) + ' Dragon ' + cc.getPropertyValue(l));
        return { parsed, diff };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.code === null).length).toBe(35);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBe(22);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});

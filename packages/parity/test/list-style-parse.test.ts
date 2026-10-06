// The content and list-style grammars against Chrome 145 (GEN-b, notes/T151-gen-spec.md R13): every value of the matrix is accepted
// by Dragon exactly when Chrome parses it; an accepted value's longhands, written as Dragon's web output writes them, compute in
// Chrome as the authored value does; and a refused value is one Chrome parses. Two planted readings must each be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import { valueText } from '../../dragon/src/emit/web-css.ts';

const SOURCE = { uri: 'dragon-source://test/list-style.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly property: string; readonly v: string; readonly code: string | null; readonly message: string | null; readonly longhands: readonly (readonly [string, string])[] };
type Seen = { readonly parsed: boolean; readonly authored: readonly string[]; readonly dragon: readonly string[] };

const COMPARED = ['content', 'list-style-type', 'list-style-position', 'list-style-image'];

function item(property: string, v: string): Item {
  const css = `.a { ${property}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${property}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const longhands = code === null ? (rules[0]?.declarations[0]?.longhands ?? []).map((l) => [l.property, valueText(l.value)] as const) : [];
  if (code === null && longhands.length === 0) throw new Error(`${property}: ${v}: accepted without longhands`);
  return { property, v, code, message: diagnostics[0]?.message ?? null, longhands };
}

const MATRIX: { readonly [property: string]: readonly string[] } = {
  content: [
    'normal', 'none', 'NONE', "'a'", "'a' 'b'", `"a" ''`, "''", `'\\'q\\''`, "'a' / 'alt'", 'counter(x)', "counters(x, '.')", 'attr(data-x)', 'open-quote', 'close-quote',
    'no-open-quote', 'no-close-quote', 'url(x.png)', "'a' url(x.png)", "url(x.png) 'a'", 'linear-gradient(red, blue)', "image-set('x.png' 1x)",
    "'a' counter(x) attr(y)", "'a' / counter(x)", "normal 'a'", 'none none', "'a' / 'b' / 'c'", "url(x.png) / 'alt'", "open-quote / 'x'",
    "'a' open-quote", 'disc', "'a' 1", 'counter(x, upper-roman)', 'inherit', 'initial', 'content(text)', 'leader(dotted)', 'string(x)', 'element(#a)',
    "cross-fade(url(x.png), url(y.png), 50%)", "-webkit-cross-fade(url(x.png), url(y.png), 50%)", 'image(red)', "-webkit-image-set('x.png' 1x)", 'repeating-conic-gradient(red, blue)',
  ],
  'list-style-type': ['disc', 'circle', 'square', 'decimal', 'none', 'NONE', 'Disc', "'>> '", "''", 'lower-roman', 'disclosure-open', "symbols(cyclic '*')", "'a' 'b'", '0', 'inside', 'inherit', 'default', 'Foo', 'element(#a)', 'Lower-Roman', 'DECIMAL-LEADING-ZERO', 'Hebrew', 'Disclosure-Closed', 'Upper-Alpha', 'fooBar'],
  'list-style-position': ['inside', 'outside', 'INSIDE', 'none', 'inherit'],
  'list-style-image': ['none', 'url(x.png)', 'linear-gradient(red, blue)', "'x.png'", "image-set('x.png' 1x)", 'inherit', 'element(#a)', 'image(red)', "cross-fade(url(x.png), url(y.png), 50%)", "-webkit-image-set('x.png' 1x)", '-webkit-cross-fade(url(x.png), url(y.png), 50%)'],
  'list-style': [
    'none', 'inside', 'outside', 'disc', "'x'", 'none inside', 'inside none', 'none outside', 'none none', 'none none none', 'url(x.png) none', 'none url(x.png)',
    'disc none', 'none disc', 'square inside url(x.png)', 'url(x.png)', 'url(x.png) url(y.png)', 'inside outside', "'>> ' inside", "none 'x'",
    'inside none none', 'none inside none', 'decimal inside', 'circle outside', 'NONE', 'inherit', 'initial', 'outside inside', 'inside inside', 'default', 'element(#a)', "symbols(cyclic '*')", 'Foo inside', 'Square none', "-webkit-image-set('x.png' 1x) none",
  ],
};

const VALUES: readonly Item[] = Object.entries(MATRIX).flatMap(([p, vs]) => vs.map((v) => item(p, v)));

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${it.property}: ${it.v}`;
    if (it.code === null) {
      if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
      return COMPARED.flatMap((p, j) => (s.authored[j] === s.dragon[j] ? [] : [`${at}: Chrome computes ${p} ${String(s.authored[j])}, Dragon's longhands compute ${String(s.dragon[j])}`]));
    }
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${at}: refused, Chrome drops it`];
    return [`${at}: unexpected ${it.code}`];
  });
}

describe('content and list-style: Chrome 145 parsing and computed values', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon accepts exactly the values Chrome parses, its longhands compute alike, refusals are of parsed values, and the plants are caught', async () => {
    const pick = (property: string, v: string): Item => {
      const it = VALUES.find((x) => x.property === property && x.v === v);
      if (it === undefined) throw new Error(`${property}: ${v} is not in the matrix`);
      return it;
    };
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      // The list-style shorthand's none sets only list-style-image (listStyleNoneSetsImageOnly), so the type keeps its initial disc.
      { name: 'listStyleNoneSetsImageOnly', items: [pick('list-style', 'none'), pick('list-style', 'none inside')].map((it) => ({ ...it, longhands: it.longhands.map(([p, x]) => [p, p === 'list-style-type' ? 'disc' : x] as const) })) },
      // Only the first of adjacent strings is kept.
      { name: 'contentFirstStringOnly', items: [pick('content', "'a' 'b'")].map((it) => ({ ...it, longhands: [['content', '"a"'] as const] })) },
    ];
    const sets = [VALUES, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div><div id="a"></div><div id="c"></div></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's longhands on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.property, it.v);
        const parsed = a.style.getPropertyValue(it.property) !== '';
        for (const [p, x] of it.longhands) c.style.setProperty(p, x);
        const read = (e) => ${JSON.stringify(COMPARED)}.map((p) => getComputedStyle(e).getPropertyValue(p));
        return { parsed, authored: read(a), dragon: read(c) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(VALUES, seen[0] as Seen[])).toEqual([]);
    // Every refusal names the package that owns the value, and there is one for each kind the matrix holds.
    const refused = VALUES.filter((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
    for (const it of refused) expect(it.message, `${it.property}: ${it.v}`).toMatch(/ is not supported yet: .*\(GEN-d[1-5]\)$/);
    expect(new Set(refused.map((it) => /\((GEN-d[1-5])\)$/.exec(it.message ?? '')?.[1]))).toEqual(new Set(['GEN-d1', 'GEN-d2', 'GEN-d3', 'GEN-d4', 'GEN-d5']));
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});

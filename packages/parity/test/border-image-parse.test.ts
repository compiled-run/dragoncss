// The border image parse against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES; Blink's BorderImageOutset through
// BorderImageWidth, BorderImage and WebkitBorderImage parsers): Dragon drops no value Chrome keeps, through every border image name,
// and every value Dragon accepts computes in Chrome to the five border image longhands' initial values and leaves the border widths
// as they were, as Dragon's own longhands do. Every other value is kept and then refused (MISC-PAINT, analysis/border-image.ts), so
// only the accepted values' computed values are compared. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { BORDER_IMAGE_LONGHANDS } from '../../dragon/src/css/properties/border-image.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/border-image.css', revision: 'r1', hash: 'sha256:0' };

/** code: Dragon's diagnostic, or null; longhands: the longhands Dragon sets as [property, text] when every one is initial, else null. */
type Item = { readonly name: string; readonly v: string; readonly code: string | null; readonly longhands: readonly (readonly [string, string])[] | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && (longhands.length === 0 || !longhands.every((l) => (BORDER_IMAGE_LONGHANDS as readonly string[]).includes(l.property)))) throw new Error(`${name}: ${v}: accepted without border image longhands`);
  const accepted = code === null && longhands.every((l) => l.value.kind !== 'other');
  return { name, v, code, longhands: accepted ? longhands.map((l) => [l.property, valueToString(l.value)] as const) : null };
}

const VALUES: { readonly [name: string]: readonly string[] } = {
  'border-image-source': ['none', 'NONE', 'None', 'url(b.png)', 'linear-gradient(red, blue)', 'none none', 'none, none', 'bogus'],
  'border-image-slice': ['100%', '100.0%', '100', '100% 100%', '100% fill', 'fill 100%', '30%', '-1%', '+100%', 'none'],
  'border-image-width': ['1', '1.0', '+1', '1px', 'auto', '100%', '1 1', '-1', '0'],
  'border-image-outset': ['0', '0.0', '0px', '-0', '+0', '1', '-1', '0 0', '0%'],
  'border-image-repeat': ['stretch', 'STRETCH', 'stretch stretch', 'round', 'space repeat', 'stretch stretch stretch', 'no-repeat', 'bogus'],
  'border-image': ['none', 'NONE', 'none 100%', 'stretch', '100%', 'none / 1', 'none 100% / 1 / 0 stretch', 'url(b.png) 30 round', 'linear-gradient(red, blue) 1', 'none none', 'none, none'],
  '-webkit-border-image': ['none', 'NONE', 'None', 'none 100%', 'stretch', 'url(b.png) 10 / 4px', 'linear-gradient(red, blue) 1', 'none none', 'bogus'],
};
// The border widths are read too: -webkit-border-image sets them from the lengths of its width part.
const READ = [...BORDER_IMAGE_LONGHANDS, 'border-top-width', 'border-left-width'];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.name}: ${it.v}: invalid, Chrome parses it`] : [];
    if (it.code !== null) return [`${it.name}: ${it.v}: unexpected ${it.code}`];
    if (it.longhands === null) return [];
    if (!s.parsed) return [`${it.name}: ${it.v}: accepted, Chrome drops it`];
    return s.authored !== s.dragon ? [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's longhands compute ${s.dragon}`] : [];
  });
}

describe('border-image: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon drops no value Chrome keeps, every accepted value computes to the initial values from every name, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const initial = (p: string, text: string): (readonly [string, string])[] => [[p, text]];
    const all = (source: string): (readonly [string, string])[] => [['border-image-source', source], ['border-image-slice', '100%'], ['border-image-width', '1'], ['border-image-outset', '0'], ['border-image-repeat', 'stretch']];
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'imageDropped', items: [{ name: 'border-image-source', v: 'url(b.png)', code: 'DRAGON_CSS_INVALID_VALUE', longhands: null }] },
      { name: 'shorthandDropped', items: [{ name: '-webkit-border-image', v: 'url(b.png) 10 / 4px', code: 'DRAGON_CSS_INVALID_VALUE', longhands: null }] },
      { name: 'pxOutsetReadAsInitial', items: [{ name: 'border-image-outset', v: '0px', code: null, longhands: initial('border-image-outset', '0') }] },
      { name: 'fillReadAsInitial', items: [{ name: 'border-image-slice', v: '100% fill', code: null, longhands: initial('border-image-slice', '100%') }] },
      { name: 'webkitWidthsReadAsInitial', items: [{ name: '-webkit-border-image', v: 'none 100% / 4px', code: null, longhands: all('none') }] },
      { name: 'imageListReadAsNone', items: [{ name: 'border-image-source', v: 'none, none', code: null, longhands: initial('border-image-source', 'none') }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><style>span { display: block; border: 3px solid; }</style><div><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's longhands on #c, both read as the
      // five border image longhands and two border widths.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        const read = (e) => ${JSON.stringify(READ)}.map((p) => getComputedStyle(e).getPropertyValue(p)).join(' | ');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.name, it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        for (const [p, v] of it.longhands ?? []) c.style.setProperty(p, v);
        return { parsed, authored: read(a), dragon: read(c) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.longhands !== null).length).toBe(16);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBeGreaterThan(30);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});

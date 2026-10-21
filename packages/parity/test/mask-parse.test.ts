// The mask parse against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES; Blink's MaskImage through MaskSize, Mask and
// MaskPosition parsers): Dragon drops no value Chrome keeps, through every mask name and its -webkit- alias, and every value Dragon
// accepts computes in Chrome as Dragon's own longhands do: the nine initial values, or -webkit-mask-composite's source-over. Every
// other value is kept and then refused (MASK-CLIP, computed-checks.ts checkMask), so only the accepted values' computed values are
// compared. Each value is parsed in a style sheet, as Dragon parses it: CSSOM setProperty would also try an alias as its resolved
// property (CSSParser::ParseValue), which keeps -webkit-mask-composite: add. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import type { MaskLonghand } from '../../dragon/src/css/properties/mask.ts';
import { MASK_LONGHANDS, maskDeclarationName } from '../../dragon/src/css/properties/mask.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/mask.css', revision: 'r1', hash: 'sha256:0' };

/** code: Dragon's diagnostic, or null; longhands: the longhands Dragon sets as [property, text] when every one is initial, else null. */
type Item = { readonly name: string; readonly v: string; readonly code: string | null; readonly longhands: readonly (readonly [string, string])[] | null };
/** An item as the page sets it: the authored declaration, and Dragon's longhands under the names web output writes them with. */
type PageItem = { readonly authored: string; readonly dragon: string | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && (longhands.length === 0 || !longhands.every((l) => (MASK_LONGHANDS as readonly string[]).includes(l.property)))) throw new Error(`${name}: ${v}: accepted without mask longhands`);
  const accepted = code === null && longhands.every((l) => l.value.kind !== 'other');
  return { name, v, code, longhands: accepted ? longhands.map((l) => [maskDeclarationName(l.property as MaskLonghand, l.value), valueToString(l.value)] as const) : null };
}

const toPageItem = (it: Item): PageItem => ({ authored: `${it.name}: ${it.v}`, dragon: it.longhands === null ? null : it.longhands.map(([p, v]) => `${p}: ${v}`).join('; ') });

const VALUES: { readonly [name: string]: readonly string[] } = {
  'mask-image': ['none', 'NONE', 'None', 'url(m.svg)', 'linear-gradient(black, transparent)', 'none, none', 'none url(m.svg)', 'bogus'],
  'mask-repeat': ['repeat', 'REPEAT', 'repeat repeat', 'no-repeat', 'repeat-x', 'space round', 'repeat, repeat', 'bogus'],
  'mask-size': ['auto', 'AUTO', 'auto auto', 'cover', '10px', '-1px', 'auto, auto'],
  'mask-origin': ['border-box', 'BORDER-BOX', 'padding-box', 'border', 'fill-box', 'no-clip'],
  'mask-clip': ['border-box', 'Border-Box', 'no-clip', 'text', 'border', 'padding-box'],
  'mask-composite': ['add', 'ADD', 'subtract', 'source-over', 'SOURCE-OVER', 'add, add', 'xor', 'source-over, source-over', 'highlight', 'bogus'],
  'mask-mode': ['match-source', 'MATCH-SOURCE', 'alpha', 'luminance', 'auto'],
  '-webkit-mask-position-x': ['0%', '-0%', '0', '0px', 'left', 'left 0%', '10px', 'center', '0%, 0%'],
  '-webkit-mask-position-y': ['0%', '0', 'top', 'bottom', '50%'],
  'mask-position': ['0% 0%', '0%', 'left top', 'top left', 'center', '0% 0% 0%', '0 0', '10px 20%, left top'],
  mask: ['none', 'NONE', 'none, none', 'none none', 'url(m.svg)', 'url(m.svg) no-repeat center / contain', 'linear-gradient(red, blue) add'],
};
const ALIASES: readonly (readonly [string, string])[] = [
  ['-webkit-mask', 'mask'], ['-webkit-mask-clip', 'mask-clip'], ['-webkit-mask-composite', 'mask-composite'], ['-webkit-mask-image', 'mask-image'],
  ['-webkit-mask-origin', 'mask-origin'], ['-webkit-mask-position', 'mask-position'], ['-webkit-mask-repeat', 'mask-repeat'], ['-webkit-mask-size', 'mask-size'],
];

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

describe('mask: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon drops no value Chrome keeps, every accepted value computes to the initial values from either name, and the plants are caught', async () => {
    const real = [...Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v))), ...ALIASES.flatMap(([alias, p]) => (VALUES[p] as readonly string[]).map((v) => item(alias, v)))];
    const initial = (p: string, text: string): (readonly [string, string])[] => [[p, text]];
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'listDropped', items: [{ name: 'mask-image', v: 'url(m.svg)', code: 'DRAGON_CSS_INVALID_VALUE', longhands: null }] },
      { name: 'aliasCompositeDropped', items: [{ name: '-webkit-mask-composite', v: 'source-over', code: 'DRAGON_CSS_INVALID_VALUE', longhands: null }] },
      { name: 'aliasAddAccepted', items: [{ name: '-webkit-mask-composite', v: 'add', code: null, longhands: initial('mask-composite', 'add') }] },
      { name: 'sourceOverReadAsAdd', items: [{ name: '-webkit-mask-composite', v: 'source-over', code: null, longhands: initial('mask-composite', 'add') }] },
      { name: 'unitlessZeroReadAsInitial', items: [{ name: '-webkit-mask-position-x', v: '0', code: null, longhands: initial('-webkit-mask-position-x', '0%') }] },
      { name: 'oneValuePositionReadAsInitial', items: [{ name: 'mask-position', v: '0%', code: null, longhands: [['-webkit-mask-position-x', '0%'], ['-webkit-mask-position-y', '0%']] }] },
      { name: 'imageListReadAsNone', items: [{ name: 'mask-image', v: 'none, none', code: null, longhands: initial('mask-image', 'none') }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)].map((items) => items.map(toPageItem));
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored declaration on #a, Dragon's longhands on #c, each in a
      // style sheet rule, both read as the nine mask longhands. A dropped declaration leaves its rule empty.
      seen = (await page.evaluate(`(() => {
        const sheet = document.head.appendChild(document.createElement('style'));
        const a = document.getElementById('a'), c = document.getElementById('c');
        const read = (e) => ${JSON.stringify(MASK_LONGHANDS)}.map((p) => getComputedStyle(e).getPropertyValue(p)).join(' | ');
        return (${JSON.stringify(sets)}).map((items) => items.map((it) => {
          sheet.textContent = '#a { ' + it.authored + '; } #c { ' + (it.dragon ?? '') + '; }';
          const rules = sheet.sheet.cssRules;
          if (rules.length !== 2) throw new Error('the rules did not parse: ' + sheet.textContent);
          if (it.dragon !== null && it.dragon !== '' && rules[1].style.length === 0) throw new Error('Dragon longhands did not parse: ' + it.dragon);
          return { parsed: rules[0].style.length > 0, authored: read(a), dragon: read(c) };
        }));
      })()`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    // The 36 accepted spellings (the initial values and -webkit-mask-composite's source-over), and border under -webkit-mask-clip and
    // -webkit-mask-origin (aliases/mask.ts prefixedMaskBox).
    expect(real.filter((it) => it.longhands !== null).length).toBe(38);
    expect(real.filter((it) => it.name === '-webkit-mask-composite' && it.longhands !== null).map((it) => it.v)).toEqual(['source-over', 'SOURCE-OVER']);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBeGreaterThan(80);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});

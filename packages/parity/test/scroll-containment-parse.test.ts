// The overscroll, scroll-snap and containment parse against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES,
// css/properties/initial-only.ts): Dragon drops no value Chrome keeps, and every value Dragon accepts as initial computes in Chrome to
// the initial values of the longhands it sets, as Dragon's own longhands do. Every other value is kept and then refused
// (analysis/scroll-containment.ts), so only the accepted values' computed values are compared. contain parses every value itself
// (css/properties/containment.ts parseContain), and its accepted values must compute in Chrome as Dragon's do. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { CONTAINMENT_LONGHANDS } from '../../dragon/src/css/properties/containment.ts';
import { OVERSCROLL_LONGHANDS } from '../../dragon/src/css/properties/overscroll.ts';
import { SCROLL_SNAP_LONGHANDS } from '../../dragon/src/css/properties/scroll-snap.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/scroll-containment.css', revision: 'r1', hash: 'sha256:0' };
const LONGHANDS: readonly string[] = [...OVERSCROLL_LONGHANDS, ...SCROLL_SNAP_LONGHANDS, ...CONTAINMENT_LONGHANDS];

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
  if (code === null && (longhands.length === 0 || !longhands.every((l) => LONGHANDS.includes(l.property)))) throw new Error(`${name}: ${v}: accepted without the family's longhands`);
  const accepted = code === null && longhands.every((l) => l.value.kind !== 'other');
  return { name, v, code, longhands: accepted ? longhands.map((l) => [l.property, valueToString(l.value)] as const) : null };
}

const VALUES: { readonly [name: string]: readonly string[] } = {
  'overscroll-behavior': ['auto', 'AUTO', 'auto auto', 'auto contain', 'none', 'chain', 'auto auto auto'],
  'overscroll-behavior-x': ['auto', 'Auto', 'contain', 'none', 'chain', 'auto auto'],
  'overscroll-behavior-y': ['auto', 'contain'],
  'overscroll-behavior-inline': ['auto', 'none'],
  'overscroll-behavior-block': ['AUTO', 'contain'],
  'overflow-anchor': ['auto', 'AUTO', 'none', 'visible'],
  'scroll-padding': ['auto', 'auto auto', 'auto auto auto', 'AUTO auto auto Auto', 'auto auto auto auto auto', '0', '10px', '-1px', '10%'],
  'scroll-padding-top': ['auto', 'AUTO', '0', '4px', '-4px'],
  'scroll-padding-right': ['auto', '10%'],
  'scroll-padding-bottom': ['auto'],
  'scroll-padding-left': ['auto', 'none'],
  'scroll-padding-inline': ['auto', 'auto auto', 'auto 0', 'auto auto auto'],
  'scroll-padding-inline-start': ['auto', '3px'],
  'scroll-padding-inline-end': ['auto'],
  'scroll-padding-block': ['auto', 'Auto AUTO', '1em'],
  'scroll-padding-block-start': ['auto'],
  'scroll-padding-block-end': ['auto', '0px'],
  'scroll-margin': ['0', '0px', '0 0', '0 0px 0', '0 0 0 0', '-0', '+0', '0PX', '0 0 0 0 0', '1px', '0em', '0%', 'auto'],
  'scroll-margin-top': ['0', '0px', '-0px', '0.0', '0e0', '2px', '-2px', '0%', '0em'],
  'scroll-margin-right': ['0'],
  'scroll-margin-bottom': ['0px'],
  'scroll-margin-left': ['0', '1px'],
  'scroll-margin-inline': ['0', '0 0', '0 1px'],
  'scroll-margin-inline-start': ['0'],
  'scroll-margin-inline-end': ['0px'],
  'scroll-margin-block': ['0', '0px 0', '0 0 0'],
  'scroll-margin-block-start': ['0'],
  'scroll-margin-block-end': ['0'],
  'scroll-snap-type': ['none', 'NONE', 'x', 'y mandatory', 'both proximity', 'none mandatory', 'pair', 'block'],
  'scroll-snap-align': ['none', 'None', 'none none', 'start', 'center end', 'none start', 'left'],
  'scroll-snap-stop': ['normal', 'NORMAL', 'always', 'none'],
  contain: ['none', 'NONE', 'strict', 'content', 'size', 'inline-size', 'layout paint', 'style', 'none none', 'view-transition', 'PAINT', 'paint layout', 'size layout style paint', 'style paint layout', 'inline-size layout', 'layout layout', 'size inline-size', 'strict layout', 'none layout', '1px'],
  'content-visibility': ['visible', 'VISIBLE', 'hidden', 'auto', 'none'],
  'contain-intrinsic-size': ['none', 'NONE', 'none none', 'none none none', 'auto none', '10px', 'auto 10px none', '-1px'],
  'contain-intrinsic-width': ['none', 'None', 'auto none', '10px', 'auto', '-1px', '0'],
  'contain-intrinsic-height': ['none', 'auto 5px'],
  'contain-intrinsic-inline-size': ['none', '1px'],
  'contain-intrinsic-block-size': ['NONE', 'auto none'],
};

/** How many of VALUES Dragon accepts as initial (pinned so a parser change that accepts more or fewer is seen). */
const ACCEPTED = 80;
/** The contain values Dragon reads as invalid, all of which Chrome 145 drops (judge). */
const CONTAIN_INVALID = ['none none', 'view-transition', 'layout layout', 'size inline-size', 'strict layout', 'none layout', '1px'];

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

describe('overscroll, scroll-snap and containment: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon drops no value Chrome keeps, every accepted value computes to the initial values, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'snapTypeDropped', items: [{ name: 'scroll-snap-type', v: 'y mandatory', code: 'DRAGON_CSS_INVALID_VALUE', longhands: null }] },
      { name: 'paddingLengthReadAsInitial', items: [{ name: 'scroll-padding-top', v: '4px', code: null, longhands: [['scroll-padding-top', 'auto']] }] },
      { name: 'marginEmReadAsInitial', items: [{ name: 'scroll-margin-top', v: '1em', code: null, longhands: [['scroll-margin-top', '0px']] }] },
      { name: 'threeValueAccepted', items: [{ name: 'overscroll-behavior', v: 'auto auto auto', code: null, longhands: [['overscroll-behavior-x', 'auto'], ['overscroll-behavior-y', 'auto']] }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's longhands on #c, both read as every
      // longhand of the three families.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        const read = (e) => ${JSON.stringify(LONGHANDS)}.map((p) => getComputedStyle(e).getPropertyValue(p)).join(' | ');
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
    // contain parses itself (CONTAIN), so the values Chrome drops are invalid there rather than unadmitted.
    expect(real.filter((it) => it.code !== null).map((it) => `${it.name}: ${it.v}`)).toEqual(CONTAIN_INVALID.map((v) => `contain: ${v}`));
    expect(real.filter((it) => it.longhands !== null).length).toBe(ACCEPTED);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBeGreaterThan(120);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});

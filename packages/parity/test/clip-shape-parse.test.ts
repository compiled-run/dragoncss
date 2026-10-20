// The clip-path circle(), ellipse() and polygon() parse against Chrome 145 (properties/clip-path.ts): Dragon drops no value Chrome
// keeps, every value Dragon accepts Chrome keeps and computes to the text Dragon computes, and every value Dragon refuses is one
// Chrome keeps; -webkit-clip-path parses and computes as clip-path. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { chromeClipPathText } from '../../dragon/src/css/properties/clip-path.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/clip-shape.css', revision: 'r1', hash: 'sha256:0' };

/** code: Dragon's diagnostic, or null; value: the text Dragon computes when it accepts the value, else null. */
type Item = { readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly computed: string; readonly alias: string };

function item(v: string): Item {
  const css = `.a { clip-path: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const lh = rules[0]?.declarations[0]?.longhands ?? [];
  const value = code !== null ? null : lh[0]?.value.kind === 'other' ? chromeClipPathText(lh[0].value) : null;
  if (code === null && value === null) throw new Error(`${v}: accepted without a shape`);
  return { v, code, value };
}

// No em, rem or absolute lengths but px (they compute to px later): what Dragon parses is then what Chrome computes.
const VALUES: readonly string[] = [
  'circle()', 'circle(10px)', 'circle(50%)', 'circle(closest-side)', 'circle(farthest-side)', 'circle(closest-corner)', 'circle(farthest-corner)', 'circle(0)',
  'circle(-1px)', 'circle(1e1px)', 'circle(10.123456px)', 'circle(1234567px)', 'inset(1234567px)', 'inset(1234.5678px 2px)', 'circle(10px at right 1000000px top 0)', 'circle(10px 20px)', 'circle(1)', 'CIRCLE(10PX AT LEFT 5PX)', 'circle(10px) border-box',
  'border-box circle(1px)', 'circle(10px) padding-box', 'circle(calc(10px + 5%))', 'circle(1vw)',
  'circle(at left top)', 'circle(at top left)', 'circle(10px at 20px 30%)', 'circle(at right 10px top 5px)', 'circle(at center)', 'circle(at top)', 'circle(at left)',
  'circle(at 10px)', 'circle(at 0)', 'circle(at bottom 10% right 20%)', 'circle(at left 10px bottom 5px)', 'circle(at left 10px top 5px)', 'circle(at right 0px top 0px)',
  'circle(at right 10% bottom 5px)', 'circle(at bottom 5px right 10px)', 'circle(at right top)', 'circle(at 10px top)', 'circle(at right 10px top 0)',
  'circle(at left 0px bottom 1px)', 'circle(at 0px 0px)', 'circle(at 0 10px)', 'circle(at right 10px)', 'circle(at 10px bottom)', 'circle(at bottom left)',
  'circle(at -10px -20%)', 'circle(at right 33.3333% top 0)', 'circle(at right -5px top 3px)', 'circle(at right 0.5px top 3px)', 'circle(at 1.5px 2.25px)',
  'circle(at right 10px bottom)', 'circle(at left 10px top)', 'circle(at center top 5px)', 'circle(at right 10px center)', 'circle(at top 10px)', 'circle(at 10px 20px 30px)',
  'circle(at left right)', 'circle(at top bottom)', 'circle(at center center)', 'circle(at center left)', 'circle(at 10px left)', 'circle(at)', 'circle(10px at)',
  'circle(closest-side at center)', 'circle(farthest-side at left)', 'circle(at 50%)', 'circle(at 66.6667% 0)',
  'ellipse()', 'ellipse(10px 20px)', 'ellipse(10px)', 'ellipse(1px 2px 3px)', 'ellipse(closest-side closest-side)', 'ellipse(closest-side 10px)',
  'ellipse(10px closest-side at 0 0)', 'ellipse(closest-side farthest-side at 10% 20%)', 'ellipse(50% 50%)', 'ellipse(0 0)', 'ellipse(-1px 2px)',
  'ellipse(closest-corner farthest-corner)', 'ellipse(farthest-side farthest-side)', 'ellipse(at right 4px bottom 2px)',
  'polygon(0 0, 100% 0, 50% 100%)', 'polygon(evenodd, 0 0, 10px 0, 10px 10px)', 'polygon(nonzero, 0 0, 10px 0, 10px 10px)', 'polygon(EVENODD, 0 0, 1px 1px)',
  'polygon(0 0)', 'polygon()', 'polygon(0 0, 1px)', 'polygon(evenodd 0 0, 1px 1px)', 'polygon(0 0 round 4px, 10px 0, 10px 10px)', 'polygon(bogus, 0 0)',
  'polygon(1 0)', 'polygon(-5px -5px, 10% 0, 0 110%)', 'polygon(0px 0px,10px 0px,5px 10px) border-box', 'polygon(0px 0px, 10px 0px) content-box',
  'polygon(evenodd)', 'polygon(0 0,)', 'polygon(, 0 0)', 'polygon(0 0, 2000000px 0, 0 10px)',
  'path("M0 0 L10 0 L5 10 Z")', 'shape(from 0 0, line to 10px 10px)', 'rect(0 1px 2px 3px)', 'xywh(0 0 1px 1px)',
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.v}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${it.v}: refused, Chrome drops it`];
    if (it.code !== null) return [`${it.v}: unexpected ${it.code}`];
    if (!s.parsed) return [`${it.v}: accepted, Chrome drops it`];
    return s.computed !== it.value ? [`${it.v}: Chrome computes ${s.computed}, Dragon ${it.value}`] : [];
  });
}

describe('clip-path circle(), ellipse() and polygon(): Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon drops no value Chrome keeps, every accepted shape computes alike, and the plants are caught', async () => {
    const real = VALUES.map(item);
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'circleDropped', items: [{ v: 'circle(10px)', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
      { name: 'cornerAccepted', items: [{ v: 'circle(closest-corner)', code: null, value: 'circle(closest-corner)' }] },
      { name: 'positionKept', items: [{ v: 'circle(at right 10% bottom 5px)', code: null, value: 'circle(at right 10% bottom 5px)' }] },
      { name: 'nonzeroKept', items: [{ v: 'polygon(nonzero, 0 0, 10px 0, 10px 10px)', code: null, value: 'polygon(nonzero, 0px 0px, 10px 0px, 10px 10px)' }] },
      { name: 'closestSideKept', items: [{ v: 'ellipse(closest-side closest-side)', code: null, value: 'ellipse(closest-side closest-side)' }] },
      { name: 'refusedDropped', items: [{ v: 'polygon()', code: 'DRAGON_UNSUPPORTED_VALUE', value: null }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div id="a" style="width: 100px; height: 50px"></div>');
      // A string expression: this test project has no DOM types.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a');
        a.style.removeProperty('clip-path');
        a.style.setProperty('-webkit-clip-path', it.v);
        const alias = a.style.getPropertyValue('-webkit-clip-path') === '' ? null : getComputedStyle(a).getPropertyValue('clip-path');
        a.style.removeProperty('clip-path');
        a.style.setProperty('clip-path', it.v);
        const parsed = a.style.getPropertyValue('clip-path') !== '';
        const computed = getComputedStyle(a).getPropertyValue('clip-path');
        return { parsed, computed, alias: alias === (parsed ? computed : null) ? 'alike' : String(alias) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    // -webkit-clip-path (aliases/clip-path.ts): Chrome parses and computes every value as clip-path.
    expect(real.filter((_, i) => (seen[0] as Seen[])[i]?.alias !== 'alike').map((it) => it.v)).toEqual([]);
    expect(real.filter((it) => it.value !== null).length).toBeGreaterThanOrEqual(60);
    expect(real.filter((it) => it.code === 'DRAGON_UNSUPPORTED_VALUE').map((it) => it.v)).toEqual(['circle(10px) padding-box', 'circle(calc(10px + 5%))', 'circle(1vw)', 'polygon(0px 0px, 10px 0px) content-box', 'path("M0 0 L10 0 L5 10 Z")', 'shape(from 0 0, line to 10px 10px)', 'rect(0 1px 2px 3px)', 'xywh(0 0 1px 1px)']);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});

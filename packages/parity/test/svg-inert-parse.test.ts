// The SVG-inert-b grammars against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES and FIELD_OVERRIDES): Dragon accepts a
// value of stop-color, stop-opacity, flood-color, flood-opacity, lighting-color, mask-type, text-anchor, dominant-baseline and
// alignment-baseline exactly when Chrome parses it, and an accepted value computes in Chrome as Dragon's value does. Each planted
// reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/svg-inert.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly p: string; readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(p: string, v: string): Item {
  const css = `.a { ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${p}: ${v}: more than one diagnostic`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  const code = diagnostics[0]?.code ?? null;
  if (code === null && longhands.length !== 1) throw new Error(`${p}: ${v}: accepted without exactly one longhand`);
  return { p, v, code, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const BASELINES = ['auto', 'baseline', 'alphabetic', 'ideographic', 'middle', 'central', 'mathematical', 'hanging', 'before-edge', 'after-edge', 'text-before-edge', 'text-after-edge', 'use-script', 'no-change', 'reset-size', 'text-top', 'text-bottom', 'top', 'bottom', 'MIDDLE', 'Central', 'first', 'last baseline', 'middle central', '0', '10px', 'none'];
const COLORS = ['red', 'currentcolor', 'transparent', 'rgb(1 2 3 / 50%)', 'hsl(120 50% 50%)', '#abc', 'none', 'auto', 'url(#a)', 'red blue', '0'];
const OPACITIES = ['0.5', '50%', '150%', '-1', '2', '0', '1', 'calc(0.2 + 0.1)', 'none', 'auto', '1px', '0.5 0.5'];
const KEYS: { readonly [p: string]: readonly string[] } = {
  'mask-type': ['luminance', 'alpha', 'ALPHA', 'none', 'auto', 'match-source', 'alpha luminance'],
  'text-anchor': ['start', 'middle', 'end', 'END', 'left', 'center', 'auto', 'none', 'start end'],
  'dominant-baseline': BASELINES,
  'alignment-baseline': BASELINES,
};
const VALUES: readonly (readonly [string, string])[] = [
  ...['stop-color', 'flood-color', 'lighting-color'].flatMap((p) => COLORS.map((v) => [p, v] as const)),
  ...['stop-opacity', 'flood-opacity'].flatMap((p) => OPACITIES.map((v) => [p, v] as const)),
  ...Object.entries(KEYS).flatMap(([p, vs]) => vs.map((v) => [p, v] as const)),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === null) {
      if (!s.parsed) return [`${it.p}: ${it.v}: accepted, Chrome drops it`];
      return s.authored === s.dragon ? [] : [`${it.p}: ${it.v}: Chrome computes ${s.authored}, Dragon's ${String(it.value)} computes ${s.dragon}`];
    }
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.p}: ${it.v}: invalid, Chrome parses it`] : [];
    return [`${it.p}: ${it.v}: unexpected ${it.code}`];
  });
}

describe('the SVG-inert-b longhands: Chrome 145 parsing and computed values', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon accepts exactly the values Chrome parses and computes them alike, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'textTopAccepted', items: real.filter((it) => it.p === 'alignment-baseline' && it.v === 'text-top').map((it) => ({ ...it, code: null, value: 'text-top' })) },
      { name: 'beforeEdgeRefused', items: real.filter((it) => it.p === 'alignment-baseline' && it.v === 'before-edge').map((it) => ({ ...it, code: 'DRAGON_CSS_INVALID_VALUE', value: null })) },
      { name: 'useScriptAsAuto', items: real.filter((it) => it.p === 'dominant-baseline' && it.v === 'use-script').map((it) => ({ ...it, value: 'auto' })) },
      { name: 'opacityUnclamped', items: real.filter((it) => it.p === 'stop-opacity' && it.v === '150%').map((it) => ({ ...it, value: '0.5' })) },
      { name: 'stopColorNone', items: real.filter((it) => it.p === 'stop-color' && it.v === 'none').map((it) => ({ ...it, code: null, value: 'none' })) },
    ];
    for (const p of planted) expect(p.items.length, p.name).toBeGreaterThan(0);
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="color: rgb(0, 0, 255)"><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's value on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.p, it.v);
        const parsed = a.style.getPropertyValue(it.p) !== '';
        if (it.value !== null) c.style.setProperty(it.p, it.value);
        return { parsed, authored: getComputedStyle(a).getPropertyValue(it.p), dragon: getComputedStyle(c).getPropertyValue(it.p) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    for (const [p] of VALUES) expect(real.filter((it) => it.p === p && it.code === null).length, p).toBeGreaterThan(1);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});

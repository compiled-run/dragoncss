// image-rendering, the anchor positioning longhands and the svg-extra, view-transition and animation-extra longhands parse against Chrome 145 (scripts/gen-css-grammar.ts
// SYNTAX_OVERRIDES, css/properties/initial-only.ts): Dragon drops no value Chrome keeps, and every value Dragon accepts as initial
// computes in Chrome to the initial values of the longhands it sets, as Dragon's own longhands do. Every other value is kept and then
// refused (analysis/scroll-containment.ts), so only the accepted values' computed values are compared. Each planted reading must be
// caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { ANCHOR_POSITION_LONGHANDS } from '../../dragon/src/css/properties/anchor-position.ts';
import { IMAGE_RENDERING_LONGHANDS } from '../../dragon/src/css/properties/image-rendering.ts';
import { SVG_EXTRA_LONGHANDS } from '../../dragon/src/css/properties/svg-extra.ts';
import { VIEW_TRANSITION_LONGHANDS } from '../../dragon/src/css/properties/view-transition.ts';
import { ANIMATION_EXTRA_LONGHANDS } from '../../dragon/src/css/properties/animation-extra.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/render-anchor.css', revision: 'r1', hash: 'sha256:0' };
const LONGHANDS: readonly string[] = [...IMAGE_RENDERING_LONGHANDS, ...ANCHOR_POSITION_LONGHANDS, ...SVG_EXTRA_LONGHANDS, ...VIEW_TRANSITION_LONGHANDS, ...ANIMATION_EXTRA_LONGHANDS];

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
  'image-rendering': ['auto', 'AUTO', 'smooth', 'high-quality', 'pixelated', 'crisp-edges', 'optimizeSpeed', 'optimizeQuality', '-webkit-optimize-contrast', 'auto auto', 'none'],
  'anchor-name': ['none', 'NONE', '--a', '--a, --b', 'none, --a', 'a', 'none none'],
  'anchor-scope': ['none', 'None', 'all', '--a', '--a, --b', 'none --a'],
  'position-anchor': ['none', 'NONE', 'normal', 'auto', '--a', 'match-parent', 'none none'],
  'position-area': ['none', 'NONE', 'top', 'top left', 'span-all', 'center', 'none none'],
  'position-try-order': ['normal', 'NORMAL', 'most-width', 'most-height', 'most-block-size', 'most-inline-size', 'none'],
  'position-try-fallbacks': ['none', 'None', 'flip-block', '--a', 'flip-block, --a', 'top', 'none none'],
  'position-try': ['none', 'NONE', 'normal none', 'Normal None', 'none normal', 'normal', 'most-width --a', 'flip-block', 'normal none none'],
  'position-visibility': ['anchors-visible', 'ANCHORS-VISIBLE', 'anchor-visible', 'always', 'no-overflow', 'anchors-visible no-overflow', 'none'],
  'stop-opacity': ['1', '1.0', '+1', '1e0', '100%', '0.5', '0', '2', 'none'],
  'flood-opacity': ['1', '1.00', '50%', '0.2', '-1'],
  'mask-type': ['luminance', 'LUMINANCE', 'alpha', 'none'],
  'text-anchor': ['start', 'START', 'middle', 'end', 'left'],
  'dominant-baseline': ['auto', 'AUTO', 'middle', 'central', 'alphabetic', 'hanging', 'baseline'],
  'alignment-baseline': ['auto', 'AUTO', 'baseline', 'middle', 'central', 'none'],
  'baseline-shift': ['0', '0px', '0PX', '-0', '0em', '0%', 'sub', 'super', '2px', '10%', 'baseline'],
  'shape-rendering': ['auto', 'AUTO', 'optimizeSpeed', 'crispEdges', 'geometricPrecision', 'none'],
  'color-interpolation': ['srgb', 'sRGB', 'SRGB', 'auto', 'linearRGB', 'none'],
  'color-interpolation-filters': ['linearrgb', 'linearRGB', 'auto', 'sRGB', 'none'],
  'color-rendering': ['auto', 'AUTO', 'optimizeSpeed', 'optimizeQuality', 'none'],
  'buffered-rendering': ['auto', 'AUTO', 'static', 'dynamic', 'none'],
  'view-transition-name': ['none', 'NONE', 'auto', 'match-element', 'card', '--card', 'none none'],
  'view-transition-class': ['none', 'None', 'a', 'a b', 'none a'],
  'view-transition-group': ['normal', 'NORMAL', 'contain', 'nearest', 'card', 'none'],
  'interpolate-size': ['numeric-only', 'NUMERIC-ONLY', 'allow-keywords', 'auto'],
  'timeline-scope': ['none', 'NONE', 'all', '--t', '--a, --b', 'none --a'],
};

/** How many of VALUES Dragon accepts as initial (pinned so a parser change that accepts more or fewer is seen). */
const ACCEPTED = 59;

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

describe('image-rendering, anchor positioning and svg-extra: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon drops no value Chrome keeps, every accepted value computes to the initial values, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'renderingDropped', items: [{ name: 'image-rendering', v: 'pixelated', code: 'DRAGON_CSS_INVALID_VALUE', longhands: null }] },
      { name: 'pixelatedReadAsInitial', items: [{ name: 'image-rendering', v: 'pixelated', code: null, longhands: [['image-rendering', 'auto']] }] },
      { name: 'anchorAutoReadAsInitial', items: [{ name: 'position-anchor', v: 'auto', code: null, longhands: [['position-anchor', 'none']] }] },
      { name: 'tryFallbackReadAsInitial', items: [{ name: 'position-try', v: 'flip-block', code: null, longhands: [['position-try-order', 'normal'], ['position-try-fallbacks', 'none']] }] },
      { name: 'halfOpacityReadAsInitial', items: [{ name: 'stop-opacity', v: '0.5', code: null, longhands: [['stop-opacity', '1']] }] },
      { name: 'viewNameReadAsInitial', items: [{ name: 'view-transition-name', v: 'card', code: null, longhands: [['view-transition-name', 'none']] }] },
      { name: 'keywordsReadAsInitial', items: [{ name: 'interpolate-size', v: 'allow-keywords', code: null, longhands: [['interpolate-size', 'numeric-only']] }] },
      { name: 'webrefVisibilityAccepted', items: [{ name: 'position-visibility', v: 'anchor-visible', code: null, longhands: [['position-visibility', 'anchors-visible']] }] },
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
    expect(real.filter((it) => it.code !== null)).toEqual([]);
    expect(real.filter((it) => it.longhands !== null).length).toBe(ACCEPTED);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBeGreaterThan(100);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);

  it('position-try puts each part of a value Chrome keeps in the longhand Chrome does, so a refusal names it', async () => {
    const values = ['flip-block', 'most-width --a', 'normal --a, flip-inline', 'most-height none', 'most-block-size flip-start, top', '--a'];
    /** Dragon's position-try-order and position-try-fallbacks as written, commas without the space before them. */
    const dragon = values.map((v) => {
      const css = `.a { position-try: ${v}; }`;
      const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, []);
      return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => valueToString(l.value).replace(/ ,/g, ',')).join(' | ');
    });
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<{ newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> }> };
    const browser = await launchChrome();
    let chrome: string[];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div id="a"></div>');
      chrome = (await page.evaluate(`(${JSON.stringify(values)}).map((v) => {
        const a = document.getElementById('a');
        a.removeAttribute('style');
        a.style.setProperty('position-try', v);
        return a.style.getPropertyValue('position-try-order') + ' | ' + a.style.getPropertyValue('position-try-fallbacks');
      })`)) as string[];
    } finally {
      await browser.close();
    }
    expect(dragon).toEqual(chrome);
  }, 120_000);
});

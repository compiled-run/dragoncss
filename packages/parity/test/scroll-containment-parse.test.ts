// The overscroll, scroll-snap, containment and container-query parse against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES,
// css/properties/initial-only.ts, css/properties/scroll-snap.ts): Dragon drops what Chrome drops and no value Chrome keeps, and every
// value Dragon accepts computes in Chrome to what the longhands it sets compute to, in an ltr and an rtl box (the flow-relative scroll
// names map onto the physical longhands by direction). The initial-only families accept their initial values alone and keep every
// other value to refuse it (analysis/scroll-containment.ts), so only their accepted values' computed values are compared; the
// scroll-snap family accepts every value it parses. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { CONTAINER_QUERY_LONGHANDS } from '../../dragon/src/css/properties/container-query.ts';
import { CONTAINMENT_LONGHANDS } from '../../dragon/src/css/properties/containment.ts';
import { NON_INITIAL_VALUE_TYPE } from '../../dragon/src/css/properties/initial-only.ts';
import { OVERSCROLL_LONGHANDS } from '../../dragon/src/css/properties/overscroll.ts';
import { SCROLL_SNAP_LONGHANDS } from '../../dragon/src/css/properties/scroll-snap.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/scroll-containment.css', revision: 'r1', hash: 'sha256:0' };
const LONGHANDS: readonly string[] = [...OVERSCROLL_LONGHANDS, ...SCROLL_SNAP_LONGHANDS, ...CONTAINMENT_LONGHANDS, ...CONTAINER_QUERY_LONGHANDS];

type Pairs = readonly (readonly [string, string])[];
/** code: Dragon's diagnostic, or null; ltr, rtl: the longhands Dragon sets in each direction as [property, text] when it accepts the value, else null. */
type Item = { readonly name: string; readonly v: string; readonly code: string | null; readonly ltr: Pairs | null; readonly rtl: Pairs | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && (longhands.length === 0 || !longhands.every((l) => LONGHANDS.includes(l.property)))) throw new Error(`${name}: ${v}: accepted without the family's longhands`);
  const accepted = code === null && longhands.every((l) => !(l.value.kind === 'other' && l.value.type === NON_INITIAL_VALUE_TYPE));
  const of = (dir: 'ltr' | 'rtl'): Pairs => longhands.filter((l) => l.direction === undefined || l.direction === dir).map((l) => [l.property, valueToString(l.value)] as const);
  return { name, v, code, ltr: accepted ? of('ltr') : null, rtl: accepted ? of('rtl') : null };
}

const VALUES: { readonly [name: string]: readonly string[] } = {
  'overscroll-behavior': ['auto', 'AUTO', 'auto auto', 'auto contain', 'none', 'chain', 'auto auto auto'],
  'overscroll-behavior-x': ['auto', 'Auto', 'contain', 'none', 'chain', 'auto auto'],
  'overscroll-behavior-y': ['auto', 'contain'],
  'overscroll-behavior-inline': ['auto', 'none'],
  'overscroll-behavior-block': ['AUTO', 'contain'],
  'overflow-anchor': ['auto', 'AUTO', 'none', 'visible'],
  // Pinned against Chrome 145.0.7632.6: auto or a non-negative length or percentage, one to four (-inline, -block: one or two);
  // a negative literal and a number are dropped, a negative calculation kept (it computes to 0px).
  'scroll-padding': ['auto', 'auto auto', 'auto auto auto', 'AUTO auto auto Auto', 'auto auto auto auto auto', '0', '10px', '0 20px', '1px 2px 3px', '1px 2px 3px 4px', 'auto 5%', '1em 2rem', 'calc(10% + 1em) 0', '-1px', '10%', '1px 2px 3px 4px 5px', '5'],
  'scroll-padding-top': ['auto', 'AUTO', '0', '4px', '-4px', '64px', '10%', '1em', '2rem', 'calc(10% + 1em)', 'calc(-5px)', 'max(1em, 4px)', '5', 'none'],
  'scroll-padding-right': ['auto', '10%', '0.5em'],
  'scroll-padding-bottom': ['auto', '12px'],
  'scroll-padding-left': ['auto', 'none', '3px'],
  'scroll-padding-inline': ['auto', 'auto auto', 'auto 0', 'auto auto auto', '1px 2px', '5px 5px', '1px 2px 3px'],
  'scroll-padding-inline-start': ['auto', '3px', '10%'],
  'scroll-padding-inline-end': ['auto', '4px'],
  'scroll-padding-block': ['auto', 'Auto AUTO', '1em', 'auto 3px', '4px'],
  'scroll-padding-block-start': ['auto', '6px'],
  'scroll-padding-block-end': ['auto', '0px'],
  // Any length, negative too, one to four; no percentage, auto or number.
  'scroll-margin': ['0', '0px', '0 0', '0 0px 0', '0 0 0 0', '-0', '+0', '0PX', '0 0 0 0 0', '1px', '0em', '0%', 'auto', '10px', '0 20px', '1em -2px', '1px 2px 3px', '1px 2px 3px 4px', '1px 1px 1px 1px'],
  'scroll-margin-top': ['0', '0px', '-0px', '0.0', '0e0', '2px', '-2px', '0%', '0em', '80px', '1em', 'calc(1em + 2px)', 'calc(10% + 1px)', '10%', 'auto', '5'],
  'scroll-margin-right': ['0', '1rem'],
  'scroll-margin-bottom': ['0px', '-8px'],
  'scroll-margin-left': ['0', '1px'],
  'scroll-margin-inline': ['0', '0 0', '0 1px', '1px 2px', '1px 2px 3px'],
  'scroll-margin-inline-start': ['0', '7px'],
  'scroll-margin-inline-end': ['0px', '-1px'],
  'scroll-margin-block': ['0', '0px 0', '0 0 0', '3px', '3px 3px'],
  'scroll-margin-block-start': ['0', '2em'],
  'scroll-margin-block-end': ['0', '9px'],
  // none, or an axis and an optional strictness (x proximity computes to x); no pair, no strictness first or alone.
  'scroll-snap-type': ['none', 'NONE', 'x', 'x proximity', 'x mandatory', 'Y MANDATORY', 'block', 'inline proximity', 'both mandatory', 'both proximity', 'none mandatory', 'pair', 'mandatory x', 'mandatory', 'x x'],
  // One or two of none, start, end and center (start start computes to start).
  'scroll-snap-align': ['none', 'None', 'none none', 'start', 'start start', 'start end', 'center end', 'none start', 'START Center', 'center center', 'left', 'start end center'],
  'scroll-snap-stop': ['normal', 'NORMAL', 'always', 'ALWAYS', 'none'],
  contain: ['none', 'NONE', 'strict', 'content', 'size', 'inline-size', 'layout paint', 'style', 'none none', 'view-transition'],
  'content-visibility': ['visible', 'VISIBLE', 'hidden', 'auto', 'none'],
  'contain-intrinsic-size': ['none', 'NONE', 'none none', 'none none none', 'auto none', '10px', 'auto 10px none', '-1px'],
  'contain-intrinsic-width': ['none', 'None', 'auto none', '10px', 'auto', '-1px', '0'],
  'contain-intrinsic-height': ['none', 'auto 5px'],
  'contain-intrinsic-inline-size': ['none', '1px'],
  'contain-intrinsic-block-size': ['NONE', 'auto none'],
  'container-type': ['normal', 'NORMAL', 'size', 'inline-size', 'scroll-state', 'inline-size scroll-state', 'normal size', 'anchored', 'none'],
  'container-name': ['none', 'NONE', 'card', 'a b', 'none none', 'and', 'not', 'a none', 'normal'],
  container: ['none', 'NONE', 'none / normal', 'NONE/NORMAL', 'none / size', 'card', 'card / inline-size', 'none normal', 'none /', '/ normal', 'none / normal size'],
};

/** How many of VALUES Dragon accepts and drops (pinned so a parser change that accepts or drops more or fewer is seen). */
const ACCEPTED = 153;
const DROPPED = 28;

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.name}: ${it.v}: invalid, Chrome parses it`] : [];
    if (it.code !== null) return [`${it.name}: ${it.v}: unexpected ${it.code}`];
    if (it.ltr === null) return [];
    if (!s.parsed) return [`${it.name}: ${it.v}: accepted, Chrome drops it`];
    return s.authored !== s.dragon ? [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's longhands compute ${s.dragon}`] : [];
  });
}

/** A planted reading: Dragon's code, and the same longhands in both directions. */
const plant = (name: string, v: string, code: string | null, longhands: Pairs | null): Item => ({ name, v, code, ltr: longhands, rtl: longhands });

describe('overscroll, scroll-snap, containment and container-query: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon drops what Chrome drops, every accepted value computes as Dragon\'s longhands do in both directions, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'snapTypeDropped', items: [plant('scroll-snap-type', 'y mandatory', 'DRAGON_CSS_INVALID_VALUE', null)] },
      { name: 'paddingLengthReadAsInitial', items: [plant('scroll-padding-top', '4px', null, [['scroll-padding-top', 'auto']])] },
      { name: 'marginEmReadAsInitial', items: [plant('scroll-margin-top', '1em', null, [['scroll-margin-top', '0px']])] },
      { name: 'negativePaddingKept', items: [plant('scroll-padding-top', '-1px', null, [['scroll-padding-top', '-1px']])] },
      { name: 'marginPercentKept', items: [plant('scroll-margin-top', '10%', null, [['scroll-margin-top', '10%']])] },
      { name: 'inlineStartPhysicalRight', items: [plant('scroll-padding-inline-start', '3px', null, [['scroll-padding-right', '3px']])] },
      { name: 'paddingTwoValuesTopBottomOnly', items: [plant('scroll-padding', '0 20px', null, [['scroll-padding-top', '0px'], ['scroll-padding-right', '0px'], ['scroll-padding-bottom', '0px'], ['scroll-padding-left', '0px']])] },
      { name: 'containerTypeReadAsInitial', items: [plant('container', 'none / size', null, [['container-name', 'none'], ['container-type', 'normal']])] },
      { name: 'threeValueAccepted', items: [plant('overscroll-behavior', 'auto auto auto', null, [['overscroll-behavior-x', 'auto'], ['overscroll-behavior-y', 'auto']])] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div><span id="a"></span><span id="c"></span></div><div dir="rtl"><span id="ar"></span><span id="cr"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a and #ar, Dragon's longhands for each
      // direction on #c and #cr, all read as every longhand of the four families.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const [a, c, ar, cr] = ['a', 'c', 'ar', 'cr'].map((id) => document.getElementById(id));
        const read = (e) => ${JSON.stringify(LONGHANDS)}.map((p) => getComputedStyle(e).getPropertyValue(p)).join(' | ');
        for (const e of [a, c, ar, cr]) e.removeAttribute('style');
        for (const e of [a, ar]) e.style.setProperty(it.name, it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        for (const [p, v] of it.ltr ?? []) c.style.setProperty(p, v);
        for (const [p, v] of it.rtl ?? []) cr.style.setProperty(p, v);
        return { parsed, authored: read(a) + ' / ' + read(ar), dragon: read(c) + ' / ' + read(cr) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.code !== null && it.code !== 'DRAGON_CSS_INVALID_VALUE')).toEqual([]);
    expect(real.filter((it) => it.ltr !== null).length).toBe(ACCEPTED);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBe(DROPPED);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBeGreaterThan(120);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});

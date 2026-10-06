// GEN-c (T151 R14): list item ordinals (analysis/ordinals.ts) and marker text (css/counter-styles.ts) against Chrome 145, read from
// the GEN-P probe corpus (docs/research/gen-spike/probe/family5-markers.json: every ::marker text box Chrome laid out, per DPR).
// Each case's tree is rebuilt from its probe HTML, its list-style-type and display from its probe CSS and the UA defaults, and the
// marker text Dragon computes must equal Chrome's for exactly the set of elements Chrome gives a marker. The four compiler plants
// (faults/gen-c.ts) must each change at least one case.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OrdinalNode } from '../src/analysis/ordinals.ts';
import { listItemOrdinals, parseHtmlInteger } from '../src/analysis/ordinals.ts';
import type { ListStyleType } from '../src/css/counter-styles.ts';
import { COUNTER_STYLES, counterRepresentation, isCounterStyleName, markerText } from '../src/css/counter-styles.ts';
import type { GenCFaults } from '../src/faults/gen-c.ts';
import { GEN_C_FAULTS } from '../src/faults/gen-c.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
type ProbeText = { readonly owner: string; readonly text: string };
type ProbeCase = { readonly id: string; readonly css: string; readonly html: string; readonly runs: Record<string, { readonly text: readonly ProbeText[] }> };
const PROBE = JSON.parse(readFileSync(join(ROOT, 'docs/research/gen-spike/probe/family5-markers.json'), 'utf8')) as { chrome: string; cases: ProbeCase[] };

// The ltr runs: in rtl Chrome reorders "1. " into two text boxes (blink-notes.md), which GEN-c refuses for text markers (R14).
const LTR_RUNS = (c: ProbeCase): string[] => Object.keys(c.runs).filter((k) => k.endsWith('/ltr'));

/** A probe element: its tag, attributes and children, parsed from the probe's small, well-formed HTML. */
type Parsed = { tag: string; attributes: Map<string, string>; children: Parsed[] };
function parseHtml(html: string): Parsed[] {
  const top: Parsed = { tag: '#root', attributes: new Map(), children: [] };
  const stack = [top];
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>|[^<]+/g)) {
    if (m[2] === undefined) continue; // text
    if (m[1] === '/') {
      const open = stack.pop() as Parsed;
      if (open.tag !== m[2]) throw new Error(`probe HTML: </${m[2]}> closes <${open.tag}>`);
      continue;
    }
    const attributes = new Map<string, string>();
    for (const a of (m[3] as string).matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) attributes.set(a[1] as string, a[2] ?? '');
    const el: Parsed = { tag: m[2], attributes, children: [] };
    (stack[stack.length - 1] as Parsed).children.push(el);
    stack.push(el);
  }
  if (stack.length !== 1) throw new Error('probe HTML: unclosed element');
  return top.children;
}

/** The probe CSS's rules, by simple selector (a tag or .class); each case's CSS uses only those, comma-separated. */
function parseCss(css: string): { selectors: string[]; declarations: Map<string, string> }[] {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
    selectors: (m[1] as string).split(',').map((s) => s.trim()),
    declarations: new Map((m[2] as string).split(';').filter((d) => d.includes(':')).map((d) => {
      const at = d.indexOf(':');
      return [d.slice(0, at).trim(), d.slice(at + 1).trim()] as [string, string];
    })),
  }));
}

/** css-lists-3 list-style-type: a counter-style name, a string or none (the probe uses no other form). */
function listStyleType(text: string): ListStyleType | null {
  if (text === 'none') return null;
  const string = /^'(.*)'$/.exec(text);
  if (string !== null) return { kind: 'string', text: string[1] as string };
  if (!isCounterStyleName(text)) throw new Error(`probe list-style-type ${text} is not an R14 style`);
  return { kind: 'style', name: text };
}

type Built = { node: OrdinalNode; types: Map<string, ListStyleType | null> };

/**
 * The case tree under html and body, with each element's display and list-style-type cascaded from the UA defaults (li is
 * list-item; ol sets decimal; list-style-type inherits, initial disc), then the case CSS (tag and class rules, in order), then the
 * style attribute.
 */
function build(c: ProbeCase): Built {
  const rules = parseCss(c.css);
  const types = new Map<string, ListStyleType | null>();
  const toNode = (p: Parsed, inherited: string, id: string): OrdinalNode => {
    const declared = new Map<string, string>([['display', p.tag === 'li' ? 'list-item' : 'block']]);
    if (p.tag === 'ol') declared.set('list-style-type', 'decimal');
    const classes = (p.attributes.get('class') ?? '').split(/\s+/).filter((s) => s !== '');
    const blocks = [...rules.filter((r) => r.selectors.includes(p.tag)), ...rules.filter((r) => r.selectors.some((s) => classes.includes(s.slice(1)) && s.startsWith('.')))];
    for (const r of blocks) for (const [k, v] of r.declarations) declared.set(k, v);
    for (const [k, v] of parseCss(`x{${p.attributes.get('style') ?? ''}}`)[0]?.declarations ?? []) declared.set(k, v);
    if (declared.get('list-style') === 'none') declared.set('list-style-type', 'none');
    const type = declared.get('list-style-type') ?? inherited;
    const label = p.attributes.get('data-p') ?? id;
    const listItem = declared.get('display') === 'list-item';
    if (listItem) types.set(label, listStyleType(type));
    return {
      id: label,
      tag: p.tag,
      box: declared.get('display') === 'none' ? 'none' : 'box',
      listItem,
      styleContainment: false,
      attributes: p.attributes,
      children: p.children.map((child, i) => toNode(child, type, `${label}.${i}`)),
    };
  };
  const body: Parsed = { tag: 'body', attributes: new Map([['data-p', 'body']]), children: parseHtml(c.html) };
  return { node: toNode({ tag: 'html', attributes: new Map([['data-p', 'html']]), children: [body] }, 'disc', 'html'), types };
}

/** Dragon's marker text per element: every list item whose list-style-type is not none. */
function dragonMarkers(c: ProbeCase, faults: GenCFaults = GEN_C_FAULTS): Map<string, string> {
  const { node, types } = build(c);
  const ordinals = listItemOrdinals(node, faults);
  const out = new Map<string, string>();
  for (const [label, type] of types) if (type !== null) out.set(label, markerText(type, ordinals.get(label) as number, faults));
  return out;
}

/** Chrome's marker text per element, in one run: the ::marker text boxes joined in order. */
function chromeMarkers(c: ProbeCase, run: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of (c.runs[run] as { text: readonly ProbeText[] }).text) {
    const m = /^(.+)::marker:text\d+$/.exec(t.owner);
    if (m !== null) out.set(m[1] as string, (out.get(m[1] as string) ?? '') + t.text);
  }
  return out;
}

// Every family5 case; marker text does not depend on the font, so inter (whose geometry GEN-P records without a formula) is checked too.
const MARKER_CASES = PROBE.cases;

describe('marker text and ordinals against the GEN-P probe (Chrome 145)', () => {
  it('reads Chrome 145.0.7632.6 and every case this test checks', () => {
    expect(PROBE.chrome).toBe('145.0.7632.6');
    expect(MARKER_CASES.map((c) => c.id)).toEqual([
      'geometry-disc', 'geometry-circle', 'geometry-square', 'geometry-decimal', 'ordinals', 'list-item-divs',
      'counter-decimal', 'counter-decimal-leading-zero', 'counter-lower-alpha', 'counter-upper-alpha', 'counter-lower-latin',
      'counter-upper-latin', 'counter-lower-roman', 'counter-upper-roman', 'counter-string', 'none-and-empty', 'flex-ul', 'inter',
    ]);
  });
  for (const c of MARKER_CASES) {
    it(`${c.id}: the marker text of every list item equals Chrome's, at every DPR`, () => {
      const dragon = dragonMarkers(c);
      const runs = LTR_RUNS(c);
      expect(runs.length).toBe(4);
      for (const run of runs) expect(Object.fromEntries(dragon), `${c.id} ${run}`).toEqual(Object.fromEntries(chromeMarkers(c, run)));
    });
  }
});

describe('the ordinal walk beyond the probe (list_item_ordinal.cc)', () => {
  const el = (id: string, tag: string, children: OrdinalNode[] = [], extra: Partial<OrdinalNode> = {}): OrdinalNode => ({
    id, tag, box: 'box', listItem: tag === 'li', styleContainment: false, attributes: new Map(), children, ...extra,
  });
  const attrs = (o: Record<string, string>): Map<string, string> => new Map(Object.entries(o));
  it('a nested list counts on its own, and the outer list continues past it', () => {
    const tree = el('ol', 'ol', [el('a', 'li', [el('inner', 'ol', [el('x', 'li'), el('y', 'li')])]), el('b', 'li')]);
    expect(Object.fromEntries(listItemOrdinals(tree))).toEqual({ a: 1, x: 1, y: 2, b: 2 });
  });
  it('a reversed list counts down from its item count, skipping nested lists, and start overrides the count', () => {
    const items = [el('a', 'li', [el('n', 'ul', [el('z', 'li')])]), el('b', 'li'), el('c', 'li')];
    expect(Object.fromEntries(listItemOrdinals(el('ol', 'ol', items, { attributes: attrs({ reversed: '' }) })))).toEqual({ a: 3, z: 1, b: 2, c: 1 });
    expect(Object.fromEntries(listItemOrdinals(el('ol', 'ol', items, { attributes: attrs({ reversed: '', start: '10' }) })))).toEqual({ a: 10, z: 1, b: 9, c: 8 });
  });
  it('an item without a box is not counted; display: contents is walked through and is no list owner', () => {
    const tree = el('ol', 'ol', [el('a', 'li'), el('h', 'li', [], { box: 'none' }), el('w', 'div', [el('b', 'li')], { box: 'contents' }), el('c', 'li')]);
    expect(Object.fromEntries(listItemOrdinals(tree))).toEqual({ a: 1, b: 2, c: 3 });
    const contentsOl = el('body', 'body', [el('o', 'ol', [el('a', 'li'), el('b', 'li')], { box: 'contents', attributes: attrs({ start: '5' }) })]);
    expect(Object.fromEntries(listItemOrdinals(contentsOl))).toEqual({ a: 5, b: 6 });
  });
  it('a value saturates at the int range, and an unparsable start or value is ignored', () => {
    const tree = el('ol', 'ol', [el('a', 'li', [], { attributes: attrs({ value: '2147483647' }) }), el('b', 'li'), el('c', 'li', [], { attributes: attrs({ value: 'x' }) })], { attributes: attrs({ start: '' }) });
    expect(Object.fromEntries(listItemOrdinals(tree))).toEqual({ a: 2147483647, b: 2147483647, c: 2147483647 });
  });
  it('parses integers by the HTML rules', () => {
    expect([' 12px', '+3', '-0', '007', '', '-', 'x1', '2147483648', '-2147483648'].map(parseHtmlInteger)).toEqual([12, 3, 0, 7, null, null, null, null, -2147483648]);
    expect(Object.is(parseHtmlInteger('-0'), 0)).toBe(true);
  });
  it('writes the counter styles at their boundaries', () => {
    expect(counterRepresentation('lower-roman', 3999)).toBe('mmmcmxcix');
    expect(counterRepresentation('upper-roman', 4000)).toBe('4000');
    expect(counterRepresentation('lower-alpha', 702)).toBe('zz');
    expect(counterRepresentation('lower-alpha', 703)).toBe('aaa');
    expect(counterRepresentation('decimal-leading-zero', -5)).toBe('-5');
    expect(counterRepresentation('decimal', -2147483648)).toBe('-2147483648');
    expect(markerText({ kind: 'style', name: 'square' }, 7)).toBe('■ ');
    expect(() => counterRepresentation('decimal', 2 ** 31)).toThrow(/32-bit/);
    expect(Object.keys(COUNTER_STYLES).sort()).toEqual(['circle', 'decimal', 'decimal-leading-zero', 'disc', 'lower-alpha', 'lower-latin', 'lower-roman', 'square', 'upper-alpha', 'upper-latin', 'upper-roman']);
  });
});

describe('the GEN-c compiler plants (faults/gen-c.ts) each change a probe case', () => {
  const caught: Record<keyof GenCFaults, string> = {
    ordinalIgnoresValue: 'ordinals',
    reversedCountsUp: 'ordinals',
    romanNoFallback: 'counter-lower-roman',
    leadingZeroUnpadded: 'counter-decimal-leading-zero',
  };
  it('every plant is listed', () => expect(Object.keys(caught).sort()).toEqual(Object.keys(GEN_C_FAULTS).sort()));
  for (const [fault, id] of Object.entries(caught) as [keyof GenCFaults, string][]) {
    it(`${fault} fails ${id}`, () => {
      const c = PROBE.cases.find((x) => x.id === id) as ProbeCase;
      const planted = dragonMarkers(c, { ...GEN_C_FAULTS, [fault]: true });
      expect(Object.fromEntries(planted)).not.toEqual(Object.fromEntries(chromeMarkers(c, 'dpr-1/ltr')));
    });
  }
});

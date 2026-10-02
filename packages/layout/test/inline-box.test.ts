// INL1a against Chrome: every INL-P case of families 1 to 3 (docs/research/inline-spike/probe/, Chrome 145.0.7632.6) that INL1a lays
// out, at DPR 1, 2, 3 and 2.625, in ltr and rtl. Each case's HTML is built into engine input the way the compiler lowers it (phase I
// white-space collapsing over the formatting context, inherited fonts and line-heights, a strut from the container), laid out, and
// compared with Chrome in LayoutUnits at device scale: the container height, every line box's top, height and recorded baseline,
// every leaf's non-empty client rects, and every inline box's and <br>'s bounding rect. The cases INL1a refuses are listed with
// their typed codes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, fromCssPx, layout, layoutWithFaults, NO_ENGINE_FAULTS, placeLines, validateLayoutInput, zoomInput } from '../src/index.ts';
import { isRtlSafe } from '../src/inline.ts';
import type { EngineFaults, InlineChild, LayoutInput, LayoutRect, LineHeightValue, TextLeaf } from '../src/index.ts';
import { ahemFont, box, br, neutralEnvironment, px, span, text } from './helpers.ts';

type ProbeRect = readonly [number, number, number, number];
type ProbeResult = {
  readonly container: ProbeRect;
  readonly lines: readonly { readonly top: number; readonly height: number; readonly baseline: number | null; readonly text: string }[];
  readonly leaves: readonly { readonly owner: string; readonly index: number; readonly text: string; readonly rects: readonly ProbeRect[] }[];
  readonly elements: Record<string, { readonly tag: string; readonly bounding: ProbeRect }>;
};
type ProbeCase = { readonly width: number; readonly style: string; readonly html: string; readonly results: Record<string, ProbeResult> };

const load = (family: string): Record<string, ProbeCase> =>
  (JSON.parse(readFileSync(new URL(`../../../docs/research/inline-spike/probe/${family}.json`, import.meta.url), 'utf8')) as { readonly cases: Record<string, ProbeCase> }).cases;

/** Inline declarations: font-size (px), line-height (number, px or normal), white-space and border-right (a px width). */
type Decls = { readonly fontSize: number | null; readonly lineHeight: LineHeightValue | null; readonly whiteSpace: string | null; readonly borderRight: number | null };

function decls(style: string): Decls {
  let fontSize: number | null = null;
  let lineHeight: LineHeightValue | null = null;
  let whiteSpace: string | null = null;
  let borderRight: number | null = null;
  for (const d of style.split(';')) {
    const [k, v] = d.split(':').map((x) => x.trim());
    if (k === undefined || v === undefined || k === '') continue;
    if (k === 'font-size') fontSize = Number(v.replace('px', ''));
    else if (k === 'line-height') lineHeight = v === 'normal' ? { kind: 'normal' } : v.endsWith('px') ? { kind: 'px', value: Number(v.slice(0, -2)) } : { kind: 'number', value: Number(v) };
    else if (k === 'white-space' && (v === 'nowrap' || v === 'pre-wrap' || v === 'normal')) whiteSpace = v;
    else if (k === 'border-right' && /^\d+px solid$/.test(v)) borderRight = Number(v.slice(0, v.indexOf('px')));
    else throw new Error(`the probe builder does not read ${k}: ${v}`);
  }
  return { fontSize, lineHeight, whiteSpace, borderRight };
}

/** white-space as its longhands (css-text-4 §3): nowrap sets text-wrap-mode, pre-wrap preserves white space. */
type WhiteSpace = { readonly wrap: 'wrap' | 'nowrap'; readonly collapse: 'collapse' | 'preserve' };
const whiteSpaceOf = (v: string | null, inherited: WhiteSpace): WhiteSpace =>
  v === null ? inherited : v === 'nowrap' ? { wrap: 'nowrap', collapse: 'collapse' } : v === 'pre-wrap' ? { wrap: 'wrap', collapse: 'preserve' } : { wrap: 'wrap', collapse: 'collapse' };

type Ctx = { readonly size: number; readonly lineHeight: LineHeightValue; readonly owner: string; readonly ws: WhiteSpace };
type Raw = { readonly kind: 'text'; readonly value: string; readonly ctx: Ctx; readonly id: string } | { readonly kind: 'br'; readonly id: string; readonly ctx: Ctx } | { readonly kind: 'span'; readonly id: string; readonly ctx: Ctx; readonly borderRight: number | null; readonly children: Raw[] };

/** The case HTML as a tree: text, <span data-p style> and <br data-p style>, with inherited sizes and line-heights. */
function parse(html: string, root: Ctx): Raw[] {
  const stack: { ctx: Ctx; children: Raw[] }[] = [{ ctx: root, children: [] }];
  const counts = new Map<string, number>();
  const re = /<span data-p="([^"]+)"(?: style="([^"]*)")?>|<\/span>|<br(?: data-p="([^"]+)")?(?: style="([^"]*)")?>|([^<]+)/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const top = stack[stack.length - 1] as { ctx: Ctx; children: Raw[] };
    if (m[0].startsWith('<span')) {
      const d = decls(m[2] ?? '');
      const ctx: Ctx = { size: d.fontSize ?? top.ctx.size, lineHeight: d.lineHeight ?? top.ctx.lineHeight, owner: m[1] as string, ws: whiteSpaceOf(d.whiteSpace, top.ctx.ws) };
      const s: Raw = { kind: 'span', id: m[1] as string, ctx, borderRight: d.borderRight, children: [] };
      top.children.push(s);
      stack.push({ ctx, children: s.children });
    } else if (m[0] === '</span>') stack.pop();
    else if (m[0].startsWith('<br')) {
      const d = decls(m[4] ?? '');
      top.children.push({ kind: 'br', id: m[3] ?? `br@${m.index}`, ctx: { size: d.fontSize ?? top.ctx.size, lineHeight: d.lineHeight ?? top.ctx.lineHeight, owner: top.ctx.owner, ws: top.ctx.ws } });
    } else {
      const n = counts.get(top.ctx.owner) ?? 0;
      counts.set(top.ctx.owner, n + 1);
      top.children.push({ kind: 'text', value: (m[5] as string).replace(/&quot;/g, '"'), ctx: top.ctx, id: `${top.ctx.owner}#${n}` });
    }
  }
  return (stack[0] as { children: Raw[] }).children;
}

/** css-text-3 §4.1.1 phase I over the formatting context, as the compiler applies it: a space after a space collapses, and spaces at its start, after a <br> and at its end are removed. */
function collapse(raw: Raw[]): Raw[] {
  let afterSpace = true;
  const pass = (items: Raw[]): Raw[] =>
    items.flatMap((r): Raw[] => {
      if (r.kind === 'br') {
        afterSpace = true;
        return [r];
      }
      if (r.kind === 'span') return [{ ...r, children: pass(r.children) }];
      let out = '';
      for (const ch of r.value) {
        if (ch === ' ') {
          if (!afterSpace) out += ' ';
          afterSpace = true;
        } else {
          out += ch;
          afterSpace = false;
        }
      }
      return [{ ...r, value: out }];
    });
  const once = pass(raw);
  // Trailing spaces of the context, and spaces before a <br> are kept (they hang); only the context's end is trimmed.
  const trimEnd = (items: Raw[]): boolean => {
    for (let i = items.length - 1; i >= 0; i--) {
      const r = items[i] as Raw;
      if (r.kind === 'br') return true;
      if (r.kind === 'span') {
        if (trimEnd(r.children)) return true;
        continue;
      }
      const v = r.value.replace(/ +$/, '');
      items[i] = { ...r, value: v };
      if (v !== '') return true;
    }
    return false;
  };
  trimEnd(once);
  const dropEmpty = (items: Raw[]): Raw[] => items.filter((r) => r.kind !== 'text' || r.value !== '').map((r) => (r.kind === 'span' ? { ...r, children: dropEmpty(r.children) } : r));
  return dropEmpty(once);
}

function lower(r: Raw): InlineChild {
  const font = ahemFont(r.ctx.size);
  if (r.kind === 'text') {
    // The engine input holds white-space-collapse: collapse only, so a preserved run reaches the validator as written.
    return { ...text(r.id, r.value, { font, lineHeight: r.ctx.lineHeight, textWrapMode: r.ctx.ws.wrap }), whiteSpaceCollapse: r.ctx.ws.collapse as 'collapse' };
  }
  if (r.kind === 'br') return br(r.id, { font, lineHeight: r.ctx.lineHeight });
  const s = span(r.id, r.children.map(lower), { font, lineHeight: r.ctx.lineHeight });
  return r.borderRight === null ? s : { ...s, style: { ...s.style, borderRightWidth: px(r.borderRight) } };
}

function inputOf(c: ProbeCase, dpr: number, direction: 'ltr' | 'rtl'): LayoutInput {
  const d = decls(c.style);
  const rootCtx: Ctx = { size: d.fontSize ?? 10, lineHeight: d.lineHeight ?? { kind: 'normal' }, owner: 'root', ws: whiteSpaceOf(d.whiteSpace, { wrap: 'wrap', collapse: 'collapse' }) };
  const kids = collapse(parse(c.html, rootCtx)).map(lower);
  const container = box('c', { width: px(c.width), direction }, kids, kids.length === 0 ? null : { font: ahemFont(rootCtx.size), lineHeight: rootCtx.lineHeight });
  const root = box('root', { direction }, [container]);
  return { viewport: { width: 400, height: 300 }, devicePixelRatio: dpr, ...neutralEnvironment({ width: 400, height: 300 }), root };
}

/** A Chrome value in CSS px as LayoutUnits at device scale. */
const lu = (cssPx: number, dpr: number): number => Math.round(cssPx * dpr * 64);
const rectLu = (r: ProbeRect, dpr: number): number[] => r.map((v) => lu(v, dpr));
const ours = (r: LayoutRect, origin: LayoutRect): number[] => [r.x - origin.x, r.y - origin.y, r.width, r.height];

/**
 * The cases INL1a refuses, with the code: a nowrap span in a wrapping context (mixed-text-wrap-mode, from the engine), and pre-wrap
 * (bad-value, from the validator: the engine input holds white-space-collapse: collapse only).
 */
const REFUSED: Record<string, string> = { 'f3-nowrap-span': 'mixed-text-wrap-mode', 'f3-trailing-spaces-close': 'bad-value' };

function compare(id: string, c: ProbeCase, faults: EngineFaults): string[] {
  const problems: string[] = [];
  for (const [env, want] of Object.entries(c.results)) {
    const m = /^dpr([\d.]+)-(ltr|rtl)$/.exec(env);
    if (m === null) throw new Error(`${id}: environment ${env}`);
    const dpr = Number(m[1]);
    const input = inputOf(c, dpr, m[2] as 'ltr' | 'rtl');
    const r = layoutWithFaults(input, ahemMeasurer, faults);
    // UAX #9: punctuation and digits in an rtl paragraph are refused (bidi-neutral), so those environments must refuse.
    const rtlUnsafe = m[2] === 'rtl' && !isRtlSafe(c.html.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"'));
    if (rtlUnsafe) {
      if (r.kind !== 'unsupported' || r.unsupported.code !== 'bidi-neutral') problems.push(`${env}: expected the bidi-neutral refusal`);
      continue;
    }
    if (r.kind !== 'ok') {
      problems.push(`${env}: ${r.unsupported.code} ${r.unsupported.detail}`);
      continue;
    }
    const abs = absoluteRects(r.boxes);
    const origin = abs.get('c') as LayoutRect;
    const at = (key: string): number[] | null => {
      const x = abs.get(key);
      return x === undefined ? null : ours(x, origin);
    };
    const expectEq = (what: string, got: unknown, exp: unknown): void => {
      if (JSON.stringify(got) !== JSON.stringify(exp)) problems.push(`${env} ${what}: engine ${JSON.stringify(got)}, Chrome ${JSON.stringify(exp)}`);
    };
    expectEq('container', at('c'), rectLu(want.container, dpr));
    const lines = placeLines({ measurer: ahemMeasurer, devicePixelRatio: 1, faults }, zoomedContainer(input), fromCssPx(c.width * dpr));
    expectEq('line count', lines.length, want.lines.length);
    want.lines.forEach((l, k) => {
      const got = lines[k];
      if (got === undefined) return;
      expectEq(`line ${k} top and height`, [got.top, got.height], [lu(l.top, dpr), lu(l.height, dpr)]);
      if (l.baseline !== null) expectEq(`line ${k} baseline`, got.baseline - got.top, lu(l.baseline, dpr));
    });
    for (const leaf of want.leaves) {
      const pieces: number[][] = [];
      for (let j = 0; abs.has(`${leaf.owner}#${leaf.index}:line${j}`); j++) pieces.push(ours(abs.get(`${leaf.owner}#${leaf.index}:line${j}`) as LayoutRect, origin));
      expectEq(`leaf ${leaf.owner}#${leaf.index} rects`, pieces, leaf.rects.filter((x) => x[2] !== 0).map((x) => rectLu(x, dpr)));
    }
    for (const [label, e] of Object.entries(want.elements)) {
      if (label === '#c') continue;
      expectEq(`${e.tag} ${label} bounding rect`, at(label), rectLu(e.bounding, dpr));
    }
    // The other way round: every leaf, inline box and <br> the engine laid out is one Chrome reported.
    const chromeLeaves = new Set(want.leaves.map((l) => `${l.owner}#${l.index}`));
    const walk = (kids: readonly InlineChild[]): void => {
      for (const k of kids) {
        if (k.kind === 'text' && !chromeLeaves.has(k.id)) problems.push(`${env}: the engine has a leaf ${k.id} Chrome does not report`);
        // A <br> without data-p (id br@<offset>) is not recorded by the probe.
        if (k.kind !== 'text' && !k.id.startsWith('br@') && want.elements[k.id] === undefined) problems.push(`${env}: the engine has a ${k.kind} ${k.id} Chrome does not report`);
        if (k.kind === 'inline') walk(k.children);
      }
    };
    walk(zoomedContainer(input).children as readonly InlineChild[]);
  }
  return problems;
}

/** The container of a case input as layout sees it: zoomed and resolved for its environment. */
function zoomedContainer(input: LayoutInput): import('../src/index.ts').LayoutBox {
  const z = zoomInputOf(input).root.children[0];
  if (z === undefined || z.kind !== 'box') throw new Error('no container');
  return z;
}

const zoomInputOf = (input: LayoutInput): LayoutInput => zoomInput(input, NO_ENGINE_FAULTS);

describe('INL1a equals Chrome on INL-P families 1 to 3 (every DPR and direction)', () => {
  const cases = { ...load('family1-mixed-sizes'), ...load('family2-br'), ...load('family3-breaks') };
  const run = Object.entries(cases).filter(([id]) => REFUSED[id] === undefined);
  it('runs every case of the three families but the refused ones: 16 + 11 + 67', () => {
    expect(run.length).toBe(16 + 11 + 67);
  });
  it.each(run)('%s', (id, c) => {
    expect(compare(id, c, NO_ENGINE_FAULTS)).toEqual([]);
  });
  it.each(Object.entries(REFUSED))('refuses %s, built unchanged, at every DPR and direction with %s', (id, code) => {
    const c = cases[id];
    if (c === undefined) throw new Error(`${id} is not in the probe`);
    for (const env of Object.keys(c.results)) {
      const m = /^dpr([\d.]+)-(ltr|rtl)$/.exec(env);
      if (m === null) throw new Error(`${id}: environment ${env}`);
      const v = validateLayoutInput(JSON.parse(JSON.stringify(inputOf(c, Number(m[1]), m[2] as 'ltr' | 'rtl'))));
      const got = v.ok ? ((r) => (r.kind === 'unsupported' ? r.unsupported.code : 'laid out'))(layout(v.input, ahemMeasurer)) : [...new Set(v.errors.map((e) => e.code))].join(' ');
      expect(got, `${id} ${env}`).toBe(code);
    }
  });
});

describe('INL1a planted engine faults each move an INL-P case off Chrome', () => {
  const cases = { ...load('family1-mixed-sizes'), ...load('family2-br'), ...load('family3-breaks') };
  const PLANTS: readonly { readonly fault: keyof EngineFaults; readonly cases: readonly string[] }[] = [
    { fault: 'lineHeightIgnoresInlineBoxes', cases: ['f1-number-span20', 'f1-strut-smaller', 'f2-in-big-span'] },
    { fault: 'halfLeadingUnflooredPerBox', cases: ['f1-number-span20'] },
    { fault: 'brIgnored', cases: ['f2-leading', 'f2-consecutive', 'f2-in-span'] },
    { fault: 'breakAtBoxBoundary', cases: ['f3-box-boundary'] },
    { fault: 'fragmentFromLineTop', cases: ['f1-number', 'f1-number-span20'] },
  ];
  it.each(PLANTS)('$fault fails $cases', (p) => {
    for (const id of p.cases) {
      const c = cases[id] as ProbeCase;
      expect(compare(id, c, NO_ENGINE_FAULTS), id).toEqual([]);
      expect(compare(id, c, { ...NO_ENGINE_FAULTS, [p.fault]: true }).length, id).toBeGreaterThan(0);
    }
  });
});

describe('INL1a refusals and the new input kinds', () => {
  const G = 640;
  const input = (root: import('../src/index.ts').LayoutBox): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
  const code = (kids: InlineChild[]): string | null => {
    const r = layout(input(box('root', {}, [box('c', { width: px(100) }, kids)])), ahemMeasurer);
    return r.kind === 'unsupported' ? r.unsupported.code : null;
  };
  it('refuses inline-axis margins, any padding and any border on an inline box (INL1b) and ignores block-axis margins (CSS2 §10.6.1)', () => {
    const decorated = (over: Partial<import('../src/index.ts').LayoutStyle>): InlineChild[] => [span('s', [text('t', 'XX')], { style: { ...span('x', []).style, ...over } })];
    expect(code(decorated({ marginLeft: px(1) }))).toBe('inline-box-decoration');
    expect(code(decorated({ marginRight: { kind: 'percent', value: 5 } }))).toBe('inline-box-decoration');
    expect(code(decorated({ paddingTop: px(2) }))).toBe('inline-box-decoration');
    expect(code(decorated({ borderBottomWidth: px(1) }))).toBe('inline-box-decoration');
    expect(code(decorated({ marginTop: px(7), marginBottom: px(9) }))).toBeNull();
  });
  // INL2b retarget: every vertical-align value lays out on an inline box; what stays refused is a percentage on an atomic inline
  // with no line-height of its own in the input (no strut), and a positioned inline box.
  it('refuses a percentage vertical-align on an atomic inline without inline content (INL2b) and a positioned inline box', () => {
    expect(code([span('s', [text('t', 'XX')], { style: { ...span('x', []).style, verticalAlign: { kind: 'keyword', value: 'sub' } } })])).toBeNull();
    expect(code([span('s', [text('t', 'XX')], { style: { ...span('x', []).style, verticalAlign: px(3) } })])).toBeNull();
    expect(code([text('t', 'XX'), box('ib', { display: 'inline-block', width: px(5), height: px(5), verticalAlign: { kind: 'percent', value: 50 } }, [], null) as unknown as InlineChild])).toBe('vertical-align');
    expect(code([span('s', [text('t', 'XX')], { style: { ...span('x', []).style, position: 'relative' } })])).toBe('inline-box-position');
  });
  it('in rtl, refuses a U+200B in the white space before a <br> as at the end of the paragraph (UAX #9 L1: a <br> is bidi class B)', () => {
    const rtl = (kids: InlineChild[]): string | null => {
      const r = layout(input(box('root', { direction: 'rtl' }, [box('c', { width: px(100), direction: 'rtl' }, kids)])), ahemMeasurer);
      return r.kind === 'unsupported' ? `${r.unsupported.code} ${r.unsupported.nodeId}` : null;
    };
    expect(rtl([text('t', 'AB \u200b'), br('b'), text('u', 'CD')])).toBe('bidi-neutral t');
    expect(rtl([text('t', 'AB'), span('s', [text('u', '\u200b ')]), br('b'), text('v', 'CD')])).toBe('bidi-neutral u');
    expect(rtl([text('t', 'AB \u200bC'), br('b'), text('u', 'CD \u200b')])).toBe('bidi-neutral u');
    expect(rtl([text('t', 'AB \u200bC'), br('b'), text('u', 'CD')])).toBeNull();
  });
  it('a formatting context of empty inline boxes has no line boxes, so margins collapse through its container (CSS2 §9.4.2, §8.3.1)', () => {
    const around = (middle: import('../src/index.ts').LayoutBox): number => {
      const r = layout(input(box('root', { width: px(100) }, [box('a', { height: px(10), marginBottom: px(10) }), middle, box('z', { height: px(10), marginTop: px(20) })])), ahemMeasurer);
      if (r.kind !== 'ok') throw new Error(r.unsupported.code);
      return (absoluteRects(r.boxes).get('z') as LayoutRect).y;
    };
    const emptyInline = box('m', {}, [span('s', [])], { font: ahemFont(10), lineHeight: { kind: 'normal' } });
    expect(around(emptyInline)).toBe(around(box('m', {})));
    // a is 10px tall, then the 10px and 20px margins collapse to 20px (G is 10px).
    expect(around(emptyInline)).toBe(3 * G);
  });
  it('throws on inline content in a box without a strut, which validateLayoutInput rejects, rather than dropping it', () => {
    expect(() => layout(input(box('root', {}, [box('c', { width: px(100) }, [text('t', 'XX')], null)])), ahemMeasurer)).toThrow(/inline content without a strut/);
  });
  it('refuses an inline box that would start on the empty line after the last <br>', () => {
    expect(code([text('t', 'XX'), br('b'), span('s', [])])).toBe('inline-empty-line');
    expect(code([text('t', 'XX'), br('b')])).toBeNull();
  });
  it('max-content is the widest line between <br>s, min-content the widest segment, through inline boxes', () => {
    const r = layout(input(box('root', {}, [box('row', { display: 'flex', width: px(10) }, [box('i', { flexShrink: 0 }, [text('t0', 'XX '), span('s', [text('t1', 'XXX')]), br('b'), text('t2', 'XXXXX X')])])])), ahemMeasurer);
    if (r.kind !== 'ok') throw new Error(r.unsupported.code);
    expect(absoluteRects(r.boxes).get('i')).toMatchObject({ width: 7 * G, height: 2 * G });
    const shrunk = layout(input(box('root', {}, [box('row', { display: 'flex', width: px(10) }, [box('i', {}, [text('t0', 'XX '), span('s', [text('t1', 'XXX')]), br('b'), text('t2', 'XXXXX X')])])])), ahemMeasurer);
    if (shrunk.kind !== 'ok') throw new Error(shrunk.unsupported.code);
    expect(absoluteRects(shrunk.boxes).get('i')).toMatchObject({ width: 5 * G });
  });
  it('lays the flattened content out in tree order: leaves, inline boxes (with their line fragments) and <br>s are children of the container', () => {
    const r = layout(input(box('root', {}, [box('c', { width: px(30) }, [text('t0', 'XX '), span('s', [text('t1', 'YY YY'), br('b')]), text('t2', 'ZZ')])])), ahemMeasurer);
    if (r.kind !== 'ok') throw new Error(r.unsupported.code);
    expect(r.boxes.filter((b) => b.parent === 'c').map((b) => b.id)).toEqual(['t0', 's', 't1', 'b', 't2']);
    expect(r.boxes.filter((b) => b.parent === 's').map((b) => [b.id, b.x, b.y, b.width, b.height])).toEqual([['s:line0', 0, 0, 2 * G, G], ['s:line1', 0, G, 2 * G, G]]);
  });
});

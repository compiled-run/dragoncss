// INL2a against Chrome: the INL-P family 5 cases (docs/research/inline-spike/probe/family5-atomic.json, Chrome 145.0.7632.6) that
// INL2a lays out (inline-block and inline-flex at vertical-align: baseline, breaks around U+FFFC, shrink-to-fit widths), at DPR 1,
// 2, 3 and 2.625, in ltr and rtl. Each case is built into engine input the way the compiler lowers it, laid out, and compared with
// Chrome in LayoutUnits at device scale: the container, every line box and recorded baseline, every leaf's client rects and every
// labelled element's bounding rect. The vertical-align and sub/sup cases belong to INL2b and are listed with their refusals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, fromCssPx, layoutWithFaults, NO_ENGINE_FAULTS, placeLines, validateLayoutInput, zoomInput } from '../src/index.ts';
import type { EngineFaults, InlineChild, LayoutBox, LayoutInput, LayoutRect, LayoutStyle, LineHeightValue } from '../src/index.ts';
import { ahemFont, box, br, neutralEnvironment, px, text } from './helpers.ts';

type ProbeRect = readonly [number, number, number, number];
type ProbeResult = {
  readonly container: ProbeRect;
  readonly lines: readonly { readonly top: number; readonly height: number; readonly baseline: number | null; readonly text: string }[];
  readonly leaves: readonly { readonly owner: string; readonly index: number; readonly text: string; readonly rects: readonly ProbeRect[] }[];
  readonly elements: Record<string, { readonly tag: string; readonly bounding: ProbeRect }>;
};
type ProbeCase = { readonly width: number; readonly style: string; readonly html: string; readonly results: Record<string, ProbeResult> };

const CASES = (JSON.parse(readFileSync(new URL('../../../docs/research/inline-spike/probe/family5-atomic.json', import.meta.url), 'utf8')) as { readonly cases: Record<string, ProbeCase> }).cases;

/** The element declarations the builder reads; any other throws. */
type Decls = {
  fontSize: number | null;
  lineHeight: LineHeightValue | null;
  display: string | null;
  style: Partial<LayoutStyle>;
};

function decls(style: string): Decls {
  const out: Decls = { fontSize: null, lineHeight: null, display: null, style: {} };
  const s = out.style as Record<string, unknown>;
  const len = (v: string) => {
    if (!/^-?\d+(\.\d+)?px$|^0$/.test(v)) throw new Error(`the probe builder reads px lengths only: ${v}`);
    return px(Number(v.replace('px', '')));
  };
  for (const d of style.split(';')) {
    const at = d.indexOf(':');
    if (at < 0) continue;
    const k = d.slice(0, at).trim();
    const v = d.slice(at + 1).trim();
    if (k === 'font-size') out.fontSize = Number(v.replace('px', ''));
    else if (k === 'line-height') out.lineHeight = v === 'normal' ? { kind: 'normal' } : v.endsWith('px') ? px(Number(v.slice(0, -2))) : { kind: 'number', value: Number(v) };
    else if (k === 'display') out.display = v;
    else if (k === 'width' || k === 'height') s[k] = len(v);
    else if (k === 'overflow' && v === 'hidden') {
      s['overflowX'] = 'hidden';
      s['overflowY'] = 'hidden';
    } else if (k === 'flex-direction' && v === 'column') s['flexDirection'] = 'column';
    else if (k === 'align-items' && v === 'baseline') s['alignItems'] = 'baseline';
    else if (k === 'vertical-align' && v === 'baseline') continue;
    else if (k === 'margin' || k === 'padding') {
      const parts = v.split(/\s+/).map(len);
      const [t, r = t, b = t, l = r] = parts;
      const name = k === 'margin' ? 'margin' : 'padding';
      s[`${name}Top`] = t;
      s[`${name}Right`] = r;
      s[`${name}Bottom`] = b;
      s[`${name}Left`] = l;
    } else if (/^(margin|padding)-(top|right|bottom|left)$/.test(k)) {
      const [p, side] = k.split('-') as [string, string];
      s[`${p}${side.charAt(0).toUpperCase()}${side.slice(1)}`] = len(v);
    } else throw new Error(`the probe builder does not read ${k}: ${v}`);
  }
  return out;
}

type Font = { readonly size: number; readonly lineHeight: LineHeightValue };
type Raw =
  | { readonly kind: 'text'; readonly value: string; readonly font: Font; readonly id: string }
  | { readonly kind: 'br'; readonly id: string; readonly font: Font }
  | { readonly kind: 'el'; readonly id: string; readonly font: Font; readonly d: Decls; readonly children: Raw[] };

/** The case HTML as a tree of text, <br> and <span data-p style> elements with inherited fonts. */
function parse(html: string, root: Font): Raw[] {
  const stack: { font: Font; owner: string; children: Raw[] }[] = [{ font: root, owner: 'root', children: [] }];
  const counts = new Map<string, number>();
  const re = /<span data-p="([^"]+)"(?: style="([^"]*)")?>|<\/span>|<br>|([^<]+)|(<[^>]*>)/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    if (m[4] !== undefined) throw new Error(`the probe builder does not read ${m[4]}`);
    const top = stack[stack.length - 1] as { font: Font; owner: string; children: Raw[] };
    if (m[0].startsWith('<span')) {
      const d = decls(m[2] ?? '');
      const font: Font = { size: d.fontSize ?? top.font.size, lineHeight: d.lineHeight ?? top.font.lineHeight };
      const el: Raw = { kind: 'el', id: m[1] as string, font, d, children: [] };
      top.children.push(el);
      stack.push({ font, owner: m[1] as string, children: el.children });
    } else if (m[0] === '</span>') stack.pop();
    else if (m[0] === '<br>') top.children.push({ kind: 'br', id: `br@${m.index}`, font: top.font });
    else {
      const n = counts.get(top.owner) ?? 0;
      counts.set(top.owner, n + 1);
      top.children.push({ kind: 'text', value: m[3] as string, font: top.font, id: `${top.owner}#${n}` });
    }
  }
  return (stack[0] as { children: Raw[] }).children;
}

const isAtomic = (r: Raw): boolean => r.kind === 'el' && (r.d.display === 'inline-block' || r.d.display === 'inline-flex');
const isBlockLevel = (r: Raw): boolean => r.kind === 'el' && r.d.display === 'block';

/**
 * css-text-3 §4.1.1 phase I over one formatting context's inline content: spaces collapse across leaves and inline boxes, an
 * atomic inline is not white space (U+FFFC), and the spaces at the context's start, after a <br> and at its end are removed.
 */
function collapse(items: readonly Raw[]): Raw[] {
  let afterSpace = true;
  const pass = (xs: readonly Raw[]): Raw[] =>
    xs.map((r): Raw => {
      if (r.kind === 'br') {
        afterSpace = true;
        return r;
      }
      if (r.kind === 'el') {
        if (isAtomic(r)) {
          afterSpace = false;
          return r;
        }
        return { ...r, children: pass(r.children) };
      }
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
      return { ...r, value: out };
    });
  const once = pass(items);
  const trimEnd = (xs: Raw[]): boolean => {
    for (let i = xs.length - 1; i >= 0; i--) {
      const r = xs[i] as Raw;
      if (r.kind === 'br' || isAtomic(r)) return true;
      if (r.kind === 'el') {
        if (trimEnd(r.children)) return true;
        continue;
      }
      const v = r.value.replace(/ +$/, '');
      xs[i] = { ...r, value: v };
      if (v !== '') return true;
    }
    return false;
  };
  trimEnd(once);
  const dropEmpty = (xs: Raw[]): Raw[] => xs.filter((r) => r.kind !== 'text' || r.value !== '').map((r) => (r.kind === 'el' && !isAtomic(r) ? { ...r, children: dropEmpty(r.children) } : r));
  return dropEmpty(once);
}

function inlineOf(r: Raw, direction: 'ltr' | 'rtl'): InlineChild | LayoutBox {
  const font = ahemFont(r.font.size);
  if (r.kind === 'text') return text(r.id, r.value, { font, lineHeight: r.font.lineHeight });
  if (r.kind === 'br') return br(r.id, { font, lineHeight: r.font.lineHeight });
  if (isAtomic(r)) return container(r, r.d.display as 'inline-block' | 'inline-flex', direction);
  if (r.d.display !== null) throw new Error(`${r.id}: display ${r.d.display} in inline content`);
  return { kind: 'inline', id: r.id, style: { ...box('x', { direction }).style, display: 'inline' }, font, lineHeight: r.font.lineHeight, children: r.children.map((c) => inlineOf(c, direction) as InlineChild) };
}

/** A box element: its children are flex items (blockified), block boxes, or one inline formatting context. */
function container(r: Raw & { kind: 'el' }, display: LayoutStyle['display'], direction: 'ltr' | 'rtl'): LayoutBox {
  const style: Partial<LayoutStyle> = { ...r.d.style, display, direction };
  const flex = display === 'flex' || display === 'inline-flex';
  if (flex) return box(r.id, style, r.children.filter((c) => c.kind !== 'text' || c.value.trim() !== '').map((c) => blockified(c, direction)), null);
  if (r.children.some(isBlockLevel)) {
    if (!r.children.every(isBlockLevel)) throw new Error(`${r.id}: block and inline children (the builder does not wrap them)`);
    return box(r.id, style, r.children.map((c) => container(c as Raw & { kind: 'el' }, 'block', direction)), null);
  }
  const kids = collapse(r.children).map((c) => inlineOf(c, direction));
  return box(r.id, style, kids, kids.length === 0 ? null : { font: ahemFont(r.font.size), lineHeight: r.font.lineHeight });
}

function blockified(r: Raw, direction: 'ltr' | 'rtl'): LayoutBox {
  if (r.kind !== 'el') throw new Error('text directly in a flex container (the builder does not wrap it)');
  return container(r, r.d.display === 'inline-flex' || r.d.display === 'flex' ? 'flex' : 'block', direction);
}

function inputOf(c: ProbeCase, dpr: number, direction: 'ltr' | 'rtl'): LayoutInput {
  const d = decls(c.style);
  const rootFont: Font = { size: d.fontSize ?? 10, lineHeight: d.lineHeight ?? { kind: 'normal' } };
  const raw: Raw = { kind: 'el', id: 'c', font: rootFont, d: { ...d, style: { width: px(c.width) } }, children: parse(c.html, rootFont) };
  const root = box('root', { direction }, [container(raw as Raw & { kind: 'el' }, 'block', direction)]);
  return { viewport: { width: 400, height: 300 }, devicePixelRatio: dpr, ...neutralEnvironment({ width: 400, height: 300 }), root };
}

const lu = (cssPx: number, dpr: number): number => Math.round(cssPx * dpr * 64);
const rectLu = (r: ProbeRect, dpr: number): number[] => r.map((v) => lu(v, dpr));
const ours = (r: LayoutRect, origin: LayoutRect): number[] => [r.x - origin.x, r.y - origin.y, r.width, r.height];

function zoomedContainer(input: LayoutInput): LayoutBox {
  const z = zoomInput(input, NO_ENGINE_FAULTS).root.children[0];
  if (z === undefined || z.kind !== 'box') throw new Error('no container');
  return z;
}


function compare(id: string, c: ProbeCase, faults: EngineFaults): string[] {
  const problems: string[] = [];
  for (const [env, want] of Object.entries(c.results)) {
    const m = /^dpr([\d.]+)-(ltr|rtl)$/.exec(env);
    if (m === null) throw new Error(`${id}: environment ${env}`);
    const dpr = Number(m[1]);
    const direction = m[2] as 'ltr' | 'rtl';
    const input = inputOf(c, dpr, direction);
    const v = validateLayoutInput(JSON.parse(JSON.stringify(input)));
    if (!v.ok) {
      problems.push(`${env}: invalid input ${JSON.stringify(v.errors)}`);
      continue;
    }
    const r = layoutWithFaults(input, ahemMeasurer, faults);
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
  }
  return problems;
}

/** The cases INL2a lays out. */
const RUN = [
  'f5-ib-text', 'f5-ib-empty', 'f5-ib-overflow', 'f5-ib-block-child', 'f5-if-row', 'f5-if-column', 'f5-if-empty', 'f5-if-align-baseline',
  'f5-va-ib-baseline', 'f5-break-around', 'f5-break-around-img', 'f5-break-space-atomic', 'f5-stf-short', 'f5-stf-wrap', 'f5-stf-min', 'f5-stf-margins',
];

describe('INL2a equals Chrome on INL-P family 5 (every DPR and direction)', () => {
  it('runs every family 5 case without vertical-align, sub or sup: the other 30 are INL2b', () => {
    const rest = Object.keys(CASES).filter((id) => !RUN.includes(id));
    expect(rest.length).toBe(30);
    // Each one sets vertical-align (or uses <sub>/<sup>, or a font-size keyword), which INL2b proves.
    for (const id of rest) expect(/vertical-align|<sub|<sup|smaller/.test((CASES[id] as ProbeCase).html), id).toBe(true);
  });
  it.each(RUN)('%s', (id) => {
    const c = CASES[id];
    if (c === undefined) throw new Error(`${id} is not in the probe`);
    expect(compare(id, c, NO_ENGINE_FAULTS)).toEqual([]);
  });
});

describe('INL2a planted engine faults each move an INL-P case off Chrome at every DPR', () => {
  const PLANTS: readonly { readonly fault: keyof EngineFaults; readonly cases: readonly string[] }[] = [
    { fault: 'inlineBlockFirstBaseline', cases: ['f5-ib-text'] },
    { fault: 'overflowBaselineIgnored', cases: ['f5-ib-overflow'] },
    { fault: 'inlineFlexLastBaseline', cases: ['f5-if-column'] },
    { fault: 'atomicMarginExcluded', cases: ['f5-stf-margins', 'f5-ib-empty'] },
    { fault: 'noBreakAroundAtomic', cases: ['f5-break-around', 'f5-break-around-img'] },
    { fault: 'atomicShrinkToFitIgnored', cases: ['f5-stf-short', 'f5-stf-margins'] },
  ];
  it.each(PLANTS)('$fault fails $cases', (p) => {
    for (const id of p.cases) {
      const c = CASES[id] as ProbeCase;
      const faulted = compare(id, c, { ...NO_ENGINE_FAULTS, [p.fault]: true });
      for (const dpr of ['dpr1', 'dpr2', 'dpr3', 'dpr2.625']) expect(faulted.some((x) => x.startsWith(`${dpr}-ltr `)), `${id} ${dpr}`).toBe(true);
    }
  });
});

describe('INL2a refusals and validation', () => {
  const env = (root: LayoutBox, dpr = 1): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: dpr, ...neutralEnvironment({ width: 400, height: 300 }), root });
  const ib = (id: string, style: Partial<LayoutStyle> = {}, kids: (InlineChild | LayoutBox)[] = []): LayoutBox => box(id, { display: 'inline-block', width: px(10), height: px(10), ...style }, kids);
  const codeOf = (root: LayoutBox): string => {
    const r = layoutWithFaults(env(root), ahemMeasurer, NO_ENGINE_FAULTS);
    return r.kind === 'ok' ? 'ok' : r.unsupported.code;
  };
  const validation = (root: LayoutBox): string[] => {
    const v = validateLayoutInput(JSON.parse(JSON.stringify(env(root))));
    return v.ok ? [] : [...new Set(v.errors.map((e) => e.code))];
  };
  it('validates an atomic inline only among inline content: not inside an inline box, a flex container or beside blocks, never the root or absolutely positioned', () => {
    const inBox = { kind: 'inline', id: 's', style: { ...box('x', {}).style, display: 'inline' }, font: ahemFont(10), lineHeight: { kind: 'normal' }, children: [text('s#0', 'a'), ib('a')] } as unknown as InlineChild;
    expect(validation(box('root', {}, [box('c', {}, [inBox])]))).toContain('atomic-in-inline-box');
    expect(validation(box('root', {}, [box('c', { display: 'flex' }, [ib('a')])]))).toContain('text-in-flex');
    expect(validation(box('root', {}, [box('c', {}, [box('k', {}), ib('a')], null)]))).toContain('mixed-children');
    expect(validation(ib('root'))).toContain('bad-value');
    expect(validation(box('root', {}, [box('c', {}, [ib('a', { position: 'absolute' })])]))).toContain('bad-value');
    expect(validation(box('root', {}, [box('c', {}, [text('t', 'aa '), ib('a'), text('u', ' bb')])]))).toEqual([]);
  });
  it('refuses an atomic inline beside text in a face other than Ahem (atomic-beside-shaped-text)', () => {
    const lato = { ...ahemFont(10), family: 'sha256:0000' };
    expect(codeOf(box('root', {}, [box('c', {}, [text('t', 'Ab ', { font: lato }), ib('a')], { font: lato, lineHeight: { kind: 'normal' } })]))).toBe('atomic-beside-shaped-text');
  });
  it('in rtl refuses an atomic inline without a letter on both sides in its paragraph, and lays out one between letters or alone', () => {
    const rtl = (kids: (InlineChild | LayoutBox)[]): string => codeOf(box('root', { direction: 'rtl' }, [box('c', { direction: 'rtl' }, kids, { font: ahemFont(10), lineHeight: { kind: 'normal' } })]));
    expect(rtl([ib('a'), ib('b')])).toBe('bidi-neutral');
    expect(rtl([text('t', 'aa '), ib('a')])).toBe('bidi-neutral');
    expect(rtl([text('t', 'aa '), ib('a'), br('b'), text('u', 'bb')])).toBe('bidi-neutral');
    expect(rtl([text('t', 'aa '), ib('a'), text('u', ' bb')])).toBe('ok');
    expect(rtl([ib('a')])).toBe('ok');
  });
  it('refuses an inline-block whose last baseline a flex container would give (flex-baseline), and lays out one whose last child is a block', () => {
    const flexChild = box('f', { display: 'flex', flexDirection: 'column' }, [box('f1', {}, [text('f1#0', 'b')])], null);
    const atomic = (kids: LayoutBox[]): LayoutBox => box('a', { display: 'inline-block' }, kids, null);
    expect(codeOf(box('root', {}, [box('c', {}, [text('t', 'a'), atomic([flexChild])])]))).toBe('flex-baseline');
    expect(codeOf(box('root', {}, [box('c', {}, [text('t', 'a'), atomic([flexChild, box('k', {}, [text('k#0', 'c')])])])]))).toBe('ok');
  });
  it('refuses a relatively positioned atomic inline (inline-box-position) and a percentage block size on one (percent-height-flex)', () => {
    const at = (style: Partial<LayoutStyle>): string => codeOf(box('root', {}, [box('c', {}, [text('t', 'a'), ib('a', style)])]));
    expect(at({ position: 'relative' })).toBe('inline-box-position');
    expect(at({ height: { kind: 'percent', value: 50 } })).toBe('percent-height-flex');
    expect(at({ minHeight: { kind: 'percent', value: 50 } })).toBe('percent-height-flex');
    expect(at({ maxHeight: { kind: 'percent', value: 50 } })).toBe('percent-height-flex');
    expect(at({ height: px(20) })).toBe('ok');
  });
});

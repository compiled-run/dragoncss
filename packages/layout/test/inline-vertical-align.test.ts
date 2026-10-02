// INL2b: the engine's vertical-align (CSS2 §10.8.1) against Chrome 145 on the INL-P family 5 vertical-align cases
// (docs/research/inline-spike/probe/family5-atomic.json, blink-notes.md §6) at DPR 1, 2, 3 and 2.625 in ltr and rtl, and the
// planted faults topBottomSinglePass, middleWithoutXHeight and subShiftOwnFont each moving a case off Chrome.
// The span cases hold a 0x0 inline-block marker (data-p="bl") inside the span, which INL2c refuses; it adds no metrics, advance or
// break, so the builder leaves it out and the comparison skips its rect.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, fromCssPx, layoutWithFaults, NO_ENGINE_FAULTS, placeLines, zoomInput } from '../src/index.ts';
import type { EngineFaults, InlineChild, LayoutBox, LayoutInput, LayoutRect, LineHeightValue, VerticalAlignValue } from '../src/index.ts';
import { ahemFont, box, neutralEnvironment, px, span, text } from './helpers.ts';

type ProbeRect = readonly [number, number, number, number];
type ProbeResult = {
  readonly container: ProbeRect;
  readonly lines: readonly { readonly top: number; readonly height: number; readonly baseline: number | null }[];
  readonly leaves: readonly { readonly owner: string; readonly index: number; readonly rects: readonly ProbeRect[] }[];
  readonly elements: Record<string, { readonly tag: string; readonly bounding: ProbeRect }>;
};
type ProbeCase = { readonly width: number; readonly style: string; readonly html: string; readonly results: Record<string, ProbeResult> };

const CASES = (JSON.parse(readFileSync(new URL('../../../docs/research/inline-spike/probe/family5-atomic.json', import.meta.url), 'utf8')) as { readonly cases: Record<string, ProbeCase> }).cases;
const VA_IDS = Object.keys(CASES).filter((id) => /^f5-(va-|sub-|super-|tags-sub|top-|bottom-)/.test(id));

/** The cases the engine refuses, with the code: a percentage vertical-align on an inline-block without inline content (no strut). */
const REFUSED: Record<string, string> = { 'f5-va-ib-50pct': 'vertical-align', 'f5-va-ib-m50pct': 'vertical-align' };

type Decls = { fontSize: number | 'smaller' | null; lineHeight: LineHeightValue | null; va: VerticalAlignValue | null; display: string | null; width: number | null; height: number | null };

function vaOf(v: string): VerticalAlignValue {
  if (v.endsWith('px')) return px(Number(v.slice(0, -2)));
  if (v.endsWith('%')) return { kind: 'percent', value: Number(v.slice(0, -1)) };
  if (['baseline', 'sub', 'super', 'text-top', 'text-bottom', 'middle', 'top', 'bottom'].includes(v)) return { kind: 'keyword', value: v as 'baseline' };
  throw new Error(`vertical-align ${v}`);
}

function decls(style: string): Decls {
  const d: Decls = { fontSize: null, lineHeight: null, va: null, display: null, width: null, height: null };
  for (const part of style.split(';')) {
    const [k, v] = part.split(':').map((x) => x.trim());
    if (k === undefined || v === undefined || k === '') continue;
    if (k === 'font-size') d.fontSize = v === 'smaller' ? 'smaller' : Number(v.replace('px', ''));
    else if (k === 'line-height') d.lineHeight = v === 'normal' ? { kind: 'normal' } : v.endsWith('px') ? { kind: 'px', value: Number(v.slice(0, -2)) } : { kind: 'number', value: Number(v) };
    else if (k === 'vertical-align') d.va = vaOf(v);
    else if (k === 'display') d.display = v;
    else if (k === 'width') d.width = Number(v.replace('px', ''));
    else if (k === 'height') d.height = Number(v.replace('px', ''));
    else throw new Error(`the builder does not read ${k}: ${v}`);
  }
  return d;
}

type Ctx = { readonly size: number; readonly lineHeight: LineHeightValue; readonly owner: string };
type Node = InlineChild | LayoutBox;

/** The case HTML: text, spans (inline or inline-block), sub and sup (their UA font-size: smaller and vertical-align), markers. */
function build(html: string, root: Ctx): Node[] {
  const stack: { ctx: Ctx; children: Node[]; id: string; va: VerticalAlignValue | null; skip: boolean }[] = [{ ctx: root, children: [], id: '', va: null, skip: false }];
  const counts = new Map<string, number>();
  const re = /<(span|sub|sup|i) data-p="([^"]+)"(?: style="([^"]*)")?>|<\/(span|sub|sup|i)>|([^<]+)/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const top = stack[stack.length - 1] as (typeof stack)[number];
    if (m[1] !== undefined) {
      const d = decls(m[3] ?? '');
      const tag = m[1];
      if (tag === 'sub' || tag === 'sup') {
        d.fontSize = 'smaller';
        d.va = { kind: 'keyword', value: tag === 'sub' ? 'sub' : 'super' };
      }
      const size = d.fontSize === 'smaller' ? top.ctx.size / 1.2 : (d.fontSize ?? top.ctx.size);
      const ctx: Ctx = { size, lineHeight: d.lineHeight ?? top.ctx.lineHeight, owner: m[2] as string };
      if (d.display === 'inline-block') {
        // A marker (a 0x0 inline-block inside a span) is left out; a top-level inline-block is an atomic inline.
        const marker = d.width === 0 && d.height === 0 && stack.length > 1;
        if (!marker) top.children.push(box(m[2] as string, { display: 'inline-block', width: px(d.width ?? 0), height: px(d.height ?? 0), verticalAlign: d.va ?? { kind: 'keyword', value: 'baseline' } }, [], null));
        stack.push({ ctx, children: [], id: m[2] as string, va: null, skip: true });
        continue;
      }
      stack.push({ ctx, children: [], id: m[2] as string, va: d.va, skip: false });
    } else if (m[4] !== undefined) {
      const done = stack.pop() as (typeof stack)[number];
      if (done.skip) continue;
      const s = span(done.id, done.children as InlineChild[], { font: ahemFont(done.ctx.size), lineHeight: done.ctx.lineHeight });
      (stack[stack.length - 1] as (typeof stack)[number]).children.push(done.va === null ? s : { ...s, style: { ...s.style, verticalAlign: done.va } });
    } else {
      const n = counts.get(top.ctx.owner) ?? 0;
      counts.set(top.ctx.owner, n + 1);
      top.children.push(text(`${top.ctx.owner}#${n}`, m[5] as string, { font: ahemFont(top.ctx.size), lineHeight: top.ctx.lineHeight }));
    }
  }
  return (stack[0] as (typeof stack)[number]).children;
}

function inputOf(c: ProbeCase, dpr: number, direction: 'ltr' | 'rtl'): LayoutInput {
  const d = decls(c.style);
  const rootCtx: Ctx = { size: typeof d.fontSize === 'number' ? d.fontSize : 10, lineHeight: d.lineHeight ?? { kind: 'normal' }, owner: 'root' };
  const kids = build(c.html, rootCtx);
  const container = box('c', { width: px(c.width), direction }, kids, { font: ahemFont(rootCtx.size), lineHeight: rootCtx.lineHeight });
  return { viewport: { width: 400, height: 300 }, devicePixelRatio: dpr, ...neutralEnvironment({ width: 400, height: 300 }), root: box('root', { direction }, [container]) };
}

const lu = (cssPx: number, dpr: number): number => Math.round(cssPx * dpr * 64);
const rectLu = (r: ProbeRect, dpr: number): number[] => r.map((v) => lu(v, dpr));
const ours = (r: LayoutRect, origin: LayoutRect): number[] => [r.x - origin.x, r.y - origin.y, r.width, r.height];

function compare(id: string, c: ProbeCase, faults: EngineFaults): string[] {
  const problems: string[] = [];
  for (const [env, want] of Object.entries(c.results)) {
    const m = /^dpr([\d.]+)-(ltr|rtl)$/.exec(env);
    if (m === null) throw new Error(`${id}: environment ${env}`);
    const dpr = Number(m[1]);
    const input = inputOf(c, dpr, m[2] as 'ltr' | 'rtl');
    const r = layoutWithFaults(input, ahemMeasurer, faults);
    if (r.kind !== 'ok') {
      problems.push(`${env}: ${r.unsupported.code} ${r.unsupported.detail}`);
      continue;
    }
    const abs = absoluteRects(r.boxes);
    const origin = abs.get('c') as LayoutRect;
    const expectEq = (what: string, got: unknown, exp: unknown): void => {
      if (JSON.stringify(got) !== JSON.stringify(exp)) problems.push(`${env} ${what}: engine ${JSON.stringify(got)}, Chrome ${JSON.stringify(exp)}`);
    };
    expectEq('container', ours(origin, origin), rectLu(want.container, dpr));
    const z = zoomInput(input, NO_ENGINE_FAULTS).root.children[0] as LayoutBox;
    const lines = placeLines({ measurer: ahemMeasurer, devicePixelRatio: 1, faults }, z, fromCssPx(c.width * dpr));
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
      if (label === '#c' || label === 'bl') continue;
      const x = abs.get(label);
      expectEq(`${e.tag} ${label} bounding rect`, x === undefined ? null : ours(x, origin), rectLu(e.bounding, dpr));
    }
  }
  return problems;
}

describe('INL2b: vertical-align equals Chrome on the INL-P family 5 cases (every DPR and direction)', () => {
  const run = VA_IDS.filter((id) => REFUSED[id] === undefined);
  it('runs every vertical-align case of family 5 but the refused ones: 12 span + 10 inline-block + 3 nested + 4 top/bottom', () => {
    expect(run.length).toBe(12 + 10 + 3 + 4);
  });
  it.each(run)('%s', (id) => {
    expect(compare(id, CASES[id] as ProbeCase, NO_ENGINE_FAULTS)).toEqual([]);
  });
  it.each(Object.entries(REFUSED))('refuses %s at every DPR and direction with %s', (id, code) => {
    const c = CASES[id] as ProbeCase;
    for (const env of Object.keys(c.results)) {
      const m = /^dpr([\d.]+)-(ltr|rtl)$/.exec(env) as RegExpExecArray;
      const r = layoutWithFaults(inputOf(c, Number(m[1]), m[2] as 'ltr' | 'rtl'), ahemMeasurer, NO_ENGINE_FAULTS);
      expect(r.kind === 'unsupported' ? r.unsupported.code : 'laid out', `${id} ${env}`).toBe(code);
    }
  });
});

describe('INL2b planted engine faults each move a family 5 case off Chrome', () => {
  const PLANTS: readonly { readonly fault: keyof EngineFaults; readonly cases: readonly string[] }[] = [
    { fault: 'topBottomSinglePass', cases: ['f5-top-bottom-both'] },
    { fault: 'middleWithoutXHeight', cases: ['f5-va-span-middle', 'f5-va-ib-middle'] },
    { fault: 'subShiftOwnFont', cases: ['f5-va-span-sub', 'f5-va-span-super', 'f5-tags-sub-sup'] },
  ];
  it.each(PLANTS)('$fault fails $cases', (p) => {
    for (const id of p.cases) {
      const c = CASES[id] as ProbeCase;
      expect(compare(id, c, NO_ENGINE_FAULTS), id).toEqual([]);
      expect(compare(id, c, { ...NO_ENGINE_FAULTS, [p.fault]: true }).length, id).toBeGreaterThan(0);
    }
  });
});

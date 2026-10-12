import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { absoluteRects, ahemMeasurer, coveredCodePoints, fromCssPx, layout, layoutWithFaults, NO_ENGINE_FAULTS, NO_GRID_FAULTS, placeLines, validateLayoutInput } from '../src/index.ts';
import { ahemOpportunities } from '../src/inline.ts';
import { lineBreakOpportunitiesWith } from '../src/linebreak.ts';
import type { EngineFaults } from '../src/index.ts';
import type { LayoutBox, LayoutRect, LayoutResult, TextLeaf } from '../src/index.ts';
import { anon, box, px, text, neutralEnvironment, ahemFont } from './helpers.ts';

// 10px Ahem: every glyph advances 640 LU, the glyph box is 640 LU high, line-height normal is 640 LU. Expected values are raw
// LayoutUnits, measured in Chrome 145 on the fixtures named in each test.
const G = 640;

function run(root: LayoutBox): LayoutResult {
  return layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer);
}

function rects(r: LayoutResult): Map<string, LayoutRect> {
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return absoluteRects(r.boxes);
}

/** [x, y, width, height] of each line fragment of a leaf, absolute. */
function lines(r: LayoutResult, leaf: string): number[][] {
  const abs = rects(r);
  const out: number[][] = [];
  for (let j = 0; abs.has(`${leaf}:line${j}`); j++) {
    const l = abs.get(`${leaf}:line${j}`) as LayoutRect;
    out.push([l.x, l.y, l.width, l.height]);
  }
  return out;
}

const block = (width: number | null, leaves: TextLeaf[], style: Partial<LayoutBox['style']> = {}): LayoutBox =>
  box('root', {}, [box('a', { ...(width === null ? {} : { width: px(width) }), ...style }, leaves)]);

describe('line breaking (css-text-3 §5)', () => {
  it('breaks after spaces; the spaces that end a line hang and are not part of its fragment (text-wrap-spaces w1)', () => {
    expect(lines(run(block(30, [text('t', 'XX XX XX')])), 't')).toEqual([[0, 0, 2 * G, G], [0, G, 2 * G, G], [0, 2 * G, 2 * G, G]]);
  });
  it('a line that fits exactly keeps its content (text-wrap-spaces w2)', () => {
    expect(lines(run(block(50, [text('t', 'XX XX XX')])), 't')).toEqual([[0, 0, 5 * G, G], [0, G, 2 * G, G]]);
  });
  it('breaks at U+200B, which advances 0 (text-wrap-zwsp z1)', () => {
    expect(lines(run(block(30, [text('t', 'XX​YY​ZZ')])), 't')).toEqual([[0, 0, 2 * G, G], [0, G, 2 * G, G], [0, 2 * G, 2 * G, G]]);
  });
  it('an unbreakable word wider than the line overflows it alone (text-unbreakable-overflow o2)', () => {
    expect(lines(run(block(25, [text('t', 'X XXXXX X')])), 't')).toEqual([[0, 0, G, G], [0, G, 5 * G, G], [0, 2 * G, G, G]]);
  });
  it('text-wrap-mode nowrap keeps one line and overflows (text-unbreakable-overflow o4)', () => {
    expect(lines(run(block(30, [text('t', 'XX XX XX', { textWrapMode: 'nowrap' })])), 't')).toEqual([[0, 0, 8 * G, G]]);
  });
  it('leaves share one formatting context; a leaf whose only content on a line is a hanging space has no fragment there', () => {
    const r = run(block(30, [text('t0', 'XX'), text('t1', ' YY')]));
    expect(lines(r, 't0')).toEqual([[0, 0, 2 * G, G]]);
    expect(lines(r, 't1')).toEqual([[0, G, 2 * G, G]]);
    expect(rects(r).get('t1')).toMatchObject({ x: 0, y: G, width: 2 * G, height: G });
  });
  it('a word spanning two leaves is unbreakable, and a leaf fragment starts where the previous leaf ends', () => {
    const r = run(block(100, [text('t0', 'XX X'), text('t1', 'Y YY')]));
    expect(lines(r, 't0')).toEqual([[0, 0, 4 * G, G]]);
    expect(lines(r, 't1')).toEqual([[4 * G, 0, 4 * G, G]]);
    const narrow = run(block(30, [text('t0', 'XX X'), text('t1', 'Y YY')]));
    expect(lines(narrow, 't0')).toEqual([[0, 0, 2 * G, G], [0, G, G, G]]);
    expect(lines(narrow, 't1')).toEqual([[G, G, G, G], [0, 2 * G, 2 * G, G]]);
  });
  it('the box height is the number of lines times the line height', () => {
    const r = rects(run(block(30, [text('t', 'XX XX XX')])));
    expect(r.get('a')?.height).toBe(3 * G);
  });
});

describe('text-align (css-text-3 §7.1)', () => {
  const at = (align: LayoutBox['style']['textAlign'], width: number, value: string): number[][] => lines(run(block(width, [text('t', value)], { textAlign: align })), 't');
  it('center takes half the free space as LayoutUnit / 2, right and end all of it, per line (text-align-multi-line c, r, e)', () => {
    expect(at('center', 55, 'XX XX XXX X')).toEqual([[160, 0, 5 * G, G], [160, G, 5 * G, G]]);
    expect(at('right', 55, 'XX XX XXX X')).toEqual([[320, 0, 5 * G, G], [320, G, 5 * G, G]]);
    expect(at('end', 55, 'XX XX XXX X')).toEqual([[320, 0, 5 * G, G], [320, G, 5 * G, G]]);
    expect(at('left', 55, 'XX XX XXX X')).toEqual([[0, 0, 5 * G, G], [0, G, 5 * G, G]]);
  });
  it('an odd free space truncates: 50.3px leaves 19 LU, the centre offset is 9 LU (text-align-multi-line codd)', () => {
    expect(at('center', 50.3, 'XX XX XXX')[0]).toEqual([9, 0, 5 * G, G]);
  });
  it('an overflowing line starts at the start edge (text-align-multi-line co, ro)', () => {
    expect(at('center', 25, 'XXXXX XX')).toEqual([[0, 0, 5 * G, G], [160, G, 2 * G, G]]);
    expect(at('right', 25, 'XXXXX XX')).toEqual([[0, 0, 5 * G, G], [320, G, 2 * G, G]]);
  });
  it('hanging trailing spaces are left out of the aligned width', () => {
    expect(at('right', 30, 'XX XX')).toEqual([[G, 0, 2 * G, G], [G, G, 2 * G, G]]);
  });
});

describe('line height per line (CSS2 §10.8.1)', () => {
  const tops = (lh: TextLeaf['lineHeight']): { lines: number[][]; height: number | undefined } => {
    const r = run(block(30, [text('t', 'XX XX XX', { lineHeight: lh })]));
    return { lines: lines(r, 't'), height: rects(r).get('a')?.height };
  };
  it('line k is at k times the line height plus the floored half-leading (text-line-height-multi-line px)', () => {
    expect(tops({ kind: 'px', value: 17 })).toEqual({ lines: [[0, 192, 2 * G, G], [0, 1280, 2 * G, G], [0, 2368, 2 * G, G]], height: 3 * 1088 });
  });
  it('a number multiplies the font size (text-line-height-multi-line num)', () => {
    expect(tops({ kind: 'number', value: 1.5 })).toEqual({ lines: [[0, 128, 2 * G, G], [0, 1088, 2 * G, G], [0, 2048, 2 * G, G]], height: 3 * 960 });
  });
  it('a line-height below the glyph height gives negative leading, floored: -2.5px becomes -3px (text-line-height-multi-line neg5)', () => {
    expect(tops({ kind: 'px', value: 5 })).toEqual({ lines: [[0, -192, 2 * G, G], [0, 128, 2 * G, G], [0, 448, 2 * G, G]], height: 3 * 320 });
    expect(tops({ kind: 'px', value: 7 }).lines.map((l) => l[1])).toEqual([-128, 320, 768]);
  });
});

describe('intrinsic sizes of text (css-sizing-3 §5.1)', () => {
  it('a flex item shrinks to its min-content, the widest segment, and wraps (text-wrap-zwsp z5)', () => {
    const r = rects(run(box('root', {}, [box('row', { display: 'flex', width: px(20) }, [box('i', {}, [text('t', 'XXX​XX')])])])));
    expect(r.get('i')).toMatchObject({ width: 3 * G, height: 2 * G });
  });
  it('an anonymous flex item is a box like any other (flex-text-anonymous-item f2)', () => {
    const r = rects(run(box('root', {}, [box('f', { display: 'flex', flexDirection: 'column', width: px(30) }, [anon('f:anon0', {}, [text('t', 'XX XX XX')])])])));
    expect(r.get('f:anon0')).toMatchObject({ width: 30 * 64, height: 3 * G });
  });
});

describe('planted engine fault breakOffByOne', () => {
  it('lets a line take one glyph more than fits', () => {
    const root = block(45, [text('t', 'XX XX')]);
    const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root };
    expect(lines(layout(input, ahemMeasurer), 't').length).toBe(2);
    expect(lines(layoutWithFaults(input, ahemMeasurer, { ...NO_ENGINE_FAULTS, breakOffByOne: true }), 't').length).toBe(1);
  });
});

describe('the validator rejects text the compiler did not prepare', () => {
  const codes = (root: LayoutBox): string[] => {
    const v = validateLayoutInput(JSON.parse(JSON.stringify({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root })));
    return v.ok ? [] : v.errors.map((e) => e.code);
  };
  it('accepts collapsed text, including a single space leaf between runs', () => {
    expect(codes(block(30, [text('t0', 'XX'), text('t1', ' '), text('t2', 'YY')]))).toEqual([]);
  });
  it('rejects text mixed with boxes and text directly in a flex container', () => {
    expect(codes(box('root', {}, [box('a', {}, [text('t', 'XX'), box('b', {})])]))).toEqual(['mixed-children']);
    expect(codes(box('root', {}, [box('f', { display: 'flex' }, [text('t', 'XX')])]))).toEqual(['text-in-flex']);
  });
  it('rejects uncollapsed text: doubled spaces, tabs, segment breaks, edge spaces, empty leaves, spaces doubled across leaves', () => {
    for (const leaves of [
      [text('t', 'XX  XX')],
      [text('t', 'XX\tXX')],
      [text('t', 'XX\nXX')],
      [text('t', ' XX')],
      [text('t', 'XX ')],
      [text('t0', 'XX'), text('t1', '')],
      [text('t0', 'XX '), text('t1', ' YY')],
    ]) expect(codes(block(30, leaves)), JSON.stringify(leaves.map((l) => l.text))).toEqual(['uncollapsed-text']);
  });
  it('rejects white-space-collapse values other than collapse', () => {
    const bad = JSON.parse(JSON.stringify(block(30, [text('t', 'XX')]))) as { children: { children: Record<string, unknown>[] }[] };
    (bad.children[0]?.children[0] as Record<string, unknown>)['whiteSpaceCollapse'] = 'preserve';
    expect(codes(bad as unknown as LayoutBox)).toEqual(['bad-value']);
  });
});

describe('engine refusals for text', () => {
  it('different text-wrap-mode in one formatting context returns mixed-text-wrap-mode (mixed fonts are laid out since INL1a)', () => {
    const r = run(block(30, [text('t0', 'XX'), text('t1', 'YY', { textWrapMode: 'nowrap' })]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('mixed-text-wrap-mode');
  });
  it('text-align: justify returns text-align until a fixture proves it', () => {
    const r = run(block(30, [text('t', 'XX XX')], { textAlign: 'justify' }));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('text-align');
  });
  it('a code point Ahem does not cover returns text-glyph', () => {
    const r = run(block(30, [text('t', 'Xé')]));
    expect(r.kind === 'unsupported' && r.unsupported.code).toBe('text-glyph');
    expect(r.kind === 'unsupported' && r.unsupported.specSection).toBe('css-fonts-4 §5');
  });
  it("a measurer's text-script refusal (R4) reaches the result with its own code and section", () => {
    const refuse = { ok: false, code: 'text-script', reason: 'U+3A9 is outside Latin, Common and Inherited (R4)' } as const;
    const measurer = { ...ahemMeasurer, measure: () => refuse };
    const r = layout({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root: block(30, [text('t', 'XX XX')]) }, measurer);
    expect(r.kind === 'unsupported' && r.unsupported).toEqual({ code: 'text-script', nodeId: 't', specSection: 'notes/T056-txt1a-spec.md R4', detail: refuse.reason });
  });
});

describe('placeLines: the one source of lines (INL1a, notes/T044-inl-spec.md R3)', () => {
  const ctx = { measurer: ahemMeasurer, devicePixelRatio: 1, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS };
  it('gives each line its top, height and baseline, and each leaf piece its code point range, x, width and content top', () => {
    const b = box('a', { width: px(30) }, [text('t0', 'XX X'), text('t1', 'Y YY')]);
    const got = placeLines(ctx, b, fromCssPx(30));
    expect(got).toEqual([
      { top: 0, height: G, baseline: 512, pieces: [{ leaf: 0, start: 0, visibleEnd: 2, end: 3, x: 0, width: 2 * G, top: 0, ascent: 512, descent: 128 }], boxes: [], boxRects: [], breaks: [], breakRects: [] },
      { top: G, height: G, baseline: G + 512, pieces: [{ leaf: 0, start: 3, visibleEnd: 4, end: 4, x: 0, width: G, top: G, ascent: 512, descent: 128 }, { leaf: 1, start: 0, visibleEnd: 1, end: 2, x: G, width: G, top: G, ascent: 512, descent: 128 }], boxes: [], boxRects: [], breaks: [], breakRects: [] },
      { top: 2 * G, height: G, baseline: 2 * G + 512, pieces: [{ leaf: 1, start: 2, visibleEnd: 4, end: 4, x: 0, width: 2 * G, top: 2 * G, ascent: 512, descent: 128 }], boxes: [], boxRects: [], breaks: [], breakRects: [] },
    ]);
  });
  it('the leaf pieces sit at the baseline minus the ascent: a 13px line-height floors the 1.5px half-leading to 1px', () => {
    const b = box('a', { width: px(30) }, [text('t', 'XX XX', { lineHeight: { kind: 'px', value: 13 } })]);
    const got = placeLines(ctx, b, fromCssPx(30));
    expect(got.map((l) => [l.top, l.height, l.baseline, l.pieces[0]?.top])).toEqual([[0, 832, 64 + 512, 64], [832, 832, 832 + 64 + 512, 832 + 64]]);
  });
});

// INL-P family 3 (docs/research/inline-spike/probe/family3-breaks.json, Chrome 145.0.7632.6): every case without inline boxes, its
// line texts in Chrome at every DPR and direction the probe recorded, against placeLines over the zoomed width and font.
describe('soft wrap opportunities equal Chrome\'s on INL-P family 3 (UAX #14 as Blink applies it, linebreak.ts)', () => {
  type ProbeCase = { readonly width: number; readonly style: string; readonly html: string; readonly results: Record<string, { readonly lines: readonly { readonly text: string }[] }> };
  const raw: unknown = JSON.parse(readFileSync(new URL('../../../docs/research/inline-spike/probe/family3-breaks.json', import.meta.url), 'utf8'));
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const checkCase = (id: string, c: unknown): ProbeCase => {
    if (!isObj(c) || typeof c['width'] !== 'number' || !Number.isFinite(c['width']) || typeof c['style'] !== 'string' || typeof c['html'] !== 'string' || !isObj(c['results'])) throw new Error(`probe case ${id} is malformed`);
    for (const [k, r] of Object.entries(c['results'])) {
      if (!isObj(r) || !Array.isArray(r['lines']) || !r['lines'].every((l) => isObj(l) && typeof l['text'] === 'string')) throw new Error(`probe case ${id} result ${k} is malformed`);
    }
    return c as unknown as ProbeCase;
  };
  if (!isObj(raw) || !isObj(raw['cases'])) throw new Error('family3-breaks.json has no cases object');
  const cases = Object.entries(raw['cases']).map(([id, c]) => [id, checkCase(id, c)] as const);
  const plain = cases.filter(([, c]) => !c.html.includes('<') && c.style === '');
  // The probe HTML escapes only the double quote; any other entity would be compared undecoded.
  const decode = (html: string): string => {
    const value = html.replaceAll('&quot;', '"');
    if (value.includes('&')) throw new Error(`probe text ${html} holds an HTML entity the test does not decode`);
    return value;
  };
  const linesOf = (value: string, width: number, dpr: number, faults: EngineFaults, direction: 'ltr' | 'rtl' = 'ltr'): string[] => {
    const leaf = text('t', value, { font: ahemFont(10 * dpr) });
    const got = placeLines({ measurer: ahemMeasurer, devicePixelRatio: dpr, faults, gridFaults: NO_GRID_FAULTS }, box('c', { width: px(width), direction }, [leaf]), fromCssPx(width * dpr));
    return got.map((l) => {
      if (l.pieces.length !== 1) throw new Error(`${value}: a line of one leaf has ${l.pieces.length} pieces`);
      const p = l.pieces[0] as (typeof l.pieces)[number];
      return [...value].slice(p.start, p.end).join('');
    });
  };
  const chromeLines = (c: ProbeCase, key: string): string[] => {
    const r = c.results[key];
    if (r === undefined) throw new Error(`the probe has no ${key} result`);
    return r.lines.map((l) => l.text);
  };
  const DPR_KEYS = ['dpr1', 'dpr2', 'dpr3', 'dpr2.625'] as const;
  it('covers every tag-free case, 61 of them', () => {
    expect(plain.length).toBe(61);
  });
  it.each(plain)('%s', (_, c) => {
    const value = decode(c.html);
    const dprs = Object.keys(c.results).filter((k) => k.endsWith('-ltr'));
    expect(dprs.length).toBe(4);
    for (const k of dprs) {
      const dpr = Number(k.slice(3, -4));
      expect(linesOf(value, c.width, dpr, NO_ENGINE_FAULTS), k).toEqual(chromeLines(c, k));
    }
  });
  // Letters and spaces are strong or neutral-between-strong in rtl, so these cases lay out right to left as well (UAX #9).
  const rtlSafe = plain.filter(([, c]) => /^[A-Za-z ]*$/.test(decode(c.html)));
  it('the letters-and-spaces cases equal Chrome in rtl too, at every DPR', () => {
    expect(rtlSafe.length).toBeGreaterThan(0);
    for (const [id, c] of rtlSafe) {
      for (const d of DPR_KEYS) expect(linesOf(decode(c.html), c.width, Number(d.slice(3)), NO_ENGINE_FAULTS, 'rtl'), `${id} ${d}-rtl`).toEqual(chromeLines(c, `${d}-rtl`));
    }
  });
  it('each planted break fault moves at least one case off Chrome at every DPR', () => {
    for (const fault of ['spaceOnlyBreaks', 'breakAfterSolidus', 'noHyphenDigitBreak'] as const) {
      for (const d of DPR_KEYS) {
        const moved = plain.filter(([, c]) => JSON.stringify(linesOf(decode(c.html), c.width, Number(d.slice(3)), { ...NO_ENGINE_FAULTS, [fault]: true })) !== JSON.stringify(chromeLines(c, `${d}-ltr`)));
        expect(moved.length, `${fault} ${d}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('the fit test adds one LayoutUnit (linefit.ts fitsAvailable, Blink AvailableWidthToFit)', () => {
  it('a line one LayoutUnit wider than the available width fits; fitWithoutEpsilon breaks it', () => {
    const leaves = [text('t', 'XX XX')];
    const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root: block(50 - 1 / 64, leaves) };
    expect(lines(layout(input, ahemMeasurer), 't').length).toBe(1);
    expect(lines(layoutWithFaults(input, ahemMeasurer, { ...NO_ENGINE_FAULTS, fitWithoutEpsilon: true }), 't').length).toBe(2);
    const two = { ...input, root: block(50 - 2 / 64, leaves) };
    expect(lines(layout(two, ahemMeasurer), 't').length).toBe(2);
  });
});

// ahemOpportunities is lineBreakOpportunitiesWith on the code points the Ahem measurer covers (it keeps linebreak-data.ts out of
// the translated engine): equal on every pair and triple of them and on generated runs, with and without each linebreak.ts plant.
describe('ahemOpportunities equals lineBreakOpportunitiesWith on the Ahem code points', () => {
  const cps = coveredCodePoints();
  const style = { whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap', wordBreak: 'normal', overflowWrap: 'normal', lineBreak: 'auto', hyphens: 'manual', languageRules: 'cj-ideographic' } as const;
  const faultSets = [{ breakAfterSolidus: false, noHyphenDigitBreak: false }, { breakAfterSolidus: true, noHyphenDigitBreak: false }, { breakAfterSolidus: false, noHyphenDigitBreak: true }];
  const box0 = block(10, [text('t', 'X')]);
  const reference = (run: readonly number[], faults: (typeof faultSets)[number]): number[] => {
    const r = lineBreakOpportunitiesWith(run, style, faults);
    if (!r.ok) throw new Error(r.reason);
    return r.opportunities.map((o) => o.position);
  };
  it('every pair and every triple of covered code points, under each fault set', () => {
    let compared = 0;
    for (const faults of faultSets) {
      for (const a of cps) for (const b of cps) {
        expect(ahemOpportunities(box0, [a, b], true, faults), `${a} ${b}`).toEqual(reference([a, b], faults));
        for (const c of cps) {
          const run = [a, b, c];
          const got = ahemOpportunities(box0, run, true, faults);
          const want = reference(run, faults);
          if (got.length !== want.length || got.some((x, i) => x !== want[i])) expect(got, run.join(' ')).toEqual(want);
          compared++;
        }
      }
    }
    expect(compared).toBe(3 * cps.length ** 3);
  });
  it('20000 generated runs of 4 to 24 covered code points, and nowrap gives none', () => {
    let seed = 20260930;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 20000; k++) {
      const n = 4 + Math.floor(next() * 21);
      const run = Array.from({ length: n }, () => cps[Math.floor(next() * cps.length)] as number);
      const faults = faultSets[k % 3] as (typeof faultSets)[number];
      expect(ahemOpportunities(box0, run, true, faults), run.join(' ')).toEqual(reference(run, faults));
    }
    expect(ahemOpportunities(box0, [0x61, 0x20, 0x62], false, faultSets[0] as (typeof faultSets)[number])).toEqual([]);
  });
});

// OVFL Phase A (notes/T046-paint-spec.md §5.8 with T078J): the engine's scroll metrics equal Chrome's committed ones
// (expected-scroll, parity:scroll-capture) on every overflow and viewport-prop case at DPR 1, 2, 3 and 2.625, overflow: scroll
// reserves no gutter, the engine and compiler plants are caught, and Blink's integer conversions are pinned. No Chrome runs here.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutBox, LayoutInput } from '@dragon/layout';
import { fromRaw, measurerFor, NO_ENGINE_FAULTS, scrollRanges, validateLayoutInput } from '@dragon/layout';
import type { Compiled } from 'dragon';
import { iosLayoutProjection, nativePrograms, NO_FAULTS } from 'dragon';
import type { WebCapture } from '../src/capture.ts';
import { committedDprCapture, runDprCase } from '../src/dpr.ts';
import { compileFixture } from '../src/pipeline.ts';
import { nativeCompile } from '../src/native-host.ts';
import type { ScrollRecord } from '../src/scroll-metrics.ts';
import { adjustInt, adjustLayoutUnitRound, assertOverlayScrollbars, CLASSIC_SCROLLBARS, committedScrollCapture, compiledScrollFixture, engineScrollRecords, expectedScrollDir, OVERLAY_PROBE_STYLE, parseScrollCapture, SCROLL_DPRS, SCROLLBAR_ARGS, scrollCases, scrollProblems, viewportDirectionOf } from '../src/scroll-metrics.ts';
import { CHROME_VERSION } from '../src/chrome.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { OVERFLOW } from '../src/fixture-groups/overflow.ts';

const all = scrollCases();
const compiled = new Map<string, Compiled<'ios' | 'web'>>();
const compiledFor = (f: (typeof all)[number], direction: 'ltr' | 'rtl'): Compiled<'ios' | 'web'> => {
  const key = `${f.spec.id} ${direction}`;
  let c = compiled.get(key);
  if (c === undefined) {
    c = compiledScrollFixture(f.spec, direction);
    compiled.set(key, c);
  }
  return c;
};

/** Every case's problems at every DPR with the given engine faults. */
function problemsWith(faults: EngineFaults): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const dpr of SCROLL_DPRS) {
    for (const f of all) {
      for (const c of f.cases) {
        const e = engineScrollRecords(c, compiledFor(f, c.environment.direction), dpr, faults);
        const p = e.kind === 'ok' ? scrollProblems(e.records, committedScrollCapture(c.id, dpr).records) : [e.reason];
        if (p.length > 0) out.set(`${c.id}@${dpr}`, p);
      }
    }
  }
  return out;
}

describe('OVFL scroll metrics against Chrome', () => {
  const ids = all.flatMap((f) => f.cases.map((c) => c.id));

  it('covers the overflow and viewport-prop fixtures, each case committed at every DPR and nothing else', () => {
    // Every layout fixture of the overflow group, each in ltr and rtl (its -rtl twin), and the two earlier overflow: hidden
    // fixtures (ltr only) that the overflow- prefix also takes.
    // overflow-background runs in ltr only (its rtl twin would be refused on native: OVFL-B's start-overflow background refusal).
    const own = OVERFLOW.flatMap((f) => (f.kind === 'layout' ? f.environments.map((d) => (d === 'ltr' ? f.id : `${f.id}-rtl`)) : []));
    expect(own.length).toBe(35);
    expect(ids.filter((id) => !own.includes(id))).toEqual(['overflow-hidden-bfc', 'overflow-hidden-flex-min-size']);
    expect(own.filter((id) => !ids.includes(id))).toEqual([]);
    for (const dpr of SCROLL_DPRS) {
      const files = readdirSync(expectedScrollDir(dpr)).filter((f) => f.endsWith('.scroll.json')).map((f) => f.replace(/\.scroll\.json$/, '')).sort();
      expect(files, `DPR ${dpr}`).toEqual([...ids].sort());
    }
  });

  it('engine scrollWidth, scrollHeight, clientWidth and clientHeight equal Chrome on every case at 1, 2, 3 and 2.625', () => {
    expect(Object.fromEntries(problemsWith(NO_ENGINE_FAULTS))).toEqual({});
  });

  it('the corpus has scroll containers: auto, scroll, hidden, the viewport past its size, and body kept a scroll container', () => {
    const records = all.flatMap((f) => f.cases.map((c) => committedScrollCapture(c.id, 1).records)).flat();
    expect(records.filter((r) => r.id !== 'viewport').length).toBeGreaterThan(30);
    expect(records.some((r) => r.id !== 'viewport' && r.scrollWidth > r.clientWidth)).toBe(true);
    expect(records.some((r) => r.id !== 'viewport' && r.scrollHeight > r.clientHeight)).toBe(true);
    expect(records.some((r) => r.id === 'viewport' && r.scrollWidth > r.clientWidth && r.scrollHeight > r.clientHeight)).toBe(true);
    expect(committedScrollCapture('viewport-prop-demo', 1).records.map((r) => r.id)).toEqual(['viewport', 'body', 'app']);
    expect(committedScrollCapture('viewport-prop-html-x-hidden', 1).records.map((r) => r.id)).toEqual(['viewport']);
    expect(committedScrollCapture('viewport-prop-body-hidden', 1).records.map((r) => r.id)).toEqual(['viewport']);
  });

  it('zero gutter: clientWidth and clientHeight equal the padding box on every overflow: scroll and auto container at every DPR', () => {
    let checked = 0;
    for (const dpr of SCROLL_DPRS) {
      for (const f of all) {
        for (const c of f.cases) {
          const boxes: WebCapture = committedDprCapture(c.id, dpr);
          for (const r of committedScrollCapture(c.id, dpr).records) {
            if (r.id === 'viewport') continue;
            const node = boxes.nodes.find((n) => n.id === r.id);
            if (node === undefined || node.computed === null) throw new Error(`${c.id}: no captured box ${r.id}`);
            const ox = node.computed['overflow-x'];
            if (ox !== 'scroll' && ox !== 'auto') continue;
            const bw = (s: string): number => Number.parseFloat(node.computed?.[s] ?? 'NaN');
            expect(r.clientWidth, `${c.id}@${dpr} ${r.id}`).toBe(Math.round(node.width - bw('border-left-width') - bw('border-right-width')));
            expect(r.clientHeight, `${c.id}@${dpr} ${r.id}`).toBe(Math.round(node.height - bw('border-top-width') - bw('border-bottom-width')));
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('planted engine faults gutterReserved and overflowIgnoresPadding are caught', () => {
    const gutter = problemsWith({ ...NO_ENGINE_FAULTS, gutterReserved: true });
    expect(gutter.has('overflow-scroll-basic@1')).toBe(true);
    expect([...gutter.values()].flat().some((p) => p.includes('clientWidth'))).toBe(true);
    const padding = problemsWith({ ...NO_ENGINE_FAULTS, overflowIgnoresPadding: true });
    expect(padding.has('overflow-end-padding@2')).toBe(true);
    expect(padding.get('overflow-end-padding@1')?.some((p) => p.startsWith('a1 scrollWidth'))).toBe(true);
  });
});

describe('OVFL-B: the scroll offset range against Chrome', () => {
  /** The engine's ranges of every case at a DPR, or the reason it has none. */
  const rangesOf = (f: (typeof all)[number], c: (typeof all)[number]['cases'][number], dpr: number) => {
    const p = iosLayoutProjection(compiledFor(f, c.environment.direction), { ...c.environment, devicePixelRatio: dpr }, c.assignment);
    if (p.kind === 'blocked') throw new Error(`${c.id}: ${p.reason}`);
    const v = validateLayoutInput(JSON.parse(JSON.stringify(p.input)));
    if (!v.ok) throw new Error(`${c.id}: invalid input`);
    const m = measurerFor(REFERENCE_PLATFORM);
    if (m.kind !== 'ok') throw new Error(m.detail);
    const r = scrollRanges(v.input, m.measurer);
    if (r.kind !== 'ok') throw new Error(`${c.id}: ${r.detail}`);
    // Every scroll container of the overflow cases is decided: none is left out of the comparison as refused.
    if (r.refused.length > 0) throw new Error(`${c.id}@${dpr}: the engine refused the scroll range of ${r.refused.map((x) => `${x.id} at ${x.nodeId}: ${x.detail}`).join('; ')}`);
    return r.ranges;
  };

  it('every scroll container scrolls between exactly the offsets Chrome clamps scrollLeft and scrollTop to, in whole device px, at 1, 2, 3 and 2.625', () => {
    const problems: string[] = [];
    let checked = 0;
    let startSide = 0;
    for (const dpr of SCROLL_DPRS) {
      for (const f of all) {
        for (const c of f.cases) {
          const engine = rangesOf(f, c, dpr);
          const chrome = committedScrollCapture(c.id, dpr).extents;
          if (engine.map((r) => r.id).join() !== chrome.map((r) => r.id).join()) problems.push(`${c.id}@${dpr}: containers [${engine.map((r) => r.id)}], chrome [${chrome.map((r) => r.id)}]`);
          for (const e of chrome) {
            const g = engine.find((r) => r.id === e.id);
            if (g === undefined) continue;
            const want = [e.minLeft, e.maxLeft, e.minTop, e.maxTop].map((x) => x * dpr);
            for (const w of want) if (Math.abs(w - Math.round(w)) > 1e-3) problems.push(`${c.id}@${dpr} ${e.id}: Chrome's ${w} is not a whole device px`);
            const got = [g.minX, g.maxX, g.minY, g.maxY];
            if (got.some((x, i) => x !== Math.round(want[i] as number))) problems.push(`${c.id}@${dpr} ${e.id}: engine [${got}], chrome [${want.map(Math.round)}]`);
            if (g.minX > 0 || g.maxX < 0 || g.minY > 0 || g.maxY < 0) problems.push(`${c.id}@${dpr} ${e.id}: offset 0 is outside [${got}]`);
            if (g.minX < 0 || g.minY < 0) startSide++;
            checked++;
          }
        }
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(400);
    // rtl and the reversed flex containers scroll past their start side.
    expect(startSide).toBeGreaterThan(80);
  });

  it('the scroll origin is floored to whole device px: overflow-flex-reverse a1 has 236.53 device px before its start at 2.625, and Chrome scrolls 236 of it', () => {
    const f = all.find((x) => x.spec.id === 'overflow-flex-reverse');
    const c = f?.cases.find((x) => x.id === 'overflow-flex-reverse');
    if (f === undefined || c === undefined) throw new Error('no overflow-flex-reverse case');
    const g = rangesOf(f, c, 2.625).find((r) => r.id === 'a1');
    const e = committedScrollCapture('overflow-flex-reverse', 2.625).extents.find((r) => r.id === 'a1');
    expect(g?.minX).toBe(-236);
    expect(e === undefined ? null : Math.round(e.minLeft * 2.625)).toBe(-236);
  });
});

describe('OVFL-B: a scroll container with a painted background is proven against Chrome', () => {
  it('some ltr overflow case lowers on native to a scroll view whose box paints an opaque background, and every one of them is in the scroll metrics', () => {
    const found: string[] = [];
    for (const f of all) {
      if (f.spec.kind !== 'layout' || !f.spec.environments.includes('ltr')) continue;
      const compiled = nativeCompile(f.spec, 'ltr');
      for (const c of f.cases.filter((x) => x.environment.direction === 'ltr')) {
        const p = nativePrograms(compiled, c.assignment);
        if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
        for (const n of p.programs.uikit.nodes) {
          const scroll = n.writes.some((w) => w.kind === 'scroll-container');
          const opaque = n.writes.some((w) => w.kind === 'background-color' && w.color.alpha > 0);
          if (scroll && opaque) found.push(`${c.id} ${n.id}`);
        }
      }
    }
    expect(found.filter((x) => x.startsWith('overflow-background '))).toEqual(['overflow-background b1', 'overflow-background b2', 'overflow-background b3', 'overflow-background b4', 'overflow-background b5', 'overflow-background b6a']);
  });
});

describe('OVFL viewport propagation (compiler, design A)', () => {
  const caseOf = (id: string) => {
    for (const f of all) for (const c of f.cases) if (c.id === id) return { f, c };
    throw new Error(`no case ${id}`);
  };
  const inputOf = (id: string, faults = NO_FAULTS): LayoutInput => {
    const { f, c } = caseOf(id);
    const p = iosLayoutProjection(compileFixture(f.spec, faults, 'enforce', c.environment.direction).compiled, c.environment, c.assignment);
    if (p.kind === 'blocked') throw new Error(p.reason);
    const v = validateLayoutInput(JSON.parse(JSON.stringify(p.input)));
    if (!v.ok) throw new Error('invalid');
    return v.input;
  };
  const body = (input: LayoutInput): LayoutBox => input.root.children.find((k): k is LayoutBox => k.kind === 'box' && k.id === 'body') as LayoutBox;

  it('html propagates and uses visible; body keeps its own overflow and stays a scroll container', () => {
    const input = inputOf('viewport-prop-demo');
    expect([input.root.style.overflowX, input.root.style.overflowY]).toEqual(['visible', 'visible']);
    expect([body(input).style.overflowX, body(input).style.overflowY]).toEqual(['hidden', 'auto']);
  });

  it('body propagates when html is visible and uses visible', () => {
    const input = inputOf('viewport-prop-body-hidden');
    expect([body(input).style.overflowX, body(input).style.overflowY]).toEqual(['visible', 'visible']);
  });

  it('the viewport direction is body\'s', () => {
    expect(viewportDirectionOf(inputOf('viewport-prop-demo-rtl'))).toBe('rtl');
    expect(viewportDirectionOf(inputOf('viewport-prop-demo'))).toBe('ltr');
  });

  it('planted compiler fault propagationFromBody: body loses its scroll container, so viewport-prop-demo fails the layout lane', () => {
    const { f, c } = caseOf('viewport-prop-demo');
    const faulty = compileFixture(f.spec, { ...NO_FAULTS, propagationFromBody: true }, 'enforce', 'ltr').compiled;
    const bad = runDprCase(c, faulty, 1, committedDprCapture(c.id, 1));
    expect(bad.status).toBe('fail');
    expect(bad.reason).toMatch(/^body: /);
    const good = runDprCase(c, compileFixture(f.spec, NO_FAULTS, 'enforce', 'ltr').compiled, 1, committedDprCapture(c.id, 1));
    expect(good.status).toBe('pass');
  });
});

describe('Blink integer conversions', () => {
  it('AdjustLayoutUnit rounds half up after a float division; AdjustInt adds 0.5 before dividing and 0.01 before truncating', () => {
    expect(adjustLayoutUnitRound(fromRaw(64 * 10 + 31), 1)).toBe(10);
    expect(adjustLayoutUnitRound(fromRaw(64 * 10 + 32), 1)).toBe(11);
    expect(adjustLayoutUnitRound(fromRaw(64 * 21), 2)).toBe(11);
    expect(adjustLayoutUnitRound(fromRaw(64 * 20), 3)).toBe(7);
    expect(adjustInt(787, 2.625)).toBe(300);
    expect(adjustInt(21, 2)).toBe(10);
    expect(adjustInt(20, 3)).toBe(6);
    expect(adjustInt(5, 1)).toBe(5);
  });

  it('scrollProblems reports a missing container and every differing number', () => {
    const r = (id: string, w: number): ScrollRecord => ({ id, scrollWidth: w, scrollHeight: 1, clientWidth: 1, clientHeight: 1 });
    expect(scrollProblems([r('viewport', 1), r('a', 5)], [r('viewport', 1), r('a', 6)])).toEqual(['a scrollWidth: engine 5, chrome 6']);
    expect(scrollProblems([r('viewport', 1)], [r('viewport', 1), r('a', 6)])).toEqual(['scroll containers: engine [viewport], chrome [viewport,a]']);
  });

  it('a committed capture of the wrong case or DPR is refused', () => {
    expect(() => committedScrollCapture('overflow-rtl', 7)).toThrow();
  });
});

describe('the capture environment (R2: overlay scrollbars only)', () => {
  const page = (clientWidth: number) => ({ evaluate: async (_f: unknown, style: unknown) => (style === OVERLAY_PROBE_STYLE ? clientWidth : -1) }) as unknown as Parameters<typeof assertOverlayScrollbars>[0];

  it('a probe that keeps clientWidth 100 passes; a classic gutter (85) or anything else throws', async () => {
    await expect(assertOverlayScrollbars(page(100))).resolves.toBeUndefined();
    await expect(assertOverlayScrollbars(page(85))).rejects.toThrow(CLASSIC_SCROLLBARS);
    await expect(assertOverlayScrollbars(page(0))).rejects.toThrow('clientWidth 0, not 100');
  });

  it('every committed capture records overlay scrollbars, and a capture without them is refused', () => {
    const capture = { case: 'c', chrome: CHROME_VERSION, platform: REFERENCE_PLATFORM, devicePixelRatio: 2, direction: 'ltr', scrollbars: 'overlay', scrollbarArgs: '-AppleShowScrollBars WhenScrolling', records: [{ id: 'viewport', scrollWidth: 1, scrollHeight: 1, clientWidth: 1, clientHeight: 1 }], extents: [] };
    expect(parseScrollCapture(JSON.stringify(capture), 'c', 2, 'x').scrollbars).toBe('overlay');
    expect(() => parseScrollCapture(JSON.stringify({ ...capture, scrollbars: 'classic' }), 'c', 2, 'x')).toThrow('scrollbars is "classic", not overlay');
    const { scrollbars: _s, ...without } = capture;
    expect(() => parseScrollCapture(JSON.stringify(without), 'c', 2, 'x')).toThrow('scrollbars is undefined, not overlay');
    expect(() => parseScrollCapture(JSON.stringify({ ...capture, scrollbarArgs: '' }), 'c', 2, 'x')).toThrow('scrollbarArgs is ""');
    expect(() => parseScrollCapture('[]', 'c', 2, 'x')).toThrow('not a scroll capture object');
    expect(() => parseScrollCapture(JSON.stringify({ ...capture, extents: [{ id: 'a', minLeft: 0, maxLeft: 1, minTop: 0, maxTop: 0 }] }), 'c', 2, 'x')).toThrow('are not the element scroll containers');
    expect(() => parseScrollCapture(JSON.stringify({ ...capture, extents: undefined }), 'c', 2, 'x')).toThrow('extents is not a list');
    expect(() => parseScrollCapture(JSON.stringify({ ...capture, platform: 'linux-x64' }), 'c', 2, 'x')).toThrow('platform "linux-x64"');
    expect(() => parseScrollCapture(JSON.stringify({ ...capture, direction: 'up' }), 'c', 2, 'x')).toThrow('direction "up"');
    for (const dpr of SCROLL_DPRS) for (const f of all) for (const c of f.cases) expect(committedScrollCapture(c.id, dpr)).toMatchObject({ scrollbars: 'overlay', scrollbarArgs: SCROLLBAR_ARGS.join(' ') });
  });
});

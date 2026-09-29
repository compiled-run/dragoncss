// The native dump checks (native-strategy.md 3.1) and the reference proof (T009 P3 item 6): TS engine plus snapRect dumps for
// every layout case at every device DPR of each target validate and pass (a) and (d); every planted dump fault fails its check.
import { describe, expect, it } from 'vitest';
import type { LayoutRect } from '@dragon/layout';
import { layout, measurerFor } from '@dragon/layout';
import { NO_FAULTS } from 'dragon';
import type { WebCapture } from '../src/capture.ts';
import { GATE_CHANNEL_DELTA, GATE_DEVICE_PX, GATE_GLYPH_CENTRE_DEVICE_PX } from '../src/compare.ts';
import { atDpr, committedDprCapture, layoutCases } from '../src/dpr.ts';
import { declaredLayoutCaseCount } from '../src/case-count.ts';
import { referenceProof } from '../src/lanes.ts';
import type { ExpectedApplied, ReferenceFaults, RgbaImage } from '../src/native-compare.ts';
import { checkAgainstChrome, checkAgainstEngine, checkApplied, checkPixels, DUMP_FAULTS, glyphCentres, NO_REFERENCE_FAULTS, readSamples, referenceDump } from '../src/native-compare.ts';
import type { DumpNode, NativeDump } from '../src/native-dump.ts';
import { frameOf, validateNativeDump } from '../src/native-dump.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { compileFixture } from '../src/pipeline.ts';
import type { GlyphBox, SampleBox } from '../src/samples.ts';
import { generateGlyphSamples, generateSamples } from '../src/samples.ts';
import type { NativeTarget } from '../src/targets.ts';
import { layoutCaseIds, nativeTargets } from '../src/targets.ts';

const all = layoutCases();
const measurer = (() => {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(m.detail);
  return m.measurer;
})();

const compiledCache = new Map<string, ReturnType<typeof compileFixture>['compiled']>();

function reference(caseId: string, dpr: number, platform: NativeTarget, faults: ReferenceFaults = NO_REFERENCE_FAULTS): { dump: NativeDump; engine: readonly LayoutRect[]; capture: WebCapture } {
  const f = all.find((x) => x.cases.some((c) => c.id === caseId));
  const c = f?.cases.find((x) => x.id === caseId);
  if (f === undefined || c === undefined) throw new Error(`no case ${caseId}`);
  const key = `${f.spec.id} ${c.environment.direction}`;
  const compiled = compiledCache.get(key) ?? compileFixture(f.spec, NO_FAULTS, 'enforce', c.environment.direction).compiled;
  compiledCache.set(key, compiled);
  const t = nativeTargets().find((x) => x.target === platform);
  const p = t?.projection(compiled, atDpr(c.environment, dpr), c.assignment);
  if (p === undefined || p.kind !== 'ready') throw new Error('projection blocked');
  const out = layout(p.input, measurer);
  if (out.kind !== 'ok') throw new Error('unsupported');
  const dump = referenceDump({ platform, caseId, fixture: f.spec.id, dpr, direction: c.environment.direction, compilerDigest: compiled.digest, input: p.input, engine: out.boxes }, faults);
  return { dump, engine: out.boxes, capture: committedDprCapture(caseId, dpr) };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const withNode = (d: NativeDump, id: string, f: (n: DumpNode) => DumpNode): NativeDump => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? f(n) : n)) });
const moveRight = (n: DumpNode, px: number, scale: number): DumpNode => {
  const deviceEdges = { ...n.deviceEdges, right: n.deviceEdges.right + px };
  return { ...n, deviceEdges, frame: frameOf(deviceEdges, scale) };
};

describe('reference proof: TS engine plus snapRect dumps pass (a) and (d)', () => {
  it('every layout case at 2 and 3 on ios and at 2, 3 and 2.625 on android', () => {
    const proof = referenceProof(nativeTargets());
    const cases = layoutCaseIds().length;
    expect(proof.map((p) => [p.target, p.rows.map((r) => r.dpr)])).toEqual([['ios', [2, 3]], ['android', [2, 3, 2.625]]]);
    for (const p of proof) {
      for (const r of p.rows) {
        console.log(`reference proof ${p.target} DPR ${r.dpr} (${r.role}): ${r.cases} cases, ${r.valid} valid, (a) ${r.chrome}/${r.cases} over ${r.chromeCompared} nodes and lines, (d) ${r.engine}/${r.cases} over ${r.engineCompared}`);
        expect(r.failures).toEqual([]);
        expect([r.cases, r.valid, r.chrome, r.engine]).toEqual([cases, cases, cases, cases]);
        expect(r.chromeCompared).toBeGreaterThan(0);
      }
    }
    expect(cases).toBe(declaredLayoutCaseCount());
  });
});

describe('negative checks', () => {
  const base = reference('block-border-box', 2, 'ios');
  const dpr = 2;

  it('the unplanted dump validates and passes (a) and (d)', () => {
    expect(validateNativeDump(clone(base.dump)).ok).toBe(true);
    expect(checkAgainstChrome(base.dump, base.capture)).toMatchObject({ pass: true });
    expect(checkAgainstEngine(base.dump, base.engine)).toMatchObject({ pass: true });
  });

  // An edge where Chrome's css px times the DPR is the snapped device edge, so a move of k device px is a delta of exactly k.
  const exactEdge = ((): string => {
    for (const n of base.dump.nodes) {
      const c = base.capture.nodes.find((x) => x.id === n.id);
      if (n.kind === 'element' && c !== undefined && (c.x + c.width) * dpr === n.deviceEdges.right) return n.id;
    }
    throw new Error('no exact right edge');
  })();

  it('an edge moved +2 device px fails (a)', () => {
    const d = withNode(base.dump, exactEdge, (n) => moveRight(n, 2, dpr));
    const a = checkAgainstChrome(d, base.capture);
    expect(a.pass).toBe(false);
    expect(a.problems.join('\n')).toContain(`${exactEdge}: edge delta`);
  });
  it('an edge moved +1 device px fails (d) and still passes (a)', () => {
    const d = withNode(base.dump, exactEdge, (n) => moveRight(n, 1, dpr));
    expect(validateNativeDump(clone(d)).ok).toBe(true);
    expect(checkAgainstChrome(d, base.capture).pass).toBe(true);
    const e = checkAgainstEngine(d, base.engine);
    expect(e.pass).toBe(false);
    expect(e.problems.join('\n')).toContain(`${exactEdge}: deviceEdges`);
  });
  it('a changed or missing applied key fails (b); an equal one passes', () => {
    const applied = { 'layer.cornerRadius': 8, backgroundColor: [0.2, 0.4, 1, 1] };
    const d = withNode(base.dump, exactEdge, (n) => ({ ...n, applied }));
    const expected: ExpectedApplied = new Map([[exactEdge, applied]]);
    expect(checkApplied(d, expected)).toMatchObject({ pass: true, compared: 2 });
    const changed = withNode(d, exactEdge, (n) => ({ ...n, applied: { ...applied, 'layer.cornerRadius': 8.5 } }));
    expect(checkApplied(changed, expected).problems).toEqual([`${exactEdge}: applied layer.cornerRadius is 8.5, expected 8`]);
    const missing = withNode(d, exactEdge, (n) => ({ ...n, applied: { backgroundColor: applied.backgroundColor } }));
    expect(checkApplied(missing, expected).problems).toEqual([`${exactEdge}: applied key layer.cornerRadius is missing`]);
    const extra = withNode(d, exactEdge, (n) => ({ ...n, applied: { ...applied, alpha: 1 } }));
    expect(checkApplied(extra, expected).problems).toEqual([`${exactEdge}: applied key alpha is not expected`]);
  });
  it('a missing node fails the validator (no id), (a) and (d)', () => {
    const noId = clone(base.dump) as unknown as { nodes: Record<string, unknown>[] };
    const i = noId.nodes.findIndex((n) => n['id'] === exactEdge);
    delete noId.nodes[i]?.['id'];
    expect(validateNativeDump(noId)).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: `nodes[${i}].id`, code: 'missing-key' })] });
    const d = { ...base.dump, nodes: base.dump.nodes.filter((n) => n.id !== exactEdge).map((n) => (n.parent === exactEdge ? { ...n, parent: null } : n)) };
    expect(checkAgainstChrome(d, base.capture).problems).toContain(`${exactEdge}: Chrome has a box but the dump has no node ${exactEdge}`);
    expect(checkAgainstEngine(d, base.engine).problems).toContain(`${exactEdge}: the engine laid out ${exactEdge} but the dump has no such node`);
  });
  it('snap disabled on one platform fails (d): android without the snap over every case at 2.625 and 3, ios with it passes', () => {
    let failing = 0;
    let checked = 0;
    for (const dprX of [2.625, 3]) {
      for (const id of layoutCaseIds()) {
        const off = reference(id, dprX, 'android', { snap: 'off' });
        expect(validateNativeDump(clone(off.dump)).ok).toBe(true);
        checked++;
        if (!checkAgainstEngine(off.dump, off.engine).pass) failing++;
      }
    }
    console.log(`snap disabled on android: (d) fails in ${failing}/${checked} cases at 2.625 and 3`);
    expect(failing).toBeGreaterThan(0);
    const on = reference('block-border-box', 2.625, 'ios');
    expect(checkAgainstEngine(on.dump, on.engine).pass).toBe(true);
  });
  it('the gates are the imported constants', () => {
    expect(GATE_DEVICE_PX).toBe(1);
    expect(GATE_CHANNEL_DELTA).toBe(0);
    expect(GATE_GLYPH_CENTRE_DEVICE_PX).toBe(0.5);
  });
});

describe('(c) pixel samples against synthetic images', () => {
  const W = 60;
  const H = 40;
  const box: SampleBox = { id: 'b', left: 10, top: 10, right: 50, bottom: 30, border: { top: 0, right: 0, bottom: 0, left: 0 }, radius: 0, clips: false };
  const BLUE = [51, 102, 255, 255];
  const WHITE = [255, 255, 255, 255];
  /** A white image with the blue box; coverage in [0, 1] of the left edge column when a fractional edge is drawn. */
  function image(shift = 0, leftCoverage: number | null = null): RgbaImage {
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inside = x >= box.left + shift && x < box.right + shift && y >= box.top && y < box.bottom;
        let c = inside ? BLUE : WHITE;
        if (leftCoverage !== null && x === box.left - 1 && y >= box.top && y < box.bottom) c = WHITE.map((w, k) => Math.round(w + ((BLUE[k] as number) - w) * leftCoverage));
        data.set(c, (y * W + x) * 4);
      }
    }
    return { width: W, height: H, data };
  }
  const points = generateSamples([box], { width: W, height: H });
  const chrome = image();

  it('the same pixels pass, with colour points and edge probes compared', () => {
    const r = checkPixels(readSamples(image(), points), points, chrome);
    expect(r).toMatchObject({ pass: true });
    expect(r.compared).toBe(points.filter((p) => !p.rule.startsWith('edge:')).length + 4);
  });
  it('a channel delta of 1 at one colour point fails', () => {
    const s = readSamples(image(), points).map((x) => (x.rule === 'interior:b' ? { ...x, rgba: [x.rgba[0] as number, (x.rgba[1] as number) + 1, x.rgba[2] as number, x.rgba[3] as number] } : x));
    const r = checkPixels(s, points, chrome);
    expect(r.pass).toBe(false);
    expect(r.problems[0]).toMatch(/^interior:b at 30,20: native \[51,103,255,255\], Chrome \[51,102,255,255\]/);
  });
  it('edge positions: 1 device px passes, 2 fails; a half-covered Chrome column is half a pixel, so 0.5 passes and 1.5 fails', () => {
    expect(checkPixels(readSamples(image(1), points), points, chrome).pass).toBe(true);
    const two = checkPixels(readSamples(image(2), points), points, chrome);
    expect(two.pass).toBe(false);
    expect(two.problems.some((p) => p.startsWith('edge:b:left: edge at'))).toBe(true);
    const aa = image(0, 0.5);
    const r = checkPixels(readSamples(aa, points), points, chrome);
    expect(r.pass).toBe(true);
    expect(checkPixels(readSamples(image(-1), points), points, aa).pass).toBe(true);
    expect(checkPixels(readSamples(image(1), points), points, aa).pass).toBe(false);
  });
  it('a missing or moved sample point fails before any colour is compared', () => {
    const s = readSamples(image(), points);
    expect(checkPixels(s.slice(1), points, chrome).pass).toBe(false);
    expect(checkPixels(s.map((x, i) => (i === 0 ? { ...x, x: x.x + 1 } : x)), points, chrome).problems[0]).toMatch(/^sample 0 is /);
  });
});

describe('(c) glyph centres per line (T093 ruling A)', () => {
  const W = 120;
  const H = 60;
  const glyphs: GlyphBox[] = [
    { left: 20.25, top: 15.5, right: 50.25, bottom: 45.5 },
    { left: 50.25, top: 15.5, right: 80.25, bottom: 45.5 },
  ];
  const lines = [{ id: 't:text0:line0', glyphs }];
  const points = generateGlyphSamples(lines, { width: W, height: H });
  const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  /** Black glyph boxes on white by exact area coverage, moved by dx, dy and grown by grow on each side; plus solid black rects. */
  function image(dx = 0, dy = 0, grow = 0, solid: readonly GlyphBox[] = []): RgbaImage {
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let cov = 0;
        for (const g of glyphs) cov += overlap(x, x + 1, g.left + dx - grow, g.right + dx + grow) * overlap(y, y + 1, g.top + dy - grow, g.bottom + dy + grow);
        if (solid.some((r) => x >= r.left && x + 1 <= r.right && y >= r.top && y + 1 <= r.bottom)) cov = 1;
        const v = Math.round(255 * (1 - Math.min(1, cov)));
        data.set([v, v, v, 255], (y * W + x) * 4);
      }
    }
    return { width: W, height: H, data };
  }
  const chrome = image();

  it('the rule pairs the line\'s glyph-left with glyph-right and glyph-top with glyph-bottom; the same pixels give no centre error', () => {
    expect([...new Set(points.filter((p) => p.rule.startsWith('edge:')).map((p) => p.rule))]).toEqual(['edge:t:text0:line0:glyph-left', 'edge:t:text0:line0:glyph-right', 'edge:t:text0:line0:glyph-top', 'edge:t:text0:line0:glyph-bottom']);
    const c = glyphCentres(readSamples(chrome, points), chrome);
    expect(c.map((x) => [x.line, x.axis])).toEqual([['t:text0:line0', 'x'], ['t:text0:line0', 'y']]);
    for (const x of c) expect(x.native).toBe(x.chrome);
    // 8-bit coverage puts the measured edges within 1/255 device px of the geometry.
    expect(c[0]?.chrome).toBeCloseTo(50.25, 2);
    expect(c[1]?.chrome).toBeCloseTo(30.5, 2);
    const r = checkPixels(readSamples(chrome, points), points, chrome);
    expect(r).toMatchObject({ pass: true });
    expect(r.compared).toBe(points.filter((p) => !p.rule.startsWith('edge:')).length + 4 + 2);
  });
  it('a 1 device px glyph shift passes every ink edge but fails the centre on its axis, right or down', () => {
    const right = checkPixels(readSamples(image(1, 0), points), points, chrome);
    expect(right.problems.filter((p) => p.startsWith('edge:'))).toEqual([]);
    expect(right.problems).toEqual([expect.stringMatching(/^centre:t:text0:line0:x: glyph centre at 51\.25\d device px, Chrome 50\.25\d; differs by more than 0\.5 device px$/)]);
    const down = checkPixels(readSamples(image(0, 1), points), points, chrome);
    expect(down.problems).toEqual([expect.stringMatching(/^centre:t:text0:line0:y: glyph centre at 31\.50\d device px, Chrome 30\.50\d/)]);
    expect(checkPixels(readSamples(image(-1, -1), points), points, chrome).problems.map((p) => p.slice(0, 22))).toEqual(['centre:t:text0:line0:x', 'centre:t:text0:line0:y']);
  });
  it('a shift of 0.3 device px and a symmetric Chrome fringe of 0.4 device px pass', () => {
    expect(checkPixels(readSamples(image(0.3, 0.3), points), points, chrome).pass).toBe(true);
    const fringe = image(0, 0, 0.4);
    const r = checkPixels(readSamples(chrome, points), points, fringe);
    expect(r.pass).toBe(true);
    for (const c of glyphCentres(readSamples(chrome, points), fringe)) expect(Math.abs(c.native - c.chrome)).toBeLessThan(0.01);
  });
  it('a glyph-edge scanline with no contrast in Chrome is compared at its two clear ends only', () => {
    // Solid ink right of the line's last glyph: the right scanline runs from ink to ink.
    const bar: GlyphBox = { left: 80, top: 0, right: 120, bottom: 60 };
    const ref = image(0, 0, 0, [bar]);
    const native = image(0, 0, 0, [bar]);
    const seam = points.filter((p) => p.rule === 'edge:t:text0:line0:glyph-right');
    const mid = seam[Math.floor(seam.length / 2)];
    if (mid === undefined) throw new Error('no glyph-right scanline');
    native.data.set([90, 90, 90, 255], (mid.y * W + mid.x) * 4);
    const r = checkPixels(readSamples(native, points), points, ref);
    expect(r.pass).toBe(true);
    const end = seam[0];
    if (end === undefined) throw new Error('no glyph-right scanline');
    native.data.set([90, 90, 90, 255], (end.y * W + end.x) * 4);
    expect(checkPixels(readSamples(native, points), points, ref).problems).toEqual([expect.stringMatching(new RegExp(`^edge:t:text0:line0:glyph-right at ${end.x},${end.y}: native \\[90,90,90,255\\]`))]);
  });
});

describe('dump faults', () => {
  it('every planted dump fault has a failing check above, the same list for both targets', () => {
    expect(DUMP_FAULTS).toEqual(['edge-plus-2-device-px', 'edge-plus-1-device-px', 'applied-changed', 'applied-missing', 'channel-delta-1', 'missing-node', 'snap-disabled', 'break-shifted']);
    for (const t of nativeTargets()) expect(t.plantedFaults).toBe(DUMP_FAULTS);
  });
});

// T065 R18: the device-anim lane's per-sample Chrome references. The pixel subset is a deterministic subset of the dump indexes
// with t = 0 and every settle, at most FRAME_PIXEL_CAP per DPR over every frame case, and a planted change to its rule is caught;
// the breaks and pixel readers refuse a wrong schema, case, DPR, sample list, raster path or PNG.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnimCase, FrameStep } from '../src/anim-cases.ts';
import { animCasesOf, animFixtures, FRAME_PIXEL_CAP, frameScript, NO_PIXEL_FAULTS, pixelSamples, pixelSampleTotal } from '../src/anim-cases.ts';
import type { FrameCapture } from '../src/frame-capture.ts';
import { committedFrameBreaks, committedFramePixels, FRAME_BREAKS_SCHEMA, frameBreaksJson, frameBreaksPath, frameCaptureJson, framePixelManifestJson, framePixelSamples, framePixelsDir, FRAMES_CAPTURE_SCHEMA } from '../src/frame-capture.ts';
import { encodePng } from '../src/gallery.ts';
import { SOFTWARE_RASTER } from '../src/pixel-reference.ts';

const cases = animFixtures().flatMap(animCasesOf);

/** What keeps a pixel subset from being ascending dump indexes holding t = 0 and every settle; empty when it is. */
function subsetProblems(steps: readonly FrameStep[], pixels: readonly number[]): string[] {
  const dumps = steps.filter((s): s is Extract<FrameStep, { kind: 'dump' }> => s.kind === 'dump');
  const out: string[] = [];
  pixels.forEach((k, i) => {
    if (!Number.isInteger(k) || k < 0 || k >= dumps.length) out.push(`${k} is not a dump index`);
    if (i > 0 && k <= (pixels[i - 1] as number)) out.push(`${k} is not ascending`);
  });
  if (!pixels.includes(0)) out.push('no t = 0');
  dumps.forEach((d, k) => {
    if (d.settle && !pixels.includes(k)) out.push(`the settle ${k} is missing`);
  });
  return out;
}

describe('R18 pixel subset', () => {
  it('is a deterministic subset of the dump indexes with t = 0 and every settle, within the cap per DPR', () => {
    let dumps = 0;
    for (const c of cases) {
      const steps = frameScript(c);
      const px = pixelSamples(c, steps);
      expect(subsetProblems(steps, px), c.id).toEqual([]);
      expect(pixelSamples(c, frameScript(c)), c.id).toEqual(px);
      dumps += steps.filter((s) => s.kind === 'dump').length;
    }
    const total = pixelSampleTotal(cases);
    expect(total).toBeLessThanOrEqual(FRAME_PIXEL_CAP);
    console.log(`frame cases ${cases.length}, dumps ${dumps}, pixel samples per DPR ${total} (cap ${FRAME_PIXEL_CAP})`);
    expect(() => pixelSampleTotal([...cases, ...cases])).toThrow(/above the cap/);
  });

  it('refuses steps that are not the case script', () => {
    const [a, b] = cases as [AnimCase, AnimCase];
    expect(() => pixelSamples(a, frameScript(b))).toThrow(/not this case's frame script/);
  });

  it('catches a planted change to the rule', () => {
    // An edge 2 ms late is no dump of the script; a dropped settle fails the subset check.
    expect(() => cases.forEach((c) => pixelSamples(c, frameScript(c), { ...NO_PIXEL_FAULTS, edgeMs: 2 }))).toThrow(/is not a dump of the script/);
    const c = cases[0] as AnimCase;
    expect(subsetProblems(frameScript(c), pixelSamples(c, frameScript(c), { ...NO_PIXEL_FAULTS, settle: false })).join('; ')).toMatch(/the settle \d+ is missing/);
  });
});

describe('frame reference readers', () => {
  // Made in beforeAll: `vitest list` runs describe bodies but no hooks, so a folder made here would leak.
  let root = '';
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'frame-refs-'));
  });
  afterAll(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });
  const id = 'refs@10x10';
  const dpr = 2;
  const cap: FrameCapture = { schema: FRAMES_CAPTURE_SCHEMA, case: id, chrome: 'Chrome/1', rendering: 'authored', devicePixelRatio: dpr, direction: 'ltr', viewport: { width: 10, height: 10 }, steps: 3, samples: [{ at: 0, settle: false, nodes: [] }, { at: 5, settle: true, nodes: [] }] };
  const text = { id: 'a:text0', data: 'ab', lines: 1, units: [0, 0], blank: [] };
  const png = encodePng({ width: 20, height: 20, data: new Uint8Array(20 * 20 * 4).fill(255) });
  const write = (dir: string, files: Readonly<Record<string, string | Buffer>>): string => {
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), body);
    }
    return dir;
  };
  const tree = (name: string, patch: Readonly<Record<string, string | Buffer>> = {}): string => write(join(root, name), {
    [`${id}/authored-dpr${dpr}.json`]: frameCaptureJson(cap),
    [`${id}/breaks-dpr${dpr}.json`]: frameBreaksJson(cap, [[text], []]),
    [`${id}/pixels-dpr${dpr}/1.png`]: png,
    [`${id}/pixels-dpr${dpr}/manifest.json`]: framePixelManifestJson(cap, SOFTWARE_RASTER, new Map([[1, png]])),
    ...patch,
  });

  it('read back what the capture writes', () => {
    const dir = tree('ok');
    expect(committedFrameBreaks(id, dpr, dir)).toEqual([{ case: id, chrome: 'Chrome/1', dpr, texts: [text] }, { case: id, chrome: 'Chrome/1', dpr, texts: [] }]);
    expect(framePixelSamples(id, dpr, dir)).toEqual([1]);
    expect(committedFramePixels(id, dpr, 1, dir)?.width).toBe(20);
    expect(committedFrameBreaks(id, 3, dir)).toBeNull();
    expect(committedFramePixels(id, 3, 1, dir)).toBeNull();
    expect(() => committedFramePixels(id, dpr, 0, dir)).toThrow(/not a pixel sample/);
  });

  it('refuse a wrong schema, case, DPR or sample list in the breaks', () => {
    const breaks = (name: string, f: (j: Record<string, unknown>) => void): string => {
      const j = JSON.parse(frameBreaksJson(cap, [[text], []])) as Record<string, unknown>;
      f(j);
      return tree(name, { [`${id}/breaks-dpr${dpr}.json`]: JSON.stringify(j) });
    };
    expect(() => committedFrameBreaks(id, dpr, breaks('schema', (j) => (j['schema'] = 'x')))).toThrow(/not the frame breaks/);
    expect(() => committedFrameBreaks(id, dpr, breaks('case', (j) => (j['case'] = 'other@10x10')))).toThrow(/not the frame breaks/);
    expect(() => committedFrameBreaks(id, dpr, breaks('dpr', (j) => (j['dpr'] = 3)))).toThrow(/not the frame breaks/);
    expect(() => committedFrameBreaks(id, dpr, breaks('at', (j) => ((j['samples'] as { at: number }[])[1] as { at: number }).at = 6))).toThrow(/sample 1 at 6 ms/);
    expect(() => committedFrameBreaks(id, dpr, breaks('short', (j) => (j['samples'] as unknown[]).pop()))).toThrow(/1 samples, the authored capture 2/);
    expect(() => committedFrameBreaks(id, dpr, breaks('texts', (j) => ((j['samples'] as { texts: unknown }[])[0] as { texts: unknown }).texts = [{ id: 1 }]))).toThrow(/no list of break texts/);
    expect(FRAME_BREAKS_SCHEMA).toBe('dragon-frame-breaks/1');
    expect(frameBreaksPath(id, dpr, 'r')).toBe(`r/${id}/breaks-dpr2.json`);
    expect(() => frameBreaksJson(cap, [[text]])).toThrow(/1 break records for 2/);
  });

  it('refuse a wrong manifest, raster path or PNG', () => {
    const manifest = (name: string, f: (j: Record<string, unknown>) => void): string => {
      const j = JSON.parse(framePixelManifestJson(cap, SOFTWARE_RASTER, new Map([[1, png]]))) as Record<string, unknown>;
      f(j);
      return tree(name, { [`${id}/pixels-dpr${dpr}/manifest.json`]: JSON.stringify(j) });
    };
    expect(() => framePixelSamples(id, dpr, manifest('schema', (j) => (j['schema'] = 'x')))).toThrow(/not the frame pixel manifest/);
    expect(() => framePixelSamples(id, dpr, manifest('case', (j) => (j['case'] = 'other@10x10')))).toThrow(/not the frame pixel manifest/);
    expect(() => framePixelSamples(id, dpr, manifest('dpr', (j) => (j['dpr'] = 3)))).toThrow(/not the frame pixel manifest/);
    expect(() => framePixelSamples(id, dpr, manifest('raster', (j) => (j['raster'] = { rasterization: 'enabled', gpu_compositing: 'disabled_software' })))).toThrow(/not rastering on the CPU/);
    expect(() => framePixelSamples(id, dpr, manifest('k', (j) => ((j['samples'] as { k: number }[])[0] as { k: number }).k = 2))).toThrow(/not an ascending dump index/);
    expect(() => framePixelSamples(id, dpr, manifest('size', (j) => ((j['samples'] as { width: number }[])[0] as { width: number }).width = 21))).toThrow(/raster rule 20x20/);
    const other = encodePng({ width: 20, height: 20, data: new Uint8Array(20 * 20 * 4) });
    expect(() => committedFramePixels(id, dpr, 1, tree('sha', { [`${id}/pixels-dpr${dpr}/1.png`]: other }))).toThrow(/sha256 differs/);
    const gone = tree('gone');
    rmSync(join(framePixelsDir(id, dpr, gone), '1.png'));
    expect(() => committedFramePixels(id, dpr, 1, gone)).toThrow(/listed in the manifest but missing/);
    expect(() => framePixelManifestJson(cap, { rasterization: 'enabled', gpu_compositing: 'enabled' }, new Map([[1, png]]))).toThrow(/not rastering/);
    expect(() => framePixelManifestJson(cap, SOFTWARE_RASTER, new Map([[2, png]]))).toThrow(/not one of 2 dumps/);
  });
});

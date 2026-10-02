// REPL-a Phase B: the replaced paint on the host. The image paint's sample points (image-flat and the destination-rect edges)
// are proven against the committed Chrome screenshots: at every image-flat point Chrome shows exactly the source colour the
// engine's destination rect maps there, at DPR 2, 3 and 2.625. Iframes are masked: no point inside a web view's content box.
// The expected dumps carry each image's destination rect and each web view's frame from the same engine geometry.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emitAndroidViewsCases, emitNativeSupport, emitUikitCases, expectedDump, WRITE_CSS } from 'dragon';
import { deviceDprs } from '../src/targets.ts';
import { REPLACED } from '../src/fixture-groups/replaced.ts';
import { expectedEngine, hostSources, nativeCases } from '../src/native-host.ts';
import { flatAt } from '../src/paint-samples/image.ts';
import { replacedBoxes } from '../src/paint-samples/replaced-geometry.ts';
import { repoPath } from '../src/paths.ts';
import { caseSamples, committedPixels } from '../src/pixel-reference.ts';
import { SAMPLE_INSET_DEVICE_PX } from '../src/samples.ts';

const ids = new Set(REPLACED.map((f) => f.id));
const cases = nativeCases().filter((n) => ids.has(n.spec.id));
const DPRS = [...new Set([...deviceDprs('ios'), ...deviceDprs('android')])].sort();

/** The sample context casePoints builds, for the replaced geometry helpers. */
function contextOf(n: (typeof cases)[number], dpr: number) {
  const p = n.programs.uikit;
  const viewport = n.case.environment.viewport;
  const s = caseSamples(p, viewport, dpr);
  return { program: p, viewport, dpr, size: { width: Math.ceil(viewport.width * dpr), height: Math.ceil(viewport.height * dpr) }, boxes: [], base: s.points, points: s.points };
}

describe('REPL-a replaced paint against the committed Chrome pixels', () => {
  it('covers the replaced fixtures at every device DPR', () => {
    expect(cases.length).toBe(12);
    expect(DPRS).toEqual([2, 2.625, 3]);
  });

  it('Chrome shows the source colour at every image-flat point, and every img has image-flat points', () => {
    const off: string[] = [];
    let compared = 0;
    for (const n of cases) {
      for (const dpr of DPRS) {
        const chrome = committedPixels(n.case.id, dpr);
        if (chrome === null) throw new Error(`no committed Chrome pixels for ${n.case.id} at ${dpr}`);
        const ctx = contextOf(n, dpr);
        const boxes = replacedBoxes(ctx);
        for (const [id, b] of boxes) {
          const d = b.paint.drawn;
          if (b.image === null || d === null) continue;
          const points = ctx.points.filter((p) => p.rule.startsWith(`image-flat:${id}:`));
          // An image drawn inside the raster (the viewport) has image-flat points; one below it cannot be sampled.
          if (points.length === 0 && d.y + d.height <= ctx.size.height && d.x + d.width <= ctx.size.width && d.x >= 0) off.push(`${n.case.id}@${dpr} ${id}: no image-flat point`);
          for (const p of points) {
            const img = b.image;
            const dest = b.paint.dest;
            const sx = Math.floor(((p.x + 0.5 - dest.x) * img.width) / dest.width);
            const sy = Math.floor(((p.y + 0.5 - dest.y) * img.height) / dest.height);
            const want = [...img.data.slice((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4)];
            const got = [...chrome.data.slice((p.y * chrome.width + p.x) * 4, (p.y * chrome.width + p.x) * 4 + 4)];
            compared++;
            if (want.join() !== got.join()) off.push(`${n.case.id}@${dpr} ${p.rule} (${p.x}, ${p.y}): Chrome ${got.join(',')}, source ${want.join(',')}`);
          }
        }
      }
    }
    expect(off).toEqual([]);
    expect(compared).toBeGreaterThan(500);
  });

  it('Chrome draws each destination-rect edge inside a content box within 1 device px of the engine edge (the image edge rules)', () => {
    const off: string[] = [];
    let scanlines = 0;
    for (const n of cases) {
      for (const dpr of DPRS) {
        const chrome = committedPixels(n.case.id, dpr) as NonNullable<ReturnType<typeof committedPixels>>;
        const ctx = contextOf(n, dpr);
        const rules = [...new Set(ctx.points.filter((p) => /^edge:.+:image-(left|right|top|bottom)$/.test(p.rule)).map((p) => p.rule))];
        for (const rule of rules) {
          const line = ctx.points.filter((p) => p.rule === rule);
          const colour = (p: { x: number; y: number }): string => [...chrome.data.slice((p.y * chrome.width + p.x) * 4, (p.y * chrome.width + p.x) * 4 + 4)].join();
          const inside = colour(line[line.length - 1] as { x: number; y: number });
          // The scanline runs from SAMPLE_INSET_DEVICE_PX + 1 px outside the edge to as far inside; its first image pixel is at index inset + 1.
          const first = line.findIndex((p) => colour(p) === inside);
          scanlines++;
          if (Math.abs(first - (SAMPLE_INSET_DEVICE_PX + 1)) > 1) off.push(`${n.case.id}@${dpr} ${rule}: Chrome's first image pixel at ${first}, the engine's at ${SAMPLE_INSET_DEVICE_PX + 1}`);
        }
      }
    }
    expect(off).toEqual([]);
    expect(scanlines).toBeGreaterThan(20);
  });

  it('keeps no base point on non-flat image content and none inside a web view', () => {
    const off: string[] = [];
    for (const n of cases) {
      for (const dpr of DPRS) {
        const ctx = contextOf(n, dpr);
        const boxes = replacedBoxes(ctx);
        const kept = ctx.points;
        for (const p of kept) {
          for (const [id, b] of boxes) {
            const d = b.paint.drawn;
            const c = b.paint.content;
            // A box laid out later paints over this one, so a point under it shows that box.
            if (b.later.some((r) => p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom)) continue;
            const inContent = p.x >= c.x && p.y >= c.y && p.x < c.x + c.width && p.y < c.y + c.height;
            if (b.image === null && inContent) off.push(`${n.case.id}@${dpr} ${p.rule}: inside the web view ${id}`);
            const inImage = d !== null && p.x >= d.x && p.y >= d.y && p.x < d.x + d.width && p.y < d.y + d.height;
            if (b.image !== null && inImage && !p.rule.startsWith(`edge:${id}:image-`) && !flatAt(b, p.x, p.y)) off.push(`${n.case.id}@${dpr} ${p.rule}: on non-flat content of ${id}`);
          }
        }
      }
    }
    expect(off).toEqual([]);
  });

  it('the expected dumps carry each image destination rect and each web view frame from the engine geometry', () => {
    const engine = expectedEngine();
    const demo = cases.find((n) => n.case.id === 'replaced-demo');
    if (demo === undefined) throw new Error('no replaced-demo case');
    const at = (backend: 'uikit' | 'android-views', id: string): unknown => expectedDump(demo.programs[backend], demo.case.id, demo.case.environment.viewport, 2, engine).nodes.find((x) => x.id === id)?.applied;
    // The record cover: an 86.4 css px square content box, cover of a 32 x 18 image (153.6 wide, centred) at DPR 2, in points
    // on UIKit and device px on Android; the song cover: contain in 104 x 58.5; the video slot: the 320 x 180 shell.
    expect(at('uikit', 'cover')).toMatchObject({ dragonImage: { natural: [32, 18], fit: 'cover', dest: [-34, 0, 154, 86] } });
    expect(at('android-views', 'cover')).toMatchObject({ dragonImage: { natural: [32, 18], fit: 'cover', dest: [-68, 0, 308, 172] } });
    expect(at('uikit', 'song-cover')).toMatchObject({ dragonImage: { fit: 'contain', dest: [0, 0, 104, 58.5] } });
    expect(at('android-views', 'song-cover')).toMatchObject({ dragonImage: { fit: 'contain', dest: [0, 0, 208, 117] } });
    expect(at('uikit', 'video')).toMatchObject({ dragonForeignView: { class: 'WKWebView', allowsInlineMediaPlayback: true, mediaTypesRequiringUserActionForPlayback: 0, frame: [0, 0, 320, 180] } });
    expect(at('android-views', 'video')).toMatchObject({ dragonForeignView: { class: 'android.webkit.WebView', javaScriptEnabled: true, mediaPlaybackRequiresUserGesture: false, frame: [0, 0, 640, 360] } });
  });

  it('lowers an img to its embedded PNG and an iframe to a web view slot, and emits both on each backend', () => {
    const demo = cases.find((n) => n.case.id === 'replaced-demo');
    if (demo === undefined) throw new Error('no replaced-demo case');
    const node = (id: string) => demo.programs.uikit.nodes.find((x) => x.id === id);
    const image = node('cover')?.writes.find((w) => w.kind === 'replaced-image');
    if (image === undefined || image.kind !== 'replaced-image') throw new Error('no image write on cover');
    const src = /<img data-dragon-id="cover" src="data:image\/png;base64,([^"]+)"/.exec(readFileSync(repoPath('packages/parity/fixtures/replaced-demo.html'), 'utf8'));
    expect(image.data).toBe(src?.[1]);
    expect([image.width, image.height, image.fit, image.technique]).toEqual([32, 18, 'cover', 'dragon-owned-paint']);
    expect(node('video')?.writes.find((w) => w.kind === 'foreign-view')).toMatchObject({ src: null, key: 'dragonForeignView', technique: 'native-property' });
    expect(WRITE_CSS['replaced-image']).toEqual(['object-fit', 'object-position']);
    const viewport = demo.case.environment.viewport;
    const one = { id: demo.case.id, fixture: demo.spec.id, direction: demo.case.environment.direction, compilerDigest: 'd', viewport, expectedDigests: [] };
    const swift = emitUikitCases([{ ...one, program: demo.programs.uikit }]).map((f) => f.text).join('\n');
    const kotlin = emitAndroidViewsCases([{ ...one, program: demo.programs['android-views'] }]).map((f) => f.text).join('\n');
    expect(swift).toContain(`.dragonSetImage("${image.data}", width: 32.0, height: 18.0, fit: "cover")`);
    expect(swift).toMatch(/dragonSetForeignView\(v\d+, src: nil\)/);
    expect(kotlin).toContain(`.dragonSetImage("${image.data}", 32.0, 18.0, "cover")`);
    expect(kotlin).toMatch(/dragonSetForeignView\(v\d+, null\)/);
  });

  it('loads the iframe src in a web view unless the host clears dragonForeignViewLoadsSrc, which both lane hosts do first (R9)', () => {
    const support = (b: 'uikit' | 'android-views') => emitNativeSupport(b).map((f) => f.text).join('\n');
    const swift = support('uikit');
    const kotlin = support('android-views');
    expect(swift).toContain('public var dragonForeignViewLoadsSrc = true');
    expect(swift).toContain('let target = dragonForeignViewLoadsSrc ? src : nil');
    expect(swift).toContain('web.load(URLRequest(url: url))');
    expect(kotlin).toContain('var dragonForeignViewLoadsSrc = true');
    expect(kotlin).toContain('web.loadUrl(if (dragonForeignViewLoadsSrc && src != null) src else "about:blank")');
    const host = (t: 'ios' | 'android') => hostSources(t, 'toolchain').map((f) => f.text).join('\n');
    const ios = host('ios');
    const android = host('android');
    expect(ios.indexOf('dragonForeignViewLoadsSrc = false')).toBeGreaterThan(-1);
    expect(ios.indexOf('dragonForeignViewLoadsSrc = false')).toBeLessThan(ios.indexOf('dragonReadRun('));
    expect(android.indexOf('    dragonForeignViewLoadsSrc = false')).toBeGreaterThan(-1);
    expect(android.indexOf('    dragonForeignViewLoadsSrc = false')).toBeLessThan(android.indexOf('setContentView(frame)'));
  });
});

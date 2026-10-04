// REPL-a Phase B: the replaced paint on the host. The image paint's sample points (image-flat and the destination-rect edges)
// are proven against the committed Chrome screenshots: at every image-flat point Chrome shows exactly the source colour the
// engine's destination rect maps there, at DPR 2, 3 and 2.625. Iframes are masked: no point inside a web view's content box.
// The expected dumps carry each image's destination rect and each web view's frame from the same engine geometry.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emitAndroidViewsCases, emitUikitCases, expectedDump, WRITE_CSS } from 'dragon';
import { deviceDprs } from '../src/targets.ts';
import { REPLACED } from '../src/fixture-groups/replaced.ts';
import { expectedEngine, hostSources, nativeCases } from '../src/native-host.ts';
import { maskedAt } from '../src/paint-samples/foreign-view.ts';
import { dropsBaseAt, flatAt, imagePointsOf } from '../src/paint-samples/image.ts';
import type { ReplacedSamplesBox } from '../src/paint-samples/replaced-geometry.ts';
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
    // The image module's own points (image-flat, image edges) are not base points; flatAt and the edge test judge them.
    const base = (rule: string): boolean => !rule.startsWith('image-flat:') && !/^edge:[^:]+:image-/.test(rule);
    const off: string[] = [];
    for (const n of cases) {
      for (const dpr of DPRS) {
        const ctx = contextOf(n, dpr);
        const boxes = replacedBoxes(ctx);
        const kept = ctx.points;
        for (const p of kept) {
          if (p.x < 0 || p.y < 0) off.push(`${n.case.id}@${dpr} ${p.rule}: outside the raster at (${p.x}, ${p.y})`);
          for (const [id, b] of boxes) {
            // maskedAt and dropsBaseAt leave a point a later opaque box hides: it shows that box.
            if (b.image === null && maskedAt(b, p.x, p.y)) off.push(`${n.case.id}@${dpr} ${p.rule}: inside the web view ${id}`);
            if (b.image !== null && base(p.rule) && dropsBaseAt(b, p.x, p.y)) off.push(`${n.case.id}@${dpr} ${p.rule}: on non-flat content of ${id}`);
            if (p.rule.startsWith(`image-flat:${id}:`) && !flatAt(b, p.x, p.y)) off.push(`${n.case.id}@${dpr} ${p.rule}: an image-flat point not on flat content of ${id}`);
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

  it('both lane hosts clear dragonForeignViewLoadsSrc in their entry point, before the first case runs (R9: lanes never load src)', () => {
    // Production support loads src (paint-seams.test.ts); a lane or test host must clear the flag before any web view exists.
    const check = (target: 'ios' | 'android', file: string, entry: string, indent: string, firstCase: string) => {
      const files = hostSources(target, 'toolchain');
      const all = files.map((f) => f.text).join('\n');
      // One declaration (true) in the support, one clear in the host, no other write.
      expect([...(all.match(/dragonForeignViewLoadsSrc\s*=\s*\w+/g) ?? [])].sort(), target).toEqual(['dragonForeignViewLoadsSrc = false', 'dragonForeignViewLoadsSrc = true']);
      const host = files.find((f) => f.path === file)?.text;
      if (host === undefined) throw new Error(`${target}: no ${file}`);
      const start = host.indexOf(entry);
      expect(start, `${target} ${entry}`).toBeGreaterThan(-1);
      const end = host.indexOf(`\n${indent.slice(2)}}\n`, start);
      const clear = host.indexOf(`\n${indent}dragonForeignViewLoadsSrc = false\n`, start);
      // A statement of the entry body itself (not nested in a branch), so it runs on every launch.
      expect(clear, `${target}: the clear is a top-level statement of ${entry}`).toBeGreaterThan(start);
      expect(clear, target).toBeLessThan(end);
      for (const first of [firstCase, 'DragonTree(']) {
        const at = host.indexOf(first);
        expect(at, `${target} ${first}`).toBeGreaterThan(-1);
        expect(clear, `${target}: clear before ${first}`).toBeLessThan(at);
      }
    };
    check('ios', 'Host/main.swift', 'func dragonRun(window: UIWindow, host: UIView) {', '  ', 'dragonCase(');
    check('android', 'kotlin/dev/dragon/host/DragonActivity.kt', 'override fun onCreate(savedInstanceState: Bundle?) {', '    ', 'runCase(');
  });

  describe('a synthetic replaced box: occlusion and the raster edges (Macroscope 4169579863, 4169579868)', () => {
    // A 64 x 64 image, red on the left half and blue on the right, drawn 10x into a 640 x 640 rect from (-320, -320).
    const data = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) data.set(x < 32 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 64 + x) * 4);
    const rect = { x: -320, y: -320, width: 640, height: 640 };
    const box = (later: ReplacedSamplesBox['later'], cover: ReplacedSamplesBox['cover'], image = true): ReplacedSamplesBox =>
      ({ paint: { dest: rect, content: rect, drawn: rect }, image: image ? { width: 64, height: 64, data } : null, later, cover });
    const over = { id: 'later', left: -10, top: -10, right: 40, bottom: 40, width: 50, height: 50 };

    it('never places an image point outside the raster, though the drawn part starts left of and above it', () => {
      const points = imagePointsOf(new Map([['img', box([], [])]]), { width: 400, height: 400 });
      expect(points.length).toBeGreaterThan(0);
      expect(points.filter((p) => p.x < 0 || p.y < 0 || p.x >= 400 || p.y >= 400)).toEqual([]);
      // Without the lower bound the grid puts flat points at negative coordinates: (-160, -160) is flat red.
      expect(flatAt(box([], []), -160, -160)).toBe(true);
    });

    it('drops a base point on non-flat content unless a later opaque box hides it; a transparent later box hides nothing', () => {
      // (0, 0) is on the red/blue seam (source x 32), so the content there is not flat.
      expect(dropsBaseAt(box([], []), 0, 0)).toBe(true);
      expect(dropsBaseAt(box([over], []), 0, 0)).toBe(true);
      expect(dropsBaseAt(box([over], [over]), 0, 0)).toBe(false);
      // Flat content (source x 8) is kept with or without a later box, and nothing outside the drawn part is dropped.
      expect(dropsBaseAt(box([over], []), -200, -200)).toBe(false);
      expect(dropsBaseAt(box([], []), 330, 0)).toBe(false);
      // An image-flat point still needs no later box at all over it.
      expect(flatAt(box([over], []), 20, 20)).toBe(false);
      expect(flatAt(box([], []), -200, -200)).toBe(true);
    });

    it('masks a web view point unless a later opaque box hides it', () => {
      expect(maskedAt(box([], [], false), 0, 0)).toBe(true);
      expect(maskedAt(box([over], [], false), 0, 0)).toBe(true);
      expect(maskedAt(box([over], [over], false), 0, 0)).toBe(false);
      expect(maskedAt(box([], [], false), 330, 0)).toBe(false);
    });
  });

  // #72 landing device run: Android captured image cases before their frame reached the display (white image-flat samples, varying
  // by device and DPR). The host copies only after a frame of the redrawn tree is committed, and copies again only after another
  // committed frame, so two equal copies come from two frames; the decoder uploads early.
  it('the Android host copies the window only after a frame commit, each copy after its own, and the image decoder prepares its bitmap', () => {
    const files = hostSources('android', 'toolchain');
    const host = files.find((f) => f.path === 'kotlin/dev/dragon/host/DragonActivity.kt')?.text ?? '';
    expect(host).toContain('fun afterCommittedFrame(block: () -> Unit) {\n      tree.root.viewTreeObserver.registerFrameCommitCallback { main.post { block() } }\n      tree.root.invalidate()\n    }');
    // capture() is the only caller of the first copy, settle() reaches capture() only through a committed frame, and a copy that
    // differs from the previous one is retried only through another.
    expect(host.match(/copy\(0\)/g)?.length).toBe(1);
    expect(host.match(/capture\(\)/g)?.length).toBe(2);
    expect(host.match(/afterCommittedFrame \{ capture\(\) \}/g)?.length).toBe(1);
    expect(host.match(/copy\(attempt \+ 1\)/g)).toEqual(['copy(attempt + 1)', 'copy(attempt + 1)', 'copy(attempt + 1)']);
    expect(host).toContain('previous = sha\n              // The next copy is of another committed frame of the same tree, so equal copies show two frames drew it alike.\n              afterCommittedFrame { copy(attempt + 1) }');
    expect(host.indexOf('fun afterCommittedFrame(')).toBeLessThan(host.indexOf('fun capture() {'));
    expect(host.indexOf('fun capture() {')).toBeLessThan(host.indexOf('copy(0)'));
    expect(host.indexOf('copy(0)')).toBeLessThan(host.indexOf('fun settle('));
    const image = files.find((f) => f.path === 'kotlin/dev/dragon/views/paint/DragonPaintImage.kt')?.text ?? '';
    expect(image).toMatch(/val bitmap = BitmapFactory\.decodeByteArray[^\n]*\n[^\n]*\n  bitmap\.prepareToDraw\(\)\n  return bitmap/);
  });
  // #72 landing device run: a filtered bitmap drawn straight into the window's frame moved other boxes' edges by one colour step
  // on the emulator (hit-order, replaced-fit-rtl, replaced-intrinsic). The stage draws it, still filtered, into a RenderNode with
  // its own compositing layer on a hardware canvas, and straight in only on a software one.
  it('the Android image stage draws the filtered bitmap through its own compositing layer on a hardware canvas', () => {
    const image = hostSources('android', 'toolchain').find((f) => f.path === 'kotlin/dev/dragon/views/paint/DragonPaintImage.kt')?.text ?? '';
    const at = image.indexOf('fun dragonPaintImageStage(');
    const stage = image.slice(at, image.indexOf('\n}\n', at));
    expect(stage).toContain('val paint = Paint(Paint.FILTER_BITMAP_FLAG)');
    expect(stage.match(/drawBitmap\(image, null, dest, paint\)/g)?.length).toBe(2);
    const software = stage.indexOf('if (!canvas.isHardwareAccelerated) {');
    const layer = stage.indexOf('it.setUseCompositingLayer(true, null)');
    expect(software).toBeGreaterThan(-1);
    expect(layer).toBeGreaterThan(software);
    // The only draw on the hardware canvas itself is the node; the bitmap goes into the node's recording.
    const hardware = stage.slice(layer);
    expect(hardware).toContain('inner.drawBitmap(image, null, dest, paint)');
    expect(hardware).not.toContain('canvas.drawBitmap');
    expect(hardware).toContain('canvas.drawRenderNode(node)');
    expect(hardware).toContain('node.endRecording()');
  });
});

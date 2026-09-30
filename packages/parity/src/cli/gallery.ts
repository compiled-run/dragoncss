// pnpm run native:gallery [-- --cases <id>,<id>...]: the native gallery page (gallery.ts). Chrome 145 at DPR 3 by CDP screenshot,
// then each case held on screen on the iPhone 17 simulator and the dragon-smoke emulator and taken with the OS screenshot (the
// capture-trust hold path), cropped to the root. Writes only the gitignored packages/parity/out/gallery/. Devices are booted here,
// so run it under the device lease. A failed capture, batch, launch or cleanup becomes a missing cell and a problem; the page is
// always written, and the command exits 1 when any cell is missing or any problem was recorded.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compiledFeatures } from 'dragon';
import type { Browser } from 'playwright';
import { launchChrome, openPage } from '../chrome.ts';
import type { DeviceHandle, DeviceSpec } from '../device-run.ts';
import { boot, DEVICE_MATRIX, deviceProfile, release, runApp, VECTOR_DEVICES } from '../device-run.ts';
import { atDpr, zoomGuard } from '../dpr.ts';
import { FIXTURE_GROUPS } from '../fixtures.ts';
import type { ColumnCapture, GalleryCell, GalleryColumn } from '../gallery.ts';
import { captureColumn, captureEach, captureInBatches, cropImage, encodePng, featureLabels, galleryExitCode, galleryHtml, parseGalleryArgs, selectGalleryCases } from '../gallery.ts';
import type { NativeCase } from '../native-host.ts';
import { BACKEND_OF, buildAndroid, buildIos, nativeCases } from '../native-host.ts';
import { repoPath } from '../paths.ts';
import { casePoints, decodePng, rasterSize, runFileText } from '../pixel-reference.ts';
import type { NativeTarget } from '../targets.ts';

const CHROME_DPR = 3;
/** Cases per app launch: each launch gets runApp's own time budget, which assumes about 3 s a case. */
const BATCH = 20;
const OUT = repoPath('packages/parity/out/gallery');
const log = (s: string): void => console.log(`native:gallery: ${s}`);

const args = parseGalleryArgs(process.argv.slice(2));
const groupOf = new Map(FIXTURE_GROUPS.flatMap((g) => g.fixtures.map((f) => [f.id, g.id] as const)));
const all = nativeCases();
const refs = all.map((n) => ({ id: n.case.id, fixture: n.spec.id, group: groupOf.get(n.spec.id) ?? '', isInitial: n.case.isInitial, direction: n.case.environment.direction, n }));
const chosen = selectGalleryCases(refs, args.cases).map((r) => r.n);
if (chosen.length === 0) throw new Error('no layout cases to show');
const viewport = (chosen[0] as NativeCase).case.environment.viewport;
for (const n of chosen) {
  const v = n.case.environment.viewport;
  if (v.width !== viewport.width || v.height !== viewport.height) throw new Error(`${n.case.id}: viewport ${v.width}x${v.height}, the gallery shows ${viewport.width}x${viewport.height}`);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
log(`${chosen.length} case(s) -> packages/parity/out/gallery/index.html`);

const ids = chosen.map((n) => n.case.id);
const byId = new Map(chosen.map((n) => [n.case.id, n]));
const imagePath = (column: string, id: string): string => `img/${column}/${id}.png`;
const writeImage = (rel: string, png: Buffer): void => {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
};

// ---------------------------------------------------------------- Chrome

async function chromeColumn(): Promise<ColumnCapture> {
  const held: { browser: Browser | null } = { browser: null };
  return captureColumn(ids, 'Chrome', async (cap) => {
    const b = await launchChrome(CHROME_DPR);
    held.browser = b;
    await zoomGuard(b, CHROME_DPR);
    await captureEach(cap, ids, 'Chrome', async (id) => {
      const n = byId.get(id) as NativeCase;
      const page = await openPage(b, n.case.authoredHtml, atDpr(n.case.environment, CHROME_DPR));
      try {
        const cdp = await page.context().newCDPSession(page);
        const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
        const png = Buffer.from(r.data, 'base64');
        const img = decodePng(png);
        const want = rasterSize(viewport, CHROME_DPR);
        if (img.width !== want.width || img.height !== want.height) throw new Error(`Chrome captured ${img.width}x${img.height}, the raster rule is ${want.width}x${want.height}`);
        writeImage(imagePath('chrome', id), png);
        return imagePath('chrome', id);
      } finally {
        await page.context().close();
      }
    });
  }, async () => {
    if (held.browser !== null) await held.browser.close();
  });
}

// ---------------------------------------------------------------- devices

async function deviceColumn(target: NativeTarget): Promise<{ readonly column: GalleryColumn; readonly cap: ColumnCapture }> {
  const spec = DEVICE_MATRIX.find((d) => d.target === target && d.name === VECTOR_DEVICES[target]) as DeviceSpec;
  const title = target === 'ios' ? `iOS: ${spec.name} simulator` : `Android: ${spec.name} emulator`;
  const held: { device: DeviceHandle | null } = { device: null };
  let detail = '';
  const cap = await captureColumn(ids, spec.name, async (cap) => {
    let artifact: string;
    try {
      const build = target === 'ios' ? buildIos({ reuse: true }) : buildAndroid({ reuse: true });
      for (const l of build.log) log(`${target} build: ${l}`);
      if (build.cases !== all.length) throw new Error(`the app holds ${build.cases} cases, the corpus ${all.length}`);
      artifact = build.artifact;
    } catch (e) {
      throw new Error(`build failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      held.device = await boot(spec);
    } catch (e) {
      throw new Error(`boot failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const dev = held.device;
    const prof = deviceProfile(dev);
    const dpr = prof.profileScale;
    detail = `${prof.os}, DPR ${dpr}`;
    const size = rasterSize(viewport, dpr);
    const backend = BACKEND_OF[target];
    const runDir = (index: number): string => join(OUT, 'runs', `${spec.name}-${index}`);
    let origin: readonly [number, number] = [0, 0];
    await captureInBatches(cap, ids, BATCH, spec.name, async (batch, index) => {
      const runFile = runFileText(batch.map((id) => ({ id, points: casePoints((byId.get(id) as NativeCase).programs[backend], viewport, dpr) })), true);
      const r = await runApp(dev, artifact, { runFile, caseCount: batch.length, outDir: runDir(index), onHold: async (_id, shot) => void (await shot()) });
      origin = r.record.rootOriginPx;
      const found = [r.record.scale !== dpr ? `the app ran at scale ${r.record.scale}, the device profile ${dpr}` : null, r.error].filter((x) => x !== null);
      log(`${spec.name}: batch ${index + 1} of ${Math.ceil(ids.length / BATCH)} held and taken`);
      return found.length === 0 ? null : found.join('; ');
    }, async (id, index) => {
      const shot = join(runDir(index), `screen-${id}.png`);
      if (!existsSync(shot)) throw new Error('no screenshot');
      writeImage(imagePath(target, id), encodePng(cropImage(decodePng(readFileSync(shot)), origin[0], origin[1], size.width, size.height)));
      return imagePath(target, id);
    }, (index) => rmSync(runDir(index), { recursive: true, force: true }));
  }, async () => {
    if (held.device !== null) await release(held.device);
  });
  return { column: { title, detail: detail || 'not run' }, cap };
}

const chrome = await chromeColumn();
log(`Chrome: ${[...chrome.cells.values()].filter((c) => c.kind === 'image').length}/${chosen.length} taken`);
const ios = await deviceColumn('ios');
const android = await deviceColumn('android');
const problems = [...chrome.problems, ...ios.cap.problems, ...android.cap.problems];
const columns: GalleryColumn[] = [{ title: 'Chrome 145 (authored HTML)', detail: `DPR ${CHROME_DPR}` }, ios.column, android.column];
const rows = chosen.map((n) => {
  const id = n.case.id;
  const cell = (c: ColumnCapture): GalleryCell => c.cells.get(id) as GalleryCell;
  return { id, features: featureLabels(compiledFeatures(n.compiled, 'ios', n.case.assignment)), cells: [cell(chrome), cell(ios.cap), cell(android.cap)] };
});
writeFileSync(join(OUT, 'index.html'), galleryHtml({ generated: new Date().toISOString(), viewport, columns, rows, problems }));
const taken = rows.reduce((k, r) => k + r.cells.filter((c) => c.kind === 'image').length, 0);
log(`${taken}/${rows.length * columns.length} screenshots; ${problems.length} problem(s) -> ${join(OUT, 'index.html')}`);
for (const p of problems) log(`problem: ${p}`);
process.exitCode = galleryExitCode(rows, problems);

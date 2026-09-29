// pnpm run native:gallery [-- --cases <id>,<id>...]: the native gallery page (gallery.ts). Chrome 145 at DPR 3 by CDP screenshot,
// then each case held on screen on the iPhone 17 simulator and the dragon-smoke emulator and taken with the OS screenshot (the
// capture-trust hold path), cropped to the root. Writes only the gitignored packages/parity/out/gallery/. Devices are booted here,
// so run it under the device lease. Exits 1 when any screenshot is missing; the page still shows what was taken.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compiledFeatures } from 'dragon';
import { launchChrome, openPage } from '../chrome.ts';
import type { DeviceHandle, DeviceSpec } from '../device-run.ts';
import { boot, DEVICE_MATRIX, deviceProfile, release, runApp, VECTOR_DEVICES } from '../device-run.ts';
import { atDpr, zoomGuard } from '../dpr.ts';
import { FIXTURE_GROUPS } from '../fixtures.ts';
import type { GalleryCell, GalleryColumn } from '../gallery.ts';
import { cropImage, encodePng, featureLabels, galleryHtml, parseGalleryArgs, selectGalleryCases } from '../gallery.ts';
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

const problems: string[] = [];
const imagePath = (column: string, id: string): string => `img/${column}/${id}.png`;
const writeImage = (rel: string, png: Buffer): void => {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
};

// ---------------------------------------------------------------- Chrome

async function chromeColumn(): Promise<Map<string, GalleryCell>> {
  const cells = new Map<string, GalleryCell>();
  const browser = await launchChrome(CHROME_DPR);
  try {
    await zoomGuard(browser, CHROME_DPR);
    for (const n of chosen) {
      const page = await openPage(browser, n.case.authoredHtml, atDpr(n.case.environment, CHROME_DPR));
      try {
        const cdp = await page.context().newCDPSession(page);
        const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
        const png = Buffer.from(r.data, 'base64');
        const img = decodePng(png);
        const want = rasterSize(viewport, CHROME_DPR);
        if (img.width !== want.width || img.height !== want.height) throw new Error(`${n.case.id}: Chrome captured ${img.width}x${img.height}, the raster rule is ${want.width}x${want.height}`);
        writeImage(imagePath('chrome', n.case.id), png);
        cells.set(n.case.id, { kind: 'image', src: imagePath('chrome', n.case.id) });
      } finally {
        await page.context().close();
      }
    }
  } finally {
    await browser.close();
  }
  return cells;
}

// ---------------------------------------------------------------- devices

type DeviceColumn = { readonly column: GalleryColumn; readonly cells: Map<string, GalleryCell> };

async function deviceColumn(target: NativeTarget): Promise<DeviceColumn> {
  const spec = DEVICE_MATRIX.find((d) => d.target === target && d.name === VECTOR_DEVICES[target]) as DeviceSpec;
  const cells = new Map<string, GalleryCell>();
  const title = target === 'ios' ? `iOS: ${spec.name} simulator` : `Android: ${spec.name} emulator`;
  const missingAll = (reason: string): DeviceColumn => {
    problems.push(`${spec.name}: ${reason}`);
    for (const n of chosen) if (!cells.has(n.case.id)) cells.set(n.case.id, { kind: 'missing', reason: `${spec.name}: ${reason}` });
    return { column: { title, detail: 'not run' }, cells };
  };
  let artifact: string;
  try {
    const build = target === 'ios' ? buildIos({ reuse: true }) : buildAndroid({ reuse: true });
    for (const l of build.log) log(`${target} build: ${l}`);
    if (build.cases !== all.length) throw new Error(`the app holds ${build.cases} cases, the corpus ${all.length}`);
    artifact = build.artifact;
  } catch (e) {
    return missingAll(`build failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  let h: DeviceHandle;
  try {
    h = await boot(spec);
  } catch (e) {
    return missingAll(`boot failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  let detail = '';
  try {
    const prof = deviceProfile(h);
    const dpr = prof.profileScale;
    detail = `${prof.os}, DPR ${dpr}`;
    const size = rasterSize(viewport, dpr);
    const backend = BACKEND_OF[target];
    for (let at = 0; at < chosen.length; at += BATCH) {
      const batch = chosen.slice(at, at + BATCH);
      const runFile = runFileText(batch.map((n) => ({ id: n.case.id, points: casePoints(n.programs[backend], viewport, dpr) })), true);
      const outDir = join(OUT, 'runs', `${spec.name}-${at / BATCH}`);
      const r = await runApp(h, artifact, { runFile, caseCount: batch.length, outDir, onHold: async (_id, shot) => void (await shot()) });
      if (r.record.scale !== dpr) problems.push(`${spec.name}: the app ran at scale ${r.record.scale}, the device profile ${dpr}`);
      if (r.error !== null) problems.push(`${spec.name}: cases ${at + 1}-${at + batch.length}: ${r.error}`);
      const [ox, oy] = r.record.rootOriginPx;
      for (const n of batch) {
        const id = n.case.id;
        const shot = join(outDir, `screen-${id}.png`);
        if (!existsSync(shot)) {
          cells.set(id, { kind: 'missing', reason: `${spec.name}: no screenshot${r.error === null ? '' : ` (${r.error})`}` });
          problems.push(`${spec.name}: ${id}: no screenshot`);
          continue;
        }
        try {
          writeImage(imagePath(target, id), encodePng(cropImage(decodePng(readFileSync(shot)), ox, oy, size.width, size.height)));
          cells.set(id, { kind: 'image', src: imagePath(target, id) });
        } catch (e) {
          const reason = `${spec.name}: ${id}: ${e instanceof Error ? e.message : String(e)}`;
          cells.set(id, { kind: 'missing', reason });
          problems.push(reason);
        }
      }
      log(`${spec.name}: ${Math.min(at + BATCH, chosen.length)}/${chosen.length} held and taken`);
    }
  } catch (e) {
    missingAll(e instanceof Error ? e.message : String(e));
  } finally {
    await release(h);
  }
  return { column: { title, detail: detail || 'not run' }, cells };
}

const chrome = await chromeColumn();
log(`Chrome: ${chrome.size}/${chosen.length} taken`);
const ios = await deviceColumn('ios');
const android = await deviceColumn('android');
const columns: GalleryColumn[] = [{ title: 'Chrome 145 (authored HTML)', detail: `DPR ${CHROME_DPR}` }, ios.column, android.column];
const rows = chosen.map((n) => {
  const id = n.case.id;
  const miss: GalleryCell = { kind: 'missing', reason: 'not taken' };
  return { id, features: featureLabels(compiledFeatures(n.compiled, 'ios', n.case.assignment)), cells: [chrome.get(id) ?? miss, ios.cells.get(id) ?? miss, android.cells.get(id) ?? miss] };
});
writeFileSync(join(OUT, 'index.html'), galleryHtml({ generated: new Date().toISOString(), viewport, columns, rows, problems }));
const taken = rows.reduce((k, r) => k + r.cells.filter((c) => c.kind === 'image').length, 0);
log(`${taken}/${rows.length * columns.length} screenshots; ${problems.length} problem(s) -> ${join(OUT, 'index.html')}`);
for (const p of problems) log(`problem: ${p}`);
process.exitCode = taken === rows.length * columns.length && problems.length === 0 ? 0 : 1;

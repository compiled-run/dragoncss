// pnpm run parity:glyph-calibration [-- --recheck] (T093 ruling A): Chrome's rasterisation of Ahem X and XX at every calibrated DPR,
// device size and x phase (glyph-calibration.ts), by CDP Page.captureScreenshot with chrome.ts flags (imported, unchanged) and the
// zoom guard, into packages/parity/expected-glyphs/<platform>/dpr-<d>.png with a manifest of the cells (the glyph boxes from
// Chrome's pen and baseline, probed per cell). Prints each set's worst fringe extent and centre error; exits 1 when either exceeds
// its limit. --recheck re-captures every set and requires it byte-identical to the committed PNG; nothing is written.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromeArgsAt, CHROME_VERSION, launchChrome, openPage } from '../chrome.ts';
import { zoomGuard } from '../dpr.ts';
import type { CalibrationSet } from '../glyph-calibration.ts';
import { CALIBRATION_DPRS, calibrationHtml, calibrationManifestText, capturedCell, GLYPH_CENTRE_ERROR_MAX_DEVICE_PX, GLYPH_FRINGE_MAX_DEVICE_PX, glyphCalibrationDir, glyphCalibrationManifestPath, glyphCalibrationPath, overlappingCells, planCells, strayInk, summarise } from '../glyph-calibration.ts';
import { decodePng, PIXEL_CAPTURE } from '../pixel-reference.ts';
import { hostPlatform, REFERENCE_PLATFORM } from '../platform.ts';

const recheck = process.argv.slice(2).includes('--recheck');
const platform = hostPlatform();
if (platform !== REFERENCE_PLATFORM) throw new Error(`glyph calibration is captured on the reference platform ${REFERENCE_PLATFORM}, not ${platform}`);
const log = (s: string): void => console.log(`parity:glyph-calibration: ${s}`);
const lu = (devicePx: number): number => Math.round(devicePx * 64) / 64;

let exit = 0;
const sets: CalibrationSet[] = [];
for (const dpr of CALIBRATION_DPRS) {
  const plan = planCells(dpr);
  const viewport = { width: Math.ceil(plan.width / dpr), height: Math.ceil(plan.height / dpr) };
  const browser = await launchChrome(dpr);
  try {
    await zoomGuard(browser, dpr);
    const page = await openPage(browser, calibrationHtml(dpr), { viewport, devicePixelRatio: dpr, direction: 'ltr', rootFont: 'ahem' });
    try {
      const probes = await page.evaluate((n: number) => {
        const out: [number, number][] = [];
        for (let i = 0; i < n; i++) {
          const r = (document.getElementById(`p${i}`) as HTMLElement).getBoundingClientRect();
          out.push([r.left, r.bottom]);
        }
        return out;
      }, plan.cells.length);
      const cells = plan.cells.map((c, i) => {
        const [left, bottom] = probes[i] as [number, number];
        const pen = lu(left * dpr);
        if (Math.abs(pen - c.penX) > 1 / 64) throw new Error(`${c.text}@${c.size}+${c.phase} at DPR ${dpr}: Chrome put the pen at ${pen} device px, the plan at ${c.penX}`);
        return capturedCell(c, dpr, pen, lu(bottom * dpr));
      });
      const cdp = await page.context().newCDPSession(page);
      const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
      const png = Buffer.from(r.data, 'base64');
      const img = decodePng(png);
      const sha256 = createHash('sha256').update(png).digest('hex');
      if (recheck) {
        const same = Buffer.compare(png, readFileSync(glyphCalibrationPath(dpr, platform))) === 0;
        log(`--recheck DPR ${dpr}: the re-capture is ${same ? 'byte-identical to' : 'DIFFERENT from'} the committed PNG`);
        if (!same) exit = 1;
      } else {
        mkdirSync(glyphCalibrationDir(platform), { recursive: true });
        writeFileSync(glyphCalibrationPath(dpr, platform), png);
      }
      sets.push({ dpr, flags: chromeArgsAt(dpr), width: img.width, height: img.height, sha256, cells });
      const s = summarise(dpr, img, cells);
      const stray = strayInk(img, cells);
      const overlaps = overlappingCells(cells);
      log(`DPR ${dpr}: ${img.width}x${img.height} device px, ${s.cells} cells; worst fringe ${s.fringe.toFixed(3)} device px (${s.fringeCell}; limit ${GLYPH_FRINGE_MAX_DEVICE_PX}); worst centre error ${s.centre.toFixed(3)} device px over ${s.centres} centres (${s.centreCell}; limit ${GLYPH_CENTRE_ERROR_MAX_DEVICE_PX}); ink outside the cells ${stray.length}; overlapping cells ${overlaps.length}`);
      if (s.fringe > GLYPH_FRINGE_MAX_DEVICE_PX || s.centre > GLYPH_CENTRE_ERROR_MAX_DEVICE_PX || stray.length > 0 || overlaps.length > 0) exit = 1;
    } finally {
      await page.context().close();
    }
  } finally {
    await browser.close();
  }
}
if (!recheck) {
  writeFileSync(glyphCalibrationManifestPath(platform), calibrationManifestText({ chrome: CHROME_VERSION, capture: PIXEL_CAPTURE, sets }));
  log(`wrote ${sets.length} sets and ${glyphCalibrationManifestPath(platform)}`);
}
log(`status ${exit === 0 ? 'pass' : 'fail'}`);
process.exit(exit);

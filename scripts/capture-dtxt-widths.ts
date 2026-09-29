// DTXT-0 (docs/goals/milestone-2-proof/notes/T068-dtxt-spec.md DT-1, DT-3(a)): the text-format vectors and the Chrome width oracle.
//   node --conditions=dragon-internal scripts/capture-dtxt-widths.ts          writes packages/layout/rt-vectors/text-format/*.json and docs/research/dtxt/widths.json
//   node --conditions=dragon-internal scripts/capture-dtxt-widths.ts --check  recomputes everything (Chrome included) and fails if a committed file differs
// Strings come from Markless's own formatTime (MARKLESS_DIR, default ~/dev/open-source/markless), evaluated verbatim. Widths use the
// text-spike gate method (docs/research/text-spike/lato/measure.mjs): a nowrap span's getBoundingClientRect width, in the parity
// lanes' pinned Chrome 145.0.7632.6 (packages/parity/src/chrome.ts) launched at each device scale factor.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHROME_VERSION, launchChrome } from '../packages/parity/src/chrome.ts';
import { zoomGuard } from '../packages/parity/src/dpr.ts';
import type { IntDomain } from '../packages/layout/src/rt-text-format.ts';
import { enumerateTexts, formatText, guardInputs, NO_TEXT_FORMAT_FAULTS, parseTemplate } from '../packages/layout/src/rt-text-format.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKLESS = process.env.MARKLESS_DIR ?? join(homedir(), 'dev/open-source/markless');
const MARKLESS_FILE = 'demos/music-player-ssr/src/youtube-controller.ts';
const TEMPLATE = '{m}:{s:02}';
const DOMAINS: readonly IntDomain[] = [{ id: 'm', min: 0, max: 999 }, { id: 's', min: 0, max: 59 }];
const FACES = [
  { family: 'Lato', weight: 400, file: 'vendor/fonts/Lato/Lato-Regular.ttf' },
  { family: 'Dragon Sans', weight: 400, file: 'vendor/fonts/Inter/Inter-Regular.ttf' },
] as const;
const BOUNDARY = ['0:00', '0:09', '0:10', '1:11', '3:07', '8:08', '9:59', '10:00', '59:59', '99:59', '100:00', '999:59'];
const DPRS = [1, 2, 2.625, 3];
const SIZES = [14, 16, 20];

const OUT = {
  formatTime: join(ROOT, 'packages/layout/rt-vectors/text-format/format-time.json'),
  guard: join(ROOT, 'packages/layout/rt-vectors/text-format/guard.json'),
  widths: join(ROOT, 'docs/research/dtxt/widths.json'),
};

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** JSON with every array of numbers or strings on one line. */
function stringify(v: unknown): string {
  return `${JSON.stringify(v, null, 1).replace(/\[\n\s*((?:[-0-9.e+]+|"[^"\n]*"|null)(?:,\n\s*(?:[-0-9.e+]+|"[^"\n]*"|null))*)\n\s*\]/g, (_m, body: string) => `[${body.replace(/,\n\s*/g, ',')}]`)}\n`;
}

/** Markless formatTime, verbatim, over 60m + s for the whole domain. */
function formatTimeVectors(): object {
  const path = join(MARKLESS, MARKLESS_FILE);
  if (!existsSync(path)) throw new Error(`Markless source not found at ${path} (set MARKLESS_DIR)`);
  const text = readFileSync(path, 'utf8');
  const m = /^function formatTime\(time: number\): string \{\n[\s\S]*?\n\}\n/m.exec(text);
  if (m === null) throw new Error(`formatTime not found in ${path}`);
  const source = m[0].trimEnd();
  const formatTime = new Function(`${stripTypeScriptTypes(m[0])}\nreturn formatTime;`)() as (t: number) => string;
  const strings: string[] = [];
  for (let mm = 0; mm <= 999; mm++) for (let s = 0; s <= 59; s++) strings.push(formatTime(60 * mm + s));
  return {
    about: 'Markless formatTime(60 * m + s) for m in [0, 999] and s in [0, 59], index 60 * m + s. Written by node --conditions=dragon-internal scripts/capture-dtxt-widths.ts; do not edit.',
    source: { repo: 'markless', file: MARKLESS_FILE, sha256: sha256(text), functionSha256: sha256(source), function: source },
    template: TEMPLATE,
    inputs: DOMAINS,
    strings,
  };
}

/** The TS reference's guard on edge inputs, for DTXT-1's Swift and Kotlin equality. Non-finite values are written as strings. */
function guardVectors(): object {
  const parsed = parseTemplate(TEMPLATE, DOMAINS);
  if (!parsed.ok) throw new Error(parsed.reason);
  const edge = [Number.NaN, Infinity, -Infinity, -1, -0, 0, 0.5, 1e-9, 59, 59.000001, 60, 999, 1000, 1e21, Number.MAX_SAFE_INTEGER + 2];
  const cases: [number, number][] = [];
  for (const v of edge) cases.push([v, 5], [5, v]);
  const enc = (v: number): number | string => (Number.isFinite(v) ? (Object.is(v, -0) ? '-0' : v) : String(v));
  return {
    about: `rt-text-format.ts formatText on ${TEMPLATE} (m 0-999, s 0-59) for edge inputs; "NaN", "Infinity", "-Infinity" and "-0" stand for those numbers. Written by node --conditions=dragon-internal scripts/capture-dtxt-widths.ts; do not edit.`,
    template: TEMPLATE,
    inputs: DOMAINS,
    records: cases.map(([m, s]) => {
      const r = formatText(parsed.template, [m, s], NO_TEXT_FORMAT_FAULTS);
      const g = guardInputs(parsed.template, [m, s]);
      if (r.ok !== g.ok) throw new Error('formatText and guardInputs disagree');
      return r.ok ? { values: [enc(m), enc(s)], text: r.text } : { values: [enc(m), enc(s)], field: r.field, reason: r.reason };
    }),
  };
}

type Run = { family: string; size: number; dpr: number; widths: number[] };

async function chromeWidths(strings: readonly string[]): Promise<object> {
  const parsed = parseTemplate(TEMPLATE, DOMAINS);
  if (!parsed.ok) throw new Error(parsed.reason);
  const all = enumerateTexts(parsed.template, NO_TEXT_FORMAT_FAULTS);
  if (!all.ok || JSON.stringify(all.texts) !== JSON.stringify(strings)) throw new Error('rt-text-format enumeration differs from Markless formatTime');
  type Req = { family: string; size: number; texts: readonly string[] };
  const guards: Record<string, string> = {};
  const measure = async (dpr: number, runs: readonly Req[]): Promise<number[][]> => {
    // As parity:dpr-capture: the pinned Chrome at --force-device-scale-factor=N plus a context deviceScaleFactor of N, and the zoom
    // guard before and after, so layout runs in zoomed units (a context deviceScaleFactor alone lays out at zoom 1).
    const browser = await launchChrome(dpr);
    if (dpr !== 1) guards[String(dpr)] = await zoomGuard(browser, dpr);
    const page = await browser.newPage({ deviceScaleFactor: dpr, viewport: { width: 1200, height: 900 } });
    if ((await page.evaluate(() => window.devicePixelRatio)) !== dpr) throw new Error(`devicePixelRatio is not ${dpr}`);
    await page.goto(pathToFileURL(join(ROOT, 'docs/research/dtxt/page.html')).href);
    const out = await page.evaluate(async ({ faces, runs, dpr }: { faces: { family: string; weight: number }[]; runs: readonly Req[]; dpr: number }) => {
      for (const f of faces) await document.fonts.load(`${f.weight} 16px "${f.family}"`, '0:');
      if (document.fonts.size !== faces.length || [...document.fonts].some((f) => f.status !== 'loaded')) throw new Error('faces not loaded');
      const nw = document.getElementById('nw') as HTMLElement;
      return runs.map((r) => {
        nw.style.font = `400 ${r.size}px "${r.family}"`;
        return r.texts.map((t) => {
          nw.textContent = t;
          // Zoomed LayoutUnits (1/64 device px), decoded from the CSS px float: it must sit within 1/1000 of a whole unit.
          const raw = nw.getBoundingClientRect().width * dpr * 64;
          const lu = Math.round(raw);
          if (Math.abs(raw - lu) > 0.001) throw new Error(`${r.family} ${r.size}px "${t}" at DPR ${dpr}: ${raw} is not a whole zoomed LayoutUnit`);
          return lu;
        });
      });
    }, { faces: FACES.map((f) => ({ family: f.family, weight: f.weight })), runs, dpr });
    if (dpr !== 1) await zoomGuard(browser, dpr);
    await browser.close();
    return out;
  };
  const exhaustive: Run[] = [];
  const full = await measure(1, FACES.map((f) => ({ family: f.family, size: 16, texts: strings })));
  FACES.forEach((f, i) => exhaustive.push({ family: f.family, size: 16, dpr: 1, widths: full[i] as number[] }));
  const boundary: Run[] = [];
  for (const dpr of DPRS) {
    const runs = FACES.flatMap((f) => SIZES.map((size) => ({ family: f.family, size, texts: BOUNDARY })));
    const got = await measure(dpr, runs);
    runs.forEach((r, i) => boundary.push({ family: r.family, size: r.size, dpr, widths: got[i] as number[] }));
  }
  return {
    about: `Chrome ${CHROME_VERSION} nowrap widths in zoomed LayoutUnits (device px * 64; CSS px * 64 at DPR 1) of every ${TEMPLATE} string (m 0-999, s 0-59, the order of packages/layout/rt-vectors/text-format/format-time.json) and of the boundary list. Method: docs/research/text-spike/lato/measure.mjs (a nowrap span's getBoundingClientRect width, times DPR * 64), page docs/research/dtxt/page.html, launched as parity:dpr-capture (--force-device-scale-factor=N, zoom guard in zoomGuards). Written by node --conditions=dragon-internal scripts/capture-dtxt-widths.ts; do not edit.`,
    chrome: CHROME_VERSION,
    faces: Object.fromEntries(FACES.map((f) => [f.family, { weight: f.weight, file: f.file, sha256: sha256(readFileSync(join(ROOT, f.file))) }])),
    zoomGuards: guards,
    boundaryStrings: BOUNDARY,
    exhaustive: exhaustive.map((r) => ({ family: r.family, size: r.size, dpr: r.dpr, rows: Array.from({ length: 1000 }, (_x, m) => r.widths.slice(60 * m, 60 * m + 60)) })),
    boundary,
  };
}

const check = process.argv.includes('--check');
const ft = formatTimeVectors() as { strings: string[] };
const files = new Map<string, string>([
  [OUT.formatTime, stringify(ft)],
  [OUT.guard, stringify(guardVectors())],
  [OUT.widths, stringify(await chromeWidths(ft.strings))],
]);
let stale = 0;
for (const [path, text] of files) {
  const rel = path.slice(ROOT.length + 1);
  if (check) {
    const same = existsSync(path) && readFileSync(path, 'utf8') === text;
    if (!same) stale++;
    console.log(`${same ? 'current' : 'STALE'} ${rel}`);
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${rel} (${text.length} bytes)`);
  }
}
if (stale > 0) {
  console.log(`capture-dtxt-widths --check: ${stale} stale file(s)`);
  process.exitCode = 1;
}

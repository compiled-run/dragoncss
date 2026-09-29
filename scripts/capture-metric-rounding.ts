// R5 probe (docs/goals/milestone-2-proof/notes/T056-txt1a-spec.md §2 R5): how Chrome 145 on macOS rounds a font ascent or descent
// that lands on or near a half pixel, for Ahem, the five Inter faces and the two Lato faces, at DPR 1, 2, 2.625 and 3.
// (1) Core Text directly: docs/research/text-spike/metric-rounding/coretext-probe.swift is compiled with swiftc and run over every
//     face at every size from 0.01 to 192 px in hundredths; the traced formula below must reproduce every value exactly.
// (2) Chrome: for every CSS size from 1 to 64 px (hundredths) whose device size gives an exact n.5 ascent or descent, or where the
//     traced, half-up and half-down rules disagree, two observables: the Range rect of the text against a 0x0 inline-block baseline
//     marker, and T005's line box (block height and marker offset, line-height: normal).
// (3) The outcome (a) to (d) of R5, from which rule predicts every row of both observables.
// (4) R2's Ahem premise: nowrap widths of 'X' x n (n = 1 to 120) in Ahem at whole and fractional sizes, DPR 1, which the engine's
//     HarfBuzz path (packages/layout/test/shaping-gate.test.ts) and the Ahem measurer are compared against.
// Run with: node --conditions=dragon-internal scripts/capture-metric-rounding.ts [--check]
// --check captures again into a temporary directory and requires the committed files to be byte-identical.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME_VERSION, PLAYWRIGHT_VERSION, chromeArgsAt, launchChrome } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { hostPlatform } from '../packages/parity/src/platform.ts';
import { readSfnt } from '../packages/dragon/src/fonts/sfnt.ts';

const DIR = 'docs/research/text-spike/metric-rounding';
const CAPTURE_DIR = `${DIR}/captures`;
const PROBE_SOURCE = `${DIR}/coretext-probe.swift`;
const FACE_FILES = [
  'Ahem.ttf', 'Inter/Inter-Light.ttf', 'Inter/Inter-Regular.ttf', 'Inter/Inter-Italic.ttf', 'Inter/Inter-Bold.ttf', 'Inter/Inter-BoldItalic.ttf',
  'Lato/Lato-Regular.ttf', 'Lato/Lato-Bold.ttf',
] as const;
const DPRS = [1, 2, 2.625, 3] as const;
/** CSS sizes 1 to 64 px in hundredths. */
const CSS_MIN = 100;
const CSS_MAX = 6400;
/** Core Text sweep: device sizes 0.01 to 192 px (64 px at DPR 3) in hundredths. */
const SWEEP_MAX = 19200;
const f32 = Math.fround;

type Face = {
  readonly file: string;
  readonly sha256: string;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
};

function loadFace(file: string): Face {
  const bytes = readFileSync(repoPath(`vendor/fonts/${file}`));
  const r = readSfnt(bytes);
  if (!r.ok) throw new Error(`${file}: ${JSON.stringify(r.refusal)}`);
  const { head, hhea } = r.font;
  return { file, sha256: createHash('sha256').update(bytes).digest('hex'), unitsPerEm: head.unitsPerEm, ascender: hhea.ascender, descender: -hhea.descender, lineGap: hhea.lineGap };
}

// ------------------------------------------------------------------------------------------------------------ the rules
/** FontDescription::EffectiveFontSize of the zoomed computed size, in hundredths: floorf(float(float(size) * zoom) * 100). */
function deviceHundredths(cssHundredths: number, dpr: number): number {
  return Math.floor(f32(f32(f32(cssHundredths / 100) * f32(dpr)) * 100));
}
/** The SkFont size: the hundredths divided back in float. */
const deviceSize = (hundredths: number): number => f32(hundredths / 100);

/**
 * Traced: Core Text keeps a vertical metric as a 16.16 fraction of the em, round(units * 65536 / upem), and returns it as
 * (fraction * upem) * (size / upem) in CGFloat. Skia stores it as a float (SkScalerContext_Mac::generateFontMetrics) and Blink
 * rounds with SkScalarRoundToScalar, floorf(x + 0.5f) (FontMetrics::AscentDescentWithHacks).
 */
function coreTextMetric(units: number, upem: number, size: number): number {
  return ((Math.round((units * 65536) / upem) * upem) / 65536) * (size / upem);
}
const skRound = (x: number): number => Math.floor(f32(f32(x) + 0.5));
/** T005 (packages/dragon/src/fonts/metrics.ts): the untruncated metric, halves up. */
const exactMetric = (units: number, upem: number, size: number): number => f32((units * size) / upem);
type Rule = 'traced' | 'halfUp' | 'halfDown';
const RULES: readonly Rule[] = ['traced', 'halfUp', 'halfDown'];
function rounded(rule: Rule, units: number, upem: number, size: number): number {
  if (rule === 'traced') return skRound(coreTextMetric(units, upem, size));
  const x = exactMetric(units, upem, size);
  // The engine (packages/layout/src/units.ts roundFontMetricToWholePx): nearest, an exact half down.
  return rule === 'halfUp' ? skRound(x) : Math.ceil(x - 0.5);
}
/** Whether units * size / upem is exactly n + 0.5 for the size in hundredths (rational arithmetic). */
const exactHalf = (units: number, upem: number, hundredths: number): boolean => (2 * units * hundredths) % (200 * upem) === 100 * upem;

// ------------------------------------------------------------------------------------------------------------ (1) Core Text
function runProbe(faces: readonly Face[]): { values: Map<string, Map<number, [number, number, number]>>; sweep: unknown[] } {
  const work = mkdtempSync(join(tmpdir(), 'dragon-coretext-'));
  try {
    const bin = join(work, 'coretext-probe');
    execFileSync('swiftc', ['-O', repoPath(PROBE_SOURCE), '-o', bin], { stdio: ['ignore', 'ignore', 'inherit'] });
    const sizesFile = join(work, 'sizes.txt');
    const sizes: string[] = [];
    for (let h = 1; h <= SWEEP_MAX; h++) sizes.push(String(deviceSize(h)));
    writeFileSync(sizesFile, `${sizes.join('\n')}\n`);
    const values = new Map<string, Map<number, [number, number, number]>>();
    const sweep: unknown[] = [];
    for (const face of faces) {
      const raw = execFileSync(bin, [repoPath(`vendor/fonts/${face.file}`), sizesFile], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const byHundredths = new Map<number, [number, number, number]>();
      let formulaMismatches = 0;
      const lines = raw.trim().split('\n');
      if (lines.length !== SWEEP_MAX) throw new Error(`${face.file}: the probe printed ${lines.length} sizes, not ${SWEEP_MAX}`);
      lines.forEach((line, i) => {
        const [s, a, d, l] = line.split(' ').map(Number) as [number, number, number, number];
        const h = i + 1;
        if (s !== deviceSize(h)) throw new Error(`${face.file}: size ${s} out of order`);
        byHundredths.set(h, [a, d, l]);
        if (a !== coreTextMetric(face.ascender, face.unitsPerEm, s) || d !== coreTextMetric(face.descender, face.unitsPerEm, s) || l !== coreTextMetric(face.lineGap, face.unitsPerEm, s)) formulaMismatches++;
      });
      values.set(face.file, byHundredths);
      sweep.push({ file: face.file, sizes: SWEEP_MAX, rawSha256: createHash('sha256').update(raw).digest('hex'), formulaMismatches });
    }
    return { values, sweep };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------------------------------------------ (2) Chrome
type Row = { readonly face: string; readonly dpr: number; readonly cssHundredths: number; readonly deviceHundredths: number; readonly why: readonly string[] };

function selectRows(faces: readonly Face[]): Row[] {
  const rows: Row[] = [];
  for (const dpr of DPRS) {
    for (const face of faces) {
      for (let c = CSS_MIN; c <= CSS_MAX; c++) {
        const h = deviceHundredths(c, dpr);
        const size = deviceSize(h);
        const why: string[] = [];
        for (const [name, units] of [['ascent', face.ascender], ['descent', face.descender]] as const) {
          if (exactHalf(units, face.unitsPerEm, h)) why.push(`${name}-exact-half`);
          const r = RULES.map((rule) => rounded(rule, units, face.unitsPerEm, size));
          if (r.some((v) => v !== r[0])) why.push(`${name}-rules-disagree`);
        }
        if (why.length > 0) rows.push({ face: face.file, dpr, cssHundredths: c, deviceHundredths: h, why });
      }
    }
  }
  return rows;
}

type Observed = { readonly rangeTop: number; readonly rangeBottom: number; readonly markerTop: number; readonly boxTop: number; readonly boxHeight: number };

async function captureChrome(faces: readonly Face[], rows: readonly Row[]): Promise<Map<Row, Observed>> {
  const out = new Map<Row, Observed>();
  for (const dpr of DPRS) {
    const browser = await launchChrome(dpr);
    try {
      const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
      const page = await context.newPage();
      for (const face of faces) {
        const mine = rows.filter((r) => r.dpr === dpr && r.face === face.file);
        if (mine.length === 0) continue;
        const uri = `data:font/ttf;base64,${readFileSync(repoPath(`vendor/fonts/${face.file}`)).toString('base64')}`;
        const css = `@font-face{font-family:M;src:url("${uri}") format("truetype")}body{margin:0}.b{position:absolute;top:0;left:0;font-family:M;line-height:normal;white-space:nowrap}.m{display:inline-block;width:0;height:0}`;
        const blocks = mine.map((r) => `<div class="b" style="font-size:${r.cssHundredths / 100}px"><span class="m"></span>x</div>`).join('');
        await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body>${blocks}</body></html>`);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        });
        const got = await page.evaluate(() => [...document.querySelectorAll('div.b')].map((d) => {
          const box = d.getBoundingClientRect();
          const marker = (d.querySelector('.m') as Element).getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(d.lastChild as Node);
          const text = range.getBoundingClientRect();
          return { rangeTop: text.top, rangeBottom: text.bottom, markerTop: marker.top, boxTop: box.top, boxHeight: box.height };
        }));
        if (got.length !== mine.length) throw new Error(`${face.file} at DPR ${dpr}: ${got.length} blocks read, ${mine.length} written`);
        mine.forEach((r, i) => out.set(r, got[i] as Observed));
      }
      await context.close();
    } finally {
      await browser.close();
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------ (4) Ahem advances
const AHEM_SIZES = [7.77, 9.99, 10.62, 10.625, 10.629, 11.1111, 12.5, 13.37, 16, 17.3, 17.5, 23.3, 33.33, 37];
const AHEM_MAX_GLYPHS = 120;

async function captureAhemAdvances(): Promise<number[][]> {
  const browser = await launchChrome(1);
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const uri = `data:font/ttf;base64,${readFileSync(repoPath('vendor/fonts/Ahem.ttf')).toString('base64')}`;
    await page.setContent(`<!DOCTYPE html><html><head><style>@font-face{font-family:A;src:url("${uri}") format("truetype")}body{margin:0;font-family:A}span{white-space:nowrap}</style></head><body></body></html>`);
    const rows = await page.evaluate(async ([sizes, max]) => {
      await document.fonts.load('16px A');
      const out: number[][] = [];
      for (const size of sizes as number[]) {
        const row: number[] = [];
        for (let n = 1; n <= (max as number); n++) {
          const span = document.createElement('span');
          span.style.fontSize = `${size}px`;
          span.textContent = 'X'.repeat(n);
          document.body.appendChild(span);
          row.push(span.getBoundingClientRect().width);
          span.remove();
        }
        out.push(row);
      }
      return out;
    }, [AHEM_SIZES, AHEM_MAX_GLYPHS] as const);
    await context.close();
    return rows.map((row) => row.map((w) => Math.round(w * 64)));
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------------------------------------------------------ (3) outcome
async function captureAll(dir: string): Promise<string> {
  const faces = FACE_FILES.map(loadFace);
  const { values, sweep } = runProbe(faces);
  const rows = selectRows(faces);
  const observed = await captureChrome(faces, rows);
  const fonts = Object.fromEntries(faces.map((f) => [f.file, f.sha256]));
  const facts = faces.map((f) => ({ file: f.file, sha256: f.sha256, unitsPerEm: f.unitsPerEm, hhea: { ascender: f.ascender, descender: -f.descender, lineGap: f.lineGap } }));
  const macos = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();

  const mismatches: Record<'range' | 'lineBox', Record<Rule, number>> = { range: { traced: 0, halfUp: 0, halfDown: 0 }, lineBox: { traced: 0, halfUp: 0, halfDown: 0 } };
  const perFace = new Map<string, { up: number; down: number }>();
  let observablesDisagree = 0;
  const outRows = rows.map((r) => {
    const face = faces.find((f) => f.file === r.face) as Face;
    const o = observed.get(r) as Observed;
    const lu = (v: number): number => Math.round(v * r.dpr * 64);
    const px = (l: number): number => l / 64;
    const range = { ascent: px(lu(o.markerTop) - lu(o.rangeTop)), descent: px(lu(o.rangeBottom) - lu(o.markerTop)) };
    const baseline = lu(o.markerTop) - lu(o.boxTop);
    const lineBox = { ascent: px(baseline), descent: px(lu(o.boxHeight) - baseline), height: px(lu(o.boxHeight)) };
    const size = deviceSize(r.deviceHundredths);
    const ct = values.get(r.face)?.get(r.deviceHundredths);
    if (ct === undefined) throw new Error(`no Core Text value for ${r.face} at ${size}`);
    const predicted = Object.fromEntries(RULES.map((rule) => [rule, { ascent: rounded(rule, face.ascender, face.unitsPerEm, size), descent: rounded(rule, face.descender, face.unitsPerEm, size) }])) as Record<Rule, { ascent: number; descent: number }>;
    for (const rule of RULES) {
      const p = predicted[rule];
      if (p.ascent !== range.ascent || p.descent !== range.descent) mismatches.range[rule]++;
      if (p.ascent !== lineBox.ascent || p.descent !== lineBox.descent) mismatches.lineBox[rule]++;
    }
    if (range.ascent !== lineBox.ascent || range.descent !== lineBox.descent) observablesDisagree++;
    // Per face: at each exact half of the untruncated metric, which way Chrome went.
    const tally = perFace.get(r.face) ?? { up: 0, down: 0 };
    for (const [name, units] of [['ascent', face.ascender], ['descent', face.descender]] as const) {
      const x = exactMetric(units, face.unitsPerEm, size);
      if (x - Math.floor(x) !== 0.5) continue;
      if (range[name] === Math.floor(x) + 1) tally.up++;
      else if (range[name] === Math.floor(x)) tally.down++;
    }
    perFace.set(r.face, tally);
    return {
      face: r.face, dpr: r.dpr, cssSize: r.cssHundredths / 100, deviceSize: size, why: r.why,
      coreText: { ascent: ct[0], descent: ct[1], lineGap: ct[2] },
      untruncated: { ascent: exactMetric(face.ascender, face.unitsPerEm, size), descent: exactMetric(face.descender, face.unitsPerEm, size) },
      chrome: { range, lineBox },
      raw: o,
      predicted,
    };
  });
  const formulaExact = (sweep as Array<{ formulaMismatches: number }>).every((s) => s.formulaMismatches === 0);
  const tracedExplainsAll = formulaExact && mismatches.range.traced === 0 && mismatches.lineBox.traced === 0;
  const halves = Object.fromEntries([...perFace].map(([f, t]) => [f, t.up > 0 && t.down > 0 ? 'mixed' : t.up > 0 ? 'up' : t.down > 0 ? 'down' : 'none']));
  let outcome: 'a' | 'b' | 'c' | 'd';
  if (tracedExplainsAll) outcome = 'a';
  else if (observablesDisagree > 0) outcome = 'b';
  else outcome = Object.values(halves).includes('mixed') ? 'd' : 'c';

  mkdirSync(dir, { recursive: true });
  const write = (name: string, value: unknown): void => writeFileSync(join(dir, name), `${JSON.stringify(value, null, 1)}\n`);
  write('coretext.json', { platform: hostPlatform(), macos, probe: PROBE_SOURCE, faces: facts, sweep: { from: 0.01, to: SWEEP_MAX / 100, step: 0.01, perFace: sweep } });
  write('chrome.json', {
    chrome: CHROME_VERSION, playwright: PLAYWRIGHT_VERSION, platform: hostPlatform(), macos,
    launches: DPRS.map((dpr) => ({ dpr, flags: chromeArgsAt(dpr) })), fonts,
    selection: `CSS sizes ${CSS_MIN / 100} to ${CSS_MAX / 100} px in hundredths whose device size gives an exact n.5 ascent or descent, or where the traced, half-up and half-down rules disagree`,
    rows: outRows,
  });
  write('outcome.json', {
    outcome,
    coreTextFormulaExact: formulaExact,
    rows: outRows.length,
    rowsByFace: Object.fromEntries(faces.map((f) => [f.file, outRows.filter((r) => r.face === f.file).length])),
    mismatches,
    observablesDisagree,
    exactHalvesByFace: Object.fromEntries([...perFace].map(([f, t]) => [f, t])),
    halfDirectionByFace: halves,
  });
  const ahem = await captureAhemAdvances();
  write('ahem-advances.json', {
    chrome: CHROME_VERSION, playwright: PLAYWRIGHT_VERSION, platform: hostPlatform(), launches: [{ dpr: 1, flags: chromeArgsAt(1) }],
    font: { file: 'Ahem.ttf', sha256: fonts['Ahem.ttf'] },
    text: "'X' repeated n times, n = 1 to 120, in a white-space: nowrap span",
    sizes: AHEM_SIZES,
    widthsLayoutUnits: Object.fromEntries(AHEM_SIZES.map((size, i) => [String(size), ahem[i]])),
  });
  return outcome;
}

const check = process.argv.includes('--check');
const target = check ? mkdtempSync(join(tmpdir(), 'dragon-metric-rounding-')) : repoPath(CAPTURE_DIR);
try {
  const outcome = await captureAll(target);
  console.log(`metric rounding: outcome (${outcome})`);
  if (outcome === 'd') process.exitCode = 1;
  if (check) {
    const committed = readdirSync(repoPath(CAPTURE_DIR)).sort();
    const fresh = readdirSync(target).sort();
    const differ = fresh.filter((f) => !committed.includes(f) || !readFileSync(join(target, f)).equals(readFileSync(repoPath(join(CAPTURE_DIR, f)))));
    const extra = committed.filter((f) => !fresh.includes(f));
    if (differ.length > 0 || extra.length > 0) {
      console.error(`metric rounding captures differ from a fresh capture: ${[...differ, ...extra].join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log(`metric rounding captures byte-identical to a fresh capture (${fresh.length} files)`);
    }
  } else {
    console.log(`metric rounding captures written to ${CAPTURE_DIR}`);
  }
} finally {
  if (check) rmSync(target, { recursive: true, force: true });
}

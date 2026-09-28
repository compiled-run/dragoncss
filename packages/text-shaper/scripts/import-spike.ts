// Writes docs/research/text-spike/gate/chrome-145.json from the text spike's raw output
// (corpus cases.json and Chrome's chrome.json, measured by the spike's chrome/measure.mjs).
// The raw output is committed in docs/research/text-spike/out (and lato/out for the Lato reference).
// Usage: node packages/text-shaper/scripts/import-spike.ts <spike out dir> [<reference path> <loaded-fonts path>]
//   docs/research/text-spike/out                → gate/chrome-145.json with chrome/loaded-fonts.sha256
//   docs/research/text-spike/lato/out docs/research/text-spike/gate/chrome-145-lato.json docs/research/text-spike/lato/loaded-fonts.sha256
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LOADED_FONTS_PATH, REFERENCE_PATH } from '../src/gate.ts';

const LATO_SOURCE =
  'docs/research/text-spike/lato (measure.mjs, opps.mjs; the spike method with each case\'s family and weight): Playwright Chromium 145.0.7632.6 on macOS, DPR 1, white-space: normal, text-align: start, family Lato with @font-face 400 (Lato-Regular.ttf) and 700 (Lato-Bold.ttf). Per line, the Range client-rect width of [line start, line end minus trailing spaces); per font/paragraph/size, a white-space: nowrap span width; per paragraph, the break opportunities of a width:0 layout.';

interface SpikeCase { id: string; font: string; file: string; para: string; text: string; lang: string; size: number; width: number }
interface SpikeLine { start: number; end: number; text: string; width: number; runs: number[][] }
interface SpikeChrome { id: string; breaks: number[]; lines: SpikeLine[]; nowrapWidth: number }

const outDir = process.argv[2];
if (outDir === undefined) throw new Error('usage: import-spike.ts <spike out dir> [<reference path> <loaded-fonts path>]');
const referencePath = resolve(process.argv[3] ?? REFERENCE_PATH);
const loadedFontsPath = resolve(process.argv[4] ?? LOADED_FONTS_PATH);
const isLato = referencePath !== REFERENCE_PATH;
const cases = JSON.parse(readFileSync(join(outDir, 'cases.json'), 'utf8')) as SpikeCase[];
const chrome = new Map((JSON.parse(readFileSync(join(outDir, 'chrome.json'), 'utf8')) as SpikeChrome[]).map((r) => [r.id, r]));
// Chrome's break opportunities per paragraph (chrome/opps.mjs: a width:0 min-content layout).
const opps = JSON.parse(readFileSync(join(outDir, 'chrome-opps.json'), 'utf8')) as Array<{ lang: string; para: string; opps: number[] }>;
const opportunities: Record<string, number[]> = {};
for (const o of opps) {
  const key = `${o.lang}/${o.para}`;
  if (opportunities[key] !== undefined && JSON.stringify(opportunities[key]) !== JSON.stringify(o.opps)) throw new Error(`opportunities for ${key} differ between fonts`);
  opportunities[key] = o.opps;
}

const lu = (px: number): number => {
  const v = px * 64;
  if (!Number.isInteger(v)) throw new Error(`not a whole LayoutUnit: ${px}`);
  return v;
};

// Font hashes come from the files Chrome loaded (chrome/loaded-fonts.sha256, taken in the spike's fonts/ directory
// that chrome/page.html loads), never from the repo copy the gate shapes with: the gate test compares the two.
const loaded = new Map<string, string>();
for (const line of readFileSync(loadedFontsPath, 'utf8').split('\n')) {
  const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
  if (m !== null) loaded.set(m[2]!, m[1]!);
}
const loadedSha = (file: string): string => {
  const sha = loaded.get(file);
  if (sha === undefined) throw new Error(`${file} is not in ${loadedFontsPath}`);
  return sha;
};

const fonts: Record<string, { file: string; sha256: string }> = {};
const paragraphs: Record<string, string> = {};
const out = cases.map((c) => {
  const r = chrome.get(c.id);
  if (r === undefined) throw new Error(`no Chrome result for ${c.id}`);
  fonts[c.font] ??= { file: c.file, sha256: loadedSha(c.file) };
  const key = `${c.lang}/${c.para}`;
  if (paragraphs[key] !== undefined && paragraphs[key] !== c.text) throw new Error(`paragraph ${key} differs between cases`);
  paragraphs[key] = c.text;
  return {
    id: c.id,
    font: c.font,
    paragraph: key,
    lang: c.lang,
    size: c.size,
    width: c.width,
    // [start, end, width in LayoutUnits (1/64 px), rect count]; end includes trailing spaces, the width excludes them.
    lines: r.lines.map((l) => [l.start, l.end, lu(l.width), l.runs.length]),
    nowrap: lu(r.nowrapWidth),
  };
});

const head = {
  source: isLato ? LATO_SOURCE :
    'docs/research/text-spike (chrome/measure.mjs, chrome/opps.mjs): Playwright Chromium 145.0.7632.6 on macOS, DPR 1, white-space: normal, text-align: start. Per line, the Range client-rect width of [line start, line end minus trailing spaces); per font/paragraph/size, a white-space: nowrap span width; per paragraph, the break opportunities of a width:0 layout.',
  fonts,
  paragraphs,
  opportunities,
};
const body = JSON.stringify(head).slice(0, -1);
writeFileSync(referencePath, `${body},"cases":[\n${out.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`);
console.log(`wrote ${out.length} cases to ${referencePath}`);

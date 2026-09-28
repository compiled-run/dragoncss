// Writes docs/research/text-spike/gate/chrome-145.json from the text spike's raw output
// (corpus cases.json and Chrome's chrome.json, measured by the spike's chrome/measure.mjs).
// Usage: node packages/text-shaper/scripts/import-spike.ts <spike out dir>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FONT_DIR, REFERENCE_PATH } from '../src/gate.ts';

interface SpikeCase { id: string; font: string; file: string; para: string; text: string; lang: string; size: number; width: number }
interface SpikeLine { start: number; end: number; text: string; width: number; runs: number[][] }
interface SpikeChrome { id: string; breaks: number[]; lines: SpikeLine[]; nowrapWidth: number }

const outDir = process.argv[2];
if (outDir === undefined) throw new Error('usage: import-spike.ts <spike out dir>');
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

const fonts: Record<string, { file: string; sha256: string }> = {};
const paragraphs: Record<string, string> = {};
const out = cases.map((c) => {
  const r = chrome.get(c.id);
  if (r === undefined) throw new Error(`no Chrome result for ${c.id}`);
  fonts[c.font] ??= { file: c.file, sha256: createHash('sha256').update(readFileSync(join(FONT_DIR, c.file))).digest('hex') };
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
  source:
    'docs/research/text-spike (chrome/measure.mjs, chrome/opps.mjs): Playwright Chromium 145.0.7632.6 on macOS, DPR 1, white-space: normal, text-align: start. Per line, the Range client-rect width of [line start, line end minus trailing spaces); per font/paragraph/size, a white-space: nowrap span width; per paragraph, the break opportunities of a width:0 layout.',
  fonts,
  paragraphs,
  opportunities,
};
const body = JSON.stringify(head).slice(0, -1);
writeFileSync(REFERENCE_PATH, `${body},"cases":[\n${out.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`);
console.log(`wrote ${out.length} cases to ${REFERENCE_PATH}`);

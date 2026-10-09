// Writes italic/out/chrome-145-italic.json, a TXT1-0 gate reference (packages/text-shaper/src/gate.ts Reference), from out/ (cases.json,
// chrome.json, chrome-opps.json) the way packages/text-shaper/scripts/import-spike.ts writes the spike and Lato references.
// Usage, from the repo root: node docs/research/text-spike/italic/import.mjs
import fs from 'node:fs';
const at = (p) => new URL(p, import.meta.url);
const cases = JSON.parse(fs.readFileSync(at('./out/cases.json'), 'utf8'));
const chrome = new Map(JSON.parse(fs.readFileSync(at('./out/chrome.json'), 'utf8')).map((r) => [r.id, r]));
const opportunities = {};
for (const o of JSON.parse(fs.readFileSync(at('./out/chrome-opps.json'), 'utf8'))) {
  const key = `${o.lang}/${o.para}`;
  if (opportunities[key] !== undefined && JSON.stringify(opportunities[key]) !== JSON.stringify(o.opps)) throw new Error(`opportunities for ${key} differ between fonts`);
  opportunities[key] = o.opps;
}
const lu = (px) => {
  const v = px * 64;
  if (!Number.isInteger(v)) throw new Error(`not a whole LayoutUnit: ${px}`);
  return v;
};
const loaded = new Map();
for (const line of fs.readFileSync(at('./loaded-fonts.sha256'), 'utf8').split('\n')) {
  const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
  if (m !== null) loaded.set(m[2], m[1]);
}
const fonts = {};
const paragraphs = {};
const out = cases.map((c) => {
  const r = chrome.get(c.id);
  if (r === undefined) throw new Error(`no Chrome result for ${c.id}`);
  const sha = loaded.get(c.file);
  if (sha === undefined) throw new Error(`${c.file} is not in loaded-fonts.sha256`);
  fonts[c.font] ??= { file: c.file, sha256: sha };
  const key = `${c.lang}/${c.para}`;
  if (paragraphs[key] !== undefined && paragraphs[key] !== c.text) throw new Error(`paragraph ${key} differs between cases`);
  paragraphs[key] = c.text;
  return { id: c.id, font: c.font, paragraph: key, lang: c.lang, size: c.size, width: c.width, lines: r.lines.map((l) => [l.start, l.end, lu(l.width), l.runs.length]), nowrap: lu(r.nowrapWidth) };
});
const head = {
  source: 'docs/research/text-spike/italic (measure.mjs, opps.mjs; the Lato method with each case\'s family, weight and style): Playwright Chromium 145.0.7632.6 on macOS, DPR 1, white-space: normal, text-align: start, family Inter with @font-face 400 italic (Inter-Italic.ttf) and 700 italic (Inter-BoldItalic.ttf). Per line, the Range client-rect width of [line start, line end minus trailing spaces); per font/paragraph/size, a white-space: nowrap span width; per paragraph, the break opportunities of a width:0 layout.',
  fonts,
  paragraphs,
  opportunities,
};
const body = JSON.stringify(head).slice(0, -1);
fs.writeFileSync(at('./out/chrome-145-italic.json'), `${body},"cases":[\n${out.map((c) => JSON.stringify(c)).join(',\n')}\n]}\n`);
console.log(`wrote ${out.length} cases to italic/out/chrome-145-italic.json`);

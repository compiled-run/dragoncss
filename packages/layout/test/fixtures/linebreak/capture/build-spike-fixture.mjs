// Builds chrome145-spike.json, the committed oracle for the real-font text spike corpus (docs/research/text-spike).
// Inputs (from the spike's out directory and the two capture tools here):
//   cases.json            the 620 cases (docs/research/text-spike/corpus.mjs)
//   chrome.json           Chrome 145 lines per case (the spike's chrome/measure.mjs)
//   chrome-spaceall.json  the same with text-spacing-trim: space-all (the CJK reference for native advances)
//   opps.json             chrome-opportunities.mjs over `texts` (below), with the spike fonts
//   advances.json         coretext-advances.swift over cases.json
// Usage (from the repo root):
//   node packages/layout/test/fixtures/linebreak/capture/build-spike-fixture.mjs texts <cases.json> <texts.json>
//   node packages/layout/test/fixtures/linebreak/capture/build-spike-fixture.mjs build <spikeOutDir> <opps.json> <advances.json>
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'packages/layout/test/fixtures/linebreak/chrome145-spike.json';
const [mode, a, b, c] = process.argv.slice(2);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
/** JSON with every non-ASCII code unit escaped, so invisible characters (U+00AD, U+00A0) stay reviewable. */
const ascii = (v) => JSON.stringify(v).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

if (mode === 'texts') {
  const u = {};
  for (const x of read(a)) u[`${x.lang}|${x.para}|${x.font}`] ??= { id: `${x.lang}|${x.para}|${x.font}`, lang: x.lang, text: x.text, font: x.font };
  fs.writeFileSync(b, JSON.stringify(Object.values(u)));
  console.log(Object.keys(u).length, 'texts');
} else if (mode === 'build') {
  const cases = read(path.join(a, 'cases.json'));
  const chrome = Object.fromEntries(read(path.join(a, 'chrome.json')).map((r) => [r.id, r]));
  const spaceAll = Object.fromEntries(read(path.join(a, 'chrome-spaceall.json')).map((r) => [r.id, r]));
  const texts = {};
  for (const o of read(b)) {
    const key = `${o.lang}|${o.id.split('|')[1]}`;
    if (texts[key] === undefined) texts[key] = { key, lang: o.lang, text: o.text, fonts: [], opps: o.opps };
    if (JSON.stringify(texts[key].opps) !== JSON.stringify(o.opps)) throw new Error(`${o.id}: opportunities depend on the font`);
    texts[key].fonts.push(o.font);
  }
  const advances = {};
  for (const x of read(c)) advances[x.key] = { hyphen: x.hyphen, advances: x.advances };
  const out = cases.map((k) => {
    const cjk = k.font === 'NotoSansJP' && k.para !== 'prose';
    const row = { id: k.id, font: k.font, key: `${k.lang}|${k.para}`, advances: `${k.font}/${k.para}/${k.size}`, width: k.width, breaks: chrome[k.id].breaks };
    if (cjk) row.breaksSpaceAll = spaceAll[k.id].breaks;
    if (texts[row.key].text !== k.text || advances[row.advances].advances.length !== k.text.length) throw new Error(`${k.id}: inputs disagree`);
    return row;
  });
  const lines = [
    '{',
    ` "about": ${ascii('Chrome 145.0.7632.6 line-break oracle for the real-font text spike corpus (docs/research/text-spike): texts[].opps are break opportunities from the width-0 method (UTF-16 indices; identical for every font listed); cases[].breaks are Chrome\'s line starts at the case width (breaksSpaceAll: with text-spacing-trim: space-all, for CJK); advances are macOS Core Text glyph advances per UTF-16 index (default instance for variable fonts) and the U+2010 advance. Built by capture/build-spike-fixture.mjs.')},`,
    ' "texts": [',
    Object.values(texts).map((t) => `  ${ascii(t)}`).join(',\n'),
    ' ],',
    ' "cases": [',
    out.map((r) => `  ${ascii(r)}`).join(',\n'),
    ' ],',
    ' "advances": {',
    Object.entries(advances).map(([k, v]) => `  ${ascii(k)}: ${ascii(v)}`).join(',\n'),
    ' }',
    '}',
  ];
  fs.writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`wrote ${OUT}: ${Object.keys(texts).length} texts, ${out.length} cases, ${Object.keys(advances).length} advance sets`);
}

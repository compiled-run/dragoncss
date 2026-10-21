// The TXT-BREAK-2 capture (chrome145-break-all.json): Chrome's soft wrap opportunities under word-break: break-all and keep-all, by
// the width-0 method of chrome-opportunities.mjs, over every ordered pair of the Latin set (layout inline.ts latinBreakClass) and
// generated runs of it with spaces. Run with the pinned Chrome (145.0.7632.6, Chrome for Testing headless shell):
//   node packages/layout/test/fixtures/linebreak/capture/chrome-break-all.mjs <chrome-executable> <out.json>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('packages/parity/package.json'));
const { chromium } = require('playwright');
const [executablePath, output] = process.argv.slice(2);
const set = [...Array.from({ length: 0x7f - 0x21 }, (_, i) => 0x21 + i).filter((c) => c !== 0x27), ...Array.from({ length: 0x60 }, (_, i) => 0xa0 + i),
  0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x200b, 0x27];
const chars = set.map((c) => String.fromCodePoint(c));
const pairs = chars.flatMap((a) => chars.map((b) => a + b));
// A seeded generator, so the runs are the same on every capture.
let seed = 2;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const alphabet = [...chars, ...Array(20).fill(' ')];
const runs = [];
while (runs.length < 5000) {
  const t = Array.from({ length: 8 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('').trim();
  if (t !== '') runs.push(t);
}
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0} #p{position:absolute;left:0;top:0;width:0;padding:0;margin:0;font:16px/100px monospace}</style><div id="p" lang="en"></div>');
const capture = (texts, wordBreak) => page.evaluate(([texts, wordBreak]) => {
  const p = document.getElementById('p');
  p.style.wordBreak = wordBreak;
  return texts.map((text) => {
    p.textContent = text;
    const r = document.createRange(), n = p.firstChild, opps = [];
    let cur = 0;
    for (let i = 0; i < n.length; i++) {
      r.setStart(n, i); r.setEnd(n, i + 1);
      const all = [...r.getClientRects()];
      const rs = all.filter((x) => x.width > 0);
      const q = rs.length > 0 ? rs[rs.length - 1] : n.data[i] === ' ' ? undefined : all[0];
      if (!q) continue;
      const li = Math.floor((q.top + q.height / 2) / 100);
      if (li > cur) { opps.push(i); cur = li; }
    }
    return opps;
  });
}, [texts, wordBreak]);
const pairOpps = await capture(pairs, 'break-all');
const breakAll = await capture(runs, 'break-all');
const keepAll = await capture(runs, 'keep-all');
const about = `Chrome ${browser.version()} soft wrap opportunities (UTF-16 indices where a line starts) at width 0, 16px monospace, lang en, by capture/chrome-break-all.mjs: every ordered pair of the Latin set under word-break: break-all (row-major bits, 1 = a break between them), and generated runs under break-all and keep-all.`;
const rows = runs.map((text, i) => `  ${JSON.stringify({ text, breakAll: breakAll[i], keepAll: keepAll[i] }).replace(/[\u007f-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)}`);
fs.writeFileSync(output, `{\n "about": ${JSON.stringify(about)},\n "chrome": "${browser.version()}",\n "set": ${JSON.stringify(set)},\n "breakAllPairs": "${pairOpps.map((o) => (o.length === 1 && o[0] === 1 ? '1' : '0')).join('')}",\n "runs": [\n${rows.join(',\n')}\n ]\n}\n`);
await browser.close();

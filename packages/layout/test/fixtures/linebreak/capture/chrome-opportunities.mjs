// Chrome's break-opportunity oracle (the text spike's width-0 method, docs/research/text-spike): laid out at width 0, a
// paragraph breaks at every opportunity, so the index of each line's first character is one opportunity.
// Usage (from the repo root): node packages/layout/test/fixtures/linebreak/capture/chrome-opportunities.mjs <in.json> <out.json> [fontsDir]
//   in.json: [{ id, lang, text, font? }]. out.json: [{ id, lang, text, font, opps }] with UTF-16 indices; also prints Chrome's version.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('packages/parity/package.json'));
const { chromium } = require('playwright');
const [input, output, fontsDir] = process.argv.slice(2);
const items = JSON.parse(fs.readFileSync(input, 'utf8'));
const faces = fontsDir === undefined ? '' : [['Inter', 'Inter-Regular.ttf'], ['Roboto', 'Roboto-Regular.ttf'], ['NotoSans', 'NotoSans-Regular.ttf'], ['NotoSansJP', 'NotoSansJP-Regular.otf'], ['InterVF', 'Inter-VF.ttf']]
  .map(([f, file]) => `@font-face{font-family:${f};src:url(data:font/ttf;base64,${fs.readFileSync(path.join(fontsDir, file)).toString('base64')})}`).join('\n');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<!doctype html><meta charset="utf-8"><style>${faces}
body{margin:0} #p{position:absolute;left:0;top:0;width:0;white-space:normal;word-break:normal;overflow-wrap:normal;padding:0;margin:0}</style><div id="p"></div>`);
if (fontsDir !== undefined) await page.evaluate(async () => { for (const f of ['Inter', 'Roboto', 'NotoSans', 'NotoSansJP', 'InterVF']) await document.fonts.load(`16px ${f}`, 'Aあ'); });
const res = await page.evaluate((items) => items.map((it) => {
  const p = document.getElementById('p');
  p.style.font = `16px/100px ${it.font ?? 'sans-serif'}`;
  p.lang = it.lang;
  p.textContent = it.text;
  const r = document.createRange(), n = p.firstChild, opps = [];
  let cur = 0;
  for (let i = 0; i < n.length; i++) {
    r.setStart(n, i); r.setEnd(n, i + 1);
    const all = [...r.getClientRects()];
    const rs = all.filter((x) => x.width > 0);
    // A zero-width character (U+200B, an unbroken U+00AD) has one zero-width rect on its own line; a space also gets a
    // zero-width rect on the next line, so spaces with no visible rect are skipped (the spike's method skipped every
    // zero-width character, which hides a line holding only U+200B).
    const q = rs.length > 0 ? rs[rs.length - 1] : n.data[i] === ' ' ? undefined : all[0];
    if (!q) continue;
    const li = Math.floor((q.top + q.height / 2) / 100);
    if (li > cur) { opps.push(i); cur = li; }
  }
  return { id: it.id, lang: it.lang, text: it.text, font: it.font ?? 'sans-serif', opps };
}), items);
// One text per line, every non-ASCII code unit escaped so invisible characters (U+00AD, U+00A0, U+200B) stay reviewable.
const ascii = (v) => JSON.stringify(v).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
fs.writeFileSync(output, `[\n${res.map((r) => ` ${ascii(r)}`).join(',\n')}\n]\n`);
console.log('chrome', browser.version(), res.length, 'texts');
await browser.close();

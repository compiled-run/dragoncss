// Italic run of ../lato/opps.mjs (TXT1a-1 R6): the same method, each font's family, weight and style.
// Chrome's break-opportunity oracle: width:0 forces a break at every opportunity (min-content).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../packages/parity/', import.meta.url));
const { chromium } = require('playwright');
const cases = JSON.parse(fs.readFileSync(new URL('./out/cases.json', import.meta.url), 'utf8'));
const extraCss = process.env.CSS || '';
const uniq = {}; for (const c of cases) uniq[c.lang + '|' + c.para + '|' + c.font] ??= { lang: c.lang, para: c.para, font: c.font, family: c.family, weight: c.weight, style: c.style, text: c.text };
const b = await chromium.launch(); const page = await b.newPage();
if (b.version() !== '145.0.7632.6') throw new Error(`Chromium ${b.version()}, want 145.0.7632.6`);
await page.goto(new URL('./page.html', import.meta.url).href);
await page.evaluate(async () => { for (const w of [400, 700]) await document.fonts.load(`italic ${w} 16px Inter`, 'A'); });
const res = await page.evaluate(({ items, extraCss }) => items.map(it => {
  const p = document.getElementById('p'); p.style.cssText += ';width:0px;font:' + it.style + ' ' + it.weight + ' 16px/100px ' + it.family + ';' + extraCss; p.lang = it.lang; p.textContent = it.text;
  const r = document.createRange(), n = p.firstChild, starts = []; let cur = 0;
  for (let i = 0; i < n.length; i++) { r.setStart(n, i); r.setEnd(n, i + 1);
    const rs = [...r.getClientRects()].filter(x => x.width > 0); const q = rs[rs.length - 1]; if (!q) continue;
    const li = Math.floor((q.top + q.height / 2) / 100); if (li > cur) { starts.push(i); cur = li; } }
  return { ...it, opps: starts };
}), { items: Object.values(uniq), extraCss });
fs.writeFileSync(new URL('./out/chrome-opps.json', import.meta.url), JSON.stringify(res));
const byPara = {}; for (const r of res) (byPara[r.lang + '|' + r.para] ??= new Set()).add(JSON.stringify(r.opps));
console.log('opportunity sets font-independent:', Object.values(byPara).every(s => s.size === 1));
for (const r of res.filter(r => r.font === 'InterItalic')) console.log(r.font, r.para, r.opps.map((o, i) => JSON.stringify(r.text.slice(i ? r.opps[i - 1] : 0, o))).join(' ').slice(0, 400));
await b.close();

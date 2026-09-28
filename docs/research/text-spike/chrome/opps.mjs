// Chrome's break-opportunity oracle: width:0 forces a break at every opportunity (min-content).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/jacksm5pro/dev/open-source/dragon/packages/parity/');
const { chromium } = require('playwright');
const cases = JSON.parse(fs.readFileSync('/tmp/text-spike/out/cases.json', 'utf8'));
const extraCss = process.env.CSS || '';
const uniq = {}; for (const c of cases) uniq[c.lang + '|' + c.para + '|' + c.font] ??= { lang: c.lang, para: c.para, font: c.font, text: c.text };
const b = await chromium.launch(); const page = await b.newPage();
await page.goto('file:///tmp/text-spike/chrome/page.html');
await page.evaluate(async () => { for (const f of ['Inter','Roboto','NotoSans','NotoSansJP','InterVF']) await document.fonts.load(`16px ${f}`, 'Aあ'); });
const res = await page.evaluate(({ items, extraCss }) => items.map(it => {
  const p = document.getElementById('p'); p.style.cssText += ';width:0px;font:16px/100px ' + it.font + ';' + extraCss; p.lang = it.lang; p.textContent = it.text;
  const r = document.createRange(), n = p.firstChild, starts = []; let cur = 0;
  for (let i = 0; i < n.length; i++) { r.setStart(n, i); r.setEnd(n, i + 1);
    const rs = [...r.getClientRects()].filter(x => x.width > 0); const q = rs[rs.length - 1]; if (!q) continue;
    const li = Math.floor((q.top + q.height / 2) / 100); if (li > cur) { starts.push(i); cur = li; } }
  return { ...it, opps: starts };
}), { items: Object.values(uniq), extraCss });
fs.writeFileSync('/tmp/text-spike/out/chrome-opps.json', JSON.stringify(res));
const byPara = {}; for (const r of res) (byPara[r.lang + '|' + r.para] ??= new Set()).add(JSON.stringify(r.opps));
console.log('opportunity sets font-independent:', Object.values(byPara).every(s => s.size === 1));
for (const r of res.filter(r => r.font === 'Inter' || r.font === 'NotoSansJP')) console.log(r.font, r.para, r.opps.map((o, i) => JSON.stringify(r.text.slice(i ? r.opps[i - 1] : 0, o))).join(' ').slice(0, 400));
await b.close();

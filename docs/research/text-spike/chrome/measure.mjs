// Renders every case in Playwright Chromium and records per-line breaks, widths, rect geometry.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/jacksm5pro/dev/open-source/dragon/packages/parity/');
const { chromium } = require('playwright');
const cases = JSON.parse(fs.readFileSync('/tmp/text-spike/out/cases.json', 'utf8'));
const dpr = Number(process.env.DPR || 1);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: dpr, viewport: { width: 1200, height: 900 } });
await page.goto('file:///tmp/text-spike/chrome/page.html');
await page.evaluate(async () => { for (const f of ['Inter','Roboto','NotoSans','NotoSansJP','InterVF']) await document.fonts.load(`16px ${f}`, 'Aあ'); });
const results = await page.evaluate(({ cases, extraCss }) => {
  const p = document.getElementById('p'), nw = document.getElementById('nw');
  const out = [];
  const measure = (c, lh) => {
    p.style.cssText = 'position:absolute;left:0;top:0;' + extraCss; p.lang = c.lang; p.style.fontFamily = c.font; p.style.fontSize = c.size + 'px'; p.style.width = c.width + 'px';
    p.style.lineHeight = lh;
    p.textContent = c.text;
    const node = p.firstChild, r = document.createRange();
    const L = parseFloat(lh); const lineOf = [];
    for (let i = 0; i < c.text.length; i++) {
      r.setStart(node, i); r.setEnd(node, i + 1);
      const rs = [...r.getClientRects()].filter(x => x.width > 0);
      { const q = rs[rs.length - 1]; lineOf.push(q ? Math.floor((q.top + q.height / 2) / L) : -1); }
    }
    const starts = [0]; let cur = 0;
    for (let i = 1; i < lineOf.length; i++) if (lineOf[i] > cur) { starts.push(i); cur = lineOf[i]; }
    const lines = starts.map((s, k) => {
      const e = k + 1 < starts.length ? starts[k + 1] : c.text.length;
      let te = e; while (te > s && /[ 　]/.test(c.text[te - 1])) te--;
      r.setStart(node, s); r.setEnd(node, te);
      // glyph run rects on this line only (Chrome attaches a generated-hyphen rect of the previous line to the next char's range)
      const rects = [...r.getClientRects()].filter(x => Math.floor((x.top + x.height / 2) / L) === k && x.width > 0).map(x => [x.left, x.top, x.width, x.height]);
      const left = Math.min(...rects.map(x => x[0])), right = Math.max(...rects.map(x => x[0] + x[2]));
      return { start: s, end: e, text: c.text.slice(s, e), width: right - left, left, top: rects[0][1], height: rects[0][3], rects };
    });
    return { breaks: starts.slice(1), lines, blockHeight: p.getBoundingClientRect().height };
  };
  const nwCache = {};
  for (const c of cases) {
    const fixed = Math.round(c.size * 1.5);
    const b = measure(c, fixed + 'px');
    p.style.lineHeight = 'normal';
    const nb = p.getBoundingClientRect().height;
    const a = { ...b, blockHeight: nb };
    { const rr = document.createRange(); rr.setStart(p.firstChild, 0); rr.setEnd(p.firstChild, 1); a.normalGlyph = [...rr.getClientRects()].map(x => [x.top, x.height])[0]; }
    const key = c.font + '/' + c.para + '/' + c.size;
    if (!(key in nwCache)) { nw.style.cssText = 'position:absolute;top:2000px;white-space:nowrap;' + extraCss; nw.lang = c.lang; nw.style.font = `${c.size}px ${c.font}`; nw.textContent = c.text; nwCache[key] = nw.getBoundingClientRect().width; }
    out.push({ id: c.id, breaks: a.breaks, breaksFixed: b.breaks, lines: a.lines.map(({ rects, ...l }) => ({ ...l, runs: rects })),
      normalBlockHeight: a.blockHeight, normalLineHeight: a.blockHeight / b.lines.length, normalFirstGlyph: a.normalGlyph, fixedLineHeight: fixed, fixedBlockHeight: b.blockHeight,
      fixedLineTops: b.lines.map(l => l.top), fixedGlyphHeights: b.lines.map(l => l.height), nowrapWidth: nwCache[key] });
  }
  return out;
}, { cases, extraCss: process.env.CSS || '' });
fs.writeFileSync(process.env.OUT || `/tmp/text-spike/out/chrome${dpr === 1 ? '' : '-dpr' + dpr}.json`, JSON.stringify(results, null, 0));
console.log('chrome', browser.version(), results.length, 'cases; breaks normal==fixed:', results.every(r => JSON.stringify(r.breaks) === JSON.stringify(r.breaksFixed)));
await browser.close();

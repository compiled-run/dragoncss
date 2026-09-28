// Mirrors packages/parity/src/chrome.ts: Playwright 1.58.2 chromium (145.0.7632.6), same flags, Ahem data-URI face on html.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '/Users/jacksm5pro/dev/open-source/dragon/packages/parity/node_modules/playwright/index.mjs';
import { probes } from './probes.mjs';

const CHROME_VERSION = '145.0.7632.6';
const argsAt = (n) => [
  `--force-device-scale-factor=${n}`,
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--hide-scrollbars',
];
const b64 = readFileSync('/Users/jacksm5pro/dev/open-source/dragon/vendor/fonts/Ahem.ttf').toString('base64');
const harness = `@font-face{font-family:Ahem;src:url(data:font/ttf;base64,${b64}) format("truetype")}:where(html){font-family:Ahem}`;

const MEASURE = `(async (spec) => {
  await document.fonts.load('10px Ahem'); await document.fonts.ready;
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  for (let i = 0; i < 4; i++) await raf();
  await new Promise((r) => setTimeout(r, 60));
  for (let i = 0; i < 2; i++) await raf();
  const all = [];
  const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.id) all.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
  walk(document);
  const boxes = {};
  for (const el of all) {
    const r = el.getBoundingClientRect();
    boxes[el.id] = { x: r.x, y: r.y, w: r.width, h: r.height, oL: el.offsetLeft, oT: el.offsetTop, oW: el.offsetWidth, oH: el.offsetHeight,
      oP: el.offsetParent ? (el.offsetParent.id || el.offsetParent.tagName) : null };
  }
  const deepAt = (x, y) => { let e = document.elementFromPoint(x, y); while (e && e.shadowRoot) { const d = e.shadowRoot.elementFromPoint(x, y); if (!d || d === e) break; e = d; } return e ? (e.id || e.tagName) : null; };
  const points = {};
  for (const [k, v] of Object.entries(spec.points || {})) { let x, y; if (typeof v === 'string') { const el = all.find((e) => e.id === v); const r = el.getBoundingClientRect(); x = r.x + r.width / 2; y = r.y + r.height / 2; } else [x, y] = v; points[k] = deepAt(x, y) + ' @' + x + ',' + y; }
  const byId = (id) => all.find((e) => e.id === id);
  const computed = {};
  for (const [id, prop] of spec.computed || []) { const el = byId(id); computed[id + ' ' + prop] = el ? getComputedStyle(el).getPropertyValue(prop) : 'NO-ELEMENT'; }
  let extra = null;
  if (spec.script) extra = await (new Function('byId', 'return (async () => {' + spec.script + '})()'))(byId);
  return { boxes, points, computed, extra };
})`;

const results = {};
const byDpr = new Map();
for (const p of probes) { const d = p.dpr || 1; if (!byDpr.has(d)) byDpr.set(d, []); byDpr.get(d).push(p); }
for (const [dpr, list] of byDpr) {
  const browser = await chromium.launch({ args: argsAt(dpr) });
  if (browser.version() !== CHROME_VERSION) throw new Error('wrong chrome ' + browser.version());
  for (const p of list) {
    const context = await browser.newContext({ viewport: { width: p.vw || 400, height: p.vh || 400 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const msgs = [];
    page.on('console', (m) => msgs.push(m.text()));
    page.on('pageerror', (e) => msgs.push('ERR ' + e.message));
    const injected = p.html.replace(/<head>/i, `<head><style data-dragon-harness>${harness}</style>`);
    await page.setContent(injected);
    const out = await page.evaluate(`${MEASURE}(${JSON.stringify({ points: p.points, computed: p.computed, script: p.script })})`);
    const realDpr = await page.evaluate(() => window.devicePixelRatio);
    if (realDpr !== dpr) throw new Error('dpr mismatch');
    results[p.id] = { q: p.q, title: p.title, dpr, html: p.html, ...out, console: msgs };
    await context.close();
  }
  await browser.close();
}
writeFileSync('/tmp/anchor-measure/results.json', JSON.stringify(results, null, 1));
console.log('probes:', Object.keys(results).length, 'chrome', CHROME_VERSION);

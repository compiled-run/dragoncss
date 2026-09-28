// Print first differing line per case: node diff.mjs <engine.json> <key> [filterRegex] [limit]
import fs from 'node:fs';
const chrome = Object.fromEntries(JSON.parse(fs.readFileSync(process.env.CHROME || '/tmp/text-spike/out/chrome.json')).map(r => [r.id, r]));
const cases = Object.fromEntries(JSON.parse(fs.readFileSync('/tmp/text-spike/out/cases.json')).map(c => [c.id, c]));
const [file, key, filt = '.', lim = 40] = process.argv.slice(2);
let n = 0;
for (const r of JSON.parse(fs.readFileSync(file))) {
  if (!new RegExp(filt).test(r.id)) continue;
  const ch = chrome[r.id], e = r[key], t = cases[r.id].text;
  for (let i = 0; i < Math.max(ch.lines.length, e.lines.length); i++) {
    const a = ch.lines[i], b = e.lines[i];
    if (a && b && a.start === b.start && a.end === b.end) continue;
    console.log(r.id.padEnd(28), 'chrome', JSON.stringify(a && t.slice(a.start, a.end)), a && a.width.toFixed(3), '|', key, JSON.stringify(b && t.slice(b.start, b.end)), b && b.width.toFixed(3));
    break;
  }
  if (++n >= +lim) break;
}

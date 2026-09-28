// Classify the first differing line per mismatching case. node classify.mjs <engine.json> <key> [fontRegex]
import fs from 'node:fs';
const chrome = Object.fromEntries(JSON.parse(fs.readFileSync(process.env.CHROME || '/tmp/text-spike/out/chrome.json')).map(r => [r.id, r]));
const cases = Object.fromEntries(JSON.parse(fs.readFileSync('/tmp/text-spike/out/cases.json')).map(c => [c.id, c]));
const opps = {}; for (const o of JSON.parse(fs.readFileSync('/tmp/text-spike/out/chrome-opps.json'))) opps[o.lang + '|' + o.para] = new Set(o.opps);
const [file, key, filt = '.'] = process.argv.slice(2);
const counts = {}, ex = {};
for (const r of JSON.parse(fs.readFileSync(file))) {
  if (!new RegExp(filt).test(r.id)) continue;
  const c = cases[r.id], ch = chrome[r.id], e = r[key], t = c.text, O = opps[c.lang + '|' + c.para];
  if (JSON.stringify(ch.breaks) === JSON.stringify(e.breaks)) continue;
  const i = ch.lines.findIndex((l, k) => !e.lines[k] || e.lines[k].end !== l.end);
  const a = ch.lines[i], b = e.lines[i];
  let cls;
  if (!b) cls = 'engine has fewer lines';
  else if (!O.has(b.end) && b.end < t.length) {
    const p = t[b.end - 1], n = t[b.end];
    cls = /[\p{L}\p{N}]/u.test(p) && /[\p{L}\p{N}]/u.test(n) ? 'A1 engine emergency-breaks inside a word (Chrome overflows)' : `A2 engine breaks after '${p}' before '${n}' (not a Blink opportunity)`;
  } else if (b.end < a.end) {
    const p = t[a.end - 1];
    cls = O.has(a.end) && !/[ 　]/.test(p) ? `B engine lacks Blink opportunity after '${p === '­' ? 'SHY' : p}'` : 'C engine line narrower-fit (width)';
  } else cls = t[b.end - 1] === '­' || t.slice(b.start, b.end).includes('­') ? 'D engine ignores generated-hyphen width at SHY' : 'C engine fits more (width)';
  cls = cls.replace(/after '(\p{L})'/u, "after a letter");
  counts[cls] = (counts[cls] || 0) + 1; (ex[cls] ??= []).length < 2 && ex[cls].push(r.id + ' chrome=' + JSON.stringify(a.text) + ' engine=' + JSON.stringify(b && t.slice(b.start, b.end)));
}
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), k, '\n       e.g.', ex[k].join('\n            '));

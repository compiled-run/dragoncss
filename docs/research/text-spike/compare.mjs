// Compares engine outputs against Chrome. Usage: node compare.mjs <engine.json> [engineKeys...]
import fs from 'node:fs';
const chrome = Object.fromEntries(JSON.parse(fs.readFileSync(process.env.CHROME || '/tmp/text-spike/out/chrome.json')).map(r => [r.id, r]));
const cases = Object.fromEntries(JSON.parse(fs.readFileSync('/tmp/text-spike/out/cases.json')).map(c => [c.id, c]));
const [file, ...keys] = process.argv.slice(2);
const eng = JSON.parse(fs.readFileSync(file));
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
const summary = {};
for (const k of keys) {
  const by = { font: {}, para: {} }; let same = 0, n = 0, maxLineDelta = 0, maxLineDeltaId = '', lineDeltas = [];
  const diffs = [];
  for (const r of eng) {
    const c = cases[r.id], ch = chrome[r.id], e = r[k]; if (!e) continue;
    const ok = JSON.stringify(e.breaks) === JSON.stringify(ch.breaks);
    n++; if (ok) same++; else diffs.push(r.id);
    for (const g of ['font', 'para']) { const key = g === 'font' ? c.font : (c.font === 'NotoSansJP' && c.para === 'prose' ? 'prose(JP font)' : c.para); (by[g][key] ??= [0, 0]); by[g][key][1]++; if (ok) by[g][key][0]++; }
    // width delta on lines that match exactly (same start/end)
    for (const l of e.lines) { const cl = ch.lines.find(x => x.start === l.start && x.end === l.end); if (!cl) continue;
      if (/­$/.test(cl.text)) continue; // Chrome width includes generated hyphen; compared separately
      const d = Math.abs(l.width - cl.width); lineDeltas.push(d); if (d > maxLineDelta) { maxLineDelta = d; maxLineDeltaId = r.id + ' ' + JSON.stringify(cl.text); } }
  }
  lineDeltas.sort((a, b) => a - b);
  const q = p => lineDeltas[Math.floor(p * (lineDeltas.length - 1))];
  summary[k] = { identical: `${same}/${n} (${pct(same, n)})`, byFont: Object.fromEntries(Object.entries(by.font).map(([a, [s, t]]) => [a, `${s}/${t} ${pct(s, t)}`])),
    byPara: Object.fromEntries(Object.entries(by.para).map(([a, [s, t]]) => [a, `${s}/${t} ${pct(s, t)}`])),
    matchedLines: lineDeltas.length, lineWidthDelta: { p50: q(0.5), p95: q(0.95), max: maxLineDelta, maxAt: maxLineDeltaId }, diffs };
}
// nowrap advance deltas per font/size
const nw = {};
for (const r of eng) { if (r.nowrapWidth == null) continue; const c = cases[r.id], ch = chrome[r.id]; const key = c.font; const d = r.nowrapWidth - ch.nowrapWidth;
  const rel = d / ch.nowrapWidth; (nw[key] ??= { maxAbs: 0, maxRel: 0, at: '' }); if (Math.abs(d) > nw[key].maxAbs) { nw[key].maxAbs = Math.abs(d); nw[key].at = r.id; nw[key].signed = d; } nw[key].maxRel = Math.max(nw[key].maxRel, Math.abs(rel)); }
summary.nowrapDelta = nw;
console.log(JSON.stringify(summary, (k, v) => k === 'diffs' ? v.length + ' diffs: ' + v.slice(0, 12).join(', ') : typeof v === 'number' ? +v.toFixed(4) : v, 2));

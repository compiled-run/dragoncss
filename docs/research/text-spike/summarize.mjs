// Emit the markdown tables for REPORT.md from out/*.json.
import fs from 'node:fs';
const J = f => JSON.parse(fs.readFileSync('/tmp/text-spike/out/' + f));
const chrome = Object.fromEntries(J('chrome.json').map(r => [r.id, r]));
const chromeSA = Object.fromEntries(J('chrome-spaceall.json').map(r => [r.id, r]));
const cases = Object.fromEntries(J('cases.json').map(c => [c.id, c]));
const files = { ct: J('coretext.json'), a1: J('android-1.0.json'), a2: J('android-2.625.json'), a3: J('android-3.0.json') };
const rows = [
  ['Core Text `CTTypesetterSuggestLineBreak` (as-is)', 'ct', 'ct'],
  ['TextKit 1 `NSLayoutManager` (as-is)', 'ct', 'tk1'],
  ['TextKit 1 + `lineBreakStrategy = .standard`', 'ct', 'tk1std'],
  ['StaticLayout SIMPLE, default Paint (hinted), 1x', 'a1', 'sl'],
  ['StaticLayout SIMPLE, default Paint (hinted), 2.625x', 'a2', 'sl'],
  ['StaticLayout SIMPLE, default Paint (hinted), 3x', 'a3', 'sl'],
  ['StaticLayout SIMPLE + LINEAR_TEXT_FLAG, 2.625x', 'a2', 'slSubpixel'],
  ['StaticLayout SIMPLE + LINEAR + opsz, 2.625x', 'a2', 'slOpsz'],
  ['StaticLayout HIGH_QUALITY + hyphenation NORMAL (TextView-like), 2.625x', 'a2', 'slHighQuality'],
  ['(b-ICU) CT widths + raw ICU opportunities + Blink greedy', 'ct', 'greedyICU'],
  ['(b-ICU) Android widths (LINEAR) + android.icu opportunities + Blink greedy, 2.625x', 'a2', 'greedyICU'],
  ['(b) CT widths + Blink opportunities + Blink greedy', 'ct', 'greedyOracle'],
  ['(b) Android widths (hinted default Paint) + Blink opps + greedy, 2.625x', 'a2', 'greedyOracleHinted'],
  ['(b) Android widths (LINEAR) + Blink opps + greedy, 2.625x', 'a2', 'greedyOracle'],
  ['(b) Android widths (LINEAR + explicit opsz) + Blink opps + greedy, 2.625x', 'a2', 'greedyOracleOpsz'],
];
const group = id => { const c = cases[id]; return c.font === 'NotoSansJP' ? (c.para === 'prose' ? 'jpLatin' : 'cjk') : c.font === 'InterVF' ? 'vf' : 'latin'; };
const pct = (a, b) => `${a}/${b} (${(100 * a / b).toFixed(1)}%)`;
let out = '| Engine / path | All 620 | Latin static fonts (480) | Inter variable (60) | CJK, Chrome default (60) | CJK vs Chrome `text-spacing-trim: space-all` (60) | Line-width delta on identical lines, Latin static: p50 / p95 / max (px) |\n|---|---|---|---|---|---|---|\n';
for (const [label, f, k] of rows) {
  const t = { all: [0, 0], latin: [0, 0], vf: [0, 0], cjk: [0, 0], cjkSA: [0, 0] }; const d = [];
  for (const r of files[f]) { const e = r[k]; if (!e) continue; const g = group(r.id);
    const ok = JSON.stringify(e.breaks) === JSON.stringify(chrome[r.id].breaks);
    t.all[1]++; t.all[0] += ok; if (t[g]) { t[g][1]++; t[g][0] += ok; }
    if (g === 'cjk') { t.cjkSA[1]++; t.cjkSA[0] += JSON.stringify(e.breaks) === JSON.stringify(chromeSA[r.id].breaks); }
    if (g === 'latin') for (const l of e.lines) { const cl = chrome[r.id].lines.find(x => x.start === l.start && x.end === l.end); if (cl && !/­$/.test(cl.text)) d.push(Math.abs(l.width - cl.width)); } }
  d.sort((a, b) => a - b); const q = p => d[Math.floor(p * (d.length - 1))].toFixed(3);
  out += `| ${label} | ${pct(...t.all)} | ${pct(...t.latin)} | ${pct(...t.vf)} | ${pct(...t.cjk)} | ${pct(...t.cjkSA)} | ${q(0.5)} / ${q(0.95)} / ${d[d.length - 1].toFixed(3)} |\n`;
}
out += '\n\n| Font | CT nowrap max abs delta (px) | Android default Paint 1x / 2.625x / 3x | Android LINEAR 1x / 2.625x / 3x |\n|---|---|---|---|\n';
const nw = (f, key, font, ch = chrome) => { let m = 0; for (const r of files[f]) if (cases[r.id].font === font && cases[r.id].para !== 'prose' || (cases[r.id].font === font && font !== 'NotoSansJP')) m = Math.max(m, Math.abs(r[key] - ch[r.id].nowrapWidth)); return m.toFixed(3); };
for (const font of ['Inter', 'Roboto', 'NotoSans', 'InterVF', 'NotoSansJP']) {
  out += `| ${font} | ${nw('ct', 'nowrapWidth', font)} | ${['a1', 'a2', 'a3'].map(f => nw(f, 'nowrapWidthHinted', font)).join(' / ')} | ${['a1', 'a2', 'a3'].map(f => nw(f, 'nowrapWidth', font)).join(' / ')} |\n`;
  if (font === 'NotoSansJP') out += `| NotoSansJP vs Chrome space-all | ${nw('ct', 'nowrapWidth', font, chromeSA)} | ${['a1', 'a2', 'a3'].map(f => nw(f, 'nowrapWidthHinted', font, chromeSA)).join(' / ')} | ${['a1', 'a2', 'a3'].map(f => nw(f, 'nowrapWidth', font, chromeSA)).join(' / ')} |\n`;
  if (font === 'InterVF') out += `| InterVF, Android explicit opsz | - | - | ${['a1', 'a2', 'a3'].map(f => nw(f, 'nowrapWidthOpsz', font)).join(' / ')} |\n`;
}
fs.writeFileSync('/tmp/text-spike/out/tables.md', out); console.log(out);

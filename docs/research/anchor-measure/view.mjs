import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync('/tmp/anchor-measure/results.json'));
const q = +process.argv[2]; const ids = process.argv.slice(3);
for (const [id, v] of Object.entries(r)) {
  if (v.q !== q) continue;
  const b = Object.entries(v.boxes).filter(([k]) => ids.length === 0 || ids.includes(k)).map(([k, x]) => `${k}:[${x.x},${x.y} ${x.w}x${x.h} o=${x.oL},${x.oT}]`).join(' ');
  console.log(`# ${id}\n  ${b}` + (Object.keys(v.points).length ? `\n  pts ${JSON.stringify(v.points)}` : '') + (Object.keys(v.computed).length ? `\n  cs ${JSON.stringify(v.computed)}` : '') + (v.extra ? `\n  extra ${JSON.stringify(v.extra)}` : '') + (v.console.length ? `\n  console ${v.console.join(' | ')}` : ''));
}

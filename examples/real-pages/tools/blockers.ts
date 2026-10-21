// Groups each screen's iOS/Android errors into blockers (one feature each) and ranks them by how many screens they break.
import { readFileSync, readdirSync } from 'node:fs';
type Found = { code: string; severity: string; target: string | null; where: string; message: string; round: number };

export function blockerOf(f: Found): string {
  const m = f.message;
  let x: RegExpExecArray | null;
  if (f.code === 'DRAGON_UNPROVEN_CONTEXT') {
    const ctx = / is used in the ([a-z-]+)/.exec(m)?.[1] ?? '?';
    return `unproven context ${ctx}`;
  }
  if (/ has opacity [0-9.]+; /.test(m)) return 'opacity: fractional on a view';
  if (/<button> \S+ (with appearance: auto|inherits line-height)|comes from Chrome's user-agent|user-agent control font/.test(m)) return 'button: Chrome UA button defaults (border outset, theme paint, line-height reset, Arial)';
  if (f.code === 'DRAGON_UNSUPPORTED_ELEMENT') return `element <${/^<([a-z0-9-]+)>/.exec(m)?.[1]}>`;
  if (f.code === 'DRAGON_UNSUPPORTED_ATTRIBUTE') { x = /^attribute (\S+) on (\S+)/.exec(m); return `attribute ${x?.[1]}`; }
  if (f.code === 'DRAGON_UNSUPPORTED_SELECTOR') { x = /(::?[a-z-]+(?:\([^)]*\))?)/.exec(m); return `selector ${x?.[1] ?? m.slice(0, 40)}`; }
  if (f.code === 'DRAGON_FONT_UNMAPPED_FAMILY') return 'font: unmapped family';
  if (f.code === 'DRAGON_UNSUPPORTED_FONT') return 'font: real faces on native (Ahem only)';
  if (/^font-family: .* is unsupported/.test(m)) return 'font: real faces on native (Ahem only)';
  if ((x = /^([a-z-]+): .*? substitutes to "[^"]*": ([a-z-]+): (\S+)/.exec(m)) !== null) return `${x[2]}: ${x[3]}`;
  if ((x = /^([a-z-]+) is not supported/.exec(m)) !== null) return `property ${x[1]}`;
  if ((x = /^([a-z-]+): (.+?) is unsupported/.exec(m)) !== null) return `${x[1]}: ${x[2]!.length > 40 ? `${x[2]!.slice(0, 40)}...` : x[2]}`;
  if ((x = /^([a-z-]+): (.+?) (?:is|has|needs|on)\b/.exec(m)) !== null) return `${x[1]}: ${x[2]!.slice(0, 40)}`;
  return `${f.code}: ${m.slice(0, 70)}`;
}

export function blockers(file: string, target: 'ios' | 'android') {
  const r = JSON.parse(readFileSync(file, 'utf8')) as { found: Found[] };
  const out = new Map<string, { count: number; example: Found }>();
  for (const f of r.found) {
    if (f.severity !== 'error' || !(f.target === null || f.target === target)) continue;
    const k = blockerOf(f);
    const hit = out.get(k);
    if (hit === undefined) out.set(k, { count: 1, example: f });
    else hit.count++;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? 'authored';
  const files = readdirSync('examples/real-pages/out').filter((f) => (mode === 'ahem' ? f.endsWith('.ahem.json') : !f.includes('.ahem')));
  const rank = new Map<string, { screens: string[]; uses: number; example: Found }>();
  for (const f of files) {
    const screen = f.split('.')[0]!;
    for (const [k, v] of blockers(`examples/real-pages/out/${f}`, 'ios')) {
      const e = rank.get(k) ?? { screens: [], uses: 0, example: v.example };
      e.screens.push(screen);
      e.uses += v.count;
      rank.set(k, e);
    }
  }
  for (const [k, v] of [...rank].sort((a, b) => b[1].screens.length - a[1].screens.length || b[1].uses - a[1].uses)) console.log(`${v.screens.length} ${String(v.uses).padStart(3)} ${k.padEnd(48)} ${v.screens.join(',')} | ${v.example.message.slice(0, 150)}`);
}

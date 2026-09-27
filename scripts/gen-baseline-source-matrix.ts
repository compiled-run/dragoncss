// Writes the baseline-source matrix (notes/T039-s4b-review-s5-plan.md, M1) and its committed selection,
// packages/parity/generated/baseline-source-selection.json: every flex container mode (row, row-reverse, column, column-reverse;
// nowrap, wrap, wrap-reverse; container ltr and rtl; with and without baseline-aligned items) and a block container in ltr and rtl,
// each as the baseline source of its own align-items: baseline row beside an Ahem "X". Wrapping containers hold 4 items of mixed
// Ahem sizes on 2 lines. Before anything runs in Chrome, every source is compiled (profiles derived) and laid out by the engine in
// both environment directions; a source refused there is listed with its typed code and left out of the fixture, and never
// dropped after a run. The fixture runs in both environments.
// Run with: node scripts/gen-baseline-source-matrix.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from '../packages/dragon/src/internal.ts';
import { layout, measurerFor, validateLayoutInput } from '../packages/layout/src/index.ts';
import { fixtureToInput, PROJECT_ID } from '../packages/parity/src/fixture-reader.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = 'baseline-source-matrix';
const DIRECTIONS = ['row', 'row-reverse', 'column', 'column-reverse'] as const;
const WRAPS = ['nowrap', 'wrap', 'wrap-reverse'] as const;
const CONTAINER_DIRECTIONS = ['ltr', 'rtl'] as const;
const ITEMS = [{ letter: 'A', size: 20 }, { letter: 'B', size: 12 }, { letter: 'C', size: 16 }, { letter: 'D', size: 10 }] as const;

const CSS = [
  'body { margin: 0; font-family: Ahem; font-size: 10px; }',
  '.r { display: flex; align-items: baseline; width: 390px; border-top: 1px solid #000; margin-bottom: 2px; }',
  '.fr { display: flex; width: 45px; flex-shrink: 0; }',
  '.fc { display: flex; width: 100px; height: 45px; min-width: 0; flex-shrink: 0; }',
  '.ir { width: 20px; flex-shrink: 0; }',
  '.ic { height: 20px; flex-shrink: 0; }',
  '.blk { width: 60px; flex-shrink: 0; }',
  '.row { flex-direction: row; }',
  '.row-reverse { flex-direction: row-reverse; }',
  '.column { flex-direction: column; }',
  '.column-reverse { flex-direction: column-reverse; }',
  '.nowrap { flex-wrap: nowrap; }',
  '.wrap { flex-wrap: wrap; }',
  '.wrap-reverse { flex-wrap: wrap-reverse; }',
  '.ltr { direction: ltr; }',
  '.rtl { direction: rtl; }',
  '.bl { align-items: baseline; }',
  ...ITEMS.map((i) => `.t${i.size} { font-size: ${i.size}px; }`),
];

type Source =
  | { readonly id: string; readonly kind: 'flex'; readonly flexDirection: (typeof DIRECTIONS)[number]; readonly flexWrap: (typeof WRAPS)[number]; readonly direction: 'ltr' | 'rtl'; readonly baselineAligned: boolean; readonly items: number; readonly lines: number }
  | { readonly id: string; readonly kind: 'block'; readonly direction: 'ltr' | 'rtl'; readonly items: number; readonly lines: number };

const sources: Source[] = [];
for (const flexDirection of DIRECTIONS) {
  for (const flexWrap of WRAPS) {
    for (const direction of CONTAINER_DIRECTIONS) {
      for (const baselineAligned of [false, true]) {
        sources.push({ id: `s-${flexDirection}-${flexWrap}-${direction}${baselineAligned ? '-bl' : ''}`, kind: 'flex', flexDirection, flexWrap, direction, baselineAligned, items: ITEMS.length, lines: flexWrap === 'nowrap' ? 1 : 2 });
      }
    }
  }
}
for (const direction of CONTAINER_DIRECTIONS) sources.push({ id: `s-block-${direction}`, kind: 'block', direction, items: 2, lines: 2 });

function row(s: Source): string {
  if (s.kind === 'block') {
    const kids = [ITEMS[0], ITEMS[3]].map((i, k) => `<div data-dragon-id="${s.id}-${k}" class="t${i.size}">${i.letter}</div>`).join('');
    return `<div data-dragon-id="${s.id}-row" class="r"><div data-dragon-id="${s.id}-x">X</div><div data-dragon-id="${s.id}" class="blk ${s.direction}">${kids}</div></div>`;
  }
  const column = s.flexDirection.startsWith('column');
  const kids = ITEMS.map((i, k) => `<div data-dragon-id="${s.id}-${k}" class="${column ? 'ic' : 'ir'} t${i.size}">${i.letter}</div>`).join('');
  const cls = [column ? 'fc' : 'fr', s.flexDirection, s.flexWrap, s.direction, ...(s.baselineAligned ? ['bl'] : [])].join(' ');
  return `<div data-dragon-id="${s.id}-row" class="r"><div data-dragon-id="${s.id}-x">X</div><div data-dragon-id="${s.id}" class="${cls}">${kids}</div></div>`;
}

function page(rows: readonly string[]): string {
  return ['<!DOCTYPE html>', '<html data-dragon-id="html">', '<head>', '<style>', ...CSS, '</style>', '</head>', '<body data-dragon-id="body">', ...rows, '</body>', '</html>', ''].join('\n');
}

/** A source is refused when it does not compile clean (profiles derived) or the engine refuses it, in either environment. */
function refusal(s: Source): { readonly code: string; readonly detail: string } | null {
  const input = fixtureToInput(`${FIXTURE}-probe`, page([row(s)]));
  const measurer = measurerFor('darwin-arm64');
  if (measurer.kind !== 'ok') throw new Error(measurer.detail);
  for (const direction of ['ltr', 'rtl'] as const) {
    const project = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction, rootFont: 'ahem' });
    const c = project.compile(input);
    const d = c.diagnostics[0];
    if (d !== undefined) return { code: d.code, detail: `${direction}: ${d.message}` };
    const p = iosLayoutProjection(c, { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction, rootFont: 'ahem' }, []);
    if (p.kind !== 'ready') return { code: 'projection-blocked', detail: `${direction}: ${p.reason}` };
    const v = validateLayoutInput(JSON.parse(JSON.stringify(p.input)));
    if (!v.ok) return { code: 'layout-input-invalid', detail: `${direction}: ${JSON.stringify(v.errors)}` };
    const r = layout(v.input, measurer.measurer);
    if (r.kind === 'unsupported') return { code: r.unsupported.code, detail: `${direction}: ${r.unsupported.detail}` };
  }
  return null;
}

const selected: Source[] = [];
const refused: { readonly source: Source; readonly code: string; readonly detail: string }[] = [];
for (const s of sources) {
  const r = refusal(s);
  if (r === null) selected.push(s);
  else refused.push({ source: s, ...r });
}

const selection = {
  generator: 'scripts/gen-baseline-source-matrix.ts',
  rule: 'T039 M1: every flex container mode and a block container as a baseline source; each selected source must pass both lanes in both environments, and a refused source is listed with its typed code. None is dropped after running.',
  environments: ['ltr', 'rtl'],
  fixtures: [FIXTURE],
  items: ITEMS,
  sources: selected,
  refused,
};
mkdirSync(join(root, 'packages', 'parity', 'generated'), { recursive: true });
writeFileSync(join(root, 'packages', 'parity', 'generated', 'baseline-source-selection.json'), `${JSON.stringify(selection, null, 2)}\n`);
writeFileSync(join(root, 'packages', 'parity', 'fixtures', `${FIXTURE}.html`), page(selected.map(row)));
console.log(`baseline-source matrix: ${sources.length} sources, ${selected.length} selected, ${refused.length} refused`);
for (const s of selected) console.log(`  selected ${s.id} (${s.kind}${s.kind === 'flex' ? ` ${s.flexDirection} ${s.flexWrap}` : ''} ${s.direction}${s.kind === 'flex' && s.baselineAligned ? ', baseline-aligned items' : ''}; ${s.items} items on ${s.lines} line${s.lines === 1 ? '' : 's'})`);
for (const r of refused) console.log(`  refused ${r.source.id}: ${r.code} (${r.detail})`);

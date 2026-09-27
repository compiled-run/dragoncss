// Writes the profile-granularity fixtures of T005 recommendation 1 (notes/T036-s4a-review-s4b-plan.md) and their committed
// selection, packages/parity/generated/granularity-selection.json:
//   G1 profile-initial-values-box.html and profile-initial-values-text.html: every longhand whose value subset contains its webref
//      initial value (display: block from the captured UA data), authored in every context its role allows;
//   G2 gap-contexts.html: gap, row-gap and column-gap in px (non-zero and 0px) in every flex line mode;
//   G3 color-syntax-matrix.html: every accepted colour syntax on every colour longhand.
// A value belongs to a longhand's value subset when a document authoring it compiles with no diagnostic and ready ios and web
// outputs (profiles derived, not enforced, so no profile row decides it). Every fixture runs in both environment directions.
// Run with: node scripts/gen-granularity-fixtures.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectWith, LONGHANDS, NO_FAULTS, PROPERTY_ROLE } from '../packages/dragon/src/internal.ts';
import type { Longhand } from '../packages/dragon/src/internal.ts';
import { properties as grammar } from '../packages/dragon/src/css/grammar.generated.ts';
import { computed as ua } from '../packages/dragon/src/ua/chrome-145.generated.ts';
import { fixtureToInput, PROJECT_ID } from '../packages/parity/src/fixture-reader.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';

function page(css: readonly string[], body: readonly string[]): string {
  return ['<!DOCTYPE html>', '<html data-dragon-id="html">', '<head>', '<style>', FONT, ...css, '</style>', '</head>', '<body data-dragon-id="body">', ...body, '</body>', '</html>', ''].join('\n');
}

/** Whether a declaration compiles on a div holding text, with no diagnostic and ready outputs; otherwise the first reason. */
function compiles(declaration: string): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const html = page([`.x { ${declaration} }`], ['<div data-dragon-id="x" class="x">XX</div>']);
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });
  const c = project.compile(fixtureToInput('granularity-probe', html));
  if (c.diagnostics.length > 0) return { ok: false, reason: `${c.diagnostics[0]?.code}: ${c.diagnostics[0]?.message}` };
  if (c.outputs.ios.kind === 'blocked' || c.outputs.web.kind !== 'ready') return { ok: false, reason: 'an output is blocked' };
  return { ok: true };
}

// ---- G1 selection ----

type Role = 'item' | 'container' | 'text' | 'paint';
const CONTEXTS: { readonly [R in Role]: readonly string[] } = {
  item: ['block', 'flex-row', 'flex-column'],
  container: ['not-flex-container', 'flex-row-single-line', 'flex-row-multi-line', 'flex-column-single-line', 'flex-column-multi-line'],
  text: ['text-in-block', 'text-in-anonymous-block', 'text-in-flex-item/row', 'text-in-flex-item/column', 'text-as-anonymous-flex-item/row', 'text-as-anonymous-flex-item/column'],
  paint: ['paint'],
};

/** Values T036 requires beside the initial values: justify-content flex-start and align-items stretch. */
const REQUIRED_EXTRA: readonly { readonly longhand: Longhand; readonly value: string }[] = [
  { longhand: 'justify-content', value: 'flex-start' },
  { longhand: 'align-items', value: 'stretch' },
];

/** A container context whose defining declarations the tested value would override, so the value cannot be authored there. */
function contradicts(longhand: Longhand, value: string, context: string): boolean {
  if (longhand === 'flex-direction' && value === 'row') return context.startsWith('flex-column');
  if (longhand === 'flex-wrap' && value === 'nowrap') return context.endsWith('multi-line');
  return false;
}

type Entry = { readonly longhand: Longhand; readonly value: string; readonly source: 'webref initial' | 'captured UA display' | 'T036 required'; readonly role: Role; readonly contexts: readonly string[]; readonly unbuildable: readonly string[] };

const g1: Entry[] = [];
const g1Rejected: { readonly longhand: Longhand; readonly value: string; readonly reason: string }[] = [];
const candidates: { longhand: Longhand; value: string; source: Entry['source'] }[] = [];
for (const p of LONGHANDS) {
  if (p === 'display') candidates.push({ longhand: p, value: ua.div['display'] as string, source: 'captured UA display' });
  else candidates.push({ longhand: p, value: (grammar[p] as { initial: string }).initial, source: 'webref initial' });
}
for (const e of REQUIRED_EXTRA) candidates.push({ ...e, source: 'T036 required' });
for (const c of candidates) {
  const r = compiles(`${c.longhand}: ${c.value};`);
  if (!r.ok) {
    g1Rejected.push({ longhand: c.longhand, value: c.value, reason: r.reason });
    continue;
  }
  const role = PROPERTY_ROLE[c.longhand] as Role;
  const contexts = CONTEXTS[role].filter((ctx) => !contradicts(c.longhand, c.value, ctx));
  const unbuildable = CONTEXTS[role].filter((ctx) => contradicts(c.longhand, c.value, ctx)).map((ctx) => `${ctx} (the value overrides the context's own declaration)`);
  // direction is a container property keyed by the element's own direction, so an authored ltr can never make an rtl facet.
  const facet = c.longhand === 'direction' ? [`every */rtl facet (direction: ${c.value} sets the facet itself)`] : [];
  g1.push({ longhand: c.longhand, value: c.value, source: c.source, role, contexts, unbuildable: [...unbuildable, ...facet] });
}

// ---- G1 fixtures ----

const boxCss: string[] = [
  '.p-block { width: 100px; }',
  '.p-row { display: flex; width: 100px; }',
  '.p-col { display: flex; flex-direction: column; width: 100px; }',
  '.k-nfc { width: 50px; }',
  '.k-frs { display: flex; width: 50px; }',
  '.k-frm { display: flex; flex-wrap: wrap; width: 50px; }',
  '.k-fcs { display: flex; flex-direction: column; width: 50px; }',
  '.k-fcm { display: flex; flex-direction: column; flex-wrap: wrap; width: 50px; height: 12px; }',
  '.it { width: 20px; height: 5px; }',
];
const textCss: string[] = [
  '.p-row { display: flex; width: 100px; }',
  '.p-col { display: flex; flex-direction: column; width: 100px; }',
  '.w30 { width: 30px; }',
  '.a-row { display: flex; width: 30px; }',
  '.a-col { display: flex; flex-direction: column; width: 30px; }',
  '.kid { height: 2px; }',
];
const itemBody: { [ctx: string]: string[] } = { block: [], 'flex-row': [], 'flex-column': [] };
const containerBody: string[] = [];
const paintBody: string[] = [];
const textBody: string[] = [];
const K: { readonly [ctx: string]: string } = { 'not-flex-container': 'k-nfc', 'flex-row-single-line': 'k-frs', 'flex-row-multi-line': 'k-frm', 'flex-column-single-line': 'k-fcs', 'flex-column-multi-line': 'k-fcm' };
g1.forEach((e, n) => {
  const cls = `v${n}`;
  const rule = `.${cls} { ${e.longhand}: ${e.value}; }`;
  if (e.role === 'text') textCss.push(rule);
  else boxCss.push(rule);
  for (const ctx of e.contexts) {
    if (e.role === 'item') (itemBody[ctx] as string[]).push(`<div data-dragon-id="i${n}-${ctx}" class="${cls}"></div>`);
    else if (e.role === 'paint') paintBody.push(`<div data-dragon-id="c${n}" class="${cls}"></div>`);
    else if (e.role === 'container') {
      const id = `k${n}-${K[ctx]}`;
      containerBody.push(`<div data-dragon-id="${id}" class="${K[ctx]} ${cls}"><div data-dragon-id="${id}-a" class="it"></div><div data-dragon-id="${id}-b" class="it"></div><div data-dragon-id="${id}-c" class="it"></div></div>`);
    } else {
      const id = `t${n}-${ctx.replace('/', '-')}`;
      const txt = 'XX XX XX';
      if (ctx === 'text-in-block') textBody.push(`<div data-dragon-id="${id}" class="w30 ${cls}">${txt}</div>`);
      else if (ctx === 'text-in-anonymous-block') textBody.push(`<div data-dragon-id="${id}" class="w30 ${cls}">${txt}<div data-dragon-id="${id}-k" class="kid"></div></div>`);
      else if (ctx === 'text-in-flex-item/row') textBody.push(`<div data-dragon-id="${id}-p" class="p-row"><div data-dragon-id="${id}" class="w30 ${cls}">${txt}</div></div>`);
      else if (ctx === 'text-in-flex-item/column') textBody.push(`<div data-dragon-id="${id}-p" class="p-col"><div data-dragon-id="${id}" class="w30 ${cls}">${txt}</div></div>`);
      else if (ctx === 'text-as-anonymous-flex-item/row') textBody.push(`<div data-dragon-id="${id}" class="a-row ${cls}">${txt}</div>`);
      else textBody.push(`<div data-dragon-id="${id}" class="a-col ${cls}">${txt}</div>`);
    }
  }
});
const boxHtml = page(boxCss, [
  `<div data-dragon-id="pb" class="p-block">${itemBody['block']?.join('') ?? ''}</div>`,
  `<div data-dragon-id="pr" class="p-row">${itemBody['flex-row']?.join('') ?? ''}</div>`,
  `<div data-dragon-id="pc" class="p-col">${itemBody['flex-column']?.join('') ?? ''}</div>`,
  ...containerBody,
  ...paintBody,
]);
const textHtml = page(textCss, textBody);

// ---- G2 gap contexts ----

const GAP_DECLARATIONS: readonly string[] = ['gap: 7px', 'gap: 0px', 'row-gap: 5px', 'row-gap: 0px', 'column-gap: 6px', 'column-gap: 0px'];
const GAP_CONTAINERS: readonly { readonly id: string; readonly context: string; readonly css: string }[] = [
  { id: 'rs', context: 'flex-row-single-line', css: 'display: flex; width: 100px;' },
  { id: 'rm', context: 'flex-row-multi-line', css: 'display: flex; flex-wrap: wrap; width: 50px;' },
  { id: 'cs', context: 'flex-column-single-line', css: 'display: flex; flex-direction: column; width: 50px;' },
  { id: 'cm', context: 'flex-column-multi-line', css: 'display: flex; flex-direction: column; flex-wrap: wrap; width: 90px; height: 25px;' },
];
const gapCss = [...GAP_CONTAINERS.map((c) => `.${c.id} { ${c.css} }`), '.gi { width: 20px; height: 10px; }', ...GAP_DECLARATIONS.map((d, i) => `.g${i} { ${d}; }`)];
const gapBody: string[] = [];
for (const c of GAP_CONTAINERS) {
  GAP_DECLARATIONS.forEach((_, i) => {
    const id = `${c.id}${i}`;
    gapBody.push(`<div data-dragon-id="${id}" class="${c.id} g${i}"><div data-dragon-id="${id}-a" class="gi"></div><div data-dragon-id="${id}-b" class="gi"></div><div data-dragon-id="${id}-c" class="gi"></div></div>`);
  });
}
const gapHtml = page(gapCss, gapBody);

// ---- G3 colour matrix ----

const COLOUR_LONGHANDS = LONGHANDS.filter((p) => PROPERTY_ROLE[p] === 'paint');
/** One accepted sample per colour syntax, from color-syntax.html where one exists there. */
const SYNTAXES: readonly { readonly id: string; readonly value: string }[] = [
  { id: 'hex3', value: '#abc' },
  { id: 'hex4', value: '#0f08' },
  { id: 'hex6', value: '#a1b2c3' },
  { id: 'hex8', value: '#102030e6' },
  { id: 'rgb', value: 'rgb(10.4, 20.6, 30.5)' },
  { id: 'rgba', value: 'rgba(1, 2, 3, 0.3)' },
  { id: 'hsl', value: 'hsl(6, 50%, 50%)' },
  { id: 'hsla', value: 'hsla(300, 100%, 25%, 0.5)' },
  { id: 'named', value: 'tomato' },
  { id: 'transparent', value: 'transparent' },
  { id: 'currentcolor', value: 'currentcolor' },
  { id: 'inherit', value: 'inherit' },
  { id: 'initial', value: 'initial' },
];
const g3: { readonly longhand: Longhand; readonly syntax: string; readonly value: string }[] = [];
const g3Rejected: { readonly longhand: Longhand; readonly syntax: string; readonly value: string; readonly reason: string }[] = [];
for (const p of COLOUR_LONGHANDS) {
  for (const s of SYNTAXES) {
    const r = compiles(`${p}: ${s.value};`);
    if (r.ok) g3.push({ longhand: p, syntax: s.id, value: s.value });
    else g3Rejected.push({ longhand: p, syntax: s.id, value: s.value, reason: r.reason });
  }
}
const colourCss = ['.cp { color: #123456; background-color: #abcdef; }', '.cs { width: 20px; height: 6px; }', ...g3.map((e, i) => `.m${i} { ${e.longhand}: ${e.value}; }`)];
const colourHtml = page(colourCss, [`<div data-dragon-id="cp" class="cp">${g3.map((e, i) => `<div data-dragon-id="${e.longhand}-${e.syntax}" class="cs m${i}"></div>`).join('')}</div>`]);

// ---- write ----

const FIXTURES = ['profile-initial-values-box', 'profile-initial-values-text', 'gap-contexts', 'color-syntax-matrix'] as const;
const selection = {
  generator: 'scripts/gen-granularity-fixtures.ts',
  rule: 'T005 recommendation 1 by proof (notes/T036-s4a-review-s4b-plan.md): fixtures are generated from this selection, every generated fixture must pass or be reported, and none is removed after running.',
  environments: ['ltr', 'rtl'],
  fixtures: FIXTURES,
  g1: {
    fixtures: ['profile-initial-values-box', 'profile-initial-values-text'],
    selected: g1,
    rejected: g1Rejected,
    notBuilt: ['root and display-none item contexts: the generator authors values only in the contexts the role allows'],
  },
  g2: { fixture: 'gap-contexts', declarations: GAP_DECLARATIONS, contexts: GAP_CONTAINERS.map((c) => c.context), itemsPerContainer: 3 },
  g3: { fixture: 'color-syntax-matrix', longhands: COLOUR_LONGHANDS, syntaxes: SYNTAXES, selected: g3, rejected: g3Rejected },
};
const fixtureDir = join(root, 'packages', 'parity', 'fixtures');
mkdirSync(join(root, 'packages', 'parity', 'generated'), { recursive: true });
writeFileSync(join(root, 'packages', 'parity', 'generated', 'granularity-selection.json'), `${JSON.stringify(selection, null, 2)}\n`);
writeFileSync(join(fixtureDir, 'profile-initial-values-box.html'), boxHtml);
writeFileSync(join(fixtureDir, 'profile-initial-values-text.html'), textHtml);
writeFileSync(join(fixtureDir, 'gap-contexts.html'), gapHtml);
writeFileSync(join(fixtureDir, 'color-syntax-matrix.html'), colourHtml);
console.log(`G1: ${g1.length} values selected, ${g1Rejected.length} rejected; G2: ${GAP_DECLARATIONS.length * GAP_CONTAINERS.length} containers; G3: ${g3.length} colour declarations, ${g3Rejected.length} rejected`);
for (const r of g1Rejected) console.log(`  G1 rejected ${r.longhand}: ${r.value} (${r.reason})`);
for (const r of g3Rejected) console.log(`  G3 rejected ${r.longhand}: ${r.value} (${r.reason})`);

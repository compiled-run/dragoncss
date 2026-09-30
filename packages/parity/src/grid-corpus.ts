// The G-P differential test (GRID G1a): every case of the frozen Chrome 145 grid corpus (docs/research/grid-spike/probe) compiled
// through Dragon, laid out by the engine and compared with Chrome's boxes exactly, in raw LayoutUnits of the zoomed layout. Only the
// horizontal-tb environments run until the writing-mode packages; a case Dragon refuses is recorded with its reason, never compared.
import { readdirSync, readFileSync } from 'node:fs';
import type { EngineFaults, GridFaults, LayoutRect } from '@dragon/layout';
import { absoluteRects, layoutWithGridFaults, measurerFor, NO_ENGINE_FAULTS, validateLayoutInput } from '@dragon/layout';
import type { Environment } from 'dragon';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from 'dragon';
import { fixtureToInput, PROJECT_ID } from './fixture-reader.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';

export const GRID_CORPUS_DIR = 'docs/research/grid-spike/probe';

type Rect = readonly [number, number, number, number];
type Result = { readonly c: Rect; readonly cols: string; readonly rows: string; readonly items: readonly Rect[] };
export type CorpusCase = {
  readonly family: string;
  readonly id: string;
  readonly note: string;
  readonly cb: readonly [number, number];
  readonly html: string;
  readonly labels: readonly string[];
  readonly after: string | null;
  /** Chrome's result for each environment name. */
  readonly results: ReadonlyMap<string, Result>;
};

/** An environment the engine runs: horizontal-tb only (the corpus also records vertical-rl and vertical-lr). */
export type CorpusEnv = { readonly name: string; readonly dpr: number; readonly direction: 'ltr' | 'rtl' };

const ENV_NAME = /^dpr([0-9.]+)-(ltr|rtl)-(horizontal-tb|vertical-rl|vertical-lr)$/;

type CorpusFile = {
  readonly envs: readonly string[];
  readonly cases: { readonly [id: string]: { readonly note: string; readonly cb: readonly [number, number]; readonly html: string; readonly labels: readonly string[]; readonly after?: string; readonly env: readonly number[]; readonly distinct: readonly Result[] } };
};

const isRect = (r: unknown): r is Rect => Array.isArray(r) && r.length === 4 && r.every((n) => Number.isInteger(n));

/** Parses and checks one corpus file: every environment maps to a result with a container box and one box per label. */
export function parseCorpusFamily(family: string, text: string): CorpusCase[] {
  const j = JSON.parse(text) as CorpusFile;
  if (!Array.isArray(j.envs) || j.envs.length === 0 || !j.envs.every((e) => typeof e === 'string' && ENV_NAME.test(e))) throw new Error(`${family}: bad envs`);
  if (new Set(j.envs).size !== j.envs.length) throw new Error(`${family}: duplicate envs`);
  const horizontal = new Set(HORIZONTAL_ENVS.map((e) => e.name));
  const unknown = j.envs.filter((e) => e.endsWith('-horizontal-tb') && !horizontal.has(e));
  if (unknown.length > 0) throw new Error(`${family}: horizontal-tb environments the test does not run: ${unknown.join(', ')}`);
  if (typeof j.cases !== 'object' || j.cases === null) throw new Error(`${family}: no cases`);
  return Object.entries(j.cases).map(([id, c]) => {
    if (typeof c.html !== 'string' || !Array.isArray(c.labels) || !c.labels.every((l) => typeof l === 'string') || !Array.isArray(c.env) || c.env.length !== j.envs.length || !Array.isArray(c.distinct)) throw new Error(`${family} ${id}: malformed case`);
    if (!Array.isArray(c.cb) || c.cb.length !== 2 || !c.cb.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) throw new Error(`${family} ${id}: bad wrapper size`);
    if (c.after !== undefined && typeof c.after !== 'string') throw new Error(`${family} ${id}: after is not a string`);
    const results = new Map<string, Result>();
    j.envs.forEach((name, e) => {
      const r = c.distinct[c.env[e] as number];
      if (r === undefined || !isRect(r.c) || !Array.isArray(r.items) || r.items.length !== c.labels.length || !r.items.every(isRect) || typeof r.cols !== 'string' || typeof r.rows !== 'string') throw new Error(`${family} ${id}: environment ${name} has no complete result`);
      results.set(name, r);
    });
    return { family, id, note: c.note, cb: c.cb, html: c.html, labels: c.labels, after: c.after ?? null, results };
  });
}

/** Every corpus case, file by file in name order. */
export function readGridCorpus(): CorpusCase[] {
  const files = readdirSync(repoPath(GRID_CORPUS_DIR)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`no corpus files in ${GRID_CORPUS_DIR}`);
  return files.flatMap((f) => parseCorpusFamily(f.replace(/\.json$/, ''), readFileSync(repoPath(`${GRID_CORPUS_DIR}/${f}`), 'utf8')));
}

export const HORIZONTAL_ENVS: readonly CorpusEnv[] = [1, 2, 3, 2.625].flatMap((dpr) => (['ltr', 'rtl'] as const).map((direction) => ({ name: `dpr${dpr}-${direction}-horizontal-tb`, dpr, direction })));

type Element = { readonly id: string; readonly cls: string; readonly style: string; readonly label: string | null; readonly children: (Element | string)[] };

/** Parses the corpus's own markup: nested <div> and <span> elements with class, style and data-i attributes, and text. */
function parseCaseHtml(html: string): Element {
  const root: Element = { id: 'cb', cls: 'cb', style: '', label: null, children: [] };
  const stack: Element[] = [root];
  const tag = /<(\/?)(div|span)((?:\s+[a-z-]+="[^"]*")*)\s*>/gy;
  let at = 0;
  let n = 0;
  while (at < html.length) {
    tag.lastIndex = at;
    const m = tag.exec(html);
    const top = stack[stack.length - 1] as Element;
    if (m === null) {
      const next = html.indexOf('<', at);
      const end = next < 0 ? html.length : next;
      if (end === at) throw new Error(`unparsed markup at ${at}: ${html.slice(at, at + 40)}`);
      top.children.push(html.slice(at, end).replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
      at = end;
      continue;
    }
    at = tag.lastIndex;
    if (m[1] === '/') {
      if (stack.length <= 1) throw new Error('unbalanced markup');
      stack.pop();
      continue;
    }
    const attrs = new Map<string, string>();
    for (const a of (m[3] as string).matchAll(/([a-z-]+)="([^"]*)"/g)) attrs.set(a[1] as string, (a[2] as string).replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const el: Element = { id: `e${n++}`, cls: attrs.get('class') ?? '', style: attrs.get('style') ?? '', label: attrs.get('data-i') ?? null, children: [] };
    top.children.push(el);
    stack.push(el);
  }
  if (stack.length !== 1) throw new Error('unbalanced markup');
  return root;
}

/**
 * A parity-fixture document for a case: the wrapper as a fixed-size block at the page origin (the corpus places it absolutely at
 * the origin; both put its border box at 0,0), each element's inline style moved to a rule of its own class.
 */
export function caseDocument(c: CorpusCase): { readonly html: string; readonly ids: ReadonlyMap<string, string> } {
  const root = parseCaseHtml(c.html);
  const rules: string[] = ['body { margin: 0; }', `.cb { font-size: 10px; line-height: 1; inline-size: ${c.cb[0]}px; block-size: ${c.cb[1]}px; }`];
  const ids = new Map<string, string>();
  const render = (el: Element): string => {
    if (el.label !== null) ids.set(el.label, el.id);
    if (el.style !== '') rules.push(`.${el.id} { ${el.style}; }`);
    const cls = el === root ? 'cb' : el.style === '' ? '' : el.id;
    const body = el.children.map((k) => (typeof k === 'string' ? k : render(k))).join('');
    return `<div data-dragon-id="${el.id}"${cls === '' ? '' : ` class="${cls}"`}>${body}</div>`;
  };
  const markup = render(root);
  const html = `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n<style>\n${rules.join('\n')}\n</style>\n</head>\n<body data-dragon-id="body">${markup}</body>\n</html>\n`;
  return { html, ids };
}

export type EnvOutcome =
  | { readonly kind: 'match' }
  | { readonly kind: 'mismatch'; readonly detail: string }
  | { readonly kind: 'refused'; readonly reasons: readonly string[] };

export type CaseOutcome = { readonly id: string; readonly family: string; readonly envs: ReadonlyMap<string, EnvOutcome> };

function referenceMeasurer() {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  return m.measurer;
}

/** A diagnostic code and its message head, as a refusal reason. */
const refusal = (code: string, message: string): string => `${code}: ${message.replace(/ on [^ ]+$/, '').slice(0, 160)}`;

/** Compiles one case per direction and compares the engine with Chrome in every horizontal-tb environment. */
export function runGridCase(c: CorpusCase, gridFaults: GridFaults, envs: readonly CorpusEnv[] = HORIZONTAL_ENVS, engineFaults: EngineFaults = NO_ENGINE_FAULTS): CaseOutcome {
  const out = new Map<string, EnvOutcome>();
  if (c.after !== null) {
    for (const e of envs) out.set(e.name, { kind: 'refused', reasons: ['inline-level grid baseline beside text (G3)'] });
    return { id: c.id, family: c.family, envs: out };
  }
  const doc = caseDocument(c);
  const measurer = referenceMeasurer();
  for (const direction of ['ltr', 'rtl'] as const) {
    const own = envs.filter((e) => e.direction === direction);
    if (own.length === 0) continue;
    const input = fixtureToInput(`grid-corpus-${c.id}`, doc.html);
    const project = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: 'ahem' });
    const compiled = project.compile(input);
    const blocking = compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => refusal(d.code, d.message));
    for (const e of own) {
      if (blocking.length > 0) {
        out.set(e.name, { kind: 'refused', reasons: blocking });
        continue;
      }
      const env: Environment = { viewport: { width: 800, height: 600 }, devicePixelRatio: e.dpr, direction, rootFont: 'ahem' };
      const projection = iosLayoutProjection(compiled, env, []);
      if (projection.kind === 'blocked') {
        out.set(e.name, { kind: 'refused', reasons: [`projection blocked: ${projection.reason}`] });
        continue;
      }
      const validated = validateLayoutInput(JSON.parse(JSON.stringify(projection.input)));
      if (!validated.ok) {
        out.set(e.name, { kind: 'mismatch', detail: `layout input rejected: ${validated.errors.map((x) => `${x.path} ${x.code}`).join('; ')}` });
        continue;
      }
      const r = layoutWithGridFaults(validated.input, measurer, engineFaults, gridFaults);
      if (r.kind === 'unsupported') {
        out.set(e.name, { kind: 'refused', reasons: [`LayoutUnsupported ${r.unsupported.code}: ${r.unsupported.detail}`] });
        continue;
      }
      out.set(e.name, compareCase(c, doc.ids, absoluteRects(r.boxes), e));
    }
  }
  return { id: c.id, family: c.family, envs: out };
}

/** Chrome's logical box as a physical LU rect: in rtl the inline start is measured from the outer box's right edge. */
function physical(r: Rect, outerWidth: number, direction: 'ltr' | 'rtl'): Rect {
  const [i, b, w, h] = r;
  return [direction === 'ltr' ? i : outerWidth - i - w, b, w, h];
}

function compareCase(c: CorpusCase, ids: ReadonlyMap<string, string>, abs: ReadonlyMap<string, LayoutRect>, e: CorpusEnv): EnvOutcome {
  const chrome = c.results.get(e.name);
  if (chrome === undefined) return { kind: 'mismatch', detail: `the corpus has no result for ${e.name}` };
  const wrapper = abs.get('cb');
  const grid = abs.get('e0');
  if (wrapper === undefined || grid === undefined) return { kind: 'mismatch', detail: 'Dragon laid out no wrapper or grid box' };
  const problems: string[] = [];
  const check = (what: string, want: Rect, got: Rect): void => {
    if (want.some((v, k) => v !== got[k])) problems.push(`${what}: Chrome [${want.join(', ')}], Dragon [${got.join(', ')}]`);
  };
  const cbWidth = wrapper.width;
  check('container', physical(chrome.c, cbWidth, e.direction), [grid.x - wrapper.x, grid.y - wrapper.y, grid.width, grid.height]);
  c.labels.forEach((label, k) => {
    const id = ids.get(label);
    const box = id === undefined ? undefined : abs.get(id);
    if (box === undefined) {
      problems.push(`${label}: Dragon has no box`);
      return;
    }
    check(label, physical(chrome.items[k] as Rect, grid.width, e.direction), [box.x - grid.x, box.y - grid.y, box.width, box.height]);
  });
  return problems.length === 0 ? { kind: 'match' } : { kind: 'mismatch', detail: problems.join('; ') };
}

// ---- The pinned expectations of the differential test ------------------------------------------------------------------------

/**
 * Why a case is refused, by the package that will lay it out. A refusal outside these is a failure: G1a claims every other case.
 * Each pattern matches the refusal reasons runGridCase records.
 */
export const REFUSAL_CATEGORIES: readonly { readonly id: string; readonly owner: string; readonly pattern: RegExp }[] = [
  { id: 'inline-grid', owner: 'G-INL (after INL2): inline-level grid containers', pattern: /display: inline-grid|inline-level grid baseline/ },
  { id: 'baseline-alignment', owner: 'G3: baseline self-alignment', pattern: /grid-baseline|justify-(self|items): (last )?baseline|align-(self|items): last baseline/ },
  { id: 'auto-repeat', owner: 'G2: repeat(auto-fill) and repeat(auto-fit)', pattern: /repeat\(auto-fill\) and repeat\(auto-fit\)/ },
  { id: 'abspos-item', owner: 'G4: absolutely positioned grid items', pattern: /grid-abspos/ },
  { id: 'subgrid', owner: 'G5: subgrid', pattern: /subgrid/ },
  { id: 'writing-mode', owner: 'G-WM: vertical writing modes', pattern: /writing-mode/ },
  { id: 'sizing-keyword', owner: 'SIZE: min-content, max-content and fit-content as width', pattern: /width: (min-content|max-content|fit-content)/ },
  { id: 'safe-alignment', owner: 'ALGN: safe and unsafe alignment keywords, anchor-center', pattern: /"(un)?safe center"|safe center|anchor-center/ },
  { id: 'overflow-auto', owner: 'scroll containers other than overflow: hidden', pattern: /overflow-x: auto/ },
  { id: 'float', owner: 'FLT: floats', pattern: /float is not supported/ },
  { id: 'aspect-ratio', owner: 'SIZE-ar: aspect-ratio', pattern: /aspect-ratio is not supported/ },
  { id: 'calc', owner: 'V1: math functions in the engine value model', pattern: /calc\(\) is a css-values-4 math function/ },
  { id: 'contain', owner: 'size containment (contain: size)', pattern: /contain is not supported/ },
];

/**
 * Environments where the engine and Chrome differ outside grid.ts: 7.5px Ahem at DPR 2.625 in a 98.390625px (6297 LU) line. Chrome
 * fits a 98.4px run (6298 LU) there because its line breaker compares against AvailableWidthToFit, the width plus
 * LayoutUnit::Epsilon (line_breaker.h:308); inline.ts breakLines has no epsilon (linefit.ts, the INL line breaker, has it). Each
 * detail is pinned so a fix or any other change shows.
 */
export const KNOWN_MISMATCHES: ReadonlyMap<string, string> = new Map([
  ['random-01/rnd-0313 dpr2.625-ltr-horizontal-tb', 'i5: Chrome [8404, 632, 6297, 2520], Dragon [8404, 632, 6297, 3780]'],
  ['random-01/rnd-0313 dpr2.625-rtl-horizontal-tb', 'i5: Chrome [3363, 632, 6297, 2520], Dragon [3363, 632, 6297, 3780]'],
  ['random-06/rnd-1606 dpr2.625-ltr-horizontal-tb', 'container: Chrome [0, 0, 18064, 10588], Dragon [0, 0, 18064, 11008]; i0: Chrome [-2155, 4832, 6297, 2520], Dragon [-2155, 4412, 6297, 3780]; i1: Chrome [-7749, 7772, 3914, 2184], Dragon [-7749, 8192, 3914, 2184]; i4: Chrome [9604, 4412, 3914, 3360], Dragon [9604, 4622, 3914, 3360]; i5: Chrome [13518, 2522, 3914, 3360], Dragon [13518, 2732, 3914, 3360]'],
  ['random-06/rnd-1606 dpr2.625-rtl-horizontal-tb', 'container: Chrome [32336, 0, 18064, 10588], Dragon [32336, 0, 18064, 11008]; i0: Chrome [13922, 4832, 6297, 2520], Dragon [13922, 4412, 6297, 3780]; i1: Chrome [21899, 7772, 3914, 2184], Dragon [21899, 8192, 3914, 2184]; i4: Chrome [4546, 4412, 3914, 3360], Dragon [4546, 4622, 3914, 3360]; i5: Chrome [632, 2522, 3914, 3360], Dragon [632, 2732, 3914, 3360]'],
  ['random-07/rnd-1834 dpr2.625-ltr-horizontal-tb', 'i5: Chrome [10210, 9850, 5038, 2520], Dragon [10210, 9850, 5038, 3780]'],
  ['random-07/rnd-1834 dpr2.625-rtl-horizontal-tb', 'i5: Chrome [632, 9850, 5038, 2520], Dragon [632, 9850, 5038, 3780]'],
]);

/**
 * Each grid plant of docs/research/grid-spike/blink-notes.md in G1a's scope, with a corpus case that must catch it in item or
 * container boxes. fr-restart shows frRestartMissing only in getComputedStyle track sizes, which this test does not compare.
 */
export const GRID_PLANTS: readonly { readonly fault: keyof GridFaults | 'ignoreOrder'; readonly kase: string }[] = [
  { fault: 'denseAsSparse', kase: 'p-dense' },
  { fault: 'sparseRewinds', kase: 'p-sparse-cursor' },
  { fault: 'implicitForward', kase: 'p-implicit-before' },
  { fault: 'ignoreOrder', kase: 'p-order' },
  { fault: 'shareRounded', kase: 's-share-seven' },
  // s-gutter-in-span, s-weighted-flex-span and s-span-grouping show these only in getComputedStyle track sizes.
  { fault: 'gutterNotInSpan', kase: 'rnd-0009' },
  { fault: 'flexSpanEqual', kase: 'rnd-1415' },
  { fault: 'spanGroupingFlat', kase: 'rnd-0081' },
  { fault: 'maximizeIgnoresLimit', kase: 's-maximize-limits' },
  { fault: 'flexSumBelowOne', kase: 'fr-sum-below-one' },
  { fault: 'frRestartMissing', kase: 'rnd-0207' },
  { fault: 'frFloat64', kase: 's-fr-three-sets' },
  { fault: 'frLeftoverDropped', kase: 's-fr-seven' },
  { fault: 'autoMinNotClamped', kase: 'm-auto-min-clamp' },
  { fault: 'fitContentAsAuto', kase: 'm-fit-content' },
  { fault: 'stretchIgnoresAlignment', kase: 'a-jc-start' },
  { fault: 'stretchIgnoresMinSize', kase: 'i-stretch-min-indefinite' },
  { fault: 'percentNotReresolved', kase: 'g-pct-rows-indefinite' },
  { fault: 'percentNotReresolved', kase: 'pc-rows-indefinite' },
  { fault: 'distributionRounded', kase: 'a-jc-space-between-4' },
  { fault: 'centerFloors', kase: 'a-center-odd' },
];

/**
 * Chrome deviations in grid layout (blink-notes.md "Suspected deviations"): the engine follows Chrome, and a spec-reading plant must
 * make every registered case differ from Chrome. grid-max-content-auto-min (inline-grid and float cases) and
 * grid-default-self-overflow-unsafe (overflow: auto scrollers) are captured in the corpus, but G1a refuses their contexts.
 */
export const GRID_DEVIATIONS: readonly { readonly id: string; readonly spec: string; readonly blink: string; readonly fault: keyof GridFaults; readonly cases: readonly string[] }[] = [
  {
    id: 'grid-maximize-no-max-redo',
    spec: 'css-grid-2 §12.6: if maximizing would make the grid larger than the container as limited by its max-width/height, redo the step with the free space that limit leaves.',
    blink: 'third_party/blink/renderer/core/layout/grid/grid_track_sizing_algorithm.cc:1024 at 145.0.7632.6: a TODO; MaximizeTracks fills every set to its growth limit under an indefinite block size, and the GR15 extra pass does not fire for rows that do not depend on the available size.',
    fault: 'maximizeRedoSpec',
    cases: ['i-maximize-max-block'],
  },
];

export type Classified = { readonly kind: 'match' } | { readonly kind: 'known' } | { readonly kind: 'refused'; readonly category: string } | { readonly kind: 'problem'; readonly detail: string };

/**
 * One environment's outcome judged against the pinned expectations: a match, a pinned mismatch with its exact detail, or a refusal
 * whose every reason an out-of-scope package owns (counted under the first reason's category); anything else is a problem.
 */
export function classifyOutcome(key: string, r: EnvOutcome): Classified {
  if (r.kind === 'match') return KNOWN_MISMATCHES.has(key) ? { kind: 'problem', detail: `${key}: a pinned mismatch now matches; remove it from KNOWN_MISMATCHES` } : { kind: 'match' };
  if (r.kind === 'mismatch') {
    const pinned = KNOWN_MISMATCHES.get(key);
    if (pinned === undefined) return { kind: 'problem', detail: `${key}: ${r.detail}` };
    return pinned === r.detail ? { kind: 'known' } : { kind: 'problem', detail: `${key}: the pinned mismatch changed to ${r.detail}` };
  }
  const categories = r.reasons.map((reason) => REFUSAL_CATEGORIES.find((k) => k.pattern.test(reason)));
  const unowned = r.reasons.filter((_, i) => categories[i] === undefined);
  const first = categories[0];
  if (unowned.length > 0 || first === undefined) return { kind: 'problem', detail: `${key}: refused for a reason no out-of-scope package owns: ${(unowned.length > 0 ? unowned : r.reasons).join(' | ') || '(no reason)'}` };
  return { kind: 'refused', category: first.id };
}

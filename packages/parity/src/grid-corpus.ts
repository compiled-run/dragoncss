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
/** a: in a case with after text, the text run's box within the container border box (the line box puts it on the grid's baseline). */
type Result = { readonly c: Rect; readonly cols: string; readonly rows: string; readonly items: readonly Rect[]; readonly a?: Rect };
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
      if (c.after !== undefined && !isRect(r.a)) throw new Error(`${family} ${id}: environment ${name} has no box for its after text`);
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
 * the origin; both put its border box at 0,0), each element's inline style moved to a rule of its own class, and a case's after
 * text in the wrapper after the grid.
 */
export function caseDocument(c: CorpusCase): { readonly html: string; readonly ids: ReadonlyMap<string, string> } {
  const root = parseCaseHtml(c.html);
  const rules: string[] = ['body { margin: 0; }', `.cb { font-size: 10px; line-height: 1; inline-size: ${c.cb[0]}px; block-size: ${c.cb[1]}px; }`];
  const ids = new Map<string, string>();
  const render = (el: Element): string => {
    if (el.label !== null) ids.set(el.label, el.id);
    if (el.style !== '') rules.push(`.${el.id} { ${el.style}; }`);
    const cls = el === root ? 'cb' : el.style === '' ? '' : el.id;
    const after = el === root && c.after !== null ? c.after.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '';
    const body = el.children.map((k) => (typeof k === 'string' ? k : render(k))).join('') + after;
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

/**
 * The first element floated in block flow, or null. Dragon lays out no float: the compiler accepts float only where it has no
 * effect (a flex or grid item, an absolutely positioned box), and the support profile refuses it elsewhere as
 * DRAGON_UNPROVEN_CONTEXT (reject-float-block). The corpus compiles with derived profiles, which skip that check, so it refuses here.
 */
function floatInFlow(root: Element): string | null {
  const decl = (style: string, name: string): string | null => {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style);
    return m === null ? null : (m[1] as string).trim();
  };
  const walk = (el: Element, parentLays: boolean): string | null => {
    const float = decl(el.style, 'float');
    const position = decl(el.style, 'position');
    if (float !== null && float !== 'none' && !parentLays && position !== 'absolute' && position !== 'fixed') return `float: ${float} on ${el.id}`;
    const display = decl(el.style, 'display') ?? '';
    const lays = /^(inline-)?(flex|grid)$/.test(display);
    for (const k of el.children) {
      if (typeof k === 'string') continue;
      const r = walk(k, lays);
      if (r !== null) return r;
    }
    return null;
  };
  return walk(root, false);
}

/** A diagnostic code and its message head, as a refusal reason. */
const refusal = (code: string, message: string): string => `${code}: ${message.replace(/ on [^ ]+$/, '').slice(0, 160)}`;

/** Compiles one case per direction and compares the engine with Chrome in every horizontal-tb environment. */
export function runGridCase(c: CorpusCase, gridFaults: GridFaults, envs: readonly CorpusEnv[] = HORIZONTAL_ENVS, engineFaults: EngineFaults = NO_ENGINE_FAULTS): CaseOutcome {
  const out = new Map<string, EnvOutcome>();
  const floated = floatInFlow(parseCaseHtml(c.html));
  if (floated !== null) {
    for (const e of envs) out.set(e.name, { kind: 'refused', reasons: [`float is not supported in block flow (${floated})`] });
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
  if (c.after !== null) {
    // The wrapper's only text, after the grid (caseDocument): its bounding box, as the corpus's Range rect.
    const text = abs.get('cb:text0');
    if (chrome.a === undefined || text === undefined) problems.push('after text: no box to compare');
    else check('after text', physical(chrome.a, grid.width, e.direction), [text.x - grid.x, text.y - grid.y, text.width, text.height]);
  }
  return problems.length === 0 ? { kind: 'match' } : { kind: 'mismatch', detail: problems.join('; ') };
}

// ---- The pinned expectations of the differential test ------------------------------------------------------------------------

/**
 * Why a case is refused, by the package that will lay it out. A refusal outside these is a failure: G1a claims every other case.
 * Each pattern matches the refusal reasons runGridCase records.
 */
export const REFUSAL_CATEGORIES: readonly { readonly id: string; readonly owner: string; readonly pattern: RegExp }[] = [
  // G-INL lays out an inline-grid on its line; in rtl the compiler refuses one at a paragraph edge, which UAX #9 would reorder.
  { id: 'bidi-atomic', owner: 'INL2 bidi: UAX #9 resolution of an atomic inline at a paragraph edge in rtl', pattern: /DRAGON_UNSUPPORTED_BIDI: atomic inline \S+ in the rtl block \S+ has no letter on its (start|end) side/ },
  // G3 and G3b lay out first and last baseline alignment in both axes; the engine refuses only a grid item's last baseline that a
  // flex or grid container or a scroll container inside it would decide (grid.ts lastBaselineOf). No corpus case reaches it.
  { id: 'last-baseline-source', owner: 'G3b follow-up: the last baseline of a flex, grid or scroll container as a grid item\'s last baseline', pattern: /^LayoutUnsupported grid-last-baseline: the last baseline of (flex or grid|scroll) container \S+ would give the last baseline of grid item \S+ \(not yet supported\)$/ },
  { id: 'subgrid', owner: 'G5: subgrid', pattern: /subgrid/ },
  { id: 'writing-mode', owner: 'G-WM: vertical writing modes', pattern: /writing-mode/ },
  { id: 'sizing-keyword', owner: 'SIZE: min-content, max-content and fit-content as width', pattern: /width: (min-content|max-content|fit-content)/ },
  { id: 'safe-alignment', owner: 'ALGN: safe and unsafe alignment keywords, anchor-center', pattern: /"(un)?safe center"|safe center|anchor-center/ },
  { id: 'overflow-auto', owner: 'OVFL-B: native scroll views (overflow auto and scroll on native targets)', pattern: /overflow-[xy] (is|computes to) (auto|scroll)\b[^;]*, a box the user scrolls; \w+ has no native scroll views until OVFL-B/ },
  { id: 'float', owner: 'FLT: floats', pattern: /float is not supported/ },
  { id: 'aspect-ratio', owner: 'SIZE-ar: aspect-ratio', pattern: /aspect-ratio is not supported/ },
  { id: 'calc', owner: 'V1: math functions in the engine value model', pattern: /calc\(\) is a css-values-4 math function/ },
  { id: 'calc-percent-gap', owner: 'CALC-p: a percentage inside a calculated gap (the compiler refuses it in every context)', pattern: /a percentage in this property needs percentage gaps/ },
  { id: 'contain', owner: 'size containment (contain: size)', pattern: /contain is not supported/ },
];

/**
 * Environments where the engine and Chrome differ outside grid.ts, each with its pinned detail so a fix or any other change shows.
 * Empty: the three DPR 2.625 line-fit mismatches #32 pinned (rnd-0313, rnd-1606, rnd-1834) match since inline line breaking
 * took Blink's AvailableWidthToFit epsilon.
 */
export const KNOWN_MISMATCHES: ReadonlyMap<string, string> = new Map<string, string>([]);

/**
 * Each grid plant of docs/research/grid-spike/blink-notes.md in G1a's, G2's and G4's scope, G2's repeatEndNameMissed, G3's and G3b's
 * baseline plants, and the engine plants ignoreOrder and G-INL's inlineGridLastItemBaseline, with a corpus case that must catch it
 * in item or container boxes. fr-restart shows frRestartMissing only in getComputedStyle track sizes, which this test does not
 * compare.
 */
export const GRID_PLANTS: readonly { readonly fault: keyof GridFaults | GridEnginePlant; readonly kase: string }[] = [
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
  // r-fill-frac's quotient 100px / 33.296875px truncates to exactly 3 in LayoutUnits, so a ceil shows only in r-fill-minmax.
  { fault: 'autoFillCountCeil', kase: 'r-fill-minmax' },
  { fault: 'autoFitNotCollapsed', kase: 'r-fit-center' },
  { fault: 'repeatEndNameMissed', kase: 'r-fill-named' },
  { fault: 'absposMidSetEven', kase: 'ab-mid-range' },
  { fault: 'absposEndGutterKept', kase: 'ab-gap' },
  { fault: 'absposBeyondGridClamped', kase: 'ab-beyond-grid' },
  { fault: 'absposAutoLineContentEdge', kase: 'ab-auto-lines' },
  { fault: 'absposStaticAlignIgnored', kase: 'ab-align' },
  { fault: 'baselineShimIgnored', kase: 'b-row-shim' },
  { fault: 'baselineSynthesizedAtTop', kase: 'b-synthesized' },
  // justify-self: baseline in rtl, where the synthesized baseline is each item's left edge and the column shim depends on its width.
  { fault: 'inlineBaselineAtInlineStart', kase: 'rnd-0016' },
  { fault: 'lastBaselineAsFirst', kase: 'b-last' },
  // An inline-grid whose last item's baseline is not its first baseline, so the plant moves it on its line.
  { fault: 'inlineGridLastItemBaseline', kase: 'rnd-0091' },
];

/** The engine faults (not grid faults) GRID_PLANTS plants. */
export type GridEnginePlant = 'ignoreOrder' | 'inlineGridLastItemBaseline';
export const GRID_ENGINE_PLANTS: readonly GridEnginePlant[] = ['ignoreOrder', 'inlineGridLastItemBaseline'];

/**
 * Chrome deviations in grid layout (blink-notes.md "Suspected deviations"): the engine follows Chrome, and a spec-reading plant must
 * make every registered case differ from Chrome. grid-max-content-auto-min is captured in the corpus: its inline-grid case
 * (m-max-content-auto-min) runs since G-INL and matches Chrome, but no spec-reading plant registers it yet, and its float case and
 * grid-default-self-overflow-unsafe (overflow: auto scrollers) stay refused.
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

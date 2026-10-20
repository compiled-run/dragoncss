// T154 slice 2a: the selection documents and the points Chrome is driven at. packages/parity/test/select-model.test.ts proves the
// selection model (packages/layout/src/rt-select.ts) against Chrome at them, and parity:select-vectors writes them, with each
// document's engine input and facts, as the translate corpus's select suite, which Swift and Kotlin must answer as TypeScript does.
import type { Compiled, NativeBackend, NativeProgram } from 'dragon';
import { createProjectWith, nativePrograms, NO_FAULTS, programInput, selectFacts } from 'dragon';
import type { LayoutInput } from '../../layout/src/input.ts';
import type { SelectFacts, SelectTable } from '../../layout/src/rt-select.ts';
import { selectionRefusal, selectionTableOf } from '../../layout/src/rt-select.ts';
import { fixtureToInput } from './fixture-reader.ts';
import { ENVIRONMENT } from './fixtures.ts';
import { referenceMeasurer } from './native-host.ts';

const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; line-height: 20px; } div, p { width: 60px; margin: 0; }';

export type SelectDoc = { readonly id: string; readonly css: string; readonly body: string };

// Text holds no doubled spaces, so a DOM text offset is the leaf's offset after white-space phase I.
export const SELECT_DOCS: readonly SelectDoc[] = [
  // Soft wraps with hanging spaces, a block nested after text (an anonymous wrapper), and a sibling.
  { id: 'nested', css: '', body: '<div data-dragon-id="a">AAAA AAAA AAAA<div data-dragon-id="b">BB BBBB</div></div><div data-dragon-id="d">DDDD</div>' },
  // Gaps: a margin between blocks, padding and a border above a block's line, padding below one, a leading and a trailing space.
  {
    id: 'gaps',
    css: '.a { margin-bottom: 30px; padding-bottom: 10px; } .b { padding-top: 25px; border-top: 5px solid; } .d { margin-top: 10px; }',
    body: '<div data-dragon-id="a" class="a">AAAA AAAA</div><div data-dragon-id="b" class="b">BBBB BB</div><div data-dragon-id="d" class="d"> DDDD DD </div>',
  },
  // Paragraphs add a second line break when left; a block with no text adds nothing.
  {
    id: 'paragraphs',
    css: '.e { height: 20px; }',
    body: '<p data-dragon-id="a">AAAA</p><div data-dragon-id="b">BBBB</div><div data-dragon-id="e" class="e"></div><p data-dragon-id="c">CC CC</p><div data-dragon-id="d">DDDD</div>',
  },
  // Line metrics and offsets: a larger font with normal line height, centred and right-aligned lines, an indent, letter spacing.
  {
    id: 'metrics',
    css: '.a { font-size: 20px; line-height: normal; width: 100px; } .b { text-align: center; } .c { text-align: right; text-indent: 15px; } .d { letter-spacing: 3px; }',
    body: '<div data-dragon-id="a" class="a">AAA AA</div><div data-dragon-id="b" class="b">BB B</div><div data-dragon-id="c" class="c">CCCC CC</div><div data-dragon-id="d" class="d">DDD DD</div>',
  },
  // user-select: none (c undeclared, so auto, used none under b): a press there starts nothing, and a drag into it selects to the next
  // selectable text, or the last when none follows.
  {
    id: 'none',
    css: '.n { user-select: none; }',
    body: '<div data-dragon-id="a">AAAA AAAA</div><div data-dragon-id="b" class="n">BBBB BBBB<div data-dragon-id="c">CC</div></div><div data-dragon-id="d">DD DD</div><div data-dragon-id="e" class="n">EEEE</div>',
  },
];

export const selectHtml = (d: SelectDoc): string => `<!DOCTYPE html><html data-dragon-id="html"><head><style>${BASE} ${d.css}</style></head><body data-dragon-id="body">${d.body}</body></html>`;

/** A document compiled for native: its engine input, its facts and its selection table. */
export type SelectCase = { readonly input: LayoutInput; readonly facts: SelectFacts; readonly table: SelectTable };

function floatsOn(r: { readonly kind: string; readonly cases?: readonly { readonly value: string }[] }): boolean {
  return r.kind === 'found' && (r.cases ?? []).some((c) => c.value !== 'none');
}

/** A document's one native compile: its programs per backend and the compiler's selection facts (slice 2d mounts these on devices). */
export type SelectCompile = { readonly compiled: Compiled<'ios' | 'android'>; readonly programs: { readonly [B in NativeBackend]: NativeProgram }; readonly facts: SelectFacts };

const compiles = new Map<string, SelectCompile>();

export function selectCompile(d: SelectDoc): SelectCompile {
  const key = `${d.id}\0${d.css}\0${d.body}`;
  const known = compiles.get(key);
  if (known !== undefined) return known;
  const project = createProjectWith(
    { projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } },
    { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport },
  );
  const compiled = project.compile(fixtureToInput(`select-${d.id}`, selectHtml(d)));
  const errors = compiled.diagnostics.filter((x) => x.severity === 'error');
  if (errors.length > 0) throw new Error(`${d.id} does not compile: ${errors.map((x) => x.message).join('; ')}`);
  const p = nativePrograms(compiled, []);
  if (p.kind !== 'ready') throw new Error(`${d.id}: no native programs: ${p.reason}`);
  // The compiler's facts: the selection model is proven against Chrome with what the device is given. The program's visibility
  // writes name every box whose used visibility is hidden or collapse (lower/paint/visibility.ts).
  const f = selectFacts(compiled, []);
  if (f === null) throw new Error(`${d.id}: no selection facts`);
  const hidden = p.programs.uikit.nodes.filter((n) => n.writes.some((w) => w.kind === 'visibility')).map((n) => n.id);
  // The used float of each element, as the compiler resolved it for iOS.
  const floats = p.programs.uikit.nodes.filter((n) => n.kind === 'element' && floatsOn(compiled.explain({ target: 'ios', at: { node: n.id, instance: 'doc' }, property: 'float' }))).map((n) => n.id);
  const out: SelectCompile = { compiled: compiled as Compiled<'ios' | 'android'>, programs: p.programs, facts: { body: f.body, paragraphs: f.paragraphs, unselectable: f.unselectable, hidden, floats } };
  compiles.set(key, out);
  return out;
}

export function selectCase(d: SelectDoc): SelectCase {
  const c = selectCompile(d);
  const input = programInput(c.programs.uikit, ENVIRONMENT.viewport, 1);
  const refused = selectionRefusal(input);
  if (refused !== null) throw new Error(`${d.id}: the selection model refuses it: ${refused}`);
  return { input, facts: c.facts, table: selectionTableOf(input, referenceMeasurer(), c.facts) };
}

// No point sits on an Ahem glyph's midpoint: Chrome on a Linux host advances 10px Ahem a hair under 10px (FreeType's 16.16 x_scale),
// which moves every midpoint left of the reference platform's. A point on the midpoint picks the caret before the glyph; that was
// measured with whole-pixel advances (Chrome without --font-render-hinting=none), as darwin-arm64 has them.
const XS = [1, 4, 14, 16, 24, 26, 34, 44, 46, 49, 53, 61, 75, 99, 101, 140];

/**
 * The points a document is driven at, in CSS px: a click at every grid point (x in XS, y every 3px to 15px past the root's bottom),
 * and drags from three anchors (the first line's start, a middle point, the end) to every other grid row at four x.
 */
export function selectPoints(t: SelectTable): { readonly clicks: readonly (readonly [number, number])[]; readonly drags: readonly (readonly [number, number, number, number])[] } {
  const bottom = (t.blocks[0]?.bottom ?? 0) / 64;
  const ys: number[] = [];
  for (let y = 1; y < bottom + 15; y += 3) ys.push(y);
  const clicks = ys.flatMap((y) => XS.map((x) => [x, y] as const));
  const anchors = [[1, 1], [23, Math.floor(bottom / 2)], [140, bottom + 10]] as const;
  const drags = anchors.flatMap(([ax, ay]) => ys.filter((_, i) => i % 2 === 0).flatMap((y) => [4, 16, 46, 140].map((x) => [ax, ay, x, y] as const)));
  return { clicks, drags };
}

export const SELECT_VECTORS_PATH = 'packages/layout/rt-vectors/select/cases.json';

/** The select suite's vectors: per document its engine input, its facts and its points and drags in LU. */
export function selectVectorsJson(): string {
  const cases = SELECT_DOCS.map((d) => {
    const c = selectCase(d);
    const p = selectPoints(c.table);
    return {
      id: d.id,
      platform: 'darwin-arm64',
      input: c.input,
      facts: [c.facts.body, c.facts.paragraphs, c.facts.unselectable, c.facts.hidden, c.facts.floats],
      points: p.clicks.flatMap(([x, y]) => [Math.floor(x * 64), Math.floor(y * 64)]),
      drags: p.drags.flatMap((g) => g.map((v) => Math.floor(v * 64))),
    };
  });
  return `${JSON.stringify({ schema: 'dragon-select-vectors/1', cases }, null, 1)}\n`;
}

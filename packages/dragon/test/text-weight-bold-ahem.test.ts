// TXT-W on native over Ahem: Chrome draws Ahem's one regular face in Skia's fake bold where the computed weight is 600 or more and
// font-synthesis-weight allows it: each outline stroked and filled with a miter join at size * scale, scale interpolated from 1/24 at
// 9px to 1/32 at 36px, advances unchanged. Native lays the text out and the program's synthetic-bold write strokes the glyphs. The
// Chrome case is text-weight-bold-ahem (packages/parity/fixtures, text-weight-bold-ahem.test.ts); this file holds the boundary, the
// emitted writes, the stroke width, the refusals that stay and the ahemBoldUnstroked plant.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { EmitCase, NativeProgram } from '../src/internal.ts';
import { appliedValue, createProjectWith, emitAndroidViewsCases, emitUikitCases, nativePrograms, NO_FAULTS, StateEmitError, SYNTHETIC_BOLD_KEYS, SYNTHETIC_BOLD_VALUES, syntheticBoldStroke } from '../src/internal.ts';
import { nodeLit } from '../src/emit/runtime/state.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const compile = (decl: string, tag = 'div', faults: CompilerFaults = NO_FAULTS, extra = '') =>
  project(faults).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } .s { ${decl} } ${extra}`, (r) => [el(r, 'a', tag, ['s'], [text(r, 't', 'XX XX')])]));

const errorsOf = (c: ReturnType<typeof compile>): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();

function programs(c: object): { readonly uikit: NativeProgram; readonly 'android-views': NativeProgram } {
  const p = nativePrograms(c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

/** The text run's synthetic-bold write on both backends (they must agree), or null when it is drawn unemboldened. */
function boldOf(c: object): { keys: readonly number[]; values: readonly number[] } | null {
  const p = programs(c);
  const of = (prog: NativeProgram) => {
    const w = prog.nodes.find((n) => n.id === 'a:text0')?.writes.find((x) => x.kind === 'synthetic-bold');
    return w === undefined || w.kind !== 'synthetic-bold' ? null : { keys: w.keys, values: w.values };
  };
  expect(of(p['android-views'])).toEqual(of(p.uikit));
  return of(p.uikit);
}

const SKIA = { keys: [9, 36], values: [Math.fround(1 / 24), Math.fround(1 / 32)] };
const BOLD = ['font-weight: 600', 'font-weight: 700', 'font-weight: bold', 'font-weight: bolder', 'font-weight: 900', 'font-weight: 1000', 'font-weight: 650.5',
  'font-weight: bold; font-synthesis-weight: auto', 'font-weight: bold; font-synthesis: weight', 'font-weight: bold; font-synthesis-style: none', 'font: bold 10px Ahem', 'font: 600 10px/2 Ahem'];
const UPRIGHT = ['font-weight: normal', 'font-weight: 599', 'font-weight: 599.9', 'font-weight: lighter', 'font-weight: 1',
  'font-weight: bold; font-synthesis-weight: none', 'font-weight: bold; font-synthesis: none', 'font-weight: bold; font-synthesis: style', 'font: 10px Ahem'];

describe('font-weight over Ahem on native', () => {
  it('accepts every font-weight on ios, android and web, and emboldens exactly where Chrome synthesizes the bold', () => {
    for (const d of BOLD) {
      const c = compile(d);
      expect(errorsOf(c), d).toEqual([]);
      expect(boldOf(c), d).toEqual(SKIA);
    }
    for (const d of UPRIGHT) {
      const c = compile(d);
      expect(errorsOf(c), d).toEqual([]);
      expect(boldOf(c), d).toBeNull();
    }
  });

  it('b, strong and headings embolden from the user-agent stylesheet\'s bold; a synthetic oblique with it stays refused', () => {
    for (const tag of ['b', 'strong', 'h3']) {
      const c = compile('color: black', tag);
      expect(errorsOf(c), tag).toEqual([]);
      expect(boldOf(c), tag).toEqual(SKIA);
    }
    expect(errorsOf(compile('font-weight: 700; font-style: italic'))).toEqual(['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT']);
    expect(compile('font-weight: 700; font-style: italic').diagnostics.find((d) => d.target === 'ios')?.message).toMatch(/^text a:text0 inherits font-weight: 700 from the author's style on <div> a, and font-style: italic/);
    expect(errorsOf(compile('font-weight: 700; font-style: italic; font-synthesis-style: none'))).toEqual([]);
  });

  it('refuses synthetic bold on native in a block whose lines may end in an ellipsis, bold text or bold block, and accepts the same text without it', () => {
    for (const extra of ['.s { text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }', '.s { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden; }']) {
      const c = compile('font-weight: 700', 'div', NO_FAULTS, extra);
      expect(errorsOf(c), extra).toEqual(['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT']);
      expect(c.diagnostics.find((d) => d.target === 'android')?.message, extra).toMatch(/^text a:text0 \(font-weight 700\) is inside <div> a \(font-weight 700\), whose lines may end in an ellipsis/);
      expect(c.outputs.web.kind, extra).toBe('ready');
      expect(errorsOf(compile('font-weight: 500', 'div', NO_FAULTS, extra)), extra).toEqual([]);
    }
    // The ellipsis is drawn in the block's font: a bold block with unemboldened text is refused too.
    const inner = project(NO_FAULTS).compile(inputFor('body { font-family: Ahem; font-size: 10px; } .o { font-weight: 700; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; } .n { font-weight: 400; }',
      (r) => [el(r, 'o', 'div', ['o'], [el(r, 'n', 'span', ['n'], [text(r, 't', 'XX XX')])])]));
    expect(errorsOf(inner).filter((e) => e.endsWith('DRAGON_UNSUPPORTED_FONT'))).toEqual(['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT']);
    expect(inner.diagnostics.find((d) => d.code === 'DRAGON_UNSUPPORTED_FONT')?.message).toMatch(/^text n:text0 \(font-weight 400\) is inside <div> o \(font-weight 700\)/);
    // The block is the text's block container (checkTextOverflow's rule), not the nearest element with text-overflow: an inline span's
    // own text-overflow does nothing, so the bold div's ellipsis still ends the span's line in synthetic bold.
    const nested = (outer: string, span: string) => project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } .o { ${outer} } .n { ${span} }`,
      (r) => [el(r, 'o', 'div', ['o'], [el(r, 'n', 'span', ['n'], [text(r, 't', 'XXXXXXXXXXXXXXXXXXXXXXXX')])])]));
    const fontErrors = (c: ReturnType<typeof nested>): string[] => errorsOf(c).filter((e) => e.endsWith('DRAGON_UNSUPPORTED_FONT'));
    const truncating = 'text-overflow: ellipsis; overflow: hidden; white-space: nowrap;';
    const repro = nested(`font-weight: 700; ${truncating}`, 'font-weight: 400; text-overflow: ellipsis;');
    expect(fontErrors(repro)).toEqual(['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT']);
    expect(repro.diagnostics.find((d) => d.code === 'DRAGON_UNSUPPORTED_FONT')?.message).toMatch(/^text n:text0 \(font-weight 400\) is inside <div> o \(font-weight 700\)/);
    // A bold span in a truncating block, whatever the span's own text-overflow, is refused too.
    expect(fontErrors(nested(truncating, 'font-weight: 700; text-overflow: clip;'))).toEqual(['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT']);
    // No ellipsis: text-overflow only on the inline span, or on a block whose overflow is visible, truncates nothing.
    const spanOnly = nested('white-space: nowrap; overflow: hidden;', 'font-weight: 700; text-overflow: ellipsis;');
    expect(fontErrors(spanOnly)).toEqual([]);
    expect(programs(spanOnly).uikit.nodes.find((n) => n.id === 'n:text0')?.writes.some((w) => w.kind === 'synthetic-bold')).toBe(true);
    expect(fontErrors(nested('font-weight: 700; text-overflow: ellipsis; white-space: nowrap;', ''))).toEqual([]);
  });

  it('refuses synthetic bold on native in a translucent colour, which Chrome composites glyph by glyph, and accepts opaque or transparent', () => {
    const NATIVE_FONT = ['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT'];
    for (const d of ['font-weight: 700; color: rgba(0, 0, 0, 0.5)', 'font-weight: bold; color: #0008', 'font-weight: 600; color: hsl(0 0% 0% / 0.99)']) {
      const c = compile(d);
      expect(errorsOf(c), d).toEqual(NATIVE_FONT);
      expect(c.diagnostics.find((x) => x.target === 'ios')?.message, d).toMatch(/^text a:text0 \(font-weight \d+\) is drawn in synthetic bold in the translucent colour .*composites each emboldened glyph on its own/);
      expect(c.outputs.web.kind, d).toBe('ready');
    }
    // b inherits the bold from the user-agent stylesheet and the colour from the author.
    expect(errorsOf(compile('color: rgba(0, 0, 0, 0.5)', 'b'))).toEqual(NATIVE_FONT);
    for (const d of ['font-weight: 700; color: rgba(0, 0, 0, 1)', 'font-weight: 700; color: transparent', 'font-weight: 500; color: rgba(0, 0, 0, 0.5)', 'font-weight: 700; color: rgba(0, 0, 0, 0.5); font-synthesis-weight: none']) {
      expect(errorsOf(compile(d)), d).toEqual([]);
    }
  });

  it('refuses a skip-ink auto underline over synthetic bold on native, whose intercepts Skia takes from the emboldened outline', () => {
    const NATIVE_VALUE = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE'];
    for (const d of ['font-weight: 700; text-decoration: underline', 'font-weight: bold; text-decoration: underline; text-decoration-skip-ink: auto']) {
      const c = compile(d);
      expect(errorsOf(c), d).toEqual(NATIVE_VALUE);
      expect(c.diagnostics.find((x) => x.target === 'android')?.message, d).toMatch(/^text a:text0 draws text-decoration \(underline from a\) that android does not draw: skip-ink-intercepts/);
      expect(c.outputs.web.kind, d).toBe('ready');
    }
    // An underline from an upright ancestor over a bold child is refused too: the child's glyphs are the emboldened ones.
    const nested = project(NO_FAULTS).compile(inputFor('body { font-family: Ahem; font-size: 10px; } .u { text-decoration: underline; } .b { font-weight: 700; }',
      (r) => [el(r, 'u', 'div', ['u'], [el(r, 'b', 'span', ['b'], [text(r, 't', 'XX XX')])])]));
    expect(errorsOf(nested)).toEqual(NATIVE_VALUE);
    for (const d of ['font-weight: 700; text-decoration: underline; text-decoration-skip-ink: none', 'font-weight: 500; text-decoration: underline', 'font-weight: 700; text-decoration: underline; font-synthesis-weight: none']) {
      expect(errorsOf(compile(d)), d).toEqual([]);
    }
  });

  it('emits the stroke rule on both backends and reads it back as syntheticBold; a state program refuses it by name', () => {
    const p = programs(compile('font-weight: bold'));
    const emitCase = (prog: NativeProgram): EmitCase => ({ id: 'case-1', fixture: 'fixture-1', direction: 'ltr', compilerDigest: 'digest', viewport: { width: 400, height: 300 }, program: prog, expectedDigests: [{ dpr: 2, sha256: 'x'.repeat(64) }] });
    expect(emitUikitCases([emitCase(p.uikit)]).map((f) => f.text).join('\n')).toContain(`.dragonSetSyntheticBold(keys: [9.0, 36.0], values: [${Math.fround(1 / 24)}, 0.03125])`);
    expect(emitAndroidViewsCases([emitCase(p['android-views'])]).map((f) => f.text).join('\n')).toContain(`.dragonSetSyntheticBold(doubleArrayOf(9.0, 36.0), doubleArrayOf(${Math.fround(1 / 24)}, 0.03125))`);
    for (const prog of [p.uikit, p['android-views']]) {
      const w = prog.nodes.find((n) => n.id === 'a:text0')?.writes.find((x) => x.kind === 'synthetic-bold');
      if (w === undefined) throw new Error('no synthetic-bold write');
      expect(w.key).toBe('syntheticBold');
      expect(w.css).toEqual(['font-weight', 'font-synthesis-weight']);
      expect(appliedValue({} as Parameters<typeof appliedValue>[0], prog.backend, w, 2, { border: [0, 0, 0, 0], box: { x: 0, y: 0, width: 0, height: 0 } as never, size: [0, 0], fontSize: 20, replaced: null, scroll: null })).toEqual(SKIA);
    }
    const node = p.uikit.nodes.find((n) => n.id === 'a:text0');
    if (node === undefined) throw new Error('no text node a:text0');
    expect(() => nodeLit('swift', node)).toThrow(StateEmitError);
    expect(() => nodeLit('swift', node)).toThrow(/synthetic bold in a state program/);
  });

  it('the stroke width is Skia\'s fake bold in float: size / 24 to 9px, size / 32 from 36px, interpolated between', () => {
    expect([SYNTHETIC_BOLD_KEYS, SYNTHETIC_BOLD_VALUES]).toEqual([SKIA.keys, SKIA.values]);
    expect(syntheticBoldStroke(9)).toBe(Math.fround(9 * Math.fround(1 / 24)));
    expect(syntheticBoldStroke(4)).toBe(Math.fround(4 * Math.fround(1 / 24)));
    expect(syntheticBoldStroke(36)).toBe(1.125);
    expect(syntheticBoldStroke(288)).toBe(9);
    expect(syntheticBoldStroke(20)).toBeCloseTo(20 * (1 / 24 + ((1 / 32 - 1 / 24) * 11) / 27), 6);
    expect(syntheticBoldStroke(26.25)).toBeCloseTo(26.25 * (1 / 24 + ((1 / 32 - 1 / 24) * 17.25) / 27), 6);
    // Monotonic in size: a larger instance never gets a thinner stroke.
    for (let s = 1; s < 300; s += 0.5) expect(syntheticBoldStroke(s + 0.5), String(s)).toBeGreaterThanOrEqual(syntheticBoldStroke(s));
  });

  it('plant ahemBoldUnstroked: native draws the synthetic bold unemboldened (no stroke write) and still compiles', () => {
    const plant = { ...NO_FAULTS, ahemBoldUnstroked: true };
    for (const d of BOLD) {
      const c = compile(d, 'div', plant);
      expect(errorsOf(c), d).toEqual([]);
      expect(boldOf(c), d).toBeNull();
    }
  });
});

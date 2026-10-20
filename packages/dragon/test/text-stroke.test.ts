// TXT-FX: -webkit-text-stroke on the native targets (analysis/text-stroke.ts). A px stroke up to TEXT_STROKE_MAX_PX in an opaque colour
// over upright regular Ahem text becomes a text-stroke write the text view strokes after each line's fill; everything the view would
// draw otherwise than Chrome is refused on iOS and Android and left to Chrome on web. The Chrome case is text-stroke-ahem
// (packages/parity/test/text-stroke.test.ts).
import { describe, expect, it } from 'vitest';
import type { Diagnostic, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { NativeProgram } from '../src/internal.ts';
import type { Assignment, Targets } from '../src/types.ts';
import type { StateEmit } from 'dragon';
import { deriveStateProgram, emitStatePrograms } from 'dragon';
import { TEXT_STROKE_MAX_PX } from '../src/analysis/text-stroke.ts';
import { emitAndroidViewsCases, emitUikitCases } from '../src/internal.ts';
import type { EmitCase } from '../src/emit/native-support.ts';
import { div, inputFor, text } from './helpers.ts';

const ALL: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 20px; } ';
const NATIVE = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE'];

const one = (r: SourceRef): TreeNode[] => [div(r, 'a', ['s'], [text(r, 't', 'XX XX')])];
const compile = (css: string, body: (r: SourceRef) => TreeNode[] = one) => createProjectWith({ projectId: 'test', targets: ALL }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(BASE + css, body));
const errors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');
const codes = (css: string, body?: (r: SourceRef) => TreeNode[]): string[] => errors(compile(css, body)).map((d) => `${d.target} ${d.code}`).sort();

function programs(compiled: object, assignment: Assignment = []): readonly NativeProgram[] {
  const p = nativePrograms(compiled, assignment);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return [p.programs.uikit, p.programs['android-views']];
}
const strokeOf = (prog: NativeProgram, id: string): unknown => {
  const w = prog.nodes.find((n) => n.id === id)?.writes.find((x) => x.kind === 'text-stroke');
  return w?.kind === 'text-stroke' ? { width: w.width, color: [w.color.r, w.color.g, w.color.b, w.color.alpha], css: w.css } : null;
};

describe('-webkit-text-stroke on the native targets', () => {
  it('lowers a px stroke in an explicit or currentcolor colour, inherited, to a text-stroke write on both backends', () => {
    for (const [css, want] of [
      ['.s { -webkit-text-stroke: 2px rgb(10, 20, 30); }', { width: 2, color: [10, 20, 30, 255] }],
      ['.s { color: blue; -webkit-text-stroke: 3px; }', { width: 3, color: [0, 0, 255, 255] }],
      ['.s { -webkit-text-stroke-width: 0.1em; -webkit-text-stroke-color: red; }', { width: 2, color: [255, 0, 0, 255] }],
      [`.s { -webkit-text-stroke: ${TEXT_STROKE_MAX_PX}px red; }`, { width: TEXT_STROKE_MAX_PX, color: [255, 0, 0, 255] }],
    ] as const) {
      const c = compile(css);
      expect(errors(c), css).toEqual([]);
      for (const prog of programs(c)) expect(strokeOf(prog, 'a:text0'), css).toEqual({ ...want, css: ['-webkit-text-stroke-width', '-webkit-text-stroke-color'] });
    }
    // Inherited from a parent block, and on an inline box's text only.
    const nested = (r: SourceRef): TreeNode[] => [div(r, 'p', ['s'], [div(r, 'a', [], [text(r, 't', 'XX'), div(r, 'b', ['n'], [text(r, 'u', 'YY')])])])];
    const c = compile('.s { -webkit-text-stroke: 2px red; } .n { -webkit-text-stroke-width: 0; }', nested);
    expect(errors(c)).toEqual([]);
    for (const prog of programs(c)) {
      expect(strokeOf(prog, 'a:text0')).not.toBeNull();
      expect(strokeOf(prog, 'b:text0')).toBeNull();
    }
    // A zero width draws nothing and writes nothing.
    for (const prog of programs(compile('.s { -webkit-text-stroke: 0 red; }'))) expect(strokeOf(prog, 'a:text0')).toBeNull();
  });

  it('emits the stroke on both backends', () => {
    const [uikit, android] = programs(compile('.s { -webkit-text-stroke: 2.5px rgb(1, 2, 3); }')) as [NativeProgram, NativeProgram];
    const emitCase = (program: NativeProgram): EmitCase => ({ id: 'case-1', fixture: 'fixture-1', direction: 'ltr', compilerDigest: 'digest', viewport: { width: 400, height: 300 }, program, expectedDigests: [{ dpr: 2, sha256: 'x'.repeat(64) }] });
    const swift = emitUikitCases([emitCase(uikit)]).map((f) => f.text).join('\n');
    const kotlin = emitAndroidViewsCases([emitCase(android)]).map((f) => f.text).join('\n');
    expect(swift).toContain('.dragonSetTextStroke(width: 2.5, color: DragonRGBA8(1, 2, 3, 255))');
    expect(kotlin).toContain('.dragonSetTextStroke(2.5, DragonRGBA8(1, 2, 3, 255))');
  });

  it('refuses on iOS and Android what the native view would stroke otherwise than Chrome, and leaves it to Chrome on web', () => {
    const s = '.s { -webkit-text-stroke: 2px red; }';
    expect(codes(s)).toEqual([]);
    for (const extra of [
      `.s { -webkit-text-stroke-width: ${TEXT_STROKE_MAX_PX + 1}px; }`,
      '.s { -webkit-text-stroke-color: rgba(255, 0, 0, 0.5); }',
      '.s { font-weight: bold; }',
      '.s { font-style: italic; }',
      '.s { font-variant-caps: small-caps; }',
      '.s { paint-order: stroke; }',
      '.s { text-shadow: 1px 1px red; white-space: nowrap; }',
      '.s { text-decoration: underline; }',
      '.s { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    ]) expect(codes(`${s} ${extra}`), extra).toEqual(NATIVE);
    // paint-order: fill first, or markers alone, keeps the fill before the stroke.
    expect(codes(`${s} .s { paint-order: fill; }`)).toEqual([]);
    // A later box painting a background, which Chrome paints beneath the stroke; an earlier one is fine.
    const later = (r: SourceRef): TreeNode[] => [div(r, 'a', ['s'], [text(r, 't', 'XX')]), div(r, 'b', ['g'], [])];
    const earlier = (r: SourceRef): TreeNode[] => [div(r, 'b', ['g'], []), div(r, 'a', ['s'], [text(r, 't', 'XX')])];
    expect(codes(`${s} .g { height: 10px; background-color: red; }`, later)).toEqual(NATIVE);
    expect(codes(`${s} .g { height: 10px; background-color: red; }`, earlier)).toEqual([]);
    // A line clamp may end the text in an ellipsis.
    expect(codes(`${s} .s { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden; }`)).toEqual(NATIVE);
    const msg = errors(compile(`${s} .s { -webkit-text-stroke-color: rgba(255, 0, 0, 0.5); }`)).find((d) => d.target === 'ios');
    expect(msg?.message).toBe('-webkit-text-stroke-width: 2px over text a:text0 is unsupported on ios: the stroke colour is not opaque: Chrome composites each glyph\'s stroke on its own, the native view one path per line (TXT-FX)');
  });

  it('refuses a stroke width keyword on every target (Chrome scales thin, medium and thick with the font)', () => {
    for (const k of ['thin', 'medium', 'thick']) expect(codes(`.s { -webkit-text-stroke: ${k} red; }`), k).toEqual([...NATIVE, 'web DRAGON_UNSUPPORTED_VALUE'].sort());
  });

  it('refuses on iOS and Android an animation of color that a currentcolor stroke follows, and not one an explicit stroke ignores', () => {
    const anim = '@keyframes k { to { color: blue; } }';
    expect(codes(`.s { -webkit-text-stroke: 2px; animation: k 1s; } ${anim}`)).toEqual(NATIVE);
    expect(codes(`.s { -webkit-text-stroke: 2px red; animation: k 1s; } ${anim}`)).toEqual([]);
  });

  it('refuses a stroked text in a state program by name, whose state runtime draws no stroke (as a synthetic bold)', () => {
    const [uikit] = programs(compile('.s { -webkit-text-stroke: 2px red; }')) as [NativeProgram];
    const sp = deriveStateProgram('uikit', [{ assignment: [], isInitial: true, program: uikit }]);
    const emit: StateEmit = { id: 'v', fixture: 'v', direction: 'ltr', compilerDigest: 'sha256:0', viewport: { width: 400, height: 300 }, program: sp, scripts: [] };
    expect(() => emitStatePrograms('uikit', [emit])).toThrow('a:text0: a text stroke in a state program has no state-node write (TXT-FX strokes glyphs on the static program only)');
  });

  it('plant textStrokeAccepted: every stroke compiles on every target and none is drawn', () => {
    const c = createProjectWith({ projectId: 'test', targets: ALL }, { faults: { ...NO_FAULTS, textStrokeAccepted: true }, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`${BASE}.s { -webkit-text-stroke: 2px rgba(255, 0, 0, 0.5); }`, one));
    expect(errors(c)).toEqual([]);
    for (const prog of programs(c)) expect(strokeOf(prog, 'a:text0')).toBeNull();
  });
});

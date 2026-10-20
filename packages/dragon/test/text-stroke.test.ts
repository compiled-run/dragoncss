// TXT-FX: -webkit-text-stroke on the native targets (analysis/text-stroke.ts). A px stroke up to TEXT_STROKE_MAX_PX in an opaque colour
// over upright regular Ahem text becomes a text-stroke write the text view strokes after each line's fill; everything the view would
// draw otherwise than Chrome is refused on iOS and Android and left to Chrome on web. The Chrome case is text-stroke-ahem
// (packages/parity/test/text-stroke.test.ts).
import { describe, expect, it } from 'vitest';
import type { Diagnostic, SourceRef, TreeNode } from '../src/index.ts';
import { appliedValue, createProjectWith, emitNativeSupport, NO_FAULTS, nativePrograms } from '../src/internal.ts';
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
    // A transparent stroke draws nothing in Chrome: it compiles on every target, at any width, and writes nothing.
    for (const css of ['.s { -webkit-text-stroke: 2px transparent; }', '.s { -webkit-text-stroke: 12px rgba(1, 2, 3, 0); }']) {
      const c = compile(css);
      expect(errors(c), css).toEqual([]);
      for (const prog of programs(c)) expect(strokeOf(prog, 'a:text0'), css).toBeNull();
    }
  });

  it('emits the stroke on both backends', () => {
    const [uikit, android] = programs(compile('.s { -webkit-text-stroke: 2.5px rgb(1, 2, 3); }')) as [NativeProgram, NativeProgram];
    const emitCase = (program: NativeProgram): EmitCase => ({ id: 'case-1', fixture: 'fixture-1', direction: 'ltr', compilerDigest: 'digest', viewport: { width: 400, height: 300 }, program, expectedDigests: [{ dpr: 2, sha256: 'x'.repeat(64) }] });
    const swift = emitUikitCases([emitCase(uikit)]).map((f) => f.text).join('\n');
    const kotlin = emitAndroidViewsCases([emitCase(android)]).map((f) => f.text).join('\n');
    expect(swift).toContain('.dragonSetTextStroke(width: 2.5, color: DragonRGBA8(1, 2, 3, 255))');
    expect(kotlin).toContain('.dragonSetTextStroke(2.5, DragonRGBA8(1, 2, 3, 255))');
    // The expected dump has each view stroke at the css width * device pixel ratio in device px, which each device dumps from its
    // own stroke (the layer's scale on iOS, the stroke Paint's width on Android), so a view stroking at another width fails its dump.
    const engine = { float32: Math.fround } as unknown as Parameters<typeof appliedValue>[0];
    const geometry = { border: [0, 0, 0, 0], box: { x: 0, y: 0, width: 0, height: 0 }, size: [0, 0], fontSize: null, replaced: null, scroll: null } as unknown as Parameters<typeof appliedValue>[4];
    for (const [prog, dpr, want] of [[uikit, 3, 7.5], [android, 2.625, Math.fround(6.5625)], [android, 1, 2.5]] as const) {
      const w = prog.nodes.flatMap((n) => n.writes).find((x) => x.kind === 'text-stroke');
      if (w === undefined) throw new Error('no text-stroke write');
      expect(appliedValue(engine, prog.backend, w, dpr, geometry)).toEqual({ deviceWidth: want, color: [1, 2, 3, 255] });
    }
    const support = emitNativeSupport('android-views', null).map((f) => f.text).join('\n');
    expect(support).toContain('Pair("deviceWidth", DumpJson.Num(dragonStrokePaint(paint)!!.strokeWidth.toDouble()))');
    expect(support).toContain('strokeWidth = (dragonStrokeWidth * scale).toFloat()');
    // The text view's scale is the device scale apply() runs at, not the zoomed input's devicePixelRatio (always 1).
    expect(support).toContain('tv.dragonConfigure(bridge, size.toFloat(), specs, scale)');
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
    // Animated, the document is a state program too, which refuses any drawn stroke (below); the currentcolor refusal comes first.
    const ios = (css: string): string[] => errors(compile(css)).filter((d) => d.target === 'ios').map((d) => d.message);
    const followed = ios(`.s { -webkit-text-stroke: 2px; animation: k 1s; } ${anim}`);
    expect(followed[0]).toMatch(/currentcolor/);
    expect(followed[0]).not.toMatch(/state program/);
    expect(ios(`.s { -webkit-text-stroke: 2px red; animation: k 1s; } ${anim}`).some((m) => /currentcolor/.test(m))).toBe(false);
  });

  it('refuses on iOS and Android at compile time a drawn stroke in a document native builds as a state program', () => {
    const why = (css: string): string | undefined => errors(compile(css)).find((d) => d.target === 'ios' && d.message.startsWith('-webkit-text-stroke'))?.message;
    const head = '-webkit-text-stroke-width: 2px over text a:text0 is unsupported on ios: the document has';
    const tail = 'so native builds a state program, whose text records carry no stroke (TXT-FX)';
    // An animation the stroke does not follow and a transition each make the output a state program.
    for (const [css, kind] of [
      ['.s { -webkit-text-stroke: 2px red; animation: k 1s; } @keyframes k { to { color: blue; } }', 'transitions or animations'],
      ['.s { -webkit-text-stroke: 2px red; transition: color 1s; }', 'transitions or animations'],
    ] as const) {
      expect(codes(css), css).toEqual(NATIVE);
      expect(why(css), css).toBe(`${head} ${kind}, ${tail}`);
    }
    // An interaction state too (native refuses :hover outside the lanes as well, by its own diagnostic).
    expect(why('.s { -webkit-text-stroke: 2px red; } .s:hover { color: blue; }')).toBe(`${head} interaction states, ${tail}`);
    // A transparent stroke draws nothing, so it compiles there; so does the same stroke in a static document.
    expect(codes('.s { -webkit-text-stroke: 2px transparent; transition: color 1s; }')).toEqual([]);
    expect(codes('.s { -webkit-text-stroke: 2px red; }')).toEqual([]);
  });

  it('the state emitter still names a stroked text that reaches it, whose state runtime draws no stroke (as a synthetic bold)', () => {
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

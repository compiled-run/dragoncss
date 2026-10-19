// TXT-W on native over Ahem: Chrome draws Ahem's one regular face sheared by Skia's skewX(-1/4) where the computed slope is 14deg or
// more and font-synthesis-style allows it, and upright otherwise; advances never change. Native lays the text out and the program's
// synthetic-oblique write shears the glyphs (0.25 x per unit of height above the baseline). The Chrome case is text-style-ahem
// (packages/parity/fixtures, text-style-ahem.test.ts); this file holds the boundary, the emitted writes and the ahemObliqueUnsheared plant.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { EmitCase, NativeProgram } from '../src/internal.ts';
import { createProjectWith, emitAndroidViewsCases, emitUikitCases, nativePrograms, NO_FAULTS, StateEmitError } from '../src/internal.ts';
import { nodeLit } from '../src/emit/runtime/state.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const project = (faults: CompilerFaults, profiles: 'derive' | 'enforce' = 'derive') =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles, direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const compile = (decl: string, tag = 'div', faults: CompilerFaults = NO_FAULTS, profiles: 'derive' | 'enforce' = 'derive') =>
  project(faults, profiles).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } .s { ${decl} }`, (r) => [el(r, 'a', tag, ['s'], [text(r, 't', 'XX XX')])]));

const errorsOf = (c: ReturnType<typeof compile>): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();

function programs(c: object): { readonly uikit: NativeProgram; readonly 'android-views': NativeProgram } {
  const p = nativePrograms(c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

/** The text run's synthetic-oblique shear on both backends (they must agree), or null when it is drawn upright. */
function shearOf(c: object): number | null {
  const p = programs(c);
  const of = (prog: NativeProgram): number | null => {
    const w = prog.nodes.find((n) => n.id === 'a:text0')?.writes.find((x) => x.kind === 'synthetic-oblique');
    return w === undefined || w.kind !== 'synthetic-oblique' ? null : w.shear;
  };
  expect(of(p['android-views'])).toBe(of(p.uikit));
  return of(p.uikit);
}

const SHEARED = ['font-style: italic', 'font-style: oblique', 'font-style: oblique 14deg', 'font-style: oblique 20deg', 'font-style: oblique 90deg', 'font-style: oblique 0.3rad',
  'font-style: italic; font-synthesis-style: auto', 'font-style: italic; font-synthesis: style', 'font-style: italic; font-synthesis-weight: none', 'font: italic 10px Ahem'];
const UPRIGHT = ['font-style: normal', 'font-style: oblique 10deg', 'font-style: oblique 13.9deg', 'font-style: oblique -20deg', 'font-style: oblique 0deg',
  'font-style: italic; font-synthesis-style: none', 'font-style: italic; font-synthesis: none', 'font-style: oblique 30deg; font-synthesis: weight', 'font-weight: bold; font-synthesis-weight: none'];

describe('font-style over Ahem on native', () => {
  it('accepts every font-style on ios, android and web, and shears exactly where Chrome synthesizes the oblique', () => {
    for (const d of SHEARED) {
      const c = compile(d);
      expect(errorsOf(c), d).toEqual([]);
      expect(shearOf(c), d).toBe(0.25);
    }
    for (const d of UPRIGHT) {
      const c = compile(d);
      expect(errorsOf(c), d).toEqual([]);
      expect(shearOf(c), d).toBeNull();
    }
  });

  it('em and i shear from the user-agent stylesheet\'s italic; b is drawn unsheared (its synthetic bold is text-weight-bold-ahem\'s); bold with the oblique stays refused', () => {
    for (const tag of ['em', 'i']) expect(shearOf(compile('color: black', tag)), tag).toBe(0.25);
    expect(errorsOf(compile('color: black', 'b'))).toEqual([]);
    expect(shearOf(compile('color: black', 'b'))).toBeNull();
    expect(errorsOf(compile('font-style: italic; font-weight: 700'))).toEqual(['android DRAGON_UNSUPPORTED_FONT', 'ios DRAGON_UNSUPPORTED_FONT']);
    expect(errorsOf(compile('font-style: italic; font-weight: 700; font-synthesis: style'))).toEqual([]);
  });

  it('emits the shear on both backends and reads it back as glyphShear; a state program refuses it by name', () => {
    const p = programs(compile('font-style: italic'));
    const emitCase = (prog: NativeProgram): EmitCase => ({ id: 'case-1', fixture: 'fixture-1', direction: 'ltr', compilerDigest: 'digest', viewport: { width: 400, height: 300 }, program: prog, expectedDigests: [{ dpr: 2, sha256: 'x'.repeat(64) }] });
    expect(emitUikitCases([emitCase(p.uikit)]).map((f) => f.text).join('\n')).toContain('.dragonSetGlyphShear(0.25)');
    expect(emitAndroidViewsCases([emitCase(p['android-views'])]).map((f) => f.text).join('\n')).toContain('.dragonSetGlyphShear(0.25)');
    for (const prog of [p.uikit, p['android-views']]) {
      const w = prog.nodes.find((n) => n.id === 'a:text0')?.writes.find((x) => x.kind === 'synthetic-oblique');
      expect(w?.key).toBe('glyphShear');
      expect(w?.css).toEqual(['font-style', 'font-synthesis-style']);
    }
    const node = p.uikit.nodes.find((n) => n.id === 'a:text0');
    if (node === undefined) throw new Error('no text node a:text0');
    expect(() => nodeLit('swift', node)).toThrow(StateEmitError);
    expect(() => nodeLit('swift', node)).toThrow(/synthetic oblique in a state program/);
  });

  it('plant ahemObliqueUnsheared: native draws the synthetic oblique upright (no shear write) and still compiles', () => {
    const plant = { ...NO_FAULTS, ahemObliqueUnsheared: true };
    for (const d of SHEARED) {
      const c = compile(d, 'div', plant);
      expect(errorsOf(c), d).toEqual([]);
      expect(shearOf(c), d).toBeNull();
    }
  });
});

// FORM-a: what the compiler refuses around a button or range, and what web writes for them (#496 landing review).
import { describe, expect, it } from 'vitest';
import type { Diagnostic, FrontEndResult } from '../src/internal.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { SourceRef } from '../src/types.ts';
import { div, inputFor, text } from './helpers.ts';

type Body = (r: SourceRef) => ReturnType<typeof div>[];

const BODY = 'body { font-family: Ahem; font-size: 10px; } ';
const BUTTON = '.b { display: block; appearance: none; font-family: Ahem; font-size: 10px; border: 2px solid #036; padding: 1px 6px; } ';
const RANGE = '.r { display: block; appearance: none; width: 100px; } .r::-webkit-slider-thumb { appearance: none; width: 10px; height: 10px; } ';
const attr = (name: string, value: string) => ({ name, value: [{ when: { kind: 'true' as const }, value }], origin: { kind: 'unlocated' as const, reason: 'test' } });
const button = (r: SourceRef) => ({ ...div(r, 'b', ['b'], [text(r, 'bt', 'XX')]), tag: 'button' });
const range = (r: SourceRef) => ({ ...div(r, 'r', ['r']), tag: 'input', attributes: [attr('type', 'range')] });
const inParent = (kid: (r: SourceRef) => ReturnType<typeof div>): Body => (r) => [div(r, 'p', ['p'], [kid(r)])];

const NATIVE = { web: {}, ios: { minimum: '15.0' }, android: { minSdk: 31 } };
const compile = (css: string, body: Body, targets: { readonly web: object } = { web: {} }, lanes = false) =>
  createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', ...(lanes ? { interactionLanes: true } : {}) }).compile(inputFor(css, body) as FrontEndResult);
const errors = (ds: readonly Diagnostic[]): string[] => ds.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`);
const webText = (css: string, body: Body): string => {
  const out = compile(css, body);
  if (out.outputs.web.kind !== 'ready') throw new Error(errors(out.diagnostics).join('\n'));
  return out.outputs.web.files.map((f) => f.text).join('\n');
};

describe('FORM-a controls', () => {
  it('writes appearance: none on a button, a range and its thumb, which Chrome\'s UA sets to auto', () => {
    expect(webText(`${BODY}${BUTTON}`, (r) => [button(r)])).toMatch(/appearance: none;/);
    const range0 = webText(`${BODY}${RANGE}`, (r) => [range(r)]);
    expect(range0).toMatch(/::-webkit-slider-thumb \{[^}]*appearance: none;/);
    expect(range0.match(/appearance: none;/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a button or range as a grid item', () => {
    for (const kid of [button, range]) {
      const out = compile(`${BODY}${BUTTON}${RANGE}.p { display: grid; }`, inParent(kid));
      expect(errors(out.diagnostics)).toContainEqual(expect.stringMatching(/is a grid item, and a form control as a grid item is not supported yet/));
    }
    expect(errors(compile(`${BODY}${BUTTON}`, inParent(button)).diagnostics)).toEqual([]);
  });

  it('refuses a button inheriting a text value Chrome\'s UA button rule resets, and accepts the reset value or an author one', () => {
    const refused = (parent: string): string[] => errors(compile(`${BODY}${BUTTON}.p { ${parent} }`, inParent(button)).diagnostics);
    expect(refused('line-height: 30px;')).toContainEqual(expect.stringMatching(/inherits line-height: 30px, which Chrome's user-agent button rule resets/));
    expect(refused('color: red;')).toContainEqual(expect.stringMatching(/inherits color: .*which Chrome's user-agent button rule resets/));
    expect(refused('text-transform: uppercase; letter-spacing: 2px;')).toEqual(expect.arrayContaining([expect.stringMatching(/inherits text-transform/), expect.stringMatching(/inherits letter-spacing/)]));
    expect(refused('color: black; line-height: normal;')).toEqual([]);
    expect(errors(compile(`${BODY}${BUTTON}.p { line-height: 30px; } .b { line-height: inherit; }`, inParent(button)).diagnostics)).toEqual([]);
  });

  it('refuses a track that is not a block, and a thumb that floats or is not a block', () => {
    const range1 = (extra: string): string[] => errors(compile(`${BODY}${RANGE}${extra}`, (r) => [range(r)]).diagnostics);
    expect(range1('.r::-webkit-slider-runnable-track { display: flex; }')).toContainEqual(expect.stringMatching(/display: flex on the track of <input> r is not supported/));
    expect(range1('.r::-webkit-slider-runnable-track { display: grid; }')).toContainEqual(expect.stringMatching(/display: grid on the track of <input> r is not supported/));
    expect(range1('.r::-webkit-slider-thumb { display: inline-block; }')).toContainEqual(expect.stringMatching(/display: inline-block on the thumb of <input> r is not supported/));
    expect(range1('.r::-webkit-slider-thumb { float: left; }')).toContainEqual(expect.stringMatching(/float: left on the thumb of <input> r is not supported/));
    expect(range1('')).toEqual([]);
  });

  it('devolves a button to CSS painting on any author background, border radius or border image declaration, initial included', () => {
    const theme = (decl: string): boolean => errors(compile(`${BODY}.b { display: block; font-family: Ahem; ${decl} }`, (r) => [button(r)]).diagnostics).some((e) => e.includes('painted by the platform theme'));
    expect(theme('')).toBe(true);
    for (const d of ['border-radius: 2px;', 'background-clip: content-box;', 'background-position: 1px 1px;', 'background-size: 10px;', 'border-image-source: none;', 'background-color: initial;', 'background-color: inherit;']) expect(theme(d), d).toBe(false);
  });

  it('warns on native that a button or range is drawn without control behaviour or accessibility role, and compiles it', () => {
    for (const [kid, css] of [[button, BUTTON], [range, RANGE]] as const) {
      const out = compile(`${BODY}${css}`, (r) => [kid(r)], NATIVE);
      expect(errors(out.diagnostics)).toEqual([]);
      const warned = out.diagnostics.filter((d) => d.code === 'DRAGON_CONTROL_STATIC_NATIVE');
      expect(warned.map((d) => [d.severity, d.target]).sort()).toEqual([['warning', 'android'], ['warning', 'ios']]);
    }
    expect(compile(`${BODY}${BUTTON}`, (r) => [button(r)]).diagnostics.some((d) => d.code === 'DRAGON_CONTROL_STATIC_NATIVE')).toBe(false);
  });

  it('refuses :hover in a document with a form control on native, where the hit table has no control yet', () => {
    const out = compile(`${BODY}${BUTTON}.a { width: 10px; height: 10px; } .a:hover { width: 20px; }`, (r) => [button(r), div(r, 'a', ['a'])], NATIVE, true);
    expect(errors(out.diagnostics)).toContainEqual(expect.stringMatching(/:hover needs Dragon hit testing through the form control b/));
  });
});

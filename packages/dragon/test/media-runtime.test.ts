// MQ-R1 (notes/T067-mq-r-spec.md R4, R5, R8): a native compile resolves and lowers every @media band, and records the band table
// and every band's programs; a transition a size change would start is refused on native until MQ-Rt (R8, reject-mqr-transition:
// it blocks ios and android and not web, so it is a test here rather than a parity reject fixture, which must block every output).
import { describe, expect, it } from 'vitest';
import type { Compiled, FrontEndResult } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { createProjectWith, nativeBandOfViewport, nativeBandProgram, nativeBandPrograms, nativeBands, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { div, expectCatalogued, inputFor, spanTextOf } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const NATIVE = { ios: { minimum: '15.0' }, android: { minSdk: 31 } } as const;
const input = (css: string): FrontEndResult => inputFor(`${FONT} ${css}`, (r) => [div(r, 'a', ['a']), div(r, 'b', ['b'])]);
const derive = (css: string, foldViewport = { width: 400, height: 300 }): Compiled<'ios' | 'android'> =>
  createProjectWith({ projectId: 'test', targets: NATIVE }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', foldViewport }).compile(input(css));

const THREE = '.a { width: 10px; height: 5px; } @media (max-width: 320px) { .a { width: 20px; } } @media (min-width: 384px) { .a { width: 30px; } }';
const widthIn = (c: Compiled<'ios' | 'android'>, band: number): unknown => {
  const p = nativeBandPrograms(c, [], band);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const root = p.programs.uikit.root;
  const a = (root.children[0] as typeof root).children[0] as typeof root;
  return (a.style as unknown as { width: unknown }).width;
};

describe('every band of the native output (R4)', () => {
  it('records the band table and every band\'s programs; the per-case programs are the fold\'s band', () => {
    const c = derive(THREE);
    const bands = nativeBands(c);
    expect(bands?.conditions).toEqual(['(max-width: 320px) and (not (min-width: 384px))', '(not (max-width: 320px)) and (not (min-width: 384px))', '(not (max-width: 320px)) and (min-width: 384px)']);
    expect(bands?.initial).toBe(2);
    expect([0, 1, 2].map((b) => widthIn(c, b))).toEqual([{ kind: 'px', value: 20 }, { kind: 'px', value: 10 }, { kind: 'px', value: 30 }]);
    const own = nativePrograms(c, []);
    const banded = nativeBandPrograms(c, [], 2);
    expect(own.kind === 'ready' && banded.kind === 'ready' && JSON.stringify(own.programs) === JSON.stringify(banded.programs)).toBe(true);
    expect([304, 320, 352, 384, 400].map((w) => nativeBandOfViewport(c, { width: w, height: 300 }))).toEqual([0, 0, 1, 2, 2]);
    expect(nativeBandPrograms(c, [], 3)).toEqual({ kind: 'blocked', reason: 'no band 3 (the compile has 3)' });
  });
  it('folds the bands into one state program, env#band last, its initial assignment in the fold\'s band', () => {
    const sp = nativeBandProgram(derive(THREE), 'uikit');
    expect(sp.states.map((s) => [s.key, s.domain])).toEqual([['@env#band', [0, 1, 2]]]);
    expect(sp.assignments[sp.initial]?.assignment).toEqual([{ state: { instance: '@env', state: 'band' }, value: 2 }]);
  });
  it('without @media the band program is one band and the partition gives band 0', () => {
    const c = derive('.a { width: 10px; height: 5px; }');
    expect(nativeBands(c)).toBeNull();
    expect(nativeBandProgram(c, 'uikit').states.map((s) => [s.key, s.domain])).toEqual([['@env#band', [0]]]);
    expect(nativeBandOfViewport(c, { width: 1, height: 1 })).toBe(0);
  });
});

describe('R8: transitions a size change would start are refused on native until MQ-Rt', () => {
  const R8 = /would start when the screen size changes; transitions started by size changes are not built yet \(package MQ-Rt\)$/;
  const compile = (css: string) => {
    const i = input(css);
    const c = createProject({ projectId: 'test', targets: { ...NATIVE, web: {} } }).compile(i);
    return { c, refusals: c.diagnostics.filter((d) => R8.test(d.message)).map((d) => [d.code, d.target, spanTextOf(i, d), d.message]) };
  };
  it('a transitioned property whose value differs between bands, on ios and android, at the transition', () => {
    const { c, refusals } = compile('.a { width: 10px; height: 5px; transition: width 1s; } @media (max-width: 320px) { .a { width: 20px; } }');
    expect(refusals).toEqual(['ios', 'android'].map((t) => ['DRAGON_UNSUPPORTED_VALUE', t, 'width 1s', 'transition on width of a would start when the screen size changes; transitions started by size changes are not built yet (package MQ-Rt)']));
    expect(c.outputs.web.kind).toBe('ready');
    expectCatalogued(c.diagnostics);
  });
  it('a transitioned property whose value reads the viewport, with no @media (M9)', () => {
    expect(compile('.a { width: 50vw; height: 5px; transition: width 1s; }').refusals.map((r) => r[1])).toEqual(['ios', 'android']);
    expect(compile('.a { width: 10px; margin-right: clamp(20px, 22vw, 1000px); height: 5px; transition: margin-right 1s; }').refusals.map((r) => r[1])).toEqual(['ios', 'android']);
  });
  it('not a % value, which stays a percentage at computed time, nor a property no band changes, nor a zero duration', () => {
    expect(compile('.a { width: 50%; height: 5px; transition: width 1s; } @media (max-width: 320px) { .b { width: 20px; } }').refusals).toEqual([]);
    expect(compile('.a { width: 10px; height: 5px; transition: height 1s; } @media (max-width: 320px) { .a { width: 20px; } }').refusals).toEqual([]);
    expect(compile('.a { width: 10px; height: 5px; transition: width 0s; } @media (max-width: 320px) { .a { width: 20px; } }').refusals).toEqual([]);
  });
  it('a transition listed only inside a band still counts, once per element and property', () => {
    expect(compile('.a { width: 10px; height: 5px; } @media (max-width: 320px) { .a { width: 20px; transition: width 1s; } }').refusals.map((r) => r[1])).toEqual(['ios', 'android']);
  });
});

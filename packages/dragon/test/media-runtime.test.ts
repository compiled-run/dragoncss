// MQ-R1 (notes/T067-mq-r-spec.md R4, R5, R8): a native compile resolves and lowers every @media band, and records the band table
// and every band's programs; a transition a size change would start is refused on native until MQ-Rt (R8, reject-mqr-transition:
// it blocks ios and android and not web, so it is a test here rather than a parity reject fixture, which must block every output).
import { describe, expect, it } from 'vitest';
import type { Compiled, FrontEndResult } from '../src/index.ts';
import { createProject } from '../src/index.ts';
import { createProjectWith, MAX_STATE_TABLE_ASSIGNMENTS, nativeBandOfViewport, nativeBandProgram, nativeBandPrograms, nativeBands, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { bandEnvironmentOf, bandTableOf, refuseBandedStateSpace } from '../src/lower/band-program.ts';
import { DESKTOP_DEVICE } from '../src/media/index.ts';
import { rtBand } from '@dragon/layout';
import { band, parseMediaQueryList } from '../src/media/index.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/index.ts';
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

describe('the native refusals MQ-R1 adds beside R8 (PR #140 review)', () => {
  const publicCompile = (css: string, targets: Record<string, unknown> = { ...NATIVE, web: {} }) => {
    const i = input(css);
    const c = createProject({ projectId: 'test', targets: targets as typeof NATIVE & { web?: object } }).compile(i);
    return { i, c };
  };
  it('an animation or transition declared in a rule that applies only in some bands is refused on ios and android (MQ-Rt), not left to the fold band', () => {
    const { i, c } = publicCompile('.a { width: 10px; height: 5px; } @keyframes spin { to { background-color: red; } } @media (min-width: 400px) { .a { animation: spin 1s infinite; } }', NATIVE);
    const r = c.diagnostics.filter((d) => /inside @media is unsupported on (ios|android): transition and animation lists that differ between @media bands are not built yet \(package MQ-Rt\)$/.test(d.message));
    expect(r.map((d) => [d.code, d.target, spanTextOf(i, d)])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios', 'spin 1s infinite'], ['DRAGON_UNSUPPORTED_VALUE', 'android', 'spin 1s infinite']]);
    expect([c.outputs.ios.kind, c.outputs.android.kind]).toEqual(['blocked', 'blocked']);
    const t = publicCompile('.a { width: 10px; height: 5px; } @media (max-width: 300px) { .a { transition: background-color 1s; } }', NATIVE).c;
    expect(t.diagnostics.filter((d) => d.message.startsWith('transition inside @media is unsupported on')).map((d) => d.target)).toEqual(['ios', 'android']);
    expectCatalogued([...c.diagnostics, ...t.diagnostics]);
  });
  it('the other bands\' animation analyses report too: a keyframe property refused only in a non-fold band blocks the output', () => {
    const c = derive('.a { width: 10px; height: 5px; } @keyframes k { to { flex-grow: 2; } } @media (max-width: 300px) { .a { animation: k 1s; } }');
    expect(c.diagnostics.some((d) => d.message.startsWith('flex-grow in @keyframes k cannot be animated yet'))).toBe(true);
  });
  it('thresholds within 1/64 px are accepted natively: MQ-R0\'s partition holds every combination Chrome\'s slack gives, so the lookup finds a band', () => {
    const { c } = publicCompile('.a { width: 10px; height: 5px; } @media (width <= 400px) { .a { width: 20px; } } @media (width > 400px) { .a { width: 30px; } }');
    expect(c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_AT_RULE')).toEqual([]);
    const p = band(['(width <= 400px)', '(width > 400px)'].map((x) => parseMediaQueryList(x)));
    if (p.kind !== 'bands') throw new Error(p.detail);
    // The review's root: 1400 px at DPR 3.5 is 400.0000305 css px, where both atoms hold (vector 11).
    const k = rtBand.bandAtPx(bandTableOf(p), 1400, 1000, { ...bandEnvironmentOf(DESKTOP_DEVICE), dpr: 3.5 }, rtBand.NO_BAND_FAULTS);
    expect(p.bands[k]?.truth).toEqual([true, true]);
  });
  it('the (assignment, band) pairs of a native state table are capped at 64, as a diagnostic at the first @media', () => {
    const text = '@media (max-width: 300px) { .a { width: 1px; } }';
    const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
    const rules = parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, [], []);
    const conditions = rules.flatMap((r) => r.condition ?? []);
    const out: Diagnostic[] = [];
    refuseBandedStateSpace(32, 2, conditions, ['ios', 'android'], out);
    expect(out).toEqual([]);
    refuseBandedStateSpace(5, 16, conditions, ['ios', 'android'], out);
    expect(out.map((d) => [d.code, d.target, d.message])).toEqual(['ios', 'android'].map((t) => ['DRAGON_STATE_SPACE_LIMIT', t, `5 reachable assignments in 16 @media bands are 80 (assignment, band) pairs, above the ${t} state table limit of ${MAX_STATE_TABLE_ASSIGNMENTS}`]));
    expectCatalogued(out);
  });
  it('a document id starting with @ is invalid input: @ is reserved for the environment states (@env#band)', () => {
    const i = input('.a { width: 10px; }');
    const tree = i.tree as NonNullable<FrontEndResult['tree']>;
    const bad = { ...i, tree: { ...tree, documents: tree.documents.map((d) => ({ ...d, id: '@env' })) } } as FrontEndResult;
    const c = createProject({ projectId: 'test', targets: NATIVE }).compile(bad);
    expect(c.diagnostics.some((d) => d.message.includes('document id "@env" must not start with "@"'))).toBe(true);
    expect(c.ok).toBe(false);
  });
});

// P4 item 8 (notes/T013-p3-review-p4-plan.md section 2): the public android target. minSdk is an integer API level from 31 to 36 (owner decision: Android 12);
// its output stays analysis-only; with the all-unsupported android profile a declared feature blocks it (fail closed); a config
// without android keeps every diagnostic, output and digest of the same config before P4.
import { describe, expect, it } from 'vitest';
import { createProject, querySupport } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativeLayoutProjection } from '../src/internal.ts';
import { div, inputFor, text } from './helpers.ts';

const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const android = (minSdk: unknown) => createProject({ projectId: 'test', targets: { android: { minSdk } } as unknown as { android: { minSdk: number } } });
const empty = inputFor('', (r) => [div(r, 'a', [])]);

describe('the android target configuration', () => {
  for (const bad of [28, 29, 30, 37, 31.5, '31', Number.NaN, null]) {
    it(`minSdk ${JSON.stringify(bad)} is DRAGON_CONFIG_INVALID with a fix`, () => {
      const r = android(bad).check(empty);
      expect(r.diagnostics.map((d) => d.code)).toEqual(['DRAGON_CONFIG_INVALID']);
      const d = r.diagnostics[0];
      expect(d?.message).toMatch(/android needs exactly \{ minSdk: <integer from 31 to 36> \}/);
      expect(d?.fix !== null && 'manual' in (d?.fix ?? {}) ? (d?.fix as { manual: string }).manual : '').toMatch(/minSdk: 31/);
    });
  }
  it('an extra android key or an empty android object is DRAGON_CONFIG_INVALID', () => {
    expect(createProject({ projectId: 'test', targets: { android: { minSdk: 31, x: 1 } } as never }).check(empty).diagnostics.map((d) => d.code)).toEqual(['DRAGON_CONFIG_INVALID']);
    expect(createProject({ projectId: 'test', targets: { android: {} } as never }).check(empty).diagnostics.map((d) => d.code)).toEqual(['DRAGON_CONFIG_INVALID']);
  });
  it('{ android: { minSdk: 31 } } and every minSdk up to 36 compile', () => {
    for (let minSdk = 31; minSdk <= 36; minSdk++) {
      const c = createProject({ projectId: 'test', targets: { android: { minSdk } } }).compile(empty);
      expect(c.diagnostics).toEqual([]);
      expect(c.targets.android).toBe('checked');
    }
  });
});

describe('the android output', () => {
  it('an empty-CSS android compile is analysis-only, with a layout projection', () => {
    const c = createProject({ projectId: 'test', targets: { android: { minSdk: 31 } } }).compile(empty);
    expect(c.ok).toBe(true);
    expect(c.outputs.android.kind).toBe('analysis-only');
    if (c.outputs.android.kind === 'analysis-only') expect(c.outputs.android.reason).toMatch(/Android output is analysis-only/);
    expect(nativeLayoutProjection(c, ENV, []).kind).toBe('ready');
  });
  it('.a { width: 50px } on android is blocked with DRAGON_UNSUPPORTED_VALUE (the all-unsupported profile fails closed)', () => {
    const c = createProject({ projectId: 'test', targets: { android: { minSdk: 31 } } }).compile(inputFor('.a { width: 50px }', (r) => [div(r, 'a', ['a'])]));
    expect(c.targets.android).toBe('blocked');
    if (c.outputs.android.kind !== 'blocked') throw new Error(c.outputs.android.kind);
    expect(c.outputs.android.diagnostics.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android']]);
    expect(c.outputs.android.diagnostics[0]?.profile).toMatchObject({ target: 'android', feature: 'width:<length-px>', status: 'unsupported' });
  });
  it('with ios and android the same declaration is proven on ios and blocks only android', () => {
    const c = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }).compile(inputFor('.a { width: 50px }', (r) => [div(r, 'a', ['a'])]));
    expect(c.outputs.ios.kind).toBe('analysis-only');
    expect(c.outputs.android.kind).toBe('blocked');
  });
  it('font and lowering diagnostics are reported for every configured native target', () => {
    const css = 'body { font-family: serif; }';
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [div(r, 'a', [], [text(r, 't', 'X')])]));
    const fonts = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_FONT');
    expect(fonts.map((d) => d.target)).toEqual(['ios', 'android']);
    expect(fonts[0]?.message).toBe(fonts[1]?.message);
  });
  it('without android the digest, diagnostics and outputs of an ios and web compile are those of the same config without the android code', () => {
    const input = inputFor('body { margin: 0; font-family: Ahem; } .a { width: 50px; }', (r) => [div(r, 'a', ['a'], [text(r, 't', 'AB')])]);
    const a = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }).compile(input);
    const b = createProject({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {}, android: { minSdk: 31 } } }).compile(input);
    expect(Object.keys(a.outputs).sort()).toEqual(['ios', 'web']);
    expect(b.digest).not.toBe(a.digest);
    expect(b.outputs.web).toMatchObject({ kind: 'ready' });
    expect(a.diagnostics).toEqual([]);
  });
});

describe('querySupport with the android normalized target', () => {
  it('possibilities accept { kind: "android", minSdk } and answer from the all-unsupported profile', () => {
    expect(querySupport({ kind: 'possibilities', target: { kind: 'android', minSdk: 31 }, css: 'width: 1px' })).toMatchObject({ kind: 'unsupported', declaration: 'width: 1px' });
    for (const bad of [{ kind: 'android' }, { kind: 'android', minSdk: 28 }, { kind: 'android', minSdk: 31.5 }, { kind: 'android', minSdk: 31, x: 1 }]) {
      expect(querySupport({ kind: 'possibilities', target: bad as never, css: 'width: 1px' }).kind).toBe('invalid-query');
    }
  });
  it('a resolved query on a compiled android result reads the android profile', () => {
    const c = createProjectWith({ projectId: 'test', targets: { android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor('.a { width: 50px }', (r) => [div(r, 'a', ['a'])]));
    expect(querySupport({ kind: 'resolved', result: c, target: 'android', node: 'a', instance: 'doc', assignment: [], property: 'width' })).toMatchObject({ kind: 'decided', cases: [{ decision: null }] });
  });
});

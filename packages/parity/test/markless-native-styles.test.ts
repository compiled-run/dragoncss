// The Markless native-styles entry point (packages/dragon/src/native-styles.ts) over the ladder fixtures (fixture-groups/
// markless-styles.ts): each step emits for both backends from the same state program the device lanes run, and what native cannot
// do yet is a build error or a blocked target naming the property or selector, never output with the style dropped.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { FrontEndResult, NativeStyleOutput, NativeStyles, NativeStylesConfig } from 'dragon';
import { compileNativeStyles } from 'dragon';
import { FIXTURES } from '../src/fixtures.ts';
import { PROJECT_ID } from '../src/fixture-reader.ts';
import { stateGroups, stateProgramOf } from '../src/state-cases.ts';
import { readTreeFixture } from '../src/tree-fixture.ts';
import { EXPORT_DEVICES, NATIVE_STYLE_EXPORT_SCHEMA, nativeStyleExport } from '../src/native-style-export.ts';

const CONFIG: NativeStylesConfig = { projectId: PROJECT_ID, name: 'Ladder', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } }, viewport: { width: 390, height: 844 } };

const emitted = (r: NativeStyles, t: 'ios' | 'android'): NativeStyleOutput => {
  const o = r.targets[t];
  if (o === undefined || o.kind !== 'emitted') throw new Error(`${t}: ${o === undefined ? 'not configured' : o.reason}`);
  return o;
};

/** A ladder fixture with one stylesheet's text replaced, padded with spaces to the same length so every origin stays put. */
function withCss(id: string, sheet: string, css: string): FrontEndResult {
  const input = readTreeFixture(id);
  const use = input.tree?.styles.find((s) => s.id === sheet);
  if (use === undefined || input.tree === null) throw new Error(`${id}: no sheet ${sheet}`);
  const length = use.css.end - use.css.start;
  if (css.length > length) throw new Error(`${id}: the replacement is longer than the ${length} characters of ${sheet}`);
  const source = input.snapshot.sources.find((s) => s.ref.uri === use.css.source.uri);
  if (source === undefined) throw new Error(`${id}: no source ${use.css.source.uri}`);
  const text = `${source.text.slice(0, use.css.start)}${css.padEnd(length, ' ')}${source.text.slice(use.css.end)}`;
  const ref = { ...source.ref, hash: `sha256:${sha256(text)}` };
  const retag = <T>(v: T): T => JSON.parse(JSON.stringify(v), (k, x: unknown) => (k === 'source' && (x as { uri?: string } | null)?.uri === ref.uri ? ref : x)) as T;
  const sources = input.snapshot.sources.map((s) => (s === source ? { ...s, text, ref } : s));
  return { ...input, snapshot: { ...input.snapshot, sources }, tree: retag(input.tree) };
}

const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

describe('the ladder emits both backends from the lanes\' state program', () => {
  for (const id of ['ms-box', 'ms-text', 'ms-flex', 'ms-toggle']) {
    it(id, () => {
      expect(FIXTURES.some((f) => f.id === id && f.kind === 'layout')).toBe(true);
      const r = compileNativeStyles(CONFIG, readTreeFixture(id));
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(r.ok).toBe(true);
      const ios = emitted(r, 'ios');
      const android = emitted(r, 'android');
      expect(ios.files.map((f) => f.path)).toEqual(['Cases/DragonLadderStates.swift']);
      expect(android.files.map((f) => f.path)).toEqual(['kotlin/dev/dragon/cases/DragonLadderStates.kt']);
      expect(ios.files[0]?.text).toContain('public final class DragonLadderStates {');
      expect(android.files[0]?.text).toContain('class DragonLadderStates {');
      // The device lanes judge exactly this program: the lane group's state program of the same fixture is the same data.
      const group = stateGroups().find((g) => g.id === id);
      if (group !== undefined) {
        expect(ios.program).toEqual(stateProgramOf(group, 'uikit'));
        expect(android.program).toEqual(stateProgramOf(group, 'android-views'));
      } else {
        expect(ios.program.assignments).toHaveLength(1);
      }
    });
  }

  it('ms-toggle: one typed setter switches the class at run time, from deltas the compiler wrote once', () => {
    const r = compileNativeStyles(CONFIG, readTreeFixture('ms-toggle'));
    const ios = emitted(r, 'ios');
    expect(ios.program.assignments).toHaveLength(2);
    expect(ios.files[0]?.text).toContain('public func set_doc_app_chip_selected(_ v: Bool)');
    expect(emitted(r, 'android').files[0]?.text).toContain('fun set_doc_app_chip_selected(v: Boolean)');
    // The selected state's rounded corners and wider dot are in its delta, not re-resolved on the device.
    const delta = ios.program.deltas.find((d) => d.changed.length > 0);
    expect(delta?.changed.map((n) => n.id).sort()).toEqual(['app/chip/chip', 'app/chip/dot']);
    expect(ios.files[0]?.text).toContain('.radii([RadiusLength(false, 6.0)');
    expect(ios.files[0]?.text).not.toMatch(/\.chip|selected \{|border-color/);
  });
});

describe('what native cannot do yet is an error that names it', () => {
  const errors = (r: NativeStyles): string[] => r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} [${d.target ?? 'all'}] ${d.message}`);

  it(':active compiles only once its device proof passes: until then a build error per native target', () => {
    const r = compileNativeStyles(CONFIG, readTreeFixture('ms-press'));
    expect(r.ok).toBe(false);
    expect(r.targets.ios).toEqual({ kind: 'blocked', reason: 'the ios compile has errors; see the diagnostics' });
    expect(r.targets.android?.kind).toBe('blocked');
    for (const t of ['ios', 'android']) expect(errors(r)).toContain(`DRAGON_UNSUPPORTED_SELECTOR [${t}] :active is not supported on ${t}: no passing device proof of selector:pseudo-class(:active) in interaction/mouse, selector:pseudo-class(:active) in interaction/touch (support profile m1-s5)`);
  });

  it(':disabled compiles as the disabled attribute\'s state; the fixture stays refused for its :active on a button', () => {
    const r = compileNativeStyles(CONFIG, readTreeFixture('reject-ms-button-disabled'));
    expect(r.ok).toBe(false);
    expect(errors(r).filter((e) => e.includes(':disabled') || e.includes('attribute disabled'))).toEqual([]);
    expect(errors(r).some((e) => e.includes(':active'))).toBe(true);
  });

  it('a family fallback list on native is refused, naming font-family; an unmapped family is refused everywhere', () => {
    const css = '.label { font-family: Helvetica, sans-serif; font-size: 12px; }';
    const mapped = compileNativeStyles({ ...CONFIG, fonts: { generics: { 'sans-serif': { mode: 'platform' } }, families: { Helvetica: { mode: 'platform' } } } }, withCss('ms-text', 'app', css));
    expect(mapped.ok).toBe(false);
    for (const t of ['ios', 'android']) expect(errors(mapped)).toContain(`DRAGON_UNSUPPORTED_VALUE [${t}] font-family: Helvetica , sans-serif is unsupported (support profile m1-s5); in text-in-block/ltr use Ahem, inherit or revert`);
    const unmapped = compileNativeStyles(CONFIG, withCss('ms-text', 'app', css));
    expect(errors(unmapped)).toContain('DRAGON_FONT_UNMAPPED_FAMILY [all] font-family: Helvetica,sans-serif: the family "Helvetica" is neither declared with @font-face nor in the font map, so it would be a font installed on the machine');
  });

  it('a state write the native runtime has no writer for blocks the target, naming the write', () => {
    const css = '.chip { width: 80px; height: 20px; background-color: #fff; } .chip.selected { box-shadow: 0 0 0 2px #06c; } .dot { width: 8px; height: 8px; }';
    const r = compileNativeStyles(CONFIG, withCss('ms-toggle', 'chip', css));
    expect(r.ok).toBe(false);
    expect(r.targets.ios).toEqual({ kind: 'blocked', reason: 'app/chip/chip: the state runtime cannot write box-shadow yet' });
    expect(r.targets.android).toEqual({ kind: 'blocked', reason: 'app/chip/chip: the state runtime cannot write box-shadow yet' });
  });

  it('a config with one native target emits it without the other target configured', () => {
    const both = compileNativeStyles(CONFIG, readTreeFixture('ms-toggle'));
    for (const t of ['ios', 'android'] as const) {
      const only = compileNativeStyles({ ...CONFIG, targets: { [t]: CONFIG.targets[t] } }, readTreeFixture('ms-toggle'));
      expect(only.ok, t).toBe(true);
      expect(Object.keys(only.targets)).toEqual([t]);
      expect(emitted(only, t).program).toEqual(emitted(both, t).program);
    }
  });

  it('refuses a config it cannot name generated code for', () => {
    expect(() => compileNativeStyles({ ...CONFIG, name: 'ladder' }, readTreeFixture('ms-box'))).toThrow(/not an identifier starting with an ASCII capital/);
    expect(() => compileNativeStyles({ ...CONFIG, targets: {} }, readTreeFixture('ms-box'))).toThrow(/at least one native target/);
    expect(() => compileNativeStyles({ ...CONFIG, viewport: { width: 0, height: 844 } }, readTreeFixture('ms-box'))).toThrow(/not a positive size/);
  });
});

describe('the native style export (dragon.native-style-export/1)', () => {
  it('ms-toggle: every assignment carries every node\'s writes and frame, and the transition table names them', () => {
    const styles = compileNativeStyles(CONFIG, readTreeFixture('ms-toggle'));
    const e = nativeStyleExport(styles, 'Ladder', 'packages/parity/fixtures/ms-toggle');
    expect(e.schema).toBe(NATIVE_STYLE_EXPORT_SCHEMA);
    expect(e.fonts).toEqual([]);
    for (const t of ['ios', 'android'] as const) {
      const x = e.targets[t];
      if (x === undefined) throw new Error(`no ${t}`);
      expect([x.viewport, x.dpr]).toEqual([EXPORT_DEVICES[t].viewport, EXPORT_DEVICES[t].dpr]);
      const r = emitted(styles, t).readiness;
      expect(x.readiness).toEqual(r.kind === 'analysis-only' ? { kind: 'analysis-only', reason: r.reason } : { kind: r.kind });
      expect(x.states).toEqual([{ key: 'doc/app/chip#selected', domain: [false, true] }]);
      expect(x.assignments.map((a) => a.values)).toEqual([{ 'doc/app/chip#selected': false }, { 'doc/app/chip#selected': true }]);
      expect(x.next).toEqual([[[0, 1]], [[0, 1]]]);
      const dot = x.assignments.map((a) => a.nodes.find((n) => n.id === 'app/chip/dot')?.frame?.width);
      // 8px and 16px CSS wide at the device's ratio: the selected state's own layout, not the initial one's.
      expect(dot).toEqual([8 * x.dpr, 16 * x.dpr]);
      const chip = x.assignments[1]?.nodes.find((n) => n.id === 'app/chip/chip');
      expect(chip?.writes.some((w) => w['kind'] === 'border-radius')).toBe(true);
      expect(Object.keys(chip ?? {})).toEqual(['id', 'parent', 'kind', 'native', 'text', 'frame', 'borderWidths', 'writes']);
    }
  });

  it('ms-text names the Ahem face by its vendored file', () => {
    const e = nativeStyleExport(compileNativeStyles(CONFIG, readTreeFixture('ms-text')), 'Ladder', 'packages/parity/fixtures/ms-text');
    expect(e.fonts).toEqual([{ id: 'Ahem', file: 'vendor/fonts/Ahem.ttf' }]);
  });

  it('refuses to export a blocked target', () => {
    expect(() => nativeStyleExport(compileNativeStyles(CONFIG, readTreeFixture('ms-press')), 'Ladder', 'x')).toThrow('Ladder: no export: ios the ios compile has errors; see the diagnostics; android the android compile has errors; see the diagnostics');
  });
});

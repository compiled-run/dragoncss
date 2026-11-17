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

  it(':disabled is refused on every target, naming the selector', () => {
    const r = compileNativeStyles(CONFIG, readTreeFixture('reject-ms-button-disabled'));
    expect(r.ok).toBe(false);
    expect(errors(r).some((e) => e.startsWith('DRAGON_UNSUPPORTED_SELECTOR [all] :disabled depends on user interaction or document state'))).toBe(true);
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

  it('refuses a config it cannot name generated code for', () => {
    expect(() => compileNativeStyles({ ...CONFIG, name: 'ladder' }, readTreeFixture('ms-box'))).toThrow(/not an identifier starting with an ASCII capital/);
    expect(() => compileNativeStyles({ ...CONFIG, targets: {} }, readTreeFixture('ms-box'))).toThrow(/at least one native target/);
    expect(() => compileNativeStyles({ ...CONFIG, viewport: { width: 0, height: 844 } }, readTreeFixture('ms-box'))).toThrow(/not a positive size/);
  });
});

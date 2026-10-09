// ANIM-b1 native runtime (notes/T065-anim-b-spec.md R2, R3, R4, R7, R16): the animation tables as typed literals of the translated
// engine, held to the generated Swift and Kotlin constructors; the state machine's animator hunks (mount, setter event, clock
// step); and the display driver, which only a mount that asks for it runs, so the lanes' clock stays the script's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AnimTables } from '@dragon/layout';
import { AnimEmitError, animSupport, animTablesLit, FAULT_ARITY, TABLE_FIELDS } from '../src/emit/runtime/anim.ts';
import { emitNativeSupport } from '../src/emit/native-support.ts';

const generated = fileURLToPath(new URL('../../layout/generated/', import.meta.url));
const swiftSources = ['RtAnimator.swift', 'RtEasing.swift'].map((f) => readFileSync(join(generated, 'swift/Sources/DragonLayout', f), 'utf8')).join('\n');
const kotlinSources = ['RtAnimator.kt', 'RtEasing.kt'].map((f) => readFileSync(join(generated, 'kotlin/src/main/kotlin/dev/dragon/layout', f), 'utf8')).join('\n');

/** The parameter names of a generated Swift class's init, in order. */
function swiftParams(cls: string): string[] {
  const at = swiftSources.indexOf(`public final class ${cls} `);
  expect(at, cls).toBeGreaterThan(-1);
  const init = /public init\(([^)]*)\)/.exec(swiftSources.slice(at));
  return (init?.[1] ?? '').split(', ').map((p) => (/^_ ([A-Za-z0-9]+):/.exec(p)?.[1] ?? `?${p}`));
}

/** The constructor property names of a generated Kotlin class, in order. */
function kotlinParams(cls: string): string[] {
  const at = kotlinSources.indexOf(`class ${cls}(\n`);
  expect(at, cls).toBeGreaterThan(-1);
  const body = kotlinSources.slice(at, kotlinSources.indexOf('\n)', at));
  return [...body.matchAll(/^ {2}val ([A-Za-z0-9]+):/gm)].map((m) => m[1] as string);
}

const EASE = { kind: 'cubic-bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1, steps: 1, position: 'end' } as const;
const NONE = { kind: 'none', r: 0, g: 0, b: 0, alpha: 0, px: 0, percent: 0, calc: false } as const;
const RED = { kind: 'color', r: 255, g: 0, b: 0, alpha: 1, px: 0, percent: 0, calc: false } as const;
const TABLES: AnimTables = {
  assignments: 2,
  slots: [{ node: 'a', property: 'background-color', kind: 'color', range: 'all', values: [NONE, RED], listings: [{ present: true, mode: 'listed', delay: 0, duration: 0.3, easing: EASE }, { present: true, mode: 'listed', delay: -0.1, duration: 0.3, easing: EASE }] }],
  animations: [{ node: 'a', lists: [[], [{ name: 'spin "x"', hasKeyframes: true, paused: false, delay: 0, duration: 20, iterations: Infinity, direction: 'alternate', fill: 'both', easing: EASE }]] }],
  keyframes: [{ name: 'spin "x"', blocks: [{ offsets: [0, 0.5], hasEasing: false, easing: EASE, values: [{ property: 'width', value: { ...NONE, kind: 'length', px: 10, percent: 50, calc: true } }] }] }],
  rendered: [{ node: 'a', values: [true, false] }],
  bases: [{ node: 'a', property: 'width', kind: 'length', range: 'non-negative', values: [NONE, NONE] }],
  closure: [{ source: { node: 'a', property: 'color' }, writes: [{ node: 'b', property: 'color' }] }],
};

describe('ANIM-b1: the animation tables as typed literals', () => {
  it('names every table class field in the order of the generated Swift and Kotlin constructors', () => {
    for (const [cls, fields] of Object.entries(TABLE_FIELDS)) {
      expect(swiftParams(cls), `${cls} (Swift)`).toEqual([...fields]);
      expect(kotlinParams(cls), `${cls} (Kotlin)`).toEqual([...fields]);
    }
    // The glue builds the fault records with every fault off, one false per field.
    for (const [cls, n] of Object.entries(FAULT_ARITY)) {
      expect(swiftParams(cls).length, cls).toBe(n);
      expect(kotlinParams(cls).length, cls).toBe(n);
    }
  });

  it('writes every value: strings escaped, an infinite iteration count as the platform infinity, one constant per table record', () => {
    const swift = animTablesLit('swift', TABLES, 'p');
    expect(swift.decls.map((d) => d.slice(0, d.indexOf(':')))).toEqual(['private let pSlot0', 'private let pAnimation0', 'private let pKeyframes0', 'private let pRendered0', 'private let pBase0', 'private let pClosure0']);
    const all = [...swift.decls, swift.expr].join('\n');
    expect(all).toContain('EntryCode(JsString("spin \\"x\\""), true, false, 0.0, 20.0, Double.infinity, JsString("alternate"), JsString("both"), EasingCode(JsString("cubic-bezier"), 0.25, 0.1, 0.25, 1.0, 1.0, JsString("end")))');
    expect(all).toContain('ListingCode(true, JsString("listed"), -0.1, 0.3, ');
    expect(all).toContain('ValueCode(JsString("length"), 0.0, 0.0, 0.0, 0.0, 10.0, 50.0, true)');
    expect(all).toContain('ClosureTable(TrackRef(JsString("a"), JsString("color")), JsArray<TrackRef>([TrackRef(JsString("b"), JsString("color"))]))');
    expect(swift.expr).toBe('AnimTables(2.0, JsArray<SlotTable>([pSlot0]), JsArray<AnimationTable>([pAnimation0]), JsArray<KeyframesTable>([pKeyframes0]), JsArray<RenderedTable>([pRendered0]), JsArray<BaseTable>([pBase0]), JsArray<ClosureTable>([pClosure0]))');
    const kotlin = animTablesLit('kotlin', TABLES, 'p');
    const kall = [...kotlin.decls, kotlin.expr].join('\n');
    expect(kall).toContain('EntryCode("spin \\"x\\"", true, false, 0.0, 20.0, Double.POSITIVE_INFINITY, "alternate", "both", ');
    expect(kall).toContain('RenderedTable("a", jsArrayOf<Boolean>(true, false))');
    expect(kall).toContain('AnimationTable("a", jsArrayOf<JsArray<EntryCode>>(jsArrayOf<EntryCode>(), jsArrayOf<EntryCode>(EntryCode(');
  });

  it('refuses a record with a missing or unknown field, and a number that is not finite (other than an infinite count)', () => {
    expect(() => animTablesLit('swift', { ...TABLES, slots: [Object.fromEntries(Object.entries(TABLES.slots[0] as object).filter(([k]) => k !== 'range'))] } as unknown as AnimTables, 'p')).toThrow(/slots\[0\]: SlotTable lacks range/);
    expect(() => animTablesLit('kotlin', { ...TABLES, rendered: [{ node: 'a', values: [true, false], extra: 1 }] } as unknown as AnimTables, 'p')).toThrow(/rendered\[0\]: RenderedTable has unknown extra/);
    expect(() => animTablesLit('swift', { ...TABLES, slots: [{ ...TABLES.slots[0], values: [NONE, { ...RED, r: Number.NaN }] }] } as unknown as AnimTables, 'p')).toThrow(AnimEmitError);
    expect(() => animTablesLit('swift', { ...TABLES, keyframes: [{ name: 'k', blocks: [{ ...TABLES.keyframes[0]?.blocks[0], offsets: [-Infinity] }] }] } as unknown as AnimTables, 'p')).toThrow(/offsets\[0\]: -Infinity is not a table number/);
  });
});

describe('ANIM-b1: the state machine runs the animator', () => {
  const swift = emitNativeSupport('uikit').map((f) => f.text).join('\n');
  const kotlin = emitNativeSupport('android-views').map((f) => f.text).join('\n');

  it('ships the animation support on both backends, after the state runtime', () => {
    const paths = (b: 'uikit' | 'android-views') => emitNativeSupport(b).map((f) => f.path);
    expect(paths('uikit').slice(-3)).toEqual(['Support/DragonClock.swift', 'Support/DragonState.swift', 'Support/DragonAnim.swift']);
    expect(paths('android-views').slice(-3)).toEqual(['kotlin/dev/dragon/views/DragonClock.kt', 'kotlin/dev/dragon/views/DragonState.kt', 'kotlin/dev/dragon/views/DragonAnim.kt']);
    expect(animSupport('uikit', () => '').text).toContain('public final class DragonAnimator');
    expect(animSupport('android-views', () => '').text).toContain('class DragonAnimator(');
  });

  it('holds every mount weakly from a global map keyed by its machine (the mount holds the machine, so a strong value never frees it)', () => {
    const kotlin = emitNativeSupport('android-views').map((f) => f.text).join('\n');
    const swift = emitNativeSupport('uikit').map((f) => f.text).join('\n');
    // Every Kotlin map whose value is a mount: its value is a WeakReference.
    const kMaps = [...kotlin.matchAll(/(?:Weak)?HashMap<\s*DragonStateMachine\s*,\s*([^\n]*?)>\(\)/g)].map((m) => m[1] as string);
    expect(kMaps.some((v) => v.includes('DragonAnimMount'))).toBe(true);
    for (const v of kMaps) if (/Mount/.test(v)) expect(v, v).toMatch(/^java\.lang\.ref\.WeakReference<\w+Mount>$/);
    expect(kotlin).toContain('dragonAnimMounts[m]?.get()');
    // Every Swift map table whose value is a mount holds it weakly.
    const sMaps = [...swift.matchAll(/NSMapTable<DragonStateMachine, (\w+)>\(keyOptions: \.(\w+), valueOptions: \.(\w+)\)/g)];
    expect(sMaps.some((m) => m[1] === 'DragonAnimMount')).toBe(true);
    for (const m of sMaps) {
      expect(m[2], m[0]).toBe('weakMemory');
      if (/Mount/.test(m[1] as string)) expect(m[3], m[0]).toBe('weakMemory');
    }
  });

  it('lets a dropped mount go: the display driver reaches it only weakly, a detached stage pauses it, and dispose stops it for good', () => {
    for (const [backend, lang] of [['uikit', 'swift'], ['android-views', 'kotlin']] as const) {
      const t = emitNativeSupport(backend).map((f) => f.text).join('\n');
      // The frame callback (CADisplayLink, Choreographer) holds its tick strongly, so the tick must not hold the mount.
      const ticks = [...t.matchAll(/DragonDisplayDriver(?:\(tick: )?\s*\{([^\n]*)/g)].map((m) => m[1] as string);
      expect(ticks.length, lang).toBe(1);
      const tick = ticks[0] as string;
      if (lang === 'swift') expect(tick.trim(), lang).toMatch(/^\[weak self\] dt in$/);
      else {
        expect(tick.trim(), lang).toBe('dt -> ref.get()?.tick(dt) ?: false }');
        expect(t, lang).toContain('val ref = java.lang.ref.WeakReference(this)\n      driver = DragonDisplayDriver {');
      }
      // A stop path on both: the driver removes its frame callback, the mount's dispose stops it, and nothing restarts it after.
      expect(t, lang).toContain(lang === 'swift' ? 'link?.invalidate()' : 'Choreographer.getInstance().removeFrameCallback(this)');
      expect(t, lang).toMatch(lang === 'swift' ? /public func dispose\(\) \{\n {4}disposed = true\n {4}driver\?\.stop\(\)/ : /fun dispose\(\) \{\n {4}disposed = true\n {4}driver\?\.stop\(\)/);
      expect(t, lang).toContain(lang === 'swift' ? 'if let d = driver, animator.busy, !paused, !disposed { d.start() }' : 'if (animator.busy && !paused && !disposed) d.start()');
      expect(t, lang).toContain(lang === 'swift' ? 'public func dispose() { anim?.dispose() }' : 'anim?.dispose()');
    }
    // Android: the stage's attach listener pauses and resumes the driver through a weak reference, and dispose removes it.
    const k = emitNativeSupport('android-views').map((f) => f.text).join('\n');
    expect(k).toContain('override fun onViewDetachedFromWindow(v: android.view.View) { ref.get()?.stop() }');
    expect(k).toContain('override fun onViewAttachedToWindow(v: android.view.View) { ref.get()?.resume() }');
    expect(k).toContain('if (attach != null) stage.removeOnAttachStateChangeListener(attach)');
  });

  it('keeps state.ts to its hooks: one adapter per mount, its event before each render, the patched input and the frame drawn after layout', () => {
    for (const [lang, t] of [['swift', swift], ['kotlin', kotlin]] as const) {
      const state = t.slice(t.indexOf(lang === 'swift' ? 'public final class DragonStateMount' : 'class DragonStateMount('));
      const mount = state.slice(0, state.indexOf(lang === 'swift' ? '\n}\n' : '\n}\n'));
      expect(mount.match(/anim\?\.(event\(\)|input\(|draw\(t\))/g), lang).toEqual(['anim?.event()', 'anim?.input(', 'anim?.draw(t)']);
      expect(mount, lang).toContain(lang === 'swift' ? 'anim = DragonAnimMount(machine, measurer, display: display)' : 'DragonAnimMount.of(machine, measurer, display)');
      // The machine itself carries nothing of the animation: the tables are attached to it by the per-program sources.
      const machine = t.slice(t.indexOf(lang === 'swift' ? 'public final class DragonStateMachine' : 'class DragonStateMachine('), t.indexOf(lang === 'swift' ? 'public final class DragonStateMount' : 'class DragonStateMount('));
      expect(machine, lang).not.toMatch(/anim/i);
      // The adapter moves with the machine's clock (R2) and writes the background through the background module's writer.
      expect(t, lang).toContain(lang === 'swift' ? 'machine.clock.onAdvance = { [weak self] ms in self?.advance(ms) }' : 'machine.clock.onAdvance = { ms -> advance(ms) }');
      expect(t, lang).toMatch(/dragonBackground\((b|v), (c|it)\)/);
      // The frame colour goes through the paint writer (PNT1-radius rounded fill), never straight to the platform property.
      expect(t, lang).not.toMatch(/backgroundColor = dragonUIColor\(animator|setBackgroundColor\(.*animator/);
    }
  });

  it('runs the display driver only on a mount that asks for it, so the lanes never read the wall clock (plant laneUsesWallClock)', () => {
    expect(swift).toContain('display: Bool = false');
    expect(kotlin).toContain('display: Boolean = false');
    expect(swift.match(/DragonDisplayDriver\(tick:/g)?.length).toBe(1);
    expect(swift).toMatch(/if display \{\n {6}driver = DragonDisplayDriver\(tick:/);
    // Kotlin builds the driver's weak reference to the mount first, inside the same branch.
    expect(kotlin).toMatch(/if \(display\) \{\n(?: {6}(?:\/\/[^\n]*|val ref = java\.lang\.ref\.WeakReference\(this\))\n)* {6}driver = DragonDisplayDriver \{/);
    expect(kotlin.match(/DragonDisplayDriver \{/g)?.length).toBe(1);
    // R16: no platform animation API, and no timer but the display link and the choreographer.
    for (const t of [swift, kotlin]) expect(t).not.toMatch(/CABasicAnimation|CAKeyframeAnimation|UIView\.animate|UIViewPropertyAnimator|ValueAnimator|ObjectAnimator|ViewPropertyAnimator|Timer\.scheduled|postDelayed/);
  });
});

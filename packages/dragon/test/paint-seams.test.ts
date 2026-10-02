// EMS (notes/T046-paint-spec.md §3 and §5.1): the paint seams are registered once, in final order, and are behaviour-preserving:
// background, border and clip lower, emit and read back through their modules; every other module is an empty stub; programs
// gain a host (the DOM parent) and a facts record that nothing projects; the native support dispatches paint through named
// registration points; and no emitted code uses a platform animator (RT-2).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeLengths } from '../src/analysis/computed.ts';
import type { ResolvedValue } from '../src/analysis/computed.ts';
import { PAINT_VALUES } from '../src/analysis/paint-values/index.ts';
import { LONGHANDS, SHORTHANDS } from '../src/css/properties.ts';
import * as backgroundLayers from '../src/css/properties/background-layers.ts';
import * as effects from '../src/css/properties/effects.ts';
import * as outline from '../src/css/properties/outline.ts';
import * as radius from '../src/css/properties/radius.ts';
import * as scrollbar from '../src/css/properties/scrollbar.ts';
import * as shadow from '../src/css/properties/shadow.ts';
import * as transform from '../src/css/properties/transform.ts';
import { SHORTHAND_HANDLERS } from '../src/css/shorthands/index.ts';
import { OUTLINE_SHORTHANDS } from '../src/css/shorthands/outline.ts';
import { RADIUS_SHORTHANDS } from '../src/css/shorthands/radius.ts';
import type { Longhand } from '../src/css/properties.ts';
import { applyPlant, emitNativeSupport, SUPPORT_FILES, SUPPORT_PLANTS } from '../src/emit/native-support.ts';
import { isPaintKind, nativePaints, PAINT_EMITTERS, paintPlants, stagePainters } from '../src/emit/paint/registry.ts';
import { PAINT_STAGES } from '../src/emit/paint/types.ts';
import type { BorderWrite } from '../src/lower/paint/border.ts';
import type { AnyLowering } from '../src/lower/paint/registry.ts';
import { checkPaintLowerings, PAINT_LOWERINGS } from '../src/lower/paint/registry.ts';
import type { PaintLowering } from '../src/lower/paint/types.ts';
import { PAINT_MODULE_NAMES } from '../src/lower/paint/types.ts';
import { createProjectWith, nativePrograms, NO_FAULTS, VOCABULARY, WRITE_CSS } from '../src/internal.ts';
import { div, inputFor, text } from './helpers.ts';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const CSS = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .a { padding: 3px; border: 2px dashed red; background-color: #3366ff; overflow: hidden; }';
const input = inputFor(CSS, (r) => [div(r, 'a', ['a'], [text(r, 't', 'AB'), div(r, 'b', [])])]);
const STUBS = PAINT_MODULE_NAMES.filter((n) => n !== 'background' && n !== 'border' && n !== 'clip');

function programs() {
  const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  const p = nativePrograms(c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

describe('EMS: the paint registries', () => {
  it('lowering, emission and paint values register every module once, in PAINT_MODULE_NAMES order', () => {
    expect([...PAINT_MODULE_NAMES]).toEqual(['background', 'border', 'clip', 'radius', 'shadow', 'effects', 'stacking', 'outline', 'transform', 'gradient', 'scroll', 'fixed', 'scrollbar', 'image', 'foreign-view', 'control']);
    expect(PAINT_LOWERINGS.map((m) => m.name)).toEqual([...PAINT_MODULE_NAMES]);
    expect(PAINT_EMITTERS.map((m) => m.name)).toEqual([...PAINT_MODULE_NAMES]);
    expect(PAINT_VALUES.map((m) => m.name)).toEqual([...PAINT_MODULE_NAMES]);
  });
  it('the paint write kinds are the background, border and clip modules\' and every one has a vocabulary entry on both backends', () => {
    expect(PAINT_EMITTERS.flatMap((m) => m.kinds)).toEqual(['background-color', 'border-widths', 'border-styles', 'border-colors', 'padding-box-clip']);
    for (const m of PAINT_LOWERINGS) {
      for (const k of Object.keys(m.css)) {
        expect(isPaintKind(k), k).toBe(true);
        expect(WRITE_CSS[k as keyof typeof WRITE_CSS]).toEqual((m.css as Record<string, readonly Longhand[]>)[k]);
        for (const b of ['uikit', 'android-views'] as const) expect(VOCABULARY[b][k as keyof (typeof VOCABULARY)['uikit']]).toEqual((m.vocabulary[b] as Record<string, unknown>)[k]);
      }
    }
    expect(Object.keys(VOCABULARY.uikit)).toEqual(['background-color', 'border-widths', 'border-styles', 'border-colors', 'padding-box-clip', 'font', 'text-color']);
    expect(isPaintKind('font')).toBe(false);
    expect(isPaintKind('text-color')).toBe(false);
  });
  it('the lowering registry refuses a write kind lowered by two modules, a vocabulary that disagrees with the longhands, or a reordered list', () => {
    expect(() => checkPaintLowerings(PAINT_LOWERINGS)).not.toThrow();
    const radius = PAINT_LOWERINGS.findIndex((m) => m.name === 'radius');
    const withBorderKinds = PAINT_LOWERINGS.map((m, i) => (i === radius ? { ...PAINT_LOWERINGS[1], name: 'radius' } : m)) as AnyLowering[];
    expect(() => checkPaintLowerings(withBorderKinds)).toThrow(/border-colors is lowered by two modules \(border and radius\)/);
    const border = PAINT_LOWERINGS[1] as PaintLowering<BorderWrite>;
    const uikitShort = { ...border, vocabulary: { ...border.vocabulary, uikit: { 'border-widths': border.vocabulary.uikit['border-widths'] } } } as unknown as AnyLowering;
    expect(() => checkPaintLowerings(PAINT_LOWERINGS.map((m, i) => (i === 1 ? uikitShort : m)))).toThrow(/border paint lowering's uikit vocabulary names border-widths, its longhands name/);
    expect(() => checkPaintLowerings([...PAINT_LOWERINGS].reverse())).toThrow(/not in PAINT_MODULE_NAMES order/);
  });
  it('the stub modules lower nothing, emit nothing and add no native code or plants', () => {
    for (const name of STUBS) {
      const e = PAINT_EMITTERS.find((m) => m.name === name);
      expect(e?.kinds, name).toEqual([]);
      expect(e?.plants, name).toEqual([]);
      for (const b of ['uikit', 'android-views'] as const) expect(e?.native[b], name).toEqual({ boxMembers: '', file: null, stages: {}, afterLayout: null, applied: null, roundedPath: null, container: null });
      expect(PAINT_LOWERINGS.find((m) => m.name === name)?.css, name).toEqual({});
    }
    // The border module (P6a) declares the two dash plants; every stub declares none.
    expect(paintPlants().map((p) => p.name)).toEqual(['dash-phase-1', 'dash-gap-unfitted']);
    expect(SUPPORT_PLANTS).toEqual(['glyph-offset-1', 'glyph-offset-y-1', 'dash-phase-1', 'dash-gap-unfitted']);
  });
});

describe('P6a: border styles the side painter cannot draw', () => {
  it('never reach a native program: groove, ridge, inset and outset beside a dashed side block the native case', () => {
    for (const k of ['groove', 'ridge', 'inset', 'outset']) {
      const css = `body { margin: 0; } .a { width: 20px; height: 20px; border: 3px dashed red; border-right-style: ${k}; }`;
      const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, (r) => [div(r, 'a', ['a'], [])]));
      const p = nativePrograms(c, []);
      expect(p.kind, k).toBe('blocked');
      expect(p.kind === 'blocked' ? p.reason : '', k).toBe(`a: border-right-style ${k} has no native paint technique`);
    }
  });
});

describe('EMS: programs', () => {
  it('host every node under its DOM parent and carry an empty facts record, with writes in registry order', () => {
    const p = programs();
    for (const prog of [p.uikit, p['android-views']]) {
      for (const n of prog.nodes) {
        expect(n.host, n.id).toBe(n.parent);
        expect(n.facts, n.id).toEqual({});
      }
      expect(prog.nodes.find((n) => n.id === 'a')?.writes.map((w) => w.kind)).toEqual(['background-color', 'border-widths', 'border-styles', 'border-colors', 'padding-box-clip']);
    }
  });
});

describe('EMS: native support', () => {
  it('emits the stages file and one file per paint module with native code, under Support/Paint and views/paint', () => {
    expect(SUPPORT_FILES.uikit).toEqual(['Support/DragonChecked.swift', 'Support/DragonFontTables.swift', 'Support/DragonViews.swift', 'Support/DragonBridge.swift', 'Support/DragonTree.swift', 'Support/DragonPaintStages.swift', 'Support/Paint/DragonPaintBackground.swift', 'Support/Paint/DragonPaintBorder.swift', 'Support/Paint/DragonPaintClip.swift', 'Support/DragonClock.swift', 'Support/DragonState.swift']);
    expect(SUPPORT_FILES['android-views']).toEqual(['kotlin/dev/dragon/views/DragonChecked.kt', 'kotlin/dev/dragon/views/DragonFontTables.kt', 'kotlin/dev/dragon/views/DragonViews.kt', 'kotlin/dev/dragon/views/DragonBridge.kt', 'kotlin/dev/dragon/views/DragonTree.kt', 'kotlin/dev/dragon/views/DragonPaintStages.kt', 'kotlin/dev/dragon/views/paint/DragonPaintBackground.kt', 'kotlin/dev/dragon/views/paint/DragonPaintBorder.kt', 'kotlin/dev/dragon/views/paint/DragonPaintClip.kt', 'kotlin/dev/dragon/views/DragonClock.kt', 'kotlin/dev/dragon/views/DragonState.kt']);
    for (const f of emitNativeSupport('android-views')) expect(f.text, f.path).toContain('\npackage dev.dragon.views\n');
  });
  it('applies a support plant only when its source text occurs exactly once across the support files', () => {
    const f = (path: string, text: string) => ({ path, text });
    expect(applyPlant([f('a', 'x = 0\n'), f('b', 'y\n')], 'x = 0\n', 'x = 1\n', 'p')).toEqual([f('a', 'x = 1\n'), f('b', 'y\n')]);
    expect(() => applyPlant([f('a', 'y\n')], 'x = 0\n', 'x = 1\n', 'p')).toThrow(/occurs 0 times, not once/);
    expect(() => applyPlant([f('a', 'x = 0\nx = 0\n')], 'x = 0\n', 'x = 1\n', 'p')).toThrow(/occurs 2 times, not once/);
    expect(() => applyPlant([f('a', 'x = 0\n'), f('b', 'x = 0\n')], 'x = 0\n', 'x = 1\n', 'p')).toThrow(/occurs 2 times, not once/);
    for (const b of ['uikit', 'android-views'] as const) for (const p of SUPPORT_PLANTS) expect(emitNativeSupport(b, p).filter((x, i) => x.text !== emitNativeSupport(b)[i]?.text), `${b} ${p}`).toHaveLength(1);
  });
  it('dispatches the box stages in CSS order, the after-layout hooks and the readback in registry order', () => {
    expect([...PAINT_STAGES]).toEqual(['outer-shadow', 'background', 'background-layers', 'inset-shadow', 'border', 'outline']);
    for (const [b, file, args] of [['uikit', 'Support/DragonPaintStages.swift', 'v, ctx, shape'], ['android-views', 'kotlin/dev/dragon/views/DragonPaintStages.kt', 'v, canvas, shape']] as const) {
      const text = emitNativeSupport(b).find((f) => f.path === file)?.text ?? '';
      const body = text.slice(text.indexOf('dragonPaintBox('), text.indexOf('Registration point (EMS): after every layout'));
      expect(body.match(/\/\/ [a-z-]+/g)).toEqual(PAINT_STAGES.map((s) => `// ${s}`));
      expect(stagePainters(b, 'border')).toEqual(['dragonPaintBorderStage']);
      expect(body).toContain(`dragonPaintBorderStage(${args})`);
      expect(text.indexOf('dragonAfterLayoutBorder(v, shape, scale)')).toBeLessThan(text.indexOf('dragonAfterLayoutClip(v, shape, scale)'));
      const applied = ['dragonAppliedBackground', 'dragonAppliedBorder', 'dragonAppliedClip'].map((f) => text.indexOf(`${f}(v)`));
      expect(applied.every((i) => i > 0)).toBe(true);
      expect([...applied].sort((x, y) => x - y)).toEqual(applied);
      expect(text).toMatch(b === 'uikit' ? /return nil\n}/ : /: Path\? = null\n/);
    }
    expect(nativePaints('uikit').filter((m) => m.native.file !== null).map((m) => m.stem)).toEqual(['DragonPaintBackground', 'DragonPaintBorder', 'DragonPaintClip']);
  });
  it('keeps the case code on the modules\' public writers, which repaint when a runtime write changes them', () => {
    const swift = emitNativeSupport('uikit').map((f) => f.text).join('\n');
    const kotlin = emitNativeSupport('android-views').map((f) => f.text).join('\n');
    for (const p of ['dragonBorderWidths', 'dragonBorderStyles', 'dragonBorderColors']) {
      expect(swift).toMatch(new RegExp(`public var ${p}: \\[[A-Za-z0-9]+\\] = .* \\{ didSet \\{ setNeedsDisplay\\(\\) \\} \\}`));
      expect(kotlin).toMatch(new RegExp(`var ${p} = .*\\n    set\\(value\\) \\{ field = value; invalidate\\(\\) \\}`));
    }
    expect(swift).toContain('public func dragonEnableClip()');
    expect(kotlin).toContain('fun dragonBackground(v: DragonBoxView, c: DragonRGBA8)');
    expect(swift).toContain('public func node(_ id: String) -> DragonNodeView?');
    expect(kotlin).toContain('fun node(id: String): DragonNodeView?');
  });
  it('uses no platform animator anywhere in emit/ (RT-2)', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(join(src, 'emit'))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/CABasicAnimation|CAKeyframeAnimation|UIView\.animate|UIViewPropertyAnimator|ValueAnimator|ObjectAnimator|ViewPropertyAnimator/);
  });
});

describe('EMS: CSS families and paint values', () => {
  it('registers the seven paint families and the two shorthand files empty', () => {
    for (const [name, fam] of [['RADIUS', radius], ['SHADOW', shadow], ['EFFECTS', effects], ['OUTLINE', outline], ['TRANSFORM', transform], ['BACKGROUND_LAYERS', backgroundLayers], ['SCROLLBAR', scrollbar]] as const) {
      const f = fam as unknown as Record<string, unknown>;
      expect(f[`${name}_LONGHANDS`], name).toEqual([]);
      expect(f[`${name}_SHORTHANDS`], name).toEqual([]);
      expect(f[`${name}_ASPECTS`], name).toEqual({});
    }
    expect(RADIUS_SHORTHANDS).toEqual({});
    expect(OUTLINE_SHORTHANDS).toEqual({});
    expect(Object.keys(SHORTHAND_HANDLERS).length).toBe(SHORTHANDS.length);
  });
  it('runs computePaintValues at the end of computeLengths; the stubs leave every value alone', () => {
    const text = readFileSync(join(src, 'analysis/computed.ts'), 'utf8');
    expect(text.match(/computePaintValues\(/g)).toHaveLength(1);
    expect(text).toContain('  computePaintValues(props, { em: own, rem: rootFontSize ?? own });\n}');
    const v = (value: number, unit: string): ResolvedValue => ({ value: { kind: 'length', value, unit }, origin: 'author' }) as unknown as ResolvedValue;
    const props = new Map<Longhand, ResolvedValue>([['font-size', v(10, 'px')], ['width', v(2, 'em')]]);
    computeLengths(props, 16, 16);
    expect([...props.entries()].map(([k, x]) => [k, x.value])).toEqual([['font-size', { kind: 'length', value: 10, unit: 'px' }], ['width', { kind: 'length', value: 20, unit: 'px' }]]);
    // SIZE-ar's aspect-ratio and REPL-a's object-fit and object-position are longhands.
    expect((LONGHANDS as readonly string[]).length).toBe(71);
  });
});

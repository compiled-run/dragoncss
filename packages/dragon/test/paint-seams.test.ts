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
import { isPaintKind, nativePaints, PAINT_EMITTERS, paintPlants, soleHook, stagePainters } from '../src/emit/paint/registry.ts';
import { PAINT_STAGES } from '../src/emit/paint/types.ts';
import type { BorderWrite } from '../src/lower/paint/border.ts';
import type { AnyLowering } from '../src/lower/paint/registry.ts';
import { checkPaintLowerings, PAINT_LOWERINGS } from '../src/lower/paint/registry.ts';
import type { PaintLowering } from '../src/lower/paint/types.ts';
import { PAINT_MODULE_NAMES } from '../src/lower/paint/types.ts';
import type { ElementNode } from '../src/internal.ts';
import { createProjectWith, emitAndroidViewsCases, emitUikitCases, nativePrograms, NO_FAULTS, VOCABULARY, WRITE_CSS } from '../src/internal.ts';
import { floorProblems } from './floor.ts';
import { always, div, inputFor, text } from './helpers.ts';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const CSS = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .a { padding: 3px; border: 2px dashed red; background-color: #3366ff; overflow: hidden; }';
const input = inputFor(CSS, (r) => [div(r, 'a', ['a'], [text(r, 't', 'AB'), div(r, 'b', [])])]);
// PIN-DERIVE: append-only floors (paint-seams-floor.json) stand where literal lists stood; a module adds entries without a test edit.
const FLOOR = new URL('./paint-seams-floor.json', import.meta.url);
const SEAMS_FLOOR = new URL('./seams-floor.json', import.meta.url);
/** A module that lowers, emits and adds nothing; EMS made every module past clip one, and a package fills it (PNT2: transform). */
const isStub = (name: string): boolean => {
  const e = PAINT_EMITTERS.find((m) => m.name === name);
  const empty = { boxMembers: '', file: null, stages: {}, afterLayout: null, applied: null, roundedPath: null, container: null };
  return e !== undefined && e.kinds.length === 0 && e.plants.length === 0 && Object.keys(PAINT_LOWERINGS.find((m) => m.name === name)?.css ?? {}).length === 0
    && (['uikit', 'android-views'] as const).every((b) => JSON.stringify(e.native[b]) === JSON.stringify(empty));
};
const STUBS = PAINT_MODULE_NAMES.filter(isStub);

function programs() {
  const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  const p = nativePrograms(c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

describe('EMS: the paint registries', () => {
  it('lowering, emission and paint values register every module once, in PAINT_MODULE_NAMES order', () => {
    // PIN-DERIVE: the EMS module order is a floor; a module appended later (T150a: visibility) needs no edit here.
    expect(floorProblems(FLOOR, 'paintModules', PAINT_MODULE_NAMES, true)).toEqual([]);
    expect(PAINT_LOWERINGS.map((m) => m.name)).toEqual([...PAINT_MODULE_NAMES]);
    expect(PAINT_EMITTERS.map((m) => m.name)).toEqual([...PAINT_MODULE_NAMES]);
    expect(PAINT_VALUES.map((m) => m.name)).toEqual([...PAINT_MODULE_NAMES]);
  });
  it('the paint write kinds are the background, border, clip and transform modules\' and every one has a vocabulary entry on both backends', () => {
    // Each module emits exactly the kinds it lowers, and no kind the floor holds is gone.
    for (const m of PAINT_EMITTERS) expect([...m.kinds], m.name).toEqual(Object.keys(PAINT_LOWERINGS.find((l) => l.name === m.name)?.css ?? {}));
    expect(floorProblems(FLOOR, 'paintKinds', PAINT_EMITTERS.flatMap((m) => m.kinds), true)).toEqual([]);
    for (const m of PAINT_LOWERINGS) {
      for (const k of Object.keys(m.css)) {
        expect(isPaintKind(k), k).toBe(true);
        expect(WRITE_CSS[k as keyof typeof WRITE_CSS]).toEqual((m.css as Record<string, readonly Longhand[]>)[k]);
        for (const b of ['uikit', 'android-views'] as const) expect(VOCABULARY[b][k as keyof (typeof VOCABULARY)['uikit']]).toEqual((m.vocabulary[b] as Record<string, unknown>)[k]);
      }
    }
    for (const b of ['uikit', 'android-views'] as const) expect(Object.keys(VOCABULARY[b]), b).toEqual([...PAINT_EMITTERS.flatMap((m) => m.kinds), 'font', 'text-color']);
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
  it('the stub modules lower nothing, emit nothing and add no native code or plants; a filled module never goes back to a stub', () => {
    expect(floorProblems(FLOOR, 'filledPaintModules', PAINT_MODULE_NAMES.filter((n) => !isStub(n)), false)).toEqual([]);
    for (const name of STUBS) {
      const e = PAINT_EMITTERS.find((m) => m.name === name);
      expect(e?.kinds, name).toEqual([]);
      expect(e?.plants, name).toEqual([]);
      for (const b of ['uikit', 'android-views'] as const) expect(e?.native[b], name).toEqual({ boxMembers: '', file: null, stages: {}, afterLayout: null, applied: null, roundedPath: null, container: null });
      expect(PAINT_LOWERINGS.find((m) => m.name === name)?.css, name).toEqual({});
    }
    // Each plant stays with the module that declared it (P6a: border's two dash plants); the support plants are the two glyph
    // plants, then the paint plants in registry order, then any later ones.
    expect(floorProblems(FLOOR, 'paintPlants', PAINT_EMITTERS.flatMap((m) => m.plants.map((p) => `${m.name}:${p.name}`)), true)).toEqual([]);
    expect(SUPPORT_PLANTS.slice(0, 2 + paintPlants().length)).toEqual(['glyph-offset-1', 'glyph-offset-y-1', ...paintPlants().map((p) => p.name)]);
    expect(floorProblems(FLOOR, 'supportPlants', SUPPORT_PLANTS, true)).toEqual([]);
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
  it('host every node under its DOM parent and carry only the stacking facts (every box; PNT1, rt-hit.ts reads them), with writes in registry order', () => {
    const p = programs();
    for (const prog of [p.uikit, p['android-views']]) {
      for (const n of prog.nodes) {
        expect(n.host, n.id).toBe(n.parent);
        expect(Object.keys(n.facts), n.id).toEqual(n.kind === 'text' ? [] : ['stacking']);
      }
      expect(prog.nodes.find((n) => n.id === 'a')?.writes.map((w) => w.kind)).toEqual(['background-color', 'border-widths', 'border-styles', 'border-colors', 'padding-box-clip']);
    }
  });
});

describe('EMS: native support', () => {
  it('emits the stages file and one file per paint module with native code, under Support/Paint and views/paint', () => {
    // The core files, the stages file, then one file per module with native code in registry order, then the runtime files.
    for (const [b, dir, paintDir, ext] of [['uikit', 'Support/', 'Support/Paint/', 'swift'], ['android-views', 'kotlin/dev/dragon/views/', 'kotlin/dev/dragon/views/paint/', 'kt']] as const) {
      const files = SUPPORT_FILES[b];
      const core = ['DragonChecked', 'DragonFontTables', 'DragonViews', 'DragonBridge', 'DragonTree', 'DragonPaintStages'].map((f) => `${dir}${f}.${ext}`);
      const paint = nativePaints(b).filter((m) => m.native.file !== null).map((m) => `${paintDir}${m.stem}.${ext}`);
      expect(files.slice(0, core.length + paint.length), b).toEqual([...core, ...paint]);
      expect(files.slice(core.length + paint.length).filter((f) => f.startsWith(paintDir)), b).toEqual([]);
      expect(floorProblems(FLOOR, `supportFiles:${b}`, files, true), b).toEqual([]);
    }
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
      // REPL-a: the image stage paints after the border, in registry order (CSS2 Appendix E: replaced content after the border).
      expect(stagePainters(b, 'border')).toEqual(['dragonPaintBorderStage', 'dragonPaintImageStage']);
      expect(body).toContain(`dragonPaintBorderStage(${args})`);
      expect(text.indexOf('dragonAfterLayoutBorder(v, shape, scale)')).toBeLessThan(text.indexOf('dragonAfterLayoutClip(v, shape, scale)'));
      // PIN-DERIVE: the readbacks are the modules' own, in registry order (background, border and clip among them); the rounded
      // path is nil until a module provides the hook (PNT1: radius), and then calls it.
      const readbacks = nativePaints(b).flatMap((m) => (m.native.applied === null ? [] : [m.native.applied]));
      expect(readbacks, b).toEqual(expect.arrayContaining(['dragonAppliedBackground', 'dragonAppliedBorder', 'dragonAppliedClip']));
      const applied = readbacks.map((f) => text.indexOf(`${f}(v)`));
      expect(applied.every((i) => i > 0)).toBe(true);
      expect([...applied].sort((x, y) => x - y)).toEqual(applied);
      const rounded = soleHook(b, 'roundedPath');
      if (rounded === null) expect(text).toMatch(b === 'uikit' ? /return nil\n}/ : /: Path\? = null\n/);
      else expect(text).toContain(`${rounded}(v, shape`);
    }
    // A module has a native file exactly when it is not a stub.
    for (const b of ['uikit', 'android-views'] as const) expect(nativePaints(b).filter((m) => m.native.file !== null).map((m) => m.name), b).toEqual(PAINT_MODULE_NAMES.filter((n) => !isStub(n)));
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
  it('registers the paint families, each empty until its package fills it (PNT2 filled transform), and wired when filled', () => {
    expect(transform.TRANSFORM_LONGHANDS).toEqual(['transform', 'transform-origin', 'will-change']);
    expect(transform.TRANSFORM_SHORTHANDS).toEqual([]);
    // PIN-DERIVE: an empty family is wholly empty; a filled one has an aspect per longhand, each a registered longhand, and a
    // handler per shorthand, so a family is never half registered.
    for (const [name, fam] of [['RADIUS', radius], ['SHADOW', shadow], ['EFFECTS', effects], ['OUTLINE', outline], ['TRANSFORM', transform], ['BACKGROUND_LAYERS', backgroundLayers], ['SCROLLBAR', scrollbar]] as const) {
      const f = fam as unknown as Record<string, unknown>;
      const longhands = f[`${name}_LONGHANDS`] as readonly string[];
      const shorthands = f[`${name}_SHORTHANDS`] as readonly string[];
      expect(Object.keys(f[`${name}_ASPECTS`] as object), name).toEqual([...longhands]);
      for (const l of longhands) expect((LONGHANDS as readonly string[]).includes(l), `${name} ${l}`).toBe(true);
      for (const s of shorthands) expect(Object.keys(SHORTHAND_HANDLERS), `${name} ${s}`).toContain(s);
    }
    for (const [name, handlers] of [['RADIUS', RADIUS_SHORTHANDS], ['OUTLINE', OUTLINE_SHORTHANDS]] as const) {
      for (const [s, h] of Object.entries(handlers)) expect(SHORTHAND_HANDLERS[s as keyof typeof SHORTHAND_HANDLERS], `${name} ${s}`).toBe(h);
    }
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
    // SIZE-ar: aspect-ratio is a longhand (box family, after max-height); PNT2 adds transform, transform-origin and will-change.
    // PIN-DERIVE: the seams floor holds every longhand there has been, in order, so none goes missing.
    expect(floorProblems(SEAMS_FLOOR, 'longhands', LONGHANDS, true)).toEqual([]);
  });
});

describe('REPL-a foreign view: the iframe src literal (author input in emitted Swift and Kotlin)', () => {
  it('escapes exactly as native-support.ts stringLit does, on quotes, backslashes, $, controls, non-ASCII and astral characters', async () => {
    const { srcLit } = await import('../src/emit/paint/foreign-view.ts');
    const { stringLit } = await import('../src/emit/native-support.ts');
    const srcs = ['https://example.com/a?b=1&c=2', 'a"b', 'a\\b', '${x}', '\\(x)', 'tab\there', 'nl\nhere', '\u0000\u007f', 'café', ' ', 'emoji 😀', ''];
    for (const s of srcs) {
      expect(srcLit(s, 'uikit'), s).toBe(stringLit('swift', s));
      expect(srcLit(s, 'android-views'), s).toBe(stringLit('kotlin', s));
    }
    expect(srcLit('a"b\\$', 'android-views')).toBe('"a\\"b\\\\\\$"');
    expect(srcLit(null, 'uikit')).toBe('nil');
    expect(srcLit(null, 'android-views')).toBe('null');
  });
});

describe('REPL-a foreign view: a production build loads the iframe src (R9)', () => {
  // A src with a $ (a Kotlin template character) and & and ?, padded with white space that HTML strips.
  const SRC = 'https://example.com/embed/x?autoplay=1&t=$1';
  const iframeInput = inputFor('body { margin: 0; } .v { display: block; width: 320px; height: 180px; border: 0; }', (r) => {
    const el = div(r, 'v', ['v']);
    return [{ ...el, tag: 'iframe', attributes: [{ name: 'src', value: [{ when: always, value: ` ${SRC}\n` }], origin: el.origin }] } as ElementNode];
  });
  const compiled = () => {
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(iframeInput);
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };
  /** The body of a top-level Swift or Kotlin function in an emitted file, from its signature to the closing brace in column 0. */
  const body = (text: string, signature: string): string => {
    const at = text.indexOf(signature);
    expect(at, signature).toBeGreaterThan(-1);
    return text.slice(at, text.indexOf('\n}\n', at));
  };

  it('lowers the src, passes it to dragonSetForeignView, and the shipped support loads it: only a lane host clears the flag', () => {
    const p = compiled();
    const one = { id: 'iframe', fixture: 'iframe', direction: 'ltr' as const, compilerDigest: 'd', viewport: { width: 400, height: 300 }, expectedDigests: [] };
    for (const b of ['uikit', 'android-views'] as const) {
      expect(p[b].nodes.find((n) => n.id === 'v')?.writes.find((w) => w.kind === 'foreign-view'), b).toMatchObject({ src: SRC });
    }
    const swiftCase = emitUikitCases([{ ...one, program: p.uikit }]).map((f) => f.text).join('\n');
    const kotlinCase = emitAndroidViewsCases([{ ...one, program: p['android-views'] }]).map((f) => f.text).join('\n');
    expect(swiftCase).toMatch(/dragonSetForeignView\(v\d+, src: "https:\/\/example\.com\/embed\/x\?autoplay=1&t=\$1"\)/);
    expect(kotlinCase).toMatch(/dragonSetForeignView\(v\d+, "https:\/\/example\.com\/embed\/x\?autoplay=1&t=\\\$1"\)/);
    // The support files are what a ready native output ships (project.ts nativeOutputState); none of them, and no case file,
    // clears the flag, so the web view loads the src it was given.
    const swift = emitNativeSupport('uikit').map((f) => f.text).join('\n');
    const kotlin = emitNativeSupport('android-views').map((f) => f.text).join('\n');
    for (const [name, t] of [['swift', swift], ['kotlin', kotlin], ['swift cases', swiftCase], ['kotlin cases', kotlinCase]] as const) {
      expect(t.match(/dragonForeignViewLoadsSrc\s*=/g)?.length ?? 0, name).toBe(name.endsWith('cases') ? 0 : 1);
    }
    expect(swift).toContain('\npublic var dragonForeignViewLoadsSrc = true\n');
    expect(kotlin).toContain('\nvar dragonForeignViewLoadsSrc = true\n');
    const swiftSet = body(swift, 'public func dragonSetForeignView(_ v: DragonBoxView, src: String?) {');
    expect(swiftSet).toContain('let target = dragonForeignViewLoadsSrc ? src : nil');
    expect(swiftSet).toContain('guard let url = URL(string: target ?? "about:blank")');
    expect(swiftSet.match(/\.load\(/g)).toEqual(['.load(']);
    expect(swiftSet).toContain('web.load(URLRequest(url: url))');
    const kotlinSet = body(kotlin, 'fun dragonSetForeignView(v: DragonBoxView, src: String?) {');
    expect(kotlinSet.match(/\.load[A-Za-z]*\(/g)).toEqual(['.loadUrl(']);
    expect(kotlinSet).toContain('web.loadUrl(if (dragonForeignViewLoadsSrc && src != null) src else "about:blank")');
  });
  // #72 landing device run: every Dragon group draws its children unclipped, and a WebView drawn without a clip cleared the whole
  // window behind it on the emulator (blank captures of the iframe fixtures). The host group clips the web view to its frame.
  it('the Android web view host group clips its web view to its frame, which no other Dragon group does', () => {
    const kotlin = emitNativeSupport('android-views').map((f) => f.text).join('\n');
    expect(body(kotlin, 'open class DragonGroup(ctx: Context) : ViewGroup(ctx) {')).toContain('\n    clipChildren = false\n');
    const host = body(kotlin, 'class DragonForeignHost(ctx: Context) : DragonGroup(ctx) {');
    expect(host).toContain('\n  init {\n    clipChildren = true\n  }\n');
    expect(kotlin.match(/clipChildren = true/g)).toEqual(['clipChildren = true']);
  });
});

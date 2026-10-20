// MASK-CLIP gradient masks: mask-image (and the mask shorthand, through the -webkit- aliases too) takes one linear or radial gradient
// with every length in px or an absolute unit; every target compiles it, and the native targets refuse it where the device mask
// would differ from Chrome's (analysis/mask.ts). The lowering writes the mask's one border-box layer, and the gradient module's
// support code rasterises it after every layout and masks the box view with it. The Chrome cases are fixture group mask-gradient;
// packages/parity/test/mask-gradient.test.ts proves Chrome's DstIn against the raster.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { maskGradientOf } from '../src/css/properties/mask.ts';
import { emitNativeSupport, SUPPORT_PLANTS } from '../src/emit/native-support.ts';
import { GRADIENT_EMITTER } from '../src/emit/paint/gradient.ts';
import { paintWriteLines } from '../src/emit/paint/registry.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/mask-gradient.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value (kind)`, or its diagnostics' codes. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)} (${l.value.kind === 'other' ? l.value.type : l.value.kind})`);
}

const project = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

const BODY = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';

/** Each error as `<target> <message>`, for a box a with class s holding a box b with class c holding Ahem text. */
function errorsOf(css: string): string[] {
  const c = project().compile(inputFor(`${BODY} ${css}`, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.message}`).sort();
}

/** The native refusals of a mask on a, by fact (the text between "on <target>: " and the native target's "; "). */
function nativeFacts(css: string): string[] {
  const e = errorsOf(css);
  if (e.some((m) => m.startsWith('web '))) throw new Error(`web refused: ${e.join('\n')}`);
  return [...new Set(e.map((m) => /is unsupported on (?:ios|android): (.*); (?:ios|android) masks/.exec(m)?.[1] ?? m))];
}

const MASK = 'mask-image: linear-gradient(black, transparent)';

describe('gradient masks (MASK-CLIP)', () => {
  it('parses one linear or radial gradient as mask-image, from every name and through the shorthand alone', () => {
    expect(parsed(MASK)).toEqual(['mask-image: linear-gradient(black,transparent) (linear-gradient())']);
    expect(parsed('-webkit-mask-image: Radial-Gradient(circle at 10px 20%, #000 0 5px, transparent)')).toEqual(['mask-image: Radial-Gradient(circle at 10px 20%,#000 0 5px,transparent) (radial-gradient())']);
    expect(parsed('mask-image: repeating-linear-gradient(90deg, black 0 1in, transparent 2cm)')[0]).toMatch(/\(repeating-linear-gradient\(\)\)$/);
    const shorthand = parsed('-webkit-mask: linear-gradient(to right, black, transparent)');
    expect(shorthand[0]).toBe('mask-image: linear-gradient(to right,black,transparent) (linear-gradient())');
    expect(shorthand.slice(1).map((l) => l.replace(/ \(.*\)$/, ''))).toEqual(['-webkit-mask-position-x: 0%', '-webkit-mask-position-y: 0%', 'mask-size: auto', 'mask-repeat: repeat', 'mask-origin: border-box', 'mask-clip: border-box', 'mask-composite: add', 'mask-mode: match-source']);
    // A value Dragon does not draw is kept as written, to be refused: a conic gradient, two layers, a length that computes later, a
    // calculation, an image Dragon does not parse, and the shorthand with any other component.
    for (const v of ['conic-gradient(black, transparent)', 'linear-gradient(black, transparent), none', 'linear-gradient(black 1em, transparent)', 'linear-gradient(black calc(1px + 1%), transparent)', 'linear-gradient(black 10vw, transparent)', 'linear-gradient(in oklab, black, transparent)', 'linear-gradient(black, 50%, transparent)', 'url(m.svg)']) {
      expect(parsed(`mask-image: ${v}`)[0], v).toMatch(/\(mask-layer-value\)$/);
    }
    expect(parsed('mask: linear-gradient(black, transparent) no-repeat')[0]).toMatch(/\(mask-layer-value\)$/);
    expect(maskGradientOf({ kind: 'other', type: 'linear-gradient()', text: 'linear-gradient(35deg,black,transparent)' })).toMatchObject({ radial: false, direction: 'angle', angleDeg: 35 });
    expect(maskGradientOf({ kind: 'keyword', value: 'none' })).toBeNull();
  });

  it('compiles on every target, text and children included; another mask longhand not initial is refused everywhere', () => {
    expect(errorsOf(`.s { ${MASK}; }`)).toEqual([]);
    expect(errorsOf('.s { -webkit-mask-image: radial-gradient(black 40%, rgba(0, 0, 0, 0.5) 60%, transparent); background: #c33; border: 2px solid #123; padding: 3px; }')).toEqual([]);
    expect(errorsOf('.s { mask: linear-gradient(90deg, black, transparent); border-radius: 6px; } .c { background: #08f; }')).toEqual([]);
    const refused = errorsOf(`.s { ${MASK}; mask-repeat: no-repeat; }`);
    expect(refused.map((m) => m.split(' ')[0])).toEqual(['android', 'ios', 'web']);
    for (const m of refused) expect(m).toMatch(/ mask-repeat: no-repeat on <div> a is unsupported: Dragon draws only a mask-image of one linear or radial gradient/);
  });

  it('is refused on the native targets alone where the device mask would differ from Chrome\'s', () => {
    const fact = (css: string) => nativeFacts(css);
    expect(fact(`html { ${MASK}; }`)).toContainEqual(expect.stringMatching(/^it is <html>, whose background is the canvas's/));
    expect(fact(`body { ${MASK}; }`)).toContainEqual(expect.stringMatching(/^it is <body>/));
    expect(fact(`.s { ${MASK}; display: inline; } .c { display: inline; }`)).toContainEqual(expect.stringMatching(/^it is an inline box/));
    expect(fact(`.s { ${MASK}; box-shadow: 0 0 2px red; }`)).toContainEqual(expect.stringMatching(/^it has a box-shadow/));
    expect(fact(`.s { ${MASK}; clip-path: inset(1px); }`)).toContainEqual(expect.stringMatching(/^it has a clip-path too/));
    expect(fact(`.s { ${MASK}; transform: translateX(1px); }`)).toContainEqual(expect.stringMatching(/^it has a transform/));
    expect(fact(`.s { ${MASK}; will-change: opacity; }`)).toContainEqual(expect.stringMatching(/^it rasters in a composited layer of its own/));
    expect(fact(`.s { ${MASK}; overflow: auto; height: 5px; }`)).toContainEqual(expect.stringMatching(/^it rasters in a composited layer of its own/));
    expect(fact('.s { mask-image: linear-gradient(to top right, black, transparent); }')).toContainEqual(expect.stringMatching(/^its gradient goes to a corner/));
    expect(fact('.s { mask-image: linear-gradient(10.001deg, black, transparent); }')).toContainEqual(expect.stringMatching(/^its angle 10.001deg is off the 0.01deg grid/));
    expect(fact('.s { mask-image: linear-gradient(currentcolor, transparent); }')).toContainEqual(expect.stringMatching(/^its gradient has a currentcolor stop/));
    expect(fact(`.s { ${MASK}; outline: 1px solid red; }`)).toContainEqual(expect.stringMatching(/^it has an outline/));
    expect(fact(`.s { ${MASK}; } .c { outline: 1px solid red; }`)).toContainEqual(expect.stringMatching(/^b has an outline/));
    expect(fact(`.s { ${MASK}; } .c { position: relative; z-index: 2; }`)).toContainEqual(expect.stringMatching(/^b has z-index 2/));
    // A transform or a composited layer around the masked box moves its raster.
    expect(fact(`.s { transform: rotate(10deg); } .c { ${MASK}; }`)).toContainEqual(expect.stringMatching(/^it is inside a, whose transform is not the identity/));
    expect(fact(`.s { overflow: scroll; height: 5px; } .c { ${MASK}; }`)).toContainEqual(expect.stringMatching(/^it rasters in the composited layer of a/));
    // Each refusal is reported once per native target.
    expect(errorsOf(`.s { ${MASK}; box-shadow: 0 0 1px red; transform: translateX(1px); }`).filter((m) => m.includes(' mask-image: ')).map((m) => m.split(' ')[0])).toEqual(['android', 'ios']);
    // The backdrop: the canvas alone, in a colour whose every channel is 0 or 255.
    expect(fact(`body { background: #102030; } .s { ${MASK}; }`)).toContainEqual(expect.stringMatching(/^the canvas is rgb\(16, 32, 48\), over which Chrome's 8-bit blend/));
    expect(fact(`html { background: #fff; } body { background: #f00; } .s { ${MASK}; }`)).toContainEqual(expect.stringMatching(/^body paints a background under it/));
    expect(fact(`body { background: rgba(0, 0, 0, 0.5); } .s { ${MASK}; }`)).toContainEqual(expect.stringMatching(/^the canvas is rgba\(0, 0, 0, 128\/255\)/));
    expect(fact(`.s { background: #eee; } .c { ${MASK}; }`)).toContainEqual(expect.stringMatching(/^a paints a background under it/));
    expect(fact(`.s { ${MASK}; position: relative; }`)).toContainEqual(expect.stringMatching(/^it is position: relative/));
    for (const canvas of ['', 'body { background: #000; }', 'html { background: #0ff; } body { background: transparent; }', 'body { background: #ff00ff; }']) expect(errorsOf(`${canvas} .s { ${MASK}; background: #345; }`), canvas).toEqual([]);
    // An opacity of 1, z-index 0 and a transform of none are not refused.
    expect(errorsOf(`.s { ${MASK}; opacity: 1; transform: none; } .c { position: relative; z-index: 0; }`)).toEqual([]);
  });

  it('lowers the mask to one border-box layer that repeats at size auto, after the background layers, and emits its writer', () => {
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`${BODY} .s { width: 40px; height: 20px; background: linear-gradient(red, blue); mask-image: linear-gradient(35deg, black 20%, rgba(0, 0, 0, 0.5)); }`, (r) => [el(r, 'a', 'div', ['s'])]));
    expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const node = p.programs.uikit.nodes.find((n) => n.id === 'a');
    const kinds = node?.writes.map((w) => w.kind) ?? [];
    expect(kinds.indexOf('mask-layer')).toBe(kinds.indexOf('background-layers') + 1);
    const w = node?.writes.find((x) => x.kind === 'mask-layer');
    if (w === undefined || w.kind !== 'mask-layer') throw new Error('no mask write');
    expect(w).toMatchObject({ key: 'dragonMaskLayer', technique: 'dragon-owned-paint', layerOrigin: [0, 0] });
    expect(w.layer.geometry).toEqual({ sizeKind: 'length', sizeX: { unit: 'auto', value: 0 }, sizeY: { unit: 'auto', value: 0 }, positionX: { unit: 'percent', value: 0 }, positionY: { unit: 'percent', value: 0 }, repeatX: 'repeat', repeatY: 'repeat', origin: 'border-box', clip: 'border-box' });
    expect(w.layer.gradient.stops.map((s) => s.color.alpha)).toEqual([255, 128]);
    const swift = paintWriteLines('uikit', 'v', node as never, w);
    expect(swift).toHaveLength(1);
    expect(swift[0]).toMatch(/^ {2}dragonSetMaskLayer\(v, DragonMaskLayer\(layer: BackgroundLayer\(LayerGeometry\(JsString\("length"\), .*, layerX: 0\.0, layerY: 0\.0\)\)$/);
    const kotlin = paintWriteLines('android-views', 'v', p.programs['android-views'].nodes.find((n) => n.id === 'a') as never, w);
    expect(kotlin[0]).toMatch(/^ {2}dragonSetMaskLayer\(v, DragonMaskLayer\(BackgroundLayer\(LayerGeometry\("length", .*, 0\.0, 0\.0\)\)$/);
    expect(GRADIENT_EMITTER.applied({} as never, 'uikit', w as never, 2, {} as never)).toMatchObject({ kind: 'linear', origin: [0, 0], modelled: true, masked: true });
  });

  it('masks the box view: the iOS layer mask from the raster strips, the Android draw in a DST_IN saveLayer; the plant ignores the writer', () => {
    for (const [b, ext] of [['uikit', 'swift'], ['android-views', 'kt']] as const) {
      const files = emitNativeSupport(b);
      const own = files.find((f) => f.path.endsWith(`DragonPaintGradient.${ext}`))?.text ?? '';
      expect(own).toContain(b === 'uikit' ? 'public func dragonSetMaskLayer(_ v: DragonBoxView, _ p: DragonMaskLayer)' : 'fun dragonSetMaskLayer(v: DragonBoxView, p: DragonMaskLayer)');
      expect(own).toContain('dragonAfterLayoutMask(v, shape, scale)');
      if (b === 'uikit') {
        expect(own).toContain('v.layer.mask = m');
        expect(own).toContain('l.magnificationFilter = .nearest');
      } else {
        expect(own).toContain('PorterDuffXfermode(PorterDuff.Mode.DST_IN)');
        expect(own).toContain('canvas.saveLayer(left, top, right, bottom, null)');
        const tree = files.map((f) => f.text).join('\n');
        expect(tree).toContain('dragonDrawMasked(this, canvas, dragonShape) { super.draw(canvas) }');
      }
    }
    expect(SUPPORT_PLANTS).toContain('mask-ignored');
  });
});

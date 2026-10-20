// GEN-c (notes/T151-gen-spec.md R14) on iOS and Android: the native program builds the engine's "<li>::marker" rect as a box view
// after the list item's content, writes its symbol in the item's color, and the emitted case and support code build, lay out and
// draw it (DragonTree.apply runs the translated paint-marker.ts; the list-marker module draws the coverage).
import { describe, expect, it } from 'vitest';
import type { LU } from '@dragon/layout';
import { layout, LU_PER_PX, measurerFor, NO_ENGINE_FAULTS, opacityAlpha8, outlineOffsetPx, outlineRings, outlineWidthPx, platformFontSize, replacedPaint, resolveBorder, resolvePadding, roundedShape, scrollRanges, snapEdges, zoomFontSize, zoomInput } from '@dragon/layout';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import type { ExpectedEngine } from '../src/internal.ts';
import { createProjectWith, emitAndroidViewsCases, emitUikitCases, expectedDump, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import { emitNativeSupport } from '../src/emit/native-support.ts';
import { nodeLit } from '../src/emit/runtime/state.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const m = measurerFor('darwin-arm64');
if (m.kind !== 'ok') throw new Error(m.code);
const engine: ExpectedEngine = { layout, measurer: m.measurer, snapEdges, zoomInput, noFaults: NO_ENGINE_FAULTS, resolveBorder, resolvePadding: (st, cb) => resolvePadding(st, cb as LU), replacedPaint, opacityAlpha8, luPerPx: LU_PER_PX, platformFontSize, zoomFontSize, float32: Math.fround, scrollRanges, paint: { roundedShape, outlineRings, outlineWidthPx, outlineOffsetPx } };
const VIEW = { width: 400, height: 300 };

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Both programs of a list with one item "Hi" (and a second, empty one) in Ahem, under extra CSS. */
function programs(css = '') {
  const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 16px; } li { color: rgb(10, 20, 30); } ${css}`, (r) => [el(r, 'ul', 'ul', ['l'], [el(r, 'li', 'li', [], [text(r, 't', 'Hi')]), el(r, 'li2', 'li')])]);
  const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  const p = nativePrograms(c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

describe('GEN-c: the marker node of the native programs', () => {
  it('is an element box view after the item\'s content, parent and host the item, with only a transparent background, no borders and the marker write', () => {
    for (const p of Object.values(programs())) {
      const ids = p.nodes.map((n) => n.id);
      expect(ids.indexOf('li::marker')).toBe(ids.indexOf('li:text0') + 1);
      expect(ids.indexOf('li2::marker')).toBe(ids.indexOf('li2') + 1);
      const n = p.nodes.find((x) => x.id === 'li::marker');
      expect(n).toMatchObject({ parent: 'li', host: 'li', kind: 'element', clips: false, text: null });
      expect(n?.native).toBe(p.backend === 'uikit' ? 'DragonBoxView' : 'dev.dragon.views.DragonBoxView');
      expect(n?.writes.map((w) => w.kind)).toEqual(['background-color', 'border-widths', 'border-styles', 'border-colors', 'list-marker']);
      expect(n?.writes[0]).toMatchObject({ color: { r: 0, g: 0, b: 0, alpha: 0 } });
      expect(n?.writes[2]).toMatchObject({ styles: ['none', 'none', 'none', 'none'] });
      expect(n?.writes[4]).toMatchObject({ kind: 'list-marker', symbol: 'disc', color: { r: 10, g: 20, b: 30, alpha: 255 }, key: 'dragonListMarker', technique: 'dragon-owned-paint', css: ['list-style-type', 'color'] });
      // Its stacking facts paint it in flow after the item and its text (li, li:text0, li::marker), before the next item.
      const facts = (id: string) => p.nodes.find((x) => x.id === id)?.facts['stacking'] as { paintOrder: number; host: string; layer: string };
      expect(facts('li::marker')).toMatchObject({ host: 'li', layer: 'flow' });
      expect(facts('li::marker').paintOrder).toBe(facts('li').paintOrder + 2);
      expect(facts('li2').paintOrder).toBe(facts('li::marker').paintOrder + 1);
    }
  });

  it('writes square for list-style-type: square, and takes the item\'s visibility', () => {
    const p = programs('.l { list-style-type: square; } li { visibility: hidden; }').uikit;
    const n = p.nodes.find((x) => x.id === 'li::marker');
    expect(n?.writes.map((w) => w.kind)).toEqual(['background-color', 'border-widths', 'border-styles', 'border-colors', 'visibility', 'list-marker']);
    expect(n?.writes[5]).toMatchObject({ symbol: 'square' });
    expect(n?.facts['visibility']).toEqual({ visible: false, value: 'hidden' });
  });

  it('is in the expected dump in engine order, with zero borders and the marker\'s symbol and colour', () => {
    const p = programs();
    for (const dpr of [1, 2, 2.625]) {
      const ios = expectedDump(p.uikit, 'c', VIEW, dpr, engine);
      const ids = ios.nodes.map((n) => n.id);
      expect(ids.indexOf('li::marker'), String(dpr)).toBe(ids.indexOf('li:text0') + 1);
      const marker = ios.nodes.find((n) => n.id === 'li::marker');
      expect(marker?.applied).toMatchObject({ backgroundColor: [0, 0, 0, 0], 'dragonBorder.widths': [0, 0, 0, 0], dragonListMarker: ['disc', 10, 20, 30, 255] });
      const android = expectedDump(p['android-views'], 'c', VIEW, dpr, engine).nodes.find((n) => n.id === 'li::marker');
      expect(android?.applied).toMatchObject({ 'dragonBorder.widthsPx': [0, 0, 0, 0], dragonListMarker: ['disc', 10, 20, 30, 255] });
    }
  });

  it('emits the marker in the engine input and as a box node with its marker write in the case code', () => {
    const p = programs();
    const one = { id: 'list', fixture: 'list', direction: 'ltr' as const, compilerDigest: 'd', viewport: VIEW, expectedDigests: [] };
    const swift = emitUikitCases([{ ...one, program: p.uikit }]).map((f) => f.text).join('\n');
    const kotlin = emitAndroidViewsCases([{ ...one, program: p['android-views'] }]).map((f) => f.text).join('\n');
    expect(swift).toMatch(/let (v\d+) = t\.boxNode\("li::marker", parent: "li", kind: "element"\)\n(?: {2}.*\n)* {2}dragonSetListMarker\(\1, "disc", DragonRGBA8\(10, 20, 30, 255\)\)/);
    expect(kotlin).toMatch(/val (v\d+) = t\.boxNode\("li::marker", "li", "element"\)\n(?: {2}.*\n)* {2}dragonSetListMarker\(\1, "disc", DragonRGBA8\(10, 20, 30, 255\)\)/);
    // The translated ListMarker's fields in input.ts order: id, kind, symbol, text, font, lineHeight; then the item's children.
    expect(swift).toContain('ListMarker(JsString("li::marker"), JsString("symbol"), JsString("disc"), nil, FontSpec(JsString("Ahem"), 16.0,');
    expect(kotlin).toContain('ListMarker("li::marker", "symbol", "disc", null, FontSpec("Ahem", 16.0,');
    expect(swift).toMatch(/LayoutBox\(JsString\("box"\), JsString\("ul"\), JsString\("element"\), LayoutStyle\(.*\), nil, nil, JsArray/);
    expect(kotlin).toMatch(/LayoutBox\("box", "ul", "element", LayoutStyle\(.*\), null, null, jsArrayOf/);
  });

  it('ships the support that computes the marker paint after layout and draws it at the background stage', () => {
    for (const [b, tree, stages, file, call, paint] of [
      ['uikit', 'Support/DragonTree.swift', 'Support/DragonPaintStages.swift', 'Support/Paint/DragonPaintListMarker.swift', 'try paintMarker_markerSymbolPaint(Ctx(measurer, zoomed.devicePixelRatio, block_NO_ENGINE_FAULTS, grid_NO_GRID_FAULTS), m, a.x, a.y)', 'dragonPaintListMarkerStage(v, ctx, shape)'],
      ['android-views', 'kotlin/dev/dragon/views/DragonTree.kt', 'kotlin/dev/dragon/views/DragonPaintStages.kt', 'kotlin/dev/dragon/views/paint/DragonPaintListMarker.kt', 'paintMarker_markerSymbolPaint(Ctx(measurer, zoomed.devicePixelRatio, block_NO_ENGINE_FAULTS, grid_NO_GRID_FAULTS), marker, a.x, a.y)', 'dragonPaintListMarkerStage(v, canvas, shape)'],
    ] as const) {
      const files = emitNativeSupport(b);
      const text = (path: string): string => files.find((f) => f.path === path)?.text ?? '';
      // The marker box is placed like an inline box: zero borders and paddings, never a zoomed style lookup.
      expect(text(tree), b).toContain(call);
      expect(text(tree), b).toMatch(b === 'uikit' ? /if inlineIds\.contains\(id\) \|\| zMarkers\[id\] != nil \{ px = \[0, 0, 0, 0\]/ : /val inline = inlineIds\.contains\(id\) \|\| marker != null/);
      const stage = text(stages);
      const background = stage.slice(stage.indexOf('// background\n'), stage.indexOf('// background-layers\n'));
      expect(background, b).toContain(paint);
      expect(stage, b).toContain('dragonAfterLayoutListMarker(v, shape, scale)');
      expect(text(file), b).toContain(b === 'uikit' ? 'dragonShadowImage(rgba, w, h)' : 'dragonShadowBitmap(rgba, w, h)');
    }
  });

  it('is refused by name in a state program, which has no marker writer', () => {
    const n = programs().uikit.nodes.find((x) => x.id === 'li::marker');
    if (n === undefined) throw new Error('no marker node');
    for (const lang of ['swift', 'kotlin'] as const) expect(() => nodeLit(lang, n), lang).toThrow('li::marker: a list marker in a state program has no state-node write (GEN-c draws markers on the static program only)');
  });
});

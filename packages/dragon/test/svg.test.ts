// SVG-a1 (docs/goals/milestone-2-proof/notes/T-svg-a-spec.md): the SVG attribute grammars as Chrome 145 builds them
// (analysis/elements/svg-path.ts), the shapes'
// bounds (packages/layout/src/svg-geometry.ts) against getBBox values captured from Chrome, and the compiler's svg model: hints,
// refusals, structure and the native refusal. The fixtures' outlines against live Chrome are the parity svg group's.
import { describe, expect, it } from 'vitest';
import { objectBoundingBox } from '@dragon/layout';
import { parsePathData, parseSvgLength, parseViewBox } from '../src/analysis/elements/svg-path.ts';
import { paintAttributeValue, svgAttributeRefusal, svgPresentationHints, svgShapeEmpty, svgZeroLengthSubpath } from '../src/analysis/elements/svg.ts';
import { createProjectWith, nativePrograms, NO_FAULTS, svgScenes } from '../src/internal.ts';
import { svgDashPhase, svgShapePath } from '../src/lower/paint/image.ts';
import { svgPaintAlpha } from '../src/css/color.ts';
import { mathGrammarFor, mathInvalidity } from '../src/css/math.ts';
import type { ComponentDefinition, ElementNode, Origin, SourceRef, TreeNode } from '../src/types.ts';
import { div, inputFor, staticClass, DOC } from './helpers.ts';

const _ref = (o: Origin): SourceRef => (o as Extract<Origin, { kind: 'authored' }>).span.source;

const bbox = (d: string): number[] => {
  const p = parsePathData(d);
  if (!p.ok) throw new Error(p.reason);
  const b = objectBoundingBox({ kind: 'path', segments: p.segments });
  return [b.x, b.y, b.width, b.height];
};

// getBBox of each path in Chrome 145 (pinned, DPR 1): random paths of every command but A, relative and absolute, with exponents.
const CHROME_BBOX: readonly [string, readonly number[]][] = [
  ["M29.192 -0.442 S2.539,4.975,4.025,-2.976 l-7.87,-7.449 S4.993e+0,10.322,2.565e+1,15.338 S-5.253,-1.843,-6.701,3.187 Q18.325,-4.802,5.270e+0,-0.7 C-2.466,31.146,-2.26,22.876,-7.487,3.806", [-7.486999988555908, -10.425000190734863, 38.01376724243164, 31.09740447998047]],
  ["M4.766 2.938e+1 s23.147,12.655,18.054,19.461 S22.437,10.656,30.863,2.384", [4.765999794006348, 2.384000062942505, 26.097002029418945, 47.15521240234375]],
  ["M12.485 -1.478 h9.631 t15.497,3.506", [12.484999656677246, -1.4780000448226929, 25.12799835205078, 3.50600004196167]],
  ["M30.199 19.653 h13.639", [30.198999404907227, 19.652999877929688, 13.638998031616211, 0]],
  ["M0.148 4.563 h2.023e+1 v7.975 c29.895,24.235,30.458,30.286,26.501,24.996 M5.597,20.901 c-0.782,1.688e+1,28.522,6.86,12.004,28.974", [0.14800000190734863, 4.563000202178955, 48.46505355834961, 45.3120002746582]],
  ["M-5.562 21.935 M0.466,6.46 H23.613", [0.4660000205039978, 6.460000038146973, 23.147001266479492, 0]],
  ["M-4.715 27.451 S2.339,13.359,16.981,-1.884 t-0.986,9.409 h0.622", [-4.715000152587891, -1.8840000629425049, 21.696001052856445, 29.33500099182129]],
  ["M8.585 30.881 L-4.672,9.363 q9.811,27.504,22.021,25.907 M-3.398,13.021 q18.711,9.053,3.91,7.257 S25.742,-7.903,7.826,29.6 V16.782", [-4.671999931335449, 9.36299991607666, 22.020999908447266, 25.994644165039062]],
  ["M6.44 13.964 H19.946 V1.061e+1 V8.399 c-7.712,17.544,5.13,-1.394,0.884,-2.602 C4.182,9.292,-7.128,11.995,26.023,-1.043 h16.96", [4.682527542114258, -1.0429999828338623, 38.30047607421875, 16.855886459350586]],
  ["M4.983 -2.231 q2.578,17.965,7.316,4.723e+0 t8.862,-1.779 q17.079,-7.067,2.097e+1,-4.998", [4.982999801635742, -4.7535600662231445, 37.148006439208984, 12.864509582519531]],
  ["M3.160e+1 10.745 H10.422 t-5.765,8.769", [4.6570000648498535, 10.744999885559082, 26.94300079345703, 8.769000053405762]],
  ["M22.449 4.181 L1.393,9.624", [1.3930000066757202, 4.181000232696533, 21.055999755859375, 5.442999362945557]],
  ["M6.674 8.979 C24.383,11.87,-5.383,5.782,2.135e+1,22.123 T28.564,25.974", [6.673999786376953, 8.979000091552734, 21.889999389648438, 16.9950008392334]],
  ["M2.898 4.016 l2.957,-1.44 q8.481,-2.603e+0,-5.452,15.273 Q-1.785,2.071,5.716e+0,10.645 V18.755", [-0.09110093116760254, 2.245143175125122, 9.15513801574707, 16.509855270385742]],
  ["M3.104 23.694 M9.537,26.81 C31.475,-0.642,16.705,1.887,-1.577,0.051 s19.658,18.279,27.498,5.537 v28.098", [-6.501002311706543, -0.06853353977203369, 32.42200469970703, 33.75453567504883]],
  ["M30.305 2.878e+1 c31.763,3.688,-5.059,4.38,6.455,18.279 Q3.027e+1,14.604,1.219,24.223", [1.218999981880188, 22.023895263671875, 42.34103775024414, 25.03510284423828]],
  ["M27.195 8.611 q-7.13,10.577,26.569,9.178 S11.62,7.696,-2.607,12.135 m-0.296,14.376 h15.524", [-2.9030001163482666, 8.611000061035156, 56.66699981689453, 17.900001525878906]],
  ["M24.965 -3.807 m-5.739e+0,-1.447 M10.837,27.65", [10.836999893188477, 27.649999618530273, 0, 0]],
  ["M17.252 3.523 S15.192,10.649,29.002,-6.842", [17.143232345581055, -6.8420000076293945, 11.858768463134766, 11.801487922668457]],
  ["M2.533 28.391 M17.264,15.63 Q2.579e+1,25.855,6.039,14.947 l-4.255,-0.642 S15.081,18.658,-7.003,2.314e+1 L23.051,26.937 q-3.725,-5.436,2.086,6.678", [-7.002999782562256, 14.305000305175781, 32.1400032043457, 19.310001373291016]],
  ["M-3.453 28.316 h-4.784 v23.373 c18.573,29.738,30.409,31.628,14.624,1.377e+1", [-8.23699951171875, 28.31599998474121, 21.97892951965332, 48.594146728515625]],
  ["M10.447 11.404 h3.190e+1", [10.446999549865723, 11.404000282287598, 31.900001525878906, 0]],
  ["M1.52 1.058e+1 M1.546,-5.176 h30.926 s24.793,7.714,-6.568e+0,10.918 S21.603,0.624,-1.976,17.087 h25.559 m-7.033e+0,10.911", [-1.9760000705718994, -5.176000118255615, 43.751487731933594, 33.17400360107422]],
  ["M22.655 28.561 q24.161,2.979e+1,24.925,25.827", [22.655000686645508, 28.56100082397461, 24.92500114440918, 26.292301177978516]],
];

describe('path data as Chrome builds it', () => {
  it('matches Chrome getBBox exactly on random paths of every command but the arc', () => {
    for (const [d, want] of CHROME_BBOX) expect(bbox(d), d).toEqual(want);
  });
  it('sums a number in float32 digit by digit, as Chrome does: -0.785 is -0.7849999666213989, not the nearest float', () => {
    expect(bbox('M0 -0.785 H5')).toEqual([0, -0.7849999666213989, 5, 0]);
    expect(bbox('M0 -6.812 V-0.785')).toEqual([0, -6.811999797821045, 0, 6.027000427246094]);
    expect(bbox('M0 12.345e-1 H1')[1]).toBe(1.2345000505447388);
    expect(bbox('M0 7.77e-3 H1')[1]).toBe(0.0077700004912912846);
  });
  it('keeps a quadratic as a quadratic (its extremum, not a cubic\'s) and reflects smooth control points in float32', () => {
    expect(bbox('M0 0 Q 10 -5 -3 9')).toEqual([-3, -1.3157894611358643, 7.34782600402832, 10.315789222717285]);
    expect(bbox('M0 0 C 10 -5 -3 9 4 4')).toEqual([0, -1.0971124172210693, 4, 6.194226264953613]);
  });
  it('replaces a moveto with a following moveto, and skips a trailing moveto only for a path of lines', () => {
    expect(bbox('M1 1 M2 2')).toEqual([2, 2, 0, 0]);
    expect(bbox('M1 1 L 3 3 M 9 9')).toEqual([1, 1, 2, 2]);
    expect(bbox('M9.938 11.39 Z M3.914,8.260e-1')).toEqual([3.9140000343322754, 0.8260000348091125, 6.0239996910095215, 10.564000129699707]);
  });
  it('grows a width or height whose float sum misses the far edge to the next float (gfx::BoundingRect)', () => {
    expect(bbox('M0 0.1 V7.3')).toEqual([0, 0.10000000149011612, 0, 7.200000286102295]);
  });
  it('refuses arcs (SVG-arc) and reports malformed data', () => {
    expect(parsePathData('M2 12 A10 10 0 0 1 22 12')).toEqual({ ok: false, reason: 'elliptical arc commands are not built yet (package SVG-arc)', arc: true });
    for (const d of ['L1 1', 'M1', 'M1 1 L2', 'M1 1 X3 3', 'M 1 1 Z 3']) expect(parsePathData(d).ok, d).toBe(false);
    expect(parsePathData('')).toEqual({ ok: true, segments: [] });
  });
  it('reads viewBox and number attributes', () => {
    expect(parseViewBox('0 0 24 24')).toEqual({ x: 0, y: 0, width: 24, height: 24 });
    expect(parseViewBox('-4, 2.5, 16, 9')).toEqual({ x: -4, y: 2.5, width: 16, height: 9 });
    for (const t of ['0 0 0 24', '0 0 24', '0 0 24 24 1', 'a b c d', '0 0 -1 2']) expect(parseViewBox(t), t).toBeNull();
    expect([parseSvgLength('12'), parseSvgLength(' 7.5px '), parseSvgLength('2em'), parseSvgLength('10%')]).toEqual([12, 7.5, null, null]);
  });
});

describe('the svg attributes', () => {
  it('map fill, stroke and stroke-width, an svg\'s or rect\'s width and height, and (SVG-geometry) a rect\'s x and y and a circle\'s cx, cy and r, to their properties', () => {
    const hints = svgPresentationHints('rect', new Map([['fill', 'rgb(1, 2, 3)'], ['stroke', 'none'], ['stroke-width', '3'], ['width', '5'], ['x', '2'], ['cx', '4']]));
    expect([...hints.keys()]).toEqual(['fill', 'stroke', 'stroke-width', 'x', 'width']);
    expect(hints.get('stroke-width')).toEqual({ kind: 'number', value: 3 });
    expect(hints.get('x')).toEqual({ kind: 'length', value: 2, unit: 'px' });
    const circle = svgPresentationHints('circle', new Map([['cx', '-1.5'], ['cy', '2px'], ['r', '3'], ['x', '1']]));
    expect([...circle.entries()]).toEqual([['cx', { kind: 'length', value: -1.5, unit: 'px' }], ['cy', { kind: 'length', value: 2, unit: 'px' }], ['r', { kind: 'length', value: 3, unit: 'px' }]]);
    // A path has no geometry property, and a negative r is an error (refused, svgAttributeRefusal), not a hint.
    expect(svgPresentationHints('path', new Map([['x', '1']])).size).toBe(0);
    expect(svgPresentationHints('circle', new Map([['r', '-3']])).size).toBe(0);
  });
  it('refuse values Chrome would ignore or that wait for a package, naming it', () => {
    expect(svgAttributeRefusal('rect', 'fill', 'url(#p)')).toContain('SVG-paint');
    expect(svgAttributeRefusal('rect', 'fill', 'context-stroke')).not.toBeNull();
    expect(svgAttributeRefusal('rect', 'fill', 'bogus')).toContain('not a valid fill');
    expect(svgAttributeRefusal('rect', 'stroke-width', '10%')).toContain('SVG-units');
    expect(svgAttributeRefusal('rect', 'stroke-width', 'thin')).not.toBeNull();
    expect(svgAttributeRefusal('svg', 'width', '2em')).toContain('SVG-units');
    expect(svgAttributeRefusal('circle', 'r', '-1')).toContain('negative');
    expect(svgAttributeRefusal('svg', 'viewBox', '0 0 0 1')).toContain('viewBox');
    expect(svgAttributeRefusal('path', 'd', 'M0 0 a1 1 0 0 0 2 2')).toContain('SVG-arc');
    for (const [tag, name, value] of [['rect', 'fill', 'currentcolor'], ['rect', 'stroke', 'none'], ['rect', 'stroke-width', '1.5'], ['svg', 'viewBox', '0,0,24,24'], ['circle', 'cx', '3px']] as const) {
      expect(svgAttributeRefusal(tag, name, value), `${tag} ${name}=${value}`).toBeNull();
    }
    expect(paintAttributeValue('fill', 'transparent')).toEqual({ ok: true, value: { kind: 'keyword', value: 'transparent' } });
  });
});

describe('the svg model in a compile', () => {
  const svgTree = (css: string, shapes: (ref: SourceRef, o: Origin) => TreeNode[], svgAttrs: [string, string][] = [['width', '24'], ['height', '24']]) =>
    inputFor(`body { margin: 0 } svg { display: block } ${css}`, (r) => {
      const o: Origin = { kind: 'authored', span: { source: r, start: 0, end: 0 } };
      const svg: ElementNode = { kind: 'element', id: 's', tag: 'svg', classes: [staticClass({ owner: DOC, sheet: 's', name: 's' }, o)], attributes: svgAttrs.map(([name, value]) => ({ name, value: [{ when: { kind: 'true' }, value }], origin: o })), children: shapes(r, o), origin: o };
      return [div(r, 'w', ['w'], [svg])];
    });
  const shape = (o: Origin, id: string, tag: string, attrs: [string, string][], children: TreeNode[] = []): ElementNode => ({ kind: 'element', id, tag, classes: [], attributes: attrs.map(([name, value]) => ({ name, value: [{ when: { kind: 'true' }, value }], origin: o })), children, origin: o });
  const compile = (input: ReturnType<typeof svgTree>, lanes: boolean) =>
    createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', interactionLanes: lanes }).compile(input);
  const errors = (c: ReturnType<typeof compile>) => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.target ?? '*'} ${d.message}`);

  it('compiles an svg with its shapes on every target (SVG-a2 draws them natively), and lowers them to one svg-shapes write', () => {
    const input = svgTree('', (_r, o) => [shape(o, 'p', 'path', [['d', 'M2 2 H20 V20 Z']]), shape(o, 'c', 'circle', [['cx', '12'], ['cy', '12'], ['r', '4']])]);
    const user = compile(input, false);
    expect(errors(user)).toEqual([]);
    expect([user.targets.ios, user.targets.android, user.targets.web].every((t) => t !== 'blocked')).toBe(true);
    expect(svgShapePath({ address: 'r', tag: 'rect', shape: { kind: 'rect', x: 1, y: 2, width: 3, height: 4 }, fill: { kind: 'none' }, stroke: { kind: 'none' }, strokeWidth: 1, fillOpacity: 1, strokeOpacity: 1, cap: 'butt', join: 'miter', miterLimit: 4, fillRule: 'nonzero', dashes: [], dashOffset: 0, strokeFirst: false, nonScalingStroke: false, painted: true })).toEqual([0, 1, 2, 1, 4, 2, 1, 4, 6, 1, 1, 6, 4]);
  });
  it('refuses on native, and compiles for web, a shape Chrome fades, a visible shape in a hidden <svg> and an <svg> Chrome does not clip: native draws a shape opaque or not at all, with its <svg>, and clips to the box', () => {
    const shapes = (_r: SourceRef, o: Origin) => [shape(o, 'c', 'circle', [['cx', '12'], ['cy', '12'], ['r', '40']])];
    const refused = (css: string) => errors(compile(svgTree(css, shapes), false));
    expect(refused('')).toEqual([]);
    expect(refused('circle { opacity: 1; visibility: visible; } svg { overflow: hidden; }')).toEqual([]);
    for (const css of ['circle { opacity: 0; }', 'circle { opacity: -2; }', 'svg { visibility: hidden; }', 'circle { visibility: hidden; }', 'circle { visibility: collapse; }', 'svg { visibility: hidden; } circle { visibility: inherit; }']) {
      expect(refused(css), css).toEqual([]);
    }
    for (const [css, message] of [
      ['circle { opacity: 50%; }', 'opacity: 0.5 on <circle> c is not supported on native: a shape is drawn opaque or not at all there until the SVG structure package SVG-b'],
      ['circle { opacity: 0.999; }', 'opacity: 0.999 on <circle> c is not supported on native: a shape is drawn opaque or not at all there until the SVG structure package SVG-b'],
      ['svg { visibility: hidden; } circle { visibility: visible; }', '<circle> c is visible inside <svg> s, whose visibility is hidden: Chrome paints the shape, and native hides it with the <svg> until the SVG structure package SVG-b'],
    ] as const) {
      const e = refused(css);
      // A fraction also takes the translucent-opacity refusal (PNT1-opacity-b), which any box gets.
      expect(e.filter((m) => m.includes('<circle> c ')).sort(), css).toEqual([`DRAGON_UNSUPPORTED_VALUE android ${message}`, `DRAGON_UNSUPPORTED_VALUE ios ${message}`]);
    }
    const overflow = refused('svg { overflow: visible; }');
    expect(overflow.filter((m) => m.includes('on <svg> s is not supported on native: Chrome paints its shapes past the box')).sort()).toEqual(['android', 'ios'].flatMap((t) => ['overflow-x'].map((p) => `DRAGON_UNSUPPORTED_VALUE ${t} ${p}: visible on <svg> s is not supported on native: Chrome paints its shapes past the box, and native clips them to it until the SVG structure package SVG-b`)));
    expect(overflow.every((m) => !m.startsWith('DRAGON_UNSUPPORTED_VALUE web') && !m.startsWith('DRAGON_UNSUPPORTED_VALUE *'))).toBe(true);
  });
  it("draws no shape Chrome renders nothing for: a zero-size rect or circle, an empty path, a shape with display: none, and a hidden or fully transparent one", () => {
    expect([svgShapeEmpty({ kind: 'rect', x: 4, y: 2, width: 0, height: 10 }), svgShapeEmpty({ kind: 'rect', x: 0, y: 0, width: 3, height: 0 }), svgShapeEmpty({ kind: 'circle', cx: 1, cy: 1, r: 0 }), svgShapeEmpty({ kind: 'path', segments: [] })]).toEqual([true, true, true, true]);
    expect([svgShapeEmpty({ kind: 'rect', x: 0, y: 0, width: 1, height: 1 }), svgShapeEmpty({ kind: 'circle', cx: 0, cy: 0, r: 1 })]).toEqual([false, false]);
    const input = svgTree('.hide { display: none; } #v { visibility: hidden; } #t { opacity: 0; }', (_r, o) => [
      shape(o, 'z', 'rect', [['x', '4'], ['y', '2'], ['height', '10'], ['stroke', 'red'], ['stroke-width', '2']]),
      { ...shape(o, 'h', 'rect', [['width', '10'], ['height', '10']]), classes: [staticClass({ owner: DOC, sheet: 's', name: 'hide' }, o)] },
      shape(o, 'o', 'circle', [['cx', '3'], ['cy', '3'], ['r', '0'], ['stroke', 'red']]),
      shape(o, 'e', 'path', [['stroke', 'red']]),
      shape(o, 'c', 'circle', [['cx', '12'], ['cy', '12'], ['r', '4']]),
      shape(o, 'v', 'rect', [['id', 'v'], ['width', '10'], ['height', '10']]),
      shape(o, 't', 'rect', [['id', 't'], ['width', '10'], ['height', '10']]),
    ]);
    const c = compile(input, true);
    expect(errors(c)).toEqual([]);
    // The display: none rect has no box, so it is in no scene; the empty shapes and the hidden and transparent rects keep their box
    // and bbox (the differential compares them), and only the hidden and transparent ones are marked unpainted.
    expect(svgScenes(c, [])?.[0]?.shapes.map((x) => [x.address, x.painted])).toEqual([['z', true], ['o', true], ['e', true], ['c', true], ['v', false], ['t', false]]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const backend of ['uikit', 'android-views'] as const) {
      const writes = p.programs[backend].nodes.flatMap((n) => n.writes).filter((w) => w.kind === 'svg-shapes');
      expect(writes.length, backend).toBe(1);
      expect(writes[0]?.kind === 'svg-shapes' ? writes[0].shapes.map((x) => x.path) : null, backend).toEqual([[5, 12, 12, 4]]);
    }
    // An svg inside a display: none element has no scene at all.
    const hidden = svgTree('.w { display: none; }', (_r, o) => [shape(o, 'c', 'circle', [['r', '4']])]);
    expect(svgScenes(compile(hidden, true), [])).toEqual([]);
  });
  it('compiles a hidden shape on every target, and leaves it out of the native write', () => {
    const input = svgTree('circle { visibility: hidden; }', (_r, o) => [shape(o, 'c', 'circle', [['r', '4']]), shape(o, 'r', 'rect', [['width', '4'], ['height', '4']])]);
    const c = compile(input, false);
    expect(errors(c)).toEqual([]);
    expect(svgScenes(compile(input, true), [])?.[0]?.shapes.map((x) => [x.address, x.painted])).toEqual([['c', false], ['r', true]]);
    const p = nativePrograms(compile(input, true), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    expect(p.programs.uikit.nodes.flatMap((n) => n.writes).flatMap((w) => (w.kind === 'svg-shapes' ? w.shapes.map((x) => x.path) : []))).toEqual([[0, 0, 0, 1, 4, 0, 1, 4, 4, 1, 0, 4, 4]]);
  });
  it('refuses a group, text, a nested svg and a shape with children (SVG-b)', () => {
    const input = svgTree('', (r, o) => [shape(o, 'g', 'g', []), { kind: 'text', id: 't', text: 'hi', origin: o }, shape(o, 'p', 'path', [['d', 'M0 0']], [shape(o, 'q', 'rect', [])]), shape(o, 'n', 'svg', [])]);
    const e = errors(compile(input, true));
    expect(e.some((m) => m.startsWith('DRAGON_UNSUPPORTED_ELEMENT * <g> g is not supported'))).toBe(true);
    expect(e).toContain('DRAGON_UNSUPPORTED_ELEMENT * text inside an <svg> is not supported: SVG text waits for the SVG structure package SVG-b');
    expect(e.some((m) => m.startsWith('DRAGON_UNSUPPORTED_ELEMENT * <rect> q inside an SVG shape is not supported'))).toBe(true);
    expect(e.some((m) => m.startsWith('DRAGON_UNSUPPORTED_ELEMENT * <svg> n inside an <svg> is not supported'))).toBe(true);
  });
  // The content model is the expanded tree's: a call's root sits where the call sits, a projection's children where the projection sits.
  const withComponents = (input: ReturnType<typeof svgTree>, defs: (o: Origin) => ComponentDefinition[]) => {
    const tree = input.tree as NonNullable<typeof input.tree>;
    return { ...input, tree: { ...tree, components: [...tree.components, ...defs(tree.components[0]?.origin as Origin)] } };
  };
  const def = (o: Origin, id: string, root: TreeNode[], slots: string[] = []): ComponentDefinition => ({ id, module: 'm', params: [], states: [], slots: slots.map((name) => ({ name, origin: o })), root, origin: o });
  const call = (o: Origin, id: string, component: string, slots: [string, TreeNode[]][] = []): TreeNode => ({ kind: 'call', id, component, args: [], aliases: [], slots: slots.map(([name, children]) => ({ name, children, origin: o })), origin: o });
  const icon = (o: Origin): ComponentDefinition => def(o, 'Icon', [{ kind: 'element', id: 'i', tag: 'svg', classes: [], attributes: [['width', '24'], ['height', '24']].map(([name, value]) => ({ name: name as string, value: [{ when: { kind: 'true' as const }, value: value as string }], origin: o })), children: [{ kind: 'projection', id: 'g-slot', slot: 'g', origin: o }], origin: o }], ['g']);
  const content = (c: ReturnType<typeof compile>) => errors(c).filter((m) => / (inside|outside) an /.test(m));

  it('refuses a component called inside an <svg> whose root is a <div>, and the text in it', () => {
    const input = withComponents(svgTree('', (_r, o) => [call(o, 'card', 'Card')]), (o) => [def(o, 'Card', [div(_ref(o), 'd', [], [{ kind: 'text', id: 't', text: 'text', origin: o }])])]);
    expect(content(compile(input, true))).toEqual(['DRAGON_UNSUPPORTED_ELEMENT * <div> d inside an <svg> is not supported: an <svg> draws only <path>, <rect> and <circle> children until the SVG structure package SVG-b', 'DRAGON_UNSUPPORTED_ELEMENT * text inside an <svg> is not supported: SVG text waits for the SVG structure package SVG-b']);
  });
  it('refuses a <div> a caller projects into an <svg> slot', () => {
    const input = withComponents(inputFor('body { margin: 0 }', (r) => {
      const o: Origin = { kind: 'authored', span: { source: r, start: 0, end: 0 } };
      return [call(o, 'icon', 'Icon', [['g', [div(r, 'd', [])]]])];
    }), (o) => [icon(o)]);
    expect(content(compile(input, true))).toEqual(['DRAGON_UNSUPPORTED_ELEMENT * <div> d inside an <svg> is not supported: an <svg> draws only <path>, <rect> and <circle> children until the SVG structure package SVG-b']);
  });
  it('accepts a shape-rooted component called inside an <svg> and a shape projected into an <svg> slot, and refuses each outside one', () => {
    const inside = withComponents(inputFor('body { margin: 0 } svg { display: block }', (r) => {
      const o: Origin = { kind: 'authored', span: { source: r, start: 0, end: 0 } };
      return [call(o, 'icon', 'Icon', [['g', [shape(o, 'p', 'path', [['d', 'M2 2 H20 V20 Z']]), call(o, 'dot', 'Dot')]]])];
    }), (o) => [icon(o), def(o, 'Dot', [shape(o, 'c', 'circle', [['cx', '12'], ['cy', '12'], ['r', '4']])])]);
    const c = compile(inside, true);
    expect(errors(c)).toEqual([]);
    expect(c.targets.web).not.toBe('blocked');
    const outside = withComponents(inputFor('body { margin: 0 }', (r) => {
      const o: Origin = { kind: 'authored', span: { source: r, start: 0, end: 0 } };
      return [call(o, 'dot', 'Dot')];
    }), (o) => [def(o, 'Dot', [shape(o, 'c', 'circle', [['cx', '12'], ['cy', '12'], ['r', '4']])])]);
    expect(content(compile(outside, true))).toEqual(['DRAGON_UNSUPPORTED_ELEMENT * <circle> c outside an <svg> is not supported: Chrome draws an SVG shape only inside an <svg>']);
  });
  it('checks a component in each context it is called in, and not at all when no call reaches it', () => {
    const input = withComponents(inputFor('body { margin: 0 } svg { display: block }', (r) => {
      const o: Origin = { kind: 'authored', span: { source: r, start: 0, end: 0 } };
      return [call(o, 'icon', 'Icon', [['g', [call(o, 'in', 'Dot')]]]), call(o, 'out', 'Dot')];
    }), (o) => [icon(o), def(o, 'Dot', [shape(o, 'c', 'circle', [['cx', '12'], ['cy', '12'], ['r', '4']])]), def(o, 'Unused', [div(_ref(o), 'u', [], [shape(o, 'x', 'rect', [])])])]);
    expect(content(compile(input, true))).toEqual(['DRAGON_UNSUPPORTED_ELEMENT * <circle> c outside an <svg> is not supported: Chrome draws an SVG shape only inside an <svg>']);
  });
  it('checks a paint attribute against the support profile as the same value in CSS: the same rows decide both', () => {
    const enforced = (css: string, attrs: [string, string][]) =>
      createProjectWith({ projectId: 'test', targets: { web: {} } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', interactionLanes: true })
        .compile(svgTree(css, (_r, o) => [shape(o, 'r', 'rect', [['width', '4'], ['height', '4'], ...attrs])]));
    const blocked = (c: ReturnType<typeof enforced>): string[] => c.diagnostics.filter((d) => d.severity === 'error' && d.target === 'web').map((d) => `${d.code} ${d.profile?.feature ?? ''}`);
    // svg-colors proves hex, named and transparent fill and hex stroke, and svg-opacity an rgba() fill, so these are stroke values the
    // rows still leave unproven.
    for (const [p, v] of [['stroke', 'rgba(0, 0, 255, 0.5)'], ['stroke', 'transparent']] as const) {
      const attr = blocked(enforced('', [[p, v]]));
      const css = blocked(enforced(`rect { ${p}: ${v}; }`, []));
      expect(css.length, `${p}: ${v} in CSS`).toBeGreaterThan(0);
      expect(attr, `${p}="${v}"`).toEqual(css);
    }
    // A proven value compiles from either.
    expect(blocked(enforced('', [['fill', 'rgb(1, 2, 3)'], ['stroke', 'rgb(4, 5, 6)'], ['stroke-width', '2']]))).toEqual([]);
    expect(blocked(enforced('', [['fill', 'rgba(255, 0, 0, 0.5)']]))).toEqual([]);
    expect(blocked(enforced('rect { fill: rgba(255, 0, 0, 0.5); }', []))).toEqual([]);
    expect(blocked(enforced('rect { fill: rgb(1, 2, 3); stroke: rgb(4, 5, 6); stroke-width: 2; }', []))).toEqual([]);
  });
  it('refuses a viewBox without a size (SVG-ratio), CSS geometry on a shape, a paint server in CSS and a percentage stroke-width', () => {
    const ratio = svgTree('', (_r, o) => [shape(o, 'p', 'path', [['d', 'M0 0 H1']])], [['viewBox', '0 0 24 24']]);
    expect(errors(compile(ratio, true)).filter((m) => m.includes('SVG-ratio')).length).toBe(3);
    const css = svgTree('rect { width: 5px; } circle { fill: url(#a); stroke-width: 10%; stroke: red; }', (_r, o) => [shape(o, 'r', 'rect', [['width', '4'], ['height', '4']]), shape(o, 'c', 'circle', [['r', '4']])]);
    const e = errors(compile(css, true));
    expect(e.some((m) => m.includes('width: 5px on <rect> r is not supported'))).toBe(true);
    expect(e.some((m) => m.includes('on <circle> c is unsupported: paint servers'))).toBe(true);
    expect(e.some((m) => m.includes('stroke-width: 10% on <circle> c is unsupported'))).toBe(true);
  });
  it('an author rule in a cascade layer (CASC 3) still beats a paint presentation attribute, which is below every author layer', () => {
    const fillOf = (css: string): unknown => {
      const c = compile(svgTree(css, (_r, o) => [shape(o, 'r', 'rect', [['width', '4'], ['height', '4'], ['fill', 'rgb(9, 9, 9)']])]), true);
      const s = svgScenes(c, [])?.[0]?.shapes[0];
      return s?.fill.kind === 'color' ? [s.fill.color.r, s.fill.color.g, s.fill.color.b] : s?.fill.kind;
    };
    expect(fillOf('')).toEqual([9, 9, 9]);
    expect(fillOf('@layer base { rect { fill: rgb(1, 2, 3); } }')).toEqual([1, 2, 3]);
    expect(fillOf('@layer base, top; @layer top { rect { fill: rgb(4, 5, 6); } } @layer base { rect { fill: rgb(1, 2, 3); } }')).toEqual([4, 5, 6]);
  });
  it("in one document, the svg checks and GEN-c's list-marker check both fire (checkSvg beside checkComputed's GEN-c checks)", () => {
    const input = inputFor('body { margin: 0 } svg { display: block } circle { stroke-width: 10%; }', (r) => {
      const o: Origin = { kind: 'authored', span: { source: r, start: 0, end: 0 } };
      const attrs = (list: [string, string][]) => list.map(([name, value]) => ({ name, value: [{ when: { kind: 'true' as const }, value }], origin: o }));
      const svg: ElementNode = { kind: 'element', id: 's', tag: 'svg', classes: [], attributes: attrs([['width', '24'], ['height', '24']]), children: [shape(o, 'c', 'circle', [['r', '4']])], origin: o };
      const li: ElementNode = { kind: 'element', id: 'li', tag: 'li', classes: [], attributes: [], children: [], origin: o };
      const ul: ElementNode = { kind: 'element', id: 'ul', tag: 'ol', classes: [], attributes: [], children: [li], origin: o };
      return [div(r, 'w', ['w'], [svg, ul])];
    });
    const e = errors(compile(input, true));
    expect(e.filter((m) => m.includes('stroke-width: 10% on <circle> c is unsupported')).length).toBeGreaterThan(0);
    expect(e.filter((m) => m.includes('display: list-item on <li> li generates a decimal marker')).length).toBeGreaterThan(0);
  });
  it('SVG-opacity: fill-opacity and stroke-opacity compute to a clamped number, inherit, and scale the fill and stroke alpha byte on native', () => {
    const input = svgTree('svg { fill-opacity: 40%; stroke-opacity: 2; } .h { fill-opacity: 0.5; stroke-opacity: -1; }', (_r, o) => [
      { ...shape(o, 'h', 'rect', [['width', '10'], ['height', '10'], ['fill', 'rgb(200, 40, 40)'], ['stroke', 'rgba(0, 0, 0, 0.5)']]), classes: [staticClass({ owner: DOC, sheet: 's', name: 'h' }, o)] },
      shape(o, 'i', 'circle', [['cx', '12'], ['cy', '12'], ['r', '4'], ['fill', 'rgb(0, 0, 255)'], ['stroke', 'rgb(0, 128, 0)']]),
      shape(o, 'a', 'circle', [['cx', '6'], ['cy', '6'], ['r', '2'], ['fill-opacity', '0.25'], ['stroke-opacity', '75%'], ['stroke', 'rgb(0, 0, 0)']]),
    ]);
    const c = compile(input, true);
    expect(errors(c)).toEqual([]);
    expect(svgScenes(c, [])?.[0]?.shapes.map((x) => [x.address, x.fillOpacity, x.strokeOpacity])).toEqual([['h', 0.5, 0], ['i', 0.4, 1], ['a', 0.25, 0.75]]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const backend of ['uikit', 'android-views'] as const) {
      const w = p.programs[backend].nodes.flatMap((n) => n.writes).find((x) => x.kind === 'svg-shapes');
      expect(w?.kind === 'svg-shapes' ? w.shapes.map((x) => [x.fill?.alpha ?? null, x.stroke?.alpha ?? null]) : null, backend).toEqual([[128, 0], [102, 255], [64, 191]]);
    }
    expect(svgPaintAlpha(255, 0.5)).toBe(128);
    expect(svgPaintAlpha(128, 0.5)).toBe(64);
    expect(svgPaintAlpha(255, 1)).toBe(255);
    expect(svgPaintAlpha(255, 0)).toBe(0);
  });
  it('SVG-opacity: the presentation attributes parse as the properties do; an invalid one is refused, as Chrome ignores it', () => {
    expect(paintAttributeValue('fill-opacity', '0.5')).toEqual({ ok: true, value: { kind: 'number', value: 0.5 } });
    expect(paintAttributeValue('stroke-opacity', '30%')).toEqual({ ok: true, value: { kind: 'percentage', value: 30 } });
    expect(svgAttributeRefusal('rect', 'fill-opacity', '50%')).toBeNull();
    expect(svgAttributeRefusal('path', 'stroke-opacity', 'half')).toContain('is not a valid stroke-opacity');
  });
  it('SVG-opacity: a calculation in fill-opacity or stroke-opacity resolves to a number, as in opacity, and compiles', () => {
    for (const p of ['fill-opacity', 'stroke-opacity']) expect(mathInvalidity('calc(0.25 + 0.5)', mathGrammarFor(p)), p).toBeNull();
    const input = svgTree('svg { fill-opacity: calc(0.25 + 0.5); stroke-opacity: calc(0.1 * 2); }', (_r, o) => [shape(o, 'h', 'rect', [['width', '10'], ['height', '10'], ['stroke', 'rgb(0, 0, 0)']])]);
    const c = compile(input, true);
    expect(errors(c)).toEqual([]);
    expect(svgScenes(c, [])?.[0]?.shapes.map((x) => [x.fillOpacity, x.strokeOpacity])).toEqual([[0.75, 0.2]]);
  });
  it('SVG-stroke: stroke-linecap, stroke-linejoin, stroke-miterlimit and fill-rule compute, inherit and reach the native write; the attributes are hints below author CSS', () => {
    const input = svgTree('svg { stroke-linecap: ROUND; stroke-linejoin: bevel; stroke-miterlimit: calc(1 + 9); fill-rule: evenodd; } .k { stroke-linecap: square; fill-rule: initial; stroke-miterlimit: inherit; }', (_r, o) => [
      shape(o, 'i', 'path', [['d', 'M2 2 L20 2 L2 20'], ['stroke', 'rgb(0, 0, 0)']]),
      { ...shape(o, 'k', 'rect', [['width', '10'], ['height', '10'], ['fill-rule', 'evenodd'], ['stroke-linejoin', 'round']]), classes: [staticClass({ owner: DOC, sheet: 's', name: 'k' }, o)] },
      shape(o, 'a', 'circle', [['cx', '6'], ['cy', '6'], ['r', '2'], ['stroke-linecap', 'butt'], ['stroke-linejoin', 'miter'], ['stroke-miterlimit', '1.5'], ['fill-rule', 'nonzero']]),
    ]);
    const c = compile(input, true);
    expect(errors(c)).toEqual([]);
    const want = [['i', 'round', 'bevel', 10, 'evenodd'], ['k', 'square', 'round', 10, 'nonzero'], ['a', 'butt', 'miter', 1.5, 'nonzero']];
    expect(svgScenes(c, [])?.[0]?.shapes.map((x) => [x.address, x.cap, x.join, x.miterLimit, x.fillRule])).toEqual(want);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const backend of ['uikit', 'android-views'] as const) {
      const w = p.programs[backend].nodes.flatMap((n) => n.writes).find((x) => x.kind === 'svg-shapes');
      expect(w?.kind === 'svg-shapes' ? w.shapes.map((x) => [x.cap, x.join, x.miterLimit, x.fillRule]) : null, backend).toEqual(want.map((r) => r.slice(1)));
    }
  });
  it('SVG-stroke: the presentation attributes take the keywords and number Chrome parses; webref-only joins and a negative limit are refused, as Chrome ignores them', () => {
    expect(paintAttributeValue('stroke-linecap', 'Square')).toEqual({ ok: true, value: { kind: 'keyword', value: 'square' } });
    expect(paintAttributeValue('stroke-miterlimit', '0.5')).toEqual({ ok: true, value: { kind: 'number', value: 0.5 } });
    expect(svgAttributeRefusal('path', 'fill-rule', 'evenodd')).toBeNull();
    for (const [name, value] of [['stroke-linejoin', 'arcs'], ['stroke-linejoin', 'miter-clip'], ['stroke-linejoin', 'crop bevel'], ['stroke-miterlimit', '-1'], ['stroke-miterlimit', '4px'], ['stroke-linecap', 'none'], ['fill-rule', 'even-odd']] as const) {
      expect(svgAttributeRefusal('path', name, value), `${name}=${value}`).toContain(`is not a valid ${name}`);
    }
    expect(mathInvalidity('calc(2 * 3)', mathGrammarFor('stroke-miterlimit'))).toBeNull();
  });
  it('SVG-stroke: a miter limit of 0 (unitless or an attribute) computes to the number 0, a negative calculation clamps to 0 as Chrome clamps it, and a typed division is refused, never thrown at lowering', () => {
    const cases: [string, [string, string][]][] = [['path { stroke-miterlimit: 0; }', []], ['', [['stroke-miterlimit', '0']]], ['path { stroke-miterlimit: calc(-1); }', []], ['path { stroke-miterlimit: calc(2 - 5); }', []]];
    for (const [css, attrs] of cases) {
      const c = compile(svgTree(css, (_r, o) => [shape(o, 'i', 'path', [['d', 'M2 2 L20 2 L2 20'], ['stroke', 'rgb(0, 0, 0)'], ...attrs])]), true);
      expect(errors(c), css).toEqual([]);
      expect(svgScenes(c, [])?.[0]?.shapes.map((x) => x.miterLimit), css).toEqual([0]);
      const p = nativePrograms(c, []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      for (const backend of ['uikit', 'android-views'] as const) {
        const w = p.programs[backend].nodes.flatMap((n) => n.writes).find((x) => x.kind === 'svg-shapes');
        expect(w?.kind === 'svg-shapes' ? w.shapes.map((x) => x.miterLimit) : null, `${backend} ${css}`).toEqual([0]);
      }
    }
    const divided = errors(compile(svgTree('path { stroke-miterlimit: calc(1px / 1px); }', (_r, o) => [shape(o, 'i', 'path', [['d', 'M2 2 L20 2 L2 20'], ['stroke', 'rgb(0, 0, 0)']])]), false));
    const message = 'stroke-miterlimit: calc(1px/1px) /* it divides by a length, which is typed arithmetic (css-values-4 §10.9), not supported */ on <path> i is unsupported';
    expect(divided.sort()).toEqual(['android', 'ios', 'web'].map((t) => `DRAGON_UNSUPPORTED_VALUE ${t} ${message}`));
  });
  it('SVG-stroke: a zero-length subpath is one that draws without leaving its start, control points included; a lone moveto is not', () => {
    const path = (d: string) => {
      const p = parsePathData(d);
      if (!p.ok) throw new Error(p.reason);
      return { kind: 'path' as const, segments: p.segments };
    };
    for (const d of ['M5 5 L5 5', 'M5 5 Z', 'M0 0 L9 9 M5 5 L5 5 L5 5', 'M5 5 Q5 5 5 5', 'M5 5 C5 5 5 5 5 5', 'M0 0 L9 9 Z L0 0']) expect(svgZeroLengthSubpath(path(d)), d).toBe(true);
    for (const d of ['M5 5', 'M5 5 L6 5', 'M5 5 Q9 9 5 5', 'M5 5 C5 5 9 9 5 5', 'M0 0 L9 9 M5 5', 'M0 0 L9 0 L0 0 Z']) expect(svgZeroLengthSubpath(path(d)), d).toBe(false);
    expect(svgZeroLengthSubpath({ kind: 'rect', x: 0, y: 0, width: 0, height: 0 })).toBe(false);
  });
  it('SVG-stroke: refuses on native, and compiles for web, a round or square cap on a stroked zero-length subpath; a butt cap, no stroke or a zero width compiles', () => {
    const shapes = (_r: SourceRef, o: Origin) => [shape(o, 'd', 'path', [['d', 'M2 2 L20 20 M8 8 Z'], ['stroke', 'rgb(0, 0, 0)']])];
    const refused = (css: string) => errors(compile(svgTree(css, shapes), false));
    for (const css of ['', 'path { stroke-linecap: butt; }', 'path { stroke-linecap: round; stroke: none; }', 'path { stroke-linecap: square; stroke-width: 0; }']) expect(refused(css), css).toEqual([]);
    for (const cap of ['round', 'square']) {
      const message = `stroke-linecap: ${cap} on <path> d, whose path has a zero-length subpath, is not supported on native: Chrome draws its cap as a dot or square that native does not orient the same way yet`;
      expect(refused(`path { stroke-linecap: ${cap}; }`).sort(), cap).toEqual([`DRAGON_UNSUPPORTED_VALUE android ${message}`, `DRAGON_UNSUPPORTED_VALUE ios ${message}`]);
    }
  });
  it('SVG-dash: stroke-dasharray and stroke-dashoffset compute, inherit and reach the native write as an even list and a wrapped phase; none and a zero-sum list are solid', () => {
    const input = svgTree('svg { stroke-dasharray: 4, 2 1; stroke-dashoffset: -3; } .k { stroke-dasharray: none; stroke-dashoffset: 5px; }', (_r, o) => [
      shape(o, 'i', 'path', [['d', 'M2 2 L20 2'], ['stroke', 'rgb(0, 0, 0)']]),
      { ...shape(o, 'k', 'rect', [['width', '10'], ['height', '10'], ['stroke-dasharray', '3 3']]), classes: [staticClass({ owner: DOC, sheet: 's', name: 'k' }, o)] },
      shape(o, 'a', 'path', [['d', 'M2 8 L20 8'], ['stroke-dasharray', '5px,1'], ['stroke-dashoffset', '13']]),
      shape(o, 'z', 'path', [['d', 'M2 12 L20 12'], ['stroke-dasharray', '0,0']]),
    ]);
    const c = compile(input, true);
    expect(errors(c)).toEqual([]);
    expect(svgScenes(c, [])?.[0]?.shapes.map((x) => [x.address, x.dashes, x.dashOffset])).toEqual([['i', [4, 2, 1, 4, 2, 1], -3], ['k', [], 5], ['a', [5, 1], 13], ['z', [], -3]]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const backend of ['uikit', 'android-views'] as const) {
      const w = p.programs[backend].nodes.flatMap((n) => n.writes).find((x) => x.kind === 'svg-shapes');
      expect(w?.kind === 'svg-shapes' ? w.shapes.map((x) => [x.dashes, x.dashPhase]) : null, backend).toEqual([[[4, 2, 1, 4, 2, 1], 11], [[], 0], [[5, 1], 1], [[], 0]]);
    }
  });
  it('SVG-dash: the dash phase is the offset wrapped into the pattern, a negative offset counted back from its end (Skia CalcDashParameters)', () => {
    expect([svgDashPhase([4, 2], 7), svgDashPhase([4, 2], -1), svgDashPhase([4, 2], -6), svgDashPhase([4, 2], 6), svgDashPhase([], 5), svgDashPhase([4, 2], 0)]).toEqual([1, 5, 0, 0, 0, 0]);
  });
  it('SVG-dash: the attributes take what Chrome parses (commas or spaces, numbers, px and percentages); a negative, an empty item or a keyword is refused, as Chrome ignores it', () => {
    expect(paintAttributeValue('stroke-dasharray', '5,  3 ,2.50')).toEqual({ ok: true, value: { kind: 'other', type: 'dash-array', text: '5px, 3px, 2.5px' } });
    expect(paintAttributeValue('stroke-dasharray', 'None')).toEqual({ ok: true, value: { kind: 'keyword', value: 'none' } });
    expect(paintAttributeValue('stroke-dashoffset', '-4')).toEqual({ ok: true, value: { kind: 'number', value: -4 } });
    expect(svgAttributeRefusal('path', 'stroke-dasharray', '1 2px 3')).toBeNull();
    for (const [name, value] of [['stroke-dasharray', '-1'], ['stroke-dasharray', '1,,2'], ['stroke-dasharray', '1,'], ['stroke-dasharray', 'auto'], ['stroke-dasharray', '1 none'], ['stroke-dashoffset', '1 2'], ['stroke-dashoffset', 'none']] as const) {
      expect(svgAttributeRefusal('path', name, value), `${name}=${value}`).toContain(`is not a valid ${name}`);
    }
    expect(svgAttributeRefusal('path', 'stroke-dasharray', '2 10%')).toBe('a percentage stroke-dasharray is relative to the viewport diagonal, which is not built yet (package SVG-units)');
    expect(svgAttributeRefusal('path', 'stroke-dashoffset', '10%')).toBe('a percentage stroke-dashoffset is relative to the viewport diagonal, which is not built yet (package SVG-units)');
    expect(svgAttributeRefusal('path', 'stroke-dasharray', '2em')).toContain('stroke-dasharray: 2em is unsupported: a dash in em is not resolved yet (package SVG-units)');
    expect(svgAttributeRefusal('path', 'pathLength', '10')).toBeNull();
    expect(mathInvalidity('calc(2px + 3)', mathGrammarFor('stroke-dashoffset'))).not.toBeNull();
  });
  it('SVG-dash: refuses on native, and compiles for web, a dashed circle and a zero-length dash with a round or square cap; a percentage refuses everywhere', () => {
    const shapes = (_r: SourceRef, o: Origin) => [shape(o, 'c', 'circle', [['cx', '12'], ['cy', '12'], ['r', '8'], ['stroke', 'rgb(0, 0, 0)']]), shape(o, 'd', 'path', [['d', 'M2 2 L20 20'], ['stroke', 'rgb(0, 0, 0)']])];
    const refused = (css: string) => errors(compile(svgTree(css, shapes), false)).sort();
    for (const css of ['', 'path { stroke-dasharray: 2 2; stroke-linecap: round; }', 'path { stroke-dasharray: 0 4; }', 'circle { stroke-dasharray: 2 2; stroke: none; }', 'circle { stroke-dasharray: 0 0; }']) expect(refused(css), css).toEqual([]);
    const circle = 'stroke-dasharray: 2px, 2px on <circle> c is not supported on native: where the dashes of a circle start is not proven against Chrome yet';
    expect(refused('circle { stroke-dasharray: 2 2; }')).toEqual([`DRAGON_UNSUPPORTED_VALUE android ${circle}`, `DRAGON_UNSUPPORTED_VALUE ios ${circle}`]);
    const zero = 'stroke-dasharray: 0px, 4px with stroke-linecap: square on <path> d is not supported on native: a zero-length dash is a dot or square that native does not orient the same way yet';
    expect(refused('path { stroke-dasharray: 0 4; stroke-linecap: square; }')).toEqual([`DRAGON_UNSUPPORTED_VALUE android ${zero}`, `DRAGON_UNSUPPORTED_VALUE ios ${zero}`]);
    const calc = 'stroke-dashoffset: calc(2px + 3px) on <path> d is unsupported: a calculated stroke-dashoffset is not resolved yet (package SVG-units)';
    expect(refused('path { stroke-dashoffset: calc(2px + 3px); }')).toEqual([`DRAGON_UNSUPPORTED_VALUE android ${calc}`, `DRAGON_UNSUPPORTED_VALUE ios ${calc}`, `DRAGON_UNSUPPORTED_VALUE web ${calc}`]);
    const percent = 'stroke-dashoffset: 5% on <path> d is unsupported: a percentage stroke-dashoffset is relative to the viewport diagonal, which is not built yet (package SVG-units)';
    expect(refused('path { stroke-dashoffset: 5%; }')).toEqual([`DRAGON_UNSUPPORTED_VALUE android ${percent}`, `DRAGON_UNSUPPORTED_VALUE ios ${percent}`, `DRAGON_UNSUPPORTED_VALUE web ${percent}`]);
  });
  it('SVG-geometry: a rect\'s x and y and a circle\'s cx, cy and r compute from CSS over their attributes (numbers and em as px), are not inherited, and draw the shape', () => {
    const input = svgTree('svg { font-size: 10px; cx: 9px; } .m { x: 3; y: -2px; } .n { cx: 1.5em; cy: 4; r: 0.5em; }', (_r, o) => [
      { ...shape(o, 'a', 'rect', [['x', '7'], ['y', '8'], ['width', '4'], ['height', '5']]), classes: [staticClass({ owner: DOC, sheet: 's', name: 'm' }, o)] },
      shape(o, 'b', 'rect', [['x', '1'], ['width', '4'], ['height', '5']]),
      { ...shape(o, 'c', 'circle', [['cx', '2'], ['cy', '3'], ['r', '9']]), classes: [staticClass({ owner: DOC, sheet: 's', name: 'n' }, o)] },
      shape(o, 'd', 'circle', [['r', '2']]),
    ]);
    const c = compile(input, true);
    expect(errors(c)).toEqual([]);
    expect(svgScenes(c, [])?.[0]?.shapes.map((x) => [x.address, x.shape])).toEqual([
      ['a', { kind: 'rect', x: 3, y: -2, width: 4, height: 5 }],
      ['b', { kind: 'rect', x: 1, y: 0, width: 4, height: 5 }],
      ['c', { kind: 'circle', cx: 15, cy: 4, r: 5 }],
      // cx is not inherited: the svg's cx: 9px reaches no shape.
      ['d', { kind: 'circle', cx: 0, cy: 0, r: 2 }],
    ]);
  });
  it('SVG-paint-order: paint-order computes to the prefix Chrome keeps, inherits, is a presentation hint, and orders the stroke before the fill in the native write', () => {
    const cases: [string, string][] = [
      ['normal', 'normal'], ['fill', 'fill'], ['stroke', 'stroke'], ['markers', 'markers'], ['fill stroke', 'fill'], ['stroke fill', 'stroke'],
      ['fill markers', 'fill markers'], ['markers fill', 'markers'], ['stroke markers', 'stroke markers'], ['markers stroke', 'markers stroke'],
      ['fill stroke markers', 'fill'], ['fill markers stroke', 'fill markers'], ['stroke fill markers', 'stroke'], ['stroke markers fill', 'stroke markers'],
      ['markers fill stroke', 'markers'], ['markers stroke fill', 'markers stroke'], ['STROKE', 'stroke'],
    ];
    for (const [css, computed] of cases) {
      const v = paintAttributeValue('paint-order', css);
      expect(v.ok ? (v.value.kind === 'keyword' ? v.value.value : v.value.kind === 'other' ? v.value.text : null) : null, css).toBe(computed);
    }
    // Chrome drops these as invalid: a repeated item, normal in a list, and none.
    for (const bad of ['fill fill', 'normal fill', 'none']) expect(paintAttributeValue('paint-order', bad).ok, bad).toBe(false);
    const input = svgTree('svg { paint-order: stroke; } .k { paint-order: markers; } .m { paint-order: markers stroke; }', (_r, o) => [
      shape(o, 'i', 'path', [['d', 'M2 2 H20']]),
      { ...shape(o, 'k', 'rect', [['width', '10'], ['height', '10']]), classes: [staticClass({ owner: DOC, sheet: 's', name: 'k' }, o)] },
      { ...shape(o, 'm', 'rect', [['width', '10'], ['height', '10']]), classes: [staticClass({ owner: DOC, sheet: 's', name: 'm' }, o)] },
      shape(o, 'a', 'circle', [['r', '4'], ['paint-order', 'fill']]),
    ]);
    const c = compile(input, true);
    expect(errors(c)).toEqual([]);
    expect(svgScenes(c, [])?.[0]?.shapes.map((x) => [x.address, x.strokeFirst])).toEqual([['i', true], ['k', false], ['m', true], ['a', false]]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const backend of ['uikit', 'android-views'] as const) {
      const w = p.programs[backend].nodes.flatMap((n) => n.writes).find((x) => x.kind === 'svg-shapes');
      expect(w?.kind === 'svg-shapes' ? w.shapes.map((x) => x.strokeFirst) : null, backend).toEqual([true, false, true, false]);
    }
  });
  it('SVG-geometry: refuses everywhere a percentage or a calculated geometry property on the shape it draws; one on another tag has no effect and compiles', () => {
    const shapes = (_r: SourceRef, o: Origin) => [shape(o, 'r', 'rect', [['width', '4'], ['height', '4']]), shape(o, 'c', 'circle', [['r', '4']]), shape(o, 'p', 'path', [['d', 'M0 0 H4']])];
    const refused = (css: string) => errors(compile(svgTree(css, shapes), false)).sort();
    const all = (m: string) => ['android', 'ios', 'web'].map((t) => `DRAGON_UNSUPPORTED_VALUE ${t} ${m}`);
    for (const css of ['', 'rect { cx: 10%; r: calc(2px + 1px); } circle { x: 50%; } path { cx: 5%; y: calc(1px * 2); }']) expect(refused(css), css).toEqual([]);
    expect(refused('circle { cx: 10%; }')).toEqual(all('cx: 10% on <circle> c is unsupported: a percentage cx is relative to the viewport width, which is not built yet (package SVG-units)'));
    expect(refused('circle { r: 5%; }')).toEqual(all('r: 5% on <circle> c is unsupported: a percentage r is relative to the normalized viewport diagonal, which is not built yet (package SVG-units)'));
    expect(refused('rect { y: 20%; }')).toEqual(all('y: 20% on <rect> r is unsupported: a percentage y is relative to the viewport height, which is not built yet (package SVG-units)'));
    expect(refused('rect { x: calc(1px + 2px); }')).toEqual(all('x: calc(1px + 2px) on <rect> r is unsupported: a calculated x is not resolved yet (package SVG-units)'));
    // A negative r is invalid CSS (Blink ValueRange::kNonNegative), and auto is not a geometry value (Rx and Ry alone take it).
    expect(refused('circle { r: -2px; cx: auto; }')).toEqual(['DRAGON_CSS_INVALID_VALUE * "-2px" is not a valid value for r (@webref/css grammar)', 'DRAGON_CSS_INVALID_VALUE * "auto" is not a valid value for cx (@webref/css grammar)']);
  });
  it('refuses on every target a filter, a mask, backface-visibility or transform-box on a shape other than the initial value, as on a box: no target draws them on a shape, and Chrome does', () => {
    const shapes = (_r: SourceRef, o: Origin) => [shape(o, 'r', 'rect', [['width', '10'], ['height', '10']]), shape(o, 'p', 'path', [['d', 'M2 2 H20 V20 Z']]), shape(o, 'c', 'circle', [['cx', '12'], ['cy', '12'], ['r', '4']])];
    const at = (css: string, address: string) => errors(compile(svgTree(css, shapes), false)).filter((m) => m.includes(`> ${address} `)).map((m) => m.split(' ').slice(0, 2).join(' ')).sort();
    const everywhere = ['DRAGON_UNSUPPORTED_VALUE android', 'DRAGON_UNSUPPORTED_VALUE ios', 'DRAGON_UNSUPPORTED_VALUE web'];
    for (const [tag, address] of [['rect', 'r'], ['path', 'p'], ['circle', 'c']] as const) {
      expect(at(`${tag} { filter: blur(2px); }`, address), `${tag} filter`).toEqual(everywhere);
      expect(at(`${tag} { mask-image: linear-gradient(red, blue); }`, address), `${tag} mask-image`).toEqual(everywhere);
      expect(at(`${tag} { filter: none; mask: none; }`, address), `${tag} initial`).toEqual([]);
    }
    const e = errors(compile(svgTree('rect { filter: blur(2px); mask-image: linear-gradient(red, blue); }', shapes), false));
    expect(e.filter((m) => m.includes('on <rect> r is unsupported')).map((m) => m.split(' ').slice(2).join(' ')).sort()).toEqual([
      ...['android', 'ios', 'web'].map(() => 'filter: blur(2px) on <rect> r is unsupported: Dragon draws no filter yet (FX); only none is accepted'),
      ...['android', 'ios', 'web'].map(() => 'mask-image: linear-gradient(red,blue) on <rect> r is unsupported: Dragon draws no mask yet (MASK-CLIP); only the initial value is accepted'),
    ]);
    // Refused on every target, whether as a property no target supports yet (a target-free error) or as a value refused per target.
    const refusedOn = (css: string): string[] => {
      const refused = compile(svgTree(css, shapes), false).diagnostics.filter((d) => d.severity === 'error');
      return refused.some((d) => d.target === null || d.target === undefined) ? ['android', 'ios', 'web'] : [...new Set(refused.map((d) => String(d.target)))].sort();
    };
    for (const decl of ['backface-visibility: hidden', 'transform-box: fill-box', 'transform-box: stroke-box']) {
      for (const tag of ['rect', 'path', 'circle']) expect(refusedOn(`${tag} { ${decl}; }`), `${tag} { ${decl} }`).toEqual(['android', 'ios', 'web']);
    }
  });
  it('SVG-rrect: rx and ry compute from CSS over their attributes, are not inherited, resolve auto from each other and clamp to half the rect (SVG 2 §10.4)', () => {
    const input = svgTree('svg { rx: 3px; } .a { rx: 2; } .b { ry: 0.4em; font-size: 10px; } .c { rx: 30px; ry: auto; } .d { rx: 5px; ry: 0; }', (_r, o) => {
      const rect = (id: string, cls: string | null, attrs: [string, string][]) => ({ ...shape(o, id, 'rect', [['width', '20'], ['height', '10'], ...attrs]), classes: cls === null ? [] : [staticClass({ owner: DOC, sheet: 's', name: cls }, o)] });
      return [rect('a', 'a', [['ry', '1']]), rect('b', 'b', []), rect('c', 'c', [['ry', '2']]), rect('d', 'd', []), rect('e', null, [['rx', '4'], ['ry', '50']]), rect('f', null, [])];
    });
    const c = compile(input, true);
    expect(errors(c)).toEqual([]);
    expect(svgScenes(c, [])?.[0]?.shapes.map((x) => [x.address, x.shape])).toEqual([
      // rx from CSS, ry from the attribute.
      ['a', { kind: 'rect', x: 0, y: 0, width: 20, height: 10, rx: 2, ry: 1 }],
      // An auto rx takes ry (em in px).
      ['b', { kind: 'rect', x: 0, y: 0, width: 20, height: 10, rx: 4, ry: 4 }],
      // ry: auto in CSS beats the attribute and takes rx; both clamp to half the size, an oval.
      ['c', { kind: 'rect', x: 0, y: 0, width: 20, height: 10, rx: 10, ry: 5 }],
      // A zero radius makes the rect square, as SkRRect::setRectXY does.
      ['d', { kind: 'rect', x: 0, y: 0, width: 20, height: 10 }],
      ['e', { kind: 'rect', x: 0, y: 0, width: 20, height: 10, rx: 4, ry: 5 }],
      // rx is not inherited: the svg's rx: 3px reaches no shape, and both auto are 0.
      ['f', { kind: 'rect', x: 0, y: 0, width: 20, height: 10 }],
    ]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const k = (4 / 3) * (Math.SQRT2 - 1);
    for (const backend of ['uikit', 'android-views'] as const) {
      const w = p.programs[backend].nodes.flatMap((n) => n.writes).find((x) => x.kind === 'svg-shapes');
      const paths = w?.kind === 'svg-shapes' ? w.shapes.map((x) => x.path) : [];
      // a: from the top edge's left end, each edge then its corner, clockwise (Skia set_as_rrect, start index 0).
      expect(paths[0], backend).toEqual([0, 2, 0, 1, 18, 0, 3, 18 + 2 * k, 0, 20, 1 - k, 20, 1, 1, 20, 9, 3, 20, 9 + k, 18 + 2 * k, 10, 18, 10, 1, 2, 10, 3, 2 - 2 * k, 10, 0, 9 + k, 0, 9, 1, 0, 1, 3, 0, 1 - k, 2 - 2 * k, 0, 2, 0, 4]);
      // c: an oval is four quarters from the top centre, with no lines (SkPathPriv::SimplifyRRect).
      expect(paths[2], backend).toEqual([0, 10, 0, 3, 10 + 10 * k, 0, 20, 5 - 5 * k, 20, 5, 3, 20, 5 + 5 * k, 10 + 10 * k, 10, 10, 10, 3, 10 - 10 * k, 10, 0, 5 + 5 * k, 0, 5, 3, 0, 5 - 5 * k, 10 - 10 * k, 0, 10, 0, 4]);
      expect(paths[3], backend).toEqual([0, 0, 0, 1, 20, 0, 1, 20, 10, 1, 0, 10, 4]);
    }
  });
  it('SVG-vector-effect: vector-effect takes the keywords Chrome parses, is not inherited, is a presentation hint, and marks a non-scaling stroke in the native write', () => {
    for (const [css, ok] of [['none', true], ['non-scaling-stroke', true], ['NON-SCALING-STROKE', true], ['non-scaling-size', false], ['non-rotation', false], ['fixed-position', false]] as const) {
      expect(paintAttributeValue('vector-effect', css).ok, css).toBe(ok);
    }
    const input = svgTree('svg { vector-effect: non-scaling-stroke; } .n { vector-effect: non-scaling-stroke; } .o { vector-effect: none; }', (_r, o) => [
      shape(o, 'i', 'path', [['d', 'M2 2 H20'], ['stroke', 'red']]),
      { ...shape(o, 'n', 'rect', [['width', '10'], ['height', '10']]), classes: [staticClass({ owner: DOC, sheet: 's', name: 'n' }, o)] },
      shape(o, 'a', 'circle', [['r', '4'], ['vector-effect', 'non-scaling-stroke']]),
      { ...shape(o, 'b', 'circle', [['r', '4'], ['vector-effect', 'non-scaling-stroke']]), classes: [staticClass({ owner: DOC, sheet: 's', name: 'o' }, o)] },
    ]);
    const c = compile(input, true);
    expect(errors(c)).toEqual([]);
    // Not inherited: the svg's own value reaches no shape; CSS beats the attribute.
    expect(svgScenes(c, [])?.[0]?.shapes.map((x) => [x.address, x.nonScalingStroke])).toEqual([['i', false], ['n', true], ['a', true], ['b', false]]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const backend of ['uikit', 'android-views'] as const) {
      const w = p.programs[backend].nodes.flatMap((n) => n.writes).find((x) => x.kind === 'svg-shapes');
      expect(w?.kind === 'svg-shapes' ? w.shapes.map((x) => x.nonScalingStroke) : null, backend).toEqual([false, true, true, false]);
    }
  });
  it('SVG-inert: clip-rule and marker none compile on every target and change no native write; a marker url refuses everywhere, on the svg and each shape that inherits it', () => {
    const shapes = (_r: SourceRef, o: Origin) => [shape(o, 'p', 'path', [['d', 'M0 0 H4 V4 Z'], ['clip-rule', 'evenodd'], ['marker-mid', 'none']]), shape(o, 'c', 'circle', [['r', '4']])];
    const program = (css: string) => {
      const c = compile(svgTree(css, shapes), false);
      expect(errors(c), css).toEqual([]);
      const p = nativePrograms(c, []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      return JSON.stringify(p.programs.uikit.nodes.flatMap((n) => n.writes).find((x) => x.kind === 'svg-shapes'));
    };
    expect(program('svg { clip-rule: evenodd; marker-start: none; } circle { clip-rule: EVENODD; marker-end: none; }')).toBe(program(''));
    const refused = (css: string) => errors(compile(svgTree(css, shapes), false)).sort();
    const all = (m: string) => ['android', 'ios', 'web'].map((t) => `DRAGON_UNSUPPORTED_VALUE ${t} ${m}`);
    expect(refused('circle { marker-end: url(#m); }')).toEqual(all('marker-end: url(#m) on <circle> c is unsupported: <marker> elements are not built yet (package SVG-b)'));
    expect(refused('svg { marker-start: url(#m); }')).toEqual([...all('marker-start: url(#m) on <circle> c is unsupported: <marker> elements are not built yet (package SVG-b)'), ...all('marker-start: url(#m) on <path> p is unsupported: <marker> elements are not built yet (package SVG-b)'), ...all('marker-start: url(#m) on <svg> s is unsupported: <marker> elements are not built yet (package SVG-b)')].sort());
    expect(svgAttributeRefusal('path', 'marker-end', 'url(#m)')).toContain('SVG-b');
    expect(svgAttributeRefusal('path', 'clip-rule', 'bogus')).not.toBeNull();
    expect(svgAttributeRefusal('rect', 'clip-rule', 'evenodd')).toBeNull();
  });
  it('SVG-rrect: refuses everywhere a percentage or calculated rx or ry on a rect, and a negative attribute; a negative in CSS is invalid', () => {
    const shapes = (_r: SourceRef, o: Origin) => [shape(o, 'r', 'rect', [['width', '4'], ['height', '4']]), shape(o, 'c', 'circle', [['r', '4']])];
    const refused = (css: string) => errors(compile(svgTree(css, shapes), false)).sort();
    const all = (m: string) => ['android', 'ios', 'web'].map((t) => `DRAGON_UNSUPPORTED_VALUE ${t} ${m}`);
    for (const css of ['', 'rect { rx: auto; ry: 0; } circle { rx: 10%; ry: calc(1px + 1px); }']) expect(refused(css), css).toEqual([]);
    expect(refused('rect { rx: 10%; }')).toEqual(all('rx: 10% on <rect> r is unsupported: a percentage rx is relative to the viewport width, which is not built yet (package SVG-units)'));
    expect(refused('rect { ry: calc(1px + 2px); }')).toEqual(all('ry: calc(1px + 2px) on <rect> r is unsupported: a calculated ry is not resolved yet (package SVG-units)'));
    expect(refused('rect { rx: -2px; }')).toEqual(['DRAGON_CSS_INVALID_VALUE * "-2px" is not a valid value for rx (@webref/css grammar)']);
    expect(svgAttributeRefusal('rect', 'ry', '-1')).toContain('negative');
    expect(svgAttributeRefusal('rect', 'rx', '2px')).toBeNull();
    expect(svgAttributeRefusal('rect', 'rx', '10%')).toContain('SVG-units');
  });
});

// SVG-a1 (/tmp/specs/svg-a.md): the SVG attribute grammars as Chrome 145 builds them (analysis/elements/svg-path.ts), the shapes'
// bounds (packages/layout/src/svg-geometry.ts) against getBBox values captured from Chrome, and the compiler's svg model: hints,
// refusals, structure and the native refusal. The fixtures' outlines against live Chrome are the parity svg group's.
import { describe, expect, it } from 'vitest';
import { objectBoundingBox } from '@dragon/layout';
import { parsePathData, parseSvgLength, parseViewBox } from '../src/analysis/elements/svg-path.ts';
import { paintAttributeValue, svgAttributeRefusal, svgPresentationHints } from '../src/analysis/elements/svg.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/types.ts';
import { div, inputFor, staticClass, DOC } from './helpers.ts';

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
  it('map fill, stroke and stroke-width, and an svg\'s or rect\'s width and height, to their properties', () => {
    const hints = svgPresentationHints('rect', new Map([['fill', 'rgb(1, 2, 3)'], ['stroke', 'none'], ['stroke-width', '3'], ['width', '5'], ['x', '2']]));
    expect([...hints.keys()]).toEqual(['fill', 'stroke', 'stroke-width', 'width']);
    expect(hints.get('stroke-width')).toEqual({ kind: 'number', value: 3 });
    expect(svgPresentationHints('circle', new Map([['r', '3']])).size).toBe(0);
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

  it('compiles an svg with its shapes for web, and refuses it on native as SVG-a2 outside the parity lanes', () => {
    const input = svgTree('', (_r, o) => [shape(o, 'p', 'path', [['d', 'M2 2 H20 V20 Z']]), shape(o, 'c', 'circle', [['cx', '12'], ['cy', '12'], ['r', '4']])]);
    const user = compile(input, false);
    expect(errors(user)).toEqual(['DRAGON_UNSUPPORTED_ELEMENT ios <svg> s is not drawn on ios yet: its shapes wait for the native SVG package SVG-a2', 'DRAGON_UNSUPPORTED_ELEMENT android <svg> s is not drawn on android yet: its shapes wait for the native SVG package SVG-a2']);
    expect(user.targets.web).not.toBe('blocked');
    expect(errors(compile(input, true))).toEqual([]);
  });
  it('refuses a group, text, a nested svg and a shape with children (SVG-b)', () => {
    const input = svgTree('', (r, o) => [shape(o, 'g', 'g', []), { kind: 'text', id: 't', text: 'hi', origin: o }, shape(o, 'p', 'path', [['d', 'M0 0']], [shape(o, 'q', 'rect', [])]), shape(o, 'n', 'svg', [])]);
    const e = errors(compile(input, true));
    expect(e.some((m) => m.startsWith('DRAGON_UNSUPPORTED_ELEMENT * <g> g is not supported'))).toBe(true);
    expect(e).toContain('DRAGON_UNSUPPORTED_ELEMENT * text inside an <svg> is not supported: SVG text waits for the SVG structure package SVG-b');
    expect(e.some((m) => m.startsWith('DRAGON_UNSUPPORTED_ELEMENT * <rect> q inside an SVG shape is not supported'))).toBe(true);
    expect(e.some((m) => m.startsWith('DRAGON_UNSUPPORTED_ELEMENT * <svg> n inside an <svg> is not supported'))).toBe(true);
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
});

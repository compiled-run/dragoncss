// SVG-a1 (/tmp/specs/svg-a.md): the strict outline differential. For every shape of every <svg> in a case, Dragon's geometry must
// equal Chrome's as doubles, with no allowance: getBBox (the tight bounds of the fill geometry in user units), getScreenCTM (the
// svg content box's position and the viewBox transform) and getBoundingClientRect (the bounding box mapped through it). The
// lane runs at the host DPR of 1, where Chrome's CSS px are its layout units.
//
// The viewBox transform is the engine's (svg-geometry.ts viewBoxTransform, in Chrome's observed arithmetic). The client rect maps
// each corner to the border box in double and rounds it to float32, adds the border box origin in float32, and takes the float32
// bounding box.
import type { LayoutInput, LayoutRect, LayoutStyle, SvgMatrix, SvgShape as EngineShape } from '@dragon/layout';
import { fromRaw, LU_PER_PX, objectBoundingBox, resolveBorder, resolvePadding, viewBoxTransform } from '@dragon/layout';
import type { SvgPaint, SvgScene } from 'dragon';
import { serializeColor } from 'dragon';
import type { WebCapture } from './capture.ts';

/**
 * Planted faults of the differential's Dragon side; each must fail the svg fixtures (test/svg.test.ts). controlPointBounds: a
 * path's bbox over its control points too. viewBoxIgnored: no viewBox transform. meetAsSlice: the scale of the other axis.
 * clientRectOneStep: the client rect mapped in one double step. paintSwapped: fill reported as stroke and stroke as fill.
 */
export type SvgFaults = { readonly controlPointBounds: boolean; readonly viewBoxIgnored: boolean; readonly meetAsSlice: boolean; readonly clientRectOneStep: boolean; readonly paintSwapped: boolean };
export const NO_SVG_FAULTS: SvgFaults = { controlPointBounds: false, viewBoxIgnored: false, meetAsSlice: false, clientRectOneStep: false, paintSwapped: false };

/** The viewBox transform of a viewport width x height (CSS px), as the engine computes it (svg-geometry.ts viewBoxTransform), or a plant's. */
export function chromeViewBoxTransform(viewBox: SvgScene['viewBox'], width: number, height: number, faults: SvgFaults = NO_SVG_FAULTS): SvgMatrix {
  if (faults.viewBoxIgnored) return viewBoxTransform(null, width, height, false);
  return viewBoxTransform(viewBox, width, height, faults.meetAsSlice);
}

/**
 * The map from user units to the svg's border box (Blink's local-to-border-box transform): the border and padding offset, then
 * the viewBox transform.
 */
export function localToBorderBox(borderPadding: { readonly x: number; readonly y: number }, viewBox: SvgMatrix): SvgMatrix {
  return { ...viewBox, e: borderPadding.x + viewBox.e, f: borderPadding.y + viewBox.f };
}

/** getScreenCTM of a shape: the svg's border box origin (CSS px), then the local-to-border-box map. */
export function shapeScreenCtm(origin: { readonly x: number; readonly y: number }, local: SvgMatrix): SvgMatrix {
  return { ...local, e: origin.x + local.e, f: origin.y + local.f };
}

/**
 * getBoundingClientRect of a shape: each bbox corner mapped to the border box in double and rounded to float32, then offset by the
 * border box origin in float32 (the two steps of Blink's quad mapping), then the float32 bounds.
 */
export function shapeClientRect(bbox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, local: SvgMatrix, origin: { readonly x: number; readonly y: number }, faults: SvgFaults = NO_SVG_FAULTS): readonly number[] {
  const f = Math.fround;
  const step = (v: number, o: number): number => (faults.clientRectOneStep ? f(v + o) : f(f(v) + o));
  const corners = [[bbox.x, bbox.y], [bbox.x + bbox.width, bbox.y], [bbox.x + bbox.width, bbox.y + bbox.height], [bbox.x, bbox.y + bbox.height]].map(([x, y]) => [
    step(local.a * (x as number) + local.c * (y as number) + local.e, origin.x),
    step(local.b * (x as number) + local.d * (y as number) + local.f, origin.y),
  ]);
  const xs = corners.map((c) => c[0] as number);
  const ys = corners.map((c) => c[1] as number);
  const l = Math.min(...xs);
  const t = Math.min(...ys);
  return [l, t, f(Math.max(...xs) - l), f(Math.max(...ys) - t)];
}

function styleOf(input: LayoutInput, id: string): LayoutStyle | null {
  const walk = (b: { readonly id: string; readonly style?: LayoutStyle; readonly children?: readonly unknown[] }): LayoutStyle | null => {
    if (b.id === id && b.style !== undefined) return b.style;
    for (const c of b.children ?? []) {
      const r = walk(c as { readonly id: string; readonly style?: LayoutStyle; readonly children?: readonly unknown[] });
      if (r !== null) return r;
    }
    return null;
  };
  return walk(input.root as unknown as { readonly id: string; readonly style?: LayoutStyle; readonly children?: readonly unknown[] });
}

const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]) || v === b[i]);

/** The controlPointBounds plant: the bounds of every point of a path, control points included. */
function controlPointBox(shape: EngineShape): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (shape.kind !== 'path') return objectBoundingBox(shape);
  const pts = shape.segments.flatMap((s) => (s.kind === 'close' ? [] : s.kind === 'cubic' ? [[s.x1, s.y1], [s.x2, s.y2], [s.x, s.y]] : s.kind === 'quad' ? [[s.x1, s.y1], [s.x, s.y]] : [[s.x, s.y]]));
  const xs = pts.map((p) => p[0] as number);
  const ys = pts.map((p) => p[1] as number);
  const l = Math.min(...xs);
  const t = Math.min(...ys);
  return { x: l, y: t, width: Math.fround(Math.max(...xs) - l), height: Math.fround(Math.max(...ys) - t) };
}

/** A paint as getComputedStyle serializes it. */
const paintText = (p: SvgPaint): string => (p.kind === 'none' ? 'none' : serializeColor(p.color));

/**
 * Every way a case's shapes differ from Chrome's: one problem per shape and quantity that is not equal as a double, and per paint
 * value (fill, stroke and stroke-width as Dragon resolved them) whose computed string differs. Both sides are judged whole: every
 * shape Chrome captured must be one of Dragon's scene shapes, and null scenes (no resolved case) with captured shapes fail.
 */
export function compareSvg(capture: WebCapture, scenes: readonly SvgScene[] | null, absolute: ReadonlyMap<string, LayoutRect>, input: LayoutInput, faults: SvgFaults = NO_SVG_FAULTS): string[] {
  const problems: string[] = [];
  const capturedShapes = capture.nodes.filter((n) => n.svg !== undefined).map((n) => n.id);
  if (scenes === null) return capturedShapes.length === 0 ? problems : [`Dragon resolved no svg scenes for this case, but Chrome captured the shapes ${capturedShapes.join(', ')}`];
  if (scenes.length === 0 && capturedShapes.length === 0) return problems;
  if (capture.devicePixelRatio !== 1) return [`the svg outline differential runs at DPR 1, not ${capture.devicePixelRatio}`];
  const dragonShapes = new Set(scenes.flatMap((scene) => scene.shapes.map((s) => s.address)));
  for (const id of capturedShapes) if (!dragonShapes.has(id)) problems.push(`${id}: Chrome captured an SVG shape that no Dragon svg scene has`);
  const captured = new Map(capture.nodes.filter((n) => n.kind === 'element').map((n) => [n.id, n]));
  for (const scene of scenes) {
    const box = absolute.get(scene.address);
    const style = styleOf(input, scene.address);
    if (box === undefined || style === null) {
      problems.push(`${scene.address}: the engine laid out no box for the <svg>`);
      continue;
    }
    if ([style.paddingLeft, style.paddingTop, style.paddingRight, style.paddingBottom].some((p) => p.kind !== 'px')) {
      problems.push(`${scene.address}: a percentage or calculated padding on an <svg> is not modelled by the svg differential`);
      continue;
    }
    const border = resolveBorder(style, 1);
    const padding = resolvePadding(style, fromRaw(0));
    const origin = { x: box.x / LU_PER_PX, y: box.y / LU_PER_PX };
    const borderPadding = { x: (border.left + padding.left) / LU_PER_PX, y: (border.top + padding.top) / LU_PER_PX };
    const width = Math.fround((box.width - border.left - border.right - padding.left - padding.right) / LU_PER_PX);
    const height = Math.fround((box.height - border.top - border.bottom - padding.top - padding.bottom) / LU_PER_PX);
    const local = localToBorderBox(borderPadding, chromeViewBoxTransform(scene.viewBox, width, height, faults));
    const ctm = shapeScreenCtm(origin, local);
    for (const s of scene.shapes) {
      const n = captured.get(s.address);
      if (n === undefined || n.svg === undefined) {
        problems.push(`${s.address}: Chrome captured no SVG geometry for the shape`);
        continue;
      }
      const b = faults.controlPointBounds ? controlPointBox(s.shape) : objectBoundingBox(s.shape);
      const bbox = [b.x, b.y, b.width, b.height];
      const m = [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f];
      const rect = shapeClientRect(b, local, origin, faults);
      const paints: [string, string][] = [['fill', paintText(faults.paintSwapped ? s.stroke : s.fill)], ['stroke', paintText(faults.paintSwapped ? s.fill : s.stroke)], ['stroke-width', `${s.strokeWidth}px`]];
      for (const [p, text] of paints) if (n.computed?.[p] !== text) problems.push(`${s.address}: ${p} computes to ${JSON.stringify(n.computed?.[p])} in Chrome, ${JSON.stringify(text)} in Dragon`);
      if (!same(bbox, n.svg.bbox)) problems.push(`${s.address}: getBBox ${JSON.stringify(n.svg.bbox)}, Dragon ${JSON.stringify(bbox)}`);
      if (!same(m, n.svg.ctm)) problems.push(`${s.address}: getScreenCTM ${JSON.stringify(n.svg.ctm)}, Dragon ${JSON.stringify(m)}`);
      if (!same(rect, [n.x, n.y, n.width, n.height])) problems.push(`${s.address}: getBoundingClientRect ${JSON.stringify([n.x, n.y, n.width, n.height])}, Dragon ${JSON.stringify(rect)}`);
    }
  }
  return problems;
}

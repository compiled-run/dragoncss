// border-radius (css-backgrounds-3 §5): Dragon geometry and Dragon drawing (T046 §1). The write carries the eight authored
// components (css px at zoom 1, or percentages); the device resolves them against the snapped border box at its scale with the
// translated paint-radius.ts (percentages, the §5.5 clamp, the padding-edge radii), and the background, the border and the
// overflow clip all use that one rounded shape. A box with square corners has no write, so its paint is unchanged.
import type { Longhand } from '../../css/properties.ts';
import type { RadiusComponent } from '../../css/properties/radius.ts';
import { cornerComponents, RADIUS_LONGHANDS } from '../../css/properties/radius.ts';
import type { ResolvedValue } from '../../analysis/resolve.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

/** One authored radius component: css px at zoom 1, or a percentage of the border box axis (paint-radius.ts RadiusLength). */
export type RadiusLengthValue = { readonly percent: boolean; readonly value: number };

/** The radius facts of a node (rt-hit.ts reads them): the eight components, horizontal then vertical, top-left first. */
export type RadiusFacts = { readonly lengths: readonly RadiusLengthValue[] };

export type RadiusWrite = { readonly kind: 'border-radius'; readonly lengths: readonly RadiusLengthValue[] };

const RADIUS_PAINT = 'Dragon resolves the eight radii at the device scale with the translated paint-radius.ts (percentages against the snapped border box, the css-backgrounds-3 §5.5 clamp, the padding-edge radii) and draws the background and solid borders in that rounded shape; an overflow: hidden box clips its children to the padding-edge curve';

function component(c: RadiusComponent, address: string, p: Longhand): RadiusLengthValue {
  if (c.kind === 'percentage') return { percent: true, value: c.value };
  if (c.unit !== 'px') throw new ProgramError(`${address}: ${p} did not compute to px (${c.value}${c.unit})`);
  return { percent: false, value: c.value };
}

/** The eight components of an element's computed radii (horizontal then vertical, top-left first). */
export function radiusLengths(props: ReadonlyMap<Longhand, ResolvedValue>, address: string): RadiusLengthValue[] {
  const h: RadiusLengthValue[] = [];
  const v: RadiusLengthValue[] = [];
  for (const p of RADIUS_LONGHANDS) {
    const r = props.get(p);
    if (r === undefined) throw new ProgramError(`${address}: ${p} did not resolve`);
    const parts = cornerComponents(r.value);
    if (parts === null) throw new ProgramError(`${address}: ${p} is not a radius (${r.value.kind})`);
    h.push(component(parts[0], address, p));
    v.push(component(parts[1], address, p));
  }
  return [...h, ...v];
}

/** Whether any corner has both components non-zero (a corner with a zero component is square, css-backgrounds-3 §5.1). */
export function roundsAnyCorner(lengths: readonly RadiusLengthValue[]): boolean {
  for (let k = 0; k < 4; k++) if ((lengths[k] as RadiusLengthValue).value > 0 && (lengths[k + 4] as RadiusLengthValue).value > 0) return true;
  return false;
}

export const RADIUS_LOWERING: PaintLowering<RadiusWrite> = {
  name: 'radius',
  vocabulary: {
    uikit: { 'border-radius': { key: 'dragonRadius.radiiPx', technique: 'dragon-owned-paint', detail: `DragonBoxView radii in device px after the clamp, horizontal then vertical, top-left first. ${RADIUS_PAINT}` } },
    'android-views': { 'border-radius': { key: 'dragonRadius.radiiPx', technique: 'dragon-owned-paint', detail: `DragonBoxView radii in device px after the clamp, horizontal then vertical, top-left first. ${RADIUS_PAINT}` } },
  },
  css: { 'border-radius': [...RADIUS_LONGHANDS] },
  // An anonymous box takes the initial radii (CSS2 §9.2.1.1): square, so no write.
  lower: ({ el, facts }) => {
    if (el === null) return [];
    const lengths = radiusLengths(el.props, el.element.address);
    if (!roundsAnyCorner(lengths)) return [];
    const radius: RadiusFacts = { lengths };
    facts['radius'] = radius;
    return [{ kind: 'border-radius', lengths }];
  },
};

// css-transforms-1 (PNT2): a box's transform, resolved by Dragon and set as the native view transform. The write carries the
// typed function list and origin (lengths in px or percent of the border box); the device resolves them at the box size after
// every layout with the translated paint-transform.ts and the platform's sin and cos. The node's facts publish the same list,
// origin and will-change features for the runtime helpers (hit testing, RT-9; SOV and ANIM-b writes).
import type { TransformLength, TransformOp, TransformOrigin } from '@dragon/layout';
import type { TransformFnDecl, TransformLengthDecl } from '../../css/properties/transform.ts';
import { inFloatRange, matrixParts } from '../../css/properties/transform.ts';
import type { ResolvedElement } from '../../analysis/resolve.ts';
import { elementTransform, elementTransformOrigin, elementWillChange } from '../../analysis/paint-values/transform.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type TransformWrite = { readonly kind: 'transform'; readonly ops: readonly TransformOp[]; readonly origin: TransformOrigin };

/** The transform facts of a node (facts.transform): the program's typed list and origin, and the will-change features. */
export type TransformFacts = { readonly ops: readonly TransformOp[]; readonly origin: TransformOrigin; readonly willChange: readonly string[] };

const ZERO: TransformLength = { kind: 'px', px: 0, percent: 0 };

/** -0 written as 0, so the program, the applied readback and the case code agree on one zero. */
const n = (v: number): number => v + 0;

function length(l: TransformLengthDecl, at: string): TransformLength {
  if (l.unit === '%') return { kind: 'percent', px: 0, percent: n(l.value) };
  if (l.unit === 'px') return { kind: 'px', px: n(l.value), percent: 0 };
  throw new ProgramError(`${at}: a transform length in ${l.unit} did not compute to px`);
}

/** The engine functions of one declared function; matrix() is translate · rotate · scale (css/properties/transform.ts). */
function engineOps(f: TransformFnDecl, at: string): TransformOp[] {
  switch (f.kind) {
    case 'translate':
      return [{ fn: f.fn, x: length(f.x, at), y: length(f.y, at), angle: 0, sx: 1, sy: 1 }];
    case 'rotate':
      return [{ fn: 'rotate', x: ZERO, y: ZERO, angle: n(f.deg), sx: 1, sy: 1 }];
    case 'scale':
      return [{ fn: f.fn, x: ZERO, y: ZERO, angle: 0, sx: n(f.sx), sy: n(f.sy) }];
    case 'matrix': {
      const p = matrixParts(f.values);
      // Finite entries can still overflow in the decomposition (a determinant past the double range).
      if (![p.tx, p.ty, p.deg, p.sx, p.sy].every(Number.isFinite)) throw new ProgramError(`${at}: ${f.text} overflows when written as translate, rotate and scale`);
      return [
        { fn: 'translate', x: { kind: 'px', px: n(p.tx), percent: 0 }, y: { kind: 'px', px: n(p.ty), percent: 0 }, angle: 0, sx: 1, sy: 1 },
        { fn: 'rotate', x: ZERO, y: ZERO, angle: n(p.deg), sx: 1, sy: 1 },
        { fn: 'scale', x: ZERO, y: ZERO, angle: 0, sx: n(p.sx), sy: n(p.sy) },
      ];
    }
  }
}

/** The largest box the overflow check resolves percentages against, in CSS px, and the largest device scale. */
const CHECK_BOX_PX = 1e6;
const CHECK_SCALE = 4;

/** A bound on a length's magnitude at a box of CHECK_BOX_PX. */
const lengthBound = (l: TransformLength): number => Math.abs(l.px) + (Math.abs(l.percent) / 100) * CHECK_BOX_PX;

/**
 * Throws when a bound on the transform's matrix entries and origin, at a box of CHECK_BOX_PX and in device px, leaves the float
 * range: Android writes them as floats, so finite CSS values can still compose past it (scale(1e30) scale(1e30)). The linear part is
 * bounded by the product of the scales' larger factors (a rotation keeps lengths), the translation by each translate times the
 * linear bound before it plus the origin compensation T(o) · M · T(-o), at most (1 + linear) times the origin. Angles never reach a
 * float: both writers take the matrix, whose rotation sinCosDegrees range-reduces.
 */
function checkRange(ops: readonly TransformOp[], origin: TransformOrigin, at: string): void {
  let linear = 1;
  let translation = 0;
  for (const o of ops) {
    if (o.fn.startsWith('translate')) translation += linear * (lengthBound(o.x) + lengthBound(o.y));
    if (o.fn.startsWith('scale')) linear *= Math.max(Math.abs(o.sx), Math.abs(o.sy));
  }
  const o = lengthBound(origin.x) + lengthBound(origin.y);
  const bounds = [linear, translation + (1 + linear) * o, o];
  if (!bounds.every((v) => inFloatRange(v * CHECK_SCALE))) throw new ProgramError(`${at}: the transform overflows the float range of the native writers`);
}

/** The typed origin of an element, checked against its functions for the native writers' range. */
function originOf(el: ResolvedElement, ops: readonly TransformOp[]): TransformOrigin {
  const at = el.element.address;
  const o = elementTransformOrigin(el);
  const origin = { x: length(o.x, at), y: length(o.y, at) };
  checkRange(ops, origin, at);
  return origin;
}

export const TRANSFORM_LOWERING: PaintLowering<TransformWrite> = {
  name: 'transform',
  vocabulary: {
    uikit: { transform: { key: 'dragonTransform', technique: 'native-property', detail: 'layer.setAffineTransform of the paint-transform.ts matrix at the box size (platform sin and cos), about the bounds centre with the origin compensated; layer.allowsEdgeAntialiasing = true' } },
    'android-views': { transform: { key: 'dragonTransform', technique: 'native-property', detail: 'the paint-transform.ts functions matrix at the box size (platform sin and cos) as View pivotX/Y (the origin), translationX/Y, rotation and scaleX/Y, in device px' } },
  },
  css: { transform: ['transform', 'transform-origin'] },
  lower: ({ el, facts }) => {
    // An anonymous box takes the initial value of every non-inherited property (CSS2 §9.2.1.1): transform none.
    if (el === null) return [];
    const ops = elementTransform(el).flatMap((f) => engineOps(f, el.element.address));
    const willChange = elementWillChange(el);
    // Without a transform or will-change the origin is never read, so it is neither lowered nor checked.
    if (ops.length === 0 && willChange.length === 0) return [];
    const origin = originOf(el, ops);
    facts['transform'] = { ops, origin, willChange } satisfies TransformFacts;
    return ops.length === 0 ? [] : [{ kind: 'transform', ops, origin }];
  },
};

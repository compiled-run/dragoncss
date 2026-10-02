// css-transforms-1 (PNT2): the native view transform. The case code writes the typed functions and origin through the view's
// transform writer (the entry point a runtime write calls too); the writer and the after-layout hook resolve them at the box
// size with the translated paint-transform.ts and the platform's sin and cos (T047 RT-4), then set UIKit's layer affine
// transform about the bounds centre (origin compensated, edge antialiasing on), or Android's pivot, translation, rotation and
// scale. The applied readback is the function list and origin the view holds. The platform's sin and cos stand in for the
// library calls of ui/gfx/geometry/sin_cos_degrees.h:25-110 (SinCosDegrees), whose range reduction and exact multiples of 90deg
// the translated rt-interpolate.ts sinCosDegrees keeps.
import type { TransformLength, TransformOp, TransformOrigin } from '@dragon/layout';
import type { NativeBackend } from '../../lower/paint/types.ts';
import type { JsonValue } from '../expected-dump.ts';
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

/** A Swift or Kotlin Double literal (the same text as native-support.ts doubleLit). */
function num(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`non-finite number ${v} in a transform`);
  if (Object.is(v, -0)) return '-0.0';
  const s = String(v);
  return /[.e]/.test(s) ? s.replace(/e\+?/, 'E') : `${s}.0`;
}

const KINDS: readonly string[] = ['px', 'percent', 'calc'];
const FNS: readonly string[] = ['translate', 'translateX', 'translateY', 'rotate', 'scale', 'scaleX', 'scaleY'];
function checked(s: string, allowed: readonly string[]): string {
  if (!allowed.includes(s)) throw new Error(`${JSON.stringify(s)} is not one of ${allowed.join(', ')}`);
  return `"${s}"`;
}

function lengthLit(b: NativeBackend, l: TransformLength): string {
  const k = checked(l.kind, KINDS);
  return b === 'uikit' ? `LengthValue(JsString(${k}), ${num(l.px)}, ${num(l.percent)})` : `LengthValue(${k}, ${num(l.px)}, ${num(l.percent)})`;
}

function opLit(b: NativeBackend, o: TransformOp): string {
  const fn = checked(o.fn, FNS);
  return `TransformOp(${b === 'uikit' ? `JsString(${fn})` : fn}, ${lengthLit(b, o.x)}, ${lengthLit(b, o.y)}, ${num(o.angle)}, ${num(o.sx)}, ${num(o.sy)})`;
}

const originLit = (b: NativeBackend, o: TransformOrigin): string => `TransformOrigin(${lengthLit(b, o.x)}, ${lengthLit(b, o.y)})`;

const lengthJson = (l: TransformLength): JsonValue => [l.kind, l.px, l.percent];

/** The applied value of a transform write: the function list and origin the view holds, on both backends. */
export function transformApplied(ops: readonly TransformOp[], origin: TransformOrigin): JsonValue {
  return { functions: ops.map((o) => [o.fn, lengthJson(o.x), lengthJson(o.y), o.angle, o.sx, o.sy]), origin: [lengthJson(origin.x), lengthJson(origin.y)] };
}

const SWIFT_MEMBERS = String.raw`  /// The transform the program wrote (PNT2): the typed functions and origin; no functions means none.
  public private(set) var dragonTransformOps: [TransformOp] = []
  public private(set) var dragonTransformOrigin: TransformOrigin? = nil
  /// The transform writer (PNT2; the runtime writers call it too): stores the functions and origin and applies them at the last
  /// layout's box size.
  public func dragonSetTransform(_ ops: [TransformOp], _ origin: TransformOrigin) {
    dragonTransformOps = ops
    dragonTransformOrigin = origin
    dragonApplyTransform(self, dragonShape, dragonScale)
  }
  /// UIKit leaves frame undefined under a non-identity transform, so a frame write lifts the transform around it.
  public override var frame: CGRect {
    get { return super.frame }
    set {
      let t = layer.transform
      layer.transform = CATransform3DIdentity
      super.frame = newValue
      layer.transform = t
    }
  }
`;

const SWIFT = String.raw`import UIKit

/// The platform's sin and cos for the translated gfx::SinCosDegrees (T047 RT-4); everything else is paint-transform.ts.
public let dragonTransformTrig = Trig({ Foundation.sin($0) }, { Foundation.cos($0) })

/// The transform of a box at its layout size: the paint matrix of paint-transform.ts in points (CSS px), set about the layer's
/// anchor point (the bounds centre) so that CSS's origin holds, with antialiased edges as Chrome draws them.
public func dragonApplyTransform(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let origin = v.dragonTransformOrigin, !v.dragonTransformOps.isEmpty else {
    v.layer.setAffineTransform(.identity)
    return
  }
  let e = shape.edges
  let w = (e[2] - e[0]) / scale
  let h = (e[3] - e[1]) / scale
  // The reference box of percentages: the border box.
  let rw = w, rh = h
  do {
    let m = try paintTransform_paintTransformMatrix(JsArray(v.dragonTransformOps), origin, rw, rh, dragonTransformTrig)
    let x = try paintTransform_transformAboutPoint(m, w / 2, h / 2)
    v.layer.allowsEdgeAntialiasing = true
    v.layer.setAffineTransform(CGAffineTransform(a: CGFloat(x.a), b: CGFloat(x.b), c: CGFloat(x.c), d: CGFloat(x.d), tx: CGFloat(x.e), ty: CGFloat(x.f)))
  } catch {
    fatalError("dragon: \(v.dragonId): the transform did not resolve: \(error)")
  }
}

/// After every layout: the transform at the new box size.
public func dragonAfterLayoutTransform(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  dragonApplyTransform(v, shape, scale)
}

private func dragonTransformLengthJson(_ l: LengthValue) -> DumpJson {
  return .array([.string(l.kind.description), .number(l.px), .number(l.percent)])
}

/// The readback of the transform module: the function list and origin the view holds.
public func dragonAppliedTransform(_ v: DragonBoxView) -> DumpJsonObject {
  guard let origin = v.dragonTransformOrigin, !v.dragonTransformOps.isEmpty else { return [] }
  let functions = v.dragonTransformOps.map { o -> DumpJson in .array([.string(o.fn.description), dragonTransformLengthJson(o.x), dragonTransformLengthJson(o.y), .number(o.angle), .number(o.sx), .number(o.sy)]) }
  return [("dragonTransform", .object([("functions", .array(functions)), ("origin", .array([dragonTransformLengthJson(origin.x), dragonTransformLengthJson(origin.y)]))]))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The transform the program wrote (PNT2): the typed functions and origin; no functions means none. */
  var dragonTransformOps: List<dev.dragon.layout.TransformOp> = emptyList()
    private set
  var dragonTransformOrigin: dev.dragon.layout.TransformOrigin? = null
    private set
  /** The transform writer (PNT2; the runtime writers call it too): stores the functions and origin and applies them at the last layout's box size. */
  fun dragonSetTransform(ops: List<dev.dragon.layout.TransformOp>, origin: dev.dragon.layout.TransformOrigin) {
    dragonTransformOps = ops
    dragonTransformOrigin = origin
    dragonApplyTransform(this, dragonShape, dragonTransformScale)
  }
  /** The device scale of the last layout (density), for the runtime writer. */
  var dragonTransformScale = 1.0
`;

const KOTLIN = String.raw`package dev.dragon.views

import dev.dragon.dump.DumpJson
import dev.dragon.layout.*

/** The platform's sin and cos for the translated gfx::SinCosDegrees (T047 RT-4); everything else is paint-transform.ts. */
val dragonTransformTrig = Trig({ kotlin.math.sin(it) }, { kotlin.math.cos(it) })

/**
 * The transform of a box at its layout size, in device px: the functions matrix of paint-transform.ts as a rotation times an
 * axis-aligned scale (the compiler refuses lists that skew), set as View pivot (the origin), translation, rotation and scale.
 * RenderNode composes T(translation) · T(pivot) · R · S · T(-pivot), which is T(origin) · functions · T(-origin).
 */
fun dragonApplyTransform(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val origin = v.dragonTransformOrigin
  if (origin == null || v.dragonTransformOps.isEmpty()) {
    v.translationX = 0f
    v.translationY = 0f
    v.rotation = 0f
    v.scaleX = 1f
    v.scaleY = 1f
    return
  }
  val e = shape.edges
  val w = (e[2] - e[0]) / scale
  val h = (e[3] - e[1]) / scale
  // The reference box of percentages: the border box.
  val rw = w
  val rh = h
  val m = paintTransform_transformFunctionsMatrix(ArrayList(v.dragonTransformOps), rw, rh, dragonTransformTrig)
  val o = paintTransform_resolveTransformOrigin(origin, rw, rh)
  // The compiler refuses every list whose composition skews (css/properties/transform.ts); a skewed matrix here is a Dragon bug.
  val skew = m.a * m.c + m.b * m.d
  if (kotlin.math.abs(skew) > 1e-9 * (m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d)) throw IllegalStateException("dragon: " + v.dragonId + ": a skewed transform reached the Android writer")
  val sx = kotlin.math.hypot(m.a, m.b)
  val sy: Double
  val degrees: Double
  if (sx > 0.0) {
    sy = (m.a * m.d - m.b * m.c) / sx
    degrees = Math.toDegrees(kotlin.math.atan2(m.b, m.a))
  } else {
    sy = kotlin.math.hypot(m.c, m.d)
    degrees = if (sy > 0.0) Math.toDegrees(kotlin.math.atan2(-m.c, m.d)) else 0.0
  }
  v.pivotX = (o.x * scale).toFloat()
  v.pivotY = (o.y * scale).toFloat()
  v.translationX = (m.e * scale).toFloat()
  v.translationY = (m.f * scale).toFloat()
  v.rotation = degrees.toFloat()
  v.scaleX = sx.toFloat()
  v.scaleY = sy.toFloat()
}

/** After every layout: the transform at the new box size. */
fun dragonAfterLayoutTransform(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  v.dragonTransformScale = scale
  dragonApplyTransform(v, shape, scale)
}

private fun dragonTransformLengthJson(l: LengthValue): DumpJson = DumpJson.Arr(listOf(DumpJson.Str(l.kind), DumpJson.Num(l.px), DumpJson.Num(l.percent)))

/** The readback of the transform module: the function list and origin the view holds. */
fun dragonAppliedTransform(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val origin = v.dragonTransformOrigin
  if (origin == null || v.dragonTransformOps.isEmpty()) return emptyList()
  val functions = v.dragonTransformOps.map { DumpJson.Arr(listOf(DumpJson.Str(it.fn), dragonTransformLengthJson(it.x), dragonTransformLengthJson(it.y), DumpJson.Num(it.angle), DumpJson.Num(it.sx), DumpJson.Num(it.sy))) }
  return listOf(Pair("dragonTransform", DumpJson.Obj(listOf(Pair("functions", DumpJson.Arr(functions)), Pair("origin", DumpJson.Arr(listOf(dragonTransformLengthJson(origin.x), dragonTransformLengthJson(origin.y))))))))
}
`;

export const TRANSFORM_EMITTER: PaintEmitter<'transform'> = {
  name: 'transform',
  kinds: ['transform'],
  lines: {
    uikit: (v, _n, w) => [`  ${v}.dragonSetTransform([${w.ops.map((o) => opLit('uikit', o)).join(', ')}], ${originLit('uikit', w.origin)})`],
    'android-views': (v, _n, w) => [`  ${v}.dragonSetTransform(listOf(${w.ops.map((o) => opLit('android-views', o)).join(', ')}), ${originLit('android-views', w.origin)})`],
  },
  applied: (_e, _b, w) => transformApplied(w.ops, w.origin),
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutTransform', applied: 'dragonAppliedTransform' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutTransform', applied: 'dragonAppliedTransform' },
  },
  plants: [
    // The origin taken as the border box's top left: rotated and scaled boxes land elsewhere unless the origin is 0 0.
    {
      name: 'transform-origin-ignored',
      replace: {
        uikit: ['let m = try paintTransform_paintTransformMatrix(JsArray(v.dragonTransformOps), origin, rw, rh, dragonTransformTrig)', 'let m = try paintTransform_paintTransformMatrix(JsArray(v.dragonTransformOps), TransformOrigin(LengthValue(JsString("px"), 0, 0), LengthValue(JsString("px"), 0, 0)), rw, rh, dragonTransformTrig)'],
        'android-views': ['val o = paintTransform_resolveTransformOrigin(origin, rw, rh)', 'val o = OriginPoint(0.0, 0.0)'],
      },
    },
    // Percentages resolved against the parent's box instead of the border box (css-transforms-1 §5: the reference box).
    {
      name: 'translate-percent-of-parent',
      replace: {
        uikit: ['let rw = w, rh = h', 'let rw = Double(v.superview?.bounds.width ?? 0), rh = Double(v.superview?.bounds.height ?? 0)'],
        'android-views': ['val rw = w\n  val rh = h', 'val rw = ((v.parent as? android.view.View)?.width ?: 0) / scale\n  val rh = ((v.parent as? android.view.View)?.height ?: 0) / scale'],
      },
    },
  ],
};

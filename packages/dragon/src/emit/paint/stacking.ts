// Paint order on the native tree (T046 §1, lower/paint/stacking.ts): the case code writes each layer item's host, bucket and rank
// through dragonSetPaintOrder, which hosts the view under its layer's view (DragonTree.host, used when the tree places frames) and
// stores its sort key. After every layout of a box, its host view's children are put in paint order: flow children (bucket 0) keep
// their tree order and every view that is not a box view (a text view) sorts with them, outline views follow them (in tree order), and
// the layer items follow by bucket and rank (z < 0 first). Only child order changes: zPosition, translationZ and elevation are never used. The readback is the live host and the view's
// index among the host's box views.
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

/** A Swift or Kotlin string literal, escaped as native-support.ts stringLit does (importing it here would be a module cycle). */
export function nativeString(lang: 'swift' | 'kotlin', s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (lang === 'kotlin' && ch === '$') out += '\\$';
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (lang === 'swift') out += `\\u{${cp.toString(16)}}`;
    else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += `\\u${ch.charCodeAt(0).toString(16)}\\u${ch.charCodeAt(1).toString(16)}`;
  }
  return `${out}"`;
}

const int = (v: number, what: string): string => {
  if (!Number.isInteger(v)) throw new Error(`paint order ${what} ${v} is not an integer`);
  return String(v);
};

const SWIFT_MEMBERS = String.raw`  /// The paint order sort key among the host's children: bucket -1 (z < 0), 0 (flow), 1 (auto or 0), 2 (z > 0), then rank.
  public var dragonPaintBucket: Int = 0
  public var dragonPaintRank: Int = 0
`;

const SWIFT = String.raw`import UIKit

/// Whether the sort puts layer items beneath the flow children; false except in the order-swap plant build.
public let dragonOrderPlantSwapped = false

/// The paint order write of a box (runtime writer): its host (placed there when the tree applies frames) and its sort key; the
/// host's children are then sorted.
public func dragonSetPaintOrder(_ t: DragonTree, _ v: DragonBoxView, _ host: String, _ bucket: Int, _ rank: Int) {
  if bucket < -1 || bucket > 2 || rank < 0 { fatalError("dragon: \(v.dragonId): paint order bucket \(bucket) or rank \(rank) is out of range") }
  v.dragonPaintBucket = bucket
  v.dragonPaintRank = rank
  t.host(v.dragonId, host)
  if let c = v.superview { dragonSortPaintOrder(c) }
}

/// Puts a container's children in paint order: flow children (and views that are not box views) in their current (tree) order,
/// then layer items by bucket and rank. Only moves views when the order changes.
public func dragonSortPaintOrder(_ c: UIView) {
  let subs = c.subviews
  if !subs.contains(where: { $0 is DragonOutlineView || (($0 as? DragonBoxView)?.dragonPaintBucket ?? 0) != 0 }) { return }
  func key(_ s: UIView, _ i: Int) -> [Int] {
    // An outline (PNT1 outline) paints after the flow children, before the layer items, in tree order; one that follows its box sorts
    // right after it.
    if let o = s as? DragonOutlineView {
      if let a = o.after { return [a.dragonPaintBucket, a.dragonPaintRank, 2, i] }
      return [0, 1, o.rank, i]
    }
    guard let b = s as? DragonBoxView, b.dragonPaintBucket != 0 else { return [0, 0, 0, i] }
    let bucket = dragonOrderPlantSwapped ? -3 + b.dragonPaintBucket : b.dragonPaintBucket
    return [bucket, b.dragonPaintRank, 1, i]
  }
  let sorted = subs.enumerated().map { (key($0.element, $0.offset), $0.element) }.sorted { $0.0.lexicographicallyPrecedes($1.0) }.map { $0.1 }
  if zip(sorted, subs).allSatisfy({ $0 === $1 }) { return }
  for (i, s) in sorted.enumerated() { c.insertSubview(s, at: i) }
}

/// After every layout of a box: its host's children in paint order (a box placed after a layer item sorts beneath it).
public func dragonAfterLayoutStacking(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  if let c = v.superview { dragonSortPaintOrder(c) }
}

/// The readback of the stacking module: the live host (the box whose view or clip view holds this one) and the view's index among
/// that container's box views.
public func dragonAppliedStacking(_ v: DragonBoxView) -> DumpJsonObject {
  if v.dragonPaintBucket == 0 { return [] }
  guard let c = v.superview, let host = (c as? DragonBoxView) ?? (c.superview as? DragonBoxView) else { return [("dragonStacking.order", .null)] }
  let boxes = c.subviews.compactMap { $0 as? DragonBoxView }
  guard let i = boxes.firstIndex(where: { $0 === v }) else { fatalError("dragon: \(v.dragonId) is not among its container's box views") }
  return [("dragonStacking.order", .array([.string(host.dragonId), .number(Double(i))]))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The paint order sort key among the host's children: bucket -1 (z < 0), 0 (flow), 1 (auto or 0), 2 (z > 0), then rank. */
  var dragonPaintBucket = 0
  var dragonPaintRank = 0
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.view.View
import android.view.ViewGroup
import dev.dragon.dump.DumpJson

/** Whether the sort puts layer items beneath the flow children; false except in the order-swap plant build. */
const val DRAGON_ORDER_PLANT_SWAPPED = false

/**
 * The paint order write of a box (runtime writer): its host (placed there when the tree applies frames) and its sort key; the
 * host's children are then sorted.
 */
fun dragonSetPaintOrder(t: DragonTree, v: DragonBoxView, host: String, bucket: Int, rank: Int) {
  if (bucket < -1 || bucket > 2 || rank < 0) throw IllegalStateException("dragon: " + v.dragonId + ": paint order bucket " + bucket + " or rank " + rank + " is out of range")
  v.dragonPaintBucket = bucket
  v.dragonPaintRank = rank
  t.host(v.dragonId, host)
  val c = v.parent
  if (c is ViewGroup) dragonSortPaintOrder(c)
}

/**
 * Puts a container's children in paint order: flow children (and views that are not box views) in their current (tree) order,
 * then layer items by bucket and rank. Only moves views when the order changes.
 */
fun dragonSortPaintOrder(c: ViewGroup) {
  val subs = (0 until c.childCount).map { c.getChildAt(it) }
  if (subs.none { it is DragonOutlineView || (it is DragonBoxView && it.dragonPaintBucket != 0) }) return
  fun key(s: View, i: Int): IntArray {
    // An outline (PNT1 outline) paints after the flow children, before the layer items, in tree order; one that follows its box sorts
    // right after it.
    if (s is DragonOutlineView) {
      val a = s.after
      if (a != null) return intArrayOf(a.dragonPaintBucket, a.dragonPaintRank, 2, i)
      return intArrayOf(0, 1, s.rank, i)
    }
    val b = s as? DragonBoxView
    if (b == null || b.dragonPaintBucket == 0) return intArrayOf(0, 0, 0, i)
    val bucket = if (DRAGON_ORDER_PLANT_SWAPPED) -3 + b.dragonPaintBucket else b.dragonPaintBucket
    return intArrayOf(bucket, b.dragonPaintRank, 1, i)
  }
  val cmp = Comparator<Pair<IntArray, View>> { x, y ->
    var r = 0
    for (k in 0 until 4) { r = x.first[k].compareTo(y.first[k]); if (r != 0) break }
    r
  }
  val sorted = subs.mapIndexed { i, s -> Pair(key(s, i), s) }.sortedWith(cmp).map { it.second }
  if (sorted.indices.all { sorted[it] === subs[it] }) return
  for ((i, s) in sorted.withIndex()) {
    if (c.getChildAt(i) === s) continue
    c.removeView(s)
    c.addView(s, i)
  }
}

/** After every layout of a box: its host's children in paint order (a box placed after a layer item sorts beneath it). */
fun dragonAfterLayoutStacking(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val c = v.parent
  if (c is ViewGroup) dragonSortPaintOrder(c)
}

/**
 * The readback of the stacking module: the live host (the box whose view or clip view holds this one) and the view's index among
 * that container's box views.
 */
fun dragonAppliedStacking(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonPaintBucket == 0) return emptyList()
  val c = v.parent as? ViewGroup
  val host = (c as? DragonBoxView) ?: (c?.parent as? DragonBoxView)
  if (c == null || host == null) return listOf(Pair("dragonStacking.order", DumpJson.Null))
  val boxes = (0 until c.childCount).map { c.getChildAt(it) }.filterIsInstance<DragonBoxView>()
  val i = boxes.indexOfFirst { it === v }
  if (i < 0) throw IllegalStateException("dragon: " + v.dragonId + " is not among its container's box views")
  return listOf(Pair("dragonStacking.order", DumpJson.Arr(listOf(DumpJson.Str(host.dragonId), DumpJson.Num(i.toDouble())))))
}
`;

export const STACKING_EMITTER: PaintEmitter<'paint-order', 'order-swap'> = {
  name: 'stacking',
  kinds: ['paint-order'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetPaintOrder(t, ${v}, ${nativeString('swift', w.host)}, ${int(w.bucket, 'bucket')}, ${int(w.rank, 'rank')})`],
    'android-views': (v, _n, w) => [`  dragonSetPaintOrder(t, ${v}, ${nativeString('kotlin', w.host)}, ${int(w.bucket, 'bucket')}, ${int(w.rank, 'rank')})`],
  },
  applied: (_e, _b, w) => [w.host, w.index],
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutStacking', applied: 'dragonAppliedStacking' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutStacking', applied: 'dragonAppliedStacking' },
  },
  plants: [
    {
      name: 'order-swap',
      replace: {
        uikit: ['public let dragonOrderPlantSwapped = false\n', 'public let dragonOrderPlantSwapped = true\n'],
        'android-views': ['const val DRAGON_ORDER_PLANT_SWAPPED = false\n', 'const val DRAGON_ORDER_PLANT_SWAPPED = true\n'],
      },
    },
  ],
};

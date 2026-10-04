// Paint order on the native tree (T046 §1, lower/paint/stacking.ts): the case code writes each layer item's host, bucket and rank
// through dragonSetPaintOrder, which hosts the view under its layer's view (DragonTree.host, used when the tree places frames) and
// stores its sort key, and each box's foreground placements (a flex item itself, or its text leaves) through dragonSetForeground,
// which hosts them under their native root and stores their ranks on it. Whenever a view joins a box's container (the box or its
// clip view: didAddSubview, onViewAdded and the clip view's hierarchy listener) and after every layout of a box, the container's
// children are put in paint order: flow children (bucket 0) keep their tree order, the foreground follows by rank, outline views
// follow (in tree order), the layer items follow by bucket and rank (z < 0 first), and a box's shadow companion stays directly
// beneath it. Only child order changes: zPosition, translationZ and elevation are never used. The readback is the live host and the
// view's index among the host's box views, and for a foreground write the live host and the number of box views before each entry.
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
  /// The foreground ranks of the node views this box hosts (paint-foreground writes), by node id.
  public var dragonForegroundRanks: [String: Int] = [:]
  /// This box's own paint-foreground write: the node ids it hosts under its native root.
  public var dragonForegroundIds: [String] = []
  public weak var dragonForegroundTree: DragonTree? = nil
  public override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    dragonSortOnAdd(self)
  }
`;

const SWIFT = String.raw`import UIKit

/// Whether the sort puts layer items beneath the flow children; false except in the order-swap plant build.
public let dragonOrderPlantSwapped = false
/// Whether the sort puts the foreground beneath the flow children; false except in the foreground-under plant build.
public let dragonForegroundPlantUnder = false

/// The paint order write of a box (runtime writer): its host (placed there when the tree applies frames) and its sort key; the
/// host's children are then sorted.
public func dragonSetPaintOrder(_ t: DragonTree, _ v: DragonBoxView, _ host: String, _ bucket: Int, _ rank: Int) {
  if bucket < -1 || bucket > 2 || rank < 0 { fatalError("dragon: \(v.dragonId): paint order bucket \(bucket) or rank \(rank) is out of range") }
  v.dragonPaintBucket = bucket
  v.dragonPaintRank = rank
  t.host(v.dragonId, host)
  if let c = v.superview { dragonSortPaintOrder(c) }
}

/// The paint-foreground write of a box (runtime writer): each node id (the box itself when it is a flex item, else its text leaves)
/// is hosted under the host box (placed there when the tree applies frames) with its rank, which the host stores.
public func dragonSetForeground(_ t: DragonTree, _ v: DragonBoxView, _ host: String, _ ids: [String], _ ranks: [Int]) {
  if ids.isEmpty || ids.count != ranks.count || ranks.contains(where: { $0 < 0 }) { fatalError("dragon: \(v.dragonId): foreground ids \(ids) or ranks \(ranks) are malformed") }
  guard let h = t.node(host) as? DragonBoxView else { fatalError("dragon: \(v.dragonId): the foreground host \(host) is not a built box") }
  for (id, r) in zip(ids, ranks) {
    h.dragonForegroundRanks[id] = r
    t.host(id, host)
  }
  v.dragonForegroundIds = ids
  v.dragonForegroundTree = t
  dragonSortPaintOrder(h.dragonContainer)
}

/// Every view that joins a clip view sorts it as one that joins a box view does.
extension DragonClipView {
  public override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    dragonSortOnAdd(self)
  }
}

/// Whether a sort is moving views (its own insertions do not sort again).
private var dragonSortingPaintOrder = false

/// A view joined container c: c is put in paint order, unless the join is a sort's own move.
public func dragonSortOnAdd(_ c: UIView) {
  if !dragonSortingPaintOrder { dragonSortPaintOrder(c) }
}

/// The box a subview paints for: a box view itself, or the box whose shadow companion it is.
private func dragonPaintOwner(_ s: UIView, _ companions: [ObjectIdentifier: DragonBoxView]) -> DragonBoxView? {
  return (s as? DragonBoxView) ?? companions[ObjectIdentifier(s)]
}

/// Puts a container's children in paint order: flow children in their current (tree) order, the foreground by rank, outline views,
/// then layer items by bucket and rank; a companion sorts directly beneath its box. Only moves views when the order changes.
public func dragonSortPaintOrder(_ c: UIView) {
  let subs = c.subviews
  // The foreground ranks live on the box whose container this is (the box itself or its clip view's owner).
  let ranks = ((c as? DragonBoxView) ?? (c.superview as? DragonBoxView))?.dragonForegroundRanks ?? [:]
  var companions: [ObjectIdentifier: DragonBoxView] = [:]
  var keyed = !ranks.isEmpty
  for s in subs {
    if s is DragonOutlineView { keyed = true }
    guard let b = s as? DragonBoxView else { continue }
    if b.dragonPaintBucket != 0 { keyed = true }
    if let sv = b.dragonShadowView { companions[ObjectIdentifier(sv)] = b }
  }
  if !keyed { return }
  let foreground = dragonForegroundPlantUnder ? -1 : 1
  func key(_ s: UIView, _ i: Int) -> [Int] {
    // An outline (PNT1 outline) paints after the flow children and the foreground, before the layer items, in tree order.
    if let o = s as? DragonOutlineView { return [0, 2, o.rank, 0, i] }
    if let b = dragonPaintOwner(s, companions) {
      if b.dragonPaintBucket != 0 {
        let bucket = dragonOrderPlantSwapped ? -3 + b.dragonPaintBucket : b.dragonPaintBucket
        return [bucket, b.dragonPaintRank, s === b ? 1 : 0, 0, i]
      }
      if let r = ranks[b.dragonId] { return [0, foreground, r, s === b ? 1 : 0, i] }
      return [0, 0, 0, 0, i]
    }
    if let n = s as? DragonTextView, let r = ranks[n.dragonId] { return [0, foreground, r, 1, i] }
    return [0, 0, 0, 0, i]
  }
  let sorted = subs.enumerated().map { (key($0.element, $0.offset), $0.element) }.sorted { $0.0.lexicographicallyPrecedes($1.0) }.map { $0.1 }
  if zip(sorted, subs).allSatisfy({ $0 === $1 }) { return }
  dragonSortingPaintOrder = true
  defer { dragonSortingPaintOrder = false }
  for (i, s) in sorted.enumerated() { c.insertSubview(s, at: i) }
}

/// After every layout of a box: its host's children in paint order (a box placed after a layer item sorts beneath it).
public func dragonAfterLayoutStacking(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  if let c = v.superview { dragonSortPaintOrder(c) }
}

/// The box whose view or clip view a view is in, or nil.
private func dragonHostBox(_ c: UIView?) -> DragonBoxView? {
  guard let c = c else { return nil }
  return (c as? DragonBoxView) ?? (c.superview as? DragonBoxView)
}

/// The readback of the stacking module, in write order: for a paint-order write the live host (the box whose view or clip view
/// holds this one) and the view's index among that container's box views; for a paint-foreground write the live host of the
/// entries and the number of box views before each one in its container.
public func dragonAppliedStacking(_ v: DragonBoxView) -> DumpJsonObject {
  var out: DumpJsonObject = []
  if v.dragonPaintBucket != 0 {
    if let c = v.superview, let host = dragonHostBox(c) {
      let boxes = c.subviews.compactMap { $0 as? DragonBoxView }
      guard let i = boxes.firstIndex(where: { $0 === v }) else { fatalError("dragon: \(v.dragonId) is not among its container's box views") }
      out.append(("dragonStacking.order", .array([.string(host.dragonId), .number(Double(i))])))
    } else {
      out.append(("dragonStacking.order", .null))
    }
  }
  if !v.dragonForegroundIds.isEmpty {
    var hosts: [String] = []
    var indices: [DumpJson] = []
    for id in v.dragonForegroundIds {
      guard let n = v.dragonForegroundTree?.node(id) as? UIView, let c = n.superview, let host = dragonHostBox(c) else { break }
      guard let i = c.subviews.firstIndex(where: { $0 === n }) else { fatalError("dragon: \(id) is not among its container's views") }
      hosts.append(host.dragonId)
      indices.append(.number(Double(c.subviews[..<i].filter { $0 is DragonBoxView }.count)))
    }
    if hosts.count != v.dragonForegroundIds.count || Set(hosts).count != 1 { out.append(("dragonStacking.foreground", .null)) }
    else { out.append(("dragonStacking.foreground", .array([.string(hosts[0])] + indices))) }
  }
  return out
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The paint order sort key among the host's children: bucket -1 (z < 0), 0 (flow), 1 (auto or 0), 2 (z > 0), then rank. */
  var dragonPaintBucket = 0
  var dragonPaintRank = 0
  /** The foreground ranks of the node views this box hosts (paint-foreground writes), by node id. */
  val dragonForegroundRanks = HashMap<String, Int>()
  /** This box's own paint-foreground write: the node ids it hosts under its native root. */
  var dragonForegroundIds: List<String> = emptyList()
  var dragonForegroundTree: DragonTree? = null
  override fun onViewAdded(child: android.view.View) {
    super.onViewAdded(child)
    if (child is DragonClipView) child.setOnHierarchyChangeListener(DragonSortOnAdd)
    dragonSortOnAdd(this)
  }
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.view.View
import android.view.ViewGroup
import dev.dragon.dump.DumpJson

/** Whether the sort puts layer items beneath the flow children; false except in the order-swap plant build. */
const val DRAGON_ORDER_PLANT_SWAPPED = false
/** Whether the sort puts the foreground beneath the flow children; false except in the foreground-under plant build. */
const val DRAGON_FOREGROUND_PLANT_UNDER = false

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
 * The paint-foreground write of a box (runtime writer): each node id (the box itself when it is a flex item, else its text leaves)
 * is hosted under the host box (placed there when the tree applies frames) with its rank, which the host stores.
 */
fun dragonSetForeground(t: DragonTree, v: DragonBoxView, host: String, ids: List<String>, ranks: IntArray) {
  if (ids.isEmpty() || ids.size != ranks.size || ranks.any { it < 0 }) throw IllegalStateException("dragon: " + v.dragonId + ": foreground ids " + ids + " or ranks " + ranks.toList() + " are malformed")
  val h = t.node(host) as? DragonBoxView ?: throw IllegalStateException("dragon: " + v.dragonId + ": the foreground host " + host + " is not a built box")
  for ((k, id) in ids.withIndex()) {
    h.dragonForegroundRanks[id] = ranks[k]
    t.host(id, host)
  }
  v.dragonForegroundIds = ids
  v.dragonForegroundTree = t
  dragonSortPaintOrder(h.dragonContainer)
}

/** Whether a sort is moving views (its own insertions do not sort again). */
private var dragonSortingPaintOrder = false

/** A view joined container c: c is put in paint order, unless the join is a sort's own move. */
fun dragonSortOnAdd(c: ViewGroup) {
  if (!dragonSortingPaintOrder) dragonSortPaintOrder(c)
}

/** Every view that joins a clip view sorts it as one that joins a box view does. */
object DragonSortOnAdd : ViewGroup.OnHierarchyChangeListener {
  override fun onChildViewAdded(parent: View?, child: View?) {
    if (parent is ViewGroup) dragonSortOnAdd(parent)
  }
  override fun onChildViewRemoved(parent: View?, child: View?) {}
}

/**
 * Puts a container's children in paint order: flow children in their current (tree) order, the foreground by rank, outline views,
 * then layer items by bucket and rank; a companion sorts directly beneath its box. Only moves views when the order changes.
 */
fun dragonSortPaintOrder(c: ViewGroup) {
  val subs = (0 until c.childCount).map { c.getChildAt(it) }
  // The foreground ranks live on the box whose container this is (the box itself or its clip view's owner).
  val ranks: Map<String, Int> = ((c as? DragonBoxView) ?: (c.parent as? DragonBoxView))?.dragonForegroundRanks ?: emptyMap()
  val companions = HashMap<View, DragonBoxView>()
  var keyed = ranks.isNotEmpty()
  for (s in subs) {
    if (s is DragonOutlineView) keyed = true
    if (s !is DragonBoxView) continue
    if (s.dragonPaintBucket != 0) keyed = true
    val sv = s.dragonShadowView
    if (sv != null) companions[sv] = s
  }
  if (!keyed) return
  val foreground = if (DRAGON_FOREGROUND_PLANT_UNDER) -1 else 1
  fun key(s: View, i: Int): IntArray {
    // An outline (PNT1 outline) paints after the flow children and the foreground, before the layer items, in tree order.
    if (s is DragonOutlineView) return intArrayOf(0, 2, s.rank, 0, i)
    val b = (s as? DragonBoxView) ?: companions[s]
    if (b != null) {
      if (b.dragonPaintBucket != 0) {
        val bucket = if (DRAGON_ORDER_PLANT_SWAPPED) -3 + b.dragonPaintBucket else b.dragonPaintBucket
        return intArrayOf(bucket, b.dragonPaintRank, if (s === b) 1 else 0, 0, i)
      }
      val r = ranks[b.dragonId]
      if (r != null) return intArrayOf(0, foreground, r, if (s === b) 1 else 0, i)
      return intArrayOf(0, 0, 0, 0, i)
    }
    val r = if (s is DragonTextView) ranks[s.dragonId] else null
    if (r != null) return intArrayOf(0, foreground, r, 1, i)
    return intArrayOf(0, 0, 0, 0, i)
  }
  val cmp = Comparator<Pair<IntArray, View>> { x, y ->
    var r = 0
    for (k in 0 until 5) { r = x.first[k].compareTo(y.first[k]); if (r != 0) break }
    r
  }
  val sorted = subs.mapIndexed { i, s -> Pair(key(s, i), s) }.sortedWith(cmp).map { it.second }
  if (sorted.indices.all { sorted[it] === subs[it] }) return
  dragonSortingPaintOrder = true
  try {
    for ((i, s) in sorted.withIndex()) {
      if (c.getChildAt(i) === s) continue
      c.removeView(s)
      c.addView(s, i)
    }
  } finally {
    dragonSortingPaintOrder = false
  }
}

/** After every layout of a box: its host's children in paint order (a box placed after a layer item sorts beneath it). */
fun dragonAfterLayoutStacking(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val c = v.parent
  if (c is ViewGroup) dragonSortPaintOrder(c)
}

/** The box whose view or clip view a container is, or null. */
private fun dragonHostBox(c: ViewGroup?): DragonBoxView? = (c as? DragonBoxView) ?: (c?.parent as? DragonBoxView)

/**
 * The readback of the stacking module, in write order: for a paint-order write the live host (the box whose view or clip view holds
 * this one) and the view's index among that container's box views; for a paint-foreground write the live host of the entries and
 * the number of box views before each one in its container.
 */
fun dragonAppliedStacking(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val out = ArrayList<Pair<String, DumpJson>>()
  if (v.dragonPaintBucket != 0) {
    val c = v.parent as? ViewGroup
    val host = dragonHostBox(c)
    if (c == null || host == null) out.add(Pair("dragonStacking.order", DumpJson.Null))
    else {
      val boxes = (0 until c.childCount).map { c.getChildAt(it) }.filterIsInstance<DragonBoxView>()
      val i = boxes.indexOfFirst { it === v }
      if (i < 0) throw IllegalStateException("dragon: " + v.dragonId + " is not among its container's box views")
      out.add(Pair("dragonStacking.order", DumpJson.Arr(listOf(DumpJson.Str(host.dragonId), DumpJson.Num(i.toDouble())))))
    }
  }
  if (v.dragonForegroundIds.isNotEmpty()) {
    val hosts = ArrayList<String>()
    val indices = ArrayList<DumpJson>()
    for (id in v.dragonForegroundIds) {
      val n = v.dragonForegroundTree?.node(id) as? View ?: break
      val c = n.parent as? ViewGroup ?: break
      val host = dragonHostBox(c) ?: break
      val subs = (0 until c.childCount).map { c.getChildAt(it) }
      val i = subs.indexOfFirst { it === n }
      if (i < 0) throw IllegalStateException("dragon: " + id + " is not among its container's views")
      hosts.add(host.dragonId)
      indices.add(DumpJson.Num(subs.subList(0, i).count { it is DragonBoxView }.toDouble()))
    }
    if (hosts.size != v.dragonForegroundIds.size || hosts.toSet().size != 1) out.add(Pair("dragonStacking.foreground", DumpJson.Null))
    else out.add(Pair("dragonStacking.foreground", DumpJson.Arr(listOf<DumpJson>(DumpJson.Str(hosts[0])) + indices)))
  }
  return out
}
`;

const ids = (lang: 'swift' | 'kotlin', w: { readonly entries: readonly { readonly id: string; readonly rank: number }[] }): string => {
  if (w.entries.length === 0) throw new Error('a paint-foreground write with no entries');
  const names = w.entries.map((e) => nativeString(lang, e.id)).join(', ');
  const ranks = w.entries.map((e) => int(e.rank, 'foreground rank')).join(', ');
  return lang === 'swift' ? `[${names}], [${ranks}]` : `listOf(${names}), intArrayOf(${ranks})`;
};

export const STACKING_EMITTER: PaintEmitter<'paint-order' | 'paint-foreground'> = {
  name: 'stacking',
  kinds: ['paint-order', 'paint-foreground'],
  lines: {
    uikit: (v, _n, w) =>
      w.kind === 'paint-order'
        ? [`  dragonSetPaintOrder(t, ${v}, ${nativeString('swift', w.host)}, ${int(w.bucket, 'bucket')}, ${int(w.rank, 'rank')})`]
        : [`  dragonSetForeground(t, ${v}, ${nativeString('swift', w.host)}, ${ids('swift', w)})`],
    'android-views': (v, _n, w) =>
      w.kind === 'paint-order'
        ? [`  dragonSetPaintOrder(t, ${v}, ${nativeString('kotlin', w.host)}, ${int(w.bucket, 'bucket')}, ${int(w.rank, 'rank')})`]
        : [`  dragonSetForeground(t, ${v}, ${nativeString('kotlin', w.host)}, ${ids('kotlin', w)})`],
  },
  applied: (_e, _b, w) => (w.kind === 'paint-order' ? [w.host, w.index] : [w.host, ...w.entries.map((e) => e.index)]),
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
    {
      name: 'foreground-under',
      replace: {
        uikit: ['public let dragonForegroundPlantUnder = false\n', 'public let dragonForegroundPlantUnder = true\n'],
        'android-views': ['const val DRAGON_FOREGROUND_PLANT_UNDER = false\n', 'const val DRAGON_FOREGROUND_PLANT_UNDER = true\n'],
      },
    },
  ],
};

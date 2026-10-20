// Accessibility roles on the box view (P6b): the case code writes a heading's level through dragonHeading, the one writer. The tree's
// text pass reads it from each text view's nearest heading ancestor in the DOM and gives every line the platform's heading mark: the
// header trait on iOS, setHeading on Android. The readback is the level and how many lines under the box view the platform does
// not expose as headings (0 when a screen reader reads every one as a heading), read from the elements and nodes themselves.
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// The box's heading level (h1 to h6), 0 when it is not a heading; set only by dragonHeading.
  public var dragonHeadingLevel = 0
`;

const SWIFT = String.raw`import UIKit

/// The heading write of a box (h1 to h6): its level, which every line of text under it in the DOM is exposed with.
public func dragonHeading(_ v: DragonBoxView, _ level: Int) {
  if level < 1 || level > 6 { fatalError("dragon: \(v.dragonId): heading level \(level) is not 1 to 6") }
  v.dragonHeadingLevel = level
}

/// The readback of a heading: its level and the count of line elements under the box view without the header trait.
public func dragonAppliedHeading(_ v: DragonBoxView) -> DumpJsonObject {
  if v.dragonHeadingLevel == 0 { return [] }
  var plain = 0
  func walk(_ x: UIView) {
    for s in x.subviews {
      if let t = s as? DragonTextView { plain += t.dragonAccessibleLines.filter { !$0.accessibilityTraits.contains(.header) }.count }
      walk(s)
    }
  }
  walk(v)
  return [("accessibilityHeading", .array([.number(Double(v.dragonHeadingLevel)), .number(Double(plain))]))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The box's heading level (h1 to h6), 0 when it is not a heading; set only by dragonHeading. */
  var dragonHeadingLevel = 0
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.view.View
import android.view.ViewGroup
import dev.dragon.dump.DumpJson

/** The heading write of a box (h1 to h6): its level, which every line of text under it in the DOM is exposed with. */
fun dragonHeading(v: DragonBoxView, level: Int) {
  if (level < 1 || level > 6) throw IllegalStateException("dragon: " + v.dragonId + ": heading level " + level + " is not 1 to 6")
  v.dragonHeadingLevel = level
}

/** The readback of a heading: its level and the count of virtual line nodes under the box view that are not headings. */
fun dragonAppliedHeading(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonHeadingLevel == 0) return emptyList()
  var plain = 0
  fun walk(x: View) {
    if (x is DragonTextView) {
      val provider = x.accessibilityNodeProvider
      for (k in x.dragonAccessibleNames.indices) if (provider?.createAccessibilityNodeInfo(k)?.isHeading != true) plain++
    }
    if (x is ViewGroup) for (i in 0 until x.childCount) walk(x.getChildAt(i))
  }
  walk(v)
  return listOf(Pair("accessibilityHeading", DumpJson.Arr(listOf(DumpJson.Num(v.dragonHeadingLevel.toDouble()), DumpJson.Num(plain.toDouble())))))
}
`;

export const ROLE_EMITTER: PaintEmitter<'heading'> = {
  name: 'role',
  kinds: ['heading'],
  lines: {
    uikit: (v, _n, w) => [`  dragonHeading(${v}, ${w.level})`],
    'android-views': (v, _n, w) => [`  dragonHeading(${v}, ${w.level})`],
  },
  // The level, and every line under the box exposed as a heading.
  applied: (_e, _b, w) => [w.level, 0],
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, applied: 'dragonAppliedHeading' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, applied: 'dragonAppliedHeading' },
  },
  plants: [],
};

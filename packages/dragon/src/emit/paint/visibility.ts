// visibility on the box view (T150a): the case code writes the used keyword through dragonVisibility, the one runtime writer. A box
// that is not visible keeps its view, so its visible descendants still paint: dragonVisible gates every paint stage (dragonPaintBox),
// the native background goes off (dragonSyncBackground), and the element's text views take the platform hidden flag. The change runs
// with implicit actions disabled; nothing animates. The readback is the keyword, whether the gate is shut, whether the box view
// itself is hidden, and how many native paints of the box still show. The background of html and body is the canvas's, which Chrome
// paints whatever their visibility: it stays on, square, as the canvas is.
import type { PaintEmitter } from './types.ts';
import { keywordLit, NO_NATIVE_PAINT } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// The box's visibility keyword as last written; visible until a visibility write.
  public var dragonVisibilityValue = "visible"
  /// Whether the box's background is the canvas's (html and body), which shows whatever the box's visibility.
  public var dragonVisibilityCanvas = false
`;

const SWIFT = String.raw`import UIKit

/// Whether the visibility writer ignores the write; false except in the visibility-ignored plant build.
public let dragonVisibilityPlantIgnored = false
/// Whether the visibility writer hides the box view itself, and with it every descendant; false except in the visibility-subtree plant build.
public let dragonVisibilityPlantSubtree = false

/// The visibility write of a box (runtime writer): visible, hidden or collapse, and whether its background is the canvas's. Only
/// visible paints the box's own decorations and text; the box view stays shown either way.
public func dragonVisibility(_ v: DragonBoxView, _ value: String, _ canvas: Bool) {
  if value != "visible" && value != "hidden" && value != "collapse" { fatalError("dragon: \(v.dragonId): visibility \(value) is not visible, hidden or collapse") }
  if dragonVisibilityPlantIgnored { return }
  let visible = value == "visible"
  CATransaction.begin()
  CATransaction.setDisableActions(true)
  v.dragonVisibilityValue = value
  v.dragonVisibilityCanvas = canvas
  v.dragonVisible = visible
  if dragonVisibilityPlantSubtree { v.isHidden = !visible }
  for t in v.dragonTextLeaves { t.isHidden = !visible }
  dragonSyncBackground(v)
  CATransaction.commit()
  v.setNeedsDisplay()
}

/// The readback of the visibility module, for a box that is not visible: the keyword, 1 when the paint gate is shut, 1 when the
/// box view itself is hidden, and the count of the box's native paints still shown (a background that is not the canvas's, text
/// views).
public func dragonAppliedVisibility(_ v: DragonBoxView) -> DumpJsonObject {
  if v.dragonVisibilityValue == "visible" && v.dragonVisible && !v.isHidden { return [] }
  var shown = v.backgroundColor == nil || v.dragonVisibilityCanvas ? 0 : 1
  for t in v.dragonTextLeaves where !t.isHidden { shown += 1 }
  return [("visibility", .array([.string(v.dragonVisibilityValue), .number(v.dragonVisible ? 0 : 1), .number(v.isHidden ? 1 : 0), .number(Double(shown))]))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The box's visibility keyword as last written; visible until a visibility write. */
  var dragonVisibilityValue = "visible"
  /** Whether the box's background is the canvas's (html and body), which shows whatever the box's visibility. */
  var dragonVisibilityCanvas = false
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.view.View
import dev.dragon.dump.DumpJson

/** Whether the visibility writer ignores the write; false except in the visibility-ignored plant build. */
const val DRAGON_VISIBILITY_PLANT_IGNORED = false
/** Whether the visibility writer hides the box view itself, and with it every descendant; false except in the visibility-subtree plant build. */
const val DRAGON_VISIBILITY_PLANT_SUBTREE = false

/**
 * The visibility write of a box (runtime writer): visible, hidden or collapse, and whether its background is the canvas's. Only
 * visible paints the box's own decorations and text; the box view stays shown either way.
 */
fun dragonVisibility(v: DragonBoxView, value: String, canvas: Boolean) {
  if (value != "visible" && value != "hidden" && value != "collapse") throw IllegalStateException("dragon: " + v.dragonId + ": visibility " + value + " is not visible, hidden or collapse")
  if (DRAGON_VISIBILITY_PLANT_IGNORED) return
  val visible = value == "visible"
  v.dragonVisibilityValue = value
  v.dragonVisibilityCanvas = canvas
  v.dragonVisible = visible
  if (DRAGON_VISIBILITY_PLANT_SUBTREE) v.visibility = if (visible) View.VISIBLE else View.INVISIBLE
  for (t in v.dragonTextLeaves) t.visibility = if (visible) View.VISIBLE else View.INVISIBLE
  dragonSyncBackground(v)
  v.invalidate()
}

/**
 * The readback of the visibility module, for a box that is not visible: the keyword, 1 when the paint gate is shut, 1 when the box
 * view itself is hidden, and the count of the box's native paints still shown (a background that is not the canvas's, text views).
 */
fun dragonAppliedVisibility(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonVisibilityValue == "visible" && v.dragonVisible && v.visibility == View.VISIBLE) return emptyList()
  var shown = if (v.background == null || v.dragonVisibilityCanvas) 0 else 1
  for (t in v.dragonTextLeaves) if (t.visibility == View.VISIBLE) shown++
  return listOf(Pair("visibility", DumpJson.Arr(listOf(DumpJson.Str(v.dragonVisibilityValue), DumpJson.Num(if (v.dragonVisible) 0.0 else 1.0), DumpJson.Num(if (v.visibility == View.VISIBLE) 0.0 else 1.0), DumpJson.Num(shown.toDouble())))))
}
`;

export const VISIBILITY_EMITTER: PaintEmitter<'visibility', 'visibility-ignored' | 'visibility-subtree'> = {
  name: 'visibility',
  kinds: ['visibility'],
  lines: {
    uikit: (v, _n, w) => [`  dragonVisibility(${v}, ${keywordLit(w.value)}, ${w.canvas ? 'true' : 'false'})`],
    'android-views': (v, _n, w) => [`  dragonVisibility(${v}, ${keywordLit(w.value)}, ${w.canvas ? 'true' : 'false'})`],
  },
  // The gate shut, the box view shown, and no native paint of the box left showing.
  applied: (_e, _b, w) => [w.value, 1, 0, 0],
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, applied: 'dragonAppliedVisibility' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, applied: 'dragonAppliedVisibility' },
  },
  plants: [
    {
      name: 'visibility-ignored',
      replace: {
        uikit: ['public let dragonVisibilityPlantIgnored = false\n', 'public let dragonVisibilityPlantIgnored = true\n'],
        'android-views': ['const val DRAGON_VISIBILITY_PLANT_IGNORED = false\n', 'const val DRAGON_VISIBILITY_PLANT_IGNORED = true\n'],
      },
    },
    {
      name: 'visibility-subtree',
      replace: {
        uikit: ['public let dragonVisibilityPlantSubtree = false\n', 'public let dragonVisibilityPlantSubtree = true\n'],
        'android-views': ['const val DRAGON_VISIBILITY_PLANT_SUBTREE = false\n', 'const val DRAGON_VISIBILITY_PLANT_SUBTREE = true\n'],
      },
    },
  ],
};

// Accessibility roles on the box view (P6b): the case code writes a heading's level through dragonHeading, the one writer. The tree's
// text pass reads it from each text view's nearest heading ancestor in the DOM and gives every line the platform's heading mark: the
// header trait on iOS, setHeading on Android. The readback is the level the box view holds. Whether each line (or a whole leaf's
// one element) carries the heading mark is read from the elements and nodes themselves in the dump, wherever PNT1 hosts the text
// view, and device-lines holds every text node to the model's headings (ax-lines.ts checkAccessibleLines).
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

/// The readback of a heading: the level the box view holds.
public func dragonAppliedHeading(_ v: DragonBoxView) -> DumpJsonObject {
  if v.dragonHeadingLevel == 0 { return [] }
  return [("accessibilityHeading", .number(Double(v.dragonHeadingLevel)))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** The box's heading level (h1 to h6), 0 when it is not a heading; set only by dragonHeading. */
  var dragonHeadingLevel = 0
`;

const KOTLIN = String.raw`package dev.dragon.views

import dev.dragon.dump.DumpJson

/** The heading write of a box (h1 to h6): its level, which every line of text under it in the DOM is exposed with. */
fun dragonHeading(v: DragonBoxView, level: Int) {
  if (level < 1 || level > 6) throw IllegalStateException("dragon: " + v.dragonId + ": heading level " + level + " is not 1 to 6")
  v.dragonHeadingLevel = level
}

/** The readback of a heading: the level the box view holds. */
fun dragonAppliedHeading(v: DragonBoxView): List<Pair<String, DumpJson>> {
  if (v.dragonHeadingLevel == 0) return emptyList()
  return listOf(Pair("accessibilityHeading", DumpJson.Num(v.dragonHeadingLevel.toDouble())))
}
`;

export const ROLE_EMITTER: PaintEmitter<'heading'> = {
  name: 'role',
  kinds: ['heading'],
  lines: {
    uikit: (v, _n, w) => [`  dragonHeading(${v}, ${w.level})`],
    'android-views': (v, _n, w) => [`  dragonHeading(${v}, ${w.level})`],
  },
  // The level; the lines' heading marks are device-lines' (checkAccessibleLines).
  applied: (_e, _b, w) => w.level,
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, applied: 'dragonAppliedHeading' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, applied: 'dragonAppliedHeading' },
  },
  plants: [],
};

// The selection runtime (notes/T154-user-select-spec.md slice 2b; P6c, T077): text selection over a mounted case, from the
// translated selection model (packages/layout/src/rt-select.ts) built on the case's own engine input, the device's measurer and the
// compiler's selection facts (internal.ts selectFacts). On iOS, DragonSelection adopts UITextInput as non-editable text and hands
// UIKit's UITextInteraction(for: .nonEditable) the handles, loupe and copy menu; its positions are the model's caret list, its
// rects the model's caret rects and painted highlight, and its text the model's Selection.toString. On Android the same model is
// wrapped without views until slice 2c builds the handles and the action mode over it.
import type { NativeBackend } from '../../lower/native-program.ts';
import type { GeneratedFile } from '../../types.ts';

export const SELECT_RUNTIME_VERSION = 'dragon.runtime-select/1';

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
function swiftSupportText(): string {
  return String.raw`import UIKit

/// The compiler's selection facts of a case (rt-select.ts SelectFacts): the body's address, the p elements', every element whose
/// used user-select is none and every element whose used visibility is hidden or collapse.
public struct DragonSelectFacts {
  public let body: String
  public let paragraphs: [String]
  public let unselectable: [String]
  public let hidden: [String]
  public init(body: String, paragraphs: [String], unselectable: [String], hidden: [String]) { self.body = body; self.paragraphs = paragraphs; self.unselectable = unselectable; self.hidden = hidden }
}

/// A text position: an index into the selection model's caret list (rt-select.ts caretList), in document order.
public final class DragonTextPosition: UITextPosition {
  public let index: Int
  public init(_ index: Int) { self.index = index; super.init() }
}

/// A text range between two caret indices, from <= to.
public final class DragonTextRange: UITextRange {
  public let from: Int
  public let to: Int
  public init(_ a: Int, _ b: Int) { from = min(a, b); to = max(a, b); super.init() }
  public override var start: UITextPosition { return DragonTextPosition(from) }
  public override var end: UITextPosition { return DragonTextPosition(to) }
  public override var isEmpty: Bool { return from == to }
}

/// One rect of the painted highlight (rt-select.ts highlightRects), in the root's points.
public final class DragonSelectionRect: UITextSelectionRect {
  private let box: CGRect
  private let first: Bool
  private let last: Bool
  init(_ box: CGRect, first: Bool, last: Bool) { self.box = box; self.first = first; self.last = last; super.init() }
  public override var rect: CGRect { return box }
  public override var writingDirection: NSWritingDirection { return .leftToRight }
  public override var containsStart: Bool { return first }
  public override var containsEnd: Bool { return last }
  public override var isVertical: Bool { return false }
}

/// A translated selection call; a throw is a broken table or a bad caret, which the generated code never recovers from.
func dragonSelectCall<T>(_ what: String, _ f: () throws -> T) -> T {
  do { return try f() } catch { fatalError("dragon: selection \(what): \(error)") }
}

/// Text selection over one mounted tree: UITextInput on the selection model of the tree's engine input at the mount's scale. attach
/// adds it to the tree's root and puts UIKit's non-editable text interaction on the root, so taps still reach the views below; the
/// root's coordinates are the model's, divided by scale * 64 (the model works in LU of device pixels, as the hit table does).
public final class DragonSelection: UIView, UITextInput, UITextInteractionDelegate {
  private let table: SelectTable
  private let carets: [Caret]
  private let zoom: Double
  private var selected: DragonTextRange?
  public let interaction = UITextInteraction(for: .nonEditable)
  public weak var inputDelegate: UITextInputDelegate?
  public lazy var tokenizer: UITextInputTokenizer = UITextInputStringTokenizer(textInput: self)
  public var markedTextStyle: [NSAttributedString.Key: Any]?

  public init(input: LayoutInput, measurer: TextMeasurer, facts: DragonSelectFacts, scale: Double) {
    let f = SelectFacts(JsString(facts.body), JsArray(facts.paragraphs.map { JsString($0) }), JsArray(facts.unselectable.map { JsString($0) }), JsArray(facts.hidden.map { JsString($0) }))
    let t = dragonSelectCall("table") { try rtSelect_selectionTableOf(input, measurer, f) }
    table = t
    carets = dragonSelectCall("carets") { try rtSelect_caretList(t) }.items
    zoom = scale * 64
    super.init(frame: .zero)
  }
  required init?(coder: NSCoder) { fatalError("DragonSelection is built in code") }

  /// Puts the selection on a mounted tree's root.
  public func attach(to root: UIView) {
    root.addSubview(self)
    interaction.textInput = self
    interaction.delegate = self
    root.addInteraction(interaction)
  }

  public func detach() {
    interaction.view?.removeInteraction(interaction)
    removeFromSuperview()
  }

  public override var canBecomeFirstResponder: Bool { return true }
  public var textInputView: UIView { return superview ?? self }

  // ---------------------------------------------------------------- the model, in the root's points

  private func caret(_ p: UITextPosition) -> Int {
    guard let d = p as? DragonTextPosition else { fatalError("dragon: selection: a position the selection did not make") }
    return max(0, min(carets.count - 1, d.index))
  }

  private func span(_ r: UITextRange) -> DragonTextRange {
    guard let d = r as? DragonTextRange else { fatalError("dragon: selection: a range the selection did not make") }
    return d
  }

  private func lu(_ v: CGFloat) -> Double { return dragonSelectCall("pxToLu") { try rtSelect_pxToLu(Double(v) * zoom / 64) } }

  private func point(_ v: Double) -> CGFloat { return CGFloat(v / zoom) }

  /// The caret index a point picks: the drag focus's (rt-select.ts focusAt), an empty block's read as the next text's start.
  private func index(at p: CGPoint) -> Int? {
    if carets.isEmpty { return nil }
    guard let c = dragonSelectCall("focusAt", { try rtSelect_focusAt(table, lu(p.x), lu(p.y)) }) else { return nil }
    return Int(dragonSelectCall("caretIndex") { try rtSelect_caretIndex(JsArray(carets), c) })
  }

  // ---------------------------------------------------------------- UITextInteractionDelegate

  /// A press on an element whose used user-select is none starts no selection (rt-select.ts anchorAt).
  public func interactionShouldBegin(_ interaction: UITextInteraction, at point: CGPoint) -> Bool {
    if carets.isEmpty { return false }
    return dragonSelectCall("anchorAt") { try rtSelect_anchorAt(table, lu(point.x), lu(point.y)) } != nil
  }

  // ---------------------------------------------------------------- UITextInput: positions and ranges

  public var beginningOfDocument: UITextPosition { return DragonTextPosition(0) }
  public var endOfDocument: UITextPosition { return DragonTextPosition(max(0, carets.count - 1)) }

  public var selectedTextRange: UITextRange? {
    get { return selected }
    set {
      inputDelegate?.selectionWillChange(self)
      selected = newValue.map { span($0) }
      inputDelegate?.selectionDidChange(self)
    }
  }

  public var markedTextRange: UITextRange? { return nil }

  public func textRange(from fromPosition: UITextPosition, to toPosition: UITextPosition) -> UITextRange? {
    return DragonTextRange(caret(fromPosition), caret(toPosition))
  }

  public func position(from position: UITextPosition, offset: Int) -> UITextPosition? {
    let i = caret(position) + offset
    return i < 0 || i >= carets.count ? nil : DragonTextPosition(i)
  }

  /// Left and right move by caret; up and down move to the caret the line above or below picks at the same x.
  public func position(from position: UITextPosition, in direction: UITextLayoutDirection, offset: Int) -> UITextPosition? {
    switch direction {
    case .left: return self.position(from: position, offset: -offset)
    case .right: return self.position(from: position, offset: offset)
    case .up, .down:
      var i = caret(position)
      for _ in 0..<offset {
        let r = dragonSelectCall("caretRect") { try rtSelect_caretRect(table, carets[i]) }
        let lines = table.lines.items
        guard let l = lines.firstIndex(where: { $0.top <= r.y && r.y < $0.bottom }) else { return nil }
        let to = direction == .up ? l - 1 : l + 1
        if to < 0 || to >= lines.count { return nil }
        let line = lines[to]
        guard let c = dragonSelectCall("focusAt", { try rtSelect_focusAt(table, r.x, (line.top + line.bottom) / 2) }) else { return nil }
        i = Int(dragonSelectCall("caretIndex") { try rtSelect_caretIndex(JsArray(carets), c) })
      }
      return DragonTextPosition(i)
    @unknown default: return nil
    }
  }

  public func compare(_ position: UITextPosition, to other: UITextPosition) -> ComparisonResult {
    let a = caret(position)
    let b = caret(other)
    return a < b ? .orderedAscending : a > b ? .orderedDescending : .orderedSame
  }

  public func offset(from: UITextPosition, to toPosition: UITextPosition) -> Int {
    return caret(toPosition) - caret(from)
  }

  public func position(within range: UITextRange, farthestIn direction: UITextLayoutDirection) -> UITextPosition? {
    let r = span(range)
    return DragonTextPosition(direction == .left || direction == .up ? r.from : r.to)
  }

  public func characterRange(byExtending position: UITextPosition, in direction: UITextLayoutDirection) -> UITextRange? {
    let i = caret(position)
    return direction == .left || direction == .up ? DragonTextRange(max(0, i - 1), i) : DragonTextRange(i, min(carets.count - 1, i + 1))
  }

  public func baseWritingDirection(for position: UITextPosition, in direction: UITextStorageDirection) -> NSWritingDirection { return .leftToRight }
  public func setBaseWritingDirection(_ writingDirection: NSWritingDirection, for range: UITextRange) {}

  // ---------------------------------------------------------------- UITextInput: geometry

  public func caretRect(for position: UITextPosition) -> CGRect {
    if carets.isEmpty { return .zero }
    let r = dragonSelectCall("caretRect") { try rtSelect_caretRect(table, carets[caret(position)]) }
    return CGRect(x: point(r.x), y: point(r.y), width: 2, height: point(r.height))
  }

  public func selectionRects(for range: UITextRange) -> [UITextSelectionRect] {
    let r = span(range)
    if r.isEmpty || carets.isEmpty { return [] }
    let rects = dragonSelectCall("highlightRects") { try rtSelect_highlightRects(table, carets[r.from], carets[r.to]) }.items
    return rects.enumerated().map { (k, h) in
      DragonSelectionRect(CGRect(x: point(h.left), y: point(h.top), width: point(h.right - h.left), height: point(h.bottom - h.top)), first: k == 0, last: k == rects.count - 1)
    }
  }

  public func firstRect(for range: UITextRange) -> CGRect {
    return selectionRects(for: range).first?.rect ?? caretRect(for: range.start)
  }

  public func closestPosition(to point: CGPoint) -> UITextPosition? {
    return index(at: point).map { DragonTextPosition($0) }
  }

  public func closestPosition(to point: CGPoint, within range: UITextRange) -> UITextPosition? {
    let r = span(range)
    guard let i = index(at: point) else { return nil }
    return DragonTextPosition(max(r.from, min(r.to, i)))
  }

  public func characterRange(at point: CGPoint) -> UITextRange? {
    guard let i = index(at: point) else { return nil }
    return DragonTextRange(i, min(carets.count - 1, i + 1))
  }

  // ---------------------------------------------------------------- UITextInput: text (Selection.toString), never edited

  public func text(in range: UITextRange) -> String? {
    let r = span(range)
    if carets.isEmpty { return "" }
    return dragonSelectCall("selectedText") { try rtSelect_selectedText(table, carets[r.from], carets[r.to]) }.description
  }

  public func replace(_ range: UITextRange, withText text: String) {}
  public func setMarkedText(_ markedText: String?, selectedRange: NSRange) {}
  public func unmarkText() {}
  public var hasText: Bool { return !carets.isEmpty }
  public func insertText(_ text: String) {}
  public func deleteBackward() {}

  // ---------------------------------------------------------------- the edit menu

  public override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    if action == #selector(copy(_:)) { return selected.map { !$0.isEmpty } ?? false }
    if action == #selector(selectAll(_:)) { return !carets.isEmpty }
    return false
  }

  public override func copy(_ sender: Any?) {
    guard let r = selected, !r.isEmpty, let s = text(in: r) else { return }
    UIPasteboard.general.string = s
  }

  public override func selectAll(_ sender: Any?) {
    if carets.isEmpty { return }
    selectedTextRange = DragonTextRange(0, carets.count - 1)
  }
}
`;
}

function kotlinSupportText(): string {
  return String.raw`package dev.dragon.views

import dev.dragon.layout.Caret
import dev.dragon.layout.CaretRect
import dev.dragon.layout.HighlightRect
import dev.dragon.layout.JsArray
import dev.dragon.layout.LayoutInput
import dev.dragon.layout.SelectFacts
import dev.dragon.layout.SelectTable
import dev.dragon.layout.TextMeasurer
import dev.dragon.layout.rtSelect_anchorAt
import dev.dragon.layout.rtSelect_caretIndex
import dev.dragon.layout.rtSelect_caretList
import dev.dragon.layout.rtSelect_caretRect
import dev.dragon.layout.rtSelect_focusAt
import dev.dragon.layout.rtSelect_highlightRects
import dev.dragon.layout.rtSelect_pxToLu
import dev.dragon.layout.rtSelect_selectedText
import dev.dragon.layout.rtSelect_selectionTableOf

/** The compiler's selection facts of a case (rt-select.ts SelectFacts). */
class DragonSelectFacts(val body: String, val paragraphs: List<String>, val unselectable: List<String>, val hidden: List<String>)

/**
 * The selection model of one mounted tree (rt-select.ts), in the root's px: carets by index in document order, the press gate, the
 * drag focus, caret and highlight rects, and the selected text. Slice 2c puts Android's handles and action mode over it.
 */
class DragonSelection(input: LayoutInput, measurer: TextMeasurer, facts: DragonSelectFacts, scale: Double) {
  private val table: SelectTable = rtSelect_selectionTableOf(input, measurer, SelectFacts(facts.body, ArrayList(facts.paragraphs), ArrayList(facts.unselectable), ArrayList(facts.hidden)))
  private val carets: JsArray<Caret> = rtSelect_caretList(table)
  private val zoom = scale * 64.0
  val count: Int get() = carets.size

  private fun lu(v: Double): Double = rtSelect_pxToLu(v * zoom / 64.0)

  /** Whether a press at a point starts a selection (rt-select.ts anchorAt). */
  fun startsAt(x: Double, y: Double): Boolean = count > 0 && rtSelect_anchorAt(table, lu(x), lu(y)) != null

  /** The caret index a drag to a point focuses, or -1 without selectable text. */
  fun indexAt(x: Double, y: Double): Int {
    if (count == 0) return -1
    val c = rtSelect_focusAt(table, lu(x), lu(y)) ?: return -1
    return rtSelect_caretIndex(carets, c).toInt()
  }

  /** A caret's rect in px: x, y, height. */
  fun caretRect(i: Int): DoubleArray {
    val r: CaretRect = rtSelect_caretRect(table, carets[i])
    return doubleArrayOf(r.x / zoom, r.y / zoom, r.height / zoom)
  }

  /** The painted highlight between two caret indices, in px: left, top, right, bottom per rect. */
  fun highlight(a: Int, b: Int): List<DoubleArray> {
    if (count == 0 || a == b) return emptyList()
    return rtSelect_highlightRects(table, carets[minOf(a, b)], carets[maxOf(a, b)]).map { h: HighlightRect -> doubleArrayOf(h.left / zoom, h.top / zoom, h.right / zoom, h.bottom / zoom) }
  }

  /** The text a selection between two caret indices copies (Selection.toString). */
  fun text(a: Int, b: Int): String = if (count == 0) "" else rtSelect_selectedText(table, carets[a], carets[b])
}
`;
}

/** The selection runtime support source of a backend. */
export function selectSupport(backend: NativeBackend, header: (what: string) => string): GeneratedFile {
  return backend === 'uikit'
    ? { path: 'Support/DragonSelection.swift', text: header('the selection runtime') + swiftSupportText() }
    : { path: 'kotlin/dev/dragon/views/DragonSelection.kt', text: header('the selection runtime') + kotlinSupportText() };
}

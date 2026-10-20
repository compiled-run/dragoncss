// The selection runtime (notes/T154-user-select-spec.md slice 2b; P6c, T077): text selection over a mounted case, from the
// translated selection model (packages/layout/src/rt-select.ts) built on the case's own engine input, the device's measurer and the
// compiler's selection facts (internal.ts selectFacts). On iOS, DragonSelection adopts UITextInput as non-editable text and hands
// UIKit's UITextInteraction(for: .nonEditable) the handles, loupe and copy menu; its positions are the model's caret list, its
// rects the model's caret rects and painted highlight, and its text the model's Selection.toString. On Android the same model is
// on screen through DragonSelectionFrame: the theme's handles, a Magnifier and a floating action mode for copy.
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

/// UIKit's string tokenizer, but a word is the selection model's (rt-select.ts wordAround), as Chrome selects one on a double click
/// or a long press.
public final class DragonWordTokenizer: UITextInputStringTokenizer {
  private weak var selection: DragonSelection?
  init(selection: DragonSelection) { self.selection = selection; super.init(textInput: selection) }
  public override func rangeEnclosingPosition(_ position: UITextPosition, with granularity: UITextGranularity, inDirection direction: UITextDirection) -> UITextRange? {
    if granularity == .word, let s = selection { return s.word(around: position) }
    return super.rangeEnclosingPosition(position, with: granularity, inDirection: direction)
  }
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
  public lazy var tokenizer: UITextInputTokenizer = DragonWordTokenizer(selection: self)
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

  /// The word around a position (rt-select.ts wordAround), or nil where none is selected.
  public func word(around position: UITextPosition) -> UITextRange? {
    if carets.isEmpty { return nil }
    let w = dragonSelectCall("wordAround") { try rtSelect_wordAround(table, carets[caret(position)]) }.items
    if w.count != 2 { return nil }
    let all = JsArray(carets)
    let a = Int(dragonSelectCall("caretIndex") { try rtSelect_caretIndex(all, w[0]) })
    let b = Int(dragonSelectCall("caretIndex") { try rtSelect_caretIndex(all, w[1]) })
    return DragonTextRange(a, b)
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

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.view.ActionMode
import android.view.GestureDetector
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.Magnifier
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
import dev.dragon.layout.rtSelect_wordAt

/** The compiler's selection facts of a case (rt-select.ts SelectFacts). */
class DragonSelectFacts(val body: String, val paragraphs: List<String>, val unselectable: List<String>, val hidden: List<String>)

/**
 * The selection model of one mounted tree (rt-select.ts), in the root's CSS px: carets by index in document order, the press gate,
 * the drag focus, the long-press word, caret and highlight rects, and the selected text. DragonSelectionFrame puts it on screen.
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

  /** The word a long press at a point selects (rt-select.ts wordAt) as anchor and focus indices, or null. */
  fun word(x: Double, y: Double): IntArray? {
    if (count == 0) return null
    val w = rtSelect_wordAt(table, lu(x), lu(y))
    if (w.size != 2) return null
    return intArrayOf(rtSelect_caretIndex(carets, w[0]).toInt(), rtSelect_caretIndex(carets, w[1]).toInt())
  }
}

/**
 * Text selection on screen (slice 2c): a frame around a mounted tree's root that watches its touches without taking them. A long
 * press selects the model's word; the highlight is the model's, in the theme's highlight colour; the theme's handles drag either
 * end with a Magnifier over the finger; a floating action mode copies (ClipboardManager) or selects all; a tap clears. The frame's
 * px are device px; the model's are CSS px (divided by scale).
 */
class DragonSelectionFrame(context: Context, private val selection: DragonSelection, private val scale: Double) : FrameLayout(context) {
  var anchor = -1
    private set
  var focus = -1
    private set
  private val paint = Paint().apply { color = themeColor(android.R.attr.textColorHighlight) }
  private val left = Handle(themeDrawable(android.R.attr.textSelectHandleLeft), true)
  private val right = Handle(themeDrawable(android.R.attr.textSelectHandleRight), false)
  private var mode: ActionMode? = null
  private val magnifier = Magnifier.Builder(this).build()
  private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onLongPress(e: MotionEvent) {
      val w = selection.word(e.x / scale, e.y / scale) ?: return
      select(w[0], w[1])
    }
    override fun onSingleTapUp(e: MotionEvent): Boolean {
      clear()
      return false
    }
  })

  init {
    setWillNotDraw(false)
    addView(left, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
    addView(right, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
    left.visibility = View.GONE
    right.visibility = View.GONE
  }

  private fun themeColor(attr: Int): Int {
    val a = context.obtainStyledAttributes(intArrayOf(attr))
    try { return a.getColor(0, 0x6633b5e5) } finally { a.recycle() }
  }

  private fun themeDrawable(attr: Int): Drawable {
    val a = context.obtainStyledAttributes(intArrayOf(attr))
    try { return a.getDrawable(0) ?: throw IllegalStateException("dragon: the theme has no text selection handle") } finally { a.recycle() }
  }

  /** Watches every touch for the long press and the clearing tap; the tree below still receives it. */
  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    val handled = super.dispatchTouchEvent(ev)
    gestures.onTouchEvent(ev)
    return handled || ev.actionMasked == MotionEvent.ACTION_DOWN
  }

  fun select(a: Int, f: Int) {
    if (a < 0 || f < 0 || a == f) return clear()
    anchor = a
    focus = f
    placeHandles()
    invalidate()
    if (mode == null) mode = startActionMode(Menu(), ActionMode.TYPE_FLOATING) else mode?.invalidateContentRect()
  }

  fun clear() {
    anchor = -1
    focus = -1
    left.visibility = View.GONE
    right.visibility = View.GONE
    mode?.finish()
    mode = null
    invalidate()
  }

  /** The selected text (Selection.toString), or "" without a selection. */
  fun selectedText(): String = if (anchor < 0) "" else selection.text(minOf(anchor, focus), maxOf(anchor, focus))

  private fun placeHandles() {
    val lo = minOf(anchor, focus)
    val hi = maxOf(anchor, focus)
    for ((h, i) in listOf(left to lo, right to hi)) {
      val r = selection.caretRect(i)
      val w = h.drawable.intrinsicWidth
      val x = r[0] * scale
      h.translationX = (if (h.start) x - w * 3.0 / 4.0 else x - w / 4.0).toFloat()
      h.translationY = ((r[1] + r[2]) * scale).toFloat()
      h.visibility = View.VISIBLE
    }
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (anchor < 0) return
    for (h in selection.highlight(anchor, focus)) canvas.drawRect((h[0] * scale).toFloat(), (h[1] * scale).toFloat(), (h[2] * scale).toFloat(), (h[3] * scale).toFloat(), paint)
  }

  private fun bounds(): Rect {
    val r = RectF()
    for (h in selection.highlight(anchor, focus)) r.union((h[0] * scale).toFloat(), (h[1] * scale).toFloat(), (h[2] * scale).toFloat(), (h[3] * scale).toFloat())
    return Rect(r.left.toInt(), r.top.toInt(), r.right.toInt(), r.bottom.toInt())
  }

  /** The floating copy menu: Copy and Select all, placed over the highlight. */
  private inner class Menu : ActionMode.Callback2() {
    override fun onCreateActionMode(mode: ActionMode, menu: android.view.Menu): Boolean {
      menu.add(0, android.R.id.copy, 0, android.R.string.copy)
      menu.add(0, android.R.id.selectAll, 1, android.R.string.selectAll)
      return true
    }
    override fun onPrepareActionMode(mode: ActionMode, menu: android.view.Menu): Boolean = false
    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
      when (item.itemId) {
        android.R.id.copy -> {
          val cm = context.getSystemService(ClipboardManager::class.java)
          cm?.setPrimaryClip(ClipData.newPlainText(null, selectedText()))
          clear()
        }
        android.R.id.selectAll -> select(0, selection.count - 1)
        else -> return false
      }
      return true
    }
    override fun onDestroyActionMode(mode: ActionMode) {
      if (this@DragonSelectionFrame.mode === mode) this@DragonSelectionFrame.mode = null
    }
    override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
      outRect.set(bounds())
    }
  }

  /** A selection handle: dragging it moves its end of the selection to the caret under the finger, with the magnifier over it. */
  private inner class Handle(val drawable: Drawable, val start: Boolean) : View(context) {
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) = setMeasuredDimension(drawable.intrinsicWidth, drawable.intrinsicHeight)
    override fun onDraw(canvas: Canvas) {
      drawable.setBounds(0, 0, width, height)
      drawable.draw(canvas)
    }
    override fun onTouchEvent(ev: MotionEvent): Boolean {
      val fx = ev.rawX - this@DragonSelectionFrame.locationX()
      val fy = ev.rawY - this@DragonSelectionFrame.locationY() - height
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
          val i = selection.indexAt(fx / scale, fy / scale)
          if (i >= 0) {
            val lo = minOf(anchor, focus)
            val hi = maxOf(anchor, focus)
            if (start) select(hi, minOf(i, hi - 1).coerceAtLeast(0)) else select(lo, maxOf(i, lo + 1).coerceAtMost(selection.count - 1))
          }
          magnifier.show(fx, fy)
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> magnifier.dismiss()
      }
      return true
    }
  }

  private fun locationX(): Float { val p = IntArray(2); getLocationOnScreen(p); return p[0].toFloat() }
  private fun locationY(): Float { val p = IntArray(2); getLocationOnScreen(p); return p[1].toFloat() }
}
`;
}

/** The selection runtime support source of a backend. */
export function selectSupport(backend: NativeBackend, header: (what: string) => string): GeneratedFile {
  return backend === 'uikit'
    ? { path: 'Support/DragonSelection.swift', text: header('the selection runtime') + swiftSupportText() }
    : { path: 'kotlin/dev/dragon/views/DragonSelection.kt', text: header('the selection runtime') + kotlinSupportText() };
}

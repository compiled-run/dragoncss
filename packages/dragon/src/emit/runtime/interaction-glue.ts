// The platform event glue of the interaction runtime (notes/T064-seld-r2-spec.md R1, R6, R15 and §3): a DragonInteractionMount,
// which rebuilds the Dragon views from a DragonInteractionMachine's live records after every committed change as a
// DragonStateMount does, inside a root view that observes the platform's pointer events without taking them and calls the
// machine's entry points in CSS px. A UIKit point is a CSS px (DragonTree sets every frame in px / scale points); an Android
// view px is a CSS px times the density, the scale the mount lays out at. A touch never sets hover (R1): only the hover
// recognizer on iOS and hover events from a mouse or stylus on Android call pointerMoved. Cursor is not here (seld-r2c).
import type { NativeBackend } from '../../lower/native-program.ts';
import type { GeneratedFile } from '../../types.ts';

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
export function interactionGlueSwift(): string {
  return String.raw`import UIKit
import UIKit.UIGestureRecognizerSubclass

/// Where a script's pointer steps go: the machine's entry points (DragonMachinePointer), or on Android real MotionEvents
/// dispatched on the mount's root.
public protocol DragonPointerInput: AnyObject {
  func pointerMoved(_ x: Double, _ y: Double)
  func pointerExited()
  func hoverExitStarted()
  func frame()
  func mousePressed(_ x: Double, _ y: Double)
  func mouseReleased()
  func touchPressed(_ x: Double, _ y: Double)
  func touchReleased(_ x: Double, _ y: Double)
  func touchCancelled()
}

/// The machine's own entry points as a pointer input.
public final class DragonMachinePointer: DragonPointerInput {
  private let m: DragonInteractionMachine
  public init(_ m: DragonInteractionMachine) { self.m = m }
  public func pointerMoved(_ x: Double, _ y: Double) { m.pointerMoved(x, y) }
  public func pointerExited() { m.pointerExited() }
  public func hoverExitStarted() { m.hoverExitStarted() }
  public func frame() { m.frame() }
  public func mousePressed(_ x: Double, _ y: Double) { m.mousePressed(x, y) }
  public func mouseReleased() { m.mouseReleased() }
  public func touchPressed(_ x: Double, _ y: Double) { m.touchPressed(x, y) }
  public func touchReleased(_ x: Double, _ y: Double) { m.touchReleased(x, y) }
  public func touchCancelled() { m.touchCancelled() }
}

/// Observes every touch over the root without taking it: a direct or Pencil touch is a touch press, an indirect pointer click
/// (UIApplicationSupportsIndirectInputEvents) a mouse press. It never recognises, so the views under it get their touches.
final class DragonPressRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
  private let machine: DragonInteractionMachine
  private var tracked: UITouch?
  private var mouse = false

  init(machine: DragonInteractionMachine) {
    self.machine = machine
    super.init(target: nil, action: nil)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
    delegate = self
  }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

  private func at(_ t: UITouch) -> (Double, Double) {
    let p = t.location(in: view)
    return (Double(p.x), Double(p.y))
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    guard tracked == nil else { return }
    for t in touches {
      let (x, y) = at(t)
      switch t.type {
      case .direct, .pencil:
        tracked = t; mouse = false
        machine.touchPressed(x, y)
        return
      case .indirectPointer:
        tracked = t; mouse = true
        machine.mousePressed(x, y)
        return
      default:
        continue
      }
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    // A pressed pointer still hovers (R6); a moving finger does not (R1).
    guard let t = tracked, mouse, touches.contains(t) else { return }
    let (x, y) = at(t)
    machine.pointerMoved(x, y)
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    if let t = tracked, touches.contains(t) {
      tracked = nil
      if mouse { machine.mouseReleased() } else {
        let (x, y) = at(t)
        machine.touchReleased(x, y)
      }
    }
    finish(event)
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    if let t = tracked, touches.contains(t) {
      tracked = nil
      machine.touchCancelled()
    }
    finish(event)
  }

  /// Fails once every touch of the event is over, so UIKit resets the recognizer for the next sequence.
  private func finish(_ event: UIEvent) {
    if (event.allTouches ?? []).allSatisfy({ $0.phase == .ended || $0.phase == .cancelled }) { state = .failed }
  }

  override func reset() {
    super.reset()
    tracked = nil
  }
}

/// The hover recognizer's target: an iPad pointer or Pencil hover moves the hover chain; leaving the view clears it. It never
/// fires on iPhone, so an iPhone never hovers.
final class DragonHoverTarget: NSObject, UIGestureRecognizerDelegate {
  private let machine: DragonInteractionMachine
  init(machine: DragonInteractionMachine) { self.machine = machine }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

  @objc func hover(_ g: UIHoverGestureRecognizer) {
    switch g.state {
    case .began, .changed:
      let p = g.location(in: g.view)
      machine.pointerMoved(Double(p.x), Double(p.y))
    case .ended, .cancelled:
      machine.pointerExited()
    default:
      break
    }
  }
}

/// The mount's root: holds the Dragon views at its origin and carries the press and hover recognizers, which see touches over
/// every subview, host-view slots included.
public final class DragonInteractionRootView: UIView {
  private let hoverTarget: DragonHoverTarget

  public init(machine: DragonInteractionMachine) {
    hoverTarget = DragonHoverTarget(machine: machine)
    super.init(frame: .zero)
    addGestureRecognizer(DragonPressRecognizer(machine: machine))
    let hover = UIHoverGestureRecognizer(target: hoverTarget, action: #selector(DragonHoverTarget.hover(_:)))
    hover.delegate = hoverTarget
    addGestureRecognizer(hover)
  }

  required init?(coder: NSCoder) { fatalError("dragon: DragonInteractionRootView is built in code") }
}

/// An interaction machine on screen: every committed change rebuilds the views from the live records, lays them out and swaps
/// them in for the previous ones, inside the root view whose recognizers drive the machine.
public final class DragonInteractionMount {
  public let machine: DragonInteractionMachine
  public let root: DragonInteractionRootView
  private var shown = DragonTree()
  public private(set) var renders = 0
  private let measurer: TextMeasurer
  private let scale: Double
  private let bridge: DragonBridge

  public init(machine: DragonInteractionMachine, stage: UIView, measurer: TextMeasurer, scale: Double, bridge: DragonBridge) {
    self.machine = machine; self.measurer = measurer; self.scale = scale; self.bridge = bridge
    root = DragonInteractionRootView(machine: machine)
    stage.addSubview(root)
    render()
    machine.onChange = { [weak self] in self?.render() }
  }

  /// The views on screen.
  public var tree: DragonTree { shown }

  /// Takes the root, and with it the views, off the stage.
  public func unmount() {
    machine.onChange = nil
    root.removeFromSuperview()
  }

  private func render() {
    let t = DragonTree()
    machine.build(t)
    root.addSubview(t.root)
    do {
      try t.apply(machine.input(scale), measurer: measurer, scale: scale, bridge: bridge)
    } catch {
      fatalError("dragon: the interaction mount could not lay out: \(error)")
    }
    root.frame = CGRect(origin: .zero, size: t.root.frame.size)
    shown.root.removeFromSuperview()
    shown = t
    renders += 1
  }
}
`;
}

// A function, not a constant: emit/native-support.ts reads it while this module may still be initialising (import cycle).
export function interactionGlueKotlin(): string {
  return String.raw`package dev.dragon.views

import android.content.Context
import android.view.InputDevice
import android.view.MotionEvent
import android.view.ViewGroup
import android.widget.FrameLayout
import dev.dragon.layout.TextMeasurer

/** Where a script's pointer steps go: the machine's entry points (DragonMachinePointer), or real MotionEvents dispatched on the mount's root. */
interface DragonPointerInput {
  fun pointerMoved(x: Double, y: Double)
  fun pointerExited()
  fun hoverExitStarted()
  fun frame()
  fun mousePressed(x: Double, y: Double)
  fun mouseReleased()
  fun touchPressed(x: Double, y: Double)
  fun touchReleased(x: Double, y: Double)
  fun touchCancelled()
}

/** The machine's own entry points as a pointer input. */
class DragonMachinePointer(private val m: DragonInteractionMachine) : DragonPointerInput {
  override fun pointerMoved(x: Double, y: Double) { m.pointerMoved(x, y) }
  override fun pointerExited() { m.pointerExited() }
  override fun hoverExitStarted() { m.hoverExitStarted() }
  override fun frame() { m.frame() }
  override fun mousePressed(x: Double, y: Double) { m.mousePressed(x, y) }
  override fun mouseReleased() { m.mouseReleased() }
  override fun touchPressed(x: Double, y: Double) { m.touchPressed(x, y) }
  override fun touchReleased(x: Double, y: Double) { m.touchReleased(x, y) }
  override fun touchCancelled() { m.touchCancelled() }
}

/**
 * The mount's root: holds the Dragon views and observes the touch and hover events over them without stealing them. A finger or
 * stylus contact is a touch press, a mouse button a mouse press; hover comes only from a mouse or stylus (R1). Android sends
 * HOVER_EXIT when a mouse button goes down, so the clear waits for the next frame and a mouse press before it cancels it (R15).
 */
class DragonInteractionRoot(context: Context, private val machine: DragonInteractionMachine, private val scale: Double) : FrameLayout(context) {
  private val exitFrame = Runnable { machine.frame() }

  private fun cssX(ev: MotionEvent): Double = ev.getX(0).toDouble() / scale
  private fun cssY(ev: MotionEvent): Double = ev.getY(0).toDouble() / scale

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean = false

  // Read here rather than in onInterceptTouchEvent: a ViewGroup skips interception for UP and CANCEL when no child took the DOWN.
  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    val tool = ev.getToolType(0)
    val mouse = tool == MotionEvent.TOOL_TYPE_MOUSE
    val touch = tool == MotionEvent.TOOL_TYPE_FINGER || tool == MotionEvent.TOOL_TYPE_STYLUS
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> if (mouse) machine.mousePressed(cssX(ev), cssY(ev)) else if (touch) machine.touchPressed(cssX(ev), cssY(ev))
      // A pressed mouse still hovers (R6); a moving finger does not (R1).
      MotionEvent.ACTION_MOVE -> if (mouse) machine.pointerMoved(cssX(ev), cssY(ev))
      MotionEvent.ACTION_UP -> if (mouse) machine.mouseReleased() else if (touch) machine.touchReleased(cssX(ev), cssY(ev))
      MotionEvent.ACTION_CANCEL -> if (mouse || touch) machine.touchCancelled()
    }
    // The root keeps the gesture it saw go down, so its UP or CANCEL reaches it even when no view under it took the DOWN.
    return super.dispatchTouchEvent(ev) || ev.actionMasked == MotionEvent.ACTION_DOWN
  }

  override fun onInterceptHoverEvent(ev: MotionEvent): Boolean {
    if (ev.isFromSource(InputDevice.SOURCE_MOUSE) || ev.isFromSource(InputDevice.SOURCE_STYLUS)) {
      when (ev.actionMasked) {
        MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE -> machine.pointerMoved(cssX(ev), cssY(ev))
        MotionEvent.ACTION_HOVER_EXIT -> {
          machine.hoverExitStarted()
          removeCallbacks(exitFrame)
          postOnAnimation(exitFrame)
        }
      }
    }
    return false
  }

  /** The next frame now: the pending exit frame, if any, is not run again (the MotionEvent runner's frame step). */
  fun frameNow() {
    removeCallbacks(exitFrame)
    machine.frame()
  }
}

/**
 * An interaction machine on screen: every committed change rebuilds the views from the live records, lays them out and swaps
 * them in for the previous ones, inside the root view whose event glue drives the machine.
 */
class DragonInteractionMount(val machine: DragonInteractionMachine, stage: ViewGroup, private val measurer: TextMeasurer, private val scale: Double, private val bridge: DragonBridge) {
  val root = DragonInteractionRoot(stage.context, machine, scale)
  private var shown: DragonTree? = null
  var renders = 0
    private set

  /** The views on screen. */
  val tree: DragonTree
    get() = shown ?: throw IllegalStateException("dragon: the interaction mount has not rendered")

  init {
    stage.addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    render()
    machine.onChange = { render() }
  }

  /** Takes the root, and with it the views, off the stage. */
  fun unmount() {
    machine.onChange = null
    (root.parent as? ViewGroup)?.removeView(root)
  }

  private fun render() {
    val t = DragonTree(root.context)
    machine.build(t)
    t.apply(machine.input(scale), measurer, scale, bridge)
    root.addView(t.root, FrameLayout.LayoutParams(t.root.dragonFrame[2], t.root.dragonFrame[3]))
    shown?.let { root.removeView(it.root) }
    shown = t
    renders++
  }
}
`;
}

/** The interaction glue support source of a backend (registered after the interaction runtime in emit/runtime/index.ts). */
export function interactionGlueSupport(backend: NativeBackend, header: (what: string) => string): GeneratedFile {
  return backend === 'uikit'
    ? { path: 'Support/DragonInteractionGlue.swift', text: header('the interaction mount and its UIKit event glue') + interactionGlueSwift() }
    : { path: 'kotlin/dev/dragon/views/DragonInteractionGlue.kt', text: header('the interaction mount and its Android event glue') + interactionGlueKotlin() };
}

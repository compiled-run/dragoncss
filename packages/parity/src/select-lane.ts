// T154 slice 2d: the device-select lane on the host. Every selection document (select-cases.ts SELECT_DOCS) is mounted on the
// devices as a case of its own, and the host app drives its live selection: a long press at each press point, then each selection
// handle dragged to each target. On Android these are real MotionEvents dispatched through the window to DragonSelectionFrame; on
// iOS, which runs no UI test runner to inject touches, the probe calls DragonSelection's UITextInput and UITextInteractionDelegate
// methods as UIKit's non-editable text interaction calls them (interactionShouldBegin, closestPosition, the word tokenizer,
// textRange, text(in:) and selectionRects). After every gesture the device writes one record line to <case>@<scale>.sel: the
// selected caret range, its text and its highlight rects. The expected lines come from the selection model (rt-select.ts), which
// select-model.test.ts proves against Chrome's double clicks and drags, run through the same steps the device's glue takes.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmitCase, GeneratedFile, NativeBackend } from 'dragon';
import { expectedDigest, expectedDump, programInput } from 'dragon';
import type { Caret, SelectTable } from '../../layout/src/rt-select.ts';
import { anchorAt, caretIndex, caretList, focusAt, highlightRects, selectedText, selectionTableOf, wordAround } from '../../layout/src/rt-select.ts';
import { ENVIRONMENT } from './fixtures.ts';
import { BACKEND_OF, expectedEngine, referenceMeasurer } from './native-host.ts';
import type { SelectDoc } from './select-cases.ts';
import { selectCase, selectCompile, SELECT_DOCS } from './select-cases.ts';
import type { NativeTarget } from './targets.ts';
import { deviceDprs } from './targets.ts';

export const SELECT_LANE_VERSION = 'dragon.select-lane/1';
const LU = 64;

/** A document's case id on the devices; no layout case holds a ~. */
export const selectCaseId = (d: SelectDoc): string => `select~${d.id}`;

/** Every device-select case id, in document order. */
export const selectCaseIds = (): string[] => SELECT_DOCS.map(selectCaseId);

/** The record file of a case at a device scale, beside the dumps. */
export const selectFile = (dir: string, id: string, scale: number): string => join(dir, `${id}@${scale}.sel`);

/**
 * One gesture, at a point in CSS LU: a long press (p), or the end (e) or start (s) handle of the press's selection dragged so that
 * its caret point lands on the target. Each drag starts from the press's selection, which the probe restores after it.
 */
export type SelectGesture = { readonly kind: 'p' | 'e' | 's'; readonly x: number; readonly y: number };

/**
 * A document's gestures, from its table at DPR 1: presses at two x on rows every 9px down to 15px past the root's bottom, each
 * followed by both handles dragged to sixteen targets (four x on the first row, the press's row, the middle and below the end).
 * Rows start at 1px and no x sits on an Ahem glyph's midpoint (select-cases.ts selectPoints), so no point is on a caret boundary.
 */
export function selectGestures(d: SelectDoc): SelectGesture[] {
  const t = selectCase(d).table;
  const bottom = (t.blocks[0]?.bottom ?? 0) / LU;
  const out: SelectGesture[] = [];
  for (let y = 1; y < bottom + 15; y += 9) {
    for (const x of [16, 46]) {
      out.push({ kind: 'p', x: x * LU, y: y * LU });
      const ys = [1, y, Math.floor(bottom / 2) + 1, Math.floor(bottom) + 10];
      for (const kind of ['e', 's'] as const) for (const ty of ys) for (const tx of [4, 26, 61, 140]) out.push({ kind, x: tx * LU, y: ty * LU });
    }
  }
  return out;
}

/** The device LU a gesture point lands on at a DPR: the probe aims at the middle of that LU, so float rounding cannot move it. */
export const deviceLu = (v: number, dpr: number): number => Math.floor(v * dpr);

/** Faults the reference can be planted with: indexShift moves every caret index a point picks, as the support plant does. */
export type SelectLaneFaults = { readonly indexShift: number };
export const NO_SELECT_LANE_FAULTS: SelectLaneFaults = { indexShift: 0 };

const hex = (s: string): string => [...s].map((c) => (c.codePointAt(0) as number).toString(16)).join('.');

/** A record line: the gesture and the selection after it, as caret indices lo hi, its text's code points and its highlight in LU. */
function recordLine(t: SelectTable, carets: readonly Caret[], g: SelectGesture, sel: readonly [number, number] | null): string {
  const head = `${g.kind} ${g.x} ${g.y}`;
  if (sel === null || sel[0] === sel[1]) return `${head} -`;
  const [lo, hi] = sel[0] < sel[1] ? sel : [sel[1], sel[0]];
  const a = carets[lo] as Caret;
  const b = carets[hi] as Caret;
  const text = hex(selectedText(t, a, b));
  const rects = highlightRects(t, a, b).map((h) => `${h.left},${h.top},${h.right},${h.bottom}`).join(';');
  return `${head} ${lo} ${hi} ${text === '' ? '_' : text} ${rects === '' ? '_' : rects}`;
}

/** A record line's shape: a gesture and either - or a range, code points and rects. */
export const SELECT_LINE = /^[pes] -?\d+ -?\d+ (-|\d+ \d+ (_|[0-9a-f]+(\.[0-9a-f]+)*) (_|-?\d+,-?\d+,-?\d+,-?\d+(;-?\d+,-?\d+,-?\d+,-?\d+)*))$/;

/**
 * The expected record of a document on a target at a DPR: its gestures run through the model as the target's glue runs them.
 * iOS: a press begins where anchorAt has a caret, then selects the word around closestPosition (focusAt's caret index), none
 * at an empty block's position, where Chrome selects the block's line break, which a caret range cannot hold; a handle
 * drag makes textRange(from: the other end, to: closestPosition(target)), clamped to the caret list, with nothing moved where no
 * position is found. Android: a press selects wordAt's word (an empty block's line break is one caret, so nothing); a handle drag moves its end to indexAt(target) (focusAt's caret
 * index) when it is one, kept at least one caret from the other end and inside the caret list; a selection of one caret clears.
 */
export function selectReference(d: SelectDoc, target: NativeTarget, dpr: number, faults: SelectLaneFaults = NO_SELECT_LANE_FAULTS): string[] {
  const c = selectCompile(d);
  const t = selectionTableOf(programInput(c.programs[BACKEND_OF[target]], ENVIRONMENT.viewport, dpr), referenceMeasurer(), c.facts);
  const carets = caretList(t);
  const n = carets.length;
  const clamp = (i: number): number => Math.max(0, Math.min(n - 1, i));
  const at = (g: SelectGesture): readonly [number, number] => [deviceLu(g.x, dpr), deviceLu(g.y, dpr)];
  // The caret index a point picks (iOS index(at:), Android indexAt), or null.
  const indexAt = (g: SelectGesture): number | null => pick(g)?.index ?? null;
  // With whether it is an empty block's position (iOS DragonTextPosition.emptyBlock), read as the next text's start.
  const pick = (g: SelectGesture): { readonly index: number; readonly emptyBlock: boolean } | null => {
    if (n === 0) return null;
    const f = focusAt(t, ...at(g));
    if (f === null) return null;
    const i = caretIndex(carets, f);
    const k = carets[i] as Caret;
    return { index: i + faults.indexShift, emptyBlock: k.node !== f.node || k.offset !== f.offset };
  };
  const word = (a: Caret): readonly [number, number] | null => {
    const w = wordAround(t, a);
    return w.length === 2 ? [caretIndex(carets, w[0] as Caret), caretIndex(carets, w[1] as Caret)] : null;
  };
  const out: string[] = [];
  let sel: readonly [number, number] | null = null;
  for (const g of selectGestures(d)) {
    if (g.kind === 'p') {
      sel = null;
      if (target === 'ios') {
        const p = n > 0 && anchorAt(t, ...at(g)) !== null ? pick(g) : null;
        if (p !== null && !p.emptyBlock) sel = word(carets[clamp(p.index)] as Caret);
      } else if (n > 0) {
        const a = anchorAt(t, ...at(g));
        const w = a === null ? null : word(a);
        if (w !== null && w[0] >= 0 && w[1] >= 0 && w[0] !== w[1]) sel = w;
      }
      out.push(recordLine(t, carets, g, sel));
      continue;
    }
    if (sel === null || sel[0] === sel[1]) {
      out.push(recordLine(t, carets, g, null));
      continue;
    }
    const lo = Math.min(sel[0], sel[1]);
    const hi = Math.max(sel[0], sel[1]);
    const i = indexAt(g);
    let after: readonly [number, number] | null = sel;
    if (target === 'ios') {
      if (i !== null) after = [g.kind === 'e' ? lo : hi, clamp(i)];
    } else if (i !== null && i >= 0) {
      const f = g.kind === 'e' ? Math.min(Math.max(i, lo + 1), n - 1) : Math.max(Math.min(i, hi - 1), 0);
      after = g.kind === 'e' ? [lo, f] : [hi, f];
      if (after[0] === after[1]) after = null;
    }
    out.push(recordLine(t, carets, g, after));
  }
  return out;
}

// ---------------------------------------------------------------- the host app sources

/** The emitter view of every select case for a target: its program, appended to the host's layout cases. */
export function selectEmits(target: NativeTarget): EmitCase[] {
  const backend: NativeBackend = BACKEND_OF[target];
  const m = expectedEngine();
  const viewport = ENVIRONMENT.viewport;
  return SELECT_DOCS.map((d) => {
    const c = selectCompile(d);
    const id = selectCaseId(d);
    return {
      id,
      fixture: `select-${d.id}`,
      direction: 'ltr',
      compilerDigest: c.compiled.digest,
      viewport,
      program: c.programs[backend],
      expectedDigests: deviceDprs(target).map((dpr) => ({ dpr, sha256: expectedDigest(expectedDump(c.programs[backend], id, viewport, dpr, m)) })),
    };
  });
}

const swiftString = (s: string): string => JSON.stringify(s);
const kotlinString = (s: string): string => JSON.stringify(s).replace(/\$/g, '\\$');

/** The gestures of a document as the probe reads them: one "kind x y" line each. */
const gestureText = (d: SelectDoc): string => selectGestures(d).map((g) => `${g.kind} ${g.x} ${g.y}\n`).join('');

/** The device side of device-select for a host app: each select case's facts and gestures, and the probe that drives them. */
export function deviceSelectSource(target: NativeTarget): GeneratedFile {
  for (const d of SELECT_DOCS) {
    const f = selectCompile(d).facts;
    for (const s of [f.body, ...f.paragraphs, ...f.unselectable, ...f.hidden]) if (/[\t\n\\"$]/.test(s)) throw new Error(`${d.id}: id ${JSON.stringify(s)} holds a character the probe table cannot carry`);
  }
  if (target === 'ios') {
    const list = (xs: readonly string[]): string => `[${xs.map(swiftString).join(', ')}]`;
    const rows = SELECT_DOCS.map((d) => {
      const f = selectCompile(d).facts;
      return `  ${swiftString(selectCaseId(d))}: DragonSelectProbeCase(facts: DragonSelectFacts(body: ${swiftString(f.body)}, paragraphs: ${list(f.paragraphs)}, unselectable: ${list(f.unselectable)}, hidden: ${list(f.hidden)}), gestures: ${swiftString(gestureText(d))}),`;
    });
    return { path: 'Host/DragonSelectProbe.swift', text: `// GENERATED by @dragon/parity select-lane.ts (${SELECT_LANE_VERSION}). Do not edit.\n${IOS_PROBE.replace('<ROWS>', rows.join('\n'))}` };
  }
  const list = (xs: readonly string[]): string => `listOf(${xs.map(kotlinString).join(', ')})`;
  const rows = SELECT_DOCS.map((d) => {
    const f = selectCompile(d).facts;
    return `    ${kotlinString(selectCaseId(d))} to DragonSelectProbeCase(DragonSelectFacts(${kotlinString(f.body)}, ${list(f.paragraphs)}, ${list(f.unselectable)}, ${list(f.hidden)}), ${kotlinString(gestureText(d))}),`;
  });
  return { path: 'kotlin/dev/dragon/host/DragonSelectProbe.kt', text: `// GENERATED by @dragon/parity select-lane.ts (${SELECT_LANE_VERSION}). Do not edit.\n${ANDROID_PROBE.replace('<ROWS>', rows.join('\n'))}` };
}

const IOS_PROBE = String.raw`import UIKit

/// A select case's selection facts and its gestures, one "kind x y" line each in CSS LU (select-lane.ts selectGestures).
struct DragonSelectProbeCase {
  let facts: DragonSelectFacts
  let gestures: String
}

/// Every select case, by case id.
let dragonSelectProbeTable: [String: DragonSelectProbeCase] = [
<ROWS>
]

/// The code points of a text as hex, joined by dots; _ when empty.
private func dragonCodePoints(_ s: String) -> String {
  let cps = s.unicodeScalars.map { String($0.value, radix: 16) }
  return cps.isEmpty ? "_" : cps.joined(separator: ".")
}

/**
 * T154 slice 2d: the selection of a mounted select case driven through DragonSelection as UIKit's non-editable text interaction
 * drives it: a press asks interactionShouldBegin, then selects the tokenizer's word around closestPosition; a handle drag sets
 * textRange(from: the other end, to: closestPosition(target)). Each gesture's point is the middle of the device LU it lands on.
 * One record line per gesture: the selection's caret range, its text(in:) and its selectionRects in device LU.
 */
func dragonSelectProbe(_ c: DragonCase, _ p: DragonSelectProbeCase, root: UIView, scale: Double, measurer: TextMeasurer) -> String {
  let s = DragonSelection(input: c.input(scale), measurer: measurer, facts: p.facts, scale: scale)
  s.attach(to: root)
  defer { s.detach() }
  let zoom = scale * 64
  func point(_ x: Int, _ y: Int) -> CGPoint {
    return CGPoint(x: ((Double(x) * scale).rounded(.down) + 0.5) / zoom, y: ((Double(y) * scale).rounded(.down) + 0.5) / zoom)
  }
  func lu(_ v: CGFloat) -> String { return String(Int((Double(v) * zoom).rounded())) }
  func record(_ head: String) -> String {
    guard let r = s.selectedTextRange as? DragonTextRange, !r.isEmpty else { return head + " -\n" }
    let rects = s.selectionRects(for: r).map { q in [lu(q.rect.minX), lu(q.rect.minY), lu(q.rect.maxX), lu(q.rect.maxY)].joined(separator: ",") }
    return head + " \(r.from) \(r.to) " + dragonCodePoints(s.text(in: r) ?? "") + " " + (rects.isEmpty ? "_" : rects.joined(separator: ";")) + "\n"
  }
  var word: DragonTextRange?
  var out = ""
  for line in p.gestures.split(separator: "\n") {
    let f = line.split(separator: " ")
    guard f.count == 3, let x = Int(f[1]), let y = Int(f[2]), ["p", "e", "s"].contains(f[0]) else { fatalError("dragon host: bad select gesture \(line)") }
    let at = point(x, y)
    if f[0] == "p" {
      s.selectedTextRange = nil
      if s.interactionShouldBegin(s.interaction, at: at), let pos = s.closestPosition(to: at), let w = s.word(around: pos) { s.selectedTextRange = w }
      word = s.selectedTextRange as? DragonTextRange
      out += record(String(line))
      continue
    }
    guard let w = word, !w.isEmpty else {
      out += String(line) + " -\n"
      continue
    }
    if let pos = s.closestPosition(to: at) { s.selectedTextRange = s.textRange(from: f[0] == "e" ? w.start : w.end, to: pos) }
    out += record(String(line))
    s.selectedTextRange = w
  }
  return out
}
`;

const ANDROID_PROBE = String.raw`package dev.dragon.host

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.FrameLayout
import dev.dragon.layout.LayoutInput
import dev.dragon.layout.TextMeasurer
import dev.dragon.views.DragonSelectFacts
import dev.dragon.views.DragonSelection
import dev.dragon.views.DragonSelectionFrame

/** A select case's selection facts and its gestures, one "kind x y" line each in CSS LU (select-lane.ts selectGestures). */
class DragonSelectProbeCase(val facts: DragonSelectFacts, val gestures: String)

/** Every select case, by case id. */
val dragonSelectProbeTable: Map<String, DragonSelectProbeCase> by lazy {
  mapOf(
<ROWS>
  )
}

/**
 * T154 slice 2d: the selection of a mounted select case driven by real touches. The case's root moves into a DragonSelectionFrame
 * on the stage; each gesture is MotionEvents dispatched through the window: a long press held past the long-press timeout, or a
 * press on a selection handle moved so that the handle's caret point lands on the target (the middle of the device LU the target
 * lands on), then released. One record line per gesture: the frame's caret range, its selected text and its highlight in device LU.
 * done receives the record once every gesture has run and the root is back on the stage.
 */
class DragonSelectProbe(private val activity: Activity, private val stage: FrameLayout, private val root: View, input: LayoutInput, measurer: TextMeasurer, private val probe: DragonSelectProbeCase, private val scale: Double, private val done: (String) -> Unit) {
  private val selection = DragonSelection(input, measurer, probe.facts, scale)
  private val frame = DragonSelectionFrame(activity, selection, scale)
  private val main = Handler(Looper.getMainLooper())
  private val gestures = probe.gestures.split("\n").filter { it.isNotEmpty() }
  private val out = StringBuilder()
  private var word: IntArray? = null
  private var downTime = 0L

  fun start() {
    val lp = root.layoutParams
    stage.removeView(root)
    frame.addView(root, 0, lp)
    stage.addView(frame, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    settle(0)
  }

  private fun settle(frames: Int) {
    Choreographer.getInstance().postFrameCallback {
      if (frame.isLaidOut && root.isLaidOut && !frame.isLayoutRequested) run(0)
      else if (frames > 6000) throw IllegalStateException("dragon host: the selection frame was not laid out after " + frames + " frames")
      else settle(frames + 1)
    }
  }

  private fun finish() {
    frame.clear()
    frame.removeView(root)
    stage.removeView(frame)
    stage.addView(root, FrameLayout.LayoutParams(root.layoutParams.width, root.layoutParams.height))
    done(out.toString())
  }

  /** The frame's origin in window px; the window must sit at the screen's origin, since the handles read raw coordinates. */
  private fun origin(): IntArray {
    val w = IntArray(2)
    val s = IntArray(2)
    frame.getLocationInWindow(w)
    frame.getLocationOnScreen(s)
    if (w[0] != s[0] || w[1] != s[1]) throw IllegalStateException("dragon host: the window is not at the screen's origin")
    return w
  }

  /** A gesture coordinate in CSS LU as frame px: the middle of the device LU it lands on. */
  private fun px(v: Int): Double = (Math.floor(v * scale) + 0.5) / 64.0

  private fun send(action: Int, x: Double, y: Double) {
    val now = SystemClock.uptimeMillis()
    if (action == MotionEvent.ACTION_DOWN) downTime = now
    val props = MotionEvent.PointerProperties()
    props.id = 0
    props.toolType = MotionEvent.TOOL_TYPE_FINGER
    val coords = MotionEvent.PointerCoords()
    coords.x = x.toFloat()
    coords.y = y.toFloat()
    coords.pressure = 1f
    coords.size = 1f
    val ev = MotionEvent.obtain(downTime, now, action, 1, arrayOf(props), arrayOf(coords), 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
    try {
      activity.window.decorView.dispatchTouchEvent(ev)
    } finally {
      ev.recycle()
    }
  }

  private fun codePoints(s: String): String = if (s.isEmpty()) "_" else s.codePoints().toArray().joinToString(".") { Integer.toHexString(it) }

  private fun lu(v: Double): String = Math.round(v * scale * 64.0).toString()

  private fun record(head: String) {
    if (frame.anchor < 0 || frame.anchor == frame.focus) {
      out.append(head).append(" -\n")
      return
    }
    val lo = minOf(frame.anchor, frame.focus)
    val hi = maxOf(frame.anchor, frame.focus)
    val rects = selection.highlight(lo, hi).joinToString(";") { h -> lu(h[0]) + "," + lu(h[1]) + "," + lu(h[2]) + "," + lu(h[3]) }
    out.append(head).append(' ').append(lo).append(' ').append(hi).append(' ').append(codePoints(frame.selectedText())).append(' ').append(if (rects.isEmpty()) "_" else rects).append('\n')
  }

  private fun run(k: Int) {
    var i = k
    while (i < gestures.size) {
      val line = gestures[i]
      val f = line.split(" ")
      if (f.size != 3 || f[0] !in listOf("p", "e", "s")) throw IllegalStateException("dragon host: bad select gesture " + line)
      val o = origin()
      val x = o[0] + px(f[1].toInt())
      val y = o[1] + px(f[2].toInt())
      if (f[0] == "p") {
        frame.clear()
        send(MotionEvent.ACTION_DOWN, x, y)
        val next = i + 1
        main.postDelayed({
          send(MotionEvent.ACTION_UP, x, y)
          word = if (frame.anchor >= 0 && frame.anchor != frame.focus) intArrayOf(frame.anchor, frame.focus) else null
          record(line)
          run(next)
        }, (ViewConfiguration.getLongPressTimeout() + ViewConfiguration.getTapTimeout() + 150).toLong())
        return
      }
      val w = word
      if (w == null) {
        out.append(line).append(" -\n")
        i++
        continue
      }
      val start = f[0] == "s"
      val handle = frame.handle(start)
      val at = IntArray(2)
      handle.getLocationInWindow(at)
      // The press lands on the handle's middle, kept inside the frame; the move carries the handle's caret point to the target.
      val dx = maxOf(at[0] + handle.width / 2, o[0] + 1).toDouble()
      val dy = (at[1] + handle.height / 2).toDouble()
      val caret = selection.caretRect(if (start) minOf(w[0], w[1]) else maxOf(w[0], w[1]))
      val hx = o[0] + caret[0] * scale
      val hy = o[1] + (caret[1] + caret[2] / 2.0) * scale
      send(MotionEvent.ACTION_DOWN, dx, dy)
      send(MotionEvent.ACTION_MOVE, dx + (x - hx), dy + (y - hy))
      send(MotionEvent.ACTION_UP, dx + (x - hx), dy + (y - hy))
      record(line)
      frame.select(w[0], w[1])
      i++
    }
    finish()
  }
}
`;

// ---------------------------------------------------------------- evaluation

/** Why a record file differs from the expected lines, or null when it equals them. */
export function compareSelect(file: string, want: readonly string[]): string | null {
  if (!existsSync(file)) return 'the device wrote no select record';
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return `the select record is unreadable: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (text !== '' && !text.endsWith('\n')) return 'the select record does not end with a newline (cut short?)';
  const got = text === '' ? [] : text.slice(0, -1).split('\n');
  const bad = got.findIndex((l) => !SELECT_LINE.test(l));
  if (bad >= 0) return `line ${bad + 1} is malformed: ${JSON.stringify(got[bad])}`;
  const differing = want.map((w, i) => (got[i] === w ? -1 : i)).filter((i) => i >= 0);
  if (got.length !== want.length || differing.length > 0) {
    const i = differing[0] ?? Math.min(got.length, want.length);
    return `${got.length} lines for ${want.length}; ${differing.length} differ; first at gesture ${i + 1}: device ${JSON.stringify(got[i] ?? '(none)')}, model ${JSON.stringify(want[i] ?? '(none)')}`;
  }
  return null;
}

/** device-select at one scale: every select case's record in dir against the model's lines for the target. */
export function evaluateSelect(dir: string, target: NativeTarget, scale: number): { passed: number; failed: number; details: string[]; missing: string[] } {
  let passed = 0;
  let failed = 0;
  const details: string[] = [];
  const missing: string[] = [];
  for (const d of SELECT_DOCS) {
    const id = selectCaseId(d);
    const file = selectFile(dir, id, scale);
    const problem = compareSelect(file, selectReference(d, target, scale));
    if (problem === null) passed++;
    else {
      failed++;
      if (!existsSync(file)) missing.push(id);
      details.push(`${id}@${scale}: ${problem}`);
    }
  }
  return { passed, failed, details, missing };
}

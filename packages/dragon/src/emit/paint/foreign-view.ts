// REPL-a Phase B (R9): an iframe's slot holds the platform's own web view over its content box: a WKWebView on UIKit, an
// android.webkit.WebView (in a Dragon host group, so it takes a Dragon frame) on Android, configured for inline media that plays
// without a gesture. The after-layout hook sets its frame from the content box DragonTree.apply computes. Lane and test builds
// never load network content: the web view loads about:blank whatever the src. The readback is the class, the flags and the frame.
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// REPL-a foreign view: the platform web view over the content box, and the iframe src it stands for.
  public var dragonForeignView: UIView? = nil
  public var dragonForeignSrc: String? = nil
`;

const SWIFT = String.raw`import UIKit
import WebKit

/// Whether a slot's web view loads its iframe src (R9). The parity lane and test hosts set it false at launch: they never load
/// network content, so their web views load about:blank.
public var dragonForeignViewLoadsSrc = true

/// The slot's web view: inline media without a user gesture; it loads the iframe src, or about:blank in a lane or test host.
public func dragonSetForeignView(_ v: DragonBoxView, src: String?) {
  let config = WKWebViewConfiguration()
  config.allowsInlineMediaPlayback = true
  config.mediaTypesRequiringUserActionForPlayback = []
  let web = WKWebView(frame: .zero, configuration: config)
  v.addSubview(web)
  v.dragonForeignView = web
  v.dragonForeignSrc = src
  // The compiler accepts only an absolute https src (analysis/elements/replaced.ts iframeSrcRefusal).
  let target = dragonForeignViewLoadsSrc ? src : nil
  guard let url = URL(string: target ?? "about:blank") else { fatalError("dragon: \(v.dragonId): iframe src \(target ?? "about:blank") is not a URL") }
  web.load(URLRequest(url: url))
}

/// After every layout: the web view over the content box, in points relative to the box.
public func dragonAfterLayoutForeignView(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let web = v.dragonForeignView, let c = v.dragonReplacedContent else { return }
  let s = CGFloat(scale)
  web.frame = CGRect(x: CGFloat(c[0]) / s, y: CGFloat(c[1]) / s, width: CGFloat(c[2]) / s, height: CGFloat(c[3]) / s)
}

/// The readback of the foreign-view module: the web view's class, its media flags and its frame in whole device px / scale.
public func dragonAppliedForeignView(_ v: DragonBoxView) -> DumpJsonObject {
  guard let web = v.dragonForeignView as? WKWebView else { return [] }
  let s = v.dragonScale
  let f = web.frame
  let frame: [DumpJson] = [f.minX, f.minY, f.width, f.height].map { .number(dragonWholeDevicePx(Double($0) * s, "\(v.dragonId) web view") / s) }
  let config = web.configuration
  return [("dragonForeignView", .object([
    ("class", .string(NSStringFromClass(type(of: web)))),
    ("allowsInlineMediaPlayback", .bool(config.allowsInlineMediaPlayback)),
    ("mediaTypesRequiringUserActionForPlayback", .number(Double(config.mediaTypesRequiringUserActionForPlayback.rawValue))),
    ("frame", .array(frame)),
  ]))]
}
`;

const KOTLIN_MEMBERS = String.raw`  /** REPL-a foreign view: the host group of the platform web view over the content box, and the iframe src it stands for. */
  var dragonForeignView: DragonForeignHost? = null
  var dragonForeignSrc: String? = null
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.content.Context
import android.webkit.WebView
import dev.dragon.dump.DumpJson

/**
 * A Dragon group that holds one platform view, sizes it to its own frame and clips it there, as an iframe's content never paints
 * outside its content box. Unclipped, a WebView without a content frame clears the whole window behind it.
 */
class DragonForeignHost(ctx: Context) : DragonGroup(ctx) {
  init {
    clipChildren = true
  }
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val w = dragonFrame[2] - dragonFrame[0]
    val h = dragonFrame[3] - dragonFrame[1]
    for (i in 0 until childCount) getChildAt(i).measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    setMeasuredDimension(w, h)
  }
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    for (i in 0 until childCount) getChildAt(i).layout(0, 0, r - l, b - t)
  }
}

/**
 * Whether a slot's web view loads its iframe src (R9). The parity lane and test hosts set it false at launch: they never load
 * network content, so their web views load about:blank.
 */
var dragonForeignViewLoadsSrc = true

/** The slot's web view: JavaScript on and media without a user gesture; it loads the iframe src, or about:blank in a lane or test host. */
fun dragonSetForeignView(v: DragonBoxView, src: String?) {
  val host = DragonForeignHost(v.context)
  val web = WebView(v.context)
  web.settings.javaScriptEnabled = true
  web.settings.mediaPlaybackRequiresUserGesture = false
  host.addView(web)
  v.addView(host)
  v.dragonForeignView = host
  v.dragonForeignSrc = src
  // The compiler accepts only an absolute https src (analysis/elements/replaced.ts iframeSrcRefusal).
  web.loadUrl(if (dragonForeignViewLoadsSrc && src != null) src else "about:blank")
}

/** After every layout: the host group over the content box, in device px relative to the box. */
fun dragonAfterLayoutForeignView(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val host = v.dragonForeignView ?: return
  val c = v.dragonReplacedContent ?: return
  dragonSetFrame(host.dragonFrame, c[0], c[1], c[0] + c[2], c[1] + c[3], v.dragonId + " web view")
  host.requestLayout()
}

/** The readback of the foreign-view module: the web view's class, its settings and its host frame in device px. */
fun dragonAppliedForeignView(v: DragonBoxView): List<Pair<String, DumpJson>> {
  val host = v.dragonForeignView ?: return emptyList()
  val web = host.getChildAt(0) as? WebView ?: return emptyList()
  return listOf(Pair("dragonForeignView", DumpJson.Obj(listOf(
    Pair("class", DumpJson.Str(web.javaClass.name)),
    Pair("javaScriptEnabled", DumpJson.Bool(web.settings.javaScriptEnabled)),
    Pair("mediaPlaybackRequiresUserGesture", DumpJson.Bool(web.settings.mediaPlaybackRequiresUserGesture)),
    Pair("frame", DumpJson.Arr(host.dragonFrame.map { DumpJson.Num(it.toDouble()) })),
  ))))
}
`;

/**
 * An iframe src as a Swift or Kotlin string literal, or nil/null. The src is author input, so everything outside printable ASCII,
 * a quote, a backslash and (in Kotlin) a $ are escaped, as native-support.ts stringLit does (paint modules never import it;
 * paint-seams.test.ts checks the two agree).
 */
export const srcLit = (src: string | null, backend: 'uikit' | 'android-views'): string => {
  if (src === null) return backend === 'uikit' ? 'nil' : 'null';
  let out = '"';
  for (const ch of src) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (backend === 'android-views' && ch === '$') out += '\\$';
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (backend === 'uikit') out += `\\u{${cp.toString(16)}}`;
    else if (cp < 0x10000) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += `\\u${ch.charCodeAt(0).toString(16)}\\u${ch.charCodeAt(1).toString(16)}`;
  }
  return `${out}"`;
};

export const FOREIGN_VIEW_EMITTER: PaintEmitter<'foreign-view'> = {
  name: 'foreign-view',
  kinds: ['foreign-view'],
  lines: {
    uikit: (v, _n, w) => [`  dragonSetForeignView(${v}, src: ${srcLit(w.src, 'uikit')})`],
    'android-views': (v, _n, w) => [`  dragonSetForeignView(${v}, ${srcLit(w.src, 'android-views')})`],
  },
  applied: (_e, backend, _w, dpr, g) => {
    if (g.replaced === null) throw new Error('a foreign view on a box that is not replaced');
    const [x, y, width, height] = g.replaced.content as [number, number, number, number];
    return backend === 'uikit'
      ? { class: 'WKWebView', allowsInlineMediaPlayback: true, mediaTypesRequiringUserActionForPlayback: 0, frame: [x / dpr, y / dpr, width / dpr, height / dpr] }
      : { class: 'android.webkit.WebView', javaScriptEnabled: true, mediaPlaybackRequiresUserGesture: false, frame: [x, y, x + width, y + height] };
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutForeignView', applied: 'dragonAppliedForeignView' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutForeignView', applied: 'dragonAppliedForeignView' },
  },
  plants: [],
};

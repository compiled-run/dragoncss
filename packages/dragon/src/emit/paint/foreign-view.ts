// REPL-a Phase B (R9): an iframe's slot holds the platform's own web view over its content box: a WKWebView on UIKit, an
// android.webkit.WebView (in a Dragon host group, so it takes a Dragon frame) on Android, configured for inline media that plays
// without a gesture. The after-layout hook sets its frame from the content box DragonTree.apply computes. Lane and test builds
// never load network content: the web view loads about:blank whatever the src. The readback is the class, the flags and the frame.
// MEDIA-EL: a video's slot holds a clipping view over the content box (Chrome clips a video to it) and, inside it, the player's
// view at the engine's destination rect, which is pixel-snapped as Chrome's VideoPainter snaps it: an AVPlayerLayer-backed view
// (videoGravity resize, as the rect already has the stream's ratio) on UIKit, a TextureView a MediaPlayer renders into on
// Android. AVPlayer reads the stream from a temporary file the player view removes with itself; the MediaPlayer reads it from
// memory. dragonVideoFramesPending names the players whose first frame has not shown yet, which the lane hosts wait for before a
// capture (MEDIA-EL slice 2). The readback is the classes, the gravity and both frames.
import type { PaintEmitter } from './types.ts';
import { NO_NATIVE_PAINT } from './types.ts';

const SWIFT_MEMBERS = String.raw`  /// REPL-a foreign view: the platform web view over the content box, and the iframe src it stands for.
  public var dragonForeignView: UIView? = nil
  public var dragonForeignSrc: String? = nil
  /// MEDIA-EL video: the clipping view over the content box, and the player's view inside it at the destination rect.
  public var dragonVideoClip: UIView? = nil
  public var dragonVideoView: DragonVideoPlayerView? = nil
`;

const SWIFT = String.raw`import AVFoundation
import UIKit
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

/// MEDIA-EL: a view whose layer is an AVPlayerLayer, and the temporary file its player reads the stream from, removed with the view.
public final class DragonVideoPlayerView: UIView {
  public override class var layerClass: AnyClass { AVPlayerLayer.self }
  public var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
  var dragonStreamFile: URL? = nil
  deinit {
    if let f = dragonStreamFile { try? FileManager.default.removeItem(at: f) }
  }
}

/// Whether a player leaves its stream unopened: false except in the video-unloaded raster plant build, which proves the pixel
/// lane sees the first frame.
public let dragonVideoPlantUnloaded = false

/// The slot's player: a clipping view holding an AVPlayerLayer view that stretches the stream over its frame; it opens the MP4
/// bytes from a temporary file and shows the first frame once the item is ready, as Chrome shows a video it does not play.
public func dragonSetVideoView(_ v: DragonBoxView, _ base64: String) {
  let clip = UIView(frame: .zero)
  clip.clipsToBounds = true
  clip.isUserInteractionEnabled = false
  let video = DragonVideoPlayerView(frame: .zero)
  video.playerLayer.videoGravity = .resize
  clip.addSubview(video)
  v.addSubview(clip)
  v.dragonVideoClip = clip
  v.dragonVideoView = video
  if dragonVideoPlantUnloaded { return }
  guard let data = Data(base64Encoded: base64) else { fatalError("dragon: \(v.dragonId): the video stream is not base64") }
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("dragon-video-\(UUID().uuidString).mp4")
  // A stream that cannot be written leaves the player empty, as Chrome leaves a video whose stream fails to load.
  guard (try? data.write(to: url)) != nil else { return }
  video.dragonStreamFile = url
  video.playerLayer.player = AVPlayer(url: url)
}

/// Whether every video player in a view tree shows its stream's first frame (AVPlayerLayer.isReadyForDisplay), the ids of those that
/// do not yet otherwise; a player without a stream shows nothing and waits for nothing.
public func dragonVideoFramesPending(_ root: UIView) -> [String] {
  var out: [String] = []
  func walk(_ view: UIView) {
    if let box = view as? DragonBoxView, let video = box.dragonVideoView, video.playerLayer.player != nil, !video.playerLayer.isReadyForDisplay { out.append(box.dragonId) }
    for s in view.subviews { walk(s) }
  }
  walk(root)
  return out
}

/// After every layout: the web view over the content box, and a video's clip over it with the player at the destination rect,
/// in points relative to the box and to the clip.
public func dragonAfterLayoutForeignView(_ v: DragonBoxView, _ shape: DragonBoxShape, _ scale: Double) {
  guard let c = v.dragonReplacedContent else { return }
  let s = CGFloat(scale)
  let content = CGRect(x: CGFloat(c[0]) / s, y: CGFloat(c[1]) / s, width: CGFloat(c[2]) / s, height: CGFloat(c[3]) / s)
  v.dragonForeignView?.frame = content
  guard let clip = v.dragonVideoClip, let video = v.dragonVideoView, let d = v.dragonReplacedDest else { return }
  clip.frame = content
  video.frame = CGRect(x: CGFloat(d[0] - c[0]) / s, y: CGFloat(d[1] - c[1]) / s, width: CGFloat(d[2]) / s, height: CGFloat(d[3]) / s)
}

/// The readback of the foreign-view module: the web view's class, its media flags and its frame, and a video's player class,
/// gravity, clip frame and player frame, in whole device px / scale.
public func dragonAppliedForeignView(_ v: DragonBoxView) -> DumpJsonObject {
  let s = v.dragonScale
  let points = { (f: CGRect, what: String) -> DumpJson in .array([f.minX, f.minY, f.width, f.height].map { .number(dragonWholeDevicePx(Double($0) * s, "\(v.dragonId) \(what)") / s) }) }
  if let clip = v.dragonVideoClip, let video = v.dragonVideoView {
    return [("dragonVideoView", .object([
      ("class", .string(NSStringFromClass(type(of: video.layer)))),
      ("videoGravity", .string(video.playerLayer.videoGravity.rawValue)),
      ("clip", points(clip.frame, "video clip")),
      ("frame", points(video.frame, "video player")),
    ]))]
  }
  guard let web = v.dragonForeignView as? WKWebView else { return [] }
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
  /** MEDIA-EL video: the clipping group over the content box, holding the player's TextureView at the destination rect. */
  var dragonVideoView: DragonVideoHost? = null
`;

const KOTLIN = String.raw`package dev.dragon.views

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaDataSource
import android.media.MediaPlayer
import android.util.Base64
import android.view.Surface
import android.view.TextureView
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

/**
 * After every layout: the web view's host group over the content box, and a video's clipping group over it with the player at
 * the destination rect, in device px relative to the box and to the group.
 */
fun dragonAfterLayoutForeignView(v: DragonBoxView, shape: DragonBoxShape, scale: Double) {
  val c = v.dragonReplacedContent ?: return
  v.dragonForeignView?.let { host ->
    dragonSetFrame(host.dragonFrame, c[0], c[1], c[0] + c[2], c[1] + c[3], v.dragonId + " web view")
    host.requestLayout()
  }
  val video = v.dragonVideoView ?: return
  val d = v.dragonReplacedDest ?: return
  dragonSetFrame(video.dragonFrame, c[0], c[1], c[0] + c[2], c[1] + c[3], v.dragonId + " video clip")
  dragonSetFrame(video.dragonPlayerFrame, d[0] - c[0], d[1] - c[1], d[0] - c[0] + d[2], d[1] - c[1] + d[3], v.dragonId + " video player")
  video.requestLayout()
}

/**
 * MEDIA-EL: a Dragon group over a video's content box that clips its one child, the player's TextureView, laid out at the
 * destination rect (device px relative to the group), which a TextureView fills with the stream stretched over it.
 */
class DragonVideoHost(ctx: Context) : DragonGroup(ctx) {
  /** The player's rect: left, top, right, bottom in device px relative to this group. */
  val dragonPlayerFrame = IntArray(4)
  var dragonPlayer: MediaPlayer? = null
  var dragonSurface: Surface? = null
  /** Whether the player opens a stream, and whether a frame of it has reached the texture. */
  var dragonStreamed = false
  var dragonFrameShown = false
  init {
    clipChildren = true
  }
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val w = dragonPlayerFrame[2] - dragonPlayerFrame[0]
    val h = dragonPlayerFrame[3] - dragonPlayerFrame[1]
    for (i in 0 until childCount) getChildAt(i).measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
    setMeasuredDimension(dragonFrame[2] - dragonFrame[0], dragonFrame[3] - dragonFrame[1])
  }
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    for (i in 0 until childCount) getChildAt(i).layout(dragonPlayerFrame[0], dragonPlayerFrame[1], dragonPlayerFrame[2], dragonPlayerFrame[3])
  }
}

/**
 * Whether a player leaves its stream unopened: false except in the video-unloaded raster plant build, which proves the pixel lane
 * sees the first frame.
 */
const val DRAGON_VIDEO_PLANT_UNLOADED = false

/** The MP4 bytes as a MediaPlayer data source, read from memory: no file outlives the player. */
class DragonVideoStream(private val bytes: ByteArray) : MediaDataSource() {
  override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
    if (position >= bytes.size) return -1
    val n = minOf(size.toLong(), bytes.size - position).toInt()
    System.arraycopy(bytes, position.toInt(), buffer, offset, n)
    return n
  }
  override fun getSize(): Long = bytes.size.toLong()
  override fun close() {}
}

/**
 * The slot's player: a clipping group holding a TextureView; once its surface exists a MediaPlayer opens the MP4 bytes from memory
 * and, prepared, seeks to the start so the first frame shows, as Chrome shows a video it does not play. The surface and the player
 * are released with the texture's surface; a new surface opens them again.
 */
fun dragonSetVideoView(v: DragonBoxView, base64: String) {
  val host = DragonVideoHost(v.context)
  val texture = TextureView(v.context)
  host.addView(texture)
  v.addView(host)
  v.dragonVideoView = host
  if (DRAGON_VIDEO_PLANT_UNLOADED) return
  val bytes = Base64.decode(base64, Base64.DEFAULT)
  host.dragonStreamed = true
  texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
    override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
      val surface = Surface(st)
      val player = MediaPlayer()
      player.setDataSource(DragonVideoStream(bytes))
      player.setSurface(surface)
      player.setOnPreparedListener { it.seekTo(0) }
      player.prepareAsync()
      host.dragonPlayer = player
      host.dragonSurface = surface
    }
    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {}
    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
      host.dragonPlayer?.release()
      host.dragonPlayer = null
      host.dragonSurface?.release()
      host.dragonSurface = null
      host.dragonFrameShown = false
      return true
    }
    override fun onSurfaceTextureUpdated(st: SurfaceTexture) {
      host.dragonFrameShown = true
    }
  }
}

/**
 * The ids of the video players in a view tree that open a stream and have not yet had a frame of it drawn into their texture; a
 * player without a stream shows nothing and waits for nothing.
 */
fun dragonVideoFramesPending(root: android.view.View): List<String> {
  val out = ArrayList<String>()
  fun walk(view: android.view.View) {
    if (view is DragonBoxView) view.dragonVideoView?.let { if (it.dragonStreamed && !it.dragonFrameShown) out.add(view.dragonId) }
    if (view is android.view.ViewGroup) for (i in 0 until view.childCount) walk(view.getChildAt(i))
  }
  walk(root)
  return out
}

/** The readback of the foreign-view module: the web view's class, its settings and its host frame, and a video's player class, clip frame and player frame, in device px. */
fun dragonAppliedForeignView(v: DragonBoxView): List<Pair<String, DumpJson>> {
  v.dragonVideoView?.let { video ->
    val player = video.getChildAt(0) as? TextureView ?: return emptyList()
    return listOf(Pair("dragonVideoView", DumpJson.Obj(listOf(
      Pair("class", DumpJson.Str(player.javaClass.name)),
      Pair("clip", DumpJson.Arr(video.dragonFrame.map { DumpJson.Num(it.toDouble()) })),
      Pair("frame", DumpJson.Arr(video.dragonPlayerFrame.map { DumpJson.Num(it.toDouble()) })),
    ))))
  }
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

/** The longest base64 run in one string literal: a JVM class file holds a string constant of at most 65535 bytes. */
const STREAM_CHUNK = 32768;

/**
 * An MP4 stream's base64 as a Swift or Kotlin String expression. base64 is A-Z, a-z, 0-9, +, / and =, so it needs no escaping; a
 * stream past one chunk is joined at run time from chunk literals, as Kotlin folds a + of literals into one constant.
 */
export const streamLit = (s: string, backend: 'uikit' | 'android-views'): string => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('video data is not base64');
  const chunks: string[] = [];
  for (let i = 0; i < s.length; i += STREAM_CHUNK) chunks.push(`"${s.slice(i, i + STREAM_CHUNK)}"`);
  if (chunks.length <= 1) return chunks[0] ?? '""';
  return backend === 'uikit' ? `[${chunks.join(', ')}].joined()` : `arrayOf(${chunks.join(', ')}).joinToString("")`;
};

export const FOREIGN_VIEW_EMITTER: PaintEmitter<'foreign-view' | 'video-view', 'video-unloaded'> = {
  name: 'foreign-view',
  kinds: ['foreign-view', 'video-view'],
  lines: {
    uikit: (v, _n, w) => (w.kind === 'video-view' ? [`  dragonSetVideoView(${v}, ${streamLit(w.data, 'uikit')})`] : [`  dragonSetForeignView(${v}, src: ${srcLit(w.src, 'uikit')})`]),
    'android-views': (v, _n, w) => (w.kind === 'video-view' ? [`  dragonSetVideoView(${v}, ${streamLit(w.data, 'android-views')})`] : [`  dragonSetForeignView(${v}, ${srcLit(w.src, 'android-views')})`]),
  },
  applied: (_e, backend, w, dpr, g) => {
    if (g.replaced === null) throw new Error('a foreign view on a box that is not replaced');
    const [x, y, width, height] = g.replaced.content as [number, number, number, number];
    if (w.kind === 'video-view') {
      const [dx, dy, dw, dh] = g.replaced.dest as [number, number, number, number];
      return backend === 'uikit'
        ? { class: 'AVPlayerLayer', videoGravity: 'AVLayerVideoGravityResize', clip: [x / dpr, y / dpr, width / dpr, height / dpr], frame: [(dx - x) / dpr, (dy - y) / dpr, dw / dpr, dh / dpr] }
        : { class: 'android.view.TextureView', clip: [x, y, x + width, y + height], frame: [dx - x, dy - y, dx - x + dw, dy - y + dh] };
    }
    return backend === 'uikit'
      ? { class: 'WKWebView', allowsInlineMediaPlayback: true, mediaTypesRequiringUserActionForPlayback: 0, frame: [x / dpr, y / dpr, width / dpr, height / dpr] }
      : { class: 'android.webkit.WebView', javaScriptEnabled: true, mediaPlaybackRequiresUserGesture: false, frame: [x, y, x + width, y + height] };
  },
  native: {
    uikit: { ...NO_NATIVE_PAINT, boxMembers: SWIFT_MEMBERS, file: SWIFT, afterLayout: 'dragonAfterLayoutForeignView', applied: 'dragonAppliedForeignView' },
    'android-views': { ...NO_NATIVE_PAINT, boxMembers: KOTLIN_MEMBERS, file: KOTLIN, afterLayout: 'dragonAfterLayoutForeignView', applied: 'dragonAppliedForeignView' },
  },
  plants: [
    {
      name: 'video-unloaded',
      replace: {
        uikit: ['public let dragonVideoPlantUnloaded = false', 'public let dragonVideoPlantUnloaded = true'],
        'android-views': ['const val DRAGON_VIDEO_PLANT_UNLOADED = false', 'const val DRAGON_VIDEO_PLANT_UNLOADED = true'],
      },
    },
  ],
};

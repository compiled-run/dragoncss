// The native host apps (notes/T013-p3-review-p4-plan.md section 2 items 6, 9 and 10): one derive-mode native compile per fixture and
// direction, the generated Swift and Kotlin sources for every layout case, the iOS app built with swiftc and the Android APK built
// from the SDK tools alone (aapt2, kotlinc, d8, zipalign, apksigner; no Gradle, AGP or androidx), and the smoke run helpers.
// Build output goes to the gitignored packages/parity/out/native/<target>/; nothing native is committed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import type { LayoutInput, LayoutRect, TextMeasurer } from '@dragon/layout';
import { layout, LU_PER_PX, NO_ENGINE_FAULTS, platformFontSize, resolveBorder, snapEdges, zoomFontSize, zoomInput } from '@dragon/layout';
import type { Compiled, EmitCase, Environment, ExpectedEngine, GeneratedFile, NativeBackend, NativeProgram, SupportPlant } from 'dragon';
import { createProjectWith, emitAndroidViewsCases, emitNativeSupport, emitUikitCases, expectedDigest, expectedDump, nativePrograms, NO_FAULTS, programInput, SUPPORT_PLANTS } from 'dragon';
import { emitStatePrograms } from 'dragon';
import { stateEmits } from './state-cases.ts';
import type { ParityCase } from './cases.ts';
import { fixtureInput } from './cases.ts';
import { layoutCases } from './dpr.ts';
import { fontMapOf, withFontMapAssets } from './fixture-groups/fonts.ts';
import { PROJECT_ID } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { ENVIRONMENT } from './fixtures.ts';
import type { EncoderLanguage } from './native-encoders.ts';
import { constructDump, encoderSource, KOTLIN_DUMP_PACKAGE } from './native-encoders.ts';
import { referenceDump } from './native-compare.ts';
import type { NativeDump } from './native-dump.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import type { NativeTarget } from './targets.ts';
import { referenceShapedMeasurer } from './text-shaper-host.ts';
import { deviceDprs } from './targets.ts';

export const BACKEND_OF: { readonly [T in NativeTarget]: NativeBackend } = { ios: 'uikit', android: 'android-views' };
export const NATIVE_CONFIG = { ios: { minimum: '15.0' }, android: { minSdk: 31 } } as const;
export const ANDROID_TARGET_SDK = 36;
export const ANDROID_BUILD_TOOLS = '36.0.0';
export const IOS_TARGET = 'arm64-apple-ios15.0-simulator';
export const HOST_BUNDLE = 'dev.dragon.host';

export const nativeOut = (target: NativeTarget): string => repoPath(`packages/parity/out/native/${target}`);

// ---------------------------------------------------------------- the native generation compile

/** The lane compile (item 9): ios and android together, derive mode, one per fixture and direction. */
export function nativeCompile(spec: FixtureSpec, direction: Environment['direction']): Compiled<'ios' | 'android'> {
  if (spec.kind !== 'layout') throw new Error(`${spec.id} is not a layout fixture`);
  // MQ-a: every native case runs in the parity environment's viewport, so its @media band is the one holding it.
  // TXT1a-2: a real-font fixture compiles with its font map and the map's vendored faces as assets, as pipeline.ts compileFixture does.
  const fonts = fontMapOf(spec.id);
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG }, ...(fonts === undefined ? {} : { fonts }) }, { faults: NO_FAULTS, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: spec.rootFont, foldViewport: ENVIRONMENT.viewport });
  return project.compile(fonts === undefined ? fixtureInput(spec) : withFontMapAssets(fixtureInput(spec), fonts));
}

export type NativeCase = {
  readonly spec: FixtureSpec;
  readonly case: ParityCase;
  readonly compiled: Compiled<'ios' | 'android'>;
  readonly programs: { readonly [B in NativeBackend]: NativeProgram };
};

let records: readonly NativeCase[] | null = null;

/** Every layout case (layoutCases()), each with the programs of its one native compile; a case that cannot be lowered throws. */
export function nativeCases(): readonly NativeCase[] {
  if (records !== null) return records;
  const out: NativeCase[] = [];
  for (const f of layoutCases()) {
    const byDirection = new Map<string, Compiled<'ios' | 'android'>>();
    for (const c of f.cases) {
      const d = c.environment.direction;
      let compiled = byDirection.get(d);
      if (compiled === undefined) {
        compiled = nativeCompile(f.spec, d);
        byDirection.set(d, compiled);
      }
      const p = nativePrograms(compiled, c.assignment);
      if (p.kind !== 'ready') throw new Error(`${c.id}: no native programs: ${p.reason}`);
      out.push({ spec: f.spec, case: c, compiled, programs: p.programs });
    }
  }
  records = out;
  return out;
}

/** The measurer the device mirrors: the engine's shaped measurer over the host's HarfBuzz, for Ahem and every bundled face (R2). */
export function referenceMeasurer(): TextMeasurer {
  return referenceShapedMeasurer();
}

/** The TS engine the expected dumps are projected with: the helpers the device runs translated, and the float a platform stores. */
export function expectedEngine(): ExpectedEngine {
  return { layout, measurer: referenceMeasurer(), snapEdges, zoomInput, noFaults: NO_ENGINE_FAULTS, resolveBorder, luPerPx: LU_PER_PX, platformFontSize, zoomFontSize, float32: Math.fround };
}

const emitted = new Map<NativeTarget, EmitCase[]>();

/** The emitter view of every case for a target, with the expected-dump digests at the target's device DPRs (computed once). */
export function emitCases(target: NativeTarget): EmitCase[] {
  const cached = emitted.get(target);
  if (cached !== undefined) return cached;
  const out = computeEmitCases(target);
  emitted.set(target, out);
  return out;
}

function computeEmitCases(target: NativeTarget): EmitCase[] {
  const backend = BACKEND_OF[target];
  const m = expectedEngine();
  return nativeCases().map((n) => {
    const program = n.programs[backend];
    const viewport = n.case.environment.viewport;
    return {
      id: n.case.id,
      fixture: n.spec.id,
      direction: n.case.environment.direction,
      compilerDigest: n.compiled.digest,
      viewport,
      program,
      expectedDigests: deviceDprs(target).map((dpr) => ({ dpr, sha256: expectedDigest(expectedDump(program, n.case.id, viewport, dpr, m)) })),
    };
  });
}

/** The TS engine's boxes for a program at a DPR (check (d)'s reference). */
export function engineBoxes(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number): readonly LayoutRect[] {
  const input: LayoutInput = programInput(p, viewport, dpr);
  const out = layout(input, referenceMeasurer());
  if (out.kind !== 'ok') throw new Error(`the engine refused the program at ${dpr}`);
  return out.boxes;
}

// ---------------------------------------------------------------- host sources

const IOS_MAIN = String.raw`import UIKit

final class DragonAppDelegate: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let c = UISceneConfiguration(name: "Default", sessionRole: session.role)
    c.delegateClass = DragonSceneDelegate.self
    return c
  }
}

final class DragonSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let ws = scene as? UIWindowScene else { return }
    let w = UIWindow(windowScene: ws)
    let vc = UIViewController()
    vc.view.backgroundColor = .white
    w.rootViewController = vc
    w.makeKeyAndVisible()
    window = w
    DispatchQueue.main.async { dragonRun(window: w, host: vc.view) }
  }
}

func dragonArgument(_ name: String) -> String? {
  let a = CommandLine.arguments
  if let i = a.firstIndex(of: name), i + 1 < a.count { return a[i + 1] }
  return nil
}

func dragonWrite(_ path: String, _ text: String) {
  do { try text.write(toFile: path, atomically: true, encoding: .utf8) } catch { fatalError("dragon host: cannot write \(path): \(error)") }
}

/// Runs the cases of the run file in the app container's Documents (or --dragon-cases) at the screen's own scale, in a stage
/// inside the safe area, and writes one dump per case, the bridge record and the device record into DRAGON_OUT.
func dragonRun(window: UIWindow, host: UIView) {
  UIView.setAnimationsEnabled(false)
  let env = ProcessInfo.processInfo.environment
  guard let out = env["DRAGON_OUT"] else { fatalError("dragon host: DRAGON_OUT is not set") }
  // --dragon-cases wins over a run file left in the container by an earlier run.
  var run = DragonRun()
  if let listed = dragonArgument("--dragon-cases") { run.ids = listed.split(separator: ",").map(String.init) } else { run = dragonReadRun(NSHomeDirectory() + "/Documents/dragon-run.tsv") ?? DragonRun() }
  let bridge = DragonBridge.shared
  dragonWrite(out + "/bridge-ios.json", bridge.record(platform: "ios"))
  let scale = Double(window.screen.scale)
  if Double(window.traitCollection.displayScale) != scale { fatalError("dragon host: traitCollection.displayScale differs from UIScreen.scale") }
  host.layoutIfNeeded()
  let insets = window.safeAreaInsets
  let stage = UIView(frame: CGRect(x: insets.left, y: insets.top, width: host.bounds.width - insets.left - insets.right, height: host.bounds.height - insets.top - insets.bottom))
  stage.backgroundColor = .white
  host.addSubview(stage)
  let origin = stage.convert(CGPoint.zero, to: nil)
  let f = { (v: Double) -> String in DumpJsonWriter.format(v) }
  let model = env["SIMULATOR_DEVICE_NAME"] ?? UIDevice.current.model
  let os = ProcessInfo.processInfo.operatingSystemVersionString
  dragonWrite(out + "/device-ios.json", "{\"platform\":\"ios\",\"model\":\(DumpJsonWriter.quote(model)),\"os\":\(DumpJsonWriter.quote(os)),\"build\":\(DumpJsonWriter.quote(env["SIMULATOR_RUNTIME_BUILD_VERSION"] ?? "")),\"scale\":\(f(scale)),\"windowPx\":[\(f(Double(window.bounds.width) * scale)),\(f(Double(window.bounds.height) * scale))],\"stagePx\":[\(f(Double(stage.bounds.width) * scale)),\(f(Double(stage.bounds.height) * scale))],\"rootOriginPx\":[\(f(Double(origin.x) * scale)),\(f(Double(origin.y) * scale))],\"textScale\":\"\(UIApplication.shared.preferredContentSizeCategory.rawValue)\"}")
  #if arch(arm64)
  let abi = "arm64"
  #else
  let abi = "x86_64"
  #endif
  let device = DumpDevice(platform: "ios", os: os, model: model, abi: abi, scale: scale, toolchain: dragonToolchain, renderer: "simulator-metal")
  dragonCase(0, run: run, out: out, stage: stage, scale: scale, device: device, bridge: bridge)
}

func dragonCase(_ k: Int, run: DragonRun, out: String, stage: UIView, scale: Double, device: DumpDevice, bridge: DragonBridge) {
  if k >= run.ids.count {
    dragonWrite(out + "/done-ios", "ok")
    exit(0)
  }
  let id = run.ids[k]
  // SELD-R1a: a case script runs on a state mount, whose every setter rebuilds and lays out the views on the stage; an id that is
  // both a layout case and a script fails rather than running one of them.
  let script = dragonStateCaseTable[id]
  let layoutCase = DragonHost.dragonCaseTable[id]
  if script != nil && layoutCase != nil { fatalError("dragon host: \(id) is both a layout case and a case script") }
  guard let c = script?.dragonCase ?? layoutCase else { fatalError("dragon host: no case \(id)") }
  let t0: CFTimeInterval
  let tree: DragonTree
  if let script = script {
    t0 = CACurrentMediaTime()
    let mount = DragonStateMount(machine: script.make(), stage: stage, measurer: bridge.measurer, scale: scale, bridge: bridge)
    script.run(mount.machine)
    tree = mount.tree
  } else {
    tree = DragonTree()
    c.build(tree)
    stage.addSubview(tree.root)
    t0 = CACurrentMediaTime()
    do {
      try tree.apply(c.input(scale), measurer: bridge.measurer, scale: scale, bridge: bridge)
    } catch {
      fatalError("dragon host: \(id): \(error)")
    }
  }
  stage.layoutIfNeeded()
  tree.root.layoutIfNeeded()
  CATransaction.flush()
  let t1 = CACurrentMediaTime()
  let pixels = dragonCapture(tree.root, scale: scale, points: run.points[id] ?? [])
  let t2 = CACurrentMediaTime()
  let dump = tree.dump(c, scale: scale, device: device, pixels: pixels, timing: DumpTiming(settleMs: (t1 - t0) * 1000, dumpMs: (CACurrentMediaTime() - t2) * 1000))
  dragonWrite(out + "/" + id + "@" + DumpJsonWriter.format(scale) + ".json", dumpJson(dump))
  let next = {
    tree.root.removeFromSuperview()
    dragonCase(k + 1, run: run, out: out, stage: stage, scale: scale, device: device, bridge: bridge)
  }
  if !run.hold {
    DispatchQueue.main.async(execute: next)
    return
  }
  // The capture-trust probe: the case stays on screen until the host has taken the OS screenshot.
  dragonWrite(out + "/hold-" + id, "ok")
  func wait() {
    if FileManager.default.fileExists(atPath: out + "/release-" + id) { next() } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { wait() } }
  }
  wait()
}

_ = UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(DragonAppDelegate.self))
`;

function iosInfoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>${HOST_BUNDLE}</string>
  <key>CFBundleExecutable</key><string>DragonHost</string>
  <key>CFBundleName</key><string>DragonHost</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleSupportedPlatforms</key><array><string>iPhoneSimulator</string></array>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
  <key>UILaunchScreen</key><dict/>
  <key>UIApplicationSceneManifest</key>
  <dict>
    <key>UIApplicationSupportsMultipleScenes</key><false/>
    <key>UISceneConfigurations</key>
    <dict>
      <key>UIWindowSceneSessionRoleApplication</key>
      <array><dict><key>UISceneConfigurationName</key><string>Default</string><key>UISceneDelegateClassName</key><string>DragonHost.DragonSceneDelegate</string></dict></array>
    </dict>
  </dict>
</dict>
</plist>
`;
}

const ANDROID_ACTIVITY = String.raw`package dev.dragon.host

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.PixelCopy
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.FrameLayout
import dev.dragon.cases.dragonCaseTable
import dev.dragon.dump.DumpDevice
import dev.dragon.dump.DumpJsonWriter
import dev.dragon.dump.DumpPixels
import dev.dragon.dump.DumpTiming
import dev.dragon.dump.dumpJson
import dev.dragon.views.DragonBridge
import dev.dragon.views.DragonRun
import dev.dragon.views.DragonStateMount
import dev.dragon.views.DragonTree
import dev.dragon.views.dragonReadRun
import dev.dragon.views.dragonSamples
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest

/**
 * Runs the cases of the run file in the app's files dir (or the dragon.cases extra) at the display density, in a stage inset by
 * the system bars, and writes one dump per case, the bridge record and the device record to the app's files.
 */
class DragonActivity : Activity() {
  private val frame by lazy { FrameLayout(this) }
  private lateinit var run: DragonRun
  private lateinit var out: File
  private lateinit var bridge: DragonBridge
  private lateinit var device: DumpDevice
  private var scale = 0.0
  private var insetsApplied = false
  private val main = Handler(Looper.getMainLooper())

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    frame.setBackgroundColor(0xffffffff.toInt())
    frame.setOnApplyWindowInsetsListener { v, insets ->
      val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insetsApplied = true
      insets
    }
    setContentView(frame)
    out = getExternalFilesDir(null) ?: throw IllegalStateException("dragon host: no external files dir")
    File(out, "done-android").delete()
    // The dragon.cases extra wins over a run file left in the files dir by an earlier run.
    val listed = intent.getStringExtra("dragon.cases")
    run = if (listed != null) DragonRun(listed.split(",").filter { it.isNotEmpty() }, emptyMap(), false) else dragonReadRun(File(out, "dragon-run.tsv")) ?: DragonRun(emptyList(), emptyMap(), false)
    bridge = DragonBridge.shared(this)
    File(out, "bridge-android.json").writeText(bridge.record("android"))
    scale = resources.displayMetrics.density.toDouble()
    val os = "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ", " + Build.ID + ")"
    val model = Build.MODEL + " / " + (intent.getStringExtra("dragon.model") ?: "unnamed")
    device = DumpDevice("android", os, model, Build.SUPPORTED_ABIS[0], scale, DRAGON_TOOLCHAIN, intent.getStringExtra("dragon.renderer") ?: "unknown")
    frame.post(object : Runnable {
      var waited = 0
      override fun run() {
        // The stage is placed once the system bar insets have been applied; below API 35 (no enforced edge-to-edge) the decor
        // view places the content below the bars and consumes the insets, so a laid-out stage after 0.5 s is placed too.
        waited++
        val placed = insetsApplied || (frame.isLaidOut && waited > 30)
        if (placed && !frame.isLayoutRequested) runCase(0) else main.postDelayed(this, 16)
      }
    })
  }

  private fun q(s: String): String = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

  private fun deviceRecord(tree: DragonTree) {
    val at = IntArray(2)
    tree.root.getLocationOnScreen(at)
    val d = window.decorView
    val f = { v: Double -> DumpJsonWriter.format(v) }
    File(out, "device-android.json").writeText("{\"platform\":\"android\",\"model\":" + q(device.model) + ",\"os\":" + q(device.os) + ",\"build\":" + q(Build.DISPLAY) + ",\"scale\":" + f(scale) + ",\"densityDpi\":" + resources.displayMetrics.densityDpi + ",\"windowPx\":[" + d.width + "," + d.height + "],\"stagePx\":[" + (frame.width - frame.paddingLeft - frame.paddingRight) + "," + (frame.height - frame.paddingTop - frame.paddingBottom) + "],\"rootOriginPx\":[" + at[0] + "," + at[1] + "],\"textScale\":\"" + resources.configuration.fontScale + "\"}")
  }

  private fun runCase(k: Int) {
    if (k >= run.ids.size) {
      File(out, "done-android").writeText("ok")
      finish()
      return
    }
    val id = run.ids[k]
    // SELD-R1a: a case script runs on a state mount, whose every setter rebuilds and lays out the views on the stage; an id that
    // is both a layout case and a script fails rather than running one of them.
    val script = dev.dragon.cases.dragonStateCaseTable[id]
    val layoutCase = dev.dragon.cases.dragonCaseTable[id]
    if (script != null && layoutCase != null) throw IllegalStateException("dragon host: " + id + " is both a layout case and a case script")
    val c = script?.dragonCase ?: layoutCase ?: throw IllegalStateException("dragon host: no case " + id)
    val t0: Long
    val tree: DragonTree
    if (script != null) {
      t0 = SystemClock.elapsedRealtimeNanos()
      val mount = DragonStateMount(script.make(), frame, bridge.measurer, scale, bridge)
      script.run(mount.machine)
      tree = mount.tree
    } else {
      tree = DragonTree(this)
      c.build(tree)
      t0 = SystemClock.elapsedRealtimeNanos()
      tree.apply(c.input(scale), bridge.measurer, scale, bridge)
      frame.addView(tree.root, FrameLayout.LayoutParams(tree.root.dragonFrame[2], tree.root.dragonFrame[3]))
    }
    // Settle on explicit signals: the root laid out and drawn, two more frame callbacks, then compositor copies of the window until
    // two consecutive copies are equal (a copy of a frame before the tree was presented differs from the next one).
    var drawnAt = -1
    fun settle(frames: Int) {
      Choreographer.getInstance().postFrameCallback {
        if (drawnAt < 0 && tree.root.isLaidOut && tree.root.width > 0 && tree.root.isAttachedToWindow && !tree.root.isDirty) drawnAt = frames
        if (drawnAt < 0 || frames < drawnAt + 2) {
          if (frames > 6000) throw IllegalStateException("dragon host: " + id + " was not laid out after " + frames + " frames (attached " + tree.root.isAttachedToWindow + ", laid out " + tree.root.isLaidOut + ", layout requested " + tree.root.isLayoutRequested + ", size " + tree.root.width + "x" + tree.root.height + ", window focus " + hasWindowFocus() + ", window visibility " + window.decorView.windowVisibility + ", stage " + frame.width + "x" + frame.height + ")")
          settle(frames + 1)
          return@postFrameCallback
        }
        val t1 = SystemClock.elapsedRealtimeNanos()
        deviceRecord(tree)
        val at = IntArray(2)
        tree.root.getLocationInWindow(at)
        val w = tree.root.width
        val h = tree.root.height
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        var previous: String? = null
        // A window that has not yet produced a frame, or has no surface yet, has nothing to copy, and a copy under load may time out:
        // copy again on the next frame.
        fun copy(attempt: Int) {
          if (!window.decorView.isAttachedToWindow) throw IllegalStateException("dragon host: the window is detached")
          val done = PixelCopy.OnPixelCopyFinishedListener { result ->
            if ((result == PixelCopy.ERROR_SOURCE_NO_DATA || result == PixelCopy.ERROR_TIMEOUT) && attempt < 6000) {
              Choreographer.getInstance().postFrameCallback { copy(attempt + 1) }
              return@OnPixelCopyFinishedListener
            }
            if (result != PixelCopy.SUCCESS) throw IllegalStateException("dragon host: PixelCopy failed with " + result + " after " + attempt + " retries")
            val t2 = SystemClock.elapsedRealtimeNanos()
            val buf = ByteBuffer.allocate(w * h * 4)
            bitmap.copyPixelsToBuffer(buf)
            val bytes = buf.array()
            val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { String.format("%02x", it.toInt() and 0xff) }
            if (sha != previous) {
              if (attempt >= 6000) throw IllegalStateException("dragon host: " + id + ": no two consecutive copies were equal after " + attempt + " copies")
              previous = sha
              Choreographer.getInstance().postFrameCallback { copy(attempt + 1) }
              return@OnPixelCopyFinishedListener
            }
            val pixels = DumpPixels("PixelCopy", w.toDouble(), h.toDouble(), sha, dragonSamples(bytes, w, h, run.points[id] ?: emptyList()))
            val dump = tree.dump(c, scale, device, pixels, DumpTiming((t1 - t0) / 1e6, (SystemClock.elapsedRealtimeNanos() - t2) / 1e6))
            File(out, id + "@" + DumpJsonWriter.format(scale) + ".json").writeText(dumpJson(dump))
            val next = Runnable {
              frame.removeView(tree.root)
              frame.post { runCase(k + 1) }
            }
            if (!run.hold) next.run()
            else {
              // The capture-trust probe: the case stays on screen until the host has taken the OS screenshot.
              File(out, "hold-" + id).writeText("ok")
              val release = File(out, "release-" + id)
              val poll = object : Runnable {
                override fun run() {
                  if (release.exists()) next.run() else main.postDelayed(this, 50)
                }
              }
              main.post(poll)
            }
          }
          try {
            PixelCopy.request(window, Rect(at[0], at[1], at[0] + w, at[1] + h), bitmap, done, main)
          } catch (e: IllegalArgumentException) {
            if (attempt >= 6000) throw e
            Choreographer.getInstance().postFrameCallback { copy(attempt + 1) }
          }
        }
        copy(0)
      }
    }
    settle(1)
  }
}
`;

function androidManifest(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${HOST_BUNDLE}" android:versionCode="1" android:versionName="1.0">
  <uses-sdk android:minSdkVersion="${NATIVE_CONFIG.android.minSdk}" android:targetSdkVersion="${ANDROID_TARGET_SDK}" />
  <application android:label="Dragon host" android:hasCode="true" android:allowBackup="false">
    <activity android:name=".DragonActivity" android:exported="true" android:theme="@android:style/Theme.Material.Light.NoActionBar" android:screenOrientation="portrait">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`;
}

/** Faults planted in a host build: an API above the floor on either platform, or the glyph-offset-1 raster plant (P5, both). */
export type BuildPlant = 'ios-16' | 'api-34' | SupportPlant;
export const BUILD_PLANTS: { readonly [T in NativeTarget]: readonly BuildPlant[] } = { ios: ['ios-16', ...SUPPORT_PLANTS], android: ['api-34', ...SUPPORT_PLANTS] };
const PLANTED: { readonly [P in Exclude<BuildPlant, SupportPlant>]: GeneratedFile } = {
  'ios-16': { path: 'Host/DragonPlanted.swift', text: 'import UIKit\n\n/// Planted floor fault: UICalendarView is iOS 16 only.\nfunc dragonPlantedIos16() -> UIView { return UICalendarView() }\n' },
  'api-34': { path: 'kotlin/dev/dragon/host/DragonPlanted.kt', text: 'package dev.dragon.host\n\n/** Planted floor fault: Context.createDeviceContext is API 34. */\nfun dragonPlantedApi34(c: android.content.Context): Any? = c.createDeviceContext(0)\n' },
};

/** Every source file of a target's host app, relative to its source root, in path order; the engine files are the committed ones. */
export function hostSources(target: NativeTarget, toolchain: string, plant: BuildPlant | null = null): GeneratedFile[] {
  const backend = BACKEND_OF[target];
  const cases = emitCases(target);
  const files: GeneratedFile[] = [];
  if (target === 'ios') {
    const engine = repoPath('packages/layout/generated/swift/Sources/DragonLayout');
    for (const f of readdirSync(engine).filter((x) => x.endsWith('.swift')).sort()) files.push({ path: `DragonLayout/${f}`, text: readFileSync(join(engine, f), 'utf8') });
    files.push({ path: 'Support/DragonDump.swift', text: encoderSource('swift') });
    files.push({ path: 'Host/main.swift', text: `// GENERATED by @dragon/parity native-host.ts. Do not edit.\n${IOS_MAIN}` });
    files.push({ path: 'Host/DragonToolchain.swift', text: `// GENERATED by @dragon/parity native-host.ts. Do not edit.\nlet dragonToolchain = ${JSON.stringify(toolchain)}\n` });
    files.push({ path: 'Info.plist', text: iosInfoPlist() });
  } else {
    const engine = repoPath('packages/layout/generated/kotlin/src/main/kotlin/dev/dragon/layout');
    for (const f of readdirSync(engine).filter((x) => x.endsWith('.kt')).sort()) files.push({ path: `kotlin/dev/dragon/layout/${f}`, text: readFileSync(join(engine, f), 'utf8') });
    files.push({ path: 'kotlin/dev/dragon/dump/DragonDump.kt', text: encoderSource('kotlin') });
    files.push({ path: 'kotlin/dev/dragon/host/DragonActivity.kt', text: `// GENERATED by @dragon/parity native-host.ts. Do not edit.\n${ANDROID_ACTIVITY}` });
    files.push({ path: 'kotlin/dev/dragon/host/DragonToolchain.kt', text: `// GENERATED by @dragon/parity native-host.ts. Do not edit.\npackage dev.dragon.host\n\nconst val DRAGON_TOOLCHAIN = ${JSON.stringify(toolchain)}\n` });
    files.push({ path: 'AndroidManifest.xml', text: androidManifest() });
  }
  const supportPlant = plant !== null && (SUPPORT_PLANTS as readonly string[]).includes(plant) ? (plant as SupportPlant) : null;
  files.push(...emitNativeSupport(backend, supportPlant));
  files.push(...(backend === 'uikit' ? emitUikitCases(cases) : emitAndroidViewsCases(cases)));
  // SELD-R1a: the state programs and their case scripts.
  files.push(...emitStatePrograms(backend, stateEmits(target)));
  if (plant !== null && supportPlant === null) files.push(PLANTED[plant as Exclude<BuildPlant, SupportPlant>]);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The sha256 of a source tree: path and text of every file, in path order. */
export function sourceTreeSha256(files: readonly GeneratedFile[]): string {
  const h = createHash('sha256');
  for (const f of files) h.update(f.path).update('\0').update(f.text).update('\0');
  return h.digest('hex');
}

/** Writes the source tree under dir/src, replacing whatever was there. */
export function writeSources(dir: string, files: readonly GeneratedFile[]): string {
  const src = join(dir, 'src');
  rmSync(src, { recursive: true, force: true });
  for (const f of files) {
    mkdirSync(dirname(join(src, f.path)), { recursive: true });
    writeFileSync(join(src, f.path), f.text);
  }
  return src;
}

// ---------------------------------------------------------------- tools

export type Run = { readonly status: number; readonly out: string };

export function run(cmd: string, args: readonly string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Run {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: opts.timeoutMs });
  return { status: r.status ?? (r.error === undefined ? 1 : 127), out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error === undefined ? '' : String(r.error)}` };
}

function must(r: Run, what: string): string {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status}):\n${r.out.slice(-6000)}`);
  return r.out;
}

export function xcodeVersion(): string {
  return must(run('xcodebuild', ['-version']), 'xcodebuild -version').trim().replace(/\s*\n\s*/g, ' ');
}

export type AndroidTools = { readonly home: string; readonly javaHome: string; readonly buildTools: string; readonly androidJar: string; readonly apiVersions: string; readonly kotlinc: string; readonly kotlinStdlib: string; readonly adb: string; readonly emulator: string };

/** The owner-installed SDK and Kotlin; throws naming what is missing (a tooling fault, never a pass). */
export function androidTools(): AndroidTools {
  const home = process.env['ANDROID_HOME'];
  const javaHome = process.env['JAVA_HOME'];
  if (home === undefined || !existsSync(home)) throw new Error('ANDROID_HOME is not set to an installed SDK');
  if (javaHome === undefined || !existsSync(join(javaHome, 'bin', 'java'))) throw new Error('JAVA_HOME is not set to a JDK');
  const buildTools = join(home, 'build-tools', ANDROID_BUILD_TOOLS);
  const androidJar = join(home, 'platforms', `android-${ANDROID_TARGET_SDK}`, 'android.jar');
  const apiVersions = join(home, 'platforms', `android-${ANDROID_TARGET_SDK}`, 'data', 'api-versions.xml');
  const which = run('which', ['kotlinc']);
  if (which.status !== 0) throw new Error('kotlinc is not on PATH');
  const kotlinc = which.out.trim();
  const kotlinHome = dirname(dirname(realpathSync(kotlinc)));
  const stdlib = [join(kotlinHome, 'lib', 'kotlin-stdlib.jar'), join(kotlinHome, 'libexec', 'lib', 'kotlin-stdlib.jar')].find(existsSync);
  if (stdlib === undefined) throw new Error(`no kotlin-stdlib.jar next to ${kotlinc}`);
  for (const [what, p] of [['build-tools', buildTools], ['android.jar', androidJar], ['api-versions.xml', apiVersions]] as const) if (!existsSync(p)) throw new Error(`${what} is missing at ${p}`);
  return { home, javaHome, buildTools, androidJar, apiVersions, kotlinc, kotlinStdlib: stdlib, adb: join(home, 'platform-tools', 'adb'), emulator: join(home, 'emulator', 'emulator') };
}

// ---------------------------------------------------------------- builds

export type BuildResult = { readonly target: NativeTarget; readonly cases: number; readonly sourceSha256: string; readonly artifact: string; readonly log: readonly string[] };

/** Build options: a plant, and reuse, which keeps an artifact built from the same source tree (its sha256 is stamped beside it). */
export type BuildOptions = { readonly plant?: BuildPlant | null; readonly reuse?: boolean };

/** The build directory of a target: a planted build never overwrites the clean one. */
export const buildDir = (target: NativeTarget, plant: BuildPlant | null = null): string => (plant === null ? nativeOut(target) : join(nativeOut(target), `plant-${plant}`));

const stampOf = (artifact: string): string => `${artifact}.sha256`;
/** The reuse stamp: the source tree and the bundled Ahem.ttf the build copies beside it, so a font change forces a rebuild. */
export function reuseStamp(sourceSha256: string): string {
  return `${sourceSha256} ahem ${createHash('sha256').update(readFileSync(repoPath('vendor/fonts/Ahem.ttf'))).digest('hex')}`;
}
function reused(artifact: string, sha: string): boolean {
  return existsSync(artifact) && existsSync(stampOf(artifact)) && readFileSync(stampOf(artifact), 'utf8') === reuseStamp(sha);
}

/** The iOS host app: swiftc for the iOS 15 simulator target with -O, Info.plist and Ahem, ad-hoc signed. */
export function buildIos(opts: BuildOptions = {}): BuildResult {
  const dir = buildDir('ios', opts.plant ?? null);
  const toolchain = xcodeVersion();
  const files = hostSources('ios', toolchain, opts.plant ?? null);
  const sha = sourceTreeSha256(files);
  const app = join(dir, 'build', 'DragonHost.app');
  if (opts.reuse === true && reused(app, sha)) return { target: 'ios', cases: emitCases('ios').length, sourceSha256: sha, artifact: app, log: [`reused ${app} (source sha256 ${sha})`] };
  rmSync(stampOf(app), { force: true });
  const src = writeSources(dir, files);
  rmSync(app, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });
  const swift = files.filter((f) => f.path.endsWith('.swift')).map((f) => join(src, f.path));
  const log: string[] = [];
  const t0 = Date.now();
  must(run('xcrun', ['-sdk', 'iphonesimulator', 'swiftc', '-target', IOS_TARGET, '-O', '-j', String(availableParallelism()), '-module-name', 'DragonHost', '-o', join(app, 'DragonHost'), ...swift], { timeoutMs: 1_800_000 }), 'swiftc (iOS 15 simulator)');
  log.push(`swiftc ${IOS_TARGET} -O: ${swift.length} files in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  copyFileSync(join(src, 'Info.plist'), join(app, 'Info.plist'));
  copyFileSync(repoPath('vendor/fonts/Ahem.ttf'), join(app, 'Ahem.ttf'));
  must(run('codesign', ['--force', '--sign', '-', '--timestamp=none', app]), 'codesign -s -');
  log.push('codesign --sign - (ad hoc)');
  writeFileSync(stampOf(app), reuseStamp(sha));
  return { target: 'ios', cases: emitCases('ios').length, sourceSha256: sha, artifact: app, log };
}

/** The Android host APK from the SDK tools alone: aapt2 link, kotlinc against android.jar, d8 --min-api 31, zipalign, apksigner. */
export function buildAndroid(opts: BuildOptions = {}): BuildResult & { readonly dexes: readonly string[]; readonly tools: AndroidTools } {
  const tools = androidTools();
  const dir = buildDir('android', opts.plant ?? null);
  const kotlinVersion = must(run(tools.kotlinc, ['-version']), 'kotlinc -version').trim().split('\n').pop() ?? '';
  const toolchain = `${kotlinVersion.replace(/^info:\s*/, '')}; d8 and aapt2 ${ANDROID_BUILD_TOOLS}; android-${ANDROID_TARGET_SDK}.jar; no Gradle`;
  const files = hostSources('android', toolchain, opts.plant ?? null);
  const sha = sourceTreeSha256(files);
  const build = join(dir, 'build');
  const apk = join(build, 'DragonHost.apk');
  const dexDir = join(build, 'dex');
  if (opts.reuse === true && reused(apk, sha)) return { target: 'android', cases: emitCases('android').length, sourceSha256: sha, artifact: apk, log: [`reused ${apk} (source sha256 ${sha})`], dexes: readdirSync(dexDir).filter((f) => /^classes\d*\.dex$/.test(f)).sort().map((d) => join(dexDir, d)), tools };
  const src = writeSources(dir, files);
  rmSync(build, { recursive: true, force: true });
  mkdirSync(join(build, 'assets', 'fonts'), { recursive: true });
  mkdirSync(join(build, 'dex'), { recursive: true });
  copyFileSync(repoPath('vendor/fonts/Ahem.ttf'), join(build, 'assets', 'fonts', 'Ahem.ttf'));
  const bt = (t: string): string => join(tools.buildTools, t);
  const env = { ...process.env, JAVA_HOME: tools.javaHome, PATH: `${join(tools.javaHome, 'bin')}:${process.env['PATH'] ?? ''}` };
  const log: string[] = [];
  const base = join(build, 'base.apk');
  must(run(bt('aapt2'), ['link', '--manifest', join(src, 'AndroidManifest.xml'), '-I', tools.androidJar, '-A', join(build, 'assets'), '--min-sdk-version', String(NATIVE_CONFIG.android.minSdk), '--target-sdk-version', String(ANDROID_TARGET_SDK), '-o', base], { env }), 'aapt2 link');
  log.push('aapt2 link: manifest, android-36 android.jar, assets/fonts/Ahem.ttf');
  const kt = files.filter((f) => f.path.endsWith('.kt')).map((f) => join(src, f.path));
  const classes = join(build, 'classes.jar');
  let t0 = Date.now();
  must(run(tools.kotlinc, ['-J-Xmx8g', '-cp', tools.androidJar, '-jvm-target', '1.8', '-nowarn', '-d', classes, ...kt], { env, timeoutMs: 1_800_000 }), 'kotlinc');
  log.push(`kotlinc -cp android.jar: ${kt.length} files in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  t0 = Date.now();
  must(run(bt('d8'), ['--release', '--min-api', String(NATIVE_CONFIG.android.minSdk), '--lib', tools.androidJar, '--output', join(build, 'dex'), classes, tools.kotlinStdlib], { env, timeoutMs: 1_800_000 }), 'd8');
  const dexes = readdirSync(join(build, 'dex')).filter((f) => /^classes\d*\.dex$/.test(f)).sort();
  log.push(`d8 --min-api ${NATIVE_CONFIG.android.minSdk} with kotlin-stdlib: ${dexes.join(', ')} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  must(run('zip', ['-q', '-j', base, ...dexes.map((d) => join(build, 'dex', d))]), 'zip classes.dex');
  const aligned = join(build, 'aligned.apk');
  must(run(bt('zipalign'), ['-p', '-f', '4', base, aligned]), 'zipalign');
  const keystore = join(nativeOut('android'), 'debug.keystore');
  if (!existsSync(keystore)) {
    must(run(join(tools.javaHome, 'bin', 'keytool'), ['-genkeypair', '-keystore', keystore, '-storepass', 'android', '-keypass', 'android', '-alias', 'dragondebug', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Dragon Debug,O=Dragon,C=US'], { env }), 'keytool');
  }
  must(run(bt('apksigner'), ['sign', '--ks', keystore, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'dragondebug', '--out', apk, aligned], { env }), 'apksigner sign');
  log.push('zipalign -p 4; apksigner sign with a debug key generated under out/');
  writeFileSync(stampOf(apk), reuseStamp(sha));
  return { target: 'android', cases: emitCases('android').length, sourceSha256: sha, artifact: apk, log, dexes: dexes.map((d) => join(build, 'dex', d)), tools };
}

// ---------------------------------------------------------------- dump encoders on the host

/**
 * Every layout case's reference dump (TS engine plus snapRect) at a DPR, re-labelled to the target's device lane with deterministic
 * non-null pixels, timing, line baseline, start and end, the expected digest and the expected applied values of the target's
 * backend, so every field kind of the schema is encoded.
 */
export function relabelledReferenceDumps(target: NativeTarget, dpr: number): NativeDump[] {
  const backend = BACKEND_OF[target];
  const m = expectedEngine();
  return nativeCases().map((n) => {
    const program = n.programs[backend];
    const viewport = n.case.environment.viewport;
    const input = programInput(program, viewport, dpr);
    const engine = engineBoxes(program, viewport, dpr);
    const ref = referenceDump({ platform: target, caseId: n.case.id, fixture: n.spec.id, dpr, direction: n.case.environment.direction, compilerDigest: n.compiled.digest, input, engine });
    const e = expectedDump(program, n.case.id, viewport, dpr, m);
    const applied = new Map(e.nodes.map((x) => [x.id, x.applied]));
    const sha = createHash('sha256').update(n.case.id).digest('hex');
    return {
      ...ref,
      lane: target === 'ios' ? 'ios-sim' : 'android-emu',
      case: { ...ref.case, expectedDigest: expectedDigest(e) },
      device: { platform: target, os: 'host encoder test', model: 'none', abi: 'host', scale: dpr, toolchain: 'host', renderer: 'none' },
      nodes: ref.nodes.map((x) => ({
        ...x,
        native: e.nodes.find((y) => y.id === x.id)?.native ?? x.native,
        applied: applied.get(x.id) ?? {},
        // A text line's offsets are made up; an element line (an inline box fragment) has no own text, so a device writes 0 and 0.
        lines: x.lines.map((l, j) => ({ ...l, baseline: l.frame.height * 0.8, start: x.kind === 'text' ? 3 * j : 0, end: x.kind === 'text' ? 3 * j + 2 : 0 })),
      })),
      pixels: { capture: target === 'ios' ? 'drawHierarchy' : 'PixelCopy', colorSpace: 'sRGB', width: Math.ceil(viewport.width * dpr), height: Math.ceil(viewport.height * dpr), sha256: sha, samples: [{ x: 1, y: 2, rgba: [255, 255, 255, 255], rule: `interior:${ref.nodes[0]?.id ?? 'root'}` }] },
      timing: { settleMs: 1.25, dumpMs: 0.5 },
    } as NativeDump;
  });
}

/** Compiles the encoder with a program that builds the dumps by typed constructors and prints each as one JSON line; returns the lines. */
export function runEncoder(lang: EncoderLanguage, encoder: string, dumps: readonly NativeDump[], dir: string): string[] {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (lang === 'swift') {
    writeFileSync(join(dir, 'DragonDump.swift'), encoder);
    const perFile = 20;
    const files: string[] = [join(dir, 'DragonDump.swift')];
    for (let f = 0; f * perFile < dumps.length; f++) {
      const part = dumps.slice(f * perFile, (f + 1) * perFile).flatMap((d, i) => constructDump(lang, d, `d${f * perFile + i}`));
      const file = join(dir, `Dumps${f}.swift`);
      writeFileSync(file, `import Foundation\n\n${part.join('\n\n')}\n`);
      files.push(file);
    }
    writeFileSync(join(dir, 'main.swift'), `import Foundation\n\nlet all: [() -> Dump] = [${dumps.map((_, i) => `d${i}`).join(', ')}]\nfor f in all { print(dumpJson(f())) }\n`);
    files.push(join(dir, 'main.swift'));
    must(run('xcrun', ['swiftc', '-Onone', '-j', String(availableParallelism()), '-module-name', 'DragonEncoderTest', '-o', join(dir, 'encoder'), ...files], { timeoutMs: 1_800_000 }), 'swiftc (encoder test)');
    return must(run(join(dir, 'encoder'), []), 'encoder test').split('\n').filter((l) => l.startsWith('{'));
  }
  const tools = androidTools();
  const env = { ...process.env, JAVA_HOME: tools.javaHome };
  const perFile = 20;
  const files: string[] = [];
  writeFileSync(join(dir, 'DragonDump.kt'), encoder);
  files.push(join(dir, 'DragonDump.kt'));
  for (let f = 0; f * perFile < dumps.length; f++) {
    const part = dumps.slice(f * perFile, (f + 1) * perFile).flatMap((d, i) => constructDump(lang, d, `d${f * perFile + i}`));
    const file = join(dir, `Dumps${f}.kt`);
    writeFileSync(file, `package ${KOTLIN_DUMP_PACKAGE}\n\n${part.join('\n\n')}\n`);
    files.push(file);
  }
  writeFileSync(join(dir, 'Main.kt'), `package ${KOTLIN_DUMP_PACKAGE}\n\nfun main() {\n  val all = listOf<() -> Dump>(${dumps.map((_, i) => `::d${i}`).join(', ')})\n  for (f in all) println(dumpJson(f()))\n}\n`);
  files.push(join(dir, 'Main.kt'));
  const jar = join(dir, 'encoder.jar');
  must(run(tools.kotlinc, ['-J-Xmx8g', '-nowarn', '-include-runtime', '-d', jar, ...files], { env, timeoutMs: 1_800_000 }), 'kotlinc (encoder test)');
  return must(run(join(tools.javaHome, 'bin', 'java'), ['-cp', jar, `${KOTLIN_DUMP_PACKAGE}.MainKt`], { env }), 'encoder test').split('\n').filter((l) => l.startsWith('{'));
}

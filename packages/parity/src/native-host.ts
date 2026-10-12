// The native host apps (notes/T013-p3-review-p4-plan.md section 2 items 6, 9 and 10): one derive-mode native compile per fixture and
// direction, the generated Swift and Kotlin sources for every layout case, the iOS app built with swiftc and the Android APK built
// from the SDK tools alone (aapt2, kotlinc, d8, zipalign, apksigner; no Gradle, AGP or androidx), and the smoke run helpers.
// Build output goes to the gitignored packages/parity/out/native/<target>/; nothing native is committed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import type { LayoutBox, LayoutInput, LayoutRect, TextMeasurer } from '@dragon/layout';
import type { LU } from '@dragon/layout';
import { deviceShapedMeasurer, layout, LU_PER_PX, NO_ENGINE_FAULTS, opacityAlpha8, outlineOffsetPx, outlineRings, outlineWidthPx, platformFontSize, replacedPaint, resolveBorder, resolvePadding, roundedShape, scrollRanges, snapEdges, zoomFontSize, zoomInput } from '@dragon/layout';
import type { Compiled, EmitCase, Environment, ExpectedEngine, GeneratedFile, NativeBackend, NativeProgram, SupportPlant } from 'dragon';
import { createProjectWith, emitAndroidViewsCases, emitNativeSupport, emitUikitCases, engineLayoutProjection, expectedDigest, expectedDump, nativePrograms, NO_FAULTS, programInput, SUPPORT_PLANTS } from 'dragon';
import { emitStatePrograms } from 'dragon';
import { stateEmits } from './state-cases.ts';
import { animEmits } from './anim-samples.ts';
import { deviceHitSource } from './hit-capture.ts';
import { deviceTraceSources } from './trace-lane.ts';
import type { ParityCase } from './cases.ts';
import { fixtureInput } from './cases.ts';
import { atDpr, layoutCases } from './dpr.ts';
import { fontMapOf, withFontMapAssets } from './fixture-groups/fonts.ts';
import { PROJECT_ID } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { ENVIRONMENT } from './fixtures.ts';
import type { EncoderLanguage } from './native-encoders.ts';
import { constructDump, encoderSource, KOTLIN_DUMP_PACKAGE } from './native-encoders.ts';
import { referenceDump } from './native-compare.ts';
import type { NativeDump } from './native-dump.ts';
import { BUILD_CACHE, hit, publish, pruneCache, replace } from '../../translate/src/build-cache.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import type { NativeTarget } from './targets.ts';
import { referenceShapedMeasurer } from './text-shaper-host.ts';
import { deviceDprs, vectorCaseIds } from './targets.ts';
import { buildShim, SHIM_ANDROID_ABIS, SHIM_SWIFT_INCLUDE, shimModuleMapSha256, shimSources, shimToken } from './native-shim.ts';
import { ahemFaceId, fontDataOf, hostShaper } from './text-shaper-host.ts';

export const BACKEND_OF: { readonly [T in NativeTarget]: NativeBackend } = { ios: 'uikit', android: 'android-views' };
export const NATIVE_CONFIG = { ios: { minimum: '15.0' }, android: { minSdk: 31 } } as const;
export const ANDROID_TARGET_SDK = 36;
export const ANDROID_BUILD_TOOLS = '36.0.0';
export const IOS_TARGET = 'arm64-apple-ios15.0-simulator';
export const HOST_BUNDLE = 'dev.dragon.host';

export const nativeOut = (target: NativeTarget): string => repoPath(`packages/parity/out/native/${target}`);

// ---------------------------------------------------------------- the native generation compile

/** The lane compile (item 9): ios and android together, derive mode, one per fixture and direction. */
/** nativeRealFaces: lower real bundled faces natively (TXT1a-2 phase C), off by default until phase R; tests of that lowering turn it on. */
export function nativeCompile(spec: FixtureSpec, direction: Environment['direction'], nativeRealFaces = false): Compiled<'ios' | 'android'> {
  if (spec.kind !== 'layout') throw new Error(`${spec.id} is not a layout fixture`);
  // MQ-a: every native case runs in the parity environment's viewport, so its @media band is the one holding it.
  // TXT1a-2: a real-font fixture compiles with its font map and the map's vendored faces as assets, as pipeline.ts compileFixture does.
  const fonts = fontMapOf(spec.id);
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG }, ...(fonts === undefined ? {} : { fonts }) }, { faults: NO_FAULTS, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: spec.rootFont, foldViewport: ENVIRONMENT.viewport, nativeRealFaces, interactionLanes: true });
  return project.compile(fonts === undefined ? fixtureInput(spec) : withFontMapAssets(fixtureInput(spec), fonts));
}

export type NativeCase = {
  readonly spec: FixtureSpec;
  readonly case: ParityCase;
  readonly compiled: Compiled<'ios' | 'android'>;
  readonly programs: { readonly [B in NativeBackend]: NativeProgram };
};

let records: readonly NativeCase[] | null = null;

/**
 * Every device case (targets.ts vectorCaseIds: every layout case but the shaped ones, which the device runtime cannot draw until
 * TXT1a-2 phase R), each with the programs of its one native compile; a case that cannot be lowered throws.
 */
export function nativeCases(): readonly NativeCase[] {
  if (records !== null) return records;
  const device = new Set(vectorCaseIds());
  const out: NativeCase[] = [];
  for (const f of layoutCases()) {
    const byDirection = new Map<string, Compiled<'ios' | 'android'>>();
    for (const c of f.cases) {
      if (!device.has(c.id)) continue;
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

/** A layout case with the engine input tree the engine lane lays it out from (the break vectors and break captures read these). */
export type EngineCase = { readonly case: ParityCase; readonly root: LayoutBox; readonly inputAt: (dpr: number) => LayoutInput };

let engineRecords: readonly EngineCase[] | null = null;

/**
 * Every layout case in layoutCases() order: a device case through its native programs (both backends hold one engine input tree),
 * and a shaped case, which native refuses until TXT1a-2 phase R, through engineLayoutProjection of its derive compile.
 */
export function engineCases(): readonly EngineCase[] {
  if (engineRecords !== null) return engineRecords;
  const native = new Map(nativeCases().map((n) => [n.case.id, n]));
  const out: EngineCase[] = [];
  for (const f of layoutCases()) {
    const byDirection = new Map<string, Compiled<'ios' | 'android'>>();
    for (const c of f.cases) {
      const n = native.get(c.id);
      if (n !== undefined) {
        if (JSON.stringify(n.programs.uikit.root) !== JSON.stringify(n.programs['android-views'].root)) throw new Error(`${c.id}: the uikit and android-views programs hold different engine inputs`);
        out.push({ case: c, root: n.programs.uikit.root, inputAt: (dpr) => programInput(n.programs.uikit, c.environment.viewport, dpr) });
        continue;
      }
      let compiled = byDirection.get(c.environment.direction);
      if (compiled === undefined) {
        compiled = nativeCompile(f.spec, c.environment.direction);
        byDirection.set(c.environment.direction, compiled);
      }
      const at = (dpr: number): LayoutInput => {
        const p = engineLayoutProjection(compiled, atDpr(c.environment, dpr), c.assignment);
        if (p.kind !== 'ready') throw new Error(`${c.id} at DPR ${dpr}: no engine projection: ${p.reason}`);
        return p.input;
      };
      out.push({ case: c, root: at(1).root, inputAt: at });
    }
  }
  engineRecords = out;
  return out;
}

/**
 * The device apps' measurer on the host (TXT1a-2 phase R): deviceShapedMeasurer over the bundled Ahem's FontData and the WASM
 * HarfBuzz, as each app's bridge composes it over its own shim. A fresh measurer per call: its shaped items are cached per layout.
 */
export function referenceMeasurer(): TextMeasurer {
  const ahem = ahemFaceId();
  return deviceShapedMeasurer(new Map([[ahem, fontDataOf(ahem)]]), hostShaper);
}

/** The TS engine the expected dumps are projected with: the helpers the device runs translated, and the float a platform stores. */
export function expectedEngine(): ExpectedEngine {
  return { layout, measurer: referenceMeasurer(), snapEdges, zoomInput, noFaults: NO_ENGINE_FAULTS, resolveBorder, resolvePadding: (st, cb) => resolvePadding(st, cb as LU), replacedPaint, opacityAlpha8, luPerPx: LU_PER_PX, platformFontSize, zoomFontSize, float32: Math.fround, scrollRanges, paint: { roundedShape, outlineRings, outlineWidthPx, outlineOffsetPx } };
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
  // R9: lane and test hosts never load network content; every iframe web view loads about:blank.
  dragonForeignViewLoadsSrc = false
  let env = ProcessInfo.processInfo.environment
  guard let out = env["DRAGON_OUT"] else { fatalError("dragon host: DRAGON_OUT is not set") }
  // --dragon-cases wins over a run file left in the container by an earlier run.
  var run = DragonRun()
  if let listed = dragonArgument("--dragon-cases") { run.ids = listed.split(separator: ",").map(String.init) } else { run = dragonReadRun(NSHomeDirectory() + "/Documents/dragon-run.tsv") ?? DragonRun() }
  // The shim is checked against the host's WASM shim first; the bridge then measures and draws every text through it.
  dragonCheckShim()
  DragonBridge.shaper = dragonGlyphShaper()
  let bridge = DragonBridge.shared
  if !bridge.shaped { fatalError("dragon host: the bridge does not shape with the shim") }
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
  dragonWarmUp(run, stage: stage, scale: scale, bridge: bridge)
  dragonCase(0, run: run, out: out, stage: stage, scale: scale, device: device, bridge: bridge)
}

/// The warm-up capture's sha256 by case, and the cases whose dumped capture differed from it (evidence only, warmup-ios.txt).
var dragonWarmSha: [String: String] = [:]
var dragonWarmDiffers: [String] = []

/// Every layout case of the run drawn and captured once before any is dumped: a fresh render server (a CI virtual Mac's) draws
/// transformed layers differently until its first use of them completes, so a case's first capture is never its dumped one.
func dragonWarmUp(_ run: DragonRun, stage: UIView, scale: Double, bridge: DragonBridge) {
  for id in run.ids {
    guard let c = DragonHost.dragonCaseTable[id] else { continue }
    let tree = DragonTree()
    c.build(tree)
    stage.addSubview(tree.root)
    do {
      try tree.apply(c.input(scale), measurer: bridge.measurer, scale: scale, bridge: bridge)
    } catch {
      fatalError("dragon host: warming up \(id): \(error)")
    }
    stage.layoutIfNeeded()
    tree.root.layoutIfNeeded()
    CATransaction.flush()
    dragonWarmSha[id] = dragonCapture(tree.root, scale: scale, points: []).sha256
    tree.root.removeFromSuperview()
  }
}

func dragonCase(_ k: Int, run: DragonRun, out: String, stage: UIView, scale: Double, device: DumpDevice, bridge: DragonBridge) {
  if k >= run.ids.count {
    dragonWrite(out + "/warmup-ios.txt", "warmed \(dragonWarmSha.count) cases; the dumped capture differed from the warm-up capture in \(dragonWarmDiffers.count)\(dragonWarmDiffers.isEmpty ? "" : ": " + dragonWarmDiffers.joined(separator: " "))\n")
    dragonWrite(out + "/done-ios", "ok")
    exit(0)
  }
  let id = run.ids[k]
  // SELD-R1a: a case script runs on a state mount, whose every setter rebuilds and lays out the views on the stage; an id that is
  // both a layout case and a script fails rather than running one of them.
  let script = dragonStateCaseTable[id]
  let layoutCase = DragonHost.dragonCaseTable[id]
  if script != nil && layoutCase != nil { fatalError("dragon host: \(id) is both a layout case and a case script") }
  // SELD-R2 (T064 R14): an interaction script runs on an interaction mount through the machine's entry points and writes its trace.
  if let interaction = dragonInteractionCaseTable[id] {
    if script != nil || layoutCase != nil { fatalError("dragon host: \(id) is both an interaction script and another case") }
    let mount = DragonInteractionMount(machine: interaction.make(), stage: stage, measurer: bridge.measurer, scale: scale, bridge: bridge)
    dragonWrite(out + "/" + id + "@" + DumpJsonWriter.format(scale) + ".trace", interaction.run(mount.machine, pointer: DragonMachinePointer(mount.machine)).map { $0 + "\n" }.joined())
    mount.unmount()
    DispatchQueue.main.async { dragonCase(k + 1, run: run, out: out, stage: stage, scale: scale, device: device, bridge: bridge) }
    return
  }
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
  if let warm = dragonWarmSha[id], warm != pixels.sha256 { dragonWarmDiffers.append(id) }
  let t2 = CACurrentMediaTime()
  let dump = tree.dump(c, scale: scale, device: device, pixels: pixels, timing: DumpTiming(settleMs: (t1 - t0) * 1000, dumpMs: (CACurrentMediaTime() - t2) * 1000))
  dragonWrite(out + "/" + id + "@" + DumpJsonWriter.format(scale) + ".json", dumpJson(dump))
  // SELD-R1b: the device-hit record, the translated hit test on the case's own input and the device's measurer.
  if let facts = dragonHitFactsTable[id] { dragonWrite(out + "/" + id + "@" + DumpJsonWriter.format(scale) + ".hit", dragonHitRuns(c, facts, scale: scale, measurer: bridge.measurer)) }
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
  <key>UIApplicationSupportsIndirectInputEvents</key><true/>
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
import dev.dragon.views.DragonInteractionMount
import dev.dragon.views.DragonInteractionScript
import dev.dragon.views.DragonMachinePointer
import dev.dragon.views.DragonRun
import dev.dragon.views.DragonStateMount
import dev.dragon.views.DragonTree
import dev.dragon.views.dragonForeignViewLoadsSrc
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
    // R9: lane and test hosts never load network content; every iframe web view loads about:blank.
    dragonForeignViewLoadsSrc = false
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
    // The shim is checked against the host's WASM shim first; the bridge then measures and draws every text through it.
    dragonCheckShim(this)
    DragonBridge.shaper = dragonGlyphShaper(this)
    bridge = DragonBridge.shared(this)
    check(bridge.shaped) { "dragon host: the bridge does not shape with the shim" }
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

  private fun traceText(lines: List<String>): String = lines.joinToString("") { it + "\n" }

  /**
   * SELD-R2 (T064 R14, Android twice): an interaction script runs on an interaction mount through the machine's entry points, then
   * on a fresh mount through real MotionEvents dispatched on its root (DragonMotionInput); each writes its trace, which must agree.
   */
  private fun runInteraction(k: Int, id: String, script: DragonInteractionScript) {
    val s = DumpJsonWriter.format(scale)
    val direct = DragonInteractionMount(script.make(), frame, bridge.measurer, scale, bridge)
    deviceRecord(direct.tree)
    File(out, id + "@" + s + ".trace").writeText(traceText(script.run(direct.machine, DragonMachinePointer(direct.machine))))
    direct.unmount()
    val injected = DragonInteractionMount(script.make(), frame, bridge.measurer, scale, bridge)
    File(out, id + "@" + s + ".motion.trace").writeText(traceText(script.run(injected.machine, DragonMotionInput(injected.root, scale))))
    injected.unmount()
    frame.post { runCase(k + 1) }
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
    val interaction = dev.dragon.cases.dragonInteractionCaseTable[id]
    if (interaction != null) {
      if (script != null || layoutCase != null) throw IllegalStateException("dragon host: " + id + " is both an interaction script and another case")
      runInteraction(k, id, interaction)
      return
    }
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
    // The tree redrawn, then the block once that frame is committed to the display. Only the commit shows the frame holds the
    // redraw: the UI-thread draw is recorded before RenderThread presents it.
    fun afterCommittedFrame(block: () -> Unit) {
      tree.root.viewTreeObserver.registerFrameCommitCallback { main.post { block() } }
      tree.root.invalidate()
    }
    // Settle on explicit signals: the root laid out and drawn, two more frame callbacks, a frame of the redrawn tree committed to
    // the display, then compositor copies of the window, each after a committed frame of its own, until two consecutive copies
    // are equal.
    fun capture() {
      run {
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
              // The next copy is of another committed frame of the same tree, so equal copies show two frames drew it alike.
              afterCommittedFrame { copy(attempt + 1) }
              return@OnPixelCopyFinishedListener
            }
            val pixels = DumpPixels("PixelCopy", w.toDouble(), h.toDouble(), sha, dragonSamples(bytes, w, h, run.points[id] ?: emptyList()))
            val dump = tree.dump(c, scale, device, pixels, DumpTiming((t1 - t0) / 1e6, (SystemClock.elapsedRealtimeNanos() - t2) / 1e6))
            File(out, id + "@" + DumpJsonWriter.format(scale) + ".json").writeText(dumpJson(dump))
            // SELD-R1b: the device-hit record, the translated hit test on the case's own input and the device's measurer.
            dragonHitFactsTable[id]?.let { facts -> File(out, id + "@" + DumpJsonWriter.format(scale) + ".hit").writeText(dragonHitRuns(c, facts, scale, bridge.measurer)) }
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
    var drawnAt = -1
    fun settle(frames: Int) {
      Choreographer.getInstance().postFrameCallback {
        if (drawnAt < 0 && tree.root.isLaidOut && tree.root.width > 0 && tree.root.isAttachedToWindow && !tree.root.isDirty) drawnAt = frames
        if (drawnAt < 0 || frames < drawnAt + 2) {
          if (frames > 6000) throw IllegalStateException("dragon host: " + id + " was not laid out after " + frames + " frames (attached " + tree.root.isAttachedToWindow + ", laid out " + tree.root.isLaidOut + ", layout requested " + tree.root.isLayoutRequested + ", size " + tree.root.width + "x" + tree.root.height + ", window focus " + hasWindowFocus() + ", window visibility " + window.decorView.windowVisibility + ", stage " + frame.width + "x" + frame.height + ")")
          settle(frames + 1)
          return@postFrameCallback
        }
        afterCommittedFrame { capture() }
      }
    }
    settle(1)
  }
}
`;

/**
 * SELD-R2 (T064 R14 and R15): the MotionEvent runner. Each pointer step of a script becomes the events the platform sends, dispatched
 * on the mount's root, so the trace goes through the root's event glue: touch through dispatchTouchEvent (SOURCE_TOUCHSCREEN,
 * TOOL_TYPE_FINGER); mouse hover through dispatchGenericMotionEvent (ACTION_HOVER_*, SOURCE_MOUSE), with the HOVER_EXIT Android
 * sends before a mouse DOWN and the HOVER_ENTER after its UP; mouse buttons and pressed moves through dispatchTouchEvent
 * (SOURCE_MOUSE, TOOL_TYPE_MOUSE). A frame step is the next frame, run at once, so the script stays synchronous.
 */
const ANDROID_MOTION_INPUT = String.raw`package dev.dragon.host

import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import dev.dragon.views.DragonInteractionRoot
import dev.dragon.views.DragonPointerInput

class DragonMotionInput(private val root: DragonInteractionRoot, private val scale: Double) : DragonPointerInput {
  private var hovering = false
  private var mouseDown = false
  private var hoveredAtPress = false
  private var downTime = 0L
  private var lastX = 0f
  private var lastY = 0f

  private fun send(action: Int, x: Double, y: Double, source: Int, tool: Int, buttons: Int) {
    val px = (x * scale).toFloat()
    val py = (y * scale).toFloat()
    // A step point that does not survive the trip through float device px would give the glue another point than the entry points.
    if (px.toDouble() / scale != x || py.toDouble() / scale != y) throw IllegalStateException("dragon host: the point " + x + "," + y + " is not exact in float device px at scale " + scale)
    sendPx(action, px, py, source, tool, buttons)
  }

  private fun sendPx(action: Int, px: Float, py: Float, source: Int, tool: Int, buttons: Int) {
    val now = SystemClock.uptimeMillis()
    if (action == MotionEvent.ACTION_DOWN) downTime = now
    val props = MotionEvent.PointerProperties()
    props.id = 0
    props.toolType = tool
    val coords = MotionEvent.PointerCoords()
    coords.x = px
    coords.y = py
    val hover = action == MotionEvent.ACTION_HOVER_ENTER || action == MotionEvent.ACTION_HOVER_MOVE || action == MotionEvent.ACTION_HOVER_EXIT
    coords.pressure = if (hover) 0f else 1f
    coords.size = 1f
    val ev = MotionEvent.obtain(if (hover) now else downTime, now, action, 1, arrayOf(props), arrayOf(coords), 0, buttons, 1f, 1f, 0, 0, source, 0)
    try {
      if (hover) root.dispatchGenericMotionEvent(ev) else root.dispatchTouchEvent(ev)
    } finally {
      ev.recycle()
    }
    lastX = px
    lastY = py
  }

  private fun exitHover() {
    if (!hovering) return
    hovering = false
    sendPx(MotionEvent.ACTION_HOVER_EXIT, lastX, lastY, InputDevice.SOURCE_MOUSE, MotionEvent.TOOL_TYPE_MOUSE, 0)
  }

  override fun pointerMoved(x: Double, y: Double) {
    if (mouseDown) {
      send(MotionEvent.ACTION_MOVE, x, y, InputDevice.SOURCE_MOUSE, MotionEvent.TOOL_TYPE_MOUSE, MotionEvent.BUTTON_PRIMARY)
      return
    }
    send(if (hovering) MotionEvent.ACTION_HOVER_MOVE else MotionEvent.ACTION_HOVER_ENTER, x, y, InputDevice.SOURCE_MOUSE, MotionEvent.TOOL_TYPE_MOUSE, 0)
    hovering = true
  }

  override fun pointerExited() {
    // Always sent: after a press that cancelled a hover exit the pointer is still in (R15), with no hover of the runner's own.
    hovering = false
    sendPx(MotionEvent.ACTION_HOVER_EXIT, lastX, lastY, InputDevice.SOURCE_MOUSE, MotionEvent.TOOL_TYPE_MOUSE, 0)
    root.frameNow()
  }

  override fun hoverExitStarted() {
    exitHover()
  }

  override fun frame() {
    root.frameNow()
  }

  override fun mousePressed(x: Double, y: Double) {
    // R15: the platform ends the hover before it sends the button down.
    hoveredAtPress = hovering
    exitHover()
    send(MotionEvent.ACTION_DOWN, x, y, InputDevice.SOURCE_MOUSE, MotionEvent.TOOL_TYPE_MOUSE, MotionEvent.BUTTON_PRIMARY)
    mouseDown = true
  }

  override fun mouseReleased() {
    sendPx(MotionEvent.ACTION_UP, lastX, lastY, InputDevice.SOURCE_MOUSE, MotionEvent.TOOL_TYPE_MOUSE, 0)
    mouseDown = false
    // R15: and hovers again once the button is up.
    if (hoveredAtPress) {
      sendPx(MotionEvent.ACTION_HOVER_ENTER, lastX, lastY, InputDevice.SOURCE_MOUSE, MotionEvent.TOOL_TYPE_MOUSE, 0)
      hovering = true
    }
  }

  override fun touchPressed(x: Double, y: Double) {
    send(MotionEvent.ACTION_DOWN, x, y, InputDevice.SOURCE_TOUCHSCREEN, MotionEvent.TOOL_TYPE_FINGER, 0)
  }

  override fun touchReleased(x: Double, y: Double) {
    send(MotionEvent.ACTION_UP, x, y, InputDevice.SOURCE_TOUCHSCREEN, MotionEvent.TOOL_TYPE_FINGER, 0)
  }

  override fun touchCancelled() {
    sendPx(MotionEvent.ACTION_CANCEL, lastX, lastY, InputDevice.SOURCE_TOUCHSCREEN, MotionEvent.TOOL_TYPE_FINGER, 0)
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
    files.push({ path: 'kotlin/dev/dragon/host/DragonMotionInput.kt', text: `// GENERATED by @dragon/parity native-host.ts. Do not edit.\n${ANDROID_MOTION_INPUT}` });
    files.push({ path: 'kotlin/dev/dragon/host/DragonToolchain.kt', text: `// GENERATED by @dragon/parity native-host.ts. Do not edit.\npackage dev.dragon.host\n\nconst val DRAGON_TOOLCHAIN = ${JSON.stringify(toolchain)}\n` });
    files.push({ path: 'AndroidManifest.xml', text: androidManifest() });
  }
  const supportPlant = plant !== null && (SUPPORT_PLANTS as readonly string[]).includes(plant) ? (plant as SupportPlant) : null;
  files.push(...emitNativeSupport(backend, supportPlant));
  files.push(...(backend === 'uikit' ? emitUikitCases(cases) : emitAndroidViewsCases(cases)));
  // SELD-R1a: the state programs and their case scripts; ANIM-b1: the frame cases' state programs, animation tables and sample scripts.
  files.push(...emitStatePrograms(backend, [...stateEmits(target), ...animEmits(target)]));
  // SELD-R1b: the device-hit facts and runner.
  files.push(deviceHitSource(target));
  // SELD-R2 (T064 R14): the interaction programs and their device-traces scripts.
  files.push(...deviceTraceSources(target));
  if (plant !== null && supportPlant === null) files.push(PLANTED[plant as Exclude<BuildPlant, SupportPlant>]);
  // TXT1a-2 phase R: the HarfBuzz shim's wrapper, the host DragonShaper and the probe it is checked with.
  files.push(...shimSources(target));
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

/** Build options: a plant, and reuse, which takes the build from the machine-wide cache when its key is there (appCacheKey). */
export type BuildOptions = { readonly plant?: BuildPlant | null; readonly reuse?: boolean };

/** The build directory of a target: a planted build never overwrites the clean one. */
export const buildDir = (target: NativeTarget, plant: BuildPlant | null = null): string => (plant === null ? nativeOut(target) : join(nativeOut(target), `plant-${plant}`));

/** The source tree and the bundled Ahem.ttf the build copies beside it, so a font change forces a rebuild. */
export function reuseStamp(sourceSha256: string): string {
  return `${sourceSha256} ahem ${createHash('sha256').update(readFileSync(repoPath('vendor/fonts/Ahem.ttf'))).digest('hex')}`;
}

/**
 * An app build's commands as they run, each the tool then its arguments, with the build's own directory written $W and each
 * host path or machine fact a $TOKEN (expand). The commands are hashed as written, so the cache key covers every argument and,
 * through the file lists, the module each source builds in; a token's meaning is covered by the inputs hashed beside it.
 */
export type AppCommand = readonly string[];

/** A command with its tokens replaced: $W and each other $NAME by its value (an unknown token throws). */
export function expand(cmd: AppCommand, values: Readonly<Record<string, string>>): string[] {
  return cmd.map((a) =>
    a.replace(/\$([A-Z_]+)/g, (_m, name: string) => {
      const v = values[name];
      if (v === undefined) throw new Error(`no value for $${name} in ${JSON.stringify(a)}`);
      return v;
    }),
  );
}

/**
 * The cache key of an app build: the source tree and Ahem (reuseStamp), every command exactly as it runs (expand's tokens aside),
 * the inputs those tokens stand for (tool versions and the content of the jars and keystore the commands read), and the host.
 */
export function appCacheKey(sourceSha256: string, commands: readonly AppCommand[], inputs: Readonly<Record<string, string>>): string {
  const sorted = Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return createHash('sha256').update(JSON.stringify({ stamp: reuseStamp(sourceSha256), commands, inputs: sorted, host: `${process.platform}-${process.arch}` })).digest('hex').slice(0, 24);
}

const fileSha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

/** The built shim libraries' sha256 as cache-key inputs, so a rebuilt shim forces a rebuilt app. */
const shimInputs = (sha256: Readonly<Record<string, string>>): Record<string, string> => Object.fromEntries(Object.entries(sha256).map(([t, s]) => [`shim ${t}`, s]));

/**
 * Builds an app into the machine-wide cache (#158's, kind ios-app or apk) unless its key is there: in a work directory beside the
 * entry, published by one rename, so a hit is always a whole build, shared by every worktree; the sources and intermediates are
 * removed before publishing, leaving only `keep`. With reuse off the build always runs and replaces the entry. A failed command removes the work directory and throws its output.
 */
function cachedApp(kind: 'ios-app' | 'apk', key: string, artifact: string, complete: (dir: string) => boolean, reuse: boolean, build: (work: string, log: string[]) => void, keep: readonly string[]): { readonly dir: string; readonly log: string[] } {
  const dir = join(BUILD_CACHE, kind, key);
  if (reuse && complete(dir) && hit(dir, join(dir, artifact))) return { dir, log: [`cached ${dir} (key ${key})`] };
  const work = `${dir}.build-${process.pid}`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const log: string[] = [];
  try {
    build(work, log);
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    throw e;
  }
  for (const n of readdirSync(work)) if (!keep.includes(n)) rmSync(join(work, n), { recursive: true, force: true });
  // A forced rebuild (reuse off) replaces the entry, so it repairs a damaged one; otherwise an equal entry already there is kept.
  if (reuse) publish(work, dir);
  else replace(work, dir);
  pruneCache(BUILD_CACHE, dir);
  log.push(`published ${dir} (key ${key})`);
  return { dir, log };
}

/** The case tables stay in DragonHost: main.swift reads DragonHost.dragonCaseTable. */
const IOS_TABLES = ['Cases/DragonCaseTable.swift', 'Cases/DragonStateCaseTable.swift', 'Cases/DragonInteractionCaseTable.swift'];

/**
 * The Swift files of each iOS module, by path; every file in exactly one, and none of the three empty (else a thrown error). The
 * engine and runtime support (DragonCore) build at -O; the generated case code (DragonCases, 18 MB of straight-line LayoutBox
 * construction that -O gains nothing on, checked by casesCodeProblems) at -Onone; the host (main, the hit facts, the case tables
 * and any planted file) at -O in the app's own module, DragonHost, which Info.plist and main.swift name. Swift has no fast-math,
 * so no float result depends on the optimisation level.
 */
export function iosModules(paths: readonly string[]): { readonly core: string[]; readonly cases: string[]; readonly host: string[] } {
  const swift = paths.filter((p) => p.endsWith('.swift'));
  const core = swift.filter((p) => p.startsWith('DragonLayout/') || p.startsWith('Support/'));
  const cases = swift.filter((p) => p.startsWith('Cases/') && !IOS_TABLES.includes(p));
  const host = swift.filter((p) => !core.includes(p) && !cases.includes(p));
  for (const t of IOS_TABLES) if (!host.includes(t)) throw new Error(`the iOS host sources have no ${t}`);
  if (core.length === 0 || cases.length === 0 || !host.includes('Host/main.swift')) throw new Error(`the iOS host sources do not split into DragonCore (${core.length}), DragonCases (${cases.length}) and DragonHost with main.swift`);
  return { core, cases, host };
}

/**
 * Why a DragonCases source is not straight-line construction code, which is all -Onone may build: a control flow statement, a
 * ternary (the typed state setters' Bool encoding `v ? <int> : <int>` aside, whose numbers follow the fixture's value order), assert, precondition or fatalError, outside string literals
 * and comments. An enum's `case` is a declaration, so it is allowed; a `switch` is not. Empty when the source is construction only.
 */
export function casesCodeProblems(path: string, text: string): string[] {
  const code = text.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/\/\/[^\n]*/g, '').replace(/\bv \? \d+ : \d+\b/g, 'v');
  const words = [...code.matchAll(/\b(if|guard|else|while|for|repeat|switch|break|continue|fallthrough|throw|try|defer|assert|assertionFailure|precondition|preconditionFailure|fatalError)\b/g)].map((m) => `\`${m[1] as string}\``);
  const ternary = / \? [^\n]*? : /.test(code) ? ['a ternary'] : [];
  return [...new Set([...words, ...ternary])].map((w) => `${path}: ${w} in code built at -Onone (DragonCases holds construction code only)`);
}

/** The iOS app's build commands for its source paths ($CORES is the -j width, which changes no output). */
export function iosCommands(paths: readonly string[]): AppCommand[] {
  const mods = iosModules(paths);
  const src = (ps: readonly string[]): string[] => ps.map((p) => `$W/src/${p}`);
  // -I: DragonCore's shim wrapper imports CDragonHB, a module map over dragon_hb.h, which every module importing DragonCore must find.
  const swiftc = ['xcrun', '-sdk', 'iphonesimulator', 'swiftc', '-target', IOS_TARGET, '-j', '$CORES', '-I', '$SHIM_SWIFT_INCLUDE'];
  const implicit = (flag: string, mod: string): string[] => ['-Xfrontend', flag, '-Xfrontend', mod];
  const library = (name: string, opt: string, extra: readonly string[], sources: readonly string[]): string[] => [...swiftc, opt, ...extra, '-parse-as-library', '-module-name', name, '-I', '$W/modules', '-emit-module', '-emit-module-path', `$W/modules/${name}.swiftmodule`, '-emit-library', '-static', '-o', `$W/modules/lib${name}.a`, ...src(sources)];
  // -force_load links every object of both libraries, as one module did, whether or not the host names it.
  const load = (name: string): string[] => ['-Xlinker', '-force_load', '-Xlinker', `$W/modules/lib${name}.a`];
  return [
    library('DragonCore', '-O', [], mods.core),
    // -enable-testing: DragonHost's case tables read the cases' internal declarations through a testable import.
    library('DragonCases', '-Onone', ['-enable-testing', ...implicit('-import-module', 'DragonCore')], mods.cases),
    [...swiftc, '-O', '-module-name', 'DragonHost', '-I', '$W/modules', ...implicit('-import-module', 'DragonCore'), ...implicit('-testable-import-module', 'DragonCases'), ...load('DragonCore'), ...load('DragonCases'), '-L', '$SHIM_IOS_LIB', '-ldragon_hb', '-lc++', '-o', '$W/DragonHost.app/DragonHost', ...src(mods.host)],
    ['cp', '$W/src/Info.plist', '$W/DragonHost.app/Info.plist'],
    ['cp', '$AHEM', '$W/DragonHost.app/Ahem.ttf'],
    ['codesign', '--force', '--sign', '-', '--timestamp=none', '$W/DragonHost.app'],
  ];
}

const ms = (t0: number): string => ((Date.now() - t0) / 1000).toFixed(1);

/** The iOS host app: swiftc for the iOS 15 simulator target (three modules, iosCommands), Info.plist and Ahem, ad-hoc signed. */
export function buildIos(opts: BuildOptions = {}): BuildResult {
  const toolchain = xcodeVersion();
  const files = hostSources('ios', toolchain, opts.plant ?? null);
  const sha = sourceTreeSha256(files);
  const commands = iosCommands(files.map((f) => f.path));
  const cases = new Set(iosModules(files.map((f) => f.path)).cases);
  const notConstruction = files.filter((f) => cases.has(f.path)).flatMap((f) => casesCodeProblems(f.path, f.text));
  if (notConstruction.length > 0) throw new Error(`the iOS case code is built at -Onone, so it must be construction code only:\n  ${notConstruction.slice(0, 20).join('\n  ')}`);
  // The Xcode version is in the sources (DragonToolchain.swift); the simulator SDK and swiftc are named here.
  const shim = buildShim('ios');
  const inputs = { sdk: must(run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']), 'xcrun --show-sdk-version').trim(), swiftc: must(run('xcrun', ['-sdk', 'iphonesimulator', 'swiftc', '-version']), 'swiftc -version').trim(), ...shimInputs(shim.sha256), 'shim module map': shimModuleMapSha256() };
  const key = appCacheKey(sha, commands, inputs);
  const { dir, log } = cachedApp('ios-app', key, 'DragonHost.app/DragonHost', (d) => existsSync(join(d, 'DragonHost.app', 'Info.plist')), opts.reuse === true, (work, out) => {
    writeSources(work, files);
    mkdirSync(join(work, 'modules'), { recursive: true });
    mkdirSync(join(work, 'DragonHost.app'), { recursive: true });
    const values = { W: work, CORES: String(availableParallelism()), AHEM: repoPath('vendor/fonts/Ahem.ttf'), SHIM_SWIFT_INCLUDE, ...shim.files };
    const names = ['swiftc DragonCore -O', 'swiftc DragonCases -Onone', 'swiftc DragonHost -O', 'Info.plist', 'Ahem.ttf', 'codesign --sign - (ad hoc)'];
    for (const [i, c] of commands.entries()) {
      const t0 = Date.now();
      const [cmd, ...args] = expand(c, values);
      must(run(cmd as string, args, { timeoutMs: 1_800_000 }), `${names[i]} (iOS 15 simulator)`);
      out.push(`${names[i]}: ${ms(t0)} s`);
    }
  }, ['DragonHost.app']);
  return { target: 'ios', cases: emitCases('ios').length, sourceSha256: sha, artifact: join(dir, 'DragonHost.app'), log: [shim.log, ...log] };
}

/** The Android APK's build commands for its Kotlin source paths (tokens: the SDK tools, the jars, the keystore and Ahem). */
export function androidCommands(ktPaths: readonly string[]): AppCommand[] {
  return [
    ['mkdir', '-p', '$W/assets/fonts', '$W/dex', ...SHIM_ANDROID_ABIS.map((abi) => `$W/lib/${abi}`)],
    ['cp', '$AHEM', '$W/assets/fonts/Ahem.ttf'],
    ...SHIM_ANDROID_ABIS.map((abi) => ['cp', `$${shimToken(abi)}`, `$W/lib/${abi}/libdragon_hb.so`]),
    ['$BT/aapt2', 'link', '--manifest', '$W/src/AndroidManifest.xml', '-I', '$ANDROID_JAR', '-A', '$W/assets', '--min-sdk-version', String(NATIVE_CONFIG.android.minSdk), '--target-sdk-version', String(ANDROID_TARGET_SDK), '-o', '$W/base.apk'],
    ['$KOTLINC', '-J-Xmx8g', '-cp', '$ANDROID_JAR', '-jvm-target', '1.8', '-nowarn', '-d', '$W/classes.jar', ...ktPaths.map((p) => `$W/src/${p}`)],
    ['$BT/d8', '--release', '--min-api', String(NATIVE_CONFIG.android.minSdk), '--lib', '$ANDROID_JAR', '--output', '$W/dex', '$W/classes.jar', '$KOTLIN_STDLIB'],
    // The dex files in name order (C locale), added at the APK's root.
    ['sh', '-c', 'cd "$W/dex" && LC_ALL=C zip -q -j ../base.apk classes*.dex'],
    // The shim per ABI, stored uncompressed under lib/<abi>/ (zipalign -p page-aligns it), loaded by System.loadLibrary.
    ['sh', '-c', `cd "$W" && zip -q -0 base.apk ${SHIM_ANDROID_ABIS.map((abi) => `lib/${abi}/libdragon_hb.so`).join(' ')}`],
    ['$BT/zipalign', '-p', '-f', '4', '$W/base.apk', '$W/aligned.apk'],
    ['$BT/apksigner', 'sign', '--ks', '$KEYSTORE', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'dragondebug', '--out', '$W/DragonHost.apk', '$W/aligned.apk'],
  ];
}

/** The debug keystore every APK is signed with: one per machine, beside the cache, made once (a concurrent maker's is kept). */
function debugKeystore(tools: AndroidTools, env: NodeJS.ProcessEnv): string {
  const keystore = join(BUILD_CACHE, 'debug.keystore');
  if (existsSync(keystore)) return keystore;
  mkdirSync(BUILD_CACHE, { recursive: true });
  const tmp = `${keystore}.${process.pid}`;
  rmSync(tmp, { force: true });
  must(run(join(tools.javaHome, 'bin', 'keytool'), ['-genkeypair', '-keystore', tmp, '-storepass', 'android', '-keypass', 'android', '-alias', 'dragondebug', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Dragon Debug,O=Dragon,C=US'], { env }), 'keytool');
  try {
    linkSync(tmp, keystore);
  } catch (e) {
    if (!existsSync(keystore)) throw new Error(`could not place the debug keystore at ${keystore}: ${(e as Error).message}`);
  } finally {
    rmSync(tmp, { force: true });
  }
  return keystore;
}

/** The Android host APK from the SDK tools alone: aapt2 link, kotlinc against android.jar, d8 --min-api 31, zipalign, apksigner. */
export function buildAndroid(opts: BuildOptions = {}): BuildResult & { readonly dexes: readonly string[]; readonly tools: AndroidTools } {
  const tools = androidTools();
  const kotlinVersion = must(run(tools.kotlinc, ['-version']), 'kotlinc -version').trim().split('\n').pop() ?? '';
  const toolchain = `${kotlinVersion.replace(/^info:\s*/, '')}; d8 and aapt2 ${ANDROID_BUILD_TOOLS}; android-${ANDROID_TARGET_SDK}.jar; no Gradle`;
  const files = hostSources('android', toolchain, opts.plant ?? null);
  const sha = sourceTreeSha256(files);
  const env = { ...process.env, JAVA_HOME: tools.javaHome, PATH: `${join(tools.javaHome, 'bin')}:${process.env['PATH'] ?? ''}` };
  const keystore = debugKeystore(tools, env);
  const commands = androidCommands(files.filter((f) => f.path.endsWith('.kt')).map((f) => f.path));
  // kotlinc, the build tools and android.jar's level are in the sources (DragonToolchain.kt); the bytes each token stands for are here.
  const shim = buildShim('android');
  const inputs = { buildTools: tools.buildTools.split('/').pop() ?? '', androidJar: fileSha(tools.androidJar), kotlinStdlib: fileSha(tools.kotlinStdlib), keystore: fileSha(keystore), java: must(run(join(tools.javaHome, 'bin', 'java'), ['-version']), 'java -version').trim(), ...shimInputs(shim.sha256) };
  const key = appCacheKey(sha, commands, inputs);
  const dexesOf = (d: string): string[] => (existsSync(join(d, 'dex')) ? readdirSync(join(d, 'dex')).filter((f) => /^classes\d*\.dex$/.test(f)).sort().map((x) => join(d, 'dex', x)) : []);
  const { dir, log } = cachedApp('apk', key, 'DragonHost.apk', (d) => dexesOf(d).length > 0, opts.reuse === true, (work, out) => {
    writeSources(work, files);
    const values = { W: work, AHEM: repoPath('vendor/fonts/Ahem.ttf'), BT: tools.buildTools, ANDROID_JAR: tools.androidJar, KOTLINC: tools.kotlinc, KOTLIN_STDLIB: tools.kotlinStdlib, KEYSTORE: keystore, ...shim.files };
    const names = ['mkdir', 'Ahem.ttf', ...SHIM_ANDROID_ABIS.map((abi) => `libdragon_hb.so (${abi})`), 'aapt2 link', 'kotlinc', 'd8', 'zip classes.dex', 'zip libdragon_hb.so', 'zipalign', 'apksigner sign'];
    for (const [i, c] of commands.entries()) {
      const t0 = Date.now();
      const [cmd, ...args] = expand(c, values);
      must(run(cmd as string, args, { env, timeoutMs: 1_800_000 }), names[i] as string);
      out.push(`${names[i]}: ${ms(t0)} s`);
    }
  }, ['DragonHost.apk', 'dex']);
  return { target: 'android', cases: emitCases('android').length, sourceSha256: sha, artifact: join(dir, 'DragonHost.apk'), log: [shim.log, ...log], dexes: dexesOf(dir), tools };
}

// ---------------------------------------------------------------- dump encoders on the host

/**
 * Every layout case's reference dump (TS engine plus snapRect) at a DPR, re-labelled to the target's device lane with deterministic
 * non-null pixels, timing, line baseline, start and end, the expected digest and the expected applied values of the target's
 * backend, so every field kind of the schema is encoded.
 */
export function relabelledReferenceDumps(target: NativeTarget, dpr: number): NativeDump[] {
  const backend = BACKEND_OF[target];
  return nativeCases().map((n) => relabelledReferenceDump(target, { id: n.case.id, fixture: n.spec.id, direction: n.case.environment.direction, compilerDigest: n.compiled.digest, viewport: n.case.environment.viewport, program: n.programs[backend] }, dpr));
}

/** One program's relabelled reference dump (relabelledReferenceDumps) under a case id: a layout case's, or a frame sample's (device-anim). */
export function relabelledReferenceDump(target: NativeTarget, c: { readonly id: string; readonly fixture: string; readonly direction: 'ltr' | 'rtl'; readonly compilerDigest: string; readonly viewport: { readonly width: number; readonly height: number }; readonly program: NativeProgram }, dpr: number): NativeDump {
  const { program, viewport } = c;
  const input = programInput(program, viewport, dpr);
  const engine = engineBoxes(program, viewport, dpr);
  const ref = referenceDump({ platform: target, caseId: c.id, fixture: c.fixture, dpr, direction: c.direction, compilerDigest: c.compilerDigest, input, engine });
  const e = expectedDump(program, c.id, viewport, dpr, expectedEngine());
  const applied = new Map(e.nodes.map((x) => [x.id, x.applied]));
  const sha = createHash('sha256').update(c.id).digest('hex');
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

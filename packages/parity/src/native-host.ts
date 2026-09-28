// The native host apps (notes/T013-p3-review-p4-plan.md section 2 items 6, 9 and 10): one derive-mode native compile per fixture and
// direction, the generated Swift and Kotlin sources for every layout case, the iOS app built with swiftc and the Android APK built
// from the SDK tools alone (aapt2, kotlinc, d8, zipalign, apksigner; no Gradle, AGP or androidx), and the smoke run helpers.
// Build output goes to the gitignored packages/parity/out/native/<target>/; nothing native is committed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import type { LayoutInput, LayoutRect } from '@dragon/layout';
import { layout, measurerFor } from '@dragon/layout';
import type { Compiled, EmitCase, Environment, GeneratedFile, NativeBackend, NativeProgram } from 'dragon';
import { createProjectWith, emitAndroidViewsCases, emitNativeSupport, emitUikitCases, expectedDigest, expectedDump, nativePrograms, NO_FAULTS, programInput } from 'dragon';
import type { ParityCase } from './cases.ts';
import { fixtureInput } from './cases.ts';
import { layoutCases } from './dpr.ts';
import { PROJECT_ID } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { encoderSource } from './native-encoders.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import type { NativeTarget } from './targets.ts';
import { deviceDprs } from './targets.ts';

export const BACKEND_OF: { readonly [T in NativeTarget]: NativeBackend } = { ios: 'uikit', android: 'android-views' };
export const NATIVE_CONFIG = { ios: { minimum: '15.0' }, android: { minSdk: 29 } } as const;
export const ANDROID_TARGET_SDK = 36;
export const ANDROID_BUILD_TOOLS = '36.0.0';
export const IOS_TARGET = 'arm64-apple-ios15.0-simulator';
export const HOST_BUNDLE = 'dev.dragon.host';

export const nativeOut = (target: NativeTarget): string => repoPath(`packages/parity/out/native/${target}`);

// ---------------------------------------------------------------- the native generation compile

/** The lane compile (item 9): ios and android together, derive mode, one per fixture and direction. */
export function nativeCompile(spec: FixtureSpec, direction: Environment['direction']): Compiled<'ios' | 'android'> {
  if (spec.kind !== 'layout') throw new Error(`${spec.id} is not a layout fixture`);
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG } }, { faults: NO_FAULTS, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: spec.rootFont });
  return project.compile(fixtureInput(spec));
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

export function referenceMeasurer() {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  return m.measurer;
}

/** The emitter view of every case for a target, with the expected-dump digests at the target's device DPRs. */
export function emitCases(target: NativeTarget): EmitCase[] {
  const backend = BACKEND_OF[target];
  const m = referenceMeasurer();
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

/// Runs the cases named by --dragon-cases at the screen's own scale and writes one dump per case into DRAGON_OUT.
func dragonRun(window: UIWindow, host: UIView) {
  UIView.setAnimationsEnabled(false)
  let env = ProcessInfo.processInfo.environment
  guard let out = env["DRAGON_OUT"] else { fatalError("dragon host: DRAGON_OUT is not set") }
  let ids = (dragonArgument("--dragon-cases") ?? "").split(separator: ",").map(String.init)
  let bridge = DragonBridge.shared
  dragonWrite(out + "/bridge-ios.json", bridge.record(platform: "ios"))
  let scale = Double(window.screen.scale)
  if Double(window.traitCollection.displayScale) != scale { fatalError("dragon host: traitCollection.displayScale differs from UIScreen.scale") }
  #if arch(arm64)
  let abi = "arm64"
  #else
  let abi = "x86_64"
  #endif
  let device = DumpDevice(platform: "ios", os: ProcessInfo.processInfo.operatingSystemVersionString, model: env["SIMULATOR_DEVICE_NAME"] ?? UIDevice.current.model, abi: abi, scale: scale, toolchain: dragonToolchain, renderer: "simulator-metal")
  for id in ids {
    guard let c = dragonCaseTable[id] else { fatalError("dragon host: no case \(id)") }
    let tree = DragonTree()
    c.build(tree)
    host.addSubview(tree.root)
    let t0 = CACurrentMediaTime()
    do {
      try tree.apply(c.input(scale), measurer: bridge.measurer, scale: scale, fontFor: { bridge.font(pointSize: CGFloat($0)) })
    } catch {
      fatalError("dragon host: \(id): \(error)")
    }
    host.layoutIfNeeded()
    tree.root.layoutIfNeeded()
    CATransaction.flush()
    let t1 = CACurrentMediaTime()
    let pixels = dragonCapture(tree.root, scale: scale, points: [])
    let t2 = CACurrentMediaTime()
    let dump = tree.dump(c, scale: scale, device: device, pixels: pixels, timing: DumpTiming(settleMs: (t1 - t0) * 1000, dumpMs: (CACurrentMediaTime() - t2) * 1000))
    dragonWrite(out + "/" + id + "@" + DumpJsonWriter.format(scale) + ".json", dumpJson(dump))
    tree.root.removeFromSuperview()
  }
  dragonWrite(out + "/done-ios", "ok")
  exit(0)
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
import android.widget.FrameLayout
import dev.dragon.cases.dragonCaseTable
import dev.dragon.dump.DumpDevice
import dev.dragon.dump.DumpJsonWriter
import dev.dragon.dump.DumpPixels
import dev.dragon.dump.DumpTiming
import dev.dragon.dump.dumpJson
import dev.dragon.views.DragonBridge
import dev.dragon.views.DragonTree
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest

/** Runs the cases named by the dragon.cases extra at the display density and writes one dump per case to the app's files. */
class DragonActivity : Activity() {
  private val frame by lazy { FrameLayout(this) }
  private var ids: List<String> = emptyList()
  private lateinit var out: File
  private lateinit var bridge: DragonBridge
  private lateinit var device: DumpDevice
  private var scale = 0.0

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    frame.setBackgroundColor(0xffffffff.toInt())
    setContentView(frame)
    ids = (intent.getStringExtra("dragon.cases") ?: "").split(",").filter { it.isNotEmpty() }
    out = getExternalFilesDir(null) ?: throw IllegalStateException("dragon host: no external files dir")
    File(out, "done-android").delete()
    bridge = DragonBridge.shared(this)
    File(out, "bridge-android.json").writeText(bridge.record("android"))
    scale = resources.displayMetrics.density.toDouble()
    val os = "Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ", " + Build.ID + ")"
    val model = Build.MODEL + " / " + (intent.getStringExtra("dragon.model") ?: "unnamed")
    device = DumpDevice("android", os, model, Build.SUPPORTED_ABIS[0], scale, DRAGON_TOOLCHAIN, intent.getStringExtra("dragon.renderer") ?: "unknown")
    frame.post { runCase(0) }
  }

  private fun runCase(k: Int) {
    if (k >= ids.size) {
      File(out, "done-android").writeText("ok")
      finish()
      return
    }
    val id = ids[k]
    val c = dragonCaseTable[id] ?: throw IllegalStateException("dragon host: no case " + id)
    val tree = DragonTree(this)
    c.build(tree)
    val t0 = SystemClock.elapsedRealtimeNanos()
    tree.apply(c.input(scale), bridge.measurer, scale, bridge)
    frame.addView(tree.root, FrameLayout.LayoutParams(tree.root.dragonFrame[2], tree.root.dragonFrame[3]))
    // Settle on explicit signals: two frame callbacks after the tree is attached, then a compositor copy of the window.
    Choreographer.getInstance().postFrameCallback {
      Choreographer.getInstance().postFrameCallback {
        val t1 = SystemClock.elapsedRealtimeNanos()
        val at = IntArray(2)
        tree.root.getLocationInWindow(at)
        val w = tree.root.width
        val h = tree.root.height
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        PixelCopy.request(window, Rect(at[0], at[1], at[0] + w, at[1] + h), bitmap, { result ->
          if (result != PixelCopy.SUCCESS) throw IllegalStateException("dragon host: PixelCopy failed with " + result)
          val t2 = SystemClock.elapsedRealtimeNanos()
          val buf = ByteBuffer.allocate(w * h * 4)
          bitmap.copyPixelsToBuffer(buf)
          val bytes = buf.array()
          val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { String.format("%02x", it.toInt() and 0xff) }
          val pixels = DumpPixels("PixelCopy", w.toDouble(), h.toDouble(), sha, emptyList())
          val dump = tree.dump(c, scale, device, pixels, DumpTiming((t1 - t0) / 1e6, (SystemClock.elapsedRealtimeNanos() - t2) / 1e6))
          File(out, id + "@" + DumpJsonWriter.format(scale) + ".json").writeText(dumpJson(dump))
          frame.removeView(tree.root)
          frame.post { runCase(k + 1) }
        }, Handler(Looper.getMainLooper()))
      }
    }
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

/** Faults planted in a host build: an API above the floor on either platform. */
export type BuildPlant = 'ios-16' | 'api-30';
const PLANTED: { readonly [P in BuildPlant]: GeneratedFile } = {
  'ios-16': { path: 'Host/DragonPlanted.swift', text: 'import UIKit\n\n/// Planted floor fault: UICalendarView is iOS 16 only.\nfunc dragonPlantedIos16() -> UIView { return UICalendarView() }\n' },
  'api-30': { path: 'kotlin/dev/dragon/host/DragonPlanted.kt', text: 'package dev.dragon.host\n\n/** Planted floor fault: Context.getDisplay is API 30. */\nfun dragonPlantedApi30(c: android.content.Context): Any? = c.display\n' },
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
  files.push(...emitNativeSupport(backend));
  files.push(...(backend === 'uikit' ? emitUikitCases(cases) : emitAndroidViewsCases(cases)));
  if (plant !== null) files.push(PLANTED[plant]);
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

/** The iOS host app: swiftc for the iOS 15 simulator target with -O, Info.plist and Ahem, ad-hoc signed. */
export function buildIos(opts: { plant?: BuildPlant | null } = {}): BuildResult {
  const dir = nativeOut('ios');
  const toolchain = xcodeVersion();
  const files = hostSources('ios', toolchain, opts.plant ?? null);
  const src = writeSources(dir, files);
  const app = join(dir, 'build', 'DragonHost.app');
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
  return { target: 'ios', cases: emitCases('ios').length, sourceSha256: sourceTreeSha256(files), artifact: app, log };
}

/** The Android host APK from the SDK tools alone: aapt2 link, kotlinc against android.jar, d8 --min-api 29, zipalign, apksigner. */
export function buildAndroid(opts: { plant?: BuildPlant | null } = {}): BuildResult & { readonly dexes: readonly string[]; readonly tools: AndroidTools } {
  const tools = androidTools();
  const dir = nativeOut('android');
  const kotlinVersion = must(run(tools.kotlinc, ['-version']), 'kotlinc -version').trim().split('\n').pop() ?? '';
  const toolchain = `${kotlinVersion.replace(/^info:\s*/, '')}; d8 and aapt2 ${ANDROID_BUILD_TOOLS}; android-${ANDROID_TARGET_SDK}.jar; no Gradle`;
  const files = hostSources('android', toolchain, opts.plant ?? null);
  const src = writeSources(dir, files);
  const build = join(dir, 'build');
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
  const apk = join(build, 'DragonHost.apk');
  must(run(bt('apksigner'), ['sign', '--ks', keystore, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'dragondebug', '--out', apk, aligned], { env }), 'apksigner sign');
  log.push('zipalign -p 4; apksigner sign with a debug key generated under out/');
  return { target: 'android', cases: emitCases('android').length, sourceSha256: sourceTreeSha256(files), artifact: apk, log, dexes: dexes.map((d) => join(build, 'dex', d)), tools };
}

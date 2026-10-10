// The HarfBuzz shim in the host apps (TXT1a-2 phase R, notes/T056-txt1a-spec.md R1, R3 and R8): dragon_hb built by zig for the
// iOS simulator and Android ABIs and linked into the apps, its Swift and Kotlin wrappers (packages/text-shaper swift/ and kotlin/)
// compiled in, and a host DragonShaper that checks every bundled face's sha256 before the shim reads it. Before any case runs, the
// app shapes the probe below on the device's shim and stops unless every integer equals the host's WASM shim.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AHEM_SHA256, coveredCodePoints, FEATURE_STRIDE } from '@dragon/layout';
import type { GeneratedFile } from 'dragon';
import { repoPath } from './paths.ts';
import { ahemFaceId, hostShaper, REFERENCE_LANGUAGE } from './text-shaper-host.ts';

/** The Zig release build.zig is written for (build.zig.zon minimum_zig_version), and the NDK whose sysroot the Android build links. */
export const SHIM_ZIG = '0.16.0';
export const SHIM_NDK = '27.2.12479018';
export const SHIM_ANDROID_ABIS = ['arm64-v8a', 'x86_64'] as const;

const SHAPER_DIR = repoPath('packages/text-shaper');
/** The module map over dragon_hb.h that the Swift wrapper imports (CDragonHB). */
export const SHIM_SWIFT_INCLUDE = join(SHAPER_DIR, 'swift', 'Sources', 'CDragonHB');
/** The module map's sha256, a cache-key input: its link lines decide what the app links, and the commands hold only its directory. */
export const shimModuleMapSha256 = (): string => fileSha(join(SHIM_SWIFT_INCLUDE, 'module.modulemap'));

type Spawned = { readonly status: number; readonly out: string };
function spawn(cmd: string, args: readonly string[], cwd?: string): Spawned {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000 });
  return { status: r.status ?? (r.error === undefined ? 1 : 127), out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error === undefined ? '' : String(r.error)}` };
}

/** zig on PATH at SHIM_ZIG; throws naming what is wrong (a tooling fault, never a pass). */
export function zigTool(): string {
  const v = spawn('zig', ['version']);
  if (v.status !== 0) throw new Error(`zig is not on PATH (the device apps link dragon_hb, built with Zig ${SHIM_ZIG}): ${v.out.trim()}`);
  if (v.out.trim() !== SHIM_ZIG) throw new Error(`zig is ${v.out.trim()}, but dragon_hb is built with Zig ${SHIM_ZIG}`);
  return 'zig';
}

/** The NDK at SHIM_NDK: ANDROID_NDK_HOME, else ANDROID_HOME/ndk/SHIM_NDK, checked by its source.properties revision. */
export function androidNdk(env: NodeJS.ProcessEnv = process.env): string {
  const given = env['ANDROID_NDK_HOME'];
  const home = env['ANDROID_HOME'];
  const ndk = given !== undefined && given !== '' ? given : home !== undefined && home !== '' ? join(home, 'ndk', SHIM_NDK) : null;
  if (ndk === null) throw new Error(`no NDK: set ANDROID_NDK_HOME, or install ndk;${SHIM_NDK} under ANDROID_HOME`);
  const props = join(ndk, 'source.properties');
  if (!existsSync(props)) throw new Error(`no NDK at ${ndk} (no source.properties)`);
  const revision = /^Pkg\.Revision\s*=\s*(\S+)\s*$/m.exec(readFileSync(props, 'utf8'))?.[1];
  if (revision !== SHIM_NDK) throw new Error(`the NDK at ${ndk} is ${revision ?? 'of no revision'}, but dragon_hb links NDK ${SHIM_NDK}`);
  return ndk;
}

/** The command token an Android ABI's built library stands under (native-host.ts androidCommands; expand's tokens have no digits). */
export const shimToken = (abi: (typeof SHIM_ANDROID_ABIS)[number]): string => ({ 'arm64-v8a': 'SHIM_ANDROID_ARM', x86_64: 'SHIM_ANDROID_INTEL' })[abi];

function fileSha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** A built shim: the library files an app links, and their sha256 (the app cache key reads them). */
export type ShimBuild = { readonly files: Readonly<Record<string, string>>; readonly sha256: Readonly<Record<string, string>>; readonly log: string };

/**
 * Builds dragon_hb for a target with zig build (its own cache makes a repeat build cheap): the iOS simulator's static library, or
 * libdragon_hb.so per Android ABI. A failed or incomplete build throws.
 */
export function buildShim(target: 'ios' | 'android'): ShimBuild {
  const zig = zigTool();
  const args = target === 'ios' ? ['build', 'ios'] : ['build', 'android', `-Dandroid-ndk=${androidNdk()}`];
  const r = spawn(zig, args, SHAPER_DIR);
  if (r.status !== 0) throw new Error(`zig ${args.join(' ')} failed (exit ${r.status}):\n${r.out.slice(-6000)}`);
  const out = join(SHAPER_DIR, 'zig-out');
  const files: Record<string, string> =
    target === 'ios' ? { SHIM_IOS_LIB: join(out, 'ios', 'ios-arm64-simulator') } : Object.fromEntries(SHIM_ANDROID_ABIS.map((abi) => [shimToken(abi), join(out, 'android', abi, 'libdragon_hb.so')]));
  const sha256: Record<string, string> = {};
  for (const [token, p] of Object.entries(files)) {
    const lib = target === 'ios' ? join(p, 'libdragon_hb.a') : p;
    if (!existsSync(lib)) throw new Error(`zig ${args.join(' ')} left no ${lib}`);
    sha256[token] = fileSha(lib);
  }
  return { files, sha256, log: `zig ${args.join(' ')}: ${Object.entries(sha256).map(([t, s]) => `${t} ${s.slice(0, 16)}`).join(', ')}` };
}

// ---------------------------------------------------------------- the probe

/** One shape call of the probe, with the integers the host's WASM shim returns for it (stride 7, 16.16 positions). */
export type ShimProbe = { readonly face: string; readonly size: number; readonly text: string; readonly script: string; readonly rtl: boolean; readonly language: string; readonly features: readonly number[]; readonly glyphs: readonly number[] };

const tagInt = (t: string): number => ((t.charCodeAt(0) << 24) | (t.charCodeAt(1) << 16) | (t.charCodeAt(2) << 8) | t.charCodeAt(3)) >>> 0;

/**
 * The bundled Ahem's covered code points (the default-ignorable U+200B among them) at a whole, a fractional and the unitsPerEm
 * size, right to left, and with kerning turned off by a feature record, shaped by the host's WASM shim.
 */
export function shimProbe(): readonly ShimProbe[] {
  const face = ahemFaceId();
  const text = String.fromCodePoint(...coveredCodePoints());
  const calls: readonly Omit<ShimProbe, 'glyphs'>[] = [
    { face, size: 16, text, script: 'Latn', rtl: false, language: REFERENCE_LANGUAGE, features: [] },
    { face, size: 13.37, text, script: 'Latn', rtl: false, language: REFERENCE_LANGUAGE, features: [] },
    { face, size: 1000, text, script: 'Latn', rtl: false, language: REFERENCE_LANGUAGE, features: [] },
    { face, size: 16, text, script: 'Latn', rtl: true, language: REFERENCE_LANGUAGE, features: [] },
    { face, size: 16, text, script: 'Latn', rtl: false, language: REFERENCE_LANGUAGE, features: [tagInt('kern'), 0, 0, text.length] },
  ];
  return calls.map((c) => {
    if (c.features.length % FEATURE_STRIDE !== 0) throw new Error(`a probe's features are not whole records of ${FEATURE_STRIDE}`);
    const glyphs = hostShaper.shape(c.face, c.size, c.text, 0, c.text.length, c.script, c.rtl, c.language, c.features);
    if (glyphs.length === 0 || glyphs.length % 7 !== 0) throw new Error(`the host shim gave ${glyphs.length} integers for a probe of ${c.text.length} code units`);
    return { ...c, glyphs: [...glyphs] };
  });
}

/** The faces the host app bundles, by face id: the file the app reads and the sha256 the shim must see. */
const SHIM_FACES = [{ id: 'Ahem', iosFile: 'Ahem.ttf', androidAsset: 'fonts/Ahem.ttf', sha256: AHEM_SHA256 }] as const;

const swiftString = (s: string): string => `"${[...s].map((ch) => { const cp = ch.codePointAt(0) as number; return cp >= 0x20 && cp < 0x7f && ch !== '"' && ch !== '\\' ? ch : `\\u{${cp.toString(16)}}`; }).join('')}"`;
const kotlinString = (s: string): string => `"${Array.from({ length: s.length }, (_x, i) => { const u = s.charCodeAt(i); const ch = s[i] as string; return u >= 0x20 && u < 0x7f && ch !== '"' && ch !== '\\' && ch !== '$' ? ch : `\\u${u.toString(16).padStart(4, '0')}`; }).join('')}"`;
const num = (x: number): string => {
  if (!Number.isFinite(x)) throw new Error(`a probe number is not finite: ${x}`);
  return Number.isInteger(x) ? `${x}.0` : String(x);
};
const ints = (xs: readonly number[]): string => {
  for (const x of xs) if (!Number.isInteger(x) || x < -2147483648 || x > 2147483647) throw new Error(`a probe integer is not int32: ${x}`);
  return xs.join(', ');
};

// ---------------------------------------------------------------- the host sources

const SWIFT_SHAPER = String.raw`import Foundation
import CryptoKit

/// The HarfBuzz shim in the app (T056 R1, R8): every bundled face's bytes are checked against the sha256 the build names before
/// the shim reads them, and shape() answers as the engine's GlyphShaper asks (stride-7 records, 16.16 positions).
final class DragonShaper {
  static let shared = DragonShaper()
  private let shaper: DragonHBShaper
  private var faces: [String: DragonHBFace] = [:]
  private var fonts: [String: DragonHBFont] = [:]
  private init() {
    do { shaper = try DragonHBShaper() } catch { fatalError("dragon shaper: \(error)") }
    for f in dragonShimFaces {
      guard let url = Bundle.main.url(forResource: f.file, withExtension: nil), let data = try? Data(contentsOf: url) else { fatalError("dragon shaper: \(f.file) is not bundled") }
      let sha = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      if sha != f.sha256 { fatalError("dragon shaper: \(f.file) has sha256 \(sha), but the build names \(f.sha256)") }
      do { faces[f.id] = try DragonHBFace(bytes: [UInt8](data)) } catch { fatalError("dragon shaper: \(f.file): \(error)") }
    }
  }
  func shape(face: String, size: Double, text: String, start: Int, end: Int, script: String, rtl: Bool, language: String, features: [Double]) -> [Double] {
    guard let fc = faces[face] else { fatalError("dragon shaper: no bundled face \(face)") }
    let key = face + " " + String(size.bitPattern)
    let font: DragonHBFont
    if let f = fonts[key] { font = f } else {
      do { font = try DragonHBFont(face: fc, size: Float(size)) } catch { fatalError("dragon shaper: \(face) at \(size) px: \(error)") }
      fonts[key] = font
    }
    do { return try shaper.shape(font: font, text: Array(text.utf16), start: start, end: end, script: script, rtl: rtl, language: language, featureRecords: features) } catch { fatalError("dragon shaper: \(error)") }
  }
}

/// Every probe call on the device's shim must give the host WASM shim's integers (T056 R3); a mismatch stops the run before any case.
func dragonCheckShim() {
  for (k, p) in dragonShimProbe.enumerated() {
    let got = DragonShaper.shared.shape(face: p.face, size: p.size, text: p.text, start: 0, end: p.text.utf16.count, script: p.script, rtl: p.rtl, language: p.language, features: p.features)
    let want = p.glyphs.map { Double($0) }
    if got != want {
      var i = 0
      while i < got.count && i < want.count && got[i] == want[i] { i += 1 }
      fatalError("dragon shaper: probe \(k) (\(p.face) at \(p.size) px\(p.rtl ? ", rtl" : "")) gives \(got.count) integers, the host's WASM shim \(want.count); first difference at integer \(i)")
    }
  }
}
`;

const KOTLIN_SHAPER = String.raw`package dev.dragon.host

import android.content.Context
import dev.dragon.text.DragonHB
import java.security.MessageDigest

/**
 * The HarfBuzz shim in the app (T056 R1, R8): libdragon_hb.so from the APK, every bundled face's bytes checked against the sha256
 * the build names before the shim reads them, and shape() answering as the engine's GlyphShaper asks (stride-7 records, 16.16).
 */
class DragonShaper private constructor(ctx: Context) {
  private val shaper: Long
  private val faces = HashMap<String, Long>()
  private val fonts = HashMap<String, Long>()
  init {
    DragonHB.load()
    shaper = DragonHB.shaperCreate()
    check(shaper != 0L) { "dragon shaper: dhb_shaper_create failed" }
    for (f in DRAGON_SHIM_FACES) {
      val bytes = ctx.assets.open(f.asset).use { it.readBytes() }
      val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { String.format("%02x", it.toInt() and 0xff) }
      check(sha == f.sha256) { "dragon shaper: " + f.asset + " has sha256 " + sha + ", but the build names " + f.sha256 }
      val face = DragonHB.faceCreate(bytes, 0)
      check(face != 0L) { "dragon shaper: dhb_face_create failed for " + f.asset }
      faces[f.id] = face
    }
  }
  fun shape(face: String, size: Double, text: String, start: Int, end: Int, script: String, rtl: Boolean, language: String, features: IntArray): IntArray {
    val fc = faces[face] ?: throw IllegalStateException("dragon shaper: no bundled face " + face)
    val key = face + " " + java.lang.Double.doubleToRawLongBits(size)
    val font = fonts.getOrPut(key) {
      val f = DragonHB.fontCreate(fc, size.toFloat(), size.toFloat(), 400f, 100f, 0f, true, null, null)
      check(f != 0L) { "dragon shaper: dhb_font_create failed for " + face + " at " + size + " px" }
      f
    }
    return DragonHB.shape(shaper, font, text, start, end - start, DragonHB.tag(script), rtl, language, if (features.isEmpty()) null else features) ?: throw IllegalStateException("dragon shaper: dhb_shape ran out of memory")
  }
  companion object {
    @Volatile private var instance: DragonShaper? = null
    fun shared(ctx: Context): DragonShaper = instance ?: synchronized(this) { instance ?: DragonShaper(ctx.applicationContext).also { instance = it } }
  }
}

/** Every probe call on the device's shim must give the host WASM shim's integers (T056 R3); a mismatch stops the run before any case. */
fun dragonCheckShim(ctx: Context) {
  for ((k, p) in DRAGON_SHIM_PROBE.withIndex()) {
    val got = DragonShaper.shared(ctx).shape(p.face, p.size, p.text, 0, p.text.length, p.script, p.rtl, p.language, p.features)
    if (!got.contentEquals(p.glyphs)) {
      var i = 0
      while (i < got.size && i < p.glyphs.size && got[i] == p.glyphs[i]) i++
      throw IllegalStateException("dragon shaper: probe " + k + " (" + p.face + " at " + p.size + " px" + (if (p.rtl) ", rtl" else "") + ") gives " + got.size + " integers, the host's WASM shim " + p.glyphs.size + "; first difference at integer " + i)
    }
  }
}
`;

/** The host app's shim sources: the text-shaper wrapper (into the engine's module or package), the host DragonShaper and the probe. */
export function shimSources(target: 'ios' | 'android', probe: readonly ShimProbe[] = shimProbe()): GeneratedFile[] {
  const gen = (c: string): string => `${c} GENERATED by @dragon/parity native-shim.ts. Do not edit.\n`;
  if (target === 'ios') {
    const faces = SHIM_FACES.map((f) => `  (id: ${swiftString(f.id)}, file: ${swiftString(f.iosFile)}, sha256: ${swiftString(f.sha256)}),`).join('\n');
    const calls = probe.map((p) => `  (face: ${swiftString(p.face)}, size: ${num(p.size)}, text: ${swiftString(p.text)}, script: ${swiftString(p.script)}, rtl: ${p.rtl}, language: ${swiftString(p.language)}, features: [${p.features.map(num).join(', ')}], glyphs: [${ints(p.glyphs)}]),`).join('\n');
    return [
      { path: 'Support/DragonHBShaper.swift', text: readFileSync(join(SHAPER_DIR, 'swift', 'Sources', 'DragonHBShaper', 'DragonHBShaper.swift'), 'utf8') },
      { path: 'Host/DragonShaper.swift', text: gen('//') + SWIFT_SHAPER },
      {
        path: 'Host/DragonShimProbe.swift',
        text: `${gen('//')}let dragonShimFaces: [(id: String, file: String, sha256: String)] = [\n${faces}\n]\n\nlet dragonShimProbe: [(face: String, size: Double, text: String, script: String, rtl: Bool, language: String, features: [Double], glyphs: [Int32])] = [\n${calls}\n]\n`,
      },
    ];
  }
  const faces = SHIM_FACES.map((f) => `  DragonShimFace(${kotlinString(f.id)}, ${kotlinString(f.androidAsset)}, ${kotlinString(f.sha256)}),`).join('\n');
  const calls = probe.map((p) => `  DragonShimCall(${kotlinString(p.face)}, ${num(p.size)}, ${kotlinString(p.text)}, ${kotlinString(p.script)}, ${p.rtl}, ${kotlinString(p.language)}, intArrayOf(${ints(p.features.map((x) => x | 0))}), intArrayOf(${ints(p.glyphs)})),`).join('\n');
  return [
    { path: 'kotlin/dev/dragon/text/DragonHB.kt', text: readFileSync(join(SHAPER_DIR, 'kotlin', 'src', 'dev', 'dragon', 'text', 'DragonHB.kt'), 'utf8') },
    { path: 'kotlin/dev/dragon/host/DragonShaper.kt', text: gen('//') + KOTLIN_SHAPER },
    {
      path: 'kotlin/dev/dragon/host/DragonShimProbe.kt',
      text: `${gen('//')}package dev.dragon.host\n\nclass DragonShimFace(val id: String, val asset: String, val sha256: String)\n\nclass DragonShimCall(val face: String, val size: Double, val text: String, val script: String, val rtl: Boolean, val language: String, val features: IntArray, val glyphs: IntArray)\n\nval DRAGON_SHIM_FACES = listOf(\n${faces}\n)\n\nval DRAGON_SHIM_PROBE = listOf(\n${calls}\n)\n`,
    },
  ];
}

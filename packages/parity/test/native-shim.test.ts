// The host apps' HarfBuzz shim (native-shim.ts): the probe the device must reproduce, its Swift and Kotlin encodings, the copied
// wrapper sources, and the NDK pin.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AHEM_FACE_ID, coveredCodePoints } from '@dragon/layout';
import { emitNativeSupport } from 'dragon';
import type { EmitCase } from 'dragon';
import { emitCases, hostSources, unbundledFaces } from '../src/native-host.ts';
import { androidNdk, REAL_FACE_PROBE_TEXT, SHIM_ANDROID_ABIS, SHIM_FACE_DIRS, SHIM_NDK, SHIM_ZIG, shimFaces, shimProbe, shimSources, shimToken } from '../src/native-shim.ts';
import { repoPath } from '../src/paths.ts';
import { stateEmits } from '../src/state-cases.ts';
import { animEmits } from '../src/anim-samples.ts';
import { fontDataOf, vendoredFaceIds } from '../src/text-shaper-host.ts';

const STRIDE = 7;
const probe = shimProbe();

/** The integer lists of a generated probe file, in order: Swift `glyphs: [...]` or Kotlin `intArrayOf(...)` after the features. */
function glyphLists(text: string, target: 'ios' | 'android'): number[][] {
  const re = target === 'ios' ? /glyphs: \[(-?\d[^\]]*)\]/g : /intArrayOf\(([^)]*)\)\),/g;
  return [...text.matchAll(re)].map((m) => (m[1] as string).split(',').map((x) => Number(x.trim())));
}

/** The probe texts of a generated file, unescaped: Swift \u{hex} per scalar, Kotlin \uXXXX per UTF-16 unit. */
function probeTexts(text: string, target: 'ios' | 'android'): string[] {
  const re = target === 'ios' ? /text: "((?:[^"\\]|\\.)*)"/g : /DragonShimCall\("(?:[^"\\]|\\.)*", [^,]+, "((?:[^"\\]|\\.)*)"/g;
  return [...text.matchAll(re)].map((m) =>
    target === 'ios' ? (m[1] as string).replace(/\\u\{([0-9a-f]+)\}/g, (_x, h: string) => String.fromCodePoint(parseInt(h, 16))) : (m[1] as string).replace(/\\u([0-9a-f]{4})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))),
  );
}

const real = shimFaces().filter((f) => f.id !== AHEM_FACE_ID);

describe('the bundled faces', () => {
  it('are Ahem and every vendored face, each real one held under its own sha256 in both apps', () => {
    expect(shimFaces().map((f) => f.id)).toEqual([AHEM_FACE_ID, ...vendoredFaceIds()]);
    expect(real.length).toBeGreaterThanOrEqual(9);
    for (const f of real) {
      const sha = createHash('sha256').update(readFileSync(repoPath(`vendor/fonts/${f.source}`))).digest('hex');
      expect([f.id, f.sha256, f.iosFile, f.androidAsset], f.source).toEqual([`sha256:${sha}`, sha, `${SHIM_FACE_DIRS.ios}/${sha}.ttf`, `${SHIM_FACE_DIRS.android}/${sha}.ttf`]);
    }
  });
  it('are the directories the emitted bridges read', () => {
    const swift = emitNativeSupport('uikit').find((f) => f.path === 'Support/DragonBridge.swift')?.text ?? '';
    expect(swift).toContain(`public let dragonFaceDirectory = "${SHIM_FACE_DIRS.ios}"`);
    const kotlin = emitNativeSupport('android-views').find((f) => f.path === 'kotlin/dev/dragon/views/DragonBridge.kt')?.text ?? '';
    expect(kotlin).toContain(`const val DRAGON_FACE_DIRECTORY = "${SHIM_FACE_DIRS.android}"`);
  });
  it('cover every face a device case draws, and a face no app bundles is named', () => {
    for (const t of ['ios', 'android'] as const) expect(unbundledFaces([...emitCases(t), ...stateEmits(t), ...animEmits(t)]), t).toEqual([]);
    const c = emitCases('ios').find((x) => x.program.nodes.some((n) => n.writes.some((w) => w.kind === 'font'))) as EmitCase;
    const other = JSON.parse(JSON.stringify(c).replace(/"family":"[^"]*"/, '"family":"sha256:00"')) as EmitCase;
    expect(unbundledFaces([other])).toEqual([`${c.id}: sha256:00`]);
  });
});

describe('the shim probe', () => {
  it('shapes the bundled Ahem through the host WASM shim: one glyph per code unit, whole records, the same on a second run', () => {
    const text = String.fromCodePoint(...coveredCodePoints());
    expect(probe).toHaveLength(5 + 2 * real.length);
    for (const p of probe.slice(0, 5)) {
      expect(p.text).toBe(text);
      expect(p.glyphs.length).toBe(text.length * STRIDE);
      expect(p.glyphs.every((x) => Number.isInteger(x))).toBe(true);
    }
    expect(shimProbe()).toEqual(probe);
  });
  it('its sizes give different advances, and right to left reverses the clusters', () => {
    const advances = (i: number): number[] => (probe[i]?.glyphs ?? []).filter((_x, k) => k % STRIDE === 2);
    expect(advances(0)).not.toEqual(advances(1));
    expect(advances(0)).not.toEqual(advances(2));
    const clusters = (i: number): number[] => (probe[i]?.glyphs ?? []).filter((_x, k) => k % STRIDE === 1);
    expect(clusters(3)).toEqual([...clusters(0)].reverse());
  });
  it('shapes every bundled real face at a whole and a fractional size, in whole records whose advances differ by size', () => {
    const rest = probe.slice(5);
    expect(rest.map((p) => [p.face, p.size, p.text, p.rtl])).toEqual(real.flatMap((f) => [[f.id, 16, REAL_FACE_PROBE_TEXT, false], [f.id, 13.37, REAL_FACE_PROBE_TEXT, false]]));
    for (let k = 0; k < rest.length; k += 2) {
      const [a, b] = [rest[k], rest[k + 1]] as [(typeof rest)[number], (typeof rest)[number]];
      for (const p of [a, b]) expect(p.glyphs.length > 0 && p.glyphs.length % STRIDE === 0, p.face).toBe(true);
      expect(a.glyphs.filter((_x, i) => i % STRIDE === 2), a.face).not.toEqual(b.glyphs.filter((_x, i) => i % STRIDE === 2));
    }
  });
});

describe('the generated shim sources', () => {
  for (const target of ['ios', 'android'] as const) {
    it(`${target}: the probe file carries every probe integer and text exactly`, () => {
      const files = shimSources(target, probe);
      const file = files.find((f) => f.path.includes('DragonShimProbe')) as { text: string };
      expect(glyphLists(file.text, target)).toEqual(probe.map((p) => [...p.glyphs]));
      expect(probeTexts(file.text, target)).toEqual(probe.map((p) => p.text));
      expect(file.text).toContain('b719ecb31c5b21fc573c03f6421c74ac63c271a5a3ff841e34f9705fb94b8448');
      for (const f of real) expect(file.text, f.id).toContain(f.sha256);
    });
    it(`${target}: the face file carries the host's FontData of every bundled real face, in order`, () => {
      const file = shimSources(target, probe).find((f) => f.path.includes('DragonShimProbe')) as { text: string };
      const re = target === 'ios' ? /\(id: "(sha256:[0-9a-f]+)", data: \[([^\]]*)\]\)/g : /DragonShimFaceData\("(sha256:[0-9a-f]+)", doubleArrayOf\(([^)]*)\)\)/g;
      const rows = [...file.text.matchAll(re)].map((m) => [m[1], (m[2] as string).split(',').map((x) => Number(x.trim()))]);
      expect(rows).toEqual(real.map((f) => {
        const d = fontDataOf(f.id);
        return [f.id, [d.unitsPerEm, d.ascent, d.descent, d.lineGap, d.xHeight, d.capHeight, d.zeroAdvance, d.ellipsisAdvance]];
      }));
    });
  }
  it('the wrappers are the text-shaper package files, byte for byte, and the host apps carry the shim sources', () => {
    const swift = shimSources('ios', probe).find((f) => f.path === 'Support/DragonHBShaper.swift');
    expect(swift?.text).toBe(readFileSync(repoPath('packages/text-shaper/swift/Sources/DragonHBShaper/DragonHBShaper.swift'), 'utf8'));
    const kotlin = shimSources('android', probe).find((f) => f.path === 'kotlin/dev/dragon/text/DragonHB.kt');
    expect(kotlin?.text).toBe(readFileSync(repoPath('packages/text-shaper/kotlin/src/dev/dragon/text/DragonHB.kt'), 'utf8'));
    expect(hostSources('ios', 'x').map((f) => f.path)).toEqual(expect.arrayContaining(['Support/DragonHBShaper.swift', 'Host/DragonShaper.swift', 'Host/DragonShimProbe.swift']));
    expect(hostSources('android', 'x').map((f) => f.path)).toEqual(expect.arrayContaining(['kotlin/dev/dragon/text/DragonHB.kt', 'kotlin/dev/dragon/host/DragonShaper.kt', 'kotlin/dev/dragon/host/DragonShimProbe.kt']));
  });
  it('both hosts check the shim before the first case', () => {
    const main = hostSources('ios', 'x').find((f) => f.path === 'Host/main.swift')?.text ?? '';
    expect(main.indexOf('dragonCheckShim()')).toBeGreaterThan(0);
    expect(main.indexOf('dragonCheckShim()')).toBeLessThan(main.indexOf('dragonWarmUp(run'));
    const activity = hostSources('android', 'x').find((f) => f.path === 'kotlin/dev/dragon/host/DragonActivity.kt')?.text ?? '';
    expect(activity.indexOf('dragonCheckShim(this)')).toBeGreaterThan(0);
    expect(activity.indexOf('dragonCheckShim(this)')).toBeLessThan(activity.indexOf('runCase(0)'));
  });
  it('both hosts check the bridge faces once its shaper is set, before the first case', () => {
    const main = hostSources('ios', 'x').find((f) => f.path === 'Host/main.swift')?.text ?? '';
    expect(main.indexOf('dragonCheckFaces()')).toBeGreaterThan(main.indexOf('DragonBridge.shaper = dragonGlyphShaper()'));
    expect(main.indexOf('dragonCheckFaces()')).toBeLessThan(main.indexOf('dragonWarmUp(run'));
    const activity = hostSources('android', 'x').find((f) => f.path === 'kotlin/dev/dragon/host/DragonActivity.kt')?.text ?? '';
    expect(activity.indexOf('dragonCheckFaces(this)')).toBeGreaterThan(activity.indexOf('DragonBridge.shaper = dragonGlyphShaper(this)'));
    expect(activity.indexOf('dragonCheckFaces(this)')).toBeLessThan(activity.indexOf('runCase(0)'));
  });
  it('a probe integer outside int32 is refused, not written', () => {
    const bad = [{ ...(probe[0] as (typeof probe)[number]), glyphs: [2 ** 31] }];
    expect(() => shimSources('ios', bad)).toThrow(/not int32/);
    expect(() => shimSources('android', bad)).toThrow(/not int32/);
  });
  it('each Android ABI has its own command token', () => {
    expect(SHIM_ANDROID_ABIS.map(shimToken)).toEqual(['SHIM_ANDROID_ARM', 'SHIM_ANDROID_INTEL']);
  });
});

describe('the NDK pin', () => {
  const ndk = (revision: string | null): string => {
    const d = mkdtempSync(join(tmpdir(), 'dragon-ndk-'));
    if (revision !== null) writeFileSync(join(d, 'source.properties'), `Pkg.Desc = Android NDK\nPkg.Revision = ${revision}\n`);
    return d;
  };
  it('accepts the pinned revision from ANDROID_NDK_HOME, and from ANDROID_HOME/ndk/<pin>', () => {
    const d = ndk(SHIM_NDK);
    try {
      expect(androidNdk({ ANDROID_NDK_HOME: d })).toBe(d);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
    expect(() => androidNdk({ ANDROID_HOME: '/nonexistent' })).toThrow(`/nonexistent/ndk/${SHIM_NDK}`);
  });
  it('refuses another revision, a directory with no source.properties, and no NDK at all', () => {
    for (const [rev, msg] of [['26.1.10909125', /is 26\.1\.10909125/], [null, /no source\.properties/]] as const) {
      const d = ndk(rev);
      try {
        expect(() => androidNdk({ ANDROID_NDK_HOME: d })).toThrow(msg);
      } finally {
        rmSync(d, { recursive: true, force: true });
      }
    }
    expect(() => androidNdk({})).toThrow(/no NDK/);
  });
});

describe('the device CI jobs', () => {
  it('install the pinned Zig, checked by sha256, in both device jobs, and the pinned NDK for Android', () => {
    const yml = readFileSync(repoPath('.github/workflows/device-lanes.yml'), 'utf8');
    for (const [target, next] of [['ios', 'android'], ['android', 'merge']] as const) {
      const job = yml.slice(yml.indexOf(`\n  ${target}:\n`), yml.indexOf(`\n  ${next}:\n`));
      const zig = job.slice(job.indexOf(`- name: Zig ${SHIM_ZIG}\n`));
      expect(job.indexOf(`- name: Zig ${SHIM_ZIG}\n`), target).toBeGreaterThan(0);
      expect(zig, target).toContain(`https://ziglang.org/download/${SHIM_ZIG}/$zig.tar.xz`);
      expect(zig, target).toContain('| shasum -a 256 -c -');
      expect(job.indexOf(`- name: Zig ${SHIM_ZIG}\n`), target).toBeLessThan(job.indexOf('- name: Device run '));
    }
    expect(yml).toContain(`'ndk;${SHIM_NDK}')`);
    expect(yml).toContain(`echo "ANDROID_NDK_HOME=$ANDROID_HOME/ndk/${SHIM_NDK}" >> "$GITHUB_ENV"`);
    expect(readFileSync(repoPath('packages/text-shaper/build.zig.zon'), 'utf8')).toContain(`.minimum_zig_version = "${SHIM_ZIG}"`);
  });
});

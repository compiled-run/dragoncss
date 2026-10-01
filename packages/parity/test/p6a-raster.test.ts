// P6a (notes/T008-p5-review.md, T085): the software-raster precondition. Every Chrome pixel capture first requires CDP
// SystemInfo to report rasterization and gpu_compositing disabled_software, records it in the pixel manifest, and parity:lanes
// refuses a manifest whose sets lack that record.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DPRS } from '../src/dpr.ts';
import { checkLaneParity, laneSources } from '../src/lanes.ts';
import type { PixelManifest } from '../src/pixel-reference.ts';
import { committedPixelManifestProblems, manifestText, PIXEL_MANIFEST, pixelManifestRasterProblems, rasterPathProblems, requireSoftwareRaster, SOFTWARE_RASTER } from '../src/pixel-reference.ts';
import { nativeTargets } from '../src/targets.ts';

const info = (featureStatus: Record<string, string>): (() => Promise<unknown>) => async () => ({ gpu: { featureStatus } });

describe('the software-raster precondition', () => {
  it('accepts SystemInfo reporting CPU rasterization and compositing', async () => {
    await expect(requireSoftwareRaster(info({ rasterization: 'disabled_software', gpu_compositing: 'disabled_software', skia_graphite: 'disabled_off' }))).resolves.toEqual(SOFTWARE_RASTER);
  });
  it('refuses GPU rasterization, GPU compositing, or a missing record', async () => {
    await expect(requireSoftwareRaster(info({ rasterization: 'enabled', gpu_compositing: 'disabled_software' }))).rejects.toThrow(/featureStatus\.rasterization is "enabled", not disabled_software/);
    await expect(requireSoftwareRaster(info({ rasterization: 'disabled_software', gpu_compositing: 'enabled' }))).rejects.toThrow(/gpu_compositing is "enabled"/);
    await expect(requireSoftwareRaster(async () => ({ gpu: {} }))).rejects.toThrow(/no SystemInfo featureStatus record/);
    await expect(requireSoftwareRaster(async () => null)).rejects.toThrow(/no SystemInfo featureStatus record/);
  });
  it('names every field that is off the software path', () => {
    expect(rasterPathProblems({ rasterization: 'enabled', gpu_compositing: 'enabled' })).toHaveLength(2);
    expect(rasterPathProblems(SOFTWARE_RASTER)).toEqual([]);
  });
});

describe('the pixel manifest raster record', () => {
  const manifest = JSON.parse(readFileSync(PIXEL_MANIFEST(), 'utf8')) as PixelManifest;
  it('every committed set was captured on the software raster path, and the manifest text round-trips', () => {
    expect(manifest.sets.map((s) => s.dpr)).toEqual([...DPRS]);
    for (const s of manifest.sets) expect(s.raster, `DPR ${s.dpr}`).toEqual(SOFTWARE_RASTER);
    expect(committedPixelManifestProblems()).toEqual([]);
    expect(manifestText(manifest)).toBe(readFileSync(PIXEL_MANIFEST(), 'utf8'));
  });
  it('a set without the record, or with a GPU path, is a problem', () => {
    const without = { ...manifest, sets: manifest.sets.map((s, i) => (i === 1 ? { ...s, raster: undefined } : s)) };
    expect(pixelManifestRasterProblems(without)).toEqual([`pixel manifest set 1 (DPR ${manifest.sets[1]?.dpr}): no SystemInfo featureStatus record`]);
    const gpu = { ...manifest, sets: manifest.sets.map((s) => ({ ...s, raster: { rasterization: 'enabled', gpu_compositing: 'disabled_software' } })) };
    expect(pixelManifestRasterProblems(gpu)).toHaveLength(manifest.sets.length);
    expect(pixelManifestRasterProblems({ sets: [] })).toEqual(['the pixel manifest has no capture sets']);
  });
  it('lane parity holds with the committed manifest (parity:lanes checks the raster record with the corpus manifests)', () => {
    expect(checkLaneParity(nativeTargets(), laneSources()).filter((p) => /pixel manifest|SystemInfo/.test(p))).toEqual([]);
  });
});

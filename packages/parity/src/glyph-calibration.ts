// The Chrome glyph calibration set (T093 ruling A): Ahem "X" and "XX" rasterised by the pinned Chrome at each calibrated device DPR,
// at device font sizes from 20 to 192 px and at the four x phases Skia positions glyphs at (1/4 px), each in its own cell. The set
// proves the two facts the sampler's glyph clearance rests on: every pixel Chrome inks differently from the glyph geometry lies
// within GLYPH_FRINGE_MAX_DEVICE_PX of a glyph box edge (so SAMPLE_INSET_DEVICE_PX clears it), and Chrome's glyph centres, measured
// by the same scanlines and centre pairing check (c) uses, lie within GLYPH_CENTRE_ERROR_MAX_DEVICE_PX of the geometry.
import { AHEM_FONT_DATA, coveredIndex, platformFontSize, zoomFontSize } from '@dragon/layout';
import { dprLabel } from './dpr.ts';
import type { RgbaImage } from './native-compare.ts';
import { glyphCentres, pixelAt, readSamples } from './native-compare.ts';
import { ahemGlyphBoxes } from './pixel-reference.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import type { GlyphBox } from './samples.ts';
import { glyphClearance, sampleGlyphs } from './samples.ts';

/** The device pixel ratios calibrated: every device DPR of both native targets. */
export const CALIBRATION_DPRS: readonly number[] = [2, 2.625, 3];
/** The device font sizes calibrated, smallest to largest; each is set as css size = device size / DPR. */
export const CALIBRATION_SIZES_DEVICE_PX: readonly number[] = [20, 22, 24, 27, 30, 34, 38, 42, 48, 54, 60, 69, 78, 88, 96, 108, 122, 138, 156, 174, 192];
/** The x phases of a glyph's pen within a device px: Skia positions glyphs at quarter pixels. */
export const CALIBRATION_PHASES: readonly number[] = [0, 0.25, 0.5, 0.75];
/** The farthest Chrome's ink may differ from the glyph geometry, from any glyph box edge; SAMPLE_INSET_DEVICE_PX must exceed it. */
export const GLYPH_FRINGE_MAX_DEVICE_PX = 1.5;
/** The farthest Chrome's measured glyph centre may be from the geometry's. */
export const GLYPH_CENTRE_ERROR_MAX_DEVICE_PX = 0.25;

/** Cell padding around the glyph boxes and the space between cells, in device px. */
const PAD = 8;
const GAP = 4;
const MARGIN = 16;

const INK: readonly number[] = [0, 0, 0, 255];
const PAPER: readonly number[] = [255, 255, 255, 255];

export const glyphCalibrationDir = (platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-glyphs/${platform}`);
export const glyphCalibrationPath = (dpr: number, platform: string = REFERENCE_PLATFORM): string => `${glyphCalibrationDir(platform)}/${dprLabel(dpr)}.png`;
export const glyphCalibrationManifestPath = (platform: string = REFERENCE_PLATFORM): string => `${glyphCalibrationDir(platform)}/manifest.json`;

/** One planned cell: the text, its device font size, its pen x and div top in device px; the css values set in the page. */
export type PlannedCell = { readonly text: 'X' | 'XX'; readonly size: number; readonly phase: number; readonly penX: number; readonly top: number; readonly cssLeft: string; readonly cssTop: string; readonly cssFontSize: string };

/** One captured cell: the glyph boxes from Chrome's layout (pen and baseline) and the font's glyph box, and the cell rect. */
export type CalibrationCell = {
  readonly text: 'X' | 'XX';
  readonly size: number;
  readonly phase: number;
  /** The platform font size the glyphs are drawn at: platformFontSize(zoomFontSize(css size, DPR)). */
  readonly fontSize: number;
  readonly glyphs: readonly GlyphBox[];
  /** Whole device px [left, top, right, bottom): the glyph boxes grown by the cell padding. */
  readonly rect: readonly [number, number, number, number];
};

export type CalibrationSet = { readonly dpr: number; readonly flags: readonly string[]; readonly width: number; readonly height: number; readonly sha256: string; readonly cells: readonly CalibrationCell[] };
export type CalibrationManifest = { readonly chrome: string; readonly capture: string; readonly sets: readonly CalibrationSet[] };

const css = (devicePx: number, dpr: number): string => `${devicePx / dpr}px`;

/** The cells of one DPR, row by row (one row per size), each row the four phases of X then XX; and the device raster size. */
export function planCells(dpr: number): { readonly cells: readonly PlannedCell[]; readonly width: number; readonly height: number } {
  const cells: PlannedCell[] = [];
  let top = MARGIN;
  let width = 0;
  for (const size of CALIBRATION_SIZES_DEVICE_PX) {
    let x = MARGIN;
    for (const phase of CALIBRATION_PHASES) {
      for (const text of ['X', 'XX'] as const) {
        const penX = x + PAD + phase;
        cells.push({ text, size, phase, penX, top, cssLeft: css(penX, dpr), cssTop: css(top, dpr), cssFontSize: css(size, dpr) });
        x += Math.ceil(text.length * size + phase) + 2 * PAD + GAP;
      }
    }
    width = Math.max(width, x + MARGIN);
    top += Math.ceil(size) + 2 * PAD + 2 + GAP;
  }
  return { cells, width, height: top + MARGIN };
}

/** The page of one DPR: every planned cell as an absolutely positioned div holding a zero-size inline-block probe at the pen. */
export function calibrationHtml(dpr: number): string {
  const { cells } = planCells(dpr);
  const divs = cells.map((c, i) => `<div style="left:${c.cssLeft};top:${c.cssTop};font-size:${c.cssFontSize}"><span id="p${i}" class="p"></span>${c.text}</div>`).join('');
  return `<!doctype html><html><head><style>html,body{margin:0;background:#fff}div{position:absolute;font-family:Ahem;line-height:normal;color:#000;white-space:pre}.p{display:inline-block;width:0;height:0}</style></head><body>${divs}</body></html>`;
}

/**
 * A captured cell from its plan and Chrome's probe (the pen x and the baseline in device px): each glyph's box is the font's X box
 * scaled to the platform font size, the second glyph's pen advanced by float32(size x advance / unitsPerEm) as glyphLines does.
 */
export function capturedCell(c: PlannedCell, dpr: number, pen: number, baseline: number): CalibrationCell {
  const fontSize = platformFontSize(zoomFontSize(Number.parseFloat(c.cssFontSize), dpr));
  const box = ahemGlyphBoxes().get(0x58);
  const k = coveredIndex(0x58);
  const adv = k < 0 ? undefined : AHEM_FONT_DATA.advances[k];
  if (box === null || box === undefined || adv === undefined) throw new Error('Ahem has no X');
  const upem = AHEM_FONT_DATA.unitsPerEm;
  const glyphs: GlyphBox[] = [];
  let x = 0;
  for (let i = 0; i < c.text.length; i++) {
    const left = pen + x;
    glyphs.push({ left: left + (box.xMin * fontSize) / upem, right: left + (box.xMax * fontSize) / upem, top: baseline - (box.yMax * fontSize) / upem, bottom: baseline - (box.yMin * fontSize) / upem });
    x = Math.fround(x + Math.fround((fontSize * adv) / upem));
  }
  const rect: [number, number, number, number] = [
    Math.floor(Math.min(...glyphs.map((g) => g.left))) - PAD,
    Math.floor(Math.min(...glyphs.map((g) => g.top))) - PAD,
    Math.ceil(Math.max(...glyphs.map((g) => g.right))) + PAD,
    Math.ceil(Math.max(...glyphs.map((g) => g.bottom))) + PAD,
  ];
  return { text: c.text, size: c.size, phase: c.phase, fontSize, glyphs, rect };
}

const same = (a: readonly number[], b: readonly number[]): boolean => a.every((v, i) => v === b[i]);

/**
 * The fringe extent of a cell: the largest glyph clearance (glyphClearance against each glyph box, the least of them) of a pixel
 * whose colour is not what the geometry says, ink inside a glyph box and paper outside every one. A pixel on an edge has clearance 0.
 */
export function fringeExtent(img: RgbaImage, cell: CalibrationCell): number {
  const [l, t, r, b] = cell.rect;
  let extent = 0;
  for (let y = t; y < b; y++) {
    for (let x = l; x < r; x++) {
      const d = Math.min(...cell.glyphs.map((g) => glyphClearance(x, y, g)));
      if (d <= extent) continue;
      const inside = cell.glyphs.some((g) => x >= g.left && x + 1 <= g.right && y >= g.top && y + 1 <= g.bottom);
      if (!same(pixelAt(img, x, y), inside ? INK : PAPER)) extent = d;
    }
  }
  return extent;
}

/** Chrome's glyph centres of a cell against the geometry's, by the glyph rule's scanlines and check (c)'s centre pairing. */
export function centreErrors(img: RgbaImage, cell: CalibrationCell): { readonly axis: 'x' | 'y'; readonly error: number }[] {
  const line = { id: 'cal:line0', glyphs: cell.glyphs };
  const points = sampleGlyphs([line], { width: img.width, height: img.height }).points;
  const first = cell.glyphs[0] as GlyphBox;
  const last = cell.glyphs[cell.glyphs.length - 1] as GlyphBox;
  return glyphCentres(readSamples(img, points), img).map((c) => ({ axis: c.axis, error: c.chrome - (c.axis === 'x' ? (first.left + last.right) / 2 : (first.top + first.bottom) / 2) }));
}

/** Pixels outside every cell that are not paper, as "x,y". */
export function strayInk(img: RgbaImage, cells: readonly CalibrationCell[]): string[] {
  const inCell = new Uint8Array(img.width * img.height);
  for (const c of cells) for (let y = Math.max(0, c.rect[1]); y < Math.min(img.height, c.rect[3]); y++) inCell.fill(1, y * img.width + Math.max(0, c.rect[0]), y * img.width + Math.min(img.width, c.rect[2]));
  const out: string[] = [];
  for (let i = 0; i < img.width * img.height; i++) {
    if (inCell[i] === 1) continue;
    if ([0, 1, 2, 3].some((k) => img.data[i * 4 + k] !== PAPER[k])) out.push(`${i % img.width},${Math.floor(i / img.width)}`);
  }
  return out;
}

/** Pairs of cells whose rects overlap. */
export function overlappingCells(cells: readonly CalibrationCell[]): string[] {
  const out: string[] = [];
  cells.forEach((a, i) => {
    cells.forEach((b, j) => {
      if (j <= i) return;
      if (a.rect[0] < b.rect[2] && b.rect[0] < a.rect[2] && a.rect[1] < b.rect[3] && b.rect[1] < a.rect[3]) out.push(`${i} and ${j}`);
    });
  });
  return out;
}

/** The worst fringe extent and centre error of one DPR set, and the cell each came from. */
export type CalibrationSummary = { readonly dpr: number; readonly cells: number; readonly fringe: number; readonly fringeCell: string; readonly centre: number; readonly centreCell: string; readonly centres: number };

const cellName = (c: CalibrationCell): string => `${c.text}@${c.size}+${c.phase}`;

export function summarise(dpr: number, img: RgbaImage, cells: readonly CalibrationCell[]): CalibrationSummary {
  let fringe = 0;
  let fringeCell = '';
  let centre = 0;
  let centreCell = '';
  let centres = 0;
  for (const c of cells) {
    const f = fringeExtent(img, c);
    if (f > fringe || fringeCell === '') [fringe, fringeCell] = [f, cellName(c)];
    for (const e of centreErrors(img, c)) {
      centres++;
      if (Math.abs(e.error) > centre || centreCell === '') [centre, centreCell] = [Math.abs(e.error), `${cellName(c)} ${e.axis}`];
    }
  }
  return { dpr, cells: cells.length, fringe, fringeCell, centre, centreCell, centres };
}

export function calibrationManifestText(m: CalibrationManifest): string {
  const sets = m.sets.map((s) => `    {\n      "dpr": ${JSON.stringify(s.dpr)},\n      "flags": ${JSON.stringify(s.flags)},\n      "width": ${s.width},\n      "height": ${s.height},\n      "sha256": ${JSON.stringify(s.sha256)},\n      "cells": [\n${s.cells.map((c) => `        ${JSON.stringify(c)}`).join(',\n')}\n      ]\n    }`).join(',\n');
  return `{\n  "chrome": ${JSON.stringify(m.chrome)},\n  "capture": ${JSON.stringify(m.capture)},\n  "sets": [\n${sets}\n  ]\n}\n`;
}

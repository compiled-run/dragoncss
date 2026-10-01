// INL1a deviation 58b7f005c (notes/T058-inl1a.md, T058J2 (F)): the native runtime and the host break programs call the translated
// buildIfc then placeIfcLines, because the translator roots do not reach placeLines. placeLines must stay exactly that pair: this
// deep-equals them on every block container with inline content of every engine-inline corpus input and every vector input (the
// break vectors are those inputs at DPR 2, 3 and 2.625), at several available widths, with each input's own engine faults.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ahemMeasurer, fromCssPx, NO_ENGINE_FAULTS, placeLines, validateLayoutInput, zoomInput } from '../src/index.ts';
import type { EngineFaults, LayoutBox, LayoutInput, LU } from '../src/index.ts';
import { buildIfc, placeIfcLines } from '../src/inline.ts';

const VECTORS = new URL('../vectors/', import.meta.url).pathname;

function vectorFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return vectorFiles(p);
    return f.endsWith('.json') ? [p] : [];
  });
}

/** The value, or the thrown error's message, so a refusal is compared too. */
function outcome<T>(f: () => T): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string } {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e) };
  }
}

function containers(b: LayoutBox, out: LayoutBox[]): LayoutBox[] {
  if (b.strut !== null) out.push(b);
  for (const c of b.children) if (c.kind === 'box') containers(c, out);
  return out;
}

/** Compares the two on every inline formatting context of one input; returns how many were compared. */
function compare(label: string, raw: LayoutInput, faults: EngineFaults): number {
  const valid = validateLayoutInput(raw);
  if (!valid.ok) throw new Error(`${label}: invalid input ${JSON.stringify(valid.errors)}`);
  const zoomed = zoomInput(valid.input, faults);
  const ctx = { measurer: ahemMeasurer, devicePixelRatio: zoomed.devicePixelRatio, faults };
  let n = 0;
  for (const b of containers(zoomed.root, [])) {
    for (const w of [0 as LU, 1 as LU, fromCssPx(37.5), fromCssPx(zoomed.viewport.width)]) {
      const direct = outcome(() => placeLines(ctx, b, w));
      const pair = outcome(() => placeIfcLines(ctx, b, buildIfc(ctx, b), w));
      expect(pair, `${label} ${b.id} at ${w} LU`).toEqual(direct);
      n++;
    }
  }
  return n;
}

describe('placeLines is exactly placeIfcLines(buildIfc(...)) (T058J2 (F))', () => {
  it('on every engine-inline corpus input, with its planted fault', async () => {
    // Loaded from packages/translate at run time (packages/layout does not depend on it).
    const root = new URL('../../../', import.meta.url).pathname;
    const dpr = (await import(pathToFileURL(join(root, 'packages/translate/src/corpus-dpr.ts')).href)) as { readonly engineInlineCases: () => string[]; readonly INLINE_SPEC: { readonly engineInline: number; readonly atomicInline: number } };
    const lines = dpr.engineInlineCases();
    // INL2a appends its atomic contexts after INL1a's 3000.
    expect(lines.length).toBe(dpr.INLINE_SPEC.engineInline + dpr.INLINE_SPEC.atomicInline);
    let n = 0;
    lines.forEach((line, i) => {
      const c = JSON.parse(line) as { readonly faults: EngineFaults; readonly input: LayoutInput };
      n += compare(`engine-inline ${i}`, c.input, c.faults);
    });
    expect(n).toBeGreaterThanOrEqual(lines.length * 4);
  });
  it('on every vector input (the break vectors are the DPR ones)', () => {
    const files = vectorFiles(VECTORS);
    expect(files.length).toBeGreaterThan(1000);
    let n = 0;
    for (const f of files) {
      const v: unknown = JSON.parse(readFileSync(f, 'utf8'));
      // Snap and calc vectors hold no layout input.
      if (typeof v !== 'object' || v === null || Array.isArray(v) || !('input' in v) || !('output' in v)) continue;
      if (typeof v.input !== 'object' || v.input === null || !('root' in v.input)) continue;
      n += compare(f.slice(VECTORS.length), v.input as LayoutInput, NO_ENGINE_FAULTS);
    }
    expect(n).toBeGreaterThan(1000);
  });
});

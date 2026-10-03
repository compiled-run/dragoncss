// The paint emission registry (notes/T046-paint-spec.md §3 item 2): every module, registered once in final order. The emitters,
// the expected-dump projection and the native support dispatch through it; nothing here imports native-support.ts.
import type { NativeBackend } from '../../lower/paint/types.ts';
import { PAINT_MODULE_NAMES } from '../../lower/paint/types.ts';
import type { PaintWriteKind } from '../../lower/paint/registry.ts';
import type { ProgramNode, ProgramWrite } from '../../lower/native-program.ts';
import type { ExpectedEngine, JsonValue, NodeGeometry } from '../expected-dump.ts';
import { BACKGROUND_EMITTER } from './background.ts';
import { BORDER_EMITTER } from './border.ts';
import { CLIP_EMITTER } from './clip.ts';
import { CONTROL_EMITTER } from './control.ts';
import { EFFECTS_EMITTER } from './effects.ts';
import { FIXED_EMITTER } from './fixed.ts';
import { FOREIGN_VIEW_EMITTER } from './foreign-view.ts';
import { GRADIENT_EMITTER } from './gradient.ts';
import { IMAGE_EMITTER } from './image.ts';
import { OUTLINE_EMITTER } from './outline.ts';
import { RADIUS_EMITTER } from './radius.ts';
import { SCROLL_EMITTER } from './scroll.ts';
import { SCROLLBAR_EMITTER } from './scrollbar.ts';
import { SHADOW_EMITTER } from './shadow.ts';
import { STACKING_EMITTER } from './stacking.ts';
import { TRANSFORM_EMITTER } from './transform.ts';
import type { NativePaint, PaintEmitter, PaintPlant, PaintStage } from './types.ts';
import { PAINT_STAGES } from './types.ts';

/** Registration point (EMS): the paint emitters in PAINT_MODULE_NAMES order. */
export const PAINT_EMITTERS: readonly PaintEmitter<string>[] = [
  BACKGROUND_EMITTER,
  BORDER_EMITTER,
  CLIP_EMITTER,
  RADIUS_EMITTER,
  SHADOW_EMITTER,
  EFFECTS_EMITTER,
  STACKING_EMITTER,
  OUTLINE_EMITTER,
  TRANSFORM_EMITTER,
  GRADIENT_EMITTER,
  SCROLL_EMITTER,
  FIXED_EMITTER,
  SCROLLBAR_EMITTER,
  IMAGE_EMITTER,
  FOREIGN_VIEW_EMITTER,
  CONTROL_EMITTER,
] as readonly PaintEmitter<string>[];

if (PAINT_EMITTERS.map((m) => m.name).join() !== PAINT_MODULE_NAMES.join()) throw new Error('the paint emitter registry is not in PAINT_MODULE_NAMES order');

const byKind = new Map<string, PaintEmitter<string>>();
for (const m of PAINT_EMITTERS) {
  for (const k of m.kinds) {
    if (byKind.has(k)) throw new Error(`paint write kind ${k} is emitted by two modules`);
    byKind.set(k, m);
  }
}

/** Whether a write kind belongs to a paint module (the rest are the text writes, font and text-color). */
export function isPaintKind(kind: string): kind is PaintWriteKind {
  return byKind.has(kind);
}

function emitterOf(kind: string): PaintEmitter<string> {
  const m = byKind.get(kind);
  if (m === undefined) throw new Error(`no paint module emits write kind ${kind}`);
  return m;
}

/** The case-code lines of one paint write on a backend. */
export function paintWriteLines(backend: NativeBackend, v: string, n: ProgramNode, w: ProgramWrite): string[] {
  return emitterOf(w.kind).lines[backend](v, n, w as ProgramWrite & { readonly kind: string });
}

/** The expected applied value of one paint write at a device scale. */
export function paintAppliedValue(engine: ExpectedEngine, backend: NativeBackend, w: ProgramWrite, dpr: number, g: NodeGeometry): JsonValue {
  return emitterOf(w.kind).applied(engine, backend, w as ProgramWrite & { readonly kind: string }, dpr, g);
}

/** The native paint of every module on a backend, in registry order, with the module's file name stem. */
export function nativePaints(backend: NativeBackend): readonly { readonly name: string; readonly stem: string; readonly native: NativePaint }[] {
  return PAINT_EMITTERS.map((m) => ({ name: m.name, stem: `DragonPaint${m.name.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')}`, native: m.native[backend] }));
}

/** The painters of one stage on a backend, in registry order. */
export function stagePainters(backend: NativeBackend, stage: PaintStage): string[] {
  return PAINT_EMITTERS.flatMap((m) => {
    const fn = m.native[backend].stages[stage];
    return fn === undefined ? [] : [fn];
  });
}

/** The one function a hook names on a backend, or null when no module provides it; two providers are an error. */
export function soleHook(backend: NativeBackend, hook: 'roundedPath' | 'container'): string | null {
  const fns = PAINT_EMITTERS.flatMap((m) => {
    const fn = m.native[backend][hook];
    return fn === null ? [] : [fn];
  });
  if (fns.length > 1) throw new Error(`two paint modules provide the ${hook} hook on ${backend}`);
  return fns[0] ?? null;
}

/** The names of the paint modules' raster plants; a module adds its plant names here. */
export type PaintPlantName = 'dash-phase-1' | 'dash-gap-unfitted' | 'radius-square' | 'shadow-offset-1' | 'alpha-ignored';

/** Every raster plant the paint modules declare, in registry order. */
export function paintPlants(): readonly PaintPlant[] {
  return PAINT_EMITTERS.flatMap((m) => m.plants);
}

export { PAINT_STAGES };

export { DragonHB, DEFAULT_WASM_PATH, GLYPH_FLAG_UNSAFE_TO_BREAK, GLYPH_STRIDE, tagFromString, tagToString } from './wasm.ts';
export type { Feature, FontOptions, ShapeOptions, Variation } from './wasm.ts';
export { runGate, loadReference, REFERENCE_PATH, FONT_DIR, LOADED_FONTS_PATH, fontPath } from './gate.ts';
export type { CaseResult, GateOptions, LineDiff, Reference, ReferenceCase } from './gate.ts';

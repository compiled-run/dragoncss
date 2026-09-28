export { DragonHB, DEFAULT_WASM_PATH, GLYPH_FLAG_UNSAFE_TO_BREAK, GLYPH_STRIDE, tagFromString, tagToString } from './wasm.ts';
export type { Feature, FontOptions, LoadOptions, ShapeOptions, Variation } from './wasm.ts';
export {
  runGate, loadReference, REFERENCE_PATH, FONT_DIR, LOADED_FONTS_PATH, LATO_REFERENCE_PATH, LATO_LOADED_FONTS_PATH, GATE_REFERENCES, fontPath,
} from './gate.ts';
export type { CaseResult, GateOptions, LineDiff, Reference, ReferenceCase } from './gate.ts';
export {
  VALIDATED_VARIABLE_FONTS_PATH, VariableFontRefused, faceFacts, fenceFace, fenceInstance, instanceAxisValues, loadValidatedVariableFonts,
} from './fence.ts';
export type { FaceFacts, FvarAxis, ValidatedVariableFont, ValidatedVariableFonts, VariableFontRefusal } from './fence.ts';

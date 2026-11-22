// An SVG path's absolute segments, apart from svg-geometry.ts so that the layout engine (controls.ts) can name them without its paint imports.
export type SvgMove = { readonly kind: 'move'; readonly x: number; readonly y: number };
export type SvgLine = { readonly kind: 'line'; readonly x: number; readonly y: number };
export type SvgQuad = { readonly kind: 'quad'; readonly x1: number; readonly y1: number; readonly x: number; readonly y: number };
export type SvgCubic = { readonly kind: 'cubic'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x: number; readonly y: number };
export type SvgClose = { readonly kind: 'close' };

/** One absolute segment in float32 user space. */
export type SvgSegment = SvgMove | SvgLine | SvgQuad | SvgCubic | SvgClose;

export type SvgPathShape = { readonly kind: 'path'; readonly segments: readonly SvgSegment[] };

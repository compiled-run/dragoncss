// Typed refusals. The engine never falls back or guesses; a fixture that hits one of these fails.

export type UnsupportedCode =
  | 'percent-height-flex'
  | 'percent-gap'
  | 'mixed-inline-font'
  | 'text-align'
  | 'text-glyph'
  | 'direction-rtl'
  | 'flex-reverse'
  | 'flex-wrap-reverse'
  | 'flex-order'
  | 'flex-baseline'
  | 'flex-basis-content'
  | 'flex-align-value'
  | 'flex-justify-value'
  | 'flex-wrap-indefinite-main'
  | 'flex-intrinsic-wrap-column';

export type LayoutUnsupported = {
  readonly code: UnsupportedCode;
  readonly nodeId: string;
  readonly specSection: string;
  readonly detail: string;
};

export class UnsupportedSignal extends Error {
  readonly unsupported: LayoutUnsupported;
  constructor(unsupported: LayoutUnsupported) {
    super(`${unsupported.code} at ${unsupported.nodeId} (${unsupported.specSection}): ${unsupported.detail}`);
    this.unsupported = unsupported;
  }
}

export function unsupported(code: UnsupportedCode, nodeId: string, specSection: string, detail: string): never {
  throw new UnsupportedSignal({ code, nodeId, specSection, detail });
}

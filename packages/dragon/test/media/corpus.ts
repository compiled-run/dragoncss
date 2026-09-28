// The committed media query corpus and its Chrome capture (scripts/capture-media-data.ts).
import { readFileSync } from 'node:fs';

export type BandSheet = {
  readonly name: string;
  readonly queries: readonly string[];
  /** Set when band() must refuse the sheet; a refused sheet is not captured. */
  readonly refused?: 'too-many-bands' | 'non-axis-feature' | 'refused-value';
};

type Viewport = { readonly width: number; readonly height: number };

export type Corpus = {
  readonly roots: readonly number[];
  readonly defaultViewport: Viewport;
  readonly limits: { readonly minWidth: number; readonly maxWidth: number; readonly minHeight: number; readonly maxHeight: number };
  readonly queries: readonly string[];
  readonly refusedQueries: readonly string[];
  readonly bandSheets: readonly BandSheet[];
};

export type Capture = {
  readonly chrome: string;
  readonly roots: readonly number[];
  readonly points: readonly (readonly [number, number])[];
  readonly queries: readonly { readonly query: string; readonly mediaText: string; readonly matches: Readonly<Record<string, string>> }[];
  readonly bands: readonly {
    readonly sheet: string;
    readonly conditions: readonly { readonly text: string; readonly mediaText: string; readonly matches: Readonly<Record<string, string>> }[];
  }[];
};

export const CORPUS = JSON.parse(readFileSync(new URL('./corpus.json', import.meta.url), 'utf8')) as Corpus;
export const CAPTURE = JSON.parse(readFileSync(new URL('./captures/chrome-145.json', import.meta.url), 'utf8')) as Capture;

/** Every query Chrome evaluates: the evaluated queries, then the refused ones. */
export const QUERIES: readonly string[] = [...CORPUS.queries, ...CORPUS.refusedQueries];

// The committed media query corpus and its Chrome capture (scripts/capture-media-data.ts).
import { readFileSync } from 'node:fs';

export type BandSheet = {
  readonly name: string;
  readonly queries: readonly string[];
  /** Set when band() must refuse the sheet; a refused sheet is not captured. */
  readonly refused?: 'too-many-bands' | 'refused-value';
};

/** A fractional frame: an iframe of whole device px or an emulated main frame of CSS px, at a DPR. */
export type FrameKind = 'iframe' | 'main';

type Viewport = { readonly width: number; readonly height: number };

export type Corpus = {
  readonly roots: readonly number[];
  readonly defaultViewport: Viewport;
  readonly limits: { readonly minWidth: number; readonly maxWidth: number; readonly minHeight: number; readonly maxHeight: number };
  readonly queries: readonly string[];
  readonly refusedQueries: readonly string[];
  readonly bandSheets: readonly BandSheet[];
  /** MQ-R0: rows captured at fractional media sizes (scripts/capture-media-data.ts). */
  readonly fractional: {
    readonly viewport: Viewport;
    readonly iframes: readonly (readonly [number, number, number])[];
    readonly mainFrames: readonly (readonly [number, number, number])[];
    readonly queries: readonly string[];
    readonly bandSheets: readonly { readonly name: string; readonly queries: readonly string[] }[];
  };
};

type Row = { readonly mediaText: string; readonly matches: string };

export type Capture = {
  readonly chrome: string;
  readonly roots: readonly number[];
  readonly points: readonly (readonly [number, number])[];
  readonly queries: readonly { readonly query: string; readonly mediaText: string; readonly matches: Readonly<Record<string, string>> }[];
  readonly bands: readonly {
    readonly sheet: string;
    readonly conditions: readonly { readonly text: string; readonly mediaText: string; readonly matches: Readonly<Record<string, string>> }[];
  }[];
  /** One bit per frame in each row's matches, in frame order. */
  readonly fractional: {
    readonly frames: readonly (readonly [FrameKind, number, number, number])[];
    readonly queries: readonly ({ readonly query: string } & Row)[];
    readonly bands: readonly { readonly sheet: string; readonly conditions: readonly ({ readonly text: string } & Row)[] }[];
  };
};

export const CORPUS = JSON.parse(readFileSync(new URL('./corpus.json', import.meta.url), 'utf8')) as Corpus;
export const CAPTURE = JSON.parse(readFileSync(new URL('./captures/chrome-145.json', import.meta.url), 'utf8')) as Capture;

/** Every query Chrome evaluates: the evaluated queries, then the refused ones. */
export const QUERIES: readonly string[] = [...CORPUS.queries, ...CORPUS.refusedQueries];

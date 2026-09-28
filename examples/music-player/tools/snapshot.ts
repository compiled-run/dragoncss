// The north-star snapshot (examples/music-player/snapshot.html + styles.css) and its screen states.
// snapshot.html is the rendered element tree of the Markless music-player demo's initial SSR state (library closed, paused,
// track one selected) with the YouTube iframe and all scripts stripped. The other states are derived by exact, counted
// edits, the same class and text changes the demo's components make, so every state stays traceable to the one snapshot.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(EXAMPLE_DIR, '..', '..');
export const examplePath = (relative: string): string => join(EXAMPLE_DIR, relative);
export const repoPath = (relative: string): string => join(REPO_ROOT, relative);

export const SNAPSHOT_HTML = 'snapshot.html';
export const STYLES_CSS = 'styles.css';

export type StateId = 'main' | 'library-open' | 'playing';

type Edit = { readonly from: string; readonly to: string };

/** The screen states: main is the snapshot as written; the others are the component state changes of the demo. */
export const STATES: readonly { readonly id: StateId; readonly description: string; readonly edits: readonly Edit[] }[] = [
  { id: 'main', description: 'initial SSR state: library closed, paused, track one selected', edits: [] },
  {
    id: 'library-open',
    description: 'libraryStatus = true (Nav toggle): .App.library-active, .library.active-library, .library-button.active',
    edits: [
      { from: '<div class="App" data-dragon-id="app"', to: '<div class="App library-active" data-dragon-id="app"' },
      { from: '<div class="library" data-dragon-id="library"', to: '<div class="library active-library" data-dragon-id="library"' },
      { from: 'class="library-button" data-dragon-id', to: 'class="library-button active" data-dragon-id' },
    ],
  },
  {
    id: 'playing',
    description: 'isPlaying = true: .record.rotating, .play.active and the pause icon',
    edits: [
      { from: '<div class="record" data-dragon-id="record"', to: '<div class="record rotating" data-dragon-id="record"' },
      { from: 'class="play" aria-label', to: 'class="play active" aria-label' },
      { from: 'data-dragon-id="play-icon">▶</span', to: 'data-dragon-id="play-icon">❚❚</span' },
    ],
  },
];

export function readSnapshot(): { html: string; css: string } {
  return { html: readFileSync(examplePath(SNAPSHOT_HTML), 'utf8'), css: readFileSync(examplePath(STYLES_CSS), 'utf8') };
}

/** The snapshot HTML of one state; every edit must hit exactly once. */
export function stateHtml(html: string, state: StateId): string {
  const spec = STATES.find((s) => s.id === state);
  if (spec === undefined) throw new Error(`unknown state ${state}`);
  let out = html;
  for (const e of spec.edits) {
    const n = out.split(e.from).length - 1;
    if (n !== 1) throw new Error(`${state}: edit ${JSON.stringify(e.from)} matches ${n} times, expected 1`);
    out = out.replace(e.from, e.to);
  }
  return out;
}

/** HTML void elements the snapshot uses (and the head-only ones the conversion drops with the head). */
export const VOID_ELEMENTS = ['img', 'input'] as const;

/**
 * The snapshot in the parity fixture-reader's strict HTML subset (packages/parity/src/fixture-reader.ts): the head becomes a
 * single <style> holding styles.css verbatim (the reader skips <head>, and its <meta>/<link> are void elements it cannot
 * parse), and each void element gets an explicit end tag. Returns the edits it made, each one a producer-format gap.
 */
export function toFixtureHtml(html: string, css: string): { html: string; edits: readonly string[] } {
  const edits: string[] = [];
  const head = /<head\s*>[\s\S]*?<\/head\s*>/.exec(html);
  if (head === null) throw new Error('snapshot has no <head>');
  let out = html.replace(head[0], `<head><style>${css}</style></head>`);
  edits.push('head: <meta>, <title> and <link rel="stylesheet"> replaced by one <style> holding styles.css verbatim');
  for (const tag of VOID_ELEMENTS) {
    let n = 0;
    out = out.replace(new RegExp(`(<${tag}\\b[^>]*>)`, 'g'), (m) => {
      n++;
      return `${m}</${tag}>`;
    });
    if (n > 0) edits.push(`<${tag}>: ${n} void element(s) given an explicit </${tag}> (the fixture HTML subset has no void elements)`);
  }
  return { html: out, edits };
}

/** The cover images: the demo loads YouTube thumbnails (1280x720 JPEG). Captures serve a deterministic stand-in of the same size. */
export const COVER_COLORS: Readonly<Record<string, readonly [string, string]>> = {
  DwTzcZxyUUg: ['#2f4f66', '#a57c5b'],
  m_qlgFQs7E4: ['#4b3f72', '#d79f6f'],
  UQ0KmrvBPaY: ['#31572c', '#9ec5ab'],
  JhkqWaiYgA8: ['#7d4e57', '#d9a441'],
};

/** A 1280x720 SVG in the track's two colours: same intrinsic size and aspect ratio as maxresdefault.jpg, no text, no network. */
export function coverStandIn(videoId: string): string {
  const colors = COVER_COLORS[videoId];
  if (colors === undefined) throw new Error(`no cover colours for ${videoId}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="640" cy="360" r="160" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="24"/></svg>`;
}

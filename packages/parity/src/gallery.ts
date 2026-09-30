// The native gallery (pnpm run native:gallery): chosen layout cases side by side as Chrome 145 at DPR 3, the iPhone 17 simulator
// and the dragon-smoke emulator, on one static page under packages/parity/out/gallery. Evidence for people only: no check reads it.
import { crc32, deflateSync } from 'node:zlib';
import type { RgbaImage } from './native-compare.ts';

/** The case fields the gallery selects on. */
export type GalleryCaseRef = { readonly id: string; readonly fixture: string; readonly group: string; readonly isInitial: boolean; readonly direction: 'ltr' | 'rtl' };

export type GalleryArgs = { readonly cases: readonly string[] | null };

/** The command line: --cases a,b,c (case ids), or nothing for every layout fixture. Anything else is refused. */
export function parseGalleryArgs(argv: readonly string[]): GalleryArgs {
  let cases: string[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--cases') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error('--cases takes a comma-separated list of case ids');
      if (cases !== null) throw new Error('--cases is given twice');
      cases = v.split(',').map((s) => s.trim());
      if (cases.some((s) => s === '')) throw new Error(`--cases ${JSON.stringify(v)} holds an empty case id`);
      i++;
    } else throw new Error(`unknown argument ${JSON.stringify(a)}; usage: native:gallery [-- --cases <id>,<id>...]`);
  }
  return { cases };
}

/**
 * The rows: the named cases in the order given (every id must be a layout case, none twice); by default one case per layout
 * fixture, its initial left-to-right case (or its first case when it has none), showcase fixtures first, then registry order.
 */
export function selectGalleryCases<C extends GalleryCaseRef>(all: readonly C[], wanted: readonly string[] | null): C[] {
  if (wanted !== null) {
    const byId = new Map(all.map((c) => [c.id, c]));
    const unknown = wanted.filter((id) => !byId.has(id));
    if (unknown.length > 0) throw new Error(`--cases names ${unknown.length} id(s) that are not layout cases: ${unknown.join(', ')}`);
    const twice = wanted.filter((id, i) => wanted.indexOf(id) !== i);
    if (twice.length > 0) throw new Error(`--cases names ${[...new Set(twice)].join(', ')} more than once`);
    return wanted.map((id) => byId.get(id) as C);
  }
  const byFixture = new Map<string, C>();
  for (const c of all) {
    const have = byFixture.get(c.fixture);
    const pick = c.isInitial && c.direction === 'ltr';
    if (have === undefined || (pick && !(have.isInitial && have.direction === 'ltr'))) byFixture.set(c.fixture, c);
  }
  const rows = [...byFixture.values()];
  return [...rows.filter((c) => c.group === SHOWCASE_GROUP), ...rows.filter((c) => c.group !== SHOWCASE_GROUP)];
}

export const SHOWCASE_GROUP = 'showcase';

/** The CSS features of a case from its profile row keys ("<property>:<value subset>@<context>"): the distinct features, sorted. */
export function featureLabels(keys: readonly string[]): string[] {
  return [...new Set(keys.map((k) => {
    const at = k.lastIndexOf('@');
    if (at <= 0) throw new Error(`profile row key ${JSON.stringify(k)} has no @context`);
    return k.slice(0, at);
  }))].sort();
}

/** The w x h region of img at x, y; the region must lie inside the image. */
export function cropImage(img: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > img.width || y + h > img.height) {
    throw new Error(`the ${w}x${h} region at ${x},${y} is not inside the ${img.width}x${img.height} image`);
  }
  const data = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) data.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return { width: w, height: h, data };
}

/** An 8-bit RGBA PNG of img (filter 0 on every row). */
export function encodePng(img: RgbaImage): Buffer {
  if (img.data.length !== img.width * img.height * 4) throw new Error(`the image holds ${img.data.length} bytes, ${img.width}x${img.height} RGBA needs ${img.width * img.height * 4}`);
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let r = 0; r < img.height; r++) raw.set(img.data.subarray(r * stride, (r + 1) * stride), r * (stride + 1) + 1);
  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** One screenshot cell: an image relative to the page, or why there is none. */
export type GalleryCell = { readonly kind: 'image'; readonly src: string } | { readonly kind: 'missing'; readonly reason: string };

export type GalleryColumn = { readonly title: string; readonly detail: string };

export type GalleryRow = { readonly id: string; readonly features: readonly string[]; readonly cells: readonly GalleryCell[] };

export type GalleryPage = {
  readonly generated: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly columns: readonly GalleryColumn[];
  readonly rows: readonly GalleryRow[];
  readonly problems: readonly string[];
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A relative URL of a page-relative file path: each segment percent-encoded (tree case ids hold '#'). */
export const relativeUrl = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

export function galleryHtml(p: GalleryPage): string {
  for (const r of p.rows) if (r.cells.length !== p.columns.length) throw new Error(`${r.id}: ${r.cells.length} cells, ${p.columns.length} columns`);
  const cell = (c: GalleryCell): string => c.kind === 'image'
    ? `<td><img src="${esc(relativeUrl(c.src))}" width="${p.viewport.width}" height="${p.viewport.height}" alt="" loading="lazy"></td>`
    : `<td class="missing"><div style="width:${p.viewport.width}px;height:${p.viewport.height}px">${esc(c.reason)}</div></td>`;
  const rows = p.rows.map((r) => [
    `<tr><th colspan="${p.columns.length}" id="${esc(r.id)}"><a href="#${esc(r.id)}">${esc(r.id)}</a>`,
    `<div class="features">${r.features.map((f) => `<span>${esc(f)}</span>`).join('')}</div></th></tr>`,
    `<tr>${r.cells.map(cell).join('')}</tr>`,
  ].join('')).join('\n');
  const problems = p.problems.length === 0 ? '' : `<div class="problems"><strong>Problems in this run</strong><ul>${p.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Dragon native gallery</title>
<style>
body { margin: 24px; font: 14px/1.4 -apple-system, system-ui, sans-serif; color: #111; background: #f4f4f5; }
h1 { margin: 0 0 4px; font-size: 22px; }
.note { max-width: 70em; color: #333; }
.problems { background: #fee2e2; border: 1px solid #ef4444; padding: 8px 12px; margin: 12px 0; }
table { border-collapse: separate; border-spacing: 12px 0; margin-left: -12px; }
thead th { position: sticky; top: 0; background: #f4f4f5; text-align: left; padding: 8px 0; z-index: 1; }
thead th small { display: block; font-weight: normal; color: #555; }
tbody th { text-align: left; padding: 20px 0 6px; font: 600 15px ui-monospace, Menlo, monospace; }
tbody th a { color: inherit; text-decoration: none; }
.features { margin-top: 4px; font: 11px ui-monospace, Menlo, monospace; font-weight: normal; }
.features span { display: inline-block; background: #e4e4e7; border-radius: 3px; padding: 1px 5px; margin: 0 4px 3px 0; }
td { padding: 0; vertical-align: top; }
td img { display: block; outline: 1px solid #a1a1aa; background: #fff; }
td.missing div { display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 12px; box-sizing: border-box; background: #fafafa; outline: 1px dashed #a1a1aa; color: #b91c1c; }
</style>
</head>
<body>
<h1>Dragon native gallery</h1>
<p class="note">Each row is one parity case: the ${p.viewport.width}x${p.viewport.height} CSS px viewport as Chrome renders the authored HTML and as the compiled native views render on each device, scaled to the same size here. Text is set in Ahem, the test font whose glyphs are solid boxes, until real fonts land. These screenshots are evidence for people only; pass and fail come from the numeric checks (pnpm run parity:report and parity:lanes). Generated ${esc(p.generated)}; ${p.rows.length} case${p.rows.length === 1 ? '' : 's'}.</p>
${problems}
<table>
<thead><tr>${p.columns.map((c) => `<th>${esc(c.title)}<small>${esc(c.detail)}</small></th>`).join('')}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}

// ---------------------------------------------------------------- capture: every failure becomes a missing cell and a problem

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The screenshots of one column so far, and every problem met taking them. */
export type ColumnCapture = { readonly cells: Map<string, GalleryCell>; readonly problems: string[] };

export const newCapture = (): ColumnCapture => ({ cells: new Map(), problems: [] });

/** Marks every id without a cell as missing for reason, with one problem naming them. */
export function markMissing(cap: ColumnCapture, ids: readonly string[], who: string, reason: string): void {
  const left = ids.filter((id) => !cap.cells.has(id));
  if (left.length === 0) return;
  for (const id of left) cap.cells.set(id, { kind: 'missing', reason: `${who}: ${reason}` });
  cap.problems.push(`${who}: ${left.length} case(s) not taken (${reason})`);
}

/** Takes each id in turn: capture returns the page-relative image path, and a failure marks only that id missing. */
export async function captureEach(cap: ColumnCapture, ids: readonly string[], who: string, capture: (id: string) => Promise<string>): Promise<void> {
  for (const id of ids) {
    try {
      cap.cells.set(id, { kind: 'image', src: await capture(id) });
    } catch (e) {
      const reason = `${who}: ${id}: ${reasonOf(e)}`;
      cap.cells.set(id, { kind: 'missing', reason });
      cap.problems.push(reason);
    }
  }
}

/**
 * Runs ids in batches of size: runBatch shows a batch (and returns a problem to record, or null), then take captures each case
 * of it. A batch that throws marks its cases missing and the next batch still runs; cleanup runs after every batch.
 */
export async function captureInBatches(
  cap: ColumnCapture, ids: readonly string[], size: number, who: string,
  runBatch: (batch: readonly string[], index: number) => Promise<string | null>,
  take: (id: string, index: number) => Promise<string>,
  cleanup: (index: number) => void,
): Promise<void> {
  if (!Number.isInteger(size) || size <= 0) throw new Error(`batch size ${size} is not a positive integer`);
  for (let at = 0, index = 0; at < ids.length; at += size, index++) {
    const batch = ids.slice(at, at + size);
    try {
      const problem = await runBatch(batch, index);
      if (problem !== null) cap.problems.push(`${who}: cases ${at + 1}-${at + batch.length}: ${problem}`);
      await captureEach(cap, batch, who, (id) => take(id, index));
    } catch (e) {
      markMissing(cap, batch, who, `cases ${at + 1}-${at + batch.length}: ${reasonOf(e)}`);
    } finally {
      try {
        cleanup(index);
      } catch (e) {
        cap.problems.push(`${who}: cleanup after cases ${at + 1}-${at + batch.length}: ${reasonOf(e)}`);
      }
    }
  }
}

/**
 * Runs one whole column: fill takes the screenshots; any throw from it (launch, boot, a bug) marks the ids it did not take
 * missing, and so does its finishing without a cell for an id. close always runs, and a failure there is a problem too.
 */
export async function captureColumn(ids: readonly string[], who: string, fill: (cap: ColumnCapture) => Promise<void>, close: () => Promise<void>): Promise<ColumnCapture> {
  const cap = newCapture();
  try {
    await fill(cap);
  } catch (e) {
    markMissing(cap, ids, who, reasonOf(e));
  } finally {
    try {
      await close();
    } catch (e) {
      cap.problems.push(`${who}: cleanup: ${reasonOf(e)}`);
    }
  }
  markMissing(cap, ids, who, 'no screenshot taken');
  return cap;
}

/** 0 only when every cell of every row is an image and nothing went wrong. */
export function galleryExitCode(rows: readonly GalleryRow[], problems: readonly string[]): 0 | 1 {
  return problems.length === 0 && rows.every((r) => r.cells.length > 0 && r.cells.every((c) => c.kind === 'image')) ? 0 : 1;
}

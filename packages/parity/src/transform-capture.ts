// PNT2 (notes/T046-paint-spec.md §2): Chrome's transform geometry. The transform twin: in a page with a transformed element, the
// computed values are read on the untouched page, then every transformed element gets transform: none and will-change: transform
// (which keeps it the containing block and stacking context, so layout is unchanged) before the boxes are read, so the committed
// boxes are the untransformed layout boxes the engine produces. The quads capture: the computed transform string and the
// DOM.getContentQuads border-box quad (CSS px, viewport coordinates) of every transformed element on the untouched page, at DPR
// 1, 2, 3 and 2.625, committed under packages/parity/expected-quads/<platform>/dpr-<N>/<case>.json for pnt2-quads.test.ts by
// pnpm run parity:quads-capture (cli/quads-capture.ts).
import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';
import type { Environment } from 'dragon';

import type { ParityCase } from './cases.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';

/** The fixture group whose cases the quads capture covers (fixture-groups/transforms.ts). */
export const TRANSFORM_GROUP = 'transforms';

/** The DPRs of the quads capture: 1 and every device DPR (dpr.ts DPRS; pinned equal by pnt2-quads.test.ts). */
export const QUAD_DPRS: readonly number[] = [1, 2, 3, 2.625];

// capture.ts imports this module, and dpr.ts reaches capture.ts, so dpr.ts is imported where it is used, never at the top.
export const dprLabel = (dpr: number): string => `dpr-${dpr}`;

/**
 * The twin step of captureFixture (capture.ts): when an element's computed transform is not none, returns every element's computed
 * values for props read on the untouched page and applies the twin; returns null (and changes nothing) when no element is transformed.
 */
export async function applyTransformTwin(page: Page, props: readonly string[]): Promise<ReadonlyMap<string, { readonly [p: string]: string }> | null> {
  const computed = await page.evaluate((ps) => {
    const els = Array.from(document.querySelectorAll('[data-dragon-id]')) as HTMLElement[];
    const transformed = els.filter((el) => getComputedStyle(el).transform !== 'none');
    if (transformed.length === 0) return null;
    const out: [string, Record<string, string>][] = [];
    for (const el of els) {
      const cs = getComputedStyle(el);
      const values: Record<string, string> = {};
      for (const p of ps) values[p] = cs.getPropertyValue(p);
      out.push([el.getAttribute('data-dragon-id') as string, values]);
    }
    for (const el of transformed) {
      el.style.setProperty('transform', 'none', 'important');
      el.style.setProperty('will-change', 'transform', 'important');
    }
    return out;
  }, [...props]);
  if (computed === null) return null;
  const twin = await page.evaluate(() => Array.from(document.querySelectorAll('[data-dragon-id]')).filter((el) => getComputedStyle(el).transform !== 'none').map((el) => el.getAttribute('data-dragon-id')));
  if (twin.length > 0) throw new Error(`the transform twin left ${twin.join(', ')} transformed`);
  return new Map(computed);
}

/** One transformed element as Chrome reports it: its computed transform and its border-box quad (four corners, CSS px). */
export type CapturedQuad = { readonly id: string; readonly transform: string; readonly quad: readonly number[] };

export type QuadCapture = {
  readonly case: string;
  readonly chrome: string;
  readonly dpr: number;
  readonly direction: Environment['direction'];
  readonly nodes: readonly CapturedQuad[];
};

/** The computed transform and content quad of every transformed element of the untouched page, in document order. */
export async function captureTransformQuads(page: Page): Promise<CapturedQuad[]> {
  const transforms = await page.evaluate(() => Array.from(document.querySelectorAll('[data-dragon-id]')).map((el) => [el.getAttribute('data-dragon-id') as string, getComputedStyle(el).transform] as const));
  const cdp = await page.context().newCDPSession(page);
  try {
    const doc = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: '[data-dragon-id]' });
    if (nodeIds.length !== transforms.length) throw new Error(`CDP found ${nodeIds.length} elements, the page ${transforms.length}`);
    const out: CapturedQuad[] = [];
    for (const [i, nodeId] of nodeIds.entries()) {
      const [id, transform] = transforms[i] as readonly [string, string];
      const attrs = (await cdp.send('DOM.getAttributes', { nodeId })).attributes;
      const k = attrs.indexOf('data-dragon-id');
      if (k < 0 || attrs[k + 1] !== id) throw new Error(`CDP node ${i} is not ${id}`);
      if (transform === 'none') continue;
      const { quads } = await cdp.send('DOM.getContentQuads', { nodeId });
      if (quads.length !== 1 || quads[0]?.length !== 8) throw new Error(`${id}: expected one border-box quad, got ${JSON.stringify(quads)}`);
      out.push({ id, transform, quad: quads[0] });
    }
    return out;
  } finally {
    await cdp.detach();
  }
}

export const quadsDir = (dpr: number, platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-quads/${platform}/${dprLabel(dpr)}`);
export const quadsPath = (caseId: string, dpr: number, platform: string = REFERENCE_PLATFORM): string => `${quadsDir(dpr, platform)}/${caseId}.json`;
export const quadsJson = (q: QuadCapture): string => `${JSON.stringify(q, null, 2)}\n`;

/** A quads file's JSON checked field by field: the case and DPR it is named for, and per node an id, a transform and eight finite numbers. */
export function parseQuads(json: unknown, caseId: string, dpr: number): QuadCapture {
  const where = `expected-quads ${caseId} at DPR ${dpr}`;
  const o = json as { readonly [k: string]: unknown } | null;
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new Error(`${where}: not an object`);
  if (o['case'] !== caseId || o['dpr'] !== dpr) throw new Error(`${where}: the file names ${JSON.stringify(o['case'])} at DPR ${JSON.stringify(o['dpr'])}`);
  if (typeof o['chrome'] !== 'string' || (o['direction'] !== 'ltr' && o['direction'] !== 'rtl')) throw new Error(`${where}: no chrome version or direction`);
  if (!Array.isArray(o['nodes'])) throw new Error(`${where}: nodes is not a list`);
  for (const [i, n] of (o['nodes'] as unknown[]).entries()) {
    const x = n as { readonly [k: string]: unknown } | null;
    if (typeof x !== 'object' || x === null || typeof x['id'] !== 'string' || typeof x['transform'] !== 'string') throw new Error(`${where}: node ${i} has no id or transform`);
    const q = x['quad'];
    if (!Array.isArray(q) || q.length !== 8 || !q.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error(`${where}: node ${x['id']} has no quad of eight finite numbers`);
  }
  return o as unknown as QuadCapture;
}

/** The committed quads of a case at a DPR. */
export function committedQuads(caseId: string, dpr: number): QuadCapture {
  return parseQuads(JSON.parse(readFileSync(quadsPath(caseId, dpr), 'utf8')) as unknown, caseId, dpr);
}

/** The cases of the transforms fixture group. */
export async function transformCases(): Promise<ParityCase[]> {
  const { FIXTURE_GROUPS } = await import('./fixtures.ts');
  const group = FIXTURE_GROUPS.find((g) => g.id === TRANSFORM_GROUP);
  if (group === undefined) throw new Error(`no fixture group ${TRANSFORM_GROUP}`);
  const ids = new Set(group.fixtures.filter((f) => f.kind === 'layout').map((f) => f.id));
  const { layoutCases } = await import('./dpr.ts');
  return layoutCases().filter((f) => ids.has(f.spec.id)).flatMap((f) => [...f.cases]);
}

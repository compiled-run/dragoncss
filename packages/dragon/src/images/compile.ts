// REPL-a: the images of one compilation (R1). Every img src of every reachable case resolves to build-time bytes, a data: URL
// or a src the images option maps to a snapshot asset; a remote or unmapped src is DRAGON_REMOTE_IMAGE, and bytes REPL-a cannot
// draw are DRAGON_UNSUPPORTED_IMAGE naming the owning package. The manifest enters the compilation digest.
import type { ResolvedElement } from '../analysis/resolve.ts';
import { diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic, Origin } from '../types.ts';
import { buildImageManifest, manifestDigestInput } from './manifest.ts';
import type { ImageAssetMap, ImageEntry } from './manifest.ts';
import type { NaturalSize } from './natural-size.ts';

/** The images option is a plain object of src to snapshot asset id; null when it is well formed, else why not. */
export function imageMapProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) return 'images must be a plain object of src to snapshot asset id';
  for (const [src, id] of Object.entries(v)) if (typeof id !== 'string' || id.length === 0) return `images entry "${src}" must name a snapshot asset id`;
  return null;
}

/** The natural size of each drawable image src. */
export type ImageNaturals = ReadonlyMap<string, NaturalSize>;

export type CompiledImages = {
  readonly naturals: ImageNaturals;
  /** The value the compilation digest takes under images, or null when the project has no images and no images option. */
  readonly digestInput: unknown;
};

type ImgUse = { readonly el: ResolvedElement; readonly src: string | null };

function imgUses(roots: readonly ResolvedElement[]): ImgUse[] {
  const out: ImgUse[] = [];
  const walk = (el: ResolvedElement): void => {
    if (el.element.tag === 'img') out.push({ el, src: el.element.attributes.get('src') ?? null });
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

/** The origin of an element's attribute in the tree, or the element's own. */
function attributeOrigin(el: ResolvedElement, name: string): Origin {
  const a = el.element.node.attributes.find((b) => b.name === name);
  return a === undefined ? el.element.node.origin : a.origin;
}

/** Shortens a data: URL for a message. */
const shown = (src: string): string => (src.length > 64 ? `${src.slice(0, 48)}…` : src);

/**
 * Resolves every img of the cases, pushing a diagnostic per element and problem. assets: the snapshot's asset bytes by id. An
 * images entry naming an asset the snapshot lacks is DRAGON_CONFIG_INVALID.
 */
export function compileImages(roots: readonly ResolvedElement[], images: ImageAssetMap | undefined, assets: ReadonlyMap<string, Uint8Array>, diagnostics: Diagnostic[]): CompiledImages {
  const map = images ?? {};
  const uses = imgUses(roots);
  const missing = Object.entries(map).filter(([, id]) => !assets.has(id));
  for (const [src, id] of missing) {
    diagnostics.push(diagnostic('DRAGON_CONFIG_INVALID', { origin: { kind: 'unlocated', reason: 'configuration images' }, message: `images entry "${shown(src)}" names asset ${id}, which is not in the snapshot`, manual: 'Map the src to the id of an asset in the source snapshot.' }));
  }
  const usable: ImageAssetMap = Object.fromEntries(Object.entries(map).filter(([, id]) => assets.has(id)));
  const srcs = [...new Set(uses.flatMap((u) => (u.src === null ? [] : [u.src])))];
  const read = (id: string): Uint8Array => assets.get(id) as Uint8Array;
  const entries = new Map<string, ImageEntry>();
  const problems = new Map<string, string>();
  for (const src of srcs) {
    const r = buildImageManifest([src], usable, read);
    if (r.ok) entries.set(src, r.manifest.images[0] as ImageEntry);
    else problems.set(src, (r.problems[0] as { kind: string }).kind);
  }
  const reported = new Set<string>();
  const report = (u: ImgUse, code: 'DRAGON_REMOTE_IMAGE' | 'DRAGON_UNSUPPORTED_IMAGE', message: string, manual?: string): void => {
    const id = `${code}|${u.el.element.address}|${u.src ?? ''}`;
    if (reported.has(id)) return;
    reported.add(id);
    diagnostics.push(diagnostic(code, { origin: attributeOrigin(u.el, 'src'), message, ...(manual === undefined ? {} : { manual }) }));
  };
  const naturals = new Map<string, NaturalSize>();
  for (const u of uses) {
    const where = `<img> ${u.el.element.address}`;
    if (u.src === null) {
      report(u, 'DRAGON_UNSUPPORTED_IMAGE', `${where} has no src: Dragon draws an img only from a src it reads at build time`, 'Give the img a src: a data: URL, or a src the images option maps.');
      continue;
    }
    const problem = problems.get(u.src);
    if (problem === 'remote-image' || problem === 'unmapped-image') {
      report(u, 'DRAGON_REMOTE_IMAGE', `${where}: src ${shown(u.src)} is ${problem === 'remote-image' ? 'a remote URL' : 'not mapped'}; Dragon reads every image at build time`);
      continue;
    }
    if (problem !== undefined) {
      report(u, 'DRAGON_UNSUPPORTED_IMAGE', `${where}: src ${shown(u.src)} is a malformed data: URL`, 'Write a well-formed data: URL, for example data:image/png;base64,....');
      continue;
    }
    const e = entries.get(u.src) as ImageEntry;
    if (e.refusal !== null) {
      report(u, 'DRAGON_UNSUPPORTED_IMAGE', `${where}: ${e.refusal.reason}${e.refusal.package === null ? '' : ` (the ${e.refusal.package} package)`}`);
      continue;
    }
    if (e.naturalSize === null) throw new Error(`${where}: an accepted image has no natural size`);
    naturals.set(u.src, e.naturalSize);
  }
  const used = [...entries.values()].sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : 0));
  const digestInput = used.length === 0 && images === undefined ? null : { map: Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), manifest: manifestDigestInput({ version: 1, images: used }) };
  return { naturals, digestInput };
}

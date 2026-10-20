// REPL-a: the images of one compilation (R1). Every img src and background-image url() (BG2-u, R10) of every reachable case and
// state resolves to build-time bytes, a data: URL or a src the images option maps to a snapshot asset; a remote or unmapped src is
// DRAGON_REMOTE_IMAGE, and bytes REPL-a cannot draw are DRAGON_UNSUPPORTED_IMAGE naming the owning package. A url() resolves
// against its stylesheet's base, so a mapped src is read only from a <style> or a style attribute, whose base is the document's,
// as an img src's is; a data: URL is read anywhere. The manifest enters the compilation digest.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { imageItem, unfoldedLength, valueItems } from '../analysis/paint-values/gradient.ts';
import type { ResolvedElement } from '../analysis/resolve.ts';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic, Origin, Span } from '../types.ts';
import { buildImageManifest, manifestDigestInput, resolveImageSource } from './manifest.ts';
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
  /** The bytes of each drawable image src, which the native image paint embeds (lower/paint/image.ts). */
  readonly bytes: ReadonlyMap<string, Uint8Array>;
  /**
   * The data: URL web writes for each mapped background url() src: dragon.css is not where the document is, so the authored relative
   * src would resolve against the stylesheet's own URL there.
   */
  readonly webUrls: ReadonlyMap<string, string>;
  /** The value the compilation digest takes under images, or null when the project has no images and no images option. */
  readonly digestInput: unknown;
};

/**
 * One image use: an img's src, or a background-image url(). A url()'s base is the document's when every span of its value lies in
 * the element's own source (a <style> or style attribute); stylesheet names the other source; var means the url() may have come
 * through var(), whose custom property's sheet Dragon does not track.
 */
type ImgUse =
  | { readonly kind: 'img'; readonly el: ResolvedElement; readonly src: string | null }
  | { readonly kind: 'background'; readonly el: ResolvedElement; readonly src: string; readonly origin: Origin; readonly base: UrlBase };

/** unknown: the value has no authored span in a known source (the element's own origin is not authored). */
type UrlBase = { readonly kind: 'document' } | { readonly kind: 'stylesheet'; readonly uri: string } | { readonly kind: 'var' } | { readonly kind: 'unknown' };

/** The span of the url() token naming src inside an authored value span, or the value span when it cannot be found. */
function urlSpan(span: Span, src: string, sourceText: (uri: string) => string | undefined): Span {
  const text = sourceText(span.source.uri);
  if (text === undefined) return span;
  let found: Span | null = null;
  try {
    const walk = (n: CssNode): void => {
      if (found !== null) return;
      if (n.type === 'Url' && String(n['value']) === src && n.loc !== undefined && n.loc !== null) found = { source: span.source, start: span.start + n.loc.start.offset, end: span.start + n.loc.end.offset };
      const kids = (n as { children?: { forEach: (f: (c: CssNode) => void) => void } | null }).children;
      if (kids !== undefined && kids !== null) kids.forEach(walk);
    };
    walk(parse(text.slice(span.start, span.end), { context: 'value', positions: true }));
  } catch {
    return span;
  }
  return found ?? span;
}

function imgUses(roots: readonly ResolvedElement[], sourceText: (uri: string) => string | undefined): ImgUse[] {
  const out: ImgUse[] = [];
  // inherited: the parent's url() bases by src, which background-image: inherit takes, since Chrome resolves the url() at the parent.
  const walk = (el: ResolvedElement, inherited: ReadonlyMap<string, UrlBase>): void => {
    if (el.element.tag === 'img') out.push({ kind: 'img', el, src: el.element.attributes.get('src') ?? null });
    const v = el.props.get('background-image');
    const bases = new Map<string, UrlBase>();
    // A length compute could not fold is refused at the element (CALC-p) before the layers are read.
    if (v !== undefined && unfoldedLength(v.value) === null && !(v.value.kind === 'keyword')) {
      const doc = el.element.node.origin.kind === 'authored' ? el.element.node.origin.span.source.uri : null;
      const spans = [v.span, v.declaration?.valueSpan ?? null].filter((x): x is Span => x !== null);
      const foreign = spans.find((sp) => sp.source.uri !== doc);
      const inherits = v.substitution === undefined && v.declared?.kind === 'keyword' && v.declared.value === 'inherit';
      for (const item of valueItems(v.value)) {
        const i = imageItem(item);
        if (!i.ok || i.value.kind !== 'url') continue;
        const src = i.value.url;
        const at = v.declaration?.valueSpan ?? spans[0];
        const origin = at === undefined ? el.element.node.origin : authored(urlSpan(at, src, sourceText));
        const own: UrlBase = v.substitution !== undefined ? { kind: 'var' } : spans.length === 0 || doc === null ? { kind: 'unknown' } : foreign !== undefined ? { kind: 'stylesheet', uri: foreign.source.uri } : { kind: 'document' };
        const base = inherits ? (inherited.get(src) ?? { kind: 'unknown' }) : own;
        bases.set(src, base);
        out.push({ kind: 'background', el, src, origin, base });
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, bases);
  };
  for (const r of roots) walk(r, new Map());
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
 * Resolves every img and background url() of the resolved trees (every case, band and interaction state), pushing a diagnostic
 * per element and problem. assets: the snapshot's asset bytes by id. sourceText: a source's text by uri, to point a url()
 * diagnostic at its token. An images entry naming an asset the snapshot lacks is DRAGON_CONFIG_INVALID.
 */
export function compileImages(roots: readonly ResolvedElement[], images: ImageAssetMap | undefined, assets: ReadonlyMap<string, Uint8Array>, diagnostics: Diagnostic[], sourceText: (uri: string) => string | undefined = () => undefined): CompiledImages {
  const map = images ?? {};
  const uses = imgUses(roots, sourceText);
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
    const origin = u.kind === 'img' ? attributeOrigin(u.el, 'src') : u.origin;
    const id = `${code}|${u.kind}|${u.el.element.address}|${u.src ?? ''}|${JSON.stringify(origin)}`;
    if (reported.has(id)) return;
    reported.add(id);
    diagnostics.push(diagnostic(code, { origin, message, ...(manual === undefined ? {} : { manual }) }));
  };
  const naturals = new Map<string, NaturalSize>();
  const bytes = new Map<string, Uint8Array>();
  const webUrls = new Map<string, string>();
  for (const u of uses) {
    const where = u.kind === 'img' ? `<img> ${u.el.element.address}` : `background-image on ${u.el.element.address}`;
    const what = u.kind === 'img' ? 'src' : 'url()';
    if (u.src === null) {
      report(u, 'DRAGON_UNSUPPORTED_IMAGE', `${where} has no src: Dragon draws an img only from a src it reads at build time`, 'Give the img a src: a data: URL, or a src the images option maps.');
      continue;
    }
    const problem = problems.get(u.src);
    // A src the map names or leaves unmapped is relative to its stylesheet's base; only a data: URL or a remote URL needs none.
    const relative = problem === 'unmapped-image' || (problem === undefined && resolveImageSource(u.src, usable, read).kind === 'mapped');
    if (u.kind === 'background' && u.base.kind !== 'document' && relative) {
      const why = u.base.kind === 'stylesheet' ? `it is in the stylesheet ${u.base.uri}, whose base is not the document's` : u.base.kind === 'var' ? 'it reaches background-image through var(), so Dragon cannot tell which stylesheet\'s base it resolves against' : 'its value has no authored source in the document';
      report(u, 'DRAGON_REMOTE_IMAGE', `${where}: url() ${shown(u.src)} is not read: ${why}; Dragon maps an image src relative to the document only (a <style> or a style attribute, as an <img> src)`, 'Write the image as a data: URL, or move the declaration into a <style> or style attribute and map its src with the images option.');
      continue;
    }
    if (problem === 'remote-image' || problem === 'unmapped-image') {
      report(u, 'DRAGON_REMOTE_IMAGE', `${where}: ${what} ${shown(u.src)} is ${problem === 'remote-image' ? 'a remote URL' : 'not mapped'}; Dragon reads every image at build time`);
      continue;
    }
    if (problem !== undefined) {
      report(u, 'DRAGON_UNSUPPORTED_IMAGE', `${where}: ${what} ${shown(u.src)} is a malformed data: URL`, 'Write a well-formed data: URL, for example data:image/png;base64,....');
      continue;
    }
    const e = entries.get(u.src) as ImageEntry;
    if (e.refusal !== null) {
      report(u, 'DRAGON_UNSUPPORTED_IMAGE', `${where}: ${e.refusal.reason}${e.refusal.package === null ? '' : ` (the ${e.refusal.package} package)`}`);
      continue;
    }
    if (e.naturalSize === null) throw new Error(`${where}: an accepted image has no natural size`);
    naturals.set(u.src, e.naturalSize);
    const resolved = resolveImageSource(u.src, usable, read);
    if (resolved.kind !== 'data' && resolved.kind !== 'mapped') throw new Error(`${where}: an accepted src no longer resolves`);
    bytes.set(u.src, resolved.bytes);
    if (u.kind === 'background' && resolved.kind === 'mapped') {
      if (e.format !== 'png' && e.format !== 'jpeg') throw new Error(`${where}: an accepted image is ${e.format ?? 'of no format'}`);
      webUrls.set(u.src, `data:image/${e.format};base64,${base64Encode(resolved.bytes)}`);
    }
  }
  const used = [...entries.values()].sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : 0));
  const digestInput = used.length === 0 && images === undefined ? null : { map: Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), manifest: manifestDigestInput({ version: 1, images: used }) };
  return { naturals, bytes, webUrls, digestInput };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** RFC 4648 base64 with padding, for the image bytes the native case code embeds. */
export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    const n = (a << 16) | (b << 8) | c;
    out += (B64[(n >> 18) & 63] as string) + (B64[(n >> 12) & 63] as string);
    out += i + 1 < bytes.length ? (B64[(n >> 6) & 63] as string) : '=';
    out += i + 2 < bytes.length ? (B64[n & 63] as string) : '=';
  }
  return out;
}

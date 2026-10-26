// MEDIA-EL: the videos of one compilation. A <video> with a src Chrome loads (any preload but none) is sized by its stream's natural
// size, so Dragon reads the bytes at build time: the src must be a data:video/mp4 URL that videos/mp4.ts accepts. A video without
// a src, or with preload none, never loads its metadata without playback and keeps the default object size (300x150).
// Chrome paints the stream's first frame; the platform player the lowering mounts (lower/paint/foreign-view.ts) shows it too, which
// the device lanes prove by opening the stream and sampling the frame against Chrome's (MEDIA-EL slice 2, replaced-video-frame).
// A native target mounts that player only where its profile carries the device-proven row (project.ts gateVideoStreams).
import type { ResolvedElement } from '../analysis/resolve.ts';
import { diagnostic } from '../diagnostics/catalogue.ts';
import { parseDataUrl } from '../images/manifest.ts';
import type { NaturalSize } from '../images/natural-size.ts';
import type { Diagnostic, Origin } from '../types.ts';
import { parseMp4 } from './mp4.ts';

export type CompiledVideos = {
  /** The natural size of each video src Chrome loads. */
  readonly naturals: ReadonlyMap<string, NaturalSize>;
  /** The MP4 bytes of each such src, which the native player plays (lower/paint/video-view.ts). */
  readonly bytes: ReadonlyMap<string, Uint8Array>;
  /**
   * Each video element with a stream Chrome loads, once per element and src, for the native gate (project.ts gateVideoStreams):
   * untagged as Mp4Facts says.
   */
  readonly streams: readonly { readonly address: string; readonly origin: Origin; readonly untagged: string | null }[];
};

/**
 * HTML §4.8.11.2 preload: an enumerated attribute whose missing and invalid value defaults are user-agent defined (Chrome 145:
 * metadata) and whose none keyword, ASCII case-insensitive, loads nothing until playback (Chrome 145 probes, MEDIA-EL: preload="NONE"
 * keeps 300x150, preload="", "bogus" and "metadata" load the stream).
 */
export function videoLoads(el: Pick<ResolvedElement, 'element'>): boolean {
  const preload = el.element.attributes.get('preload');
  return el.element.attributes.has('src') && (preload === undefined || preload.toLowerCase() !== 'none');
}

/** The MIME type essence of a data: URL's type: before any parameter, lowercased (RFC 2045 §5.1). */
const essence = (type: string | null): string | null => (type === null ? null : (type.split(';')[0] as string).trim().toLowerCase());

/** Shortens a data: URL for a message. */
const shown = (src: string): string => (src.length > 64 ? `${src.slice(0, 48)}…` : src);

/** Why a video src cannot compile, or its natural size and bytes. */
export function readVideoSource(src: string): { readonly ok: true; readonly natural: NaturalSize; readonly bytes: Uint8Array; readonly untagged: string | null } | { readonly ok: false; readonly reason: string; readonly manual: string } {
  const manual = 'Give the video a data:video/mp4;base64 src of an H.264 MP4 (Baseline, Main or High, 8-bit 4:2:0, square pixels).';
  if (!/^\s*data:/i.test(src)) return { ok: false, reason: `its src ${shown(src)} is not a data: URL; Dragon reads every video at build time to size it as Chrome does from its stream`, manual };
  const d = parseDataUrl(src);
  if (d === null) return { ok: false, reason: `its src ${shown(src)} is a malformed data: URL`, manual };
  // Chrome 145 refuses a data: URL whose type is not a media type it plays (an MP4 as text/plain is MEDIA_ERR_SRC_NOT_SUPPORTED).
  if (essence(d.type) !== 'video/mp4') return { ok: false, reason: `its src is a data: URL of type ${d.type === null ? 'text/plain (none given)' : d.type}; Dragon reads video/mp4 only`, manual };
  const mp4 = parseMp4(d.bytes);
  if (!mp4.ok) return { ok: false, reason: `its src does not compile: ${mp4.reason}`, manual };
  return { ok: true, natural: { width: mp4.facts.width, height: mp4.facts.height }, bytes: d.bytes, untagged: mp4.facts.untagged };
}

function videoUses(roots: readonly ResolvedElement[]): ResolvedElement[] {
  const out: ResolvedElement[] = [];
  const walk = (el: ResolvedElement): void => {
    if (el.element.tag === 'video') out.push(el);
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

function srcOrigin(el: ResolvedElement): Origin {
  const a = el.element.node.attributes.find((b) => b.name === 'src');
  return a === undefined ? el.element.node.origin : a.origin;
}

/** Reads the src of every video of the cases that Chrome loads, pushing one DRAGON_UNSUPPORTED_ATTRIBUTE per element and problem. */
export function compileVideos(roots: readonly ResolvedElement[], diagnostics: Diagnostic[]): CompiledVideos {
  const naturals = new Map<string, NaturalSize>();
  const bytes = new Map<string, Uint8Array>();
  const streams: CompiledVideos['streams'][number][] = [];
  const reported = new Set<string>();
  for (const el of videoUses(roots)) {
    if (!videoLoads(el)) continue;
    const src = el.element.attributes.get('src') as string;
    const read = readVideoSource(src);
    const id = `${el.element.address}|${src}`;
    const first = !reported.has(id);
    reported.add(id);
    if (read.ok) {
      naturals.set(src, read.natural);
      bytes.set(src, read.bytes);
      if (first) streams.push({ address: el.element.address, origin: srcOrigin(el), untagged: read.untagged });
      continue;
    }
    if (!first) continue;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_ATTRIBUTE', { origin: srcOrigin(el), message: `attribute src on ${el.element.address} is not supported: ${read.reason}`, manual: read.manual }));
  }
  return { naturals, bytes, streams };
}

// REPL-a Phase B (R9): an iframe is a slot Dragon lays out, holding the platform's own web view (WKWebView, android.webkit.WebView)
// over its content box. The lowering records the src, which the web view loads (an absolute https URL, the only kind the
// compiler accepts); the parity lane and test hosts never load network content, so they set dragonForeignViewLoadsSrc false and
// their web views load about:blank.
// MEDIA-EL: a video Chrome loads is a platform player (AVPlayerLayer, a TextureView a MediaPlayer renders into) over the engine's
// destination rect, clipped to the content box as Chrome clips it; the part of the box its stream does not cover stays
// transparent, as in Chrome. The lowering embeds the MP4 bytes the build read (videos/compile.ts) and its natural size. A video
// without a stream (no src, or preload none) has no player: Chrome paints nothing in its box.
import { iframeSrcUrl } from '../../analysis/elements/replaced.ts';
import { base64Encode } from '../../images/compile.ts';
import { videoLoads } from '../../videos/compile.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type ForeignViewWrite = {
  readonly kind: 'foreign-view';
  /** The iframe's src, or null for none. */
  readonly src: string | null;
};

export type VideoViewWrite = {
  readonly kind: 'video-view';
  /** The MP4 bytes, base64. */
  readonly data: string;
  /** The stream's natural size in CSS px. */
  readonly width: number;
  readonly height: number;
};

export const FOREIGN_VIEW_LOWERING: PaintLowering<ForeignViewWrite | VideoViewWrite> = {
  name: 'foreign-view',
  vocabulary: {
    uikit: {
      'foreign-view': { key: 'dragonForeignView', technique: 'native-property', detail: 'a WKWebView (allowsInlineMediaPlayback true, mediaTypesRequiringUserActionForPlayback []) as a subview over the content box; frame in points relative to the box' },
      'video-view': { key: 'dragonVideoView', technique: 'native-property', detail: 'an AVPlayerLayer-backed view (videoGravity resize) at the destination rect inside a clipping view over the content box; frames in points relative to the box and the clip' },
    },
    'android-views': {
      'foreign-view': { key: 'dragonForeignView', technique: 'native-property', detail: 'an android.webkit.WebView (javaScriptEnabled true, mediaPlaybackRequiresUserGesture false) as a child over the content box; frame in device px relative to the box' },
      'video-view': { key: 'dragonVideoView', technique: 'native-property', detail: 'an android.view.TextureView a MediaPlayer renders into, at the destination rect inside a clipping Dragon group over the content box; frames in device px relative to the box and the group' },
    },
  },
  css: { 'foreign-view': [], 'video-view': ['object-fit', 'object-position'] },
  lower: ({ box, el, images }) => {
    if (box.kind === 'replaced' && el !== null && el.element.tag === 'video') {
      if (!videoLoads(el)) return [];
      if (box.natural.kind !== 'image') throw new ProgramError(`${box.id}: a video leaf with a stream but no natural size`);
      const bytes = images.get(el.element.attributes.get('src') as string);
      if (bytes === undefined) throw new ProgramError(`${box.id}: no video bytes for its src`);
      return [{ kind: 'video-view', data: base64Encode(bytes), width: box.natural.width, height: box.natural.height }];
    }
    if (box.kind !== 'replaced' || el === null || el.element.tag !== 'iframe') return [];
    const raw = el.element.attributes.get('src');
    if (raw === undefined) return [{ kind: 'foreign-view', src: null }];
    // checkTemplates refuses any other src, so a compiled iframe's src is always an absolute https URL.
    const src = iframeSrcUrl(raw);
    if (src === null) throw new ProgramError(`${el.element.address}: iframe src ${JSON.stringify(raw)} reached lowering unrefused`);
    return [{ kind: 'foreign-view', src }];
  },
};

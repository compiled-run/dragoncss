// REPL-a Phase B (R9): an iframe is a slot Dragon lays out, holding the platform's own web view (WKWebView, android.webkit.WebView)
// over its content box. The lowering records the src, which the web view loads (an absolute http or https URL, the only kind the
// compiler accepts); the parity lane and test hosts never load network content, so they set dragonForeignViewLoadsSrc false and
// their web views load about:blank.
import { iframeSrcUrl } from '../../analysis/elements/replaced.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type ForeignViewWrite = {
  readonly kind: 'foreign-view';
  /** The iframe's src, or null for none. */
  readonly src: string | null;
};

export const FOREIGN_VIEW_LOWERING: PaintLowering<ForeignViewWrite> = {
  name: 'foreign-view',
  vocabulary: {
    uikit: { 'foreign-view': { key: 'dragonForeignView', technique: 'native-property', detail: 'a WKWebView (allowsInlineMediaPlayback true, mediaTypesRequiringUserActionForPlayback []) as a subview over the content box; frame in points relative to the box' } },
    'android-views': { 'foreign-view': { key: 'dragonForeignView', technique: 'native-property', detail: 'an android.webkit.WebView (javaScriptEnabled true, mediaPlaybackRequiresUserGesture false) as a child over the content box; frame in device px relative to the box' } },
  },
  css: { 'foreign-view': [] },
  lower: ({ box, el }) => {
    if (box.kind !== 'replaced' || el === null || el.element.tag !== 'iframe') return [];
    const raw = el.element.attributes.get('src');
    if (raw === undefined) return [{ kind: 'foreign-view', src: null }];
    // checkTemplates refuses any other src, so a compiled iframe's src is always an absolute http or https URL.
    const src = iframeSrcUrl(raw);
    if (src === null) throw new ProgramError(`${el.element.address}: iframe src ${JSON.stringify(raw)} reached lowering unrefused`);
    return [{ kind: 'foreign-view', src }];
  },
};

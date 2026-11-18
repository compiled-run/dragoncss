// The Chrome comparison of an export with system faces: Chrome on the Mac draws each target's system faces with the same font
// files the export measured. Android's files (from the SDK image) load as web fonts; iOS's named faces load with local() from the
// Mac's own copies, and system-ui stays Chrome's system-ui (the Mac's San Francisco, whose Core Text widths equal iOS's).
import type { Page } from 'playwright';
import type { NativeStyleTarget, SystemFaceRole } from 'dragon';
import { fontDataUrl } from '../font-reference.ts';
import { applyFontReference } from '../font-reference.ts';
import type { SystemFontEntry } from '../native-style-export.ts';
import { AndroidSystemFiles } from './android.ts';
import { systemRequestOf } from './provider.ts';

const quote = (s: string): string => `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`;

/** The page preparation for one target: @font-face rules per used system face, and the generics rewritten to their families. */
export function systemFontReference(target: NativeStyleTarget, entries: readonly SystemFontEntry[], files: () => AndroidSystemFiles = () => new AndroidSystemFiles()): (page: Page) => Promise<void> {
  const rules: string[] = [];
  const families = new Map<SystemFaceRole, string>();
  for (const e of entries) {
    const r = systemRequestOf(e.id);
    if (r === null) throw new Error(`${e.id} is not a system face`);
    const family = `Dragon ${target} ${r.role}`;
    const descriptors = `font-family:${quote(family)};font-weight:${r.weight};font-style:${r.style}`;
    if (target === 'android') {
      const d = e.android;
      if (d === undefined) throw new Error(`${e.id} has no Android face`);
      const file = files().read(`/system/fonts/${d.file}`);
      if (file.sha256 !== d.sha256) throw new Error(`${e.id}: /system/fonts/${d.file} is ${file.sha256} now, the export measured ${d.sha256}`);
      if (d.index !== 0) throw new Error(`${e.id}: face ${d.index} of a collection, which Chrome's @font-face cannot name`);
      rules.push(`@font-face{${descriptors};src:url("${fontDataUrl(file.bytes)}")}`);
    } else {
      const d = e.ios;
      if (d === undefined) throw new Error(`${e.id} has no iOS face`);
      // Chrome's own system-ui is the system face; a role played by it keeps that keyword.
      if (d.face.kind === 'system') {
        if (r.role !== 'system-ui' || d.face.design !== 'default') throw new Error(`${e.id}: Chrome has no way to draw the system font's ${d.face.design} design as ${r.role}`);
        continue;
      }
      if (d.face.kind === 'data') throw new Error(`${e.id}: a system face is never an author file`);
      rules.push(`@font-face{${descriptors};src:local(${quote(d.face.postScriptName)})}`);
    }
    families.set(r.role, family);
  }
  const { default: initial, ...generics } = Object.fromEntries(families) as Partial<Record<SystemFaceRole, string>>;
  // A text with no font-family is the browser's default font: the root's family stands in for Chrome's own default.
  if (initial !== undefined) rules.push(`:where(html){font-family:${quote(initial)}}`);
  return async (page) => {
    await applyFontReference(page, rules.join('\n'), generics as Record<string, string>);
  };
}

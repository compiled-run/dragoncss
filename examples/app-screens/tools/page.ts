// Reads a real page (plain HTML a developer writes) into the parity fixture subset: every element gets a data-dragon-id and
// boolean attributes get an explicit empty value. Offsets change, so diagnostics are reported against the prepared text.
import { readFileSync } from 'node:fs';

const VOID = new Set(['img', 'input', 'br', 'meta', 'link', 'hr']);

export function preparePage(html: string): string {
  const used = new Map<string, number>();
  let inStyle = false;
  return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (m, close: string, tag: string, rest: string) => {
    tag = tag.toLowerCase();
    if (tag === 'style') inStyle = close === '';
    if (close !== '' || inStyle && tag !== 'style' || ['head', 'meta', 'title', 'style', 'link'].includes(tag)) return m;
    let attrs = rest.replace(/\s*\/$/, '');
    // Boolean attributes: name with no value becomes name="".
    attrs = attrs.replace(/(\s)([a-zA-Z-]+)(="[^"]*")?/g, (_m, sp: string, name: string, value: string | undefined) => `${sp}${name}${value ?? '=""'}`);
    const cls = /class="([^"]*)"/.exec(attrs)?.[1]?.split(/\s+/)[0];
    const base = cls !== undefined && cls !== '' ? cls : tag;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    return `<${tag}${attrs} data-dragon-id="${id}">`;
  }).replace(/<(img|input|br|hr|meta|link)\b([^>]*)\/>/g, '<$1$2>');
}

export const readPage = (path: string): string => preparePage(readFileSync(path, 'utf8'));
export { VOID };

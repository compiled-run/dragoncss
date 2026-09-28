// A small namespace-aware XML parser for WPT's XHTML (.xht, .xhtml) and XML tests: elements, attributes, text, CDATA,
// comments, processing instructions (<?xml-stylesheet?> is kept) and a DOCTYPE with an internal subset of general entities.
// Documents that declare an XHTML DOCTYPE get the HTML named character references, as Chrome's XML parser does for them.
// Anything not well-formed throws an XmlError; Chrome shows an error page for such a file, so the test is refused.
import { parseFragment } from 'parse5';
import type { DomDocument, DomElement, DomNode } from './dom.ts';

export class XmlError extends Error {}

const NAME = /^[A-Za-z_:À-￯][-A-Za-z0-9_:.·À-￯]*/;
const PREDEFINED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** Public ids Chrome maps to its XHTML entity set (libxml's predefined XHTML DTDs). */
const XHTML_PUBLIC = /^-\/\/W3C\/\/DTD (XHTML|XHTML Basic|XHTML 1\.1 plus MathML 2\.0|XHTML 1\.1 plus MathML 2\.0 plus SVG 1\.1|MathML 2\.0)/;

const htmlEntityCache = new Map<string, string | null>();
/** An HTML named character reference ("nbsp"), through parse5's decoder; null when it is not one. */
function htmlEntity(name: string): string | null {
  const hit = htmlEntityCache.get(name);
  if (hit !== undefined) return hit;
  const frag = parseFragment(`&${name};`);
  const t = frag.childNodes[0];
  const value = t !== undefined && t.nodeName === '#text' && (t as { value: string }).value !== `&${name};` ? (t as { value: string }).value : null;
  htmlEntityCache.set(name, value);
  return value;
}

export function parseXmlDocument(source: string): DomDocument {
  const s = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let i = 0;
  const entities = new Map<string, string>();
  let xhtmlEntities = false;
  const fail = (what: string): never => {
    throw new XmlError(`${what} at offset ${i}`);
  };

  const decode = (text: string, inAttribute: boolean): string => {
    let out = '';
    let k = 0;
    while (k < text.length) {
      const amp = text.indexOf('&', k);
      if (amp < 0) {
        out += text.slice(k);
        break;
      }
      out += text.slice(k, amp);
      const semi = text.indexOf(';', amp);
      if (semi < 0) fail('unterminated character reference');
      const ref = text.slice(amp + 1, semi);
      if (ref.startsWith('#x')) out += String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
      else if (ref.startsWith('#')) out += String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
      else if (PREDEFINED[ref] !== undefined) out += PREDEFINED[ref];
      else if (entities.has(ref)) out += decode(entities.get(ref) as string, inAttribute);
      else {
        const h = xhtmlEntities ? htmlEntity(ref) : null;
        if (h === null) fail(`undefined entity &${ref};`);
        out += h;
      }
      k = semi + 1;
    }
    return inAttribute ? out.replace(/[\t\n\r]/g, ' ') : out;
  };

  const skipSpace = (): void => {
    while (i < s.length && /\s/.test(s[i] as string)) i++;
  };
  const expect = (lit: string): void => {
    if (!s.startsWith(lit, i)) fail(`expected ${JSON.stringify(lit)}`);
    i += lit.length;
  };
  const name = (): string => {
    const m = NAME.exec(s.slice(i, i + 256));
    if (m === null) fail('expected a name');
    i += (m as RegExpExecArray)[0].length;
    return (m as RegExpExecArray)[0];
  };
  const quoted = (): string => {
    const q = s[i];
    if (q !== '"' && q !== "'") fail('expected a quoted value');
    const end = s.indexOf(q as string, i + 1);
    if (end < 0) fail('unterminated quoted value');
    const v = s.slice(i + 1, end);
    i = end + 1;
    return v;
  };

  const stylesheetPIs: { href: string; media: string; alternate: boolean }[] = [];
  let rootSeen = false;
  /** Comments, PIs and (before the root) the DOCTYPE; returns false when the next thing is not one of them. */
  const misc = (): boolean => {
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end < 0) fail('unterminated comment');
      i = end + 3;
      return true;
    }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end < 0) fail('unterminated processing instruction');
      const body = s.slice(i + 2, end);
      const target = /^\S+/.exec(body)?.[0] ?? '';
      if (target === 'xml-stylesheet' && !rootSeen) {
        const pseudo = new Map<string, string>();
        for (const m of body.slice(target.length).matchAll(/([a-z-]+)\s*=\s*(["'])(.*?)\2/g)) pseudo.set(m[1] as string, decode(m[3] as string, true));
        const type = pseudo.get('type') ?? 'text/css';
        if (pseudo.has('href') && type === 'text/css') stylesheetPIs.push({ href: pseudo.get('href') as string, media: pseudo.get('media') ?? 'all', alternate: pseudo.get('alternate') === 'yes' });
      }
      i = end + 2;
      return true;
    }
    if (!rootSeen && s.startsWith('<!DOCTYPE', i)) {
      i += 9;
      skipSpace();
      name();
      skipSpace();
      if (s.startsWith('PUBLIC', i)) {
        i += 6;
        skipSpace();
        const pub = quoted();
        if (XHTML_PUBLIC.test(pub)) xhtmlEntities = true;
        skipSpace();
        if (s[i] === '"' || s[i] === "'") quoted();
      } else if (s.startsWith('SYSTEM', i)) {
        i += 6;
        skipSpace();
        quoted();
      }
      skipSpace();
      if (s[i] === '[') {
        const end = s.indexOf(']', i);
        if (end < 0) fail('unterminated internal subset');
        for (const m of s.slice(i + 1, end).matchAll(/<!ENTITY\s+([^\s%]+)\s+(["'])([\s\S]*?)\2\s*>/g)) entities.set(m[1] as string, m[3] as string);
        i = end + 1;
        skipSpace();
      }
      expect('>');
      return true;
    }
    if (/\s/.test(s[i] ?? '')) {
      skipSpace();
      return true;
    }
    return false;
  };

  const element = (scopes: readonly ReadonlyMap<string, string>[]): DomElement => {
    expect('<');
    const qname = name();
    const attrs: [string, string][] = [];
    const seen = new Set<string>();
    for (;;) {
      const before = i;
      skipSpace();
      if (s.startsWith('/>', i) || s[i] === '>') break;
      if (i === before) fail('expected whitespace before an attribute');
      const an = name();
      skipSpace();
      expect('=');
      skipSpace();
      const value = decode(quoted(), true);
      if (seen.has(an)) fail(`duplicate attribute ${an}`);
      seen.add(an);
      attrs.push([an, value]);
    }
    const scope = new Map<string, string>();
    for (const [an, v] of attrs) {
      if (an === 'xmlns') scope.set('', v);
      else if (an.startsWith('xmlns:')) scope.set(an.slice(6), v);
    }
    const all = scope.size === 0 ? scopes : [...scopes, scope];
    const lookup = (prefix: string): string | null => {
      if (prefix === 'xml') return XML_NS;
      for (let k = all.length - 1; k >= 0; k--) {
        const v = (all[k] as ReadonlyMap<string, string>).get(prefix);
        if (v !== undefined) return v;
      }
      return prefix === '' ? '' : null;
    };
    const colon = qname.indexOf(':');
    const prefix = colon < 0 ? '' : qname.slice(0, colon);
    const ns = lookup(prefix);
    if (ns === null) fail(`undeclared namespace prefix ${prefix}`);
    const tag = colon < 0 ? qname : qname.slice(colon + 1);
    const children: DomNode[] = [];
    const pushText = (t: string): void => {
      if (t === '') return;
      const last = children[children.length - 1];
      if (last !== undefined && 'text' in last) children[children.length - 1] = { text: last.text + t };
      else children.push({ text: t });
    };
    if (s.startsWith('/>', i)) {
      i += 2;
      return { tag, ns: ns as string, attrs, children };
    }
    expect('>');
    for (;;) {
      if (i >= s.length) fail(`unclosed <${qname}>`);
      if (s.startsWith('</', i)) {
        i += 2;
        const close = name();
        if (close !== qname) fail(`mismatched </${close}> for <${qname}>`);
        skipSpace();
        expect('>');
        return { tag, ns: ns as string, attrs, children };
      }
      if (s.startsWith('<![CDATA[', i)) {
        const end = s.indexOf(']]>', i);
        if (end < 0) fail('unterminated CDATA section');
        pushText(s.slice(i + 9, end));
        i = end + 3;
        continue;
      }
      if (s.startsWith('<!--', i) || s.startsWith('<?', i)) {
        misc();
        continue;
      }
      if (s[i] === '<') {
        children.push(element(all));
        continue;
      }
      const next = s.indexOf('<', i);
      const end = next < 0 ? s.length : next;
      pushText(decode(s.slice(i, end), false));
      i = end;
    }
  };

  while (i < s.length && misc());
  if (s[i] !== '<') fail('no root element');
  rootSeen = true;
  const root = element([]);
  while (i < s.length && misc());
  if (i < s.length) fail('content after the root element');
  return { root, stylesheetPIs, origin: 'xml' };
}

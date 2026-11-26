// Android's /system/etc/fonts.xml (frameworks/base/data/fonts/fonts.xml, parsed by FontListParser.java): each named family's
// fonts, each a file with its weight, style, collection index and variation axis values, and the aliases to them.

export type FontsXmlFont = {
  readonly file: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
  /** The face index in a font collection (.ttc); 0 for a single font. */
  readonly index: number;
  /** Each variation axis the font is set to, by tag, as fonts.xml lists them (stylevalue). */
  readonly axes: Readonly<Record<string, number>>;
  readonly postScriptName: string | null;
  /** fallbackFor: the one named family this font of a fallback family serves (a serif-only fallback); null for any. */
  readonly fallbackFor: string | null;
};
export type FontsXmlFamily = { readonly name: string; readonly fonts: readonly FontsXmlFont[] };
/** An unnamed family: the fallback chain, in file order, each with the languages and variant it serves. */
export type FontsXmlFallback = { readonly lang: readonly string[]; readonly variant: string | null; readonly fonts: readonly FontsXmlFont[] };
export type FontsXml = { readonly families: ReadonlyMap<string, FontsXmlFamily>; readonly fallbacks: readonly FontsXmlFallback[]; readonly aliases: ReadonlyMap<string, { readonly to: string; readonly weight: number | null }> };

type XmlElement = { readonly name: string; readonly attributes: ReadonlyMap<string, string>; readonly children: readonly (XmlElement | string)[] };

const fail = (what: string): never => {
  throw new Error(`fonts.xml: ${what}`);
};

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c !== '&') {
      out += c;
      continue;
    }
    const end = s.indexOf(';', i);
    if (end < 0) fail(`an unterminated character reference in ${JSON.stringify(s)}`);
    const name = s.slice(i + 1, end);
    const named = ENTITIES[name];
    if (named !== undefined) out += named;
    else if (name.startsWith('#x')) out += String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    else if (name.startsWith('#')) out += String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    else fail(`the entity &${name}; is not one of XML's`);
    i = end;
  }
  return out;
}

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isNameChar = (c: string | undefined): boolean => c !== undefined && !isSpace(c) && c !== '=' && c !== '>' && c !== '/' && c !== '<' && c !== '"' && c !== "'";

/** A small, strict XML 1.0 reader for fonts.xml: elements, attributes, text, comments and the declaration; no DTD. */
export function parseXml(text: string): XmlElement {
  let i = 0;
  const expect = (s: string): void => {
    if (!text.startsWith(s, i)) fail(`expected ${JSON.stringify(s)} at ${i}`);
    i += s.length;
  };
  const skipSpace = (): void => {
    while (isSpace(text[i])) i++;
  };
  const name = (): string => {
    const start = i;
    while (isNameChar(text[i])) i++;
    if (i === start) fail(`expected a name at ${start}`);
    return text.slice(start, i);
  };
  const misc = (): void => {
    for (;;) {
      skipSpace();
      if (text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i + 4);
        if (end < 0) fail('an unterminated comment');
        i = end + 3;
      } else if (text.startsWith('<?', i)) {
        const end = text.indexOf('?>', i + 2);
        if (end < 0) fail('an unterminated processing instruction');
        i = end + 2;
      } else if (text.startsWith('<!', i)) fail(`a DTD or CDATA section at ${i}, which fonts.xml does not have`);
      else return;
    }
  };
  const element = (): XmlElement => {
    expect('<');
    const tag = name();
    const attributes = new Map<string, string>();
    for (;;) {
      skipSpace();
      if (text.startsWith('/>', i)) {
        i += 2;
        return { name: tag, attributes, children: [] };
      }
      if (text[i] === '>') {
        i++;
        break;
      }
      const key = name();
      skipSpace();
      expect('=');
      skipSpace();
      const quote = text[i];
      if (quote !== '"' && quote !== "'") fail(`attribute ${key} of <${tag}> is not quoted`);
      const end = text.indexOf(quote as string, i + 1);
      if (end < 0) fail(`attribute ${key} of <${tag}> is unterminated`);
      if (attributes.has(key)) fail(`<${tag}> has the attribute ${key} twice`);
      attributes.set(key, decodeText(text.slice(i + 1, end)));
      i = end + 1;
    }
    const children: (XmlElement | string)[] = [];
    for (;;) {
      if (i >= text.length) fail(`<${tag}> is not closed`);
      if (text.startsWith('</', i)) {
        i += 2;
        if (name() !== tag) fail(`</…> at ${i} does not close <${tag}>`);
        skipSpace();
        expect('>');
        return { name: tag, attributes, children };
      }
      if (text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i + 4);
        if (end < 0) fail('an unterminated comment');
        i = end + 3;
      } else if (text[i] === '<') children.push(element());
      else {
        const end = text.indexOf('<', i);
        children.push(decodeText(text.slice(i, end < 0 ? text.length : end)));
        i = end < 0 ? text.length : end;
      }
    }
  };
  misc();
  const root = element();
  misc();
  if (i !== text.length) fail(`content after the root element at ${i}`);
  return root;
}

const intAttr = (e: XmlElement, key: string, fallback: number | null): number => {
  const v = e.attributes.get(key);
  if (v === undefined) return fallback ?? fail(`<${e.name}> has no ${key}`);
  const n = Number(v);
  if (!Number.isInteger(n) || v.trim() === '') fail(`<${e.name}> ${key}="${v}" is not an integer`);
  return n;
};

/** fonts.xml as FontListParser reads it: <family name> with <font weight style index postScriptName>file<axis tag stylevalue/></font>, and <alias name to weight>. */
export function parseFontsXml(text: string): FontsXml {
  const root = parseXml(text);
  if (root.name !== 'familyset') fail(`the root element is <${root.name}>, not <familyset>`);
  const families = new Map<string, FontsXmlFamily>();
  const aliases = new Map<string, { to: string; weight: number | null }>();
  const fallbacks: FontsXmlFallback[] = [];
  for (const child of root.children) {
    if (typeof child === 'string') {
      if (child.trim() !== '') fail(`text ${JSON.stringify(child.trim())} directly in <familyset>`);
      continue;
    }
    if (child.name === 'alias') {
      const name = child.attributes.get('name');
      const to = child.attributes.get('to');
      if (name === undefined || to === undefined) fail('an <alias> without name or to');
      aliases.set(name as string, { to: to as string, weight: child.attributes.has('weight') ? intAttr(child, 'weight', null) : null });
      continue;
    }
    if (child.name !== 'family') fail(`<${child.name}> in <familyset>`);
    const name = child.attributes.get('name');
    const label = name ?? `#${fallbacks.length}`;
    const fonts = child.children.flatMap((f): FontsXmlFont[] => {
      if (typeof f === 'string') return [];
      if (f.name !== 'font') fail(`<${f.name}> in family ${label}`);
      const file = f.children.filter((c): c is string => typeof c === 'string').join('').trim();
      if (file === '' || file.includes('/')) fail(`family ${label}: a font names the file ${JSON.stringify(file)}, not a file name in /system/fonts`);
      const style = f.attributes.get('style') ?? 'normal';
      if (style !== 'normal' && style !== 'italic') fail(`family ${label}: style="${style}"`);
      const axes: Record<string, number> = {};
      for (const a of f.children) {
        if (typeof a === 'string') continue;
        if (a.name !== 'axis') fail(`<${a.name}> in a <font> of ${label}`);
        const tag = a.attributes.get('tag');
        const value = Number(a.attributes.get('stylevalue'));
        if (tag === undefined || tag.length !== 4 || !Number.isFinite(value)) fail(`family ${label}: a bad <axis>`);
        axes[tag as string] = value;
      }
      return [{ file, weight: intAttr(f, 'weight', 400), style: style as 'normal' | 'italic', index: intAttr(f, 'index', 0), axes, postScriptName: f.attributes.get('postScriptName') ?? null, fallbackFor: f.attributes.get('fallbackFor') ?? null }];
    });
    // Unnamed families are the fallback chain (by lang or variant); generics resolve only to named ones.
    if (name === undefined) {
      const lang = child.attributes.get('lang');
      fallbacks.push({ lang: lang === undefined ? [] : lang.split(/[ ,]+/).filter((l) => l !== ''), variant: child.attributes.get('variant') ?? null, fonts });
      continue;
    }
    if (families.has(name as string)) fail(`family ${name} is listed twice`);
    families.set(name as string, { name: name as string, fonts });
  }
  return { families, fallbacks, aliases };
}

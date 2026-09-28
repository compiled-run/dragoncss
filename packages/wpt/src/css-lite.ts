// The small CSS reading the translator needs: top-level rule spans, declarations, selectors with specificity, matching against
// the parsed document, and #id rewriting. It is not a support check; Dragon's compiler reads the generated sheet.

export type SheetItem =
  | { readonly kind: 'rule'; readonly prelude: string; readonly preludeStart: number; readonly block: string }
  | { readonly kind: 'at-rule'; readonly name: string; readonly raw: string };

/** Index just past a comment or string starting at i, or i when there is none. */
function skipOpaque(css: string, i: number): number {
  if (css.startsWith('/*', i)) {
    const end = css.indexOf('*/', i + 2);
    return end < 0 ? css.length : end + 2;
  }
  const q = css[i];
  if (q === '"' || q === "'") {
    let j = i + 1;
    while (j < css.length && css[j] !== q && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
    return Math.min(j + 1, css.length);
  }
  return i;
}

/** Index of the "}" matching the "{" at open (or css.length). */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const j = skipOpaque(css, i);
    if (j !== i) {
      i = j;
      continue;
    }
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return css.length;
}

/** The top-level items of a style sheet, in order. */
export function readSheet(css: string): SheetItem[] {
  const out: SheetItem[] = [];
  let i = 0;
  let start = 0;
  while (i < css.length) {
    const j = skipOpaque(css, i);
    if (j !== i) {
      i = j;
      continue;
    }
    const ch = css[i];
    if (ch === '}') {
      i++;
      start = i;
      continue;
    }
    if (ch === ';' && css.slice(start, i).trim().startsWith('@')) {
      out.push({ kind: 'at-rule', name: /^@([-\w]+)/.exec(css.slice(start, i).trim())?.[1] ?? '', raw: css.slice(start, i + 1) });
      i++;
      start = i;
      continue;
    }
    if (ch === '{') {
      const end = blockEnd(css, i);
      const raw = css.slice(start, i);
      const prelude = stripComments(raw);
      if (prelude.trim().startsWith('@')) out.push({ kind: 'at-rule', name: /^@([-\w]+)/.exec(prelude.trim())?.[1] ?? '', raw: css.slice(start, end + 1) });
      else out.push({ kind: 'rule', prelude: raw, preludeStart: start, block: css.slice(i + 1, end) });
      i = end + 1;
      start = i;
      continue;
    }
    i++;
  }
  return out;
}

export function stripComments(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      out += ' ';
      continue;
    }
    const j = skipOpaque(css, i);
    if (j !== i) {
      out += css.slice(i, j);
      i = j;
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}

export type Declaration = { readonly property: string; readonly value: string; readonly important: boolean };

/** The declarations of a rule block or style attribute; null when the block holds a nested rule. */
export function readDeclarations(block: string): Declaration[] | null {
  const text = stripComments(block);
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let i = 0;
  while (i < text.length) {
    const j = skipOpaque(text, i);
    if (j !== i) {
      cur += text.slice(i, j);
      i = j;
      continue;
    }
    const ch = text[i] as string;
    if (ch === '{') return null;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ';' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
    i++;
  }
  parts.push(cur);
  const out: Declaration[] = [];
  for (const p of parts) {
    const colon = p.indexOf(':');
    if (colon < 0) continue;
    const property = p.slice(0, colon).trim().toLowerCase();
    if (property === '') continue;
    let value = p.slice(colon + 1).trim();
    const imp = /!\s*important\s*$/i.exec(value);
    if (imp !== null) value = value.slice(0, imp.index).trim();
    out.push({ property, value, important: imp !== null });
  }
  return out;
}

// Longhand groups for the cascade guard: two declarations interact when their groups intersect. Unknown properties are their own
// group; border and font families are kept coarse, which can only make the guard refuse more often.
const SIDES = ['top', 'right', 'bottom', 'left'];
const GROUPS: Readonly<Record<string, readonly string[]>> = {
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  gap: ['row-gap', 'column-gap'],
  'grid-gap': ['row-gap', 'column-gap'],
  'grid-row-gap': ['row-gap'],
  'grid-column-gap': ['column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
  'place-content': ['align-content', 'justify-content'],
  'place-items': ['align-items', 'justify-items'],
  'place-self': ['align-self', 'justify-self'],
  'white-space': ['white-space-collapse', 'text-wrap-mode'],
  'text-wrap': ['text-wrap-mode', 'text-wrap-style'],
};

export function propertyGroup(property: string): readonly string[] {
  if (property === 'all') return ['*'];
  if (property.startsWith('--')) return [property];
  for (const family of ['margin', 'padding', 'border', 'background', 'font', 'outline', 'grid-template', 'grid-area']) {
    if (property === family || property.startsWith(`${family}-`)) return [family];
  }
  if (property === 'inset' || property.startsWith('inset-') || SIDES.includes(property)) return ['inset'];
  if (property === 'line-height') return ['font'];
  if (['width', 'height', 'inline-size', 'block-size'].includes(property)) return ['size'];
  if (['min-width', 'min-height', 'min-inline-size', 'min-block-size'].includes(property)) return ['min-size'];
  if (['max-width', 'max-height', 'max-inline-size', 'max-block-size'].includes(property)) return ['max-size'];
  return GROUPS[property] ?? [property];
}

export function groupsOverlap(a: string, b: string): boolean {
  const ga = propertyGroup(a);
  const gb = propertyGroup(b);
  return ga.includes('*') || gb.includes('*') || ga.some((g) => gb.includes(g));
}

// Selectors.
export type AttributeTest = { readonly name: string; readonly op: string | null; readonly value: string; readonly insensitive: boolean };
export type Compound = {
  readonly tag: string | null;
  readonly ids: readonly { readonly value: string; readonly start: number; readonly end: number }[];
  readonly classes: readonly string[];
  readonly attributes: readonly AttributeTest[];
  /** Pseudo-classes and pseudo-elements: the matcher cannot evaluate them. */
  readonly pseudos: readonly string[];
  readonly pseudoElements: number;
};
export type Combinator = ' ' | '>' | '+' | '~';
export type ComplexSelector = { readonly compounds: readonly Compound[]; readonly combinators: readonly Combinator[] };
export type Specificity = readonly [number, number, number];

const IDENT = /^-?(?:[_a-zA-Z\u00a0-\uffff]|--)[-_a-zA-Z0-9\u00a0-\uffff]*/;

/** Parses a selector list; offsets are relative to the text. null when the list is outside the subset read here. */
export function parseSelectorList(text: string): ComplexSelector[] | null {
  const out: ComplexSelector[] = [];
  let i = 0;
  const n = text.length;
  const ws = (): boolean => {
    const s = i;
    while (i < n && /\s/.test(text[i] as string)) i++;
    return i > s;
  };
  const ident = (): string | null => {
    const m = IDENT.exec(text.slice(i));
    if (m === null) return null;
    i += m[0].length;
    return m[0];
  };
  while (true) {
    ws();
    const compounds: Compound[] = [];
    const combinators: Combinator[] = [];
    while (true) {
      let tag: string | null = null;
      const ids: { value: string; start: number; end: number }[] = [];
      const classes: string[] = [];
      const attributes: AttributeTest[] = [];
      const pseudos: string[] = [];
      let pseudoElements = 0;
      let any = false;
      if (text[i] === '*') {
        i++;
        any = true;
      } else {
        const t = ident();
        if (t !== null) {
          tag = t.toLowerCase();
          any = true;
        }
      }
      while (i < n) {
        const ch = text[i];
        if (ch === '\\') return null;
        if (ch === '#') {
          const s = i;
          i++;
          const v = ident();
          if (v === null) {
            const m = /^[-_a-zA-Z0-9\u00a0-\uffff]+/.exec(text.slice(i));
            if (m === null) return null;
            i += m[0].length;
            ids.push({ value: m[0], start: s, end: i });
          } else ids.push({ value: v, start: s, end: i });
          any = true;
        } else if (ch === '.') {
          i++;
          const v = ident();
          if (v === null) return null;
          classes.push(v);
          any = true;
        } else if (ch === '[') {
          const close = text.indexOf(']', i);
          if (close < 0) return null;
          const m = /^\[\s*([-_a-zA-Z0-9]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([-_a-zA-Z0-9]+))\s*([iIsS])?\s*)?\]$/.exec(text.slice(i, close + 1));
          if (m === null) return null;
          attributes.push({ name: (m[1] as string).toLowerCase(), op: m[2] ?? null, value: m[3] ?? m[4] ?? m[5] ?? '', insensitive: (m[6] ?? '').toLowerCase() === 'i' });
          i = close + 1;
          any = true;
        } else if (ch === ':') {
          const element = text[i + 1] === ':';
          i += element ? 2 : 1;
          const v = ident();
          if (v === null) return null;
          let name = v.toLowerCase();
          if (text[i] === '(') {
            let depth = 0;
            const s = i;
            while (i < n) {
              if (text[i] === '(') depth++;
              else if (text[i] === ')') {
                depth--;
                if (depth === 0) break;
              }
              i++;
            }
            if (i >= n) return null;
            i++;
            name += text.slice(s, i);
          }
          if (element || ['before', 'after', 'first-line', 'first-letter'].includes(name)) pseudoElements++;
          else pseudos.push(name);
          any = true;
        } else break;
      }
      if (!any) return null;
      compounds.push({ tag, ids, classes, attributes, pseudos, pseudoElements });
      const hadSpace = ws();
      const c = text[i];
      if (c === '>' || c === '+' || c === '~') {
        i++;
        ws();
        combinators.push(c);
        continue;
      }
      if (i >= n || c === ',') break;
      if (hadSpace) {
        combinators.push(' ');
        continue;
      }
      return null;
    }
    out.push({ compounds, combinators });
    if (i >= n) break;
    i++;
  }
  return out;
}

/** Selectors Level 4 §16, with ids optionally counted as classes (the rewrite). Pseudo-class arguments are not expanded. */
export function specificity(s: ComplexSelector, idsAsClasses: boolean): Specificity {
  let a = 0;
  let b = 0;
  let c = 0;
  for (const k of s.compounds) {
    if (idsAsClasses) b += k.ids.length;
    else a += k.ids.length;
    b += k.classes.length + k.attributes.length + k.pseudos.length;
    c += (k.tag === null ? 0 : 1) + k.pseudoElements;
  }
  return [a, b, c];
}

export type MatchElement = {
  readonly tag: string;
  readonly attrs: ReadonlyMap<string, string>;
  readonly parent: MatchElement | null;
  readonly previous: MatchElement | null;
};

export type Match = true | false | 'unknown';

function attributeMatches(el: MatchElement, t: AttributeTest): boolean {
  const v = el.attrs.get(t.name);
  if (v === undefined) return false;
  if (t.op === null) return true;
  const a = t.insensitive ? v.toLowerCase() : v;
  const e = t.insensitive ? t.value.toLowerCase() : t.value;
  switch (t.op) {
    case '=': return a === e;
    case '~=': return a.split(/\s+/).includes(e);
    case '|=': return a === e || a.startsWith(`${e}-`);
    case '^=': return e !== '' && a.startsWith(e);
    case '$=': return e !== '' && a.endsWith(e);
    default: return e !== '' && a.includes(e);
  }
}

function compoundMatches(el: MatchElement, k: Compound): Match {
  if (k.tag !== null && k.tag !== el.tag) return false;
  const classes = (el.attrs.get('class') ?? '').split(/\s+/).filter((c) => c !== '');
  if (k.ids.some((id) => el.attrs.get('id') !== id.value)) return false;
  if (k.classes.some((c) => !classes.includes(c))) return false;
  if (k.attributes.some((t) => !attributeMatches(el, t))) return false;
  return k.pseudos.length > 0 || k.pseudoElements > 0 ? 'unknown' : true;
}

const or = (a: Match, b: Match): Match => (a === true || b === true ? true : a === 'unknown' || b === 'unknown' ? 'unknown' : false);
const and = (a: Match, b: Match): Match => (a === false || b === false ? false : a === 'unknown' || b === 'unknown' ? 'unknown' : true);

function matchFrom(el: MatchElement, s: ComplexSelector, index: number): Match {
  const own = compoundMatches(el, s.compounds[index] as Compound);
  if (own === false || index === 0) return own;
  const comb = s.combinators[index - 1] as Combinator;
  let result: Match = false;
  if (comb === '>' || comb === ' ') {
    for (let p = el.parent; p !== null; p = p.parent) {
      result = or(result, matchFrom(p, s, index - 1));
      if (result === true || comb === '>') break;
    }
  } else {
    for (let p = el.previous; p !== null; p = p.previous) {
      result = or(result, matchFrom(p, s, index - 1));
      if (result === true || comb === '+') break;
    }
  }
  return and(own, result);
}

export function matches(el: MatchElement, s: ComplexSelector): Match {
  return matchFrom(el, s, s.compounds.length - 1);
}

/** The selector text with every #id replaced by .<class of that id>; ids outside the parsed subset are left for the compiler. */
export function rewriteIds(selectorText: string, classOfId: (id: string) => string): string {
  const list = parseSelectorList(selectorText);
  if (list === null) return selectorText;
  const spans = list.flatMap((s) => s.compounds.flatMap((k) => k.ids)).sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const s of spans) {
    out += `${selectorText.slice(at, s.start)}.${classOfId(s.value)}`;
    at = s.end;
  }
  return out + selectorText.slice(at);
}

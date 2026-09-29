// Typed dynamic-text slots (docs/goals/milestone-2-proof/notes/T068-dtxt-spec.md DT-1): a template of literal text and integer
// fields, `{id}` or `{id:0N}`, over finite integer domains. The domain is small enough to enumerate, so the build proves every
// string (repertoire, script, width) and the device only formats. Not an engine root yet: DTXT-1 wires it into the runtime.
import { scriptCode, USCRIPT_COMMON, USCRIPT_INHERITED, USCRIPT_LATIN } from './script-data.ts';

/** Planted faults (DT-3(d)); the vectors and the width oracle must catch each one. */
export type TextFormatFaults = {
  /** Ignore `:0N`, so `{s:02}` writes 5 as "5". */
  readonly padDropped: boolean;
  /** Wrap the first field at 60, as a clock that drops hours would. */
  readonly minutesWrapped: boolean;
  /** Skip the input guard: out-of-domain, fractional and NaN values are formatted. */
  readonly textDomainUnchecked: boolean;
  /** Key the width memo by code point count instead of by the string. */
  readonly widthCacheByLength: boolean;
};

export const NO_TEXT_FORMAT_FAULTS: TextFormatFaults = { padDropped: false, minutesWrapped: false, textDomainUnchecked: false, widthCacheByLength: false };

/** DT-1: at most this many strings per slot. */
export const MAX_SLOT_STRINGS = 100000;
/** Number.MAX_SAFE_INTEGER: every integer up to it prints as plain digits. */
export const MAX_FIELD_VALUE = 9007199254740991;
/** `{id:0N}` takes one digit N, 1 to 9. */
export const MAX_PAD = 9;

/** A typed integer input: integers in [min, max], min at least 0 so every field is ASCII digits. */
export type IntDomain = { readonly id: string; readonly min: number; readonly max: number };

/** A literal run (field -1) or a field: the index of its domain, zero-padded to `pad` digits (0: no padding). */
export type TemplatePart = { readonly literal: string; readonly field: number; readonly pad: number };

export type TextTemplate = { readonly source: string; readonly parts: readonly TemplatePart[]; readonly domains: readonly IntDomain[] };

/** A refused template: `offset` is the code point offset in the source, or -1 for an error in the domains. */
export type TemplateResult = { readonly ok: true; readonly template: TextTemplate } | { readonly ok: false; readonly offset: number; readonly reason: string };

/** A refused input names its field (empty when the value count is wrong). */
export type GuardResult = { readonly ok: true } | { readonly ok: false; readonly field: string; readonly reason: string };

export type FormatResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly field: string; readonly reason: string };

export type EnumerateResult = { readonly ok: true; readonly texts: readonly string[] } | { readonly ok: false; readonly reason: string };

/** What the build proves about every string of a slot. */
export type Repertoire = {
  /** Distinct code points, ascending. */
  readonly codePoints: readonly number[];
  /** The code points with Unicode White_Space. */
  readonly whitespace: readonly number[];
  /** The bidi formatting characters (Bidi_Control). */
  readonly bidiControls: readonly number[];
  /** Distinct ICU script codes (script-data.ts), ascending. */
  readonly scripts: readonly number[];
  /** Every code point has Script Latin, Common or Inherited (R4's Latin scope). */
  readonly latinOnly: boolean;
};

function codePointOf(ch: string): number {
  return ch.codePointAt(0) as number;
}

function isAsciiDigit(cp: number): boolean {
  return cp >= 0x30 && cp <= 0x39;
}

function isAsciiLetter(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
}

/** A field id: an ASCII letter, then ASCII letters, digits and underscores. */
function isFieldId(id: string): boolean {
  let first = true;
  for (const ch of id) {
    const cp = codePointOf(ch);
    const ok = first ? isAsciiLetter(cp) : isAsciiLetter(cp) || isAsciiDigit(cp) || cp === 0x5f;
    if (!ok) return false;
    first = false;
  }
  return !first;
}

/** Unicode 16.0.0 White_Space (PropList.txt). */
export function isWhiteSpace(cp: number): boolean {
  return (cp >= 0x09 && cp <= 0x0d) || cp === 0x20 || cp === 0x85 || cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000;
}

/** Unicode 16.0.0 Bidi_Control (PropList.txt). */
export function isBidiControl(cp: number): boolean {
  return cp === 0x061c || cp === 0x200e || cp === 0x200f || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}

export function codePointCount(text: string): number {
  let n = 0;
  for (const _ch of text) n++;
  return n;
}

function domainError(domain: IntDomain): string {
  if (!isFieldId(domain.id)) return `input "${domain.id}": the id must be an ASCII letter followed by letters, digits or _`;
  if (!Number.isInteger(domain.min) || !Number.isInteger(domain.max)) return `input ${domain.id}: min and max must be integers`;
  if (domain.min < 0) return `input ${domain.id}: min ${domain.min} is negative (fields are ASCII digits only)`;
  if (domain.max > MAX_FIELD_VALUE) return `input ${domain.id}: max ${domain.max} is above ${MAX_FIELD_VALUE}`;
  if (domain.min > domain.max) return `input ${domain.id}: min ${domain.min} is above max ${domain.max}`;
  return '';
}

function domainIndex(domains: readonly IntDomain[], id: string): number {
  for (let i = 0; i < domains.length; i++) if ((domains[i] as IntDomain).id === id) return i;
  return -1;
}

function refuse(offset: number, reason: string): TemplateResult {
  return { ok: false, offset, reason };
}

/** DT-1: parse `template` over `domains`. Every field names a declared input exactly once and every input is used. */
export function parseTemplate(source: string, domains: readonly IntDomain[]): TemplateResult {
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i] as IntDomain;
    const e = domainError(d);
    if (e !== '') return refuse(-1, e);
    if (domainIndex(domains, d.id) !== i) return refuse(-1, `input ${d.id} is declared twice`);
  }
  const parts: TemplatePart[] = [];
  const used = new Map<string, boolean>();
  let literal = '';
  // 0: literal text; 1: field id; 2: after ':' (expects 0); 3: after ':0' (expects N); 4: after N (expects '}').
  let state = 0;
  let id = '';
  let idStart = 0;
  let pad = 0;
  let offset = 0;
  for (const ch of source) {
    const cp = codePointOf(ch);
    if (state === 0) {
      if (ch === '{') {
        if (literal !== '') parts.push({ literal, field: -1, pad: 0 });
        literal = '';
        state = 1;
        id = '';
        idStart = offset;
        pad = 0;
      } else if (ch === '}') {
        return refuse(offset, 'unmatched }');
      } else literal += ch;
    } else if (state === 1 && ch !== ':' && ch !== '}') {
      id += ch;
    } else if (state === 1 || state === 4) {
      if (state === 1 && ch === ':') {
        state = 2;
      } else if (ch === '}') {
        const f = domainIndex(domains, id);
        if (!isFieldId(id)) return refuse(idStart, `field "${id}": the id must be an ASCII letter followed by letters, digits or _`);
        if (f < 0) return refuse(idStart, `field ${id} has no input`);
        if (used.has(id)) return refuse(idStart, `field ${id} appears twice`);
        used.set(id, true);
        parts.push({ literal: '', field: f, pad });
        state = 0;
      } else return refuse(offset, `field ${id}: expected }`);
    } else if (state === 2) {
      if (ch !== '0') return refuse(offset, `field ${id}: the format is :0N, N from 1 to ${MAX_PAD}`);
      state = 3;
    } else {
      if (!isAsciiDigit(cp) || cp === 0x30) return refuse(offset, `field ${id}: the format is :0N, N from 1 to ${MAX_PAD}`);
      pad = cp - 0x30;
      state = 4;
    }
    offset++;
  }
  if (state !== 0) return refuse(idStart, `field ${id} is not closed`);
  if (literal !== '') parts.push({ literal, field: -1, pad: 0 });
  for (let i = 0; i < domains.length; i++) {
    if (!used.has((domains[i] as IntDomain).id)) return refuse(-1, `input ${(domains[i] as IntDomain).id} is not used by the template`);
  }
  if (domains.length === 0) return refuse(-1, 'a slot template needs at least one field');
  return { ok: true, template: { source, parts, domains } };
}

/** The typed input guard (DT-1, DT-4): an integer, finite, within [min, max]. The reason names the input. */
export function guardValue(domain: IntDomain, value: number): GuardResult {
  if (Number.isNaN(value)) return { ok: false, field: domain.id, reason: `${domain.id}: NaN is not an integer` };
  if (!Number.isFinite(value)) return { ok: false, field: domain.id, reason: `${domain.id}: ${value} is not finite` };
  if (!Number.isInteger(value)) return { ok: false, field: domain.id, reason: `${domain.id}: ${value} is not an integer` };
  if (value < domain.min || value > domain.max) return { ok: false, field: domain.id, reason: `${domain.id}: ${value} is outside [${domain.min}, ${domain.max}]` };
  return { ok: true };
}

/** Guard one value per input, in the template's input order. */
export function guardInputs(template: TextTemplate, values: readonly number[]): GuardResult {
  if (values.length !== template.domains.length) return { ok: false, field: '', reason: `expected ${template.domains.length} values, got ${values.length}` };
  for (let i = 0; i < values.length; i++) {
    const r = guardValue(template.domains[i] as IntDomain, values[i] as number);
    if (!r.ok) return r;
  }
  return { ok: true };
}

function fieldText(value: number, pad: number, first: boolean, faults: TextFormatFaults): string {
  let v = value;
  if (faults.minutesWrapped && first) {
    while (v >= 60) v -= 60;
  }
  let digits = `${v}`;
  if (!faults.padDropped) {
    let n = codePointCount(digits);
    while (n < pad) {
      digits = `0${digits}`;
      n++;
    }
  }
  return digits;
}

/** The slot's text for `values` (one per input, in input order), after the guard. */
export function formatText(template: TextTemplate, values: readonly number[], faults: TextFormatFaults): FormatResult {
  if (!faults.textDomainUnchecked) {
    const g = guardInputs(template, values);
    if (!g.ok) return { ok: false, field: g.field, reason: g.reason };
  }
  let out = '';
  for (const p of template.parts) {
    if (p.field < 0) out += p.literal;
    else out += fieldText(values[p.field] as number, p.pad, p.field === 0, faults);
  }
  return { ok: true, text: out };
}

/** The number of strings of the domain, or MAX_SLOT_STRINGS + 1 when it is larger. */
export function domainSize(domains: readonly IntDomain[]): number {
  let n = 1;
  for (const d of domains) {
    n = n * (d.max - d.min + 1);
    if (n > MAX_SLOT_STRINGS) return MAX_SLOT_STRINGS + 1;
  }
  return n;
}

/** Every string of the slot, the last input varying fastest (for '{m}:{s:02}', index 60m + s). */
export function enumerateTexts(template: TextTemplate, faults: TextFormatFaults): EnumerateResult {
  const size = domainSize(template.domains);
  if (size > MAX_SLOT_STRINGS) return { ok: false, reason: `the domain of ${template.source} has more than ${MAX_SLOT_STRINGS} strings` };
  let values: number[] = template.domains.map((d) => d.min);
  const texts: string[] = [];
  for (let k = 0; k < size; k++) {
    const r = formatText(template, values, faults);
    if (!r.ok) return { ok: false, reason: r.reason };
    texts.push(r.text);
    // Odometer step: the rightmost input below its max goes up by one and every input after it restarts at its min.
    let carry = values.length - 1;
    while (carry >= 0 && (values[carry] as number) >= (template.domains[carry] as IntDomain).max) carry--;
    const at = carry;
    values = values.map((v, j) => (j < at ? v : j === at ? v + 1 : (template.domains[j] as IntDomain).min));
  }
  return { ok: true, texts };
}

/** The repertoire facts of a set of strings: characters, whitespace, bidi controls and scripts. */
export function repertoireOf(texts: readonly string[]): Repertoire {
  const seen = new Map<string, boolean>();
  const codePoints: number[] = [];
  for (const t of texts) {
    for (const ch of t) {
      if (!seen.has(ch)) {
        seen.set(ch, true);
        codePoints.push(codePointOf(ch));
      }
    }
  }
  codePoints.sort((a, b) => a - b);
  const scripts: number[] = [];
  for (const cp of codePoints) {
    const s = scriptCode(cp);
    if (!scripts.some((x) => x === s)) scripts.push(s);
  }
  scripts.sort((a, b) => a - b);
  return {
    codePoints,
    whitespace: codePoints.filter((cp) => isWhiteSpace(cp)),
    bidiControls: codePoints.filter((cp) => isBidiControl(cp)),
    scripts,
    latinOnly: !scripts.some((s) => s !== USCRIPT_LATIN && s !== USCRIPT_COMMON && s !== USCRIPT_INHERITED),
  };
}

/** DT-2's only width memo key: face sha256, size and the string itself. */
export function widthMemoKey(faceSha256: string, size: number, text: string, faults: TextFormatFaults): string {
  if (faults.widthCacheByLength) return `${faceSha256}/${size}/#${codePointCount(text)}`;
  return `${faceSha256}/${size}/=${text}`;
}

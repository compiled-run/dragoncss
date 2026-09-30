// The corpus: every utility class the pinned tailwindcss package lists (its design system's getClassList, the IntelliSense
// list), each built alone from the package's theme.css and utilities.css (no preflight, no variants, no arbitrary values).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { __unstable__loadDesignSystem, compile } from 'tailwindcss';

/** The pinned tailwindcss version; the installed package must be exactly this one. */
export const TAILWIND_VERSION = '4.3.3';

/** The entry sheet: Tailwind's theme and utilities in their layers, as `@import "tailwindcss"` writes them, without preflight. */
export const ENTRY_CSS = '@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n';

const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve('tailwindcss/package.json'));

/** The installed tailwindcss version, checked against the pin. */
export function installedVersion(): string {
  const v = (JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version: string }).version;
  if (v !== TAILWIND_VERSION) throw new Error(`tailwindcss must be ${TAILWIND_VERSION}, found ${v}; run pnpm install --frozen-lockfile`);
  return v;
}

const SHEETS: ReadonlyMap<string, string> = new Map([
  ['tailwindcss/theme.css', 'theme.css'],
  ['tailwindcss/utilities.css', 'utilities.css'],
]);
const texts = new Map<string, string>();

async function loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }> {
  const file = SHEETS.get(id);
  if (file === undefined) throw new Error(`the sweep loads only ${[...SHEETS.keys()].join(' and ')}, not ${id}`);
  let content = texts.get(file);
  if (content === undefined) {
    content = readFileSync(join(packageDir, file), 'utf8');
    texts.set(file, content);
  }
  return { path: id, base, content };
}

const OPTIONS = { base: '/', loadStylesheet };

/** root: Tailwind's utility root (p for p-4, bg for bg-red-500), which counts families of utilities. */
export type Utility = { readonly name: string; readonly root: string; readonly colour: boolean };

/** Every utility of the package's class list, in its order. colour: its value is a theme colour or current, transparent or inherit. */
export async function utilities(): Promise<Utility[]> {
  installedVersion();
  const ds = await __unstable__loadDesignSystem(ENTRY_CSS, OPTIONS);
  const names = ds.getClassList().map(([name]) => name);
  if (new Set(names).size !== names.length) throw new Error('the class list repeats a name');
  return names.map((name) => {
    const candidate = ds.parseCandidate(name)[0];
    if (candidate === undefined || candidate.kind === 'arbitrary') throw new Error(`${name} does not parse as a utility`);
    const value = candidate.kind === 'functional' && candidate.value !== null && candidate.value.kind === 'named' ? candidate.value.value : null;
    const colour = value !== null && (['current', 'transparent', 'inherit'].includes(value) || ds.theme.resolve(value, ['--color']) !== null);
    return { name, root: candidate.root, colour };
  });
}

/** The published CSS of utilities used together: a fresh compile of the entry sheet built for these classes, without the license banner. */
export async function publishedCss(classes: readonly string[]): Promise<string> {
  const css = (await compile(ENTRY_CSS, OPTIONS)).build([...classes]);
  const banner = /^\/\*! tailwindcss v[^*]*\*\/\n/.exec(css);
  if (banner === null) throw new Error(`${classes.join(' ')}: the built CSS has no license banner`);
  const out = css.slice(banner[0].length);
  for (const name of classes) if (!out.includes(`.${escapeClass(name)}`)) throw new Error(`${name}: the built CSS has no rule for the class`);
  return out;
}

/** CSS.escape (cssom-1 §2.1.1), which Tailwind also uses for class selectors. */
export function escapeClass(name: string): string {
  let out = '';
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const ch = name[i] as string;
    const digit = c >= 0x30 && c <= 0x39;
    if (c === 0) out += '�';
    else if ((c >= 1 && c <= 0x1f) || c === 0x7f || (i === 0 && digit) || (i === 1 && digit && name.charCodeAt(0) === 0x2d)) out += `\\${c.toString(16)} `;
    else if (i === 0 && ch === '-' && name.length === 1) out += '\\-';
    else if (c >= 0x80 || ch === '-' || ch === '_' || digit || /[a-zA-Z]/.test(ch)) out += ch;
    else out += `\\${ch}`;
  }
  return out;
}

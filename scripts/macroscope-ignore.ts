// Macroscope's .macroscope/ignore.md, as docs.macroscope.com/bug-detection-and-fixes documents it (read 2026-09-30):
// one glob per line, `#` comments and blank lines skipped, `**` across directories, `*` within one segment, `?` one
// character, and a pattern without `/` matches at any depth. Anything outside that documented syntax throws.
export type IgnoreFile = { patterns: string[]; ignoreTests: boolean | null; matches: (path: string) => boolean };

const MAX_PATTERNS = 1000;
const fail = (what: string): never => {
  throw new Error(`macroscope-ignore: ${what}`);
};

// A segment of a compiled pattern: '**' or a single-segment glob.
type Segment = '**' | RegExp;

const compileSegment = (seg: string, pattern: string): Segment => {
  if (seg === '**') return '**';
  if (seg === '') return fail(`empty path segment in pattern ${JSON.stringify(pattern)}`);
  if (seg.includes('**')) return fail(`"**" must be a whole path segment in pattern ${JSON.stringify(pattern)}`);
  let re = '';
  for (const ch of seg) re += ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${re}$`);
};

export const compilePattern = (pattern: string): Segment[] => {
  if (/[[\]{}!\\]/.test(pattern)) return fail(`unsupported glob syntax in pattern ${JSON.stringify(pattern)}`);
  if (pattern.startsWith('/') || pattern.endsWith('/')) return fail(`leading or trailing "/" in pattern ${JSON.stringify(pattern)}`);
  const segments = pattern.split('/').map((s) => compileSegment(s, pattern));
  return pattern.includes('/') ? segments : ['**', ...segments];
};

// A leading or middle `**` matches zero or more segments; a trailing `**` matches one or more, so `out/**` is what is inside out/.
export const matchSegments = (pattern: Segment[], path: string[]): boolean => {
  const memo = new Map<string, boolean>();
  const go = (p: number, s: number): boolean => {
    const key = `${p},${s}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    if (p === pattern.length) result = s === path.length;
    else if (pattern[p] === '**') {
      const min = p === pattern.length - 1 ? 1 : 0;
      result = false;
      for (let k = s + min; k <= path.length && !result; k++) result = go(p + 1, k);
    } else result = s < path.length && (pattern[p] as RegExp).test(path[s]!) && go(p + 1, s + 1);
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
};

const checkPath = (path: string): string[] => {
  const segments = path.split('/');
  if (path === '' || segments.some((s) => s === '' || s === '.' || s === '..')) return fail(`not a repository-relative file path: ${JSON.stringify(path)}`);
  return segments;
};

// Front matter is a leading `---` block closed by a `---` line that sets the one recognized key, ignoreTests. Per the docs
// and Macroscope's own check-run note, an unclosed block, or one with only unrecognized keys, is read as ignore patterns.
// A block that sets ignoreTests alongside anything else is not documented, so it throws.
const readFrontMatter = (lines: string[]): { ignoreTests: boolean | null; rest: string[] } => {
  const none = { ignoreTests: null, rest: lines };
  if (lines[0]?.trim() !== '---') return none;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return none;
  const body = lines.slice(1, end).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  const keys = body.map((l) => /^ignoreTests:\s*(true|false)$/.exec(l));
  if (keys.every((m) => m === null) && !body.some((l) => l.startsWith('ignoreTests'))) return none;
  const key = keys.length === 1 ? keys[0] : null;
  if (!key) return fail(`unsupported front matter ${JSON.stringify(body)}`);
  return { ignoreTests: key[1] === 'true', rest: lines.slice(end + 1) };
};

export const parseIgnoreFile = (text: string): IgnoreFile => {
  const { ignoreTests, rest } = readFrontMatter(text.split(/\r?\n/));
  const patterns = rest.map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  if (patterns.length === 0) return fail('no patterns');
  if (patterns.length > MAX_PATTERNS) return fail(`${patterns.length} patterns, more than Macroscope's ${MAX_PATTERNS}`);
  const compiled = patterns.map(compilePattern);
  return { patterns, ignoreTests, matches: (path) => compiled.some((p) => matchSegments(p, checkPath(path))) };
};

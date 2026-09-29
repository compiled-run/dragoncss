// The grid differential fuzzer's generator: seeded random declarations of every grid-family property from the css-grid-2 and
// css-align-3 grammars, biased toward the edges Chrome's parser decides (auto-repeat mixes, minmax arguments, line names, integers,
// area shapes, shorthand forms, comments and units). The committed corpus (packages/dragon/test/data/grid-fuzz-corpus.json) is its output for
// GRID_FUZZ_SEED; packages/parity/test/grid-fuzz.test.ts regenerates it and compares every declaration with Chrome 145.
// Rewrite the corpus: node --conditions=dragon-internal packages/parity/test/grid-fuzz/generate.ts --write

export const GRID_FUZZ_SEED = 20260929;
export const GRID_FUZZ_COUNT = 3000;

type Rng = () => number;

/** mulberry32: a small deterministic PRNG, so the corpus is a pure function of the seed. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateGridDeclarations(seed: number = GRID_FUZZ_SEED, count: number = GRID_FUZZ_COUNT): [string, string][] {
  const r = mulberry32(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
  const chance = (p: number): boolean => r() < p;
  const times = (lo: number, hi: number, f: () => string): string[] => Array.from({ length: int(lo, hi) }, f);

  // Escaped names too: Dragon serializes them as CSSOM identifiers, as Chrome does ([\\31 x], [\\-], [a\\ b], [\\1F600]).
  const NAMES = ['a', 'b', 'c', 'x', 'Foo', 'start', 'end', 'span', 'auto', 'default', 'inherit', 'none', 'subgrid', 'dense', 'row', 'é', 'a-1', '_z', '\\31 x', '\\-', 'a\\ b', '\\1F600', '\\-\\-y'];
  const LENGTH_UNITS = ['px', 'px', 'px', 'em', 'rem', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'vw', 'vh', 'ch', 'ex', 'lh', 'cqw', 'PX', 'Em'];
  const number = (): string => pick(['0', '1', '2', '3', '10', '12.5', '0.5', '100', '1e1', '-1', '-10', '+5', '99999999']);
  const length = (): string => {
    const n = number();
    if (chance(0.08)) return n === '0' ? '0' : `${n}`;
    return `${n}${pick(LENGTH_UNITS)}`;
  };
  const percent = (): string => `${pick(['0', '10', '25.5', '50', '100', '-5'])}%`;
  const lp = (): string => (chance(0.75) ? length() : percent());
  const flex = (): string => `${pick(['0', '1', '2', '0.5', '1.5', '-1', '3'])}${pick(['fr', 'fr', 'FR'])}`;
  const intrinsic = (): string => pick(['auto', 'min-content', 'max-content', 'MIN-CONTENT']);
  const math = (): string => pick(['calc(10px + 5%)', 'min(10px, 5%)', 'max(1em, 2px)', 'clamp(1px, 2px, 3px)']);
  const breadth = (): string => {
    const k = r();
    if (k < 0.4) return lp();
    if (k < 0.65) return flex();
    if (k < 0.93) return intrinsic();
    return math();
  };
  const trackSize = (): string => {
    const k = r();
    if (k < 0.55) return breadth();
    if (k < 0.88) return `minmax(${breadth()}, ${breadth()})`;
    if (k < 0.97) return `fit-content(${chance(0.85) ? lp() : pick(['auto', '1fr', 'min-content'])})`;
    return pick(['minmax(10px)', 'minmax(1px, 2px, 3px)', 'fit-content()', 'foo(1px)']);
  };
  const names = (): string => {
    const k = r();
    if (k < 0.08) return '[]';
    const n = times(1, 3, () => pick(NAMES));
    return `[${n.join(' ')}]`;
  };
  const maybeNames = (p = 0.3): string[] => (chance(p) ? [names()] : chance(0.03) ? [names(), names()] : []);
  const repeatCount = (): string => pick(['1', '2', '3', '10', '0', '-1', '1.5', 'auto-fill', 'auto-fit', 'AUTO-FIT', '10001', '99999999999']);
  const repeat = (): string => {
    const items = times(1, 3, () => [...maybeNames(), trackSize()].join(' '));
    return `repeat(${repeatCount()}, ${[...items, ...maybeNames(0.2)].join(' ')})`;
  };
  const trackList = (): string => {
    const parts: string[] = [];
    const n = int(1, 4);
    for (let i = 0; i < n; i++) {
      parts.push(...maybeNames());
      parts.push(chance(0.3) ? repeat() : trackSize());
    }
    parts.push(...maybeNames(0.2));
    return parts.join(' ');
  };
  const templateTracks = (): string => {
    const k = r();
    if (k < 0.08) return 'none';
    if (k < 0.12) return pick(['subgrid', 'subgrid [a] [b]', 'masonry', 'subgrid repeat(2, [x])']);
    return trackList();
  };

  const areaCell = (): string => pick(['a', 'b', 'c', '.', '..', '...', 'a1', 'é', 'x_y', '#', 'a.b']);
  const areaRow = (w: number): string => times(w, w, areaCell).join(pick([' ', ' ', '  ', '\t']));
  const areas = (): string => {
    const k = r();
    const h = int(1, 3);
    const w = int(1, 3);
    if (k < 0.4) {
      // Rectangular by construction: each row is a slice of one shape.
      const shape = pick([['a a', 'b b'], ['a b', 'a b'], ['a . b', 'a . b'], ['. .', '. .'], ['a', 'a', 'b']]);
      return shape.map((s) => `"${s}"`).join(' ');
    }
    if (k < 0.5) return pick(['""', '"   "', '"a" ""', "'a' 'b'"]);
    return times(h, h, () => `"${areaRow(chance(0.85) ? w : int(1, 3))}"`).join(' ');
  };

  const gridLine = (): string => {
    const k = r();
    const n = (): string => pick(['1', '2', '-1', '-3', '0', '5', '100000', '99999999999', '1.0', '+2']);
    if (k < 0.12) return 'auto';
    if (k < 0.3) return n();
    if (k < 0.45) return pick(NAMES);
    if (k < 0.6) return `span ${n()}`;
    if (k < 0.7) return `span ${pick(NAMES)}`;
    if (k < 0.8) return `${n()} ${pick(NAMES)}`;
    if (k < 0.87) return `${pick(NAMES)} ${n()}`;
    if (k < 0.93) return pick([`${n()} span`, `span ${n()} ${pick(NAMES)}`, `${pick(NAMES)} span ${n()}`, `span ${pick(NAMES)} ${n()}`, `${n()} ${pick(NAMES)} span`]);
    return pick(['span', 'span auto', 'a b', '1 2', 'span 1 2', '']);
  };
  const lines = (max: number): string => times(1, max, gridLine).join(pick([' / ', '/', ' /']));

  const SELF = ['center', 'start', 'end', 'self-start', 'self-end', 'flex-start', 'flex-end', 'left', 'right'];
  const alignment = (items: boolean): string => {
    const k = r();
    if (k < 0.25) return pick(items ? ['normal', 'stretch', 'legacy', 'anchor-center', 'auto'] : ['auto', 'normal', 'stretch', 'anchor-center', 'legacy']);
    if (k < 0.45) return pick(SELF);
    if (k < 0.6) return `${pick(['safe', 'unsafe'])} ${pick([...SELF, 'normal', 'stretch', 'baseline'])}`;
    if (k < 0.75) return pick(['baseline', 'first baseline', 'last baseline', 'baseline first', 'first last baseline', 'safe first baseline']);
    if (k < 0.9) return pick(['legacy left', 'right legacy', 'legacy center', 'center legacy', 'legacy start', 'legacy legacy', 'left right']);
    return pick(['center center', 'safe', 'unsafe safe center', 'LEFT', 'Legacy Right']);
  };
  const autoFlow = (): string => pick(['row', 'column', 'dense', 'row dense', 'dense row', 'column dense', 'dense column', 'row column', 'dense dense', 'ROW']);

  const gridTemplate = (): string => {
    const k = r();
    if (k < 0.08) return 'none';
    if (k < 0.45) return `${templateTracks()} / ${templateTracks()}`;
    if (k < 0.5) return templateTracks();
    // The areas form: [ <line-names>? <string> <track-size>? <line-names>? ]+ [ / <explicit-track-list> ]?
    const rows = int(1, 3);
    const width = int(1, 3);
    const parts: string[] = [];
    for (let i = 0; i < rows; i++) {
      parts.push(...maybeNames(0.25));
      parts.push(`"${areaRow(chance(0.9) ? width : int(1, 3))}"`);
      if (chance(0.6)) parts.push(chance(0.9) ? trackSize() : repeat());
      parts.push(...maybeNames(0.25));
    }
    return chance(0.6) ? `${parts.join(' ')} / ${chance(0.85) ? trackList() : templateTracks()}` : parts.join(' ');
  };
  const autoFlowSide = (): string => {
    const kws = pick([['auto-flow'], ['auto-flow', 'dense'], ['dense', 'auto-flow'], ['dense'], ['auto-flow', 'auto-flow']]);
    const sizes = chance(0.5) ? times(1, 2, trackSize) : [];
    return (chance(0.9) ? [...kws, ...sizes] : [...sizes, ...kws]).join(' ');
  };
  const gridShorthand = (): string => {
    const k = r();
    if (k < 0.4) return gridTemplate();
    if (k < 0.7) return `${templateTracks()} / ${autoFlowSide()}`;
    return `${autoFlowSide()} / ${templateTracks()}`;
  };

  /** Comments and odd white space around tokens: css-syntax-3 treats a comment as nothing. */
  const noise = (v: string): string => {
    if (chance(0.9)) return v;
    const k = r();
    if (k < 0.4) return `/* c */ ${v}`;
    if (k < 0.7) return v.replace(' ', pick(['  ', '\n', '/**/ ', ' /* x */ ']));
    return v.replace(/\(/g, '( ').replace(/\)/g, ' )').replace(/, /g, ' ,  ');
  };

  const PROPS: [string, () => string][] = [
    ['grid-template-columns', templateTracks],
    ['grid-template-rows', templateTracks],
    ['grid-template-areas', () => (chance(0.08) ? 'none' : areas())],
    ['grid-auto-columns', () => times(1, 3, trackSize).join(' ')],
    ['grid-auto-rows', () => (chance(0.1) ? trackList() : times(1, 3, trackSize).join(' '))],
    ['grid-auto-flow', autoFlow],
    ['grid-row-start', gridLine],
    ['grid-row-end', gridLine],
    ['grid-column-start', gridLine],
    ['grid-column-end', gridLine],
    ['grid-row', () => lines(chance(0.9) ? 2 : 3)],
    ['grid-column', () => lines(2)],
    ['grid-area', () => lines(chance(0.9) ? 4 : 5)],
    ['grid-template', gridTemplate],
    ['grid', gridShorthand],
    ['justify-items', () => alignment(true)],
    ['justify-self', () => alignment(false)],
    ['grid-gap', () => times(1, 2, () => (chance(0.9) ? lp() : 'normal')).join(' ')],
    ['grid-row-gap', lp],
    ['grid-column-gap', lp],
  ];
  const WEIGHTS = [10, 6, 6, 4, 3, 2, 3, 2, 2, 2, 4, 3, 5, 10, 10, 3, 3, 1, 1, 1];
  const total = WEIGHTS.reduce((a, b) => a + b, 0);
  const out: [string, string][] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (out.length < count && guard++ < count * 20) {
    let k = r() * total;
    let i = 0;
    while (k >= (WEIGHTS[i] as number)) k -= WEIGHTS[i++] as number;
    const [p, gen] = PROPS[i] as [string, () => string];
    const v = noise(gen()).trim();
    if (v === '' || seen.has(`${p}: ${v}`)) continue;
    seen.add(`${p}: ${v}`);
    out.push([p, v]);
  }
  return out;
}

if (process.argv.includes('--write')) {
  const { writeFileSync } = await import('node:fs');
  const corpus = { seed: GRID_FUZZ_SEED, count: GRID_FUZZ_COUNT, generator: 'packages/parity/test/grid-fuzz/generate.ts', declarations: generateGridDeclarations() };
  writeFileSync(new URL('../../../dragon/test/data/grid-fuzz-corpus.json', import.meta.url), `${JSON.stringify(corpus, null, 0).replace(/\],\[/g, '],\n[')}\n`);
  console.log(`wrote ${corpus.declarations.length} declarations`);
}

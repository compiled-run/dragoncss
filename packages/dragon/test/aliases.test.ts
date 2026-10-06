// Legacy property aliases (css/aliases.ts): Chrome resolves an alias to its property at parse time, so an alias declaration is
// the standard declaration, in the cascade and in @keyframes too. Chrome parity is proven by fixture-groups/aliases.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keyframesOverride } from '../src/analysis/animations.ts';
import { ALIAS_FAMILIES, resolveAlias } from '../src/css/aliases.ts';
import { parseKeyframesRules } from '../src/css/at-rules/keyframes.ts';
import type { KeyframesSource } from '../src/css/at-rules/keyframes.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { Diagnostic } from '../src/types.ts';
import { div, explainOne, inputFor, spanTextOf } from './helpers.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const ALIASES = Object.values(ALIAS_FAMILIES).flatMap((f) => Object.entries(f));

function parse(body: string): { declarations: readonly Declaration[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const text = `.a { ${body} }`;
  const rules = parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics);
  return { declarations: rules[0]?.declarations ?? [], diagnostics };
}

type Parsed = { declarations: object[]; diagnostics: [string, string][] };

/** What a declaration parses to, without its source positions. */
function parsed(body: string): Parsed {
  const { declarations, diagnostics } = parse(body);
  const strip = (d: Declaration) => ({ property: d.property, text: d.text, longhands: d.longhands, important: d.important, pending: d.pending, alias: d.alias, animation: d.animation });
  return { declarations: declarations.map(strip), diagnostics: diagnostics.map((d) => [d.code, d.message]) };
}

/** The standard declaration's parse as its alias gives it: the alias recorded, and each message naming the alias. */
const asAlias = (p: Parsed, alias: string, property: string): Parsed => ({
  declarations: p.declarations.map((d) => ({ ...d, alias })),
  diagnostics: p.diagnostics.map(([code, message]) => [code, `${message} (${alias} is an alias of ${property})`]),
});

/** Values for each standard property: a typical value, a multi-token value where the grammar has one, and an invalid value. */
const SAMPLES: { readonly [property: string]: readonly string[] } = {
  'box-sizing': ['border-box', 'content-box'],
  'align-content': ['center', 'space-between', 'first baseline'],
  'align-items': ['flex-end', 'last baseline', 'safe center'],
  'align-self': ['auto', 'stretch', 'baseline'],
  'column-gap': ['4px', 'normal', '10%'],
  flex: ['1', 'none', '2 0 10px', 'auto'],
  'flex-basis': ['10%', 'content', 'auto'],
  'flex-direction': ['column-reverse', 'row'],
  'flex-flow': ['column wrap', 'wrap-reverse'],
  'flex-grow': ['2', '0.5'],
  'flex-shrink': ['0', '3'],
  'flex-wrap': ['wrap-reverse', 'nowrap'],
  'justify-content': ['space-between', 'flex-end', 'unsafe center'],
  order: ['-1', '2'],
  'border-block-end': ['2px dashed red', 'thin solid'],
  'border-block-start': ['3px solid', 'medium double blue'],
  'border-inline-end': ['1px dotted #123', 'solid'],
  'border-inline-start': ['4px solid red', 'groove'],
  'border-block-end-color': ['red', 'currentcolor'],
  'border-block-start-color': ['rgb(1 2 3)'],
  'border-inline-end-color': ['teal'],
  'border-inline-start-color': ['#abc'],
  'border-block-end-style': ['dashed'],
  'border-block-start-style': ['dotted'],
  'border-inline-end-style': ['double'],
  'border-inline-start-style': ['solid'],
  'border-block-end-width': ['3px', 'thick'],
  'border-block-start-width': ['1px'],
  'border-inline-end-width': ['thin'],
  'border-inline-start-width': ['5px'],
  'block-size': ['50px', 'auto', '20%'],
  'inline-size': ['60px', 'auto'],
  'max-block-size': ['none', '70px'],
  'max-inline-size': ['80%'],
  'min-block-size': ['0', '9px'],
  'min-inline-size': ['auto', '11px'],
  'margin-block-end': ['5px', 'auto'],
  'margin-block-start': ['-3px'],
  'margin-inline-end': ['7px', 'auto'],
  'margin-inline-start': ['10%', '2px'],
  'padding-block-end': ['6px'],
  'padding-block-start': ['1px'],
  'padding-inline-end': ['5%'],
  'padding-inline-start': ['8px'],
  animation: ['k 1s ease-in 0.5s 2 alternate backwards', 'k 1s, j 2s steps(3) infinite reverse paused', 'none', 'k 1s linear(0, 1)', 'k 1s calc(1s)'],
  'animation-delay': ['0.5s', '-1s, 2s', '1px'],
  'animation-direction': ['alternate', 'reverse, normal', 'sideways'],
  'animation-duration': ['1s', 'auto', '-1s'],
  'animation-fill-mode': ['backwards', 'both, none'],
  'animation-iteration-count': ['infinite', '2.5', '-1'],
  'animation-name': ['k', 'none, j', '"q"'],
  'animation-play-state': ['paused', 'running, paused'],
  'animation-timing-function': ['ease-in-out', 'step-start', 'cubic-bezier(0.5, -1, 0.5, 2)', 'steps(4, jump-none)', 'linear(0, 1)'],
  transition: ['width 1s ease-out', 'all 0.3s, color 1s step-end 0.1s', 'none', 'width 1s allow-discrete'],
  'transition-delay': ['0.1s', '-0.2s, 0s'],
  'transition-duration': ['0.3s', '1s, 2s', '-1s'],
  'transition-property': ['width', 'all, color', 'none', '-webkit-margin-start'],
  'transition-timing-function': ['ease-in', 'step-end', 'cubic-bezier(0, 0, 1, 1)', 'steps(2)'],
};
const COMMON = ['inherit', 'initial', 'unset', 'revert', 'var(--x)', 'var(--x, 1px) var(--y)', 'not-a-value', '1px !important'];

describe('legacy aliases parse as their property', () => {
  it('every alias is a lower-case -webkit- name, and resolveAlias maps it and nothing else', () => {
    expect(ALIASES.length).toBe(58);
    for (const [alias, property] of ALIASES) {
      expect(alias, alias).toMatch(/^-webkit-[a-z-]+$/);
      expect(resolveAlias(alias)).toBe(property);
      expect(resolveAlias(property)).toBe(property);
    }
    expect(resolveAlias('-webkit-transform')).toBe('-webkit-transform');
    expect(resolveAlias('--webkit-flex')).toBe('--webkit-flex');
  });
  it('an alias declaration parses exactly as its property declaration, for valid, multi-token, wide, var() and invalid values', () => {
    for (const [alias, property] of ALIASES) {
      const values = SAMPLES[property];
      expect(values, `${alias}: no sample values for ${property}`).toBeDefined();
      for (const v of [...(values ?? []), ...COMMON]) expect(parsed(`${alias}: ${v}`), `${alias}: ${v}`).toEqual(asAlias(parsed(`${property}: ${v}`), alias, property));
    }
  });
  it('the name is matched ASCII case-insensitively and through escapes, as every property name is', () => {
    expect(parsed('-WebKit-Flex-Grow: 2')).toEqual(asAlias(parsed('flex-grow: 2'), '-webkit-flex-grow', 'flex-grow'));
    expect(parsed('-webkit-flex-\\67 row: 2')).toEqual(asAlias(parsed('flex-grow: 2'), '-webkit-flex-grow', 'flex-grow'));
  });
  it('a diagnostic about an alias declaration names the alias as written', () => {
    expect(parsed('-webkit-margin-before: foo').diagnostics).toEqual([['DRAGON_CSS_INVALID_VALUE', '"foo" is not a valid value for margin-block-start (@webref/css grammar) (-webkit-margin-before is an alias of margin-block-start)']]);
    expect(parsed('margin-block-start: foo').diagnostics).toEqual([['DRAGON_CSS_INVALID_VALUE', '"foo" is not a valid value for margin-block-start (@webref/css grammar)']]);
  });
  it('aliases Chrome parses with legacy rules, and non-aliases, stay refused as unknown properties', () => {
    for (const name of ['-webkit-transform', '-webkit-transform-origin', '-webkit-border-radius', '-webkit-writing-mode', '-webkit-user-select', '-webkit-box-orient', '-webkit-box-flex']) {
      expect(parse(`${name}: none`).diagnostics.map((d) => d.code), name).toEqual(['DRAGON_UNSUPPORTED_PROPERTY']);
    }
  });
  it('an alias in a keyframe block sets its property', () => {
    const frames = (body: string) => {
      const diagnostics: Diagnostic[] = [];
      const sources: KeyframesSource[] = [];
      const text = `@keyframes k { from { ${body} } }`;
      parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics, [], [], sources);
      const rules = parseKeyframesRules(sources, diagnostics);
      return { values: rules.flatMap((r) => r.blocks.flatMap((b) => b.values.map((x) => [x.property, x.value]))), diagnostics: diagnostics.map((d) => d.code) };
    };
    expect(frames('-webkit-flex-grow: 2; -webkit-margin-before: 3px; -webkit-flex-direction: column')).toEqual(frames('flex-grow: 2; margin-block-start: 3px; flex-direction: column'));
    expect(frames('-webkit-flex-grow: 2').values).toEqual([['flex-grow', { kind: 'number', value: 2 }]]);
    const messages = (body: string) => {
      const diagnostics: Diagnostic[] = [];
      const sources: KeyframesSource[] = [];
      const text = `@keyframes k { from { ${body} } }`;
      parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics, [], [], sources);
      parseKeyframesRules(sources, diagnostics);
      return diagnostics.map((d) => d.message);
    };
    expect(messages('-webkit-flex-grow: red; -webkit-order: 1 !important')).toEqual([
      '"red" is not a valid value for flex-grow, so Chrome ignores it in @keyframes k (-webkit-flex-grow is an alias of flex-grow)',
      '!important on order in @keyframes k: Chrome ignores it inside @keyframes, so the declaration has no effect (-webkit-order is an alias of order)',
    ]);
  });
});

describe('an alias and its property share one cascade', () => {
  const project = (direction: 'ltr' | 'rtl' = 'ltr') =>
    createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction });
  const css = `body { margin: 0; font-family: Ahem; font-size: 10px; } .rtl { direction: rtl; }
    .as { -webkit-flex-direction: column; flex-direction: row; }
    .sa { flex-direction: row; -webkit-flex-direction: column; }
    .imp { -webkit-flex-grow: 3 !important; flex-grow: 1; }
    .spec.spec { -webkit-box-sizing: border-box; } .spec { box-sizing: content-box; }
    .ml { -webkit-margin-start: 5px; margin-left: 7px; }
    .lm { margin-left: 7px; -webkit-margin-start: 5px; }
    .mix { margin-inline-start: 1px; -webkit-margin-start: 2px; margin-inline-start: 3px; -webkit-margin-end: 4px; }
    .sh { -webkit-flex: 2 0 10px; -webkit-flex-basis: 20px; }`;
  const tree = inputFor(css, (r) => [
    div(r, 'as', ['as']), div(r, 'sa', ['sa']), div(r, 'imp', ['imp']), div(r, 'spec', ['spec']),
    div(r, 'ml', ['ml']), div(r, 'lm', ['lm']), div(r, 'mix', ['mix']), div(r, 'sh', ['sh']),
    div(r, 'rml', ['rtl', 'ml']), div(r, 'rlm', ['rtl', 'lm']),
  ]);
  const compiled = { ltr: project('ltr').compile(tree), rtl: project('rtl').compile(tree) };
  const value = (node: string, property: string, target: 'web' | 'ios' | 'android' = 'web') => explainOne(compiled.ltr, target, node, property).value;
  it('the later of the alias and the property wins, on every target', () => {
    for (const target of ['web', 'ios', 'android'] as const) {
      expect([value('as', 'flex-direction', target), value('sa', 'flex-direction', target)], target).toEqual(['row', 'column']);
    }
  });
  it('importance and specificity decide before order, as for any declaration', () => {
    expect(value('imp', 'flex-grow')).toBe('3');
    expect(value('spec', 'box-sizing')).toBe('border-box');
  });
  it('a logical alias competes with the physical longhand of the element direction only', () => {
    expect([value('ml', 'margin-left'), value('lm', 'margin-left')]).toEqual(['7px', '5px']);
    expect([value('rml', 'margin-left'), value('rml', 'margin-right'), value('rlm', 'margin-right')]).toEqual(['7px', '5px', '5px']);
    expect([value('mix', 'margin-left'), value('mix', 'margin-right')]).toEqual(['3px', '4px']);
    expect(explainOne(compiled.rtl, 'web', 'ml', 'margin-right').value).toBe('5px');
  });
  it('an alias of a shorthand sets its longhands, and a later alias of one longhand overrides it', () => {
    expect([value('sh', 'flex-grow'), value('sh', 'flex-shrink'), value('sh', 'flex-basis')]).toEqual(['2', '0', '20px']);
  });
  it('the losing declaration is reported at its alias source', () => {
    const e = explainOne(compiled.ltr, 'web', 'as', 'flex-direction');
    expect(e.losing.map((l) => spanTextOf(tree, { origin: l.origin } as Diagnostic))).toEqual(['-webkit-flex-direction: column']);
  });
  it('compiles with no diagnostics', () => {
    expect(compiled.ltr.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('profile diagnostics name the alias as written', () => {
  const messages = (css: string, direction: 'ltr' | 'rtl', body: (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => ReturnType<typeof div>[]) => {
    const tree = inputFor(css, body);
    const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'enforce', direction }).compile(tree);
    return [...new Set(c.diagnostics.map((d) => `${d.code} ${d.message}`))];
  };
  it('an unsupported value says which alias set it', () => {
    expect(messages('body { margin: 0 } .a { -webkit-box-sizing: inherit }', 'ltr', (r) => [div(r, 'a', ['a'])])).toEqual([
      'DRAGON_UNSUPPORTED_VALUE box-sizing: inherit (set by -webkit-box-sizing: inherit) is unsupported (support profile m1-s5); in block/ltr use border-box or content-box',
    ]);
  });
  it('an unproven context names the alias shorthand that set the longhand', () => {
    const [m, ...rest] = messages('body { margin: 0 } .p { display: flex } .a { -webkit-flex: 3 }', 'rtl', (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'])])]);
    expect(rest).toEqual([]);
    expect(m).toMatch(/^DRAGON_UNPROVEN_CONTEXT flex-basis:<percentage> \(set by -webkit-flex: 3\) on .* -webkit-flex sets flex-basis, which is unproven here, so write flex-grow: 3; flex-shrink: 1 instead of -webkit-flex$/);
  });
});

describe('the alias fixtures cover every alias', () => {
  it('each alias appears in a fixture of the aliases group, or the animation ones in the anim-webkit frame fixture', () => {
    const html = ['alias-flex', 'alias-logical'].map((id) => readFileSync(new URL(`../../parity/fixtures/${id}.html`, import.meta.url), 'utf8')).join('\n');
    const frames = readFileSync(new URL('../../parity/fixtures/anim-webkit/view.css', import.meta.url), 'utf8');
    for (const [alias] of ALIASES) expect((alias.includes('-transition') || alias.includes('-animation') ? frames : html).includes(`${alias}:`), alias).toBe(true);
    expect(frames).toContain('@-webkit-keyframes');
  });
});

describe('@-webkit-keyframes is @keyframes (css_parser_impl.cc ConsumeKeyframesRule)', () => {
  const rulesOf = (text: string) => {
    const diagnostics: Diagnostic[] = [];
    const sources: KeyframesSource[] = [];
    parseStylesheet(text, { source: SRC, start: 0, end: text.length }, { id: 's', owner: 'o', scope: 'document' }, 0, diagnostics, [], [], sources);
    return { rules: parseKeyframesRules(sources, diagnostics), diagnostics: diagnostics.map((d) => [d.code, d.message]) };
  };
  it('parses as @keyframes, marked prefixed, in any case', () => {
    const plain = rulesOf('@keyframes k { from { width: 1px } 50% { width: 2px } }');
    for (const name of ['-webkit-keyframes', '-WebKit-Keyframes']) {
      const prefixed = rulesOf(`@${name} k { from { width: 1px } 50% { width: 2px } }`);
      expect(prefixed.diagnostics, name).toEqual([]);
      expect(prefixed.rules.map((r) => [r.name, r.prefixed, r.blocks.map((b) => [b.offsets, b.values.map((v) => [v.property, v.value])])]), name).toEqual(plain.rules.map((r) => [r.name, true, r.blocks.map((b) => [b.offsets, b.values.map((v) => [v.property, v.value])])]));
    }
    expect(plain.rules[0]?.prefixed).toBe(false);
  });
  it('is refused where @keyframes is, naming the rule as written', () => {
    expect(rulesOf('@media (min-width: 1px) { @-webkit-keyframes k { to { width: 1px } } }').diagnostics).toEqual([['DRAGON_UNSUPPORTED_AT_RULE', '@-webkit-keyframes inside @media is not supported (package MQ-R)']]);
    expect(rulesOf('@-webkit-keyframes none { to { width: 1px } }').diagnostics.map((d) => d[0])).toEqual(['DRAGON_UNSUPPORTED_AT_RULE']);
  });
  it('an unprefixed rule beats a prefixed one of the same name in either order; otherwise the later wins (AddKeyframeStyle)', () => {
    const winner = (text: string): number | undefined => {
      const rules = rulesOf(text).rules;
      let won: (typeof rules)[number] | undefined;
      for (const r of rules) if (keyframesOverride(r, won)) won = r;
      return won === undefined ? undefined : rules.indexOf(won);
    };
    expect(winner('@keyframes k { to { width: 1px } } @-webkit-keyframes k { to { width: 2px } }')).toBe(0);
    expect(winner('@-webkit-keyframes k { to { width: 2px } } @keyframes k { to { width: 1px } }')).toBe(1);
    expect(winner('@-webkit-keyframes k { to { width: 2px } } @-webkit-keyframes k { to { width: 3px } }')).toBe(1);
    expect(winner('@keyframes k { to { width: 2px } } @keyframes k { to { width: 3px } }')).toBe(1);
  });
});

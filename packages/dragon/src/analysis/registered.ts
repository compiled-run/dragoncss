// CASC 2: the document's @property registrations (css/at-rules/property.ts) and what Dragon refuses around them: a declared value
// of a typed registered property whose computed value Dragon does not compute, and a transition that would interpolate one
// (Chrome interpolates a typed registered property; Dragon has no writer for it).
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Registration, PropertySource } from '../css/at-rules/property.ts';
import { computeRegistered, parsePropertyRules } from '../css/at-rules/property.ts';
import type { Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Diagnostic } from '../types.ts';

export function registrationsOf(sources: readonly PropertySource[], rules: readonly Rule[], faults: CompilerFaults, diagnostics: Diagnostic[]): Map<string, Registration> {
  const parsed = parsePropertyRules(sources, diagnostics);
  const registered = new Map<string, Registration>();
  for (const [name, r] of parsed) registered.set(name, { ...r, ...(faults.propertyInheritsIgnored ? { inherits: true } : {}), ...(faults.propertyInitialIgnored ? { initial: null } : {}) });
  const typedDeclared = new Set<string>();
  for (const rule of rules) {
    for (const d of rule.declarations) {
      const r = d.custom === undefined ? undefined : registered.get(d.custom.name);
      if (r === undefined || r.syntax === '*' || d.custom === undefined) continue;
      typedDeclared.add(r.name);
      if (d.custom.wide !== null) continue;
      const c = computeRegistered(r.syntax, d.text);
      if (c.kind === 'refused') {
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: authored(d.valueSpan),
          message: `${d.property}: ${d.text} is unsupported: ${r.name} is registered with syntax "${r.syntax}", and ${c.reason}`,
          related: [{ origin: authored(r.span), message: `the @property ${r.name} registration` }],
        }));
      }
    }
  }
  if (typedDeclared.size === 0) return registered;
  for (const rule of rules) {
    for (const d of rule.declarations) {
      const list = d.animation?.longhands.get('transition-property');
      if (list === undefined) continue;
      const names = list.kind === 'wide' ? ['all'] : list.items.flatMap((i) => (i.kind === 'name' || i.kind === 'keyword' ? [i.value] : []));
      const covered = [...typedDeclared].filter((n) => names.includes('all') || names.includes(n)).sort();
      if (covered.length === 0) continue;
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: authored(d.valueSpan),
        message: `${d.alias ?? d.property} is unsupported here: it transitions ${covered.join(', ')}, registered with a typed syntax, which Chrome interpolates and Dragon has no writer for yet`,
      }));
    }
  }
  return registered;
}

// The fixture spec constructors every fixture group uses (fixture-groups/<group>.ts).
import type { DiagnosticCode, Environment } from 'dragon';
import type { FixtureSpec } from '../fixtures.ts';

export const layout = (id: string, environments: readonly Environment['direction'][] = ['ltr'], rootFont: Environment['rootFont'] = 'ahem'): FixtureSpec => ({ id, format: 'html', kind: 'layout', gate: 'default', environments, source: 'hand-written', rootFont });
/** An HTML fixture that runs in both environment directions (every position-* and flex-abspos-* fixture). */
export const both = (id: string): FixtureSpec => layout(id, ['ltr', 'rtl']);
export const generated = (id: string): FixtureSpec => ({ id, format: 'html', kind: 'layout', gate: 'default', environments: ['ltr', 'rtl'], source: 'generated', rootFont: 'ahem' });
export const tree = (id: string): FixtureSpec => ({ id, format: 'tree', kind: 'layout', gate: 'default', environments: ['ltr', 'rtl'], source: 'hand-written', rootFont: 'ahem' });
export const reject = (id: string, code: DiagnosticCode, spanText: string | null, messagePrefix: string | null = null): FixtureSpec => ({ id, format: 'html', kind: 'reject', expect: { code, spanText, messagePrefix } });
export const rejectTree = (id: string, code: DiagnosticCode, spanText: string | null): FixtureSpec => ({ id, format: 'tree', kind: 'reject', expect: { code, spanText, messagePrefix: null } });

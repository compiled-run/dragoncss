// Fixture group user-modify (TOUCH): -webkit-user-modify at read-only in any case, inherited, through var(), inherit, initial and
// unset, on blocks, flex items and positioned boxes (user-modify-values, web and native rows). Nothing Dragon resolves is editable,
// so read-only changes nothing. The reject: read-write, which makes the content editable.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const USER_MODIFY: readonly FixtureSpec[] = [
  both('user-modify-values'),
  reject('reject-user-modify-read-write', 'DRAGON_UNSUPPORTED_VALUE', 'read-write', '-webkit-user-modify: read-write is unsupported'),
];

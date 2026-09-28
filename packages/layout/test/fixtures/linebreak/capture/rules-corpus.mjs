// The supplementary Chrome oracle corpus: short texts aimed at each Blink and UAX #14 rule the spike corpus does not reach
// (Blink's ASCII pair table, the hyphen-digit rule, the Latin-1 pair table, quotes, zero-width characters, combining marks,
// emoji, CJK, Hangul and Hebrew), each in en and ja.
// Usage (from the repo root):
//   node packages/layout/test/fixtures/linebreak/capture/rules-corpus.mjs /tmp/rules-in.json
//   node packages/layout/test/fixtures/linebreak/capture/chrome-opportunities.mjs /tmp/rules-in.json packages/layout/test/fixtures/linebreak/chrome145-rules.json
import fs from 'node:fs';

export const texts = [
  ['ascii-open', 'a!(b x?(y z)(w k.(m q,(r s;<t u![v w:{x 1(2 $(3'],
  ['ascii-after', 'one?two three-four five--six a-b-c x-!y p-.q m-/n'],
  ['ascii-hyphen-symbols', 'x-$5 y-(z) a-[b] c-{d} e-<f> g-"h" i-\'j\' k-@l m-#n o-%p q-&r s-*t u-+v'],
  ['ascii-quotes', 'is \'quoted\' and "double" and it\'s ok?"yes" or?\'no\' a"b"c d\'e\'f'],
  ['ascii-solidus', 'path/to/file.txt a/b 1/2 x/-y http://x.y/z?q=1&r=2#frag and/or ./rel ../up /root'],
  ['ascii-minus', 'minus -5 and a-5 and 5-5 and --5 and (-5) and x--5 and A-1B and _-3 and .-4 and z-9z'],
  ['ascii-symbols', '$100 100% (50%) [1,000] {2.5} #1 @me a&b a+b a=b a*b a|b a~b a^b a_b a`b a\\b a>b a<b'],
  ['numbers', '$(12.50) 12,345.67% -1.5e10 1:30pm 3/4/2025 US$5 +44 (0)20 1.2.3 v2.0-beta.1 50/50 #1-2'],
  ['nbsp', 'a\u00A0b a\u00A0\u00A0b x \u00A0y p\u00A0 q 5\u00A0% \u00A0lead m\u00A0-n'],
  ['shy', 'soft\u00ADhyphen\u00AD\u00ADdouble a\u00AD-b x\u00AD1 y\u00AD(z) w\u00AD.v q\u00AD\u00A0r'],
  ['latin1', 'a×b 3×4 ½¾ ¡Hola! ¿Qué? «guillemets» »reverse« naïve café £5 5€ 10°C §2 ©2024 a·b ±3 x² æøå ¨a'],
  ['latin1-ascii', 'a»(b c«-d e°/f g§-1 h´i 5°-6 £(7) x\u00AD\u00ADy'],
  ['curly', '“curly” ‘single’ „low“ it’s — em–en … x…y a—b c–d “a”“b” (“p”) ‘q’s'],
  ['unicode-punct', 'a‐b c‑d e‒f g―h i†j k•l m′n o※p q⁄r s−t u→v w·x'],
  ['zw', 'zero\u200Bwidth\u200B space word\u2060joiner a\u200B\u200Bb c \u200Bd e\u200B f'],
  ['combining', 'e\u0301tude cafe\u0301 a\u0308b\u0308c n\u0303o x\u0301-y z\u0301/w'],
  ['emoji', 'emoji 👍🏽 test 🇺🇸🇯🇵 flags a👍b ☺\uFE0F ok 👨\u200D👩\u200D👧 fam'],
  ['cjk', '日本語（テスト）です。「引用」、ok！ちょっとまってーカード々民'],
  ['cjk-mixed', '中文文本，测试。ABC漢字123円 $5万 100%込み 「Q」A ‘漢’ “字”'],
  ['hangul', '한국어 텍스트입니다. 안녕하세요(테스트)!'],
  ['hebrew', 'שלום-עולם א-b c/ב'],
];

if (process.argv[1].endsWith('rules-corpus.mjs')) {
  const out = [];
  for (const [id, text] of texts) for (const lang of ['en', 'ja']) out.push({ id: `${id}/${lang}`, lang, text });
  fs.writeFileSync(process.argv[2], JSON.stringify(out));
  console.log(out.length, 'texts');
}

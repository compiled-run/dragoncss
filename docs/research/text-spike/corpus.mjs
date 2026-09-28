// Shared corpus: paragraphs x fonts x sizes x widths. Emits out/cases.json.
import fs from 'node:fs';
const SHY = '­', NBSP = ' ';
export const latin = {
  prose: 'The quick brown fox jumps over the lazy dog while the committee deliberates about whether a paragraph of ordinary English prose, with its commas and full stops, will wrap at the same places in every engine. Typography is the craft of arranging type to make written language legible, readable and appealing when displayed.',
  longwords: 'Pneumonoultramicroscopicsilicovolcanoconiosis is a word; so is Donaudampfschifffahrtsgesellschaftskapitän. Visit https://example.com/a/very/long/path/segment?query=parameter&another=value for incomprehensibilities.',
  punct: '"Well," she said — pausing … “it’s (mostly) fine; e.g. 1,234.56 items, 50% off, and/or $19.99!” Then: [done] {ok} <tag> #hash @user a/b/c 3×4=12 — right?',
  hyphen: 'A well-known state-of-the-art twenty-first-century mother-in-law bought a ready-to-wear, one-of-a-kind, non-negotiable, up-to-date self-driving car on 2024-01-15.',
  shy: `Soft hyphens: super${SHY}cali${SHY}fragi${SHY}listic${SHY}expi${SHY}ali${SHY}docious and in${SHY}com${SHY}pre${SHY}hen${SHY}si${SHY}bil${SHY}i${SHY}ties and inter${SHY}na${SHY}tion${SHY}al${SHY}iza${SHY}tion are words that may break.`,
  kernlig: 'AVATAR Wave To Ty Yo office affine waffle fjord flight ff fi fl ffi ffl LTA PAY “VAT” T.V. W.A. 11.11 1/4 Kerning pairs like AV, AW, Te, Yo, P., F, and ligatures like official traffic.',
  numbers: 'Order 0123456789 shipped 12:45 on 03/07/2025; totals 1,000,000 and 9,876.54 (net), IDs A1B2C3 and x86_64, ratio 16:9, version 10.15.7, pages 12–34.',
  nbsp: `Keep${NBSP}these${NBSP}words${NBSP}together, Mr.${NBSP}Smith paid 100${NBSP}km of tolls in 10${NBSP}days, then  two  spaces   collapse   here and\ttabs\ttoo.`,
};
export const cjk = {
  ja: '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。「しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。」',
  jamix: '日本語の文章にEnglish wordsや数字123、記号（括弧）「かぎ括弧」を混ぜた段落です。行頭禁則の「。」や「、」、小さい「っ」「ゃ」、長音「ー」の扱いを確認します。ウェブブラウザとネイティブエンジンの比較テスト。',
  jakinsoku: 'これは、禁則処理（きんそくしょり）のテストです！　句読点。。、、が行頭に来ないこと、括弧「」『』【】の開始が行末に残らないこと？　そして小書き文字ぁぃぅぇぉっゃゅょを確認……します。',
};
export const fonts = {
  Inter: 'Inter-Regular.ttf',
  Roboto: 'Roboto-Regular.ttf',
  NotoSans: 'NotoSans-Regular.ttf',
  NotoSansJP: 'NotoSansJP-Regular.otf',
  InterVF: 'Inter-VF.ttf',
};
export const sizes = [12, 16, 17, 24];
export const widths = [120, 177, 240, 333, 480];
export function cases() {
  const out = [];
  for (const [font] of Object.entries(fonts)) {
    const paras = font === 'NotoSansJP' ? { ...cjk, prose: latin.prose } : latin;
    for (const [pid, text] of Object.entries(paras)) {
      if (font === 'InterVF' && !['prose', 'kernlig', 'punct'].includes(pid)) continue;
      for (const size of sizes) for (const width of widths)
        out.push({ id: `${font}/${pid}/${size}/${width}`, font, file: fonts[font], para: pid, text: text.replace(/[ \t\n]+/g, ' '), lang: font === 'NotoSansJP' ? 'ja' : 'en', size, width });
    }
  }
  return out;
}
if (process.argv[1].endsWith('corpus.mjs')) {
  const c = cases();
  fs.writeFileSync(new URL('./out/cases.json', import.meta.url), JSON.stringify(c));
  console.log(c.length, 'cases');
}

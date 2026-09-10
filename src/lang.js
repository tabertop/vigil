// Language filter — keep the wire/brief English-only.
// Many Telegram channels and some wires post in Arabic/Persian/Russian/CJK/etc.
// This is a zero-dependency script-based heuristic: if non-Latin script letters
// dominate a headline, it's treated as non-English and dropped. Transliterated
// names, an emoji, or a stray foreign word won't trip it — only genuinely
// non-Latin text does.

const NON_LATIN = /[Ѐ-ӿԀ-ԯ؀-ۿݐ-ݿ֐-׿܀-ݏऀ-ॿঀ-৿฀-๿一-鿿぀-ヿ가-힯]/g;

export function isEnglish(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  const letters = s.match(/\p{L}/gu) || [];
  if (letters.length < 3) return true;                 // too short to judge — keep
  const latin = s.match(/[A-Za-z]/g) || [];
  const nonLatin = s.match(NON_LATIN) || [];
  // reject fully-foreign AND bilingual headlines: 2+ non-Latin script letters means
  // it carries real non-English text (a lone incidental glyph is tolerated).
  if (nonLatin.length >= 2) return false;
  // require Latin to be the majority of alphabetic characters
  return latin.length >= letters.length * 0.6;
}

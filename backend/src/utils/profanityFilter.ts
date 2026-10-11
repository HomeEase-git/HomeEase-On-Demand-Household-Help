// Filipino/Tagalog profanity and insults commonly seen in client review
// comments. Masked with asterisks rather than used to hide the whole review
// — adminReviewController's HIDDEN/WARNED statuses are for issues beyond
// plain profanity (harassment, fake reviews, personal info, etc).
// Longest phrases first so "putang ina" is tried as a whole before its
// shorter relatives ("puta", "ina" alone aren't on this list, but other
// multi-word entries follow the same rule).
const PROFANITY_WORDS = [
  // Strongest / most common
  'putang ina',
  'putangina',
  'tangina',
  'tang ina',
  'puta',
  'patutot',
  'kingina',
  'tanginamo',
  'putanginamo',
  // Insults
  'gago',
  'gaga',
  'bobo',
  'boba',
  'tanga',
  'ulol',
  'engot',
  'ungas',
  'tarantado',
  'inutil',
  'siraulo',
  'loko',
  'loka',
  'hungak',
  // Mild/other curses & exclamations
  'hayop',
  'hayup',
  'walang hiya',
  'walanghiya',
  'kupal',
  'bwisit',
  'buwisit',
  'lintik',
  'leche',
  'letse',
  'punyeta',
  'peste',
  'pakshet',
  'pakyu',
  'yawa',
  'pisti',
] as const;

const SORTED_WORDS = [...PROFANITY_WORDS].sort((a, b) => b.length - a.length);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// \s+ (not a literal space) so "putang   ina" / multi-space typing still matches.
const PROFANITY_PATTERN = new RegExp(
  `\\b(?:${SORTED_WORDS.map((word) => escapeRegExp(word).replace(/ /g, '\\s+')).join('|')})\\b`,
  'gi'
);

function maskToken(token: string): string {
  return token.length <= 1 ? token : token[0] + '*'.repeat(token.length - 1);
}

// A multi-word match ("putang ina") is masked word by word so the spacing
// in the original text is preserved.
function maskMatch(match: string): string {
  return match.replace(/\S+/g, maskToken);
}

/**
 * Masks Filipino profanity/insults with asterisks (first letter kept, e.g.
 * "ang bobo mo" -> "ang b*** mo") instead of hiding the whole piece of
 * text. Null/empty input passes through unchanged.
 */
export function maskProfanity(text: string | null | undefined): string | null | undefined {
  if (!text) return text;
  return text.replace(PROFANITY_PATTERN, maskMatch);
}

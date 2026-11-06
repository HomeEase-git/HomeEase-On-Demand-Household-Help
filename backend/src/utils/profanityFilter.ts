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

const PROFANITY_PATTERN = new RegExp(
  `\\b(?:${SORTED_WORDS.map((word) => escapeRegExp(word).replace(/ /g, '\\s+')).join('|')})\\b`,
  'gi'
);

function maskToken(token: string): string {
  return token.length <= 1 ? token : token[0] + '*'.repeat(token.length - 1);
}

function maskMatch(match: string): string {
  return match.replace(/\S+/g, maskToken);
}

export function maskProfanity(text: string | null | undefined): string | null | undefined {
  if (!text) return text;
  return text.replace(PROFANITY_PATTERN, maskMatch);
}

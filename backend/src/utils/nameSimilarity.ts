/**
 * Crude, dependency-free name-similarity heuristic — normalizes case/
 * punctuation, splits into words, and scores token overlap (Jaccard). Only
 * meant to catch the "these are obviously different people" case, not
 * subtle mismatches (a middle initial, a maiden name, transliteration). A
 * real identity check would need a structured name extracted from KYC, but
 * this app's AI verification pipeline only produces a free-text summary —
 * no structured fields — so User.fullName is the best available signal to
 * compare a payout account name against.
 */
export function nameSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);

  const tokensA = new Set(normalize(a));
  const tokensB = new Set(normalize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

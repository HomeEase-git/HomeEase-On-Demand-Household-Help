// A stored worker position older than this is a leftover from an earlier job
// or a closed app, not "live".
const LIVE_MAX_AGE_MS = 10 * 60 * 1000;

export function isLiveFresh(updatedAtIso: string | null | undefined, now: number = Date.now()): boolean {
  if (!updatedAtIso) return false;
  const at = Date.parse(updatedAtIso);
  return Number.isFinite(at) && now - at <= LIVE_MAX_AGE_MS;
}

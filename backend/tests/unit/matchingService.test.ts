import { scoreCandidates, selectBestCandidate, MATCH_WEIGHTS, type MatchCandidate } from '@services/matchingService';

// Fixed "random" source so scores (and therefore selection) are deterministic.
const noRandomness = () => 0;
const maxRandomness = () => 1;

describe('matchingService — auto-match scoring (pure)', () => {
  it('weights sum to 100%', () => {
    const total = MATCH_WEIGHTS.rating + MATCH_WEIGHTS.distance + MATCH_WEIGHTS.completedJobs + MATCH_WEIGHTS.randomness;
    expect(total).toBeCloseTo(1, 10);
  });

  it('returns an empty array for no candidates', () => {
    expect(scoreCandidates([], 30)).toEqual([]);
    expect(selectBestCandidate([], 30)).toBeNull();
  });

  it('scores a perfect candidate (max rating, zero distance, most jobs) at the weight ceiling', () => {
    const candidates: MatchCandidate[] = [{ workerId: 'a', rating: 5, distanceKm: 0, completedJobs: 100 }];
    const [scored] = scoreCandidates(candidates, 30, noRandomness);
    // rating(1.0)*0.4 + distance(1.0)*0.3 + completed(1.0)*0.2 + random(0)*0.1
    expect(scored.score).toBeCloseTo(0.4 + 0.3 + 0.2, 10);
  });

  it('a closer worker outscores a farther one with identical rating/history', () => {
    const near: MatchCandidate = { workerId: 'near', rating: 4.5, distanceKm: 1, completedJobs: 10 };
    const far: MatchCandidate = { workerId: 'far', rating: 4.5, distanceKm: 25, completedJobs: 10 };
    const best = selectBestCandidate([near, far], 30, noRandomness);
    expect(best?.workerId).toBe('near');
  });

  it('a higher-rated worker outscores a lower-rated one at equal distance/history', () => {
    const highRated: MatchCandidate = { workerId: 'high', rating: 4.9, distanceKm: 5, completedJobs: 20 };
    const lowRated: MatchCandidate = { workerId: 'low', rating: 3.0, distanceKm: 5, completedJobs: 20 };
    const best = selectBestCandidate([highRated, lowRated], 30, noRandomness);
    expect(best?.workerId).toBe('high');
  });

  it('completedJobs is normalized against the max in the candidate pool, not an absolute scale', () => {
    const candidates: MatchCandidate[] = [
      { workerId: 'veteran', rating: 4, distanceKm: 10, completedJobs: 50 },
      { workerId: 'rookie', rating: 4, distanceKm: 10, completedJobs: 0 },
    ];
    const scored = scoreCandidates(candidates, 30, noRandomness);
    const veteran = scored.find((c) => c.workerId === 'veteran')!;
    const rookie = scored.find((c) => c.workerId === 'rookie')!;
    expect(veteran.score).toBeGreaterThan(rookie.score);
    // veteran is the pool max, so its completedJobs component alone should hit the full 20% weight
    expect(veteran.score - rookie.score).toBeCloseTo(MATCH_WEIGHTS.completedJobs, 10);
  });

  it('randomness can tip a tie between otherwise-identical candidates', () => {
    const a: MatchCandidate = { workerId: 'a', rating: 4, distanceKm: 10, completedJobs: 5 };
    const b: MatchCandidate = { workerId: 'b', rating: 4, distanceKm: 10, completedJobs: 5 };

    // Same tie-break input: no randomness -> equal scores -> first candidate wins (stable reduce)
    expect(selectBestCandidate([a, b], 30, noRandomness)?.workerId).toBe('a');

    // Asymmetric randomness: second call gets the max roll and should win instead
    let call = 0;
    const alternating = () => (call++ === 0 ? 0 : 1);
    expect(selectBestCandidate([a, b], 30, alternating)?.workerId).toBe('b');
  });

  it('clamps out-of-range distance (beyond radius) instead of producing a negative score component', () => {
    const farBeyondRadius: MatchCandidate = { workerId: 'far', rating: 5, distanceKm: 1000, completedJobs: 10 };
    const [scored] = scoreCandidates([farBeyondRadius], 30, noRandomness);
    expect(scored.score).toBeGreaterThanOrEqual(0);
    // distance component should floor at 0, so score = rating(0.4) + completed(0.2 max-normalized) + 0
    expect(scored.score).toBeCloseTo(0.4 + 0.2, 10);
  });

  it('handles a zero radius without dividing by zero', () => {
    const candidates: MatchCandidate[] = [{ workerId: 'a', rating: 5, distanceKm: 0, completedJobs: 1 }];
    expect(() => scoreCandidates(candidates, 0, noRandomness)).not.toThrow();
  });

  it('is deterministic for a fixed random source', () => {
    const candidates: MatchCandidate[] = [
      { workerId: 'a', rating: 4.2, distanceKm: 3, completedJobs: 7 },
      { workerId: 'b', rating: 4.8, distanceKm: 12, completedJobs: 2 },
    ];
    const run1 = scoreCandidates(candidates, 30, maxRandomness);
    const run2 = scoreCandidates(candidates, 30, maxRandomness);
    expect(run1).toEqual(run2);
  });
});

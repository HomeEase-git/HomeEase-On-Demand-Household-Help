import { scoreCandidates, selectBestCandidate, MATCH_WEIGHTS, type MatchCandidate } from '@services/matchingService';

// Fixed "random" source so scores (and therefore selection) are deterministic.
const noRandomness = () => 0;
const maxRandomness = () => 1;

describe('matchingService — auto-match scoring (pure)', () => {
  it('weights sum to 100%', () => {
    const total = MATCH_WEIGHTS.rating + MATCH_WEIGHTS.completedJobs + MATCH_WEIGHTS.randomness;
    expect(total).toBeCloseTo(1, 10);
  });

  it('returns an empty array for no candidates', () => {
    expect(scoreCandidates([], noRandomness)).toEqual([]);
    expect(selectBestCandidate([], noRandomness)).toBeNull();
  });

  it('scores a perfect candidate (max rating, most jobs) at the weight ceiling', () => {
    const candidates: MatchCandidate[] = [{ workerId: 'a', rating: 5, completedJobs: 100 }];
    const [scored] = scoreCandidates(candidates, noRandomness);
    // rating(1.0)*0.6 + completed(1.0)*0.3 + random(0)*0.1
    expect(scored.score).toBeCloseTo(0.6 + 0.3, 10);
  });

  it('a higher-rated worker outscores a lower-rated one at equal history', () => {
    const highRated: MatchCandidate = { workerId: 'high', rating: 4.9, completedJobs: 20 };
    const lowRated: MatchCandidate = { workerId: 'low', rating: 3.0, completedJobs: 20 };
    const best = selectBestCandidate([highRated, lowRated], noRandomness);
    expect(best?.workerId).toBe('high');
  });

  it('completedJobs is normalized against the max in the candidate pool, not an absolute scale', () => {
    const candidates: MatchCandidate[] = [
      { workerId: 'veteran', rating: 4, completedJobs: 50 },
      { workerId: 'rookie', rating: 4, completedJobs: 0 },
    ];
    const scored = scoreCandidates(candidates, noRandomness);
    const veteran = scored.find((c) => c.workerId === 'veteran')!;
    const rookie = scored.find((c) => c.workerId === 'rookie')!;
    expect(veteran.score).toBeGreaterThan(rookie.score);
    // veteran is the pool max, so its completedJobs component alone should hit the full 30% weight
    expect(veteran.score - rookie.score).toBeCloseTo(MATCH_WEIGHTS.completedJobs, 10);
  });

  it('randomness can tip a tie between otherwise-identical candidates', () => {
    const a: MatchCandidate = { workerId: 'a', rating: 4, completedJobs: 5 };
    const b: MatchCandidate = { workerId: 'b', rating: 4, completedJobs: 5 };

    // Same tie-break input: no randomness -> equal scores -> first candidate wins (stable reduce)
    expect(selectBestCandidate([a, b], noRandomness)?.workerId).toBe('a');

    // Asymmetric randomness: second call gets the max roll and should win instead
    let call = 0;
    const alternating = () => (call++ === 0 ? 0 : 1);
    expect(selectBestCandidate([a, b], alternating)?.workerId).toBe('b');
  });

  it('is deterministic for a fixed random source', () => {
    const candidates: MatchCandidate[] = [
      { workerId: 'a', rating: 4.2, completedJobs: 7 },
      { workerId: 'b', rating: 4.8, completedJobs: 2 },
    ];
    const run1 = scoreCandidates(candidates, maxRandomness);
    const run2 = scoreCandidates(candidates, maxRandomness);
    expect(run1).toEqual(run2);
  });
});

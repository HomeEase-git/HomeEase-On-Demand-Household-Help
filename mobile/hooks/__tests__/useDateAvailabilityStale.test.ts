import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../services/api', () => ({
  discoverWorkers: jest.fn(() => Promise.resolve({ workers: [], pagination: { total: 3 } })),
}));

import { useDateAvailabilityCount } from '../useWorkerDiscovery';

describe('availability count after the date changes', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not report the previous date count as settled', async () => {
    const { result, rerender } = await renderHook(
      ({ date }: { date: string }) => useDateAvailabilityCount({ serviceType: 'Cleaning', date }, true),
      { initialProps: { date: '2026-10-10' } },
    );
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(result.current).toEqual({ count: 3, loading: false });

    await rerender({ date: '2026-10-11' });
    expect(result.current).toEqual({ count: null, loading: true });
  });
});

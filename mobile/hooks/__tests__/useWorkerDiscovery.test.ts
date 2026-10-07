import { renderHook } from '@testing-library/react-native';

jest.mock('../../services/api', () => ({ discoverWorkers: jest.fn(() => new Promise(() => {})) }));

import { useWorkerDiscovery, useDateAvailabilityCount } from '../useWorkerDiscovery';

describe('worker discovery first render', () => {
  it('reports loading before the debounced first fetch, so screens do not flash "no pros"', async () => {
    const { result } = await renderHook(() => useWorkerDiscovery({ serviceType: 'Cleaning', date: '2026-10-08' }, true));
    expect(result.current.loading).toBe(true);
  });

  it('is not loading while disabled', async () => {
    const { result } = await renderHook(() => useWorkerDiscovery({}, false));
    expect(result.current.loading).toBe(false);
  });

  it('availability count also starts loading when enabled', async () => {
    const { result } = await renderHook(() => useDateAvailabilityCount({ serviceType: 'Cleaning', date: '2026-10-08' }, true));
    expect(result.current.loading).toBe(true);
  });
});

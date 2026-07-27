import { renderHook, act } from '@testing-library/react-native';
import { useLoadingError } from '../useLoadingError';

describe('useLoadingError Hook', () => {
  it('should initialize with default state', async () => {
    const { result } = await renderHook(() => useLoadingError());

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('should set loading state while running async function', async () => {
    const { result } = await renderHook(() => useLoadingError());

    let resolveRun: (value: string) => void = () => {};
    const pendingWork = new Promise<string>((resolve) => {
      resolveRun = resolve;
    });
    let runPromise: Promise<string | null> | undefined;

    await act(async () => {
      runPromise = result.current.run(() => pendingWork);
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveRun('success');
      await runPromise;
    });

    expect(result.current.loading).toBe(false);
  });

  it('should handle successful async operations', async () => {
    const { result } = await renderHook(() => useLoadingError());

    const testData = { id: 1, name: 'Test' };

    let returnedData;
    await act(async () => {
      returnedData = await result.current.run(async () => {
        return testData;
      });
    });

    expect(returnedData).toEqual(testData);
    expect(result.current.error).toBeNull();
  });

  it('should handle errors from async operations', async () => {
    const { result } = await renderHook(() => useLoadingError());
    const testError = new Error('Test error message');

    await act(async () => {
      await result.current.run(async () => {
        throw testError;
      });
    });

    expect(result.current.error).toBe('Test error message');
    expect(result.current.loading).toBe(false);
  });

  it('should handle non-Error exceptions', async () => {
    const { result } = await renderHook(() => useLoadingError());

    await act(async () => {
      await result.current.run(async () => {
        throw 'String error';
      });
    });

    expect(result.current.error).toBe(
      'Something went wrong. Please try again.'
    );
  });

  it('should clear error message', async () => {
    const { result } = await renderHook(() => useLoadingError());

    await act(async () => {
      await result.current.run(async () => {
        throw new Error('Test error');
      });
    });

    expect(result.current.error).not.toBeNull();

    await act(async () => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('should return null on error', async () => {
    const { result } = await renderHook(() => useLoadingError());

    let returnedValue;
    await act(async () => {
      returnedValue = await result.current.run(async () => {
        throw new Error('Failed');
      });
    });

    expect(returnedValue).toBeNull();
  });

  it('should reset error on new run', async () => {
    const { result } = await renderHook(() => useLoadingError());

    // First run fails
    await act(async () => {
      await result.current.run(async () => {
        throw new Error('First error');
      });
    });

    expect(result.current.error).not.toBeNull();

    // Second run succeeds
    await act(async () => {
      await result.current.run(async () => {
        return 'success';
      });
    });

    expect(result.current.error).toBeNull();
  });

  it('should handle rapid consecutive calls', async () => {
    const { result } = await renderHook(() => useLoadingError());

    const results: (string | null)[] = [];

    await act(async () => {
      const p1 = result.current.run(async () => 'first');
      const p2 = result.current.run(async () => 'second');

      results.push(await p1);
      results.push(await p2);
    });

    // Last operation should succeed
    expect(result.current.error).toBeNull();
  });
});

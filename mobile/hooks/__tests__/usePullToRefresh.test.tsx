import { act, renderHook } from "@testing-library/react-native";
import { usePullToRefresh } from "../usePullToRefresh";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("usePullToRefresh", () => {
  it("shows the spinner until the loader settles", async () => {
    const load = deferred();
    const { result } = await renderHook(() => usePullToRefresh(() => load.promise));
    expect(result.current.props.refreshing).toBe(false);

    let pull!: Promise<void>;
    await act(async () => {
      pull = result.current.props.onRefresh();
    });
    expect(result.current.props.refreshing).toBe(true);

    await act(async () => {
      load.resolve();
      await pull;
    });
    expect(result.current.props.refreshing).toBe(false);
  });

  it("ignores a second pull while one is in flight", async () => {
    const load = deferred();
    const loader = jest.fn(() => load.promise);
    const { result } = await renderHook(() => usePullToRefresh(loader));

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.props.onRefresh();
      result.current.props.onRefresh();
    });
    expect(loader).toHaveBeenCalledTimes(1);

    await act(async () => {
      load.resolve();
      await first;
    });
  });

  it("clears the spinner and swallows the error when the loader fails", async () => {
    const { result } = await renderHook(() =>
      usePullToRefresh(() => Promise.reject(new Error("offline"))),
    );
    await act(async () => {
      await result.current.props.onRefresh();
    });
    expect(result.current.props.refreshing).toBe(false);
  });
});

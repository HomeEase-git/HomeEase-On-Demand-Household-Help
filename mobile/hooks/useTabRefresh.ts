import { useEffect, useRef } from "react";
import { useTabRefreshStore } from "../store/tabRefreshStore";

export function useTabRefresh(tab: string, onRefresh: () => void | Promise<void>) {
  const token = useTabRefreshStore((s) => s.tokens[tab] ?? 0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
}

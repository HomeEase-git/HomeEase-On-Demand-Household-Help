import { useEffect, useRef } from "react";
import { useTabRefreshStore } from "../store/tabRefreshStore";

// Re-runs `onRefresh` whenever the bottom tab bar's currently-active tab is
// tapped again (see the `tabPress` listeners in the (client)/(worker) tab
// layouts). Skips the very first mount since the screen's own effects
// already load data then.
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

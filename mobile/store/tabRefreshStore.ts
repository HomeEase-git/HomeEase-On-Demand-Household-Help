import { create } from "zustand";

type TabRefreshState = {
  refreshingTab: string | null;
  tokens: Record<string, number>;
  triggerRefresh: (tab: string) => void;
  finishRefresh: () => void;
};

export const useTabRefreshStore = create<TabRefreshState>((set) => ({
  refreshingTab: null,
  tokens: {},
  triggerRefresh: (tab) =>
    set((state) => ({
      refreshingTab: tab,
      tokens: { ...state.tokens, [tab]: (state.tokens[tab] ?? 0) + 1 },
    })),
  finishRefresh: () => set({ refreshingTab: null }),
}));

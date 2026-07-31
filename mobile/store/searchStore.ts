import { create } from 'zustand';
import { searchStorage } from '../utils/storage';

type SearchState = {
  recentSearches: string[];
  addSearch: (term: string) => void;
  clearSearches: () => void;
  restoreSearches: () => Promise<void>;
};

export const useSearchStore = create<SearchState>((set, get) => ({
  recentSearches: [],

  restoreSearches: async () => {
    const stored = await searchStorage.getSearches();
    if (Array.isArray(stored) && stored.length) {
      set({ recentSearches: stored });
    }
  },

  addSearch: (term: string) => {
    const current = get().recentSearches;
    const next = current.includes(term)
      ? [term, ...current.filter((s) => s !== term)].slice(0, 10)
      : [term, ...current].slice(0, 10);
    set({ recentSearches: next });
    searchStorage.saveSearches(next);
  },

  clearSearches: () => {
    set({ recentSearches: [] });
    searchStorage.clearSearches();
  },
}));

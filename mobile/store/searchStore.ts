import { create } from 'zustand';

type SearchState = {
  recentSearches: string[];
  addSearch: (term: string) => void;
  clearSearches: () => void;
};

export const useSearchStore = create<SearchState>((set) => ({
  recentSearches: ["Plumbing", "Cleaning", "Electrical"],
  addSearch: (term: string) =>
    set((state) => {
      if (state.recentSearches.includes(term)) {
        // Remove from current position
        return {
          recentSearches: [
            term,
            ...state.recentSearches.filter((s) => s !== term),
          ].slice(0, 10),
        };
      }
      // Prepend and keep max 10 items
      return {
        recentSearches: [term, ...state.recentSearches].slice(0, 10),
      };
    }),
  clearSearches: () =>
    set({
      recentSearches: [],
    }),
}));

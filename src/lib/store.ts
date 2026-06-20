// UI-only state. All domain data lives in the backend (or demo tables) behind
// TanStack Query — see src/lib/hooks/data.ts.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartLine {
  recipeId: string;
  qty: number;
}

interface UiState {
  cart: CartLine[];
  addToCart: (recipeId: string) => void;
  setCartQty: (recipeId: string, qty: number) => void;
  clearCart: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      cart: [],
      addToCart: (recipeId) =>
        set((st) => {
          const existing = st.cart.find((l) => l.recipeId === recipeId);
          return {
            cart: existing
              ? st.cart.map((l) => (l.recipeId === recipeId ? { ...l, qty: l.qty + 1 } : l))
              : [...st.cart, { recipeId, qty: 1 }],
          };
        }),
      setCartQty: (recipeId, qty) =>
        set((st) => ({
          cart:
            qty <= 0
              ? st.cart.filter((l) => l.recipeId !== recipeId)
              : st.cart.map((l) => (l.recipeId === recipeId ? { ...l, qty } : l)),
        })),
      clearCart: () => set({ cart: [] }),
    }),
    { name: "dishdata-ui" },
  ),
);

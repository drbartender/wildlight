'use client';
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type ReactNode,
} from 'react';

export interface CartLine {
  variantId: number;
  artworkId: number;
  artworkSlug: string;
  artworkTitle: string;
  imageUrl: string;
  type: string;
  size: string;
  finish: string | null;
  priceCents: number;
  quantity: number;
}
export type CartItemInput = Omit<CartLine, 'quantity'>;

type State = { lines: CartLine[] };
type Action =
  | { type: 'add'; item: CartItemInput }
  | { type: 'remove'; variantId: number }
  | { type: 'setQty'; variantId: number; quantity: number }
  | { type: 'clear' }
  | { type: 'load'; state: State };

const KEY = 'wl_cart_v1';

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      const existing = state.lines.find((l) => l.variantId === action.item.variantId);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.variantId === existing.variantId ? { ...l, quantity: l.quantity + 1 } : l,
          ),
        };
      }
      return { lines: [...state.lines, { ...action.item, quantity: 1 }] };
    }
    case 'remove':
      return { lines: state.lines.filter((l) => l.variantId !== action.variantId) };
    case 'setQty':
      return {
        lines: state.lines.map((l) =>
          l.variantId === action.variantId ? { ...l, quantity: Math.max(1, action.quantity) } : l,
        ),
      };
    case 'clear':
      return { lines: [] };
    case 'load':
      return action.state;
    default:
      return state;
  }
}

interface CartApi {
  lines: CartLine[];
  subtotalCents: number;
  add: (item: CartItemInput) => void;
  remove: (variantId: number) => void;
  setQty: (variantId: number, q: number) => void;
  clear: () => void;
}
const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { lines: [] });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) dispatch({ type: 'load', state: JSON.parse(raw) as State });
    } catch {
      // storage unavailable; continue with empty cart
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // storage full or unavailable — session-only
    }
  }, [state]);

  const subtotalCents = state.lines.reduce(
    (s, l) => s + l.priceCents * l.quantity,
    0,
  );
  const api: CartApi = {
    lines: state.lines,
    subtotalCents,
    add: (item) => dispatch({ type: 'add', item }),
    remove: (id) => dispatch({ type: 'remove', variantId: id }),
    setQty: (id, q) => dispatch({ type: 'setQty', variantId: id, quantity: q }),
    clear: () => dispatch({ type: 'clear' }),
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart outside CartProvider');
  return ctx;
}

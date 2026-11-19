import { useEffect, useRef, useState } from "react";
import { rankChanges, type RankHighlightSettings } from "./rank-changes";

type Movement = { delta: number; at: number };
type Movements = Record<string, Movement>;
const duration = 4000;

export { rankChanges } from "./rank-changes";

export function useRankMovement(
  order: string[],
  scopeKey: string,
  ready: string[],
  { enabled, minPositions }: RankHighlightSettings = {
    enabled: true,
    minPositions: 2,
  },
): Movements {
  const scope = JSON.stringify([scopeKey, enabled, minPositions]);
  const previous = useRef<{
    scope: string;
    order: string[];
    ready: Set<string>;
  } | null>(null);
  const [state, setState] = useState<{ scope: string; items: Movements }>({
    scope,
    items: {},
  });
  useEffect(() => {
    const before = previous.current;
    const readyNow = new Set(ready);
    previous.current = { scope, order, ready: readyNow };
    if (!enabled || !before || before.scope !== scope) {
      setState({ scope, items: {} });
      return;
    }
    // New measurements establish their own baseline instead of flashing as price moves.
    const comparable = (symbol: string) =>
      before.ready.has(symbol) && readyNow.has(symbol);
    const changes = rankChanges(
      before.order.filter(comparable),
      order.filter(comparable),
      minPositions,
      enabled,
    );
    if (!Object.keys(changes).length) return;
    const now = Date.now();
    const present = new Set(order);
    setState((old) => ({
      scope,
      items: {
        ...Object.fromEntries(
          Object.entries(old.items).filter(
            ([symbol, move]) => present.has(symbol) && now - move.at < duration,
          ),
        ),
        ...Object.fromEntries(
          Object.entries(changes).map(([symbol, delta]) => [
            symbol,
            { delta, at: now },
          ]),
        ),
      },
    }));
  }, [order, scope, ready, enabled, minPositions]);
  useEffect(() => {
    const moves = Object.values(state.items);
    if (!moves.length) return;
    const timer = setTimeout(
      () => {
        const now = Date.now();
        setState((old) => ({
          ...old,
          items: Object.fromEntries(
            Object.entries(old.items).filter(
              ([, move]) => now - move.at < duration,
            ),
          ),
        }));
      },
      Math.max(
        0,
        Math.min(...moves.map((move) => move.at + duration)) - Date.now(),
      ),
    );
    return () => clearTimeout(timer);
  }, [state]);
  return enabled && state.scope === scope ? state.items : {};
}

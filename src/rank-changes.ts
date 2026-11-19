export type RankHighlightSettings = { enabled: boolean; minPositions: number };
export function rankChanges(
  previous: string[],
  current: string[],
  minPositions = 2,
  enabled = true,
) {
  if (!enabled) return {};
  const threshold =
    Number.isInteger(minPositions) && minPositions >= 1 && minPositions <= 100
      ? minPositions
      : 2;
  const positions = new Map(previous.map((symbol, index) => [symbol, index]));
  const changes: Record<string, number> = {};
  current.forEach((symbol, index) => {
    const before = positions.get(symbol);
    if (before !== undefined && Math.abs(before - index) >= threshold)
      changes[symbol] = before - index;
  });
  return changes;
}

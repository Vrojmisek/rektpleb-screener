export function nextDetailSymbol({
  candidates,
  priority,
  attempted,
  measured,
  inFlight,
  now,
}: {
  candidates: string[];
  priority: string[];
  attempted: Map<string, number>;
  measured: Map<string, number>;
  inFlight: Set<string>;
  now: number;
}) {
  const important = new Set(priority);
  return candidates
    .filter(
      (symbol) =>
        !inFlight.has(symbol) &&
        now - (attempted.get(symbol) || measured.get(symbol) || 0) >=
          (important.has(symbol) ? 65000 : 120000),
    )
    .sort(
      (a, b) =>
        Number(important.has(b)) - Number(important.has(a)) ||
        (attempted.get(a) || measured.get(a) || 0) -
          (attempted.get(b) || measured.get(b) || 0),
    )[0];
}

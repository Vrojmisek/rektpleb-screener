// USD OI change means quantity change valued at the current market price.
export function openInterestDelta(
  currentQuantity,
  previousQuantity,
  currentPrice,
) {
  if (
    ![currentQuantity, previousQuantity, currentPrice].every(Number.isFinite) ||
    currentQuantity < 0 ||
    previousQuantity <= 0 ||
    currentPrice <= 0
  )
    return null;
  return {
    percent: 100 * (currentQuantity / previousQuantity - 1),
    dollars: (currentQuantity - previousQuantity) * currentPrice,
  };
}

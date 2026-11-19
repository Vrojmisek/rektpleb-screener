import assert from "node:assert/strict";
import { test } from "node:test";
import { derive } from "../providers.mjs";

test("a cached forming candle cannot become a completed candle by aging", () => {
  const minute = 60_000;
  const start = Date.UTC(2025, 0, 1);
  const boundary = start + 61 * minute;
  const bars = Array.from({ length: 61 }, (_, index) => ({
    time: start + index * minute,
    observedAt: boundary - 10_000,
    open: 100,
    close: index === 60 ? 190 : index === 59 ? 105 : 100,
    quote: 10,
    trades: 2,
    buy: 6,
  }));
  const values = derive(bars, [], boundary + 10_000);
  assert.equal(values.priceWindowEnd, boundary - minute);
  for (const period of ["5m", "1h"])
    assert.ok(Math.abs(values[`changePercent_${period}`] - 5) < 1e-10);
  assert.equal(values.volume_1h, 600);
  assert.equal(values.trades_1h, 120);
  assert.equal(values.vdelta_1h, 120);
  assert.equal(
    derive(
      bars.filter((_, i) => i !== 58),
      [],
      boundary,
    ).changePercent_5m,
    undefined,
  );
  assert.equal(derive(bars, [], boundary + minute).changePercent_5m, undefined);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { addTrade, groupSeconds, candleWindow } from "../seconds-history.mjs";
import { openInterestDelta } from "../market-math.mjs";
test("out-of-order exchange trades preserve true candle opening and close", () => {
  const book = new Map();
  addTrade(book, { a: 102, T: 1730000000500, p: "12", q: "3" });
  addTrade(book, { a: 100, T: 1730000000100, p: "10", q: "1" });
  addTrade(book, { a: 101, T: 1730000000300, p: "9", q: "2" });
  assert.deepEqual(
    [...book.values()],
    [
      {
        time: 1730000000000,
        open: 10,
        high: 12,
        low: 9,
        close: 12,
        volume: 6,
        first: 100,
        last: 102,
      },
    ],
  );
});
test("five-second aggregation retains extremes, volume and boundaries", () => {
  const rows = [
    { time: 10000, open: 10, high: 12, low: 9, close: 11, volume: 2 },
    { time: 12000, open: 11, high: 14, low: 10, close: 13, volume: 3 },
    { time: 15000, open: 13, high: 13, low: 12, close: 12, volume: 1 },
  ];
  assert.deepEqual(groupSeconds(rows, 5), [
    { time: 10000, open: 10, high: 14, low: 9, close: 13, volume: 5 },
    rows[2],
  ]);
  assert.equal(rows[0].volume, 2);
});
test("missing history is not fabricated across an unverified connection gap", () => {
  const bars = [
    { time: 10000, open: 10, high: 10, low: 10, close: 10, volume: 1 },
    { time: 13000, open: 12, high: 12, low: 12, close: 12, volume: 1 },
  ];
  assert.equal(candleWindow(bars, 1, 10, false).length, 2);
  assert.equal(candleWindow(bars, 1, 10, true).length, 4);
});
test("OI changes measure position quantity, independent of price-only changes", () => {
  assert.deepEqual(openInterestDelta(100, 100, 11), { percent: 0, dollars: 0 });
  const result = openInterestDelta(120, 100, 11);
  assert.ok(Math.abs(result.percent - 20) < 1e-10);
  assert.equal(result.dollars, 220);
  assert.equal(openInterestDelta(1, 0, 11), null);
  assert.equal(openInterestDelta(NaN, 2, 11), null);
});

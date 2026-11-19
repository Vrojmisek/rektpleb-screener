import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.mjs";
import { createMarketAlertFeed } from "../market-alerts.mjs";

test("local alerts serve a verified price and volume impulse without Copilot", async () => {
  const minute = 60_000;
  const end = Math.floor(Date.now() / minute) * minute;
  const bars = Array.from({ length: 70 }, (_, index) => ({
    time: end - (70 - index) * minute,
    open: 100,
    high: index >= 65 ? 101 : 100,
    low: 100,
    close: index >= 65 ? 101 : 100,
    volume: index >= 65 ? 30 : 10,
    quote: index >= 65 ? 3000 : 1000,
  }));
  const calls = [];
  const server = await createAppServer({
    services: {
      market: async () => ({
        time: Date.now(),
        rows: [{ symbol: "BTCUSDT", volume_1d: 1e9 }],
      }),
      candles: async (exchange, symbol, interval) => {
        calls.push([exchange, symbol, interval]);
        return bars;
      },
      copilotIndex: async () => {
        throw new Error("The local scanner must not call Copilot");
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/market-alerts?exchange=binance`;
    const responses = await Promise.all([fetch(url), fetch(url)]);
    assert.equal(responses[0].status, 200);
    const first = await responses[0].json();
    assert.deepEqual(await responses[1].json(), first);
    assert.equal(first.chart.symbol, "BTCUSDT");
    assert.equal(first.chart.signal.relativeVolume, 3);
    assert.ok(Math.abs(first.chart.signal.changePercent - 1) < 0.0001);
    assert.equal(first.chart.signal.time, end);
    assert.deepEqual(
      Object.keys(first.chart.frames).sort(),
      ["15m", "1h", "1m"].sort(),
    );
    assert.equal(calls.filter(([, , interval]) => interval === "1m").length, 1);
  } finally {
    server.close();
  }
});

test("a forming or incomplete volume spike stays a market overview", async () => {
  const minute = 60_000;
  const end = Math.floor(Date.now() / minute) * minute;
  const bars = Array.from({ length: 70 }, (_, index) => ({
    time: end - (69 - index) * minute,
    open: 100,
    high: index === 69 ? 110 : 100,
    low: 100,
    close: index === 69 ? 110 : 100,
    volume: index === 69 ? 1000 : 10,
  }));
  const server = await createAppServer({
    services: {
      market: async () => ({
        time: Date.now(),
        rows: [{ symbol: "ETH", volume_1d: 1e9 }],
      }),
      candles: async () => bars,
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const root = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${root}/api/market-alerts?exchange=hl`);
    assert.equal(response.status, 200);
    const { chart } = await response.json();
    assert.equal(chart.symbol, "ETH");
    assert.equal(chart.signal, null);
    assert.equal(chart.frames["1m"].at(-1).time, end - minute);
    assert.equal(
      (await fetch(`${root}/api/market-alerts?exchange=unknown`)).status,
      400,
    );
  } finally {
    server.close();
  }
});

test("the next scan replaces an alert and the overview returns after expiry", async (t) => {
  const minute = 60_000;
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  let qualifying = "FIRST";
  const feed = createMarketAlertFeed({
    market: async () => ({
      time: Date.now(),
      rows: Array.from({ length: 7 }, (_, index) => ({
        symbol: index === 0 ? "FIRST" : index === 6 ? "NEXT" : `MID${index}`,
        volume_1d: 1e9 - index,
      })),
    }),
    candles: async (_exchange, symbol, interval) => {
      const duration =
        (interval === "15m" ? 15 : interval === "1h" ? 60 : 1) * minute;
      const end = Math.floor(Date.now() / duration) * duration;
      return Array.from({ length: 70 }, (_, index) => {
        const spike = symbol === qualifying && index >= 65;
        return {
          time: end - (70 - index) * duration,
          open: 100,
          low: 100,
          high: spike ? 101 : 100,
          close: spike ? 101 : 100,
          volume: spike ? 30 : 10,
          quote: spike ? 3000 : 1000,
        };
      });
    },
  });
  const first = (await feed("binance")).chart;
  assert.equal(first.symbol, "FIRST");
  qualifying = "NEXT";
  t.mock.timers.tick(minute);
  const next = (await feed("binance")).chart;
  assert.equal(next.symbol, "NEXT");
  assert.equal(next.signal.time - first.signal.time, minute);
  qualifying = "";
  t.mock.timers.tick(30 * minute);
  const overview = (await feed("binance")).chart;
  assert.equal(overview.symbol, "FIRST");
  assert.equal(overview.signal, null);
});

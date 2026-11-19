import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../server.mjs";
import { createMarketAlertFeed } from "../market-alerts.mjs";

test("every listed pair is scanned despite volume reordering and an older alert can still qualify", async (t) => {
  const minute = 60_000;
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const listed = Array.from({ length: 52 }, (_, index) => ({
    symbol: `PAIR${index}`,
    volume_1d: index === 51 ? 0 : 1e9 - index,
  }));
  const checked = new Set();
  const feed = createMarketAlertFeed({
    market: async () => ({ time: Date.now(), rows: [...listed] }),
    candles: async (_exchange, symbol, interval) => {
      if (interval === "1m") checked.add(symbol);
      const duration =
        (interval === "1h" ? 60 : interval === "15m" ? 15 : 1) * minute;
      const end = Math.floor(Date.now() / duration) * duration;
      return Array.from({ length: 96 }, (_, index) => {
        const spike = symbol === "PAIR51" && index >= 83 && index <= 87;
        return {
          time: end - (96 - index) * duration,
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
  for (let index = 0; index < 3; index++) {
    await feed("binance");
    listed.unshift(listed.pop());
    t.mock.timers.tick(10_000);
  }
  assert.equal(checked.size, listed.length);
  const { chart } = await feed("binance");
  assert.equal(chart.symbol, "PAIR51");
  assert.ok(chart.signal && Date.now() - chart.signal.time >= 8 * minute);
});

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

test("a failed batch cannot starve other markets and missing frames retry", async (t) => {
  const minute = 60_000;
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  let firstBatchUnavailable = true;
  let hourlyUnavailable = true;
  const feed = createMarketAlertFeed({
    market: async () => ({
      time: Date.now(),
      rows: Array.from({ length: 25 }, (_, index) => ({
        symbol: `PAIR${index}`,
        volume_1d: 1e9 - index,
      })),
    }),
    candles: async (_exchange, symbol, interval) => {
      if (symbol !== "PAIR24" && firstBatchUnavailable)
        throw Error("First batch unavailable");
      if (interval === "1h" && hourlyUnavailable) throw Error("Timeout");
      const duration =
        (interval === "15m" ? 15 : interval === "1h" ? 60 : 1) * minute;
      const end = Math.floor(Date.now() / duration) * duration;
      return Array.from({ length: 250 }, (_, index) => {
        const spike = symbol === "PAIR24" && index >= 65;
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
  await assert.rejects(feed("binance"), /temporarily unavailable/);
  t.mock.timers.tick(minute);
  const partial = (await feed("binance")).chart;
  assert.equal(partial.symbol, "PAIR24");
  assert.ok(partial.signal);
  assert.equal(partial.frames["1h"].length, 0);
  firstBatchUnavailable = hourlyUnavailable = false;
  t.mock.timers.tick(minute);
  const recovered = (await feed("binance")).chart;
  assert.deepEqual(recovered.signal, partial.signal);
  assert.ok(recovered.frames["1h"].length > 0);
});

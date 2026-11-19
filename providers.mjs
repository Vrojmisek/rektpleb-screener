import { openInterestDelta } from "./market-math.mjs";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { isCryptoBinance, isCryptoHyperliquid } from "./market-policy.mjs";
// Independent public exchange adapters; no account or trading credentials required.
const BINANCE = "https://fapi.binance.com";
const HYPERLIQUID = "https://api.hyperliquid.xyz/info";
const cache = new Map(),
  pending = new Map();
// Persist only small public market/detail snapshots, never candle histories.
const snapshotDir = new URL("./.cache/", import.meta.url);
const snapshotFile = new URL("public-market-v2.json", snapshotDir);
let snapshotTimer,
  snapshotWriting = false,
  snapshotDirty = false;
try {
  const text = await readFile(snapshotFile, "utf8");
  if (Buffer.byteLength(text) <= 8 * 1024 * 1024) {
    for (const [key, entry] of JSON.parse(text)) {
      const age = Date.now() - entry.time;
      if (
        /^(market|detail):(binance|hl)(:|$)/.test(key) &&
        age >= 0 &&
        age < 120000
      )
        cache.set(key, entry);
    }
  }
} catch {
  /* A missing snapshot simply means a cold start. */
}
function scheduleSnapshot() {
  snapshotDirty = true;
  if (snapshotTimer || snapshotWriting) return;
  snapshotTimer = setTimeout(async () => {
    snapshotTimer = null;
    snapshotWriting = true;
    snapshotDirty = false;
    try {
      const entries = [...cache].filter(
        ([key, entry]) =>
          /^(market|detail):(binance|hl)(:|$)/.test(key) &&
          Date.now() - entry.time < 120000,
      );
      const text = JSON.stringify(entries);
      if (Buffer.byteLength(text) > 8 * 1024 * 1024) return;
      await mkdir(snapshotDir, { recursive: true });
      const temp = new URL("public-market.tmp", snapshotDir);
      await writeFile(temp, text);
      await rename(temp, snapshotFile);
    } catch {
      /* Disk cache failure must not block live data. */
    } finally {
      snapshotWriting = false;
      if (snapshotDirty) scheduleSnapshot();
    }
  }, 1000);
  snapshotTimer.unref();
}
setInterval(() => {
  for (const [key, entry] of cache)
    if (/^(candles|detail):/.test(key) && Date.now() - entry.time > 300000)
      cache.delete(key);
}, 60000).unref();
let weightMinute = Date.now(),
  usedWeight = 0;
async function binanceBudget(weight, priority = false) {
  for (;;) {
    const now = Date.now();
    if (now - weightMinute >= 60000) {
      usedWeight = 0;
      weightMinute = now;
    }
    // Keep capacity for prices/funding even while history scans are queued.
    if (usedWeight + weight > (priority ? 1500 : 1100)) {
      await new Promise((r) =>
        setTimeout(r, Math.max(100, 60000 - (now - weightMinute))),
      );
      continue;
    }
    usedWeight += weight;
    return;
  }
}
const lanes = {
  foreground: { active: 0, waiters: [], limit: 2 },
  background: { active: 0, waiters: [], limit: 4 },
};
async function limited(fn, priority = false) {
  const lane = priority ? lanes.foreground : lanes.background;
  if (lane.waiters.length >= 64)
    throw Error("Data queue is busy. Retry shortly.");
  if (lane.active >= lane.limit)
    await new Promise((resolve) => lane.waiters.push(resolve));
  lane.active++;
  try {
    return await fn();
  } finally {
    lane.active--;
    lane.waiters.shift()?.();
  }
}
export async function cached(key, ttl, fn, staleWhileRevalidate = false) {
  const old = cache.get(key);
  if (old && Date.now() - old.time < ttl) return old.value;
  const usable = staleWhileRevalidate && old && Date.now() - old.time < 120000;
  if (pending.has(key)) return usable ? old.value : pending.get(key);
  const p = fn()
    .then((value) => {
      cache.set(key, { time: Date.now(), value });
      if (key.startsWith("candles:")) {
        const candleKeys = [...cache.keys()].filter((name) =>
          name.startsWith("candles:"),
        );
        for (const name of candleKeys.slice(
          0,
          Math.max(0, candleKeys.length - 128),
        ))
          cache.delete(name);
      }
      if (/^(market|detail):/.test(key)) scheduleSnapshot();
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, p);
  if (usable) {
    p.catch(() => {});
    return old.value;
  }
  return p;
}
async function json(url, body, priority = false) {
  return limited(async () => {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (!r.ok) throw Error(`Exchange returned HTTP ${r.status}`);
    const v = await r.json();
    if (v?.code < 0) throw Error(v.msg);
    return v;
  }, priority);
}
const b = async (path) => {
    const priority = !/klines|openInterest|futures\/data/.test(path);
    await binanceBudget(
      path.includes("klines")
        ? klineWeight(
            Number(new URLSearchParams(path.split("?")[1]).get("limit")) || 500,
          )
        : path.includes("ticker/24hr")
          ? 40
          : path.includes("premiumIndex")
            ? 10
            : 1,
      priority,
    );
    return json(BINANCE + path, undefined, priority);
  },
  h = (body) => json(HYPERLIQUID, body, body.type !== "candleSnapshot");
function klineWeight(limit) {
  if (limit < 100) return 1;
  if (limit < 500) return 2;
  return limit <= 1000 ? 5 : 10;
}
export const windows = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "8h": 480,
  "12h": 720,
  "1d": 1440,
};
export async function market(exchange) {
  const listing = await cached(
    `market:${exchange}`,
    10000,
    async () => {
      if (exchange === "binance") {
        const [tickers, premium, info, fundingInfo] = await Promise.all([
          b("/fapi/v1/ticker/24hr"),
          b("/fapi/v1/premiumIndex"),
          cached("exchangeInfo", 3600000, () => b("/fapi/v1/exchangeInfo")),
          cached("fundingInfo", 3600000, () => b("/fapi/v1/fundingInfo")).catch(
            () => [],
          ),
        ]);
        const allowed = new Map(
          info.symbols.filter(isCryptoBinance).map((x) => [x.symbol, x]),
        );
        const rates = new Map(premium.map((x) => [x.symbol, x])),
          intervals = new Map(
            fundingInfo.map((x) => [x.symbol, x.fundingIntervalHours]),
          );
        return {
          time: Date.now(),
          source: "Binance USDⓈ-M Futures public API",
          rows: tickers
            .filter((t) => allowed.has(t.symbol))
            .map((t) => ({
              symbol: t.symbol,
              base: allowed.get(t.symbol).baseAsset,
              price: +t.lastPrice,
              changePercent_1d: +t.priceChangePercent,
              changeDollar_1d: +t.priceChange,
              volume_1d: +t.quoteVolume,
              trades_1d: +t.count,
              fundingRate1h: rates.has(t.symbol)
                ? (+rates.get(t.symbol).lastFundingRate * 100) /
                  (intervals.get(t.symbol) || 8)
                : null,
              updatedAt: Date.now(),
            }))
            .sort((a, b) => b.volume_1d - a.volume_1d),
          warnings: [],
        };
      }
      const names = [""];
      const results = await Promise.allSettled([
        cached("hlmeta:crypto-main", 10000, () =>
          h({ type: "metaAndAssetCtxs" }),
        ),
      ]);
      const rows = [],
        warnings = [];
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          warnings.push(`Hyperliquid ${names[i] || "main"} unavailable`);
          return;
        }
        const [meta, ctxs] = r.value;
        meta.universe.forEach((u, j) => {
          const x = ctxs[j];
          if (!isCryptoHyperliquid(u) || !x) return;
          const p = +(x.midPx || x.markPx);
          rows.push({
            symbol: u.name,
            base: u.name.split(":").at(-1),
            price: p,
            changePercent_1d: +x.prevDayPx
              ? 100 * (p / +x.prevDayPx - 1)
              : null,
            changeDollar_1d: p - +x.prevDayPx,
            volume_1d: +x.dayNtlVlm,
            openInterest: +x.openInterest * p,
            fundingRate1h: +x.funding * 100,
            updatedAt: Date.now(),
          });
        });
      });
      if (!rows.length) throw Error("Hyperliquid is unavailable");
      return {
        time: Date.now(),
        source: "Hyperliquid public API · Crypto Main",
        rows: rows.sort((a, b) => b.volume_1d - a.volume_1d),
        warnings,
      };
    },
    true,
  );
  // Return warm measurements beside live ticker fields; keep their timestamps separate.
  const details = {};
  for (const row of listing.rows) {
    const entry = cache.get(`detail:${exchange}:${row.symbol}`);
    if (entry && Date.now() - entry.time < 150000)
      details[row.symbol] = entry.value;
  }
  return { ...listing, details };
}

export async function candles(exchange, symbol, interval = "1m", limit = 1500) {
  return cached(
    `candles:${exchange}:${symbol}:${interval}:${limit}`,
    60000,
    async () => {
      const observedAt = Date.now();
      if (exchange === "binance") {
        const rows = await b(
          `/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
        );
        return rows.map((x) => ({
          observedAt,
          time: +x[0],
          open: +x[1],
          high: +x[2],
          low: +x[3],
          close: +x[4],
          volume: +x[5],
          quote: +x[7],
          trades: +x[8],
          buy: +x[10],
        }));
      }
      const mins = windows[interval] || 1,
        end = Date.now(),
        rows = await h({
          type: "candleSnapshot",
          req: {
            coin: symbol,
            interval,
            startTime: end - limit * mins * 60000,
            endTime: end,
          },
        });
      return rows.slice(-limit).map((x) => ({
        observedAt,
        time: +x.t,
        open: +x.o,
        high: +x.h,
        low: +x.l,
        close: +x.c,
        volume: +x.v,
        quote: null,
        trades: +x.n,
        buy: null,
      }));
    },
  );
}
function sum(a, key) {
  return a.every((x) => Number.isFinite(x[key]))
    ? a.reduce((s, x) => s + x[key], 0)
    : null;
}
function correlation(a, b) {
  if (a.length < 3 || a.length !== b.length) return null;
  const ma = a.reduce((s, x) => s + x, 0) / a.length,
    mb = b.reduce((s, x) => s + x, 0) / b.length;
  let c = 0,
    va = 0,
    vb = 0;
  a.forEach((v, i) => {
    c += (v - ma) * (b[i] - mb);
    va += (v - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  });
  return va && vb ? c / Math.sqrt(va * vb) : null;
}
// A cached forming bar stays forming until a new exchange observation arrives.
function closedCandles(bars, step, now) {
  return bars.filter(
    (bar) => bar.time + step <= Math.min(now, bar.observedAt ?? now),
  );
}
function contiguous(bars, start, count, step) {
  return (
    bars.length === count &&
    bars.every((bar, i) => bar.time === start + i * step)
  );
}
export function derive(candles, btc = [], now = Date.now()) {
  const out = {};
  const closed = closedCandles(candles, 60000, now),
    end = closed.at(-1)?.time;
  if (end === undefined || now - (end + 60000) >= 120000) return out;
  out.priceWindowEnd = end + 60000;
  out.priceWindowClose = closed.at(-1).close;
  out.priceWindowOpens = {};
  const last = closed.at(-1),
    fullDay = closed.filter((x) => x.time > end - 1440 * 60000);
  out.trend = fullDay
    .filter((_, i) => i % Math.max(1, Math.floor(fullDay.length / 120)) === 0)
    .map((c) => c.close);
  out.trendPartial = fullDay.length < 1440;
  const btcMap = new Map(
    closedCandles(btc, 60000, now).map((x) => [x.time, x.close]),
  );
  for (const [period, n] of Object.entries(windows)) {
    const start = end - (n - 1) * 60000,
      cur = closed.filter((x) => x.time >= start),
      prev = closed.filter(
        (x) => x.time >= start - n * 60000 && x.time < start,
      );
    if (
      !contiguous(cur, start, n, 60000) ||
      !cur.every(
        (bar) =>
          Number.isFinite(bar.open) &&
          bar.open > 0 &&
          Number.isFinite(bar.close) &&
          bar.close > 0,
      )
    )
      continue;
    out.priceWindowOpens[period] = cur[0].open;
    out[`changePercent_${period}`] = 100 * (last.close / cur[0].open - 1);
    out[`changeDollar_${period}`] = last.close - cur[0].open;
    const volume = sum(cur, "quote");
    out[`volume_${period}`] = volume;
    out[`trades_${period}`] = sum(cur, "trades");
    const returns = cur.map(
        (c, i) => 100 * (c.close / (i ? cur[i - 1].close : c.open) - 1),
      ),
      mean = returns.reduce((s, x) => s + x, 0) / returns.length;
    out[`volatility_${period}`] = Math.sqrt(
      returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length,
    );
    const buys = sum(cur, "buy");
    out[`vdelta_${period}`] =
      buys !== null && volume !== null ? 2 * buys - volume : null;
    const previous = contiguous(prev, start - n * 60000, n, 60000)
      ? sum(prev, "quote")
      : null;
    out[`volumeChange_${period}`] =
      previous && volume !== null ? 100 * (volume / previous - 1) : null;
    out[`volumeChangeDollar_${period}`] =
      previous !== null && volume !== null ? volume - previous : null;
    const pairs = cur
      .slice(1)
      .map((c, i) => [
        100 * (c.close / cur[i].close - 1),
        btcMap.has(c.time) && btcMap.has(cur[i].time)
          ? 100 * (btcMap.get(c.time) / btcMap.get(cur[i].time) - 1)
          : null,
      ])
      .filter((x) => x[1] !== null);
    out[`btcCorrelation_${period}`] =
      pairs.length === n - 1
        ? correlation(
            pairs.map((x) => x[0]),
            pairs.map((x) => x[1]),
          )
        : null;
  }
  const day = sum(fullDay, "quote"),
    five = out.volume_5m;
  out.rvol =
    contiguous(fullDay, end - 1439 * 60000, 1440, 60000) &&
    day &&
    Number.isFinite(five)
      ? five / (day / 288)
      : null;
  // For Hyperliquid, quote-volume and taker-delta stay null: volume*close is an estimate, not measured quote volume.
  return out;
}
const hlOiHistory = new Map();
export async function details(exchange, symbol) {
  return cached(
    `detail:${exchange}:${symbol}`,
    60000,
    async () => {
      const [cs, bc, longVolume] = await Promise.all([
        candles(exchange, symbol),
        candles(exchange, exchange === "binance" ? "BTCUSDT" : "BTC").catch(
          () => [],
        ),
        exchange === "binance"
          ? candles(exchange, symbol, "5m", 600).catch(() => [])
          : Promise.resolve([]),
      ]);
      const data = derive(cs, bc),
        warnings = [];
      if (longVolume.length) {
        const closed = closedCandles(longVolume, 300000, Date.now()),
          last = closed.at(-1);
        if (last && Date.now() - (last.time + 300000) < 360000) {
          const current = closed.filter((c) => c.time > last.time - 86400000),
            previous = closed.filter(
              (c) =>
                c.time > last.time - 2 * 86400000 &&
                c.time <= last.time - 86400000,
            );
          if (
            contiguous(current, last.time - 287 * 300000, 288, 300000) &&
            contiguous(previous, last.time - 575 * 300000, 288, 300000)
          ) {
            const cv = sum(current, "quote"),
              pv = sum(previous, "quote");
            data.volumeChange_1d =
              cv !== null && pv ? 100 * (cv / pv - 1) : null;
            data.volumeChangeDollar_1d =
              cv === null || pv === null ? null : cv - pv;
          }
        }
      }
      if (exchange === "binance") {
        const [oi, hist] = await Promise.allSettled([
          b(`/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`),
          b(
            `/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=5m&limit=300`,
          ),
        ]);
        const price =
          (await market(exchange)).rows.find((x) => x.symbol === symbol)
            ?.price || cs.at(-1)?.close;
        if (oi.status === "fulfilled")
          data.openInterest = +oi.value.openInterest * price;
        else warnings.push("Open interest unavailable");
        if (hist.status === "fulfilled" && hist.value.length) {
          const last = hist.value.at(-1);
          for (const [period, n] of Object.entries(windows)) {
            const target = +last.timestamp - n * 60000,
              old = hist.value.findLast((x) => +x.timestamp <= target);
            if (
              !old ||
              +old.timestamp !== target ||
              !(Date.now() - Number(last.timestamp) < 600000)
            )
              continue;
            const change = openInterestDelta(
              +last.sumOpenInterest,
              +old.sumOpenInterest,
              price,
            );
            if (change) {
              data[`oiChange_${period}`] = change.percent;
              data[`oiChangeDollar_${period}`] = change.dollars;
            }
          }
        }
      } else {
        const row = (await market(exchange)).rows.find(
          (x) => x.symbol === symbol,
        );
        if (row) {
          data.openInterest = row.openInterest;
          const points = hlOiHistory.get(symbol) || [];
          const observedAt = Number(row.updatedAt);
          if (
            observedAt > (points.at(-1)?.time ?? 0) &&
            row.price > 0 &&
            Number.isFinite(row.openInterest)
          )
            points.push({
              time: observedAt,
              qty: row.openInterest / row.price,
            });
          while (points[0]?.time < Date.now() - 86400000 - 60000)
            points.shift();
          hlOiHistory.set(symbol, points);
          for (const [period, n] of Object.entries(windows)) {
            const target = observedAt - n * 60000;
            const old = points.findLast((x) => x.time <= target);
            if (
              old &&
              Date.now() - observedAt < 30000 &&
              target - old.time <= 120000 &&
              old.qty > 0 &&
              row.price > 0 &&
              Number.isFinite(row.openInterest)
            ) {
              data[`oiChange_${period}`] =
                100 * (row.openInterest / row.price / old.qty - 1);
              data[`oiChangeDollar_${period}`] =
                (row.openInterest / row.price - old.qty) * row.price;
            }
          }
        }
      }
      return { symbol, ...data, detailsAt: Date.now(), warnings };
    },
    true,
  );
}

// Seconds backfill shares the existing budget but has its own slow, serialized lane.
let secondsQueue = Promise.resolve(),
  secondsNext = 0,
  secondsQueued = 0;
export function aggregateTradePage(symbol, fromId) {
  if (secondsQueued >= 8)
    return Promise.reject(Error("History queue is busy. Retry shortly."));
  secondsQueued++;
  const task = secondsQueue
    .catch(() => {})
    .then(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, secondsNext - Date.now())),
      );
      await binanceBudget(20);
      secondsNext = Date.now() + 3500;
      return json(
        BINANCE +
          `/fapi/v1/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=1000${fromId === undefined ? "" : `&fromId=${fromId}`}`,
      );
    });
  secondsQueue = task.finally(() => {
    secondsQueued--;
  });
  secondsQueue.catch(() => {});
  return task;
}

import type { Ticker } from "./metrics";
import { compact } from "./metrics";
export function MarketOverview({
  rows,
  loading,
}: {
  rows: Ticker[];
  loading: boolean;
}) {
  const gainers = rows.filter((r) => Number(r.changePercent_1d) > 0).length,
    losers = rows.filter((r) => Number(r.changePercent_1d) < 0).length;
  const volume = rows.reduce((s, r) => s + (Number(r.volume_1d) || 0), 0);
  return (
    <section className="market-overview" aria-label="Crypto market overview">
      <div className="market-heading">
        <h1>
          Crypto markets<span>.</span>
        </h1>
        <p>Find the move. Keep your edge.</p>
      </div>
      <div className="market-snapshot">
        <div className="snapshot-top">
          <span>Market pulse</span>
          <span className="snapshot-period">24 hours</span>
        </div>
        <div className="snapshot-values">
          <div>
            <span>Volume</span>
            <strong>{loading ? "—" : "$" + compact(volume)}</strong>
          </div>
          <div>
            <span>Markets</span>
            <strong>{loading ? "—" : rows.length.toLocaleString()}</strong>
          </div>
          <div>
            <span>Advancing / declining</span>
            <strong className="breadth-values">
              <b>{loading ? "—" : gainers}</b>
              <i>/</i>
              <b>{loading ? "—" : losers}</b>
            </strong>
          </div>
        </div>
        <div
          className="breadth-track"
          role="img"
          aria-label={`${gainers} advancing and ${losers} declining markets`}
        >
          <span
            style={{
              width: `${gainers + losers ? (100 * gainers) / (gainers + losers) : 50}%`,
            }}
          />
        </div>
        <div className="snapshot-caption">
          Based on the crypto markets listed below
        </div>
      </div>
    </section>
  );
}

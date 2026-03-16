"use client";

import { useState, useEffect, useCallback } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface TradeStats {
  summary: {
    total_trades: number;
    open_trades: number;
    closed_trades: number;
    winning_trades: number;
    losing_trades: number;
    total_pnl: number;
    avg_pnl: number;
    avg_pnl_percent: number;
    best_trade_pnl: number;
    worst_trade_pnl: number;
    total_capital_at_risk: number;
    avg_winning_score: number;
    avg_losing_score: number;
    win_rate: number;
  };
  monthlyPnl: { month: string; pnl: number; trades: number; wins: number }[];
  pnlTimeline: { id: number; symbol: string; pnl: number; pnl_percent: number; closed_at: string; cumulative_pnl: number }[];
  bySymbol: { symbol: string; trades: number; wins: number; total_pnl: number; avg_return: number }[];
}

interface Trade {
  id: number;
  symbol: string;
  company_name: string;
  strike_price: string;
  expiration: string;
  dte_at_entry: number;
  premium_received: string;
  stock_price_at_entry: string;
  delta_at_entry: string | null;
  score_at_entry: string | null;
  stability_score_at_entry: string | null;
  iv_rank_at_entry: string | null;
  collateral: string;
  status: string;
  close_price: string | null;
  stock_price_at_close: string | null;
  pnl: string | null;
  pnl_percent: string | null;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
}

interface TradesDashboardProps {
  refreshKey: number;
}

// ─── SVG Mini Charts ───────────────────────────────────────────────

function WinRateDonut({ winRate, wins, losses }: { winRate: number; wins: number; losses: number }) {
  const total = wins + losses;
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-4">
        <div className="text-gray-600 text-sm">No closed trades yet</div>
      </div>
    );
  }

  const r = 40;
  const cx = 50;
  const cy = 50;
  const circumference = 2 * Math.PI * r;
  const winArc = (winRate / 100) * circumference;
  const lossArc = circumference - winArc;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 100" className="w-32 h-32">
        {/* Loss arc (background) */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke="#7f1d1d" strokeWidth={8}
          strokeDasharray={`${circumference}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        {/* Win arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke="#22c55e" strokeWidth={8}
          strokeDasharray={`${winArc} ${lossArc}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        {/* Center text */}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize={14} fontWeight="bold">
          {winRate.toFixed(0)}%
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#9ca3af" fontSize={7}>
          win rate
        </text>
      </svg>
      <div className="flex gap-4 text-xs mt-1">
        <span className="text-green-400">{wins}W</span>
        <span className="text-red-400">{losses}L</span>
      </div>
    </div>
  );
}

function CumulativePnLChart({ timeline }: { timeline: TradeStats["pnlTimeline"] }) {
  if (timeline.length === 0) return null;

  const W = 500;
  const H = 160;
  const PAD_L = 50;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 25;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const values = [0, ...timeline.map((t) => t.cumulative_pnl)];
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const range = maxV - minV || 1;

  const xScale = (i: number) => PAD_L + (i / (values.length - 1)) * plotW;
  const yScale = (v: number) => PAD_T + plotH - ((v - minV) / range) * plotH;

  const linePath = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`)
    .join(" ");

  // Gradient area
  const areaPath = `${linePath} L${xScale(values.length - 1).toFixed(1)},${yScale(0).toFixed(1)} L${xScale(0).toFixed(1)},${yScale(0).toFixed(1)} Z`;

  const finalPnl = values[values.length - 1];
  const isPositive = finalPnl >= 0;

  // Y ticks
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = minV + (range * i) / 4;
    return { value: v, y: yScale(v) };
  });

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 180 }}>
        <defs>
          <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isPositive ? "#22c55e" : "#ef4444"} stopOpacity={0.3} />
            <stop offset="100%" stopColor={isPositive ? "#22c55e" : "#ef4444"} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Grid */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={t.y} y2={t.y} stroke="#374151" strokeWidth={0.5} />
            <text x={PAD_L - 5} y={t.y + 3} textAnchor="end" fill="#6b7280" fontSize={8}>
              ${t.value >= 0 ? "" : ""}{t.value.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Zero line */}
        <line
          x1={PAD_L} x2={W - PAD_R}
          y1={yScale(0)} y2={yScale(0)}
          stroke="#6b7280" strokeWidth={1} strokeDasharray="4,3"
        />

        {/* Area */}
        <path d={areaPath} fill="url(#pnlGrad)" />

        {/* Line */}
        <path d={linePath} fill="none" stroke={isPositive ? "#22c55e" : "#ef4444"} strokeWidth={2} />

        {/* Trade dots */}
        {timeline.map((t, i) => (
          <circle
            key={t.id}
            cx={xScale(i + 1)}
            cy={yScale(t.cumulative_pnl)}
            r={3}
            fill={t.pnl >= 0 ? "#22c55e" : "#ef4444"}
            stroke="#1f2937"
            strokeWidth={1}
          >
            <title>{t.symbol}: ${t.pnl.toFixed(0)} (cumulative: ${t.cumulative_pnl.toFixed(0)})</title>
          </circle>
        ))}

        {/* X label */}
        <text x={PAD_L} y={H - 5} fill="#6b7280" fontSize={8}>Trade 1</text>
        <text x={W - PAD_R} y={H - 5} textAnchor="end" fill="#6b7280" fontSize={8}>Trade {timeline.length}</text>
      </svg>
    </div>
  );
}

function MonthlyBarChart({ data }: { data: TradeStats["monthlyPnl"] }) {
  if (data.length === 0) return null;

  const W = 500;
  const H = 140;
  const PAD_L = 50;
  const PAD_R = 10;
  const PAD_T = 10;
  const PAD_B = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const values = data.map((d) => d.pnl);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const range = maxV - minV || 1;

  const barW = Math.min(40, (plotW / data.length) * 0.7);
  const gap = (plotW - barW * data.length) / (data.length + 1);

  const yScale = (v: number) => PAD_T + plotH - ((v - minV) / range) * plotH;
  const zeroY = yScale(0);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 160 }}>
        {/* Zero line */}
        <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} stroke="#6b7280" strokeWidth={1} strokeDasharray="4,3" />

        {data.map((d, i) => {
          const x = PAD_L + gap + i * (barW + gap);
          const y = yScale(d.pnl);
          const barH = Math.abs(y - zeroY);
          const isPos = d.pnl >= 0;
          return (
            <g key={d.month}>
              <rect
                x={x}
                y={isPos ? y : zeroY}
                width={barW}
                height={Math.max(1, barH)}
                rx={2}
                fill={isPos ? "#22c55e" : "#ef4444"}
                opacity={0.8}
              >
                <title>{d.month}: ${d.pnl.toFixed(0)} ({d.wins}/{d.trades} wins)</title>
              </rect>
              <text
                x={x + barW / 2}
                y={H - PAD_B + 12}
                textAnchor="middle"
                fill="#6b7280"
                fontSize={7}
              >
                {d.month.slice(5)}
              </text>
              <text
                x={x + barW / 2}
                y={(isPos ? y : zeroY + barH) + (isPos ? -4 : 12)}
                textAnchor="middle"
                fill={isPos ? "#4ade80" : "#f87171"}
                fontSize={7}
              >
                ${Math.abs(d.pnl).toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Y axis labels */}
        <text x={PAD_L - 5} y={PAD_T + 5} textAnchor="end" fill="#6b7280" fontSize={8}>${maxV.toFixed(0)}</text>
        <text x={PAD_L - 5} y={H - PAD_B} textAnchor="end" fill="#6b7280" fontSize={8}>${minV.toFixed(0)}</text>
      </svg>
    </div>
  );
}

function SymbolBreakdown({ data }: { data: TradeStats["bySymbol"] }) {
  if (data.length === 0) return null;

  const maxPnl = Math.max(...data.map((d) => Math.abs(d.total_pnl)), 1);

  return (
    <div className="space-y-1.5">
      {data.slice(0, 10).map((d) => {
        const isPos = d.total_pnl >= 0;
        const barPct = Math.min(100, (Math.abs(d.total_pnl) / maxPnl) * 100);
        const winRate = d.trades > 0 ? (d.wins / d.trades) * 100 : 0;
        return (
          <div key={d.symbol} className="flex items-center gap-2 text-sm">
            <span className="w-12 text-white font-medium text-xs">{d.symbol}</span>
            <div className="flex-1 h-5 bg-gray-800 rounded-full overflow-hidden relative">
              <div
                className={`h-full rounded-full transition-all ${isPos ? "bg-green-600/60" : "bg-red-600/60"}`}
                style={{ width: `${barPct}%` }}
              />
              <span className={`absolute inset-0 flex items-center px-2 text-[10px] font-medium ${isPos ? "text-green-300" : "text-red-300"}`}>
                {isPos ? "+" : ""}${d.total_pnl.toFixed(0)}
              </span>
            </div>
            <span className="w-16 text-[10px] text-gray-500 text-right">
              {d.wins}/{d.trades} ({winRate.toFixed(0)}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Close Trade Modal ─────────────────────────────────────────────

function CloseTradeModal({ trade, onClose, onSuccess }: { trade: Trade; onClose: () => void; onSuccess: () => void }) {
  const [status, setStatus] = useState("EXPIRED");
  const [closePrice, setClosePrice] = useState("");
  const [stockPrice, setStockPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const premium = Number(trade.premium_received);
  const collateral = Number(trade.collateral);

  // Estimate P&L preview
  let previewPnl = 0;
  if (status === "EXPIRED") {
    previewPnl = premium * 100;
  } else if (status === "ASSIGNED" && stockPrice) {
    const assignmentLoss = (Number(trade.strike_price) - Number(stockPrice)) * 100;
    previewPnl = premium * 100 - assignmentLoss;
  } else if (closePrice) {
    previewPnl = (premium - Number(closePrice)) * 100;
  }

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          closePrice: closePrice ? Number(closePrice) : null,
          stockPriceAtClose: stockPrice ? Number(stockPrice) : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Close Trade: {trade.symbol}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="bg-gray-800/70 rounded-lg p-3 mb-4 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-400">Strike</span>
            <span className="text-white">${Number(trade.strike_price).toFixed(2)} put</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Premium Received</span>
            <span className="text-green-400">${premium.toFixed(2)}/share</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Collateral</span>
            <span className="text-white">${collateral.toLocaleString()}</span>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Outcome</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="EXPIRED">Expired Worthless (full profit)</option>
              <option value="CLOSED_PROFIT">Bought Back at Profit</option>
              <option value="CLOSED_LOSS">Bought Back at Loss</option>
              <option value="ASSIGNED">Assigned (stock purchased)</option>
            </select>
          </div>

          {(status === "CLOSED_PROFIT" || status === "CLOSED_LOSS") && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Close Price (per share)</label>
              <input
                type="number"
                step="0.01"
                value={closePrice}
                onChange={(e) => setClosePrice(e.target.value)}
                placeholder="Price you bought the put back at"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {status === "ASSIGNED" && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Stock Price at Assignment</label>
              <input
                type="number"
                step="0.01"
                value={stockPrice}
                onChange={(e) => setStockPrice(e.target.value)}
                placeholder="Stock price when assigned"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* P&L Preview */}
          <div className={`text-center p-2 rounded-lg ${previewPnl >= 0 ? "bg-green-900/20 border border-green-700/30" : "bg-red-900/20 border border-red-700/30"}`}>
            <div className="text-xs text-gray-400">Estimated P&L</div>
            <div className={`text-xl font-bold ${previewPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              {previewPnl >= 0 ? "+" : ""}${previewPnl.toFixed(0)}
            </div>
            <div className="text-xs text-gray-500">
              {collateral > 0 ? `${((previewPnl / collateral) * 100).toFixed(2)}% of collateral` : ""}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2">{error}</div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700 transition-colors text-sm">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-medium rounded-lg transition-colors text-sm"
          >
            {saving ? "Saving..." : "Close Trade"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────

export default function TradesDashboard({ refreshKey }: TradesDashboardProps) {
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closingTrade, setClosingTrade] = useState<Trade | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "OPEN" | "closed">("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, tradesRes] = await Promise.all([
        fetch("/api/trades/stats"),
        fetch("/api/trades"),
      ]);

      if (statsRes.status === 503 || tradesRes.status === 503) {
        setError("DATABASE_URL not configured. See README for Neon setup instructions.");
        return;
      }

      if (!statsRes.ok || !tradesRes.ok) {
        throw new Error("Failed to load trade data");
      }

      const [statsData, tradesData] = await Promise.all([
        statsRes.json(),
        tradesRes.json(),
      ]);

      setStats(statsData);
      setTrades(tradesData.trades);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trades");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/trades/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchData();
      }
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="w-10 h-10 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">Loading trade data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-3">&#128202;</div>
        <h3 className="text-lg font-medium text-white mb-2">Simulation Trading</h3>
        <p className="text-gray-400 text-sm max-w-md mx-auto mb-4">{error}</p>
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 max-w-lg mx-auto text-left text-sm text-gray-400">
          <p className="font-medium text-white mb-2">Quick Setup:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Create a free Neon project at <span className="text-blue-400">neon.tech</span></li>
            <li>Copy the connection string</li>
            <li>Add <code className="text-green-400">DATABASE_URL=&quot;postgres://...&quot;</code> to <code>.env.local</code></li>
            <li>Restart the dev server</li>
          </ol>
        </div>
      </div>
    );
  }

  const s = stats?.summary;
  const filteredTrades = trades.filter((t) => {
    if (filter === "all") return true;
    if (filter === "OPEN") return t.status === "OPEN";
    return t.status !== "OPEN";
  });

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <KPICard
            label="Total P&L"
            value={`${s.total_pnl >= 0 ? "+" : ""}$${s.total_pnl.toFixed(0)}`}
            color={s.total_pnl >= 0 ? "green" : "red"}
            sub={`${s.closed_trades} closed trades`}
          />
          <KPICard
            label="Win Rate"
            value={`${s.win_rate.toFixed(1)}%`}
            color={s.win_rate >= 55 ? "green" : s.win_rate >= 45 ? "yellow" : "red"}
            sub={`${s.winning_trades}W / ${s.losing_trades}L`}
          />
          <KPICard
            label="Avg Return"
            value={`${s.avg_pnl_percent >= 0 ? "+" : ""}${s.avg_pnl_percent.toFixed(2)}%`}
            color={s.avg_pnl_percent >= 0 ? "green" : "red"}
            sub="per trade on collateral"
          />
          <KPICard
            label="Open Trades"
            value={String(s.open_trades)}
            color="blue"
            sub={`$${s.total_capital_at_risk.toLocaleString()} at risk`}
          />
          <KPICard
            label="Best Trade"
            value={`+$${s.best_trade_pnl.toFixed(0)}`}
            color="green"
            sub="single trade P&L"
          />
          <KPICard
            label="Worst Trade"
            value={`$${s.worst_trade_pnl.toFixed(0)}`}
            color="red"
            sub="single trade P&L"
          />
        </div>
      )}

      {/* Score Analysis */}
      {s && s.closed_trades > 0 && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Score vs Outcome</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{s.avg_winning_score.toFixed(0)}</div>
              <div className="text-xs text-gray-500">Avg Score (Winners)</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400">{s.avg_losing_score.toFixed(0)}</div>
              <div className="text-xs text-gray-500">Avg Score (Losers)</div>
            </div>
          </div>
          {s.avg_winning_score > s.avg_losing_score && (
            <p className="text-xs text-gray-500 text-center mt-2">
              Higher-scored trades are winning more often — the scoring model has edge.
            </p>
          )}
        </div>
      )}

      {/* Charts Row */}
      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Win Rate Donut */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Win Rate</h3>
            <WinRateDonut
              winRate={s?.win_rate ?? 0}
              wins={s?.winning_trades ?? 0}
              losses={s?.losing_trades ?? 0}
            />
          </div>

          {/* Cumulative P&L */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 lg:col-span-2">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Cumulative P&L</h3>
            {stats.pnlTimeline.length > 0 ? (
              <CumulativePnLChart timeline={stats.pnlTimeline} />
            ) : (
              <div className="text-gray-600 text-sm text-center py-8">Close some trades to see the P&L curve</div>
            )}
          </div>
        </div>
      )}

      {/* Monthly & Symbol Breakdown */}
      {stats && (stats.monthlyPnl.length > 0 || stats.bySymbol.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {stats.monthlyPnl.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Monthly P&L</h3>
              <MonthlyBarChart data={stats.monthlyPnl} />
            </div>
          )}
          {stats.bySymbol.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-2">P&L by Symbol</h3>
              <SymbolBreakdown data={stats.bySymbol} />
            </div>
          )}
        </div>
      )}

      {/* Trade List */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400">Trade History</h3>
          <div className="flex gap-1">
            {(["all", "OPEN", "closed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  filter === f
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:text-white"
                }`}
              >
                {f === "all" ? "All" : f === "OPEN" ? "Open" : "Closed"}
              </button>
            ))}
          </div>
        </div>

        {filteredTrades.length === 0 ? (
          <div className="text-center py-8 text-gray-600 text-sm">
            {trades.length === 0
              ? "No trades yet. Use the screener to find puts and click \"Simulate Trade\" to get started."
              : "No trades match this filter."}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTrades.map((trade) => (
              <TradeCard
                key={trade.id}
                trade={trade}
                onClose={() => setClosingTrade(trade)}
                onDelete={() => handleDelete(trade.id)}
                deleting={deletingId === trade.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Close Trade Modal */}
      {closingTrade && (
        <CloseTradeModal
          trade={closingTrade}
          onClose={() => setClosingTrade(null)}
          onSuccess={() => {
            setClosingTrade(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function KPICard({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  const colorMap: Record<string, string> = {
    green: "text-green-400",
    red: "text-red-400",
    yellow: "text-yellow-400",
    blue: "text-blue-400",
  };
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${colorMap[color] ?? "text-white"}`}>{value}</div>
      <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>
    </div>
  );
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  OPEN: { label: "Open", color: "text-blue-400", bg: "bg-blue-900/30 border-blue-700/30" },
  CLOSED_PROFIT: { label: "Profit", color: "text-green-400", bg: "bg-green-900/30 border-green-700/30" },
  CLOSED_LOSS: { label: "Loss", color: "text-red-400", bg: "bg-red-900/30 border-red-700/30" },
  ASSIGNED: { label: "Assigned", color: "text-yellow-400", bg: "bg-yellow-900/30 border-yellow-700/30" },
  EXPIRED: { label: "Expired", color: "text-green-400", bg: "bg-green-900/30 border-green-700/30" },
};

function TradeCard({ trade, onClose, onDelete, deleting }: { trade: Trade; onClose: () => void; onDelete: () => void; deleting: boolean }) {
  const sc = statusConfig[trade.status] ?? statusConfig.OPEN;
  const premium = Number(trade.premium_received);
  const pnl = trade.pnl ? Number(trade.pnl) : null;
  const daysOpen = trade.closed_at
    ? Math.ceil((new Date(trade.closed_at).getTime() - new Date(trade.created_at).getTime()) / 86400000)
    : Math.ceil((Date.now() - new Date(trade.created_at).getTime()) / 86400000);

  return (
    <div className={`rounded-lg border p-3 ${sc.bg}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold">{trade.symbol}</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${sc.bg} ${sc.color}`}>
                {sc.label}
              </span>
              {trade.score_at_entry && (
                <span className="text-xs text-gray-500">Score: {Number(trade.score_at_entry).toFixed(0)}</span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              ${Number(trade.strike_price).toFixed(0)} put &middot; exp {trade.expiration} &middot;
              Premium ${premium.toFixed(2)} &middot;
              {daysOpen}d {trade.status === "OPEN" ? "open" : "held"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {pnl !== null && (
            <div className="text-right">
              <div className={`font-bold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(0)}
              </div>
              <div className="text-[10px] text-gray-500">
                {trade.pnl_percent ? `${Number(trade.pnl_percent).toFixed(2)}%` : ""}
              </div>
            </div>
          )}
          {trade.status === "OPEN" && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Close
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={deleting}
            className="px-2 py-1.5 text-xs bg-gray-700 hover:bg-red-900/50 text-gray-500 hover:text-red-400 rounded-lg transition-colors"
            title="Delete trade"
          >
            {deleting ? "..." : "\u2715"}
          </button>
        </div>
      </div>
    </div>
  );
}

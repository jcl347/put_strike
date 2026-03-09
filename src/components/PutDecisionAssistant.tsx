"use client";

import { useState } from "react";

interface StockContext {
  earningsDate: string | null;
  daysToEarnings: number | null;
  earningsWarning: boolean;
  trendDirection: "up" | "down" | "sideways";
  trendStrength: number;
  sma20: number;
  sma50: number;
  sma200: number;
  priceVsSMA20: number;
  priceVsSMA50: number;
  priceVsSMA200: number;
  rsi14: number;
  supportLevel: number;
  resistanceLevel: number;
  avgTrueRange: number;
  recentHighs: number[];
  recentLows: number[];
}

interface DecisionData {
  symbol: string;
  price: number;
  ivRank: number;
  beta: number;
  marketCap: number;
  dividendYield: number;
  stabilityScore: number;
  vix: number;
  context: StockContext | null;
  trailingPE?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHigh?: number;
  volume?: number;
  avgVolume?: number;
}

interface Props {
  data: DecisionData;
}

interface ChecklistItem {
  label: string;
  category: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  rule: string;
}

function evaluateChecklist(d: DecisionData): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const ctx = d.context;

  // ── Stock Selection ──
  items.push({
    label: "Company Quality",
    category: "Stock Selection",
    status: d.stabilityScore >= 60 ? "pass" : d.stabilityScore >= 40 ? "warn" : "fail",
    detail: `Stability: ${d.stabilityScore.toFixed(0)}/100`,
    rule: "Sell puts only on stocks you'd be happy to own at the strike price",
  });

  items.push({
    label: "Liquidity",
    category: "Stock Selection",
    status: d.marketCap > 50e9 ? "pass" : d.marketCap > 10e9 ? "warn" : "fail",
    detail: `Market cap: $${(d.marketCap / 1e9).toFixed(0)}B`,
    rule: "Stick to liquid underlyings with tight bid/ask spreads",
  });

  items.push({
    label: "Earnings Clear",
    category: "Stock Selection",
    status: !ctx?.earningsWarning ? "pass" : "fail",
    detail: ctx?.earningsDate
      ? `Earnings: ${ctx.earningsDate} (${ctx.daysToEarnings}d)`
      : "No earnings date found",
    rule: "Avoid earnings announcements — surprise moves can blow past your strike",
  });

  // ── IV Timing ──
  items.push({
    label: "IV Rank",
    category: "IV Timing",
    status: d.ivRank >= 50 ? "pass" : d.ivRank >= 30 ? "warn" : "fail",
    detail: `HV Rank: ${d.ivRank.toFixed(0)}% (proxy for IV Rank)`,
    rule: "Sell when IV Rank > 50 — you're being paid more for the risk",
  });

  items.push({
    label: "VIX Environment",
    category: "IV Timing",
    status: d.vix >= 15 && d.vix < 35 ? "pass" : d.vix < 15 ? "warn" : "fail",
    detail: `VIX: ${d.vix.toFixed(1)}`,
    rule: d.vix >= 35
      ? "Crisis VIX — extreme tail risk, consider waiting"
      : d.vix < 15
      ? "Low VIX — premiums are thin, lower opportunity"
      : "Normal/elevated VIX — good premium environment",
  });

  // ── Trend Analysis ──
  if (ctx) {
    items.push({
      label: "Trend Direction",
      category: "Chart Analysis",
      status: ctx.trendDirection === "up" ? "pass"
        : ctx.trendDirection === "sideways" ? "warn" : "fail",
      detail: `Trend: ${ctx.trendDirection} (strength: ${ctx.trendStrength.toFixed(0)}%)`,
      rule: "Don't sell puts into a clear downtrend",
    });

    items.push({
      label: "Price vs Moving Averages",
      category: "Chart Analysis",
      status: d.price > ctx.sma50 && d.price > ctx.sma200 ? "pass"
        : d.price > ctx.sma200 ? "warn" : "fail",
      detail: `vs SMA20: ${ctx.priceVsSMA20 > 0 ? "+" : ""}${ctx.priceVsSMA20.toFixed(1)}%, vs SMA50: ${ctx.priceVsSMA50 > 0 ? "+" : ""}${ctx.priceVsSMA50.toFixed(1)}%`,
      rule: "Price above key moving averages confirms uptrend support",
    });

    items.push({
      label: "RSI",
      category: "Chart Analysis",
      status: ctx.rsi14 >= 30 && ctx.rsi14 <= 70 ? "pass"
        : ctx.rsi14 < 30 ? "warn" : "warn",
      detail: `RSI(14): ${ctx.rsi14.toFixed(1)}`,
      rule: ctx.rsi14 < 30
        ? "Oversold — potential bounce but also downtrend risk"
        : ctx.rsi14 > 70
        ? "Overbought — higher risk of pullback to your strike"
        : "RSI in normal range — no extreme momentum",
    });

    items.push({
      label: "Support Level",
      category: "Strike Selection",
      status: ctx.supportLevel < d.price * 0.95 ? "pass" : "warn",
      detail: `Support: $${ctx.supportLevel.toFixed(2)} (${((d.price - ctx.supportLevel) / d.price * 100).toFixed(1)}% below)`,
      rule: "Target strikes at or below key support levels",
    });
  }

  // ── Risk ──
  items.push({
    label: "Beta",
    category: "Risk Management",
    status: d.beta <= 1.0 ? "pass" : d.beta <= 1.5 ? "warn" : "fail",
    detail: `Beta: ${d.beta.toFixed(2)}`,
    rule: "Lower beta = less volatile = safer for put selling (CBOE research)",
  });

  items.push({
    label: "Dividend Cushion",
    category: "Risk Management",
    status: d.dividendYield > 1.5 ? "pass" : d.dividendYield > 0 ? "warn" : "fail",
    detail: d.dividendYield > 0 ? `Yield: ${d.dividendYield.toFixed(2)}%` : "No dividend",
    rule: "Dividend-paying stocks provide downside cushion if assigned",
  });

  // ── Valuation ──
  if (d.trailingPE && d.trailingPE > 0) {
    items.push({
      label: "Valuation (P/E)",
      category: "Risk Management",
      status: d.trailingPE <= 25 ? "pass" : d.trailingPE <= 40 ? "warn" : "fail",
      detail: `P/E: ${d.trailingPE.toFixed(1)}`,
      rule: d.trailingPE > 40
        ? "Very high P/E — valuation compression risk if assigned"
        : d.trailingPE > 25
        ? "Above-average P/E — moderate valuation risk"
        : "Reasonable valuation — comfortable ownership if assigned",
    });
  }

  // ── 52-Week Range Position ──
  if (d.fiftyTwoWeekLow && d.fiftyTwoWeekHigh) {
    const range = d.fiftyTwoWeekHigh - d.fiftyTwoWeekLow;
    const position = range > 0 ? ((d.price - d.fiftyTwoWeekLow) / range) * 100 : 50;
    items.push({
      label: "52-Week Position",
      category: "Risk Management",
      status: position >= 30 && position <= 85 ? "pass" : position < 30 ? "fail" : "warn",
      detail: `${position.toFixed(0)}% of 52wk range ($${d.fiftyTwoWeekLow.toFixed(0)}-$${d.fiftyTwoWeekHigh.toFixed(0)})`,
      rule: position < 30
        ? "Near 52-week low — high risk of further decline"
        : position > 85
        ? "Near 52-week high — limited upside, watch for reversal"
        : "Healthy position within 52-week range",
    });
  }

  // ── Volume Analysis ──
  if (d.volume && d.avgVolume && d.avgVolume > 0) {
    const volumeRatio = d.volume / d.avgVolume;
    items.push({
      label: "Volume Activity",
      category: "Chart Analysis",
      status: volumeRatio >= 0.5 && volumeRatio <= 2 ? "pass"
        : volumeRatio > 2 ? "warn" : "warn",
      detail: `${(volumeRatio * 100).toFixed(0)}% of avg volume`,
      rule: volumeRatio > 2
        ? "Unusual volume — potential news or institutional activity, investigate before selling"
        : volumeRatio < 0.5
        ? "Very low volume — may indicate poor liquidity for options"
        : "Normal trading volume",
    });
  }

  // ── ATR-Based Risk ──
  if (ctx) {
    const atrPct = (ctx.avgTrueRange / d.price) * 100;
    items.push({
      label: "Daily Volatility (ATR)",
      category: "Risk Management",
      status: atrPct <= 2 ? "pass" : atrPct <= 3.5 ? "warn" : "fail",
      detail: `ATR: $${ctx.avgTrueRange.toFixed(2)} (${atrPct.toFixed(1)}% of price)`,
      rule: atrPct > 3.5
        ? "High daily moves — use wider OTM strikes for safety"
        : "Normal daily range — standard strike selection applies",
    });
  }

  return items;
}

function getOverallVerdict(items: ChecklistItem[]): {
  verdict: "SELL PUT" | "CAUTION" | "AVOID";
  color: string;
  bg: string;
} {
  const fails = items.filter(i => i.status === "fail").length;
  const passes = items.filter(i => i.status === "pass").length;
  const total = items.length;

  if (fails >= 3 || (fails >= 2 && passes < total * 0.5)) {
    return { verdict: "AVOID", color: "text-red-400", bg: "bg-red-900/30" };
  }
  if (fails >= 1 || passes < total * 0.6) {
    return { verdict: "CAUTION", color: "text-yellow-400", bg: "bg-yellow-900/30" };
  }
  return { verdict: "SELL PUT", color: "text-green-400", bg: "bg-green-900/30" };
}

export default function PutDecisionAssistant({ data }: Props) {
  const [expanded, setExpanded] = useState(false);
  const items = evaluateChecklist(data);
  const verdict = getOverallVerdict(items);
  const categories = [...new Set(items.map(i => i.category))];

  const passes = items.filter(i => i.status === "pass").length;
  const warns = items.filter(i => i.status === "warn").length;
  const fails = items.filter(i => i.status === "fail").length;

  const ctx = data.context;

  return (
    <div className={`border rounded-lg overflow-hidden ${
      verdict.verdict === "SELL PUT" ? "border-green-700/50" :
      verdict.verdict === "CAUTION" ? "border-yellow-700/50" : "border-red-700/50"
    }`}>
      {/* Header - always visible */}
      <div
        className={`${verdict.bg} px-4 py-3 cursor-pointer flex items-center justify-between`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`text-lg font-bold ${verdict.color}`}>
            {verdict.verdict === "SELL PUT" ? "\u2713" : verdict.verdict === "CAUTION" ? "!" : "\u2717"}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`font-bold ${verdict.color}`}>{verdict.verdict}</span>
              <span className="text-gray-400 text-sm">{data.symbol}</span>
            </div>
            <div className="text-xs text-gray-500">
              {passes} pass, {warns} caution, {fails} fail
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Quick stats */}
          {ctx && (
            <div className="hidden md:flex items-center gap-3 text-xs">
              <span className={`px-2 py-0.5 rounded ${
                ctx.trendDirection === "up" ? "bg-green-900/40 text-green-400" :
                ctx.trendDirection === "down" ? "bg-red-900/40 text-red-400" :
                "bg-gray-700 text-gray-400"
              }`}>
                {ctx.trendDirection === "up" ? "\u25B2" : ctx.trendDirection === "down" ? "\u25BC" : "\u25C6"} {ctx.trendDirection}
              </span>
              {ctx.earningsWarning && (
                <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-400">
                  Earnings {ctx.daysToEarnings}d
                </span>
              )}
            </div>
          )}
          <span className="text-gray-500 text-sm">{expanded ? "\u25B2" : "\u25BC"}</span>
        </div>
      </div>

      {/* Expanded checklist */}
      {expanded && (
        <div className="bg-gray-900/50 px-4 py-3">
          {/* Position Sizing Calculator */}
          <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <h4 className="text-xs font-medium text-gray-400 uppercase mb-2">
              Schwab Cash-Secured Put Calculator
            </h4>
            <PositionSizer
              price={data.price}
              supportLevel={ctx?.supportLevel ?? data.price * 0.92}
              atr={ctx?.avgTrueRange ?? data.price * 0.02}
            />
          </div>

          {/* Checklist by category */}
          {categories.map(cat => (
            <div key={cat} className="mb-3">
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-1.5">{cat}</h4>
              <div className="space-y-1">
                {items.filter(i => i.category === cat).map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 font-bold ${
                      item.status === "pass" ? "text-green-400" :
                      item.status === "warn" ? "text-yellow-400" : "text-red-400"
                    }`}>
                      {item.status === "pass" ? "\u2713" : item.status === "warn" ? "!" : "\u2717"}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-white">{item.label}</span>
                        <span className="text-gray-400 text-xs">{item.detail}</span>
                      </div>
                      <p className="text-xs text-gray-600 mt-0.5">{item.rule}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Strike Suggestions with Profit Scenarios */}
          {ctx && (
            <div className="mt-3 pt-3 border-t border-gray-700/50">
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                Suggested Strike Targets
              </h4>
              <div className="grid grid-cols-3 gap-2 text-sm">
                {[
                  {
                    label: "Conservative",
                    strike: Math.round(Math.min(ctx.supportLevel, data.price * 0.90)),
                    color: "text-gray-500",
                    border: "",
                    estPremium: 0.003,
                  },
                  {
                    label: "Optimal",
                    strike: Math.round(data.price * 0.92),
                    color: "text-blue-400",
                    border: "border border-blue-700/30",
                    estPremium: 0.006,
                  },
                  {
                    label: "Aggressive",
                    strike: Math.round(data.price * 0.95),
                    color: "text-gray-500",
                    border: "",
                    estPremium: 0.012,
                  },
                ].map(({ label, strike, color, border, estPremium }) => {
                  const otmPct = ((data.price - strike) / data.price * 100);
                  const estCredit = strike * estPremium;
                  const annReturn = estPremium * (365 / 35) * 100;
                  return (
                    <div key={label} className={`bg-gray-800/50 rounded p-2 text-center ${border}`}>
                      <div className={`${color} text-xs`}>{label}</div>
                      <div className="text-white font-medium">${strike}</div>
                      <div className="text-gray-600 text-xs">{otmPct.toFixed(1)}% OTM</div>
                      <div className="text-gray-500 text-xs mt-1">
                        ~${estCredit.toFixed(2)}/sh credit
                      </div>
                      <div className="text-gray-600 text-xs">
                        ~{annReturn.toFixed(0)}% ann.
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Profit/Loss Scenarios */}
              <div className="mt-3">
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                  Scenario Analysis (Optimal Strike, 35 DTE)
                </h4>
                {(() => {
                  const strike = Math.round(data.price * 0.92);
                  const estCredit = strike * 0.006;
                  const collateral = strike * 100;
                  return (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-green-900/20 border border-green-700/30 rounded p-2">
                        <div className="text-green-400 font-medium">Max Profit (OTM)</div>
                        <div className="text-white">${(estCredit * 100).toFixed(0)}/contract</div>
                        <div className="text-gray-500">
                          {(estCredit / strike * 100).toFixed(2)}% return in 35d
                        </div>
                        <div className="text-gray-600 mt-1">
                          Close at 50%: ${(estCredit * 50).toFixed(0)}
                        </div>
                      </div>
                      <div className="bg-yellow-900/20 border border-yellow-700/30 rounded p-2">
                        <div className="text-yellow-400 font-medium">Breakeven</div>
                        <div className="text-white">${(strike - estCredit).toFixed(2)}</div>
                        <div className="text-gray-500">
                          {((data.price - (strike - estCredit)) / data.price * 100).toFixed(1)}% below current
                        </div>
                        <div className="text-gray-600 mt-1">
                          Collateral: ${collateral.toLocaleString()}
                        </div>
                      </div>
                      <div className="bg-red-900/20 border border-red-700/30 rounded p-2">
                        <div className="text-red-400 font-medium">Stop Loss (2x)</div>
                        <div className="text-white">-${(estCredit * 100).toFixed(0)}/contract</div>
                        <div className="text-gray-500">
                          Close when loss = 2x credit
                        </div>
                        <div className="text-gray-600 mt-1">
                          Max risk: ${(estCredit * 200).toFixed(0)}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Exit Rules */}
          <div className="mt-3 pt-3 border-t border-gray-700/50">
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
              Schwab Trade Management Rules
            </h4>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 bg-green-900/20 border border-green-700/30 rounded text-green-400">
                Close at 50% profit
              </span>
              <span className="px-2 py-1 bg-red-900/20 border border-red-700/30 rounded text-red-400">
                Stop at 2x premium loss
              </span>
              <span className="px-2 py-1 bg-blue-900/20 border border-blue-700/30 rounded text-blue-400">
                Roll at 21 DTE if profitable
              </span>
              <span className="px-2 py-1 bg-gray-800 border border-gray-700/50 rounded text-gray-400">
                Max 5-10% of capital per position
              </span>
              <span className="px-2 py-1 bg-gray-800 border border-gray-700/50 rounded text-gray-400">
                Cash-secured: full assignment capital reserved
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Position Sizer Sub-component ─────────────────────────────

function PositionSizer({
  price,
  supportLevel,
  atr,
}: {
  price: number;
  supportLevel: number;
  atr: number;
}) {
  const [portfolioSize, setPortfolioSize] = useState(100000);
  const [riskPct, setRiskPct] = useState(5);

  const maxPosition = portfolioSize * (riskPct / 100);
  const suggestedStrike = Math.round(Math.min(price * 0.92, supportLevel));
  const collateral = suggestedStrike * 100; // per contract
  const maxContracts = Math.floor(maxPosition / collateral);
  const totalCollateral = maxContracts * collateral;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">Portfolio Size ($)</label>
          <input
            type="number"
            value={portfolioSize}
            onChange={e => setPortfolioSize(Number(e.target.value) || 0)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">Max Risk per Position (%)</label>
          <input
            type="number"
            value={riskPct}
            min={1}
            max={20}
            onChange={e => setRiskPct(Number(e.target.value) || 5)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white"
          />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div>
          <div className="text-gray-500">Max Allocation</div>
          <div className="text-white font-medium">${maxPosition.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-gray-500">Collateral/Contract</div>
          <div className="text-white font-medium">${collateral.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-gray-500">Max Contracts</div>
          <div className="text-white font-medium">{maxContracts}</div>
        </div>
        <div>
          <div className="text-gray-500">Total Collateral</div>
          <div className="text-white font-medium">${totalCollateral.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

interface Top10Put {
  symbol: string;
  companyName: string;
  stockPrice: number;
  strikePrice: number;
  expiration: string;
  dte: number;
  bid: number;
  ask: number;
  delta: number;
  theta: number;
  score: number;
  stabilityScore: number;
  annualizedReturn: number;
  distanceOTM: number;
  premiumYield: number;
  openInterest: number;
  recommendation: string;
  signals: { name: string; value: string; sentiment: string; weight: number }[];
}

interface Top10PutsProps {
  puts: Top10Put[];
}

const recColors: Record<string, { bg: string; text: string }> = {
  STRONG_SELL: { bg: "bg-green-900/40", text: "text-green-300" },
  SELL: { bg: "bg-green-900/20", text: "text-green-400" },
  NEUTRAL: { bg: "bg-yellow-900/20", text: "text-yellow-400" },
  AVOID: { bg: "bg-red-900/20", text: "text-red-400" },
};

const recLabels: Record<string, string> = {
  STRONG_SELL: "Strong Sell Put",
  SELL: "Sell Put",
  NEUTRAL: "Neutral",
  AVOID: "Avoid",
};

function CrossComparisonGuide() {
  return (
    <div className="bg-gray-900/70 border border-gray-700/50 rounded-lg p-4 mb-4 text-xs space-y-3">
      <h3 className="text-sm font-medium text-white mb-2">How to Evaluate & Cross-Compare</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-blue-400 font-medium mb-1">Score (0-100)</div>
          <p className="text-gray-400">
            Composite rank combining premium yield, delta, DTE, liquidity, distance OTM, IV environment, and company stability.
            <span className="text-white"> Compare scores at similar DTE ranges</span> — a 78 at 31d DTE
            is not directly comparable to a 78 at 60d DTE since theta decay differs.
          </p>
        </div>

        <div>
          <div className="text-green-400 font-medium mb-1">Premium ($)</div>
          <p className="text-gray-400">
            Mid-price per share you collect upfront. Higher premium = more income but usually means closer to the money.
            <span className="text-white"> Compare premium relative to collateral</span> (strike × 100) — $7.70 on a $360 strike
            is 2.1% yield vs $15.88 on $760 is also 2.1%.
          </p>
        </div>

        <div>
          <div className="text-green-400 font-medium mb-1">Annualized Return (%)</div>
          <p className="text-gray-400">
            Premium yield scaled to 365 days for apples-to-apples comparison across different DTEs.
            <span className="text-white"> This is the primary cross-comparison metric.</span>
            {" "}25% annualized at 31d DTE is better risk-adjusted than 25% at 60d DTE (same return, less time at risk).
          </p>
        </div>

        <div>
          <div className="text-yellow-400 font-medium mb-1">Stability (0-100)</div>
          <p className="text-gray-400">
            Company quality: market cap (30%), beta (30%), 52-week range position (25%), dividend yield (15%).
            <span className="text-white"> If assigned, you own this stock.</span>
            {" "}Stability 85+ = blue-chip, 60-84 = solid, below 60 = speculative.
          </p>
        </div>

        <div>
          <div className="text-gray-300 font-medium mb-1">Delta</div>
          <p className="text-gray-400">
            Approximate probability of being assigned (ITM at expiration). -0.20 delta ≈ 80% chance of profit.
            <span className="text-white"> Lower |delta| = safer but less premium.</span>
            {" "}Sweet spot: -0.15 to -0.25 (tastytrade/DataDrivenOptions research).
          </p>
        </div>

        <div>
          <div className="text-purple-400 font-medium mb-1">Cross-Comparison Tips</div>
          <p className="text-gray-400">
            <span className="text-white">Best trade:</span> highest annualized return + stability ≥70 + |delta| ≤ 0.25.
            {" "}Watch for traps: high annualized return with low stability or high |delta| means the premium
            compensates for elevated assignment risk.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Top10Puts({ puts }: Top10PutsProps) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  if (puts.length === 0) return null;

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">
            Top 10 Put Sales Today
          </h2>
          <button
            onClick={(e) => { e.stopPropagation(); setShowGuide(!showGuide); }}
            className="w-5 h-5 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white text-xs flex items-center justify-center transition-colors"
            title="How to evaluate these numbers"
          >
            ?
          </button>
        </div>
        <span className="text-xs text-gray-500">
          Ranked by option quality + company stability + checklist
        </span>
      </div>

      {showGuide && <CrossComparisonGuide />}

      <div className="space-y-1">
        {puts.map((put, i) => {
          const colors = recColors[put.recommendation] ?? recColors.NEUTRAL;
          const isExpanded = expandedRow === i;
          const midPrice = (put.bid + put.ask) / 2;

          return (
            <div
              key={`${put.symbol}-${put.strikePrice}-${put.expiration}`}
              className={`rounded-lg border transition-colors cursor-pointer ${
                isExpanded
                  ? "border-blue-500/40 bg-gray-800/60"
                  : "border-gray-700/50 hover:bg-gray-800/40"
              }`}
              onClick={() => setExpandedRow(isExpanded ? null : i)}
            >
              {/* Main row */}
              <div className="flex items-center gap-3 p-3">
                {/* Rank */}
                <div className="w-8 text-center">
                  <span
                    className={`text-lg font-bold ${
                      i < 3 ? "text-yellow-400" : "text-gray-500"
                    }`}
                  >
                    {i + 1}
                  </span>
                </div>

                {/* Score */}
                <div className="w-14">
                  <div
                    className={`text-xl font-bold ${
                      put.score >= 75
                        ? "text-green-400"
                        : put.score >= 55
                        ? "text-blue-400"
                        : "text-yellow-400"
                    }`}
                  >
                    {put.score.toFixed(0)}
                  </div>
                </div>

                {/* Symbol & Company */}
                <div className="w-32 min-w-0">
                  <div className="text-white font-bold">{put.symbol}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {put.companyName}
                  </div>
                </div>

                {/* Recommendation */}
                <div className="w-28">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}
                  >
                    {recLabels[put.recommendation] ?? put.recommendation}
                  </span>
                </div>

                {/* Strike & Exp */}
                <div className="w-28 text-sm">
                  <div className="text-white font-medium">
                    ${put.strikePrice.toFixed(0)} put
                  </div>
                  <div className="text-gray-500 text-xs">
                    {put.expiration} ({put.dte}d)
                  </div>
                </div>

                {/* Premium */}
                <div className="w-20 text-sm">
                  <div className="text-green-400 font-medium">
                    ${midPrice.toFixed(2)}
                  </div>
                  <div className="text-gray-500 text-xs">premium</div>
                </div>

                {/* Annualized Return */}
                <div className="w-20 text-sm">
                  <div
                    className={`font-medium ${
                      put.annualizedReturn >= 10
                        ? "text-green-400"
                        : "text-yellow-400"
                    }`}
                  >
                    {put.annualizedReturn.toFixed(1)}%
                  </div>
                  <div className="text-gray-500 text-xs">annualized</div>
                </div>

                {/* Stability */}
                <div className="w-20 text-sm">
                  <div
                    className={`font-medium ${
                      put.stabilityScore >= 70
                        ? "text-green-400"
                        : put.stabilityScore >= 50
                        ? "text-yellow-400"
                        : "text-red-400"
                    }`}
                  >
                    {put.stabilityScore.toFixed(0)}/100
                  </div>
                  <div className="text-gray-500 text-xs">stability</div>
                </div>

                {/* Delta */}
                <div className="w-16 text-sm text-gray-400 hidden md:block">
                  {put.delta.toFixed(3)}
                </div>

                {/* Expand */}
                <div className="w-6 text-gray-500 text-sm ml-auto">
                  {isExpanded ? "▲" : "▼"}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-700/50">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Trade Details */}
                    <div>
                      <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                        Trade Details
                      </h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-400">Stock Price</span>
                          <span className="text-white">
                            ${put.stockPrice.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Collateral</span>
                          <span className="text-white">
                            ${(put.strikePrice * 100).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Premium</span>
                          <span className="text-green-400">
                            ${(midPrice * 100).toFixed(0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Breakeven</span>
                          <span className="text-white">
                            ${(put.strikePrice - midPrice).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Distance OTM</span>
                          <span className="text-white">
                            {put.distanceOTM.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Theta/day</span>
                          <span className="text-green-400">
                            ${(Math.abs(put.theta) * 100).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Scoring Signals */}
                    <div className="md:col-span-2">
                      <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                        Scoring Breakdown
                      </h4>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {put.signals.map((signal) => (
                          <div
                            key={signal.name}
                            className="flex items-center justify-between text-sm"
                          >
                            <span className="text-gray-400">{signal.name}</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-white text-xs">
                                {signal.value}
                              </span>
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  signal.sentiment === "bullish"
                                    ? "bg-green-400"
                                    : signal.sentiment === "bearish"
                                    ? "bg-red-400"
                                    : "bg-yellow-400"
                                }`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Management Rules */}
                  <div className="mt-3 pt-3 border-t border-gray-700/50 flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 bg-gray-700/50 rounded text-gray-300">
                      Close at 50% profit (${(midPrice * 50).toFixed(0)} gain)
                    </span>
                    <span className="px-2 py-1 bg-gray-700/50 rounded text-gray-300">
                      Stop at 2x credit (${(midPrice * 100).toFixed(0)} loss)
                    </span>
                    <span className="px-2 py-1 bg-gray-700/50 rounded text-gray-300">
                      Roll at 21 DTE if profitable
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

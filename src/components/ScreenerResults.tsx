"use client";

import { useState } from "react";
import PutTable from "./PutTable";

interface ScreenerStock {
  symbol: string;
  quote: {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
  };
  ivRank: number;
  stability: {
    score: number;
    signals: { name: string; value: string; sentiment: string; weight: number }[];
  };
  topPuts: Array<{
    symbol: string;
    stockPrice: number;
    strikePrice: number;
    expiration: string;
    dte: number;
    bid: number;
    ask: number;
    lastPrice: number;
    volume: number;
    openInterest: number;
    impliedVolatility: number;
    delta: number;
    theta: number;
    score: number;
    premiumYield: number;
    annualizedReturn: number;
    distanceOTM: number;
    bidAskSpread: number;
    stabilityScore: number;
    recommendation: string;
    signals: { name: string; value: string; sentiment: string; weight: number }[];
  }>;
}

interface ScreenProgress {
  total: number;
  completed: number;
  currentSymbol: string;
  failedSymbols: { symbol: string; error: string }[];
}

interface ScreenerResultsProps {
  results: ScreenerStock[];
  loading: boolean;
  progress?: ScreenProgress | null;
  onAnalyze: (symbol: string) => void;
}

export default function ScreenerResults({
  results,
  loading,
  progress,
  onAnalyze,
}: ScreenerResultsProps) {
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  if (loading) {
    const pct = progress ? Math.round((progress.completed / progress.total) * 100) : 0;

    return (
      <div className="text-center py-12">
        <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400">
          Screening stocks for put selling opportunities...
        </p>
        {progress && (
          <div className="mt-4 max-w-md mx-auto">
            {/* Progress bar */}
            <div className="w-full bg-gray-800 rounded-full h-2 mb-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-gray-500 text-sm">
              {progress.completed} of {progress.total} stocks analyzed ({pct}%)
            </p>
            {progress.currentSymbol && (
              <p className="text-blue-400 text-sm mt-1">
                Analyzing {progress.currentSymbol}...
              </p>
            )}
            {progress.failedSymbols.length > 0 && (
              <p className="text-yellow-500 text-xs mt-1">
                {progress.failedSymbols.length} failed: {progress.failedSymbols.map(f => f.symbol).join(", ")}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">&#128269;</div>
        <h3 className="text-lg font-medium text-white mb-2">
          No put selling opportunities found
        </h3>
        <p className="text-gray-400 text-sm max-w-md mx-auto">
          This can happen when markets are closed (weekends / after hours) and option pricing data is unavailable.
          Try again during regular market hours: Mon-Fri, 9:30 AM - 4:00 PM ET.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-white mb-4">
        All Screened Stocks ({results.length})
      </h2>
      {results.map((stock) => {
        const topPut = stock.topPuts[0];
        const isExpanded = expandedSymbol === stock.symbol;
        const isUp = stock.quote.change >= 0;

        return (
          <div
            key={stock.symbol}
            className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden"
          >
            <div
              className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-800/80 transition-colors"
              onClick={() =>
                setExpandedSymbol(isExpanded ? null : stock.symbol)
              }
            >
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-white font-bold text-lg">
                    {stock.symbol}
                  </span>
                  <span className="text-gray-400 text-sm ml-2">
                    {stock.quote.name}
                  </span>
                </div>
                <span
                  className={`text-sm ${
                    isUp ? "text-green-400" : "text-red-400"
                  }`}
                >
                  ${stock.quote.price.toFixed(2)} ({isUp ? "+" : ""}
                  {stock.quote.changePercent.toFixed(2)}%)
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-gray-500">Best Score</div>
                  <div
                    className={`font-bold ${
                      topPut.score >= 75
                        ? "text-green-400"
                        : topPut.score >= 55
                        ? "text-blue-400"
                        : "text-yellow-400"
                    }`}
                  >
                    {topPut.score.toFixed(0)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Stability</div>
                  <div
                    className={`font-medium ${
                      stock.stability.score >= 70
                        ? "text-green-400"
                        : stock.stability.score >= 50
                        ? "text-yellow-400"
                        : "text-red-400"
                    }`}
                  >
                    {stock.stability.score.toFixed(0)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">HV Rank</div>
                  <div
                    className={`font-medium ${
                      stock.ivRank >= 50
                        ? "text-green-400"
                        : stock.ivRank >= 30
                        ? "text-yellow-400"
                        : "text-gray-400"
                    }`}
                  >
                    {stock.ivRank.toFixed(0)}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Ann. Return</div>
                  <div className="text-green-400 font-medium">
                    {topPut.annualizedReturn.toFixed(1)}%
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAnalyze(stock.symbol);
                  }}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  Full Analysis
                </button>
                <span className="text-gray-500">{isExpanded ? "▲" : "▼"}</span>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-gray-700 p-3">
                <PutTable puts={stock.topPuts} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

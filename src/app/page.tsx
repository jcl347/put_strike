"use client";

import { useState, useCallback } from "react";
import SymbolSearch from "@/components/SymbolSearch";
import MarketRegime from "@/components/MarketRegime";
import StockQuoteCard from "@/components/StockQuoteCard";
import PutTable from "@/components/PutTable";
import ScreenerResults from "@/components/ScreenerResults";

interface AnalysisData {
  symbol: string;
  quote: {
    symbol: string;
    name: string;
    price: number;
    previousClose: number;
    change: number;
    changePercent: number;
    volume: number;
    avgVolume: number;
    marketCap: number;
    fiftyTwoWeekLow: number;
    fiftyTwoWeekHigh: number;
    dividendYield: number;
  };
  historicalVolatility: {
    currentHV: number;
    hvHigh: number;
    hvLow: number;
    hvRank: number;
  };
  marketRegime: {
    vix: number;
    regime: string;
    favorsPutSelling: boolean;
    description: string;
  };
  scoredPuts: Array<{
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
    recommendation: string;
    signals: { name: string; value: string; sentiment: string; weight: number }[];
  }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScreenerData = any;

export default function Home() {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [screenerData, setScreenerData] = useState<ScreenerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [screenLoading, setScreenLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"analyze" | "screen">("analyze");

  const analyzeSymbol = useCallback(async (symbol: string) => {
    setLoading(true);
    setError(null);
    setActiveTab("analyze");
    try {
      const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const runScreener = useCallback(async () => {
    setScreenLoading(true);
    setError(null);
    setActiveTab("screen");
    try {
      const res = await fetch("/api/screen");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Screening failed");
      setScreenerData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Screening failed");
      setScreenerData(null);
    } finally {
      setScreenLoading(false);
    }
  }, []);

  const marketRegime = analysis?.marketRegime ?? screenerData?.marketRegime ?? null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold text-white">PutStrike</h1>
          <span className="text-xs bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30">
            Research-Backed
          </span>
        </div>
        <p className="text-gray-400 max-w-2xl">
          Optimize cash-secured put sales using live market data and
          research-validated scoring. Based on tastytrade, DataDrivenOptions, and
          academic options research.
        </p>
      </header>

      {/* Market Regime */}
      <div className="mb-6">
        <MarketRegime regime={marketRegime} />
      </div>

      {/* Search & Actions */}
      <div className="mb-6 space-y-3">
        <SymbolSearch onSelect={analyzeSymbol} isLoading={loading} />
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("analyze")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "analyze"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            Single Stock Analysis
          </button>
          <button
            onClick={runScreener}
            disabled={screenLoading}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "screen"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {screenLoading ? "Screening..." : "Screen Top Stocks"}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="text-center py-16">
          <div className="w-10 h-10 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Fetching live options data and computing scores...</p>
        </div>
      )}

      {/* Analysis Results */}
      {activeTab === "analyze" && analysis && !loading && (
        <div className="space-y-6">
          <StockQuoteCard
            quote={analysis.quote}
            hv={analysis.historicalVolatility}
          />

          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <PutTable
              puts={analysis.scoredPuts}
              title={`Top Put Selling Opportunities for ${analysis.symbol}`}
            />
          </div>

          {/* Strategy Guide */}
          <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-400 mb-3">
              Strategy Reference
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <h4 className="text-white font-medium mb-1">Entry Criteria</h4>
                <ul className="text-gray-400 space-y-1 list-disc list-inside">
                  <li>Delta: -0.15 to -0.30 (sweet spot)</li>
                  <li>DTE: 30-45 days optimal</li>
                  <li>HV Rank &gt; 30% (ideally &gt; 50%)</li>
                  <li>Strike 5-15% below current price</li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-medium mb-1">Management</h4>
                <ul className="text-gray-400 space-y-1 list-disc list-inside">
                  <li>Close at 50% of max profit</li>
                  <li>Stop loss at 2x premium received</li>
                  <li>Roll at 21 DTE if still profitable</li>
                  <li>Never hold through earnings</li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-medium mb-1">Risk Management</h4>
                <ul className="text-gray-400 space-y-1 list-disc list-inside">
                  <li>Max 5% of portfolio per position</li>
                  <li>Only sell puts on stocks you&apos;d own</li>
                  <li>Reduce size when VIX &gt; 30</li>
                  <li>Avoid pre-earnings plays</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Screener Results */}
      {activeTab === "screen" && (
        <ScreenerResults
          results={screenerData?.results ?? []}
          loading={screenLoading}
          onAnalyze={analyzeSymbol}
        />
      )}

      {/* Empty State */}
      {!analysis && !screenerData && !loading && !screenLoading && !error && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">&#128200;</div>
          <h2 className="text-xl font-semibold text-white mb-2">
            Find Optimal Put Selling Opportunities
          </h2>
          <p className="text-gray-400 max-w-md mx-auto mb-6">
            Search for a stock to analyze its options chain, or run the screener
            to find the best put selling candidates across popular stocks.
          </p>
          <div className="flex justify-center gap-3">
            {["AAPL", "MSFT", "SPY", "NVDA", "AMZN"].map((sym) => (
              <button
                key={sym}
                onClick={() => analyzeSymbol(sym)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors border border-gray-700"
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-12 pt-6 border-t border-gray-800 text-center text-xs text-gray-600">
        <p>
          PutStrike is a research tool for educational purposes. Options trading
          involves substantial risk of loss. Past performance does not guarantee
          future results.
        </p>
        <p className="mt-1">
          Methodology based on tastytrade research (45 DTE, 16-20 delta),
          DataDrivenOptions, and Spintwig backtesting studies.
        </p>
      </footer>
    </div>
  );
}

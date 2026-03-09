"use client";

import { useState, useCallback, useRef } from "react";
import SymbolSearch from "@/components/SymbolSearch";
import MarketRegime from "@/components/MarketRegime";
import StockQuoteCard from "@/components/StockQuoteCard";
import PutTable from "@/components/PutTable";
import ScreenerResults from "@/components/ScreenerResults";
import Top10Puts from "@/components/Top10Puts";
import ErrorToast from "@/components/ErrorToast";

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
    beta: number;
    trailingPE: number;
  };
  historicalVolatility: {
    currentHV: number;
    hvHigh: number;
    hvLow: number;
    hvRank: number;
  };
  stability: {
    score: number;
    signals: { name: string; value: string; sentiment: string; weight: number }[];
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
    stabilityScore: number;
    recommendation: string;
    signals: { name: string; value: string; sentiment: string; weight: number }[];
  }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScreenerData = any;

// Full watchlist: 20 high-liquidity stocks across sectors + major ETFs
const SCREENER_SYMBOLS = [
  // Mega-cap Tech
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META",
  // Finance
  "JPM", "V", "MA",
  // Consumer / Healthcare / Industrial
  "JNJ", "PG", "KO", "WMT", "HD",
  // ETFs
  "SPY", "QQQ", "IWM",
  // Additional high-liquidity
  "DIS", "PEP", "COST",
];

interface ScreenProgress {
  total: number;
  completed: number;
  currentSymbol: string;
  failedSymbols: { symbol: string; error: string }[];
}

export default function Home() {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [screenerData, setScreenerData] = useState<ScreenerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [screenLoading, setScreenLoading] = useState(false);
  const [screenProgress, setScreenProgress] = useState<ScreenProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"analyze" | "screen">("analyze");
  const [dataSourceStatus, setDataSourceStatus] = useState<"connected" | "degraded" | "down" | null>(null);
  const abortRef = useRef(false);

  // Safely parse API response - handles HTML error pages from Vercel
  const safeParseResponse = async (res: Response): Promise<{ data: Record<string, unknown> | null; rawText: string }> => {
    const rawText = await res.text();
    try {
      return { data: JSON.parse(rawText), rawText };
    } catch {
      return { data: null, rawText };
    }
  };

  const analyzeSymbol = useCallback(async (symbol: string) => {
    setLoading(true);
    setError(null);
    setErrorDetails(null);
    setActiveTab("analyze");
    setDataSourceStatus(null);
    try {
      const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(symbol)}`);
      const { data, rawText } = await safeParseResponse(res);

      if (!res.ok) {
        const serverError = data?.error as string | undefined;
        setErrorDetails(`Status: ${res.status}\n${serverError ?? rawText.slice(0, 500)}`);
        if (serverError?.includes("fetch failed") || serverError?.includes("429")) {
          setDataSourceStatus("down");
          throw new Error("Yahoo Finance is currently unavailable (rate limited or unreachable). Please try again in a few minutes.");
        }
        throw new Error(serverError || `Server returned ${res.status}: ${rawText.slice(0, 200)}`);
      }
      if (!data) {
        throw new Error("Server returned invalid response (not JSON)");
      }
      setAnalysis(data as unknown as AnalysisData);
      setDataSourceStatus("connected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Analysis failed";
      if (msg.includes("fetch failed") || msg.includes("Failed to fetch")) {
        setDataSourceStatus("down");
        setError("Yahoo Finance is currently unavailable. The live data source may be down or rate limiting requests. Please try again shortly.");
      } else {
        setError(msg);
      }
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Client-side orchestrated screener.
   * Calls /api/screen-single for each stock individually (2 at a time).
   * Each serverless call handles just 1 stock so it fits within any Vercel timeout.
   * Shows live progress as each stock completes.
   */
  const runScreener = useCallback(async () => {
    setScreenLoading(true);
    setError(null);
    setErrorDetails(null);
    setActiveTab("screen");
    setDataSourceStatus(null);
    setScreenerData(null);
    abortRef.current = false;

    const symbols = SCREENER_SYMBOLS;
    const progress: ScreenProgress = {
      total: symbols.length,
      completed: 0,
      currentSymbol: "",
      failedSymbols: [],
    };
    setScreenProgress({ ...progress });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const successfulResults: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let marketRegime: any = null;
    let vix: number | null = null;

    try {
      // Process stocks 2 at a time (each makes 3-4 Yahoo requests server-side)
      // 2 concurrent = 6-8 Yahoo requests at a time, avoids rate limiting
      const concurrency = 2;

      for (let i = 0; i < symbols.length; i += concurrency) {
        if (abortRef.current) break;

        const batch = symbols.slice(i, i + concurrency);
        progress.currentSymbol = batch.join(", ");
        setScreenProgress({ ...progress });

        const batchResults = await Promise.allSettled(
          batch.map(async (sym) => {
            const url = vix != null
              ? `/api/screen-single?symbol=${encodeURIComponent(sym)}&vix=${vix}`
              : `/api/screen-single?symbol=${encodeURIComponent(sym)}`;
            const res = await fetch(url);
            const { data } = await safeParseResponse(res);

            if (!res.ok || !data) {
              throw new Error((data?.error as string) || `HTTP ${res.status}`);
            }
            return { symbol: sym, data };
          })
        );

        for (let j = 0; j < batchResults.length; j++) {
          const r = batchResults[j];
          if (r.status === "fulfilled") {
            const { data } = r.value;
            // Capture VIX from first successful result
            if (vix === null && data.vix) {
              vix = data.vix as number;
            }
            if (!marketRegime && data.marketRegime) {
              marketRegime = data.marketRegime;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((data.topPuts as any[])?.length > 0) {
              successfulResults.push(data);
            }
          } else {
            const errMsg = r.reason?.message ?? "Failed";
            progress.failedSymbols.push({ symbol: batch[j], error: errMsg });
          }
          progress.completed++;
        }

        setScreenProgress({ ...progress });

        // Brief delay between batches to be kind to Yahoo rate limits
        if (i + concurrency < symbols.length && !abortRef.current) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      // Sort results by best score
      successfulResults.sort((a, b) => {
        const aTop = a.topPuts?.[0]?.score ?? 0;
        const bTop = b.topPuts?.[0]?.score ?? 0;
        return bTop - aTop;
      });

      // Build global top 10 picks across all stocks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allScoredPuts: any[] = [];
      for (const stock of successfulResults) {
        for (const put of stock.topPuts ?? []) {
          allScoredPuts.push({
            ...put,
            stabilityScore: stock.stability?.score ?? 0,
            companyName: stock.quote?.name ?? stock.symbol,
          });
        }
      }
      allScoredPuts.sort((a, b) => b.score - a.score);
      const top10 = allScoredPuts.slice(0, 10);

      const finalData = {
        marketRegime,
        timestamp: new Date().toISOString(),
        top10,
        results: successfulResults,
        failedSymbols: progress.failedSymbols,
      };

      setScreenerData(finalData);

      // Set data source status
      if (progress.failedSymbols.length > 0 && successfulResults.length > 0) {
        setDataSourceStatus("degraded");
      } else if (progress.failedSymbols.length > 0 && successfulResults.length === 0) {
        setDataSourceStatus("down");
        setError("Could not fetch data for any stocks. Yahoo Finance may be down or rate limiting.");
      } else {
        setDataSourceStatus("connected");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Screening failed";
      setError(msg);
      setDataSourceStatus("down");
    } finally {
      setScreenLoading(false);
      setScreenProgress(null);
    }
  }, []);

  const marketRegime = analysis?.marketRegime ?? screenerData?.marketRegime ?? null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold text-white">PutStrike</h1>
          <span className="text-xs bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30">
            Research-Backed
          </span>
        </div>
        <p className="text-gray-400 max-w-2xl">
          Optimize cash-secured put sales using live market data, company stability analysis,
          and research-validated scoring (tastytrade, DataDrivenOptions, CBOE research).
        </p>
      </header>

      {/* Data Source Status */}
      {dataSourceStatus && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg border flex items-center gap-2 text-sm ${
            dataSourceStatus === "connected"
              ? "bg-green-900/10 border-green-500/30 text-green-400"
              : dataSourceStatus === "degraded"
              ? "bg-yellow-900/10 border-yellow-500/30 text-yellow-400"
              : "bg-red-900/10 border-red-500/30 text-red-400"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              dataSourceStatus === "connected"
                ? "bg-green-400"
                : dataSourceStatus === "degraded"
                ? "bg-yellow-400 animate-pulse"
                : "bg-red-400 animate-pulse"
            }`}
          />
          {dataSourceStatus === "connected" && (
            <span>Yahoo Finance: Connected &mdash; Live data as of {new Date().toLocaleTimeString()}</span>
          )}
          {dataSourceStatus === "degraded" && (
            <span>
              Yahoo Finance: Partial data &mdash; Some symbols failed to load
              {screenerData?.failedSymbols?.length > 0 && (
                <span className="text-yellow-500 ml-1">
                  (Failed: {screenerData.failedSymbols.map((f: {symbol: string}) => f.symbol).join(", ")})
                </span>
              )}
            </span>
          )}
          {dataSourceStatus === "down" && (
            <span>Yahoo Finance: Unavailable &mdash; Data source is down or rate limiting. Try again in a few minutes.</span>
          )}
        </div>
      )}

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

      {/* Error Popup */}
      <ErrorToast
        message={error}
        details={errorDetails}
        onDismiss={() => { setError(null); setErrorDetails(null); }}
      />

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

          {/* Company Stability Card */}
          {analysis.stability && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-400">
                  Company Stability Assessment
                </h3>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xl font-bold ${
                      analysis.stability.score >= 70
                        ? "text-green-400"
                        : analysis.stability.score >= 50
                        ? "text-yellow-400"
                        : "text-red-400"
                    }`}
                  >
                    {analysis.stability.score.toFixed(0)}/100
                  </span>
                  <span className="text-xs text-gray-500">
                    {analysis.stability.score >= 70
                      ? "Stable — Safe for CSP"
                      : analysis.stability.score >= 50
                      ? "Moderate — Proceed with caution"
                      : "Risky — Consider alternatives"}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {analysis.stability.signals.map((signal: { name: string; value: string; sentiment: string }) => (
                  <div key={signal.name} className="text-sm">
                    <div className="text-gray-500">{signal.name}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-white">{signal.value}</span>
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
          )}

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
                  <li>Stability score &gt; 60</li>
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
                  <li>Prefer beta &lt; 1.3 underlyings</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Screener Results */}
      {activeTab === "screen" && (
        <div className="space-y-6">
          {/* Top 10 Picks */}
          {screenerData?.top10 && screenerData.top10.length > 0 && !screenLoading && (
            <Top10Puts puts={screenerData.top10} />
          )}

          {/* Full Results */}
          <ScreenerResults
            results={screenerData?.results ?? []}
            loading={screenLoading}
            progress={screenProgress}
            onAnalyze={analyzeSymbol}
          />
        </div>
      )}

      {/* Empty State */}
      {!analysis && !screenerData && !loading && !screenLoading && !error && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">&#128200;</div>
          <h2 className="text-xl font-semibold text-white mb-2">
            Find Optimal Put Selling Opportunities
          </h2>
          <p className="text-gray-400 max-w-md mx-auto mb-6">
            Search for a stock to analyze its options chain with stability scoring,
            or run the screener to find the Top 10 best put selling candidates across 20 stocks.
          </p>
          <div className="flex justify-center gap-3 mb-4">
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
          <button
            onClick={runScreener}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
          >
            Screen 20 Stocks for Top 10 Put Sales
          </button>
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
          Scoring includes company stability (beta, market cap, dividends, 52wk position)
          and option quality (premium, delta, DTE, liquidity, IV rank).
        </p>
      </footer>
    </div>
  );
}

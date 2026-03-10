"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import SymbolSearch from "@/components/SymbolSearch";
import MarketRegime from "@/components/MarketRegime";
import StockQuoteCard from "@/components/StockQuoteCard";
import PutTable from "@/components/PutTable";
import ScreenerResults from "@/components/ScreenerResults";
import Top10Puts from "@/components/Top10Puts";
import ErrorToast from "@/components/ErrorToast";
import PutDecisionAssistant from "@/components/PutDecisionAssistant";
import PricePrediction from "@/components/PricePrediction";
import HFModelStatus from "@/components/HFModelStatus";
import DTESelector, { DEFAULT_DTE, type DTERange } from "@/components/DTESelector";
import StockForecast from "@/components/StockForecast";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import ConcordanceCard from "@/components/ConcordanceCard";

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

// 80+ high-liquidity optionable stocks across all sectors + major ETFs
// Selected for: options volume, tight spreads, market cap, sector diversity
// Optimized for Schwab cash-secured put selling
const SCREENER_SYMBOLS = [
  // ── Mega-cap Tech (highest options liquidity) ──
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AVGO",
  "ORCL", "CRM", "ADBE", "AMD", "INTC", "CSCO", "IBM",
  // ── Finance ──
  "JPM", "V", "MA", "GS", "BAC", "WFC", "MS", "BLK", "AXP", "C",
  // ── Healthcare ──
  "UNH", "JNJ", "MRK", "ABBV", "LLY", "PFE", "ABT", "TMO", "AMGN", "MDT",
  // ── Consumer Staples ──
  "PG", "KO", "PEP", "COST", "WMT", "MO", "PM", "CL", "MDLZ",
  // ── Consumer Discretionary ──
  "HD", "MCD", "NKE", "SBUX", "TGT", "LOW",
  // ── Energy ──
  "XOM", "CVX", "COP", "SLB", "EOG",
  // ── Industrial ──
  "CAT", "HON", "UPS", "BA", "GE", "DE", "RTX", "LMT",
  // ── Utilities / REITs (defensive, high-yield) ──
  "NEE", "DUK", "SO", "D",
  // ── Materials ──
  "LIN", "APD", "FCX",
  // ── Communication ──
  "DIS", "NFLX", "CMCSA", "T", "VZ",
  // ── ETFs (broad, sector, volatility) ──
  "SPY", "QQQ", "IWM", "DIA", "SMH", "XLF", "XLE", "XLK", "XLV", "GLD", "EEM",
];

interface ScreenProgress {
  total: number;
  completed: number;
  currentSymbol: string;
  failedSymbols: { symbol: string; error: string }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PredictionData = any;

export default function Home() {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [screenerData, setScreenerData] = useState<ScreenerData | null>(null);
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [screenLoading, setScreenLoading] = useState(false);
  const [screenProgress, setScreenProgress] = useState<ScreenProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"analyze" | "screen">("analyze");
  const [dataSourceStatus, setDataSourceStatus] = useState<"connected" | "degraded" | "down" | null>(null);
  const abortRef = useRef(false);
  const [dteRange, setDteRange] = useState<DTERange>(DEFAULT_DTE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [screenerForecasts, setScreenerForecasts] = useState<Record<string, any>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [singleForecast, setSingleForecast] = useState<any>(null);
  const [singleForecastLoading, setSingleForecastLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [singleForecastData, setSingleForecastData] = useState<any>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);

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
      // Fetch widest DTE range; client-side DTESelector filters the results instantly
      const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(symbol)}&minDte=1&maxDte=120`);
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
      const analysisData = data as unknown as AnalysisData;
      setAnalysis(analysisData);
      setDataSourceStatus("connected");
      // Trigger predictions in background — both statistical ensemble and iTransformer
      fetchPrediction(symbol);
      fetchSingleForecast(symbol, analysisData.quote.price);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch price prediction for a symbol
  const fetchPrediction = useCallback(async (symbol: string) => {
    setPredictionLoading(true);
    try {
      const url = `/api/predict?symbol=${encodeURIComponent(symbol)}`;
      const res = await fetch(url);
      const { data } = await safeParseResponse(res);
      if (res.ok && data) {
        setPrediction(data);
      }
    } catch {
      // Non-critical — prediction is supplementary
    } finally {
      setPredictionLoading(false);
    }
  }, []);

  // Fetch iTransformer forecast for a single stock
  const fetchSingleForecast = useCallback(async (symbol: string, price: number) => {
    if (!price) return;
    setSingleForecastLoading(true);
    setSingleForecast(null);
    setSingleForecastData(null);
    setForecastError(null);
    try {
      // First check if the model is available and the symbol was trained on
      const { runHFInference, isTrainedSymbol, isModelAvailable, getLastError } = await import("@/lib/hf-model");

      const modelReady = await isModelAvailable();
      if (!modelReady) {
        const err = getLastError();
        const msg = err || "iTransformer model not available";
        console.warn(`[forecast] ${symbol}: ${msg}`);
        setForecastError(msg);
        return;
      }

      if (!isTrainedSymbol(symbol)) {
        const msg = `${symbol} is not in the iTransformer training set — forecast unavailable for this stock`;
        console.info(`[forecast] ${msg}`);
        setForecastError(msg);
        return;
      }

      // Fetch real features from server
      console.log(`[forecast] Fetching features for ${symbol}...`);
      const res = await fetch(`/api/forecast?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const msg = `Feature computation failed: ${errData.error || `HTTP ${res.status}`}`;
        console.error(`[forecast] ${symbol}: ${msg}`);
        setForecastError(msg);
        return;
      }
      const data = await res.json();
      setSingleForecastData(data);

      // Run client-side ONNX inference with real features
      console.log(`[forecast] Running iTransformer inference for ${symbol}...`);
      const prediction = await runHFInference(symbol, price, data.featureMatrix);
      if (prediction) {
        console.log(`[forecast] ${symbol}: iTransformer prediction complete`);
        setSingleForecast(prediction);
      } else {
        const err = getLastError();
        const msg = err || `iTransformer inference returned null for ${symbol}`;
        console.error(`[forecast] ${msg}`);
        setForecastError(msg);
      }
    } catch (err) {
      const msg = `iTransformer forecast failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[forecast] ${symbol}: ${msg}`);
      setForecastError(msg);
    } finally {
      setSingleForecastLoading(false);
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
    let noPutsSymbols: string[] = [];

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
            // Fetch widest DTE range; client-side DTESelector filters results instantly
            const dteParams = `&minDte=1&maxDte=120`;
            const url = vix != null
              ? `/api/screen-single?symbol=${encodeURIComponent(sym)}&vix=${vix}${dteParams}`
              : `/api/screen-single?symbol=${encodeURIComponent(sym)}${dteParams}`;
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
            } else {
              // Stock returned OK but had no scored put candidates
              noPutsSymbols.push(batch[j]);
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

      // Build global top 10 picks — one best put per stock for maximum diversity
      // This ensures a wide range of companies/sectors and DTEs to compare
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bestPerStock = new Map<string, any>();
      for (const stock of successfulResults) {
        for (const put of stock.topPuts ?? []) {
          const enriched = {
            ...put,
            stabilityScore: stock.stability?.score ?? 0,
            companyName: stock.quote?.name ?? stock.symbol,
            _checklistInput: {
              symbol: stock.symbol,
              price: stock.quote?.price ?? 0,
              ivRank: stock.ivRank ?? 50,
              beta: stock.quote?.beta ?? 1,
              marketCap: stock.quote?.marketCap ?? 0,
              dividendYield: stock.quote?.dividendYield ?? 0,
              stabilityScore: stock.stability?.score ?? 50,
              vix: vix ?? 20,
              context: stock.context ?? null,
              trailingPE: stock.quote?.trailingPE,
              fiftyTwoWeekLow: stock.quote?.fiftyTwoWeekLow,
              fiftyTwoWeekHigh: stock.quote?.fiftyTwoWeekHigh,
              volume: stock.quote?.volume,
              avgVolume: stock.quote?.avgVolume,
            },
          };
          const existing = bestPerStock.get(put.symbol);
          if (!existing || put.score > existing.score) {
            bestPerStock.set(put.symbol, enriched);
          }
        }
      }
      // Sort by score descending and take top 10 unique stocks
      const top10 = Array.from(bestPerStock.values())
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 10);

      const finalData = {
        marketRegime,
        timestamp: new Date().toISOString(),
        top10,
        results: successfulResults,
        failedSymbols: progress.failedSymbols,
        noPutsSymbols,
      };

      setScreenerData(finalData);

      // Fetch iTransformer predictions for top symbols using real features
      const topSymbols = [...new Set(top10.map((p: any) => p.symbol))].slice(0, 10) as string[];
      if (topSymbols.length > 0) {
        (async () => {
          try {
            const { runHFInference, isTrainedSymbol, isModelAvailable } = await import("@/lib/hf-model");
            const modelReady = await isModelAvailable();
            if (!modelReady) {
              console.warn("[screener-forecast] iTransformer model not available, skipping forecasts");
              return;
            }
            // Filter to only trained symbols
            const trainedSymbols = topSymbols.filter((sym) => isTrainedSymbol(sym));
            console.log(`[screener-forecast] Running iTransformer for ${trainedSymbols.length}/${topSymbols.length} trained symbols`);

            // Fetch features and run inference for each trained symbol (2 at a time)
            for (let si = 0; si < trainedSymbols.length; si += 2) {
              const batch = trainedSymbols.slice(si, si + 2);
              await Promise.allSettled(
                batch.map(async (sym) => {
                  try {
                    const stock = successfulResults.find((s: any) => s.symbol === sym);
                    const price = stock?.quote?.price ?? 0;
                    if (!price) return;
                    // Fetch real normalized features from server
                    const fRes = await fetch(`/api/forecast?symbol=${encodeURIComponent(sym)}`);
                    if (!fRes.ok) {
                      console.warn(`[screener-forecast] ${sym}: feature fetch failed HTTP ${fRes.status}`);
                      return;
                    }
                    const fData = await fRes.json();
                    const prediction = await runHFInference(sym, price, fData.featureMatrix);
                    if (prediction) {
                      // Attach historical prices for the chart
                      (prediction as any)._historicalPrices = fData.historicalPrices;
                      setScreenerForecasts((prev) => ({ ...prev, [sym]: prediction }));
                      console.log(`[screener-forecast] ${sym}: forecast complete`);
                    } else {
                      console.warn(`[screener-forecast] ${sym}: inference returned null`);
                    }
                  } catch (err) {
                    console.error(`[screener-forecast] ${sym}: ${err instanceof Error ? err.message : String(err)}`);
                  }
                })
              );
            }
          } catch (err) {
            console.error(`[screener-forecast] Model import/load failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
      }

      // Set data source status and messaging
      const totalFailed = progress.failedSymbols.length;
      if (totalFailed > 0 && successfulResults.length > 0) {
        setDataSourceStatus("degraded");
      } else if (successfulResults.length === 0 && totalFailed > 0) {
        setDataSourceStatus("down");
        setError("Could not fetch data for any stocks. Yahoo Finance may be down or rate limiting.");
      } else if (successfulResults.length === 0 && noPutsSymbols.length > 0) {
        setDataSourceStatus("degraded");
        setError("Data loaded but no put candidates found. This can happen when markets are closed — try again during market hours (Mon-Fri 9:30 AM - 4:00 PM ET).");
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

  // Client-side DTE filtering — filter already-fetched puts by selected DTE range
  const filteredAnalysisPuts = useMemo(() => {
    if (!analysis?.scoredPuts) return [];
    return analysis.scoredPuts.filter(
      (p) => p.dte >= dteRange.min && p.dte <= dteRange.max
    );
  }, [analysis?.scoredPuts, dteRange]);

  const filteredTop10 = useMemo(() => {
    if (!screenerData?.top10) return [];
    return screenerData.top10.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => p.dte >= dteRange.min && p.dte <= dteRange.max
    );
  }, [screenerData?.top10, dteRange]);

  const filteredScreenerResults = useMemo(() => {
    if (!screenerData?.results) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return screenerData.results.map((stock: any) => ({
      ...stock,
      topPuts: stock.topPuts?.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p: any) => p.dte >= dteRange.min && p.dte <= dteRange.max
      ) ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })).filter((stock: any) => stock.topPuts.length > 0);
  }, [screenerData?.results, dteRange]);

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

      {/* Model Status + Market Regime */}
      <div className="mb-6 space-y-3">
        <HFModelStatus />
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

          {/* Decision Assistant - Go/No-Go Checklist */}
          <PutDecisionAssistant
            data={{
              symbol: analysis.symbol,
              price: analysis.quote.price,
              ivRank: analysis.historicalVolatility.hvRank,
              beta: analysis.quote.beta,
              marketCap: analysis.quote.marketCap,
              dividendYield: analysis.quote.dividendYield,
              stabilityScore: analysis.stability?.score ?? 50,
              vix: analysis.marketRegime?.vix ?? 20,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              context: (analysis as any).context ?? null,
              trailingPE: analysis.quote.trailingPE,
              fiftyTwoWeekLow: analysis.quote.fiftyTwoWeekLow,
              fiftyTwoWeekHigh: analysis.quote.fiftyTwoWeekHigh,
              volume: analysis.quote.volume,
              avgVolume: analysis.quote.avgVolume,
            }}
          />

          {/* Price Prediction */}
          {predictionLoading && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 text-center">
              <div className="w-8 h-8 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-gray-400 text-sm">Running prediction models ({'>'}300 features)...</p>
            </div>
          )}
          {prediction && !predictionLoading && prediction.symbol === analysis.symbol && (
            <PricePrediction prediction={prediction} />
          )}

          {/* iTransformer Forecast Chart */}
          {singleForecastLoading && (
            <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 text-center">
              <div className="w-8 h-8 border-2 border-gray-600 border-t-purple-400 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-gray-400 text-sm">Loading iTransformer forecast...</p>
            </div>
          )}
          {forecastError && !singleForecastLoading && !singleForecast && (
            <div className="bg-gray-800/50 border border-yellow-700/50 rounded-lg px-4 py-3 flex items-start gap-2">
              <span className="text-yellow-500 text-sm mt-0.5">!</span>
              <div>
                <p className="text-sm text-yellow-400">iTransformer Forecast Unavailable</p>
                <p className="text-xs text-gray-500 mt-0.5">{forecastError}</p>
              </div>
            </div>
          )}
          {singleForecast && singleForecastData && !singleForecastLoading && singleForecast.symbol === analysis.symbol && (
            <>
              <TimeSeriesChart
                historicalPrices={singleForecastData.historicalPrices}
                predictedPrices={singleForecast.predicted_prices}
                currentPrice={singleForecast.current_price}
                symbol={analysis.symbol}
                confidence={singleForecast.confidence}
                dteMarkers={filteredAnalysisPuts.slice(0, 3).map((p: any) => ({
                  dte: p.dte,
                  label: `${p.strikePrice} (${p.dte}d)`,
                }))}
              />

              {/* Concordance Validation — iTransformer vs Statistical Ensemble */}
              {prediction && prediction.symbol === analysis.symbol && (
                <ConcordanceCard
                  iTransformerForecast={singleForecast}
                  ensemblePrediction={prediction}
                  symbol={analysis.symbol}
                />
              )}
            </>
          )}

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

          {/* DTE Filter — directly above puts table */}
          <div className="flex items-center gap-3">
            <DTESelector selected={dteRange} onChange={setDteRange} />
            {analysis.scoredPuts.length > 0 && (
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {filteredAnalysisPuts.length === analysis.scoredPuts.length
                  ? `${filteredAnalysisPuts.length} puts`
                  : `${filteredAnalysisPuts.length} of ${analysis.scoredPuts.length} puts`}
              </span>
            )}
          </div>

          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <PutTable
              puts={filteredAnalysisPuts}
              title={`Top Put Selling Opportunities for ${analysis.symbol}`}
            />
          </div>

          {/* Strategy Guide - Schwab-Optimized */}
          <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-400 mb-3">
              Schwab Cash-Secured Put Strategy Reference
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <h4 className="text-white font-medium mb-1">Entry Criteria</h4>
                <ul className="text-gray-400 space-y-1 list-disc list-inside">
                  <li>Delta: -0.15 to -0.30 (sweet spot)</li>
                  <li>DTE: 30-45 days optimal</li>
                  <li>IV Rank &gt; 50% (sell rich premium)</li>
                  <li>Strike at/below support level</li>
                  <li>Stability score &gt; 60</li>
                  <li>No earnings within DTE window</li>
                  <li>Not in a clear downtrend</li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-medium mb-1">Management</h4>
                <ul className="text-gray-400 space-y-1 list-disc list-inside">
                  <li>Close at 50% of max profit</li>
                  <li>Stop loss at 2x premium received</li>
                  <li>Roll at 21 DTE if still profitable</li>
                  <li>Roll down and out for net credit only</li>
                  <li>Never hold through earnings</li>
                  <li>Know when to take assignment</li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-medium mb-1">Schwab Risk Rules</h4>
                <ul className="text-gray-400 space-y-1 list-disc list-inside">
                  <li>Cash-secured: full collateral reserved</li>
                  <li>Max 5-10% of capital per position</li>
                  <li>Only sell on stocks you&apos;d own</li>
                  <li>Watch ex-dividend for early assignment</li>
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
          {/* DTE Filter — shown once screener has data or is loading */}
          {(screenerData || screenLoading) && (
            <div className="flex items-center gap-3">
              <DTESelector selected={dteRange} onChange={setDteRange} />
              {screenerData?.top10?.length > 0 && !screenLoading && (
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {filteredTop10.length === screenerData.top10.length
                    ? `${filteredTop10.length} top puts`
                    : `${filteredTop10.length} of ${screenerData.top10.length} top puts`}
                </span>
              )}
            </div>
          )}

          {/* Top 10 Picks — filtered by DTE */}
          {filteredTop10.length > 0 && !screenLoading && (
            <Top10Puts puts={filteredTop10} />
          )}

          {/* iTransformer Forecasts for top stocks */}
          {Object.keys(screenerForecasts).length > 0 && !screenLoading && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-400">
                iTransformer Price Forecasts (Top Stocks)
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {Object.entries(screenerForecasts).map(([sym, fc]: [string, any]) => {
                  const historicalPrices = fc._historicalPrices;
                  if (historicalPrices && fc.predicted_prices?.length > 0) {
                    return (
                      <TimeSeriesChart
                        key={sym}
                        historicalPrices={historicalPrices}
                        predictedPrices={fc.predicted_prices}
                        currentPrice={fc.current_price}
                        symbol={sym}
                        confidence={fc.confidence}
                      />
                    );
                  }
                  return (
                    <div key={sym}>
                      <StockForecast forecast={fc} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Decision Assistant for top stocks */}
          {screenerData?.results?.length > 0 && !screenLoading && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-400">
                Decision Checklist (Top {Math.min(5, screenerData.results.length)} Stocks)
              </h3>
              {screenerData.results.slice(0, 5).map((stock: ScreenerData) => (
                <PutDecisionAssistant
                  key={stock.symbol}
                  data={{
                    symbol: stock.symbol,
                    price: stock.quote?.price ?? 0,
                    ivRank: stock.ivRank ?? 50,
                    beta: stock.quote?.beta ?? 1,
                    marketCap: stock.quote?.marketCap ?? 0,
                    dividendYield: stock.quote?.dividendYield ?? 0,
                    stabilityScore: stock.stability?.score ?? 50,
                    vix: screenerData.marketRegime?.vix ?? 20,
                    context: stock.context ?? null,
                    trailingPE: stock.quote?.trailingPE,
                    fiftyTwoWeekLow: stock.quote?.fiftyTwoWeekLow,
                    fiftyTwoWeekHigh: stock.quote?.fiftyTwoWeekHigh,
                    volume: stock.quote?.volume,
                    avgVolume: stock.quote?.avgVolume,
                  }}
                />
              ))}
            </div>
          )}

          {/* Full Results — filtered by DTE */}
          <ScreenerResults
            results={screenLoading ? (screenerData?.results ?? []) : filteredScreenerResults}
            loading={screenLoading}
            progress={screenProgress}
            onAnalyze={analyzeSymbol}
            globalVix={screenerData?.marketRegime?.vix ?? 20}
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
            Search for a stock to analyze with price prediction and decision assistance,
            or run the screener to find the Top 10 most profitable put selling candidates across 80+ stocks.
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
            Screen 80+ Stocks for Top 10 Put Sales
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

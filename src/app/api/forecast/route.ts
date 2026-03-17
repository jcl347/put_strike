import { NextRequest, NextResponse } from "next/server";
import {
  computeITransformerFeatures,
  normalizeFeatures,
  SECTOR_ETF_MAP,
  INDUSTRY_COMMODITY_MAP,
  STOCK_SPECIFIC_DRIVERS,
  type OHLCV,
  type MacroData,
} from "@/lib/itransformer-features";
import { fetchFredMacroData, type FredMacroData } from "@/lib/fred";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Forecast feature endpoint.
 * Computes the 154 iTransformer features from OHLCV + macro + sector/credit +
 * gamma squeeze + sentiment + stock-specific driver data, normalizes them using
 * per-stock stats from HuggingFace model config, and returns a ready-to-use
 * feature matrix for client-side ONNX inference.
 *
 * GET /api/forecast?symbol=AAPL
 */
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
  }

  const upperSymbol = symbol.toUpperCase();

  // Determine per-stock sector ETF, industry commodity, and stock-specific drivers
  const sectorEtfSymbol = SECTOR_ETF_MAP[upperSymbol];
  const industryCommoditySymbol = INDUSTRY_COMMODITY_MAP[upperSymbol];
  const stockDrivers = STOCK_SPECIFIC_DRIVERS[upperSymbol];

  try {
    // Fetch OHLCV (1 year) + macro data + FRED data in parallel
    const [ohlcv, rawMacro, fredData] = await Promise.all([
      fetchOHLCV(upperSymbol, 1),
      fetchMacroDataWithDates(sectorEtfSymbol, industryCommoditySymbol, stockDrivers),
      fetchFredMacroData(),
    ]);

    if (ohlcv.length < 70) {
      return NextResponse.json(
        { error: `Insufficient history: ${ohlcv.length} days (need 70+)` },
        { status: 400 }
      );
    }

    // Align macro data to stock dates using forward-fill
    // This matches the Python training: macro_df.reindex(df.index, method="ffill")
    const stockDates = ohlcv.map(d => d.date);
    const macroData = alignMacroToStockDates(rawMacro, stockDates, fredData);

    // Compute 154 features for all available days
    const rawFeatures = computeITransformerFeatures(ohlcv, macroData);

    // Fetch normalization stats from HuggingFace model config
    const normStats = await fetchNormStats(upperSymbol);

    // Normalize and take last 60 days
    let featureMatrix: number[][];
    if (normStats) {
      featureMatrix = normalizeFeatures(rawFeatures, normStats.mean, normStats.std);
    } else {
      // Fallback: z-score normalize using the window's own stats
      const numFeatures = rawFeatures[0]?.length ?? 126;
      const mean = new Array(numFeatures).fill(0);
      const std = new Array(numFeatures).fill(0);
      for (let j = 0; j < numFeatures; j++) {
        const vals = rawFeatures.map(r => r[j]);
        mean[j] = vals.reduce((a, b) => a + b, 0) / vals.length;
        std[j] = Math.sqrt(vals.reduce((a, b) => a + (b - mean[j]) ** 2, 0) / vals.length) + 1e-10;
      }
      featureMatrix = normalizeFeatures(rawFeatures, mean, std);
    }

    // Take last 60 rows (model lookback)
    const last60 = featureMatrix.slice(-60);

    // Also return the last 60 days of OHLCV for the chart (historical context)
    const historicalOHLCV = ohlcv.slice(-60).map(d => ({
      date: d.date,
      close: d.close,
    }));

    return NextResponse.json({
      symbol: upperSymbol,
      featureMatrix: last60,
      historicalPrices: historicalOHLCV,
      currentPrice: ohlcv[ohlcv.length - 1].close,
      hasNormStats: !!normStats,
      dataPoints: ohlcv.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forecast failed";
    console.error(`[/api/forecast] ${upperSymbol} error:`, message);
    return NextResponse.json({ error: message, symbol: upperSymbol }, { status: 500 });
  }
}

// ── Data fetching helpers ──

async function fetchOHLCV(symbol: string, years: number): Promise<OHLCV[]> {
  const YahooFinanceModule = (await import("yahoo-finance2")).default;
  let yahooFinance: any;
  try {
    yahooFinance = new (YahooFinanceModule as any)({ suppressNotices: ["yahooSurvey"] });
  } catch {
    const Ctor = (YahooFinanceModule as any)?.default ?? YahooFinanceModule;
    yahooFinance = new Ctor({ suppressNotices: ["yahooSurvey"] });
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - years);

  const history: any = await yahooFinance.chart(symbol, {
    period1: startDate,
    period2: endDate,
    interval: "1d",
  });

  return (history.quotes ?? [])
    .filter((q: any) => q.close > 0 && q.high > 0 && q.low > 0)
    .map((q: any) => ({
      date: new Date(q.date).toISOString().split("T")[0],
      open: q.open ?? q.close,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume ?? 0,
    }));
}

/**
 * Raw macro data keyed by date string for alignment.
 */
interface RawMacroData {
  vix?: Record<string, number>;
  vix3m?: Record<string, number>;
  tnx?: Record<string, number>;
  dxy?: Record<string, number>;
  gold?: Record<string, number>;
  oil?: Record<string, number>;
  spy?: Record<string, number>;
  sectorEtf?: Record<string, number>;
  hyg?: Record<string, number>;
  tlt?: Record<string, number>;
  vix9d?: Record<string, number>;
  industryCommodity?: Record<string, number>;
  copper?: Record<string, number>;
  btc?: Record<string, number>;
  // v8.0: market breadth + stock-specific drivers
  qqq?: Record<string, number>;
  iwm?: Record<string, number>;
  sox?: Record<string, number>;
  xbi?: Record<string, number>;
  stockDriver1?: Record<string, number>;
  stockDriver2?: Record<string, number>;
  // v9.0: tail risk & style rotation
  skew?: Record<string, number>;
  iwf?: Record<string, number>;
  iwd?: Record<string, number>;
  xly?: Record<string, number>;
  xlp?: Record<string, number>;
}

/**
 * Fetch macro data with date keys (not raw arrays).
 * This allows proper date alignment with any stock's trading days.
 * Optionally fetches per-stock sector ETF, industry commodity, and stock-specific drivers.
 */
async function fetchMacroDataWithDates(
  sectorEtfSymbol?: string,
  industryCommoditySymbol?: string,
  stockDrivers?: [string, string]
): Promise<RawMacroData> {
  const YahooFinanceModule = (await import("yahoo-finance2")).default;
  let yahooFinance: any;
  try {
    yahooFinance = new (YahooFinanceModule as any)({ suppressNotices: ["yahooSurvey"] });
  } catch {
    const Ctor = (YahooFinanceModule as any)?.default ?? YahooFinanceModule;
    yahooFinance = new Ctor({ suppressNotices: ["yahooSurvey"] });
  }

  const tickers: { symbol: string; key: string }[] = [
    { symbol: "^VIX", key: "vix" },
    { symbol: "^VIX3M", key: "vix3m" },
    { symbol: "^TNX", key: "tnx" },
    { symbol: "DX-Y.NYB", key: "dxy" },
    { symbol: "GC=F", key: "gold" },
    { symbol: "CL=F", key: "oil" },
    { symbol: "SPY", key: "spy" },
    { symbol: "HYG", key: "hyg" },
    { symbol: "TLT", key: "tlt" },
    { symbol: "^VIX9D", key: "vix9d" },
    { symbol: "HG=F", key: "copper" },
    { symbol: "BTC-USD", key: "btc" },
    // v8.0: market breadth & rotation tickers
    { symbol: "QQQ", key: "qqq" },
    { symbol: "IWM", key: "iwm" },
    { symbol: "^SOX", key: "sox" },
    { symbol: "XBI", key: "xbi" },
    // v9.0: tail risk & style rotation tickers
    { symbol: "^SKEW", key: "skew" },
    { symbol: "IWF", key: "iwf" },
    { symbol: "IWD", key: "iwd" },
    { symbol: "XLY", key: "xly" },
    { symbol: "XLP", key: "xlp" },
  ];

  // Add per-stock sector ETF if mapped (avoid duplicates with SPY)
  if (sectorEtfSymbol && sectorEtfSymbol !== "SPY") {
    tickers.push({ symbol: sectorEtfSymbol, key: "sectorEtf" });
  }

  // Add per-stock industry commodity if mapped (avoid duplicates)
  if (industryCommoditySymbol) {
    const existingSymbols = tickers.map(t => t.symbol);
    if (!existingSymbols.includes(industryCommoditySymbol)) {
      tickers.push({ symbol: industryCommoditySymbol, key: "industryCommodity" });
    } else {
      tickers.push({ symbol: industryCommoditySymbol, key: "industryCommodity" });
    }
  }

  // Add stock-specific driver tickers (v8.0)
  if (stockDrivers) {
    const existingSymbols = tickers.map(t => t.symbol);
    const [driver1Sym, driver2Sym] = stockDrivers;
    if (!existingSymbols.includes(driver1Sym)) {
      tickers.push({ symbol: driver1Sym, key: "stockDriver1" });
    } else {
      // Driver already in base tickers — duplicate with driver key
      tickers.push({ symbol: driver1Sym, key: "stockDriver1" });
    }
    if (!existingSymbols.includes(driver2Sym)) {
      tickers.push({ symbol: driver2Sym, key: "stockDriver2" });
    } else {
      tickers.push({ symbol: driver2Sym, key: "stockDriver2" });
    }
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 1);

  const macro: RawMacroData = {};

  const results = await Promise.allSettled(
    tickers.map(async ({ symbol, key }) => {
      const history: any = await yahooFinance.chart(symbol, {
        period1: startDate,
        period2: endDate,
        interval: "1d",
      });
      const dateMap: Record<string, number> = {};
      for (const q of (history.quotes ?? [])) {
        if (q.close > 0) {
          const dateStr = new Date(q.date).toISOString().split("T")[0];
          dateMap[dateStr] = q.close;
        }
      }
      return { key, dateMap };
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      (macro as any)[r.value.key] = r.value.dateMap;
    }
  }

  return macro;
}

/**
 * Align macro data to stock trading dates using forward-fill.
 * Matches Python: macro_df["^VIX"].reindex(df.index, method="ffill")
 *
 * For each stock date, look up the macro value for that date.
 * If not available, use the most recent prior value (forward-fill).
 */
function alignMacroToStockDates(
  rawMacro: RawMacroData,
  stockDates: string[],
  fredData?: FredMacroData
): MacroData {
  const aligned: MacroData = {};

  function forwardFillAlign(dateMap: Record<string, number> | undefined): number[] | undefined {
    if (!dateMap) return undefined;
    const result: number[] = [];
    let lastValue = 0;

    // Get all macro dates sorted for forward-fill lookup
    const macroDates = Object.keys(dateMap).sort();
    let macroIdx = 0;

    for (const stockDate of stockDates) {
      // Advance macroIdx to find the most recent macro date <= stockDate
      while (macroIdx < macroDates.length - 1 && macroDates[macroIdx + 1] <= stockDate) {
        macroIdx++;
      }
      // Use the macro value if date is <= stockDate
      if (macroIdx < macroDates.length && macroDates[macroIdx] <= stockDate) {
        lastValue = dateMap[macroDates[macroIdx]];
      }
      result.push(lastValue);
    }
    return result;
  }

  aligned.vix = forwardFillAlign(rawMacro.vix);
  aligned.vix3m = forwardFillAlign(rawMacro.vix3m);
  aligned.tnx = forwardFillAlign(rawMacro.tnx);
  aligned.dxy = forwardFillAlign(rawMacro.dxy);
  aligned.gold = forwardFillAlign(rawMacro.gold);
  aligned.oil = forwardFillAlign(rawMacro.oil);
  aligned.spy = forwardFillAlign(rawMacro.spy);
  aligned.sectorEtf = forwardFillAlign(rawMacro.sectorEtf ?? rawMacro.spy); // fallback to SPY
  aligned.hyg = forwardFillAlign(rawMacro.hyg);
  aligned.tlt = forwardFillAlign(rawMacro.tlt);
  aligned.vix9d = forwardFillAlign(rawMacro.vix9d);
  aligned.industryCommodity = forwardFillAlign(rawMacro.industryCommodity);
  aligned.copper = forwardFillAlign(rawMacro.copper);
  aligned.btc = forwardFillAlign(rawMacro.btc);
  // v8.0: market breadth + stock-specific drivers
  aligned.qqq = forwardFillAlign(rawMacro.qqq);
  aligned.iwm = forwardFillAlign(rawMacro.iwm);
  aligned.sox = forwardFillAlign(rawMacro.sox);
  aligned.xbi = forwardFillAlign(rawMacro.xbi);
  aligned.stockDriver1 = forwardFillAlign(rawMacro.stockDriver1);
  aligned.stockDriver2 = forwardFillAlign(rawMacro.stockDriver2);
  // v9.0: tail risk & style rotation
  aligned.skew = forwardFillAlign(rawMacro.skew);
  aligned.iwf = forwardFillAlign(rawMacro.iwf);
  aligned.iwd = forwardFillAlign(rawMacro.iwd);
  aligned.xly = forwardFillAlign(rawMacro.xly);
  aligned.xlp = forwardFillAlign(rawMacro.xlp);

  // FRED macro data alignment
  if (fredData) {
    aligned.fredHySpread = forwardFillAlign(fredData.hySpread);
    aligned.fredYieldCurve = forwardFillAlign(fredData.yieldCurve);
    aligned.fredBreakeven = forwardFillAlign(fredData.breakeven);
    aligned.fredTreasury2y = forwardFillAlign(fredData.treasury2y);
    aligned.fredJoblessClaims = forwardFillAlign(fredData.joblessClaims);
    aligned.fredConsumerSentiment = forwardFillAlign(fredData.consumerSentiment);
    aligned.fredFinancialStress = forwardFillAlign(fredData.financialStress);
    aligned.fredT10y3mSpread = forwardFillAlign(fredData.t10y3mSpread);
    aligned.fredFedFundsRate = forwardFillAlign(fredData.fedFundsRate);
    aligned.fredJpyUsd = forwardFillAlign(fredData.jpyUsd);
  }

  return aligned;
}

// Model config cache (avoid fetching on every request)
let cachedNormStats: Record<string, { mean: number[]; std: number[] }> | null = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchNormStats(
  symbol: string
): Promise<{ mean: number[]; std: number[] } | null> {
  const now = Date.now();
  if (cachedNormStats && now - cacheTime < CACHE_TTL) {
    return cachedNormStats[symbol] ?? getAggregateStats(cachedNormStats);
  }

  try {
    const repoId = process.env.NEXT_PUBLIC_HF_REPO_ID || "jcl347/putstrike";
    const res = await fetch(
      `https://huggingface.co/${repoId}/resolve/main/model_config.json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;

    const config = await res.json();
    cachedNormStats = config.normalization_stats ?? {};
    cacheTime = now;
    return cachedNormStats![symbol] ?? getAggregateStats(cachedNormStats!);
  } catch {
    return null;
  }
}

function getAggregateStats(
  stats: Record<string, { mean: number[]; std: number[] }>
): { mean: number[]; std: number[] } | null {
  const all = Object.values(stats);
  if (all.length === 0) return null;
  const numFeatures = all[0].mean.length;
  const mean = new Array(numFeatures).fill(0);
  const std = new Array(numFeatures).fill(0);
  for (const s of all) {
    for (let i = 0; i < numFeatures; i++) {
      mean[i] += s.mean[i] / all.length;
      std[i] += s.std[i] / all.length;
    }
  }
  return { mean, std };
}

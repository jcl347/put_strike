import { NextRequest, NextResponse } from "next/server";
import {
  computeITransformerFeatures,
  normalizeFeatures,
  type OHLCV,
  type MacroData,
} from "@/lib/itransformer-features";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Forecast feature endpoint.
 * Computes the 83 iTransformer features from OHLCV + macro data,
 * normalizes them using per-stock stats from HuggingFace model config,
 * and returns a ready-to-use feature matrix for client-side ONNX inference.
 *
 * GET /api/forecast?symbol=AAPL
 */
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
  }

  const upperSymbol = symbol.toUpperCase();

  try {
    // Fetch OHLCV (1 year) + macro data in parallel
    const [ohlcv, macroData] = await Promise.all([
      fetchOHLCV(upperSymbol, 1),
      fetchMacroData(),
    ]);

    if (ohlcv.length < 70) {
      return NextResponse.json(
        { error: `Insufficient history: ${ohlcv.length} days (need 70+)` },
        { status: 400 }
      );
    }

    // Compute 83 features for all available days
    const rawFeatures = computeITransformerFeatures(ohlcv, macroData);

    // Fetch normalization stats from HuggingFace model config
    const normStats = await fetchNormStats(upperSymbol);

    // Normalize and take last 60 days
    let featureMatrix: number[][];
    if (normStats) {
      featureMatrix = normalizeFeatures(rawFeatures, normStats.mean, normStats.std);
    } else {
      // Fallback: z-score normalize using the window's own stats
      const numFeatures = 83;
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

async function fetchMacroData(): Promise<MacroData> {
  const YahooFinanceModule = (await import("yahoo-finance2")).default;
  let yahooFinance: any;
  try {
    yahooFinance = new (YahooFinanceModule as any)({ suppressNotices: ["yahooSurvey"] });
  } catch {
    const Ctor = (YahooFinanceModule as any)?.default ?? YahooFinanceModule;
    yahooFinance = new Ctor({ suppressNotices: ["yahooSurvey"] });
  }

  const tickers = [
    { symbol: "^VIX", key: "vix" },
    { symbol: "^VIX3M", key: "vix3m" },
    { symbol: "^TNX", key: "tnx" },
    { symbol: "DX-Y.NYB", key: "dxy" },
    { symbol: "GC=F", key: "gold" },
    { symbol: "CL=F", key: "oil" },
  ];

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 1);

  const macro: MacroData = {};

  // Fetch in parallel, but don't fail if some are unavailable
  const results = await Promise.allSettled(
    tickers.map(async ({ symbol, key }) => {
      const history: any = await yahooFinance.chart(symbol, {
        period1: startDate,
        period2: endDate,
        interval: "1d",
      });
      const closes = (history.quotes ?? [])
        .filter((q: any) => q.close > 0)
        .map((q: any) => q.close as number);
      return { key, closes };
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      (macro as any)[r.value.key] = r.value.closes;
    }
  }

  return macro;
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

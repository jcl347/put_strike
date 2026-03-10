import { NextRequest, NextResponse } from "next/server";
import {
  getStockQuote,
  getHistoricalVolatility,
  getVIX,
  getStockContext,
  getOptionsChain,
} from "@/lib/yahoo-finance";
import {
  computeFeatures,
  type OHLCV,
  type OptionsSnapshot,
  type MarketData,
  type FundamentalData,
} from "@/lib/features";
import { generatePrediction } from "@/lib/prediction";
import { runHFInference, getNormStats } from "@/lib/hf-model";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Price prediction endpoint.
 * Computes 300+ features and runs ensemble prediction models.
 * Also runs iTransformer inference via HuggingFace ONNX model.
 * Falls back to Colab GPU if HF model unavailable and colab_url is configured.
 *
 * GET /api/predict?symbol=AAPL&colab_url=https://xxxx.ngrok.io
 */
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
  }

  // Optional: Colab inference server URL (from user settings)
  const colabUrl = request.nextUrl.searchParams.get("colab_url");

  const upperSymbol = symbol.toUpperCase();

  try {
    // Fetch all data sources in parallel
    const [quote, hv, vix, context, chain, historyResult] = await Promise.all([
      getStockQuote(upperSymbol),
      getHistoricalVolatility(upperSymbol),
      getVIX().catch(() => 20),
      getStockContext(upperSymbol, 0).catch(() => null),
      getOptionsChain(upperSymbol).catch(() => null),
      fetchHistoricalOHLCV(upperSymbol),
    ]);

    // Update context with actual price
    if (context) {
      context.supportLevel = context.supportLevel || quote.price * 0.93;
    }

    // Build options snapshot
    let optionsSnapshot: OptionsSnapshot | null = null;
    if (chain) {
      const puts = chain.options.filter(o => o.type === "put");
      const calls = chain.options.filter(o => o.type === "call");
      const totalPutVol = puts.reduce((a, p) => a + p.volume, 0);
      const totalCallVol = calls.reduce((a, c) => a + c.volume, 0);
      const totalPutOI = puts.reduce((a, p) => a + p.openInterest, 0);
      const totalCallOI = calls.reduce((a, c) => a + c.openInterest, 0);

      // ATM IV (closest strike to current price)
      const allOptions = [...puts, ...calls];
      const atm = allOptions
        .filter(o => o.impliedVolatility > 0)
        .sort((a, b) => Math.abs(a.strike - quote.price) - Math.abs(b.strike - quote.price))[0];

      optionsSnapshot = {
        putCallVolumeRatio: totalCallVol > 0 ? totalPutVol / totalCallVol : 1,
        putCallOIRatio: totalCallOI > 0 ? totalPutOI / totalCallOI : 1,
        atmIV: atm?.impliedVolatility ?? 0.25,
        ivSkew25d: 0, // Would need proper 25-delta strike identification
        ivTermSlope: 0,
        totalPutOI,
        totalCallOI,
        totalPutVolume: totalPutVol,
        totalCallVolume: totalCallVol,
        maxPainStrike: calculateMaxPain(chain.options, quote.price),
      };
    }

    // Build market data
    const marketData: MarketData = {
      vix,
      vixChange: 0, // Would need previous VIX
      spyReturn1d: 0,
      spyReturn5d: 0,
      spyReturn20d: 0,
    };

    // Build fundamentals
    const fundamentals: FundamentalData = {
      trailingPE: quote.trailingPE,
      dividendYield: quote.dividendYield,
      beta: quote.beta,
      marketCap: quote.marketCap,
    };

    // Compute feature vector
    const featureVector = computeFeatures(
      upperSymbol,
      historyResult,
      optionsSnapshot,
      marketData,
      fundamentals,
      context?.daysToEarnings ?? null,
    );

    // Generate statistical ensemble prediction (always runs)
    const prediction = generatePrediction(
      upperSymbol,
      quote.price,
      featureVector,
      hv.hvRank,
      context?.daysToEarnings ?? null,
      context?.trendDirection ?? "sideways",
    );

    // Try HuggingFace iTransformer inference (preferred — no Colab needed)
    let hfPrediction: any = null;
    let hfStatus: "connected" | "unavailable" | "not_configured" = "not_configured";

    try {
      // Build normalized feature matrix from OHLCV for HF model
      const normStats = getNormStats(upperSymbol);
      if (normStats && historyResult.length >= 60) {
        // Simple OHLCV-based feature matrix for the model
        // The model expects z-score normalized features
        const featureMatrix = historyResult.slice(-60).map((d, _i) => {
          // Basic features — the model handles feature computation internally
          const row = [d.close, d.high, d.low, d.open, d.volume];
          // Pad to match model's expected feature count using normalization stats
          while (row.length < normStats.mean.length) {
            row.push(0);
          }
          // Z-score normalize
          return row.map((v, j) => {
            const std = normStats.std[j] || 1;
            return Math.max(-5, Math.min(5, (v - normStats.mean[j]) / std));
          });
        });

        hfPrediction = await runHFInference(upperSymbol, quote.price, featureMatrix);
        hfStatus = hfPrediction ? "connected" : "unavailable";
      }
    } catch {
      hfStatus = "unavailable";
    }

    // Fallback: Try Colab iTransformer inference if URL is configured
    let colabPrediction: any = null;
    let colabStatus: "connected" | "unavailable" | "not_configured" = "not_configured";

    if (colabUrl && !hfPrediction) {
      try {
        // Send all available OHLCV data to Colab — it computes features server-side
        // The iTransformer server needs enough history for feature computation (200+ days ideal)
        // Send up to 300 days so the server can compute 200-day SMAs and other long-lookback features
        const colabPayload = {
          symbol: upperSymbol,
          current_price: quote.price,
          features: historyResult.slice(-300).map(d => [
            d.open, d.high, d.low, d.close, d.volume,
          ]),
        };

        const colabRes = await fetch(`${colabUrl}/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
          body: JSON.stringify(colabPayload),
          signal: AbortSignal.timeout(15000), // 15s timeout (feature computation takes time)
        });

        if (colabRes.ok) {
          colabPrediction = await colabRes.json();
          colabStatus = "connected";
        } else {
          colabStatus = "unavailable";
        }
      } catch {
        colabStatus = "unavailable";
      }
    }

    return NextResponse.json({
      ...prediction,
      featureCount: featureVector.metadata.featureCount,
      featureCategories: featureVector.metadata.categories,
      context,
      quote,
      hv,
      // iTransformer predictions (HuggingFace preferred, Colab fallback)
      hfPrediction,
      hfStatus,
      colabPrediction: hfPrediction ?? colabPrediction,
      colabStatus: hfPrediction ? hfStatus : colabStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prediction failed";
    console.error(`[/api/predict] ${upperSymbol} error:`, message);
    return NextResponse.json({ error: message, symbol: upperSymbol }, { status: 500 });
  }
}

// Helper to calculate max pain
function calculateMaxPain(
  options: { strike: number; type: string; openInterest: number }[],
  currentPrice: number
): number {
  const strikes = [...new Set(options.map(o => o.strike))].sort((a, b) => a - b);
  if (strikes.length === 0) return currentPrice;

  let minPain = Infinity;
  let maxPainStrike = currentPrice;

  for (const testStrike of strikes) {
    let totalPain = 0;
    for (const opt of options) {
      if (opt.type === "call" && testStrike > opt.strike) {
        totalPain += (testStrike - opt.strike) * opt.openInterest;
      } else if (opt.type === "put" && testStrike < opt.strike) {
        totalPain += (opt.strike - testStrike) * opt.openInterest;
      }
    }
    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = testStrike;
    }
  }

  return maxPainStrike;
}

// Helper to fetch OHLCV historical data
async function fetchHistoricalOHLCV(symbol: string): Promise<OHLCV[]> {
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
  startDate.setFullYear(startDate.getFullYear() - 1);

  try {
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
  } catch {
    return [];
  }
}

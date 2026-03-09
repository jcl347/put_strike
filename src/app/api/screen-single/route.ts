import { NextRequest, NextResponse } from "next/server";
import {
  getOptionsChain,
  getStockQuote,
  getHistoricalVolatility,
  getVIX,
  getStockContext,
} from "@/lib/yahoo-finance";
import { putGreeks } from "@/lib/black-scholes";
import {
  type PutCandidate,
  type CompanyStability,
  rankPuts,
  classifyMarketRegime,
  scoreCompanyStability,
} from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Lightweight single-stock screener endpoint.
 * Called by the frontend for each stock individually during screening.
 * Only fetches the first options chain (not multiple expirations like /api/analyze).
 *
 * Query params:
 *   symbol: stock ticker (required)
 *   vix: pre-fetched VIX value (optional, avoids redundant VIX fetches)
 */
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
  }

  const upperSymbol = symbol.toUpperCase();
  if (!/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(upperSymbol)) {
    return NextResponse.json({ error: "Invalid symbol format" }, { status: 400 });
  }

  // Use pre-fetched VIX if provided (avoids N redundant VIX fetches during screening)
  const vixParam = request.nextUrl.searchParams.get("vix");
  const preVix = vixParam ? parseFloat(vixParam) : null;

  try {
    // Fetch quote, options, HV, and VIX (if not provided) in parallel
    const promises: [
      Promise<Awaited<ReturnType<typeof getStockQuote>>>,
      Promise<Awaited<ReturnType<typeof getOptionsChain>>>,
      Promise<Awaited<ReturnType<typeof getHistoricalVolatility>>>,
      Promise<number>,
    ] = [
      getStockQuote(upperSymbol),
      getOptionsChain(upperSymbol),
      getHistoricalVolatility(upperSymbol),
      preVix != null && !isNaN(preVix)
        ? Promise.resolve(preVix)
        : getVIX().catch(() => 20),
    ];

    const [quote, chain, hv, vix] = await Promise.all(promises);
    const marketRegime = classifyMarketRegime(vix);

    // Fetch stock context (earnings, trend, support/resistance) in parallel
    // This is non-blocking — if it fails, we proceed without it
    let stockContext = null;
    try {
      stockContext = await getStockContext(upperSymbol, quote.price);
    } catch {
      // Non-critical — proceed without context
    }

    const puts = chain.options.filter((o) => o.type === "put");
    const riskFreeRate = 0.045;

    const companyStability: CompanyStability = {
      marketCap: quote.marketCap,
      beta: quote.beta,
      dividendYield: quote.dividendYield,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
      currentPrice: quote.price,
      trailingPE: quote.trailingPE,
    };

    const stabilityResult = scoreCompanyStability(companyStability);

    // Use lastPrice as fallback when bid is 0 (markets closed / after hours)
    const candidates: PutCandidate[] = puts
      .filter((p) => p.dte >= 14 && p.dte <= 75 && (p.bid > 0 || p.lastPrice > 0))
      .map((p) => {
        const effectiveBid = p.bid > 0 ? p.bid : p.lastPrice;
        const effectiveAsk = p.ask > 0 ? p.ask : p.lastPrice;
        const T = p.dte / 365;
        const greeks = putGreeks({
          S: quote.price,
          K: p.strike,
          T,
          r: riskFreeRate,
          sigma: p.impliedVolatility > 0 ? p.impliedVolatility : 0.3,
          q: (quote.dividendYield || 0) / 100,
        });

        return {
          symbol: upperSymbol,
          stockPrice: quote.price,
          strikePrice: p.strike,
          expiration: p.expiration,
          dte: p.dte,
          bid: effectiveBid,
          ask: effectiveAsk,
          lastPrice: p.lastPrice,
          volume: p.volume,
          openInterest: p.openInterest,
          impliedVolatility: p.impliedVolatility > 0 ? p.impliedVolatility * 100 : 30,
          delta: greeks.delta,
          gamma: greeks.gamma,
          theta: greeks.theta,
          vega: greeks.vega,
        };
      });

    const ivRank = hv.hvRank;
    const scored = rankPuts(candidates, ivRank, marketRegime, 8, companyStability);

    return NextResponse.json({
      symbol: upperSymbol,
      quote,
      ivRank,
      hv,
      stability: stabilityResult,
      topPuts: scored,
      marketRegime,
      vix,
      context: stockContext,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    console.error(`[/api/screen-single] ${upperSymbol} error:`, message);
    return NextResponse.json({ error: message, symbol: upperSymbol }, { status: 500 });
  }
}

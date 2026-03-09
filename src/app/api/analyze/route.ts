import { NextRequest, NextResponse } from "next/server";
import {
  getOptionsChain,
  getStockQuote,
  getHistoricalVolatility,
  getVIX,
} from "@/lib/yahoo-finance";
import { putGreeks } from "@/lib/black-scholes";
import {
  type PutCandidate,
  rankPuts,
  classifyMarketRegime,
} from "@/lib/scoring";

export const dynamic = "force-dynamic";

/**
 * Analyze a specific stock for put selling opportunities.
 * Returns detailed analysis with all expirations and scored puts.
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

  try {
    const [quote, hv, vix] = await Promise.all([
      getStockQuote(upperSymbol),
      getHistoricalVolatility(upperSymbol),
      getVIX(),
    ]);

    const marketRegime = classifyMarketRegime(vix);

    // Fetch options chain (default expiration first to get all dates)
    const initialChain = await getOptionsChain(upperSymbol);

    // Fetch chains for expirations in the 14-75 DTE window
    const now = new Date();
    const relevantExpirations = initialChain.expirationDates.filter((d) => {
      const dte = Math.ceil(
        (new Date(d).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      return dte >= 14 && dte <= 75;
    });

    // Fetch up to 4 expirations to avoid rate limiting
    const expirationsToFetch = relevantExpirations.slice(0, 4);

    const chainResults = await Promise.allSettled(
      expirationsToFetch.map((exp) => getOptionsChain(upperSymbol, exp))
    );

    const allPuts: PutCandidate[] = [];
    const riskFreeRate = 0.045;

    // Also include puts from initial chain
    const allChains = [initialChain];
    for (const result of chainResults) {
      if (result.status === "fulfilled") {
        allChains.push(result.value);
      }
    }

    // De-duplicate by strike+expiration
    const seen = new Set<string>();

    for (const chain of allChains) {
      const puts = chain.options.filter((o) => o.type === "put");

      for (const p of puts) {
        const key = `${p.strike}-${p.expiration}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (p.dte < 7 || p.dte > 90 || p.bid <= 0) continue;

        const T = p.dte / 365;
        const greeks = putGreeks({
          S: quote.price,
          K: p.strike,
          T,
          r: riskFreeRate,
          sigma: p.impliedVolatility > 0 ? p.impliedVolatility : 0.3,
          q: (quote.dividendYield || 0) / 100,
        });

        allPuts.push({
          symbol: upperSymbol,
          stockPrice: quote.price,
          strikePrice: p.strike,
          expiration: p.expiration,
          dte: p.dte,
          bid: p.bid,
          ask: p.ask,
          lastPrice: p.lastPrice,
          volume: p.volume,
          openInterest: p.openInterest,
          impliedVolatility:
            p.impliedVolatility > 0 ? p.impliedVolatility * 100 : 30,
          delta: greeks.delta,
          gamma: greeks.gamma,
          theta: greeks.theta,
          vega: greeks.vega,
        });
      }
    }

    const scored = rankPuts(allPuts, hv.hvRank, marketRegime, 30);

    // Group by expiration for the UI
    const byExpiration: Record<string, typeof scored> = {};
    for (const s of scored) {
      if (!byExpiration[s.expiration]) byExpiration[s.expiration] = [];
      byExpiration[s.expiration].push(s);
    }

    return NextResponse.json({
      symbol: upperSymbol,
      quote,
      historicalVolatility: hv,
      marketRegime,
      expirationDates: initialChain.expirationDates,
      scoredPuts: scored,
      putsByExpiration: byExpiration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

// Default watchlist of liquid, fundamentally strong stocks suitable for CSP
const DEFAULT_SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META",
  "NVDA", "JPM", "V", "JNJ", "PG",
  "KO", "PEP", "WMT", "HD", "DIS",
  "SPY", "QQQ", "IWM",
];

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_SYMBOLS;

  // Limit to 20 symbols to avoid rate limiting
  const selectedSymbols = symbols.slice(0, 20);

  try {
    const vix = await getVIX();
    const marketRegime = classifyMarketRegime(vix);

    const results = await Promise.allSettled(
      selectedSymbols.map(async (symbol) => {
        const [chain, quote, hv] = await Promise.all([
          getOptionsChain(symbol),
          getStockQuote(symbol),
          getHistoricalVolatility(symbol),
        ]);

        const puts = chain.options.filter((o) => o.type === "put");
        const riskFreeRate = 0.045; // approximate current risk-free rate

        // Build candidates with computed Greeks
        const candidates: PutCandidate[] = puts
          .filter((p) => p.dte >= 14 && p.dte <= 75 && p.bid > 0)
          .map((p) => {
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
              symbol,
              stockPrice: quote.price,
              strikePrice: p.strike,
              expiration: p.expiration,
              dte: p.dte,
              bid: p.bid,
              ask: p.ask,
              lastPrice: p.lastPrice,
              volume: p.volume,
              openInterest: p.openInterest,
              impliedVolatility: p.impliedVolatility > 0 ? p.impliedVolatility * 100 : greeks.vega > 0 ? 30 : 0,
              delta: greeks.delta,
              gamma: greeks.gamma,
              theta: greeks.theta,
              vega: greeks.vega,
            };
          });

        const ivRank = hv.hvRank;
        const scored = rankPuts(candidates, ivRank, marketRegime, 5);

        return {
          symbol,
          quote,
          ivRank,
          hv,
          topPuts: scored,
        };
      })
    );

    const successful = results
      .filter(
        (r): r is PromiseFulfilledResult<{
          symbol: string;
          quote: Awaited<ReturnType<typeof getStockQuote>>;
          ivRank: number;
          hv: Awaited<ReturnType<typeof getHistoricalVolatility>>;
          topPuts: ReturnType<typeof rankPuts>;
        }> => r.status === "fulfilled"
      )
      .map((r) => r.value)
      .filter((r) => r.topPuts.length > 0);

    // Sort by best overall opportunity (highest top score)
    successful.sort((a, b) => {
      const aTop = a.topPuts[0]?.score ?? 0;
      const bTop = b.topPuts[0]?.score ?? 0;
      return bTop - aTop;
    });

    return NextResponse.json({
      marketRegime,
      timestamp: new Date().toISOString(),
      results: successful,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Screening failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

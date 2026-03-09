import { NextRequest, NextResponse } from "next/server";
import {
  getOptionsChain,
  getStockQuote,
  getHistoricalVolatility,
  getVIX,
  batchProcess,
  type StockQuote,
} from "@/lib/yahoo-finance";
import { putGreeks } from "@/lib/black-scholes";
import {
  type PutCandidate,
  type CompanyStability,
  type ScoredPut,
  rankPuts,
  classifyMarketRegime,
  scoreCompanyStability,
} from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // allow up to 60s for Vercel

// Default watchlist: high-liquidity, fundamentally strong stocks for CSP
const DEFAULT_SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META",
  "NVDA", "JPM", "V", "JNJ", "PG",
  "KO", "PEP", "WMT", "HD", "DIS",
  "SPY", "QQQ", "IWM",
];

interface ScreenResult {
  symbol: string;
  quote: StockQuote;
  ivRank: number;
  hv: { currentHV: number; hvHigh: number; hvLow: number; hvRank: number };
  stability: { score: number; signals: { name: string; value: string; sentiment: string; weight: number }[] };
  topPuts: ScoredPut[];
}

export async function GET(request: NextRequest) {
  const symbolsParam = request.nextUrl.searchParams.get("symbols");
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_SYMBOLS;

  const selectedSymbols = symbols.slice(0, 20);

  try {
    const vix = await getVIX();
    const marketRegime = classifyMarketRegime(vix);

    // Process symbols in batches of 3 with 1s delay between batches
    // to avoid Yahoo Finance rate limiting (the old approach fired all 18 in parallel)
    const batchResults = await batchProcess<ScreenResult>(
      selectedSymbols,
      async (symbol) => {
        const [chain, quote, hv] = await Promise.all([
          getOptionsChain(symbol),
          getStockQuote(symbol),
          getHistoricalVolatility(symbol),
        ]);

        const puts = chain.options.filter((o) => o.type === "put");
        const riskFreeRate = 0.045;

        // Build company stability profile from quote data
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
              impliedVolatility: p.impliedVolatility > 0 ? p.impliedVolatility * 100 : 30,
              delta: greeks.delta,
              gamma: greeks.gamma,
              theta: greeks.theta,
              vega: greeks.vega,
            };
          });

        const ivRank = hv.hvRank;
        const scored = rankPuts(candidates, ivRank, marketRegime, 5, companyStability);

        return {
          symbol,
          quote,
          ivRank,
          hv,
          stability: stabilityResult,
          topPuts: scored,
        };
      },
      3,   // batch size
      1000 // delay between batches (ms)
    );

    const successful = batchResults
      .filter((r) => r.result !== null && r.result.topPuts.length > 0)
      .map((r) => r.result!);

    // Sort by best overall opportunity (highest top score)
    successful.sort((a, b) => {
      const aTop = a.topPuts[0]?.score ?? 0;
      const bTop = b.topPuts[0]?.score ?? 0;
      return bTop - aTop;
    });

    // Build global Top 10 picks across all stocks
    const allScoredPuts: (ScoredPut & { stabilityScore: number; companyName: string })[] = [];
    for (const stock of successful) {
      for (const put of stock.topPuts) {
        allScoredPuts.push({
          ...put,
          stabilityScore: stock.stability.score,
          companyName: stock.quote.name,
        });
      }
    }
    allScoredPuts.sort((a, b) => b.score - a.score);
    const top10 = allScoredPuts.slice(0, 10);

    return NextResponse.json({
      marketRegime,
      timestamp: new Date().toISOString(),
      top10,
      results: successful,
      failedSymbols: batchResults
        .filter((r) => r.result === null)
        .map((r) => ({ symbol: r.symbol, error: r.error })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Screening failed";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[/api/screen] Error:", message, stack);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

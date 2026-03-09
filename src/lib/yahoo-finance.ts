/**
 * Yahoo Finance Data Provider
 *
 * Wraps yahoo-finance2 to fetch:
 * - Stock quotes (price, volume, market cap)
 * - Options chains (all expirations, strikes, greeks)
 * - Historical data (for IV rank calculation)
 *
 * yahoo-finance2 is the most established free JS library for options data.
 * It's community-maintained and has been working since 2013.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import yahooFinance from "yahoo-finance2";

export interface StockQuote {
  symbol: string;
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
  name: string;
}

export interface OptionsChainData {
  expirationDates: string[];
  options: OptionContract[];
  underlyingPrice: number;
}

export interface OptionContract {
  strike: number;
  expiration: string;
  dte: number;
  type: "put" | "call";
  bid: number;
  ask: number;
  lastPrice: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
}

export async function getStockQuote(symbol: string): Promise<StockQuote> {
  const quote: any = await yahooFinance.quote(symbol);

  return {
    symbol: quote.symbol ?? symbol,
    price: quote.regularMarketPrice ?? 0,
    previousClose: quote.regularMarketPreviousClose ?? 0,
    change: quote.regularMarketChange ?? 0,
    changePercent: quote.regularMarketChangePercent ?? 0,
    volume: quote.regularMarketVolume ?? 0,
    avgVolume: quote.averageDailyVolume3Month ?? 0,
    marketCap: quote.marketCap ?? 0,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? 0,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? 0,
    dividendYield: quote.dividendYield ?? 0,
    name: quote.shortName ?? quote.longName ?? symbol,
  };
}

export async function getOptionsChain(
  symbol: string,
  expirationDate?: string
): Promise<OptionsChainData> {
  const result: any = await yahooFinance.options(
    symbol,
    expirationDate ? { date: new Date(expirationDate) } : {}
  );

  const now = new Date();
  const options: OptionContract[] = [];

  function processContracts(contracts: any[], type: "put" | "call") {
    if (!contracts) return;
    for (const c of contracts) {
      const expDate = c.expiration ? new Date(c.expiration) : null;
      const dte = expDate
        ? Math.ceil(
            (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          )
        : 0;

      options.push({
        strike: c.strike ?? 0,
        expiration: expDate?.toISOString().split("T")[0] ?? "",
        dte,
        type,
        bid: c.bid ?? 0,
        ask: c.ask ?? 0,
        lastPrice: c.lastPrice ?? 0,
        volume: c.volume ?? 0,
        openInterest: c.openInterest ?? 0,
        impliedVolatility: c.impliedVolatility ?? 0,
      });
    }
  }

  if (result.options?.[0]) {
    processContracts(result.options[0].puts, "put");
    processContracts(result.options[0].calls, "call");
  }

  const expirationDates = result.expirationDates
    ? result.expirationDates.map((d: any) =>
        new Date(d).toISOString().split("T")[0]
      )
    : [];

  return {
    expirationDates,
    options,
    underlyingPrice: result.quote?.regularMarketPrice ?? 0,
  };
}

/**
 * Fetch historical price data for HV Rank calculation.
 * HV Rank = (Current HV - 52wk Low HV) / (52wk High HV - 52wk Low HV) * 100
 *
 * We use 20-day rolling historical volatility as a proxy for IV rank,
 * since true IV rank requires historical IV data that isn't freely available.
 */
export async function getHistoricalVolatility(
  symbol: string,
  period: "3mo" | "6mo" | "1y" = "1y"
): Promise<{
  currentHV: number;
  hvHigh: number;
  hvLow: number;
  hvRank: number;
}> {
  const endDate = new Date();
  const startDate = new Date();
  if (period === "3mo") startDate.setMonth(startDate.getMonth() - 3);
  else if (period === "6mo") startDate.setMonth(startDate.getMonth() - 6);
  else startDate.setFullYear(startDate.getFullYear() - 1);

  const history: any = await yahooFinance.chart(symbol, {
    period1: startDate,
    period2: endDate,
    interval: "1d",
  });

  const quotes = history.quotes ?? [];
  if (quotes.length < 22) {
    return { currentHV: 0, hvHigh: 0, hvLow: 0, hvRank: 50 };
  }

  // Calculate rolling 20-day historical volatility
  const logReturns: number[] = [];
  for (let i = 1; i < quotes.length; i++) {
    const prev = quotes[i - 1].close;
    const curr = quotes[i].close;
    if (prev && curr && prev > 0 && curr > 0) {
      logReturns.push(Math.log(curr / prev));
    }
  }

  const windowSize = 20;
  const hvValues: number[] = [];

  for (let i = windowSize; i <= logReturns.length; i++) {
    const slice = logReturns.slice(i - windowSize, i);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance =
      slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1);
    const dailyVol = Math.sqrt(variance);
    const annualizedVol = dailyVol * Math.sqrt(252);
    hvValues.push(annualizedVol);
  }

  if (hvValues.length === 0) {
    return { currentHV: 0, hvHigh: 0, hvLow: 0, hvRank: 50 };
  }

  const currentHV = hvValues[hvValues.length - 1];
  const hvHigh = Math.max(...hvValues);
  const hvLow = Math.min(...hvValues);

  const hvRank =
    hvHigh === hvLow ? 50 : ((currentHV - hvLow) / (hvHigh - hvLow)) * 100;

  return {
    currentHV: Math.round(currentHV * 10000) / 100,
    hvHigh: Math.round(hvHigh * 10000) / 100,
    hvLow: Math.round(hvLow * 10000) / 100,
    hvRank: Math.round(hvRank * 10) / 10,
  };
}

/**
 * Get VIX value for market regime detection.
 */
export async function getVIX(): Promise<number> {
  try {
    const quote: any = await yahooFinance.quote("^VIX");
    return quote.regularMarketPrice ?? 20;
  } catch {
    return 20; // default to normal
  }
}

/**
 * Search for stock symbols.
 */
export async function searchSymbols(
  query: string
): Promise<{ symbol: string; name: string; type: string }[]> {
  const results: any = await yahooFinance.search(query);

  return (results.quotes ?? [])
    .filter(
      (q: any) => q.quoteType === "EQUITY" || q.quoteType === "ETF"
    )
    .slice(0, 10)
    .map((q: any) => ({
      symbol: q.symbol ?? "",
      name: q.shortname ?? q.longname ?? "",
      type: q.quoteType ?? "EQUITY",
    }));
}

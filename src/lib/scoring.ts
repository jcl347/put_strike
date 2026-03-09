/**
 * Put Sale Scoring Engine
 *
 * Multi-factor scoring model based on research-validated criteria:
 *
 * OPTION-LEVEL FACTORS (the original 6):
 * 1. Premium Yield (annualized return on capital) — higher is better
 * 2. Delta (probability of assignment) — 0.15-0.30 optimal range
 * 3. DTE Quality — 30-45 DTE sweet spot per tastytrade research
 * 4. Liquidity (bid-ask spread, volume) — tighter spreads = better execution
 * 5. Distance OTM (margin of safety) — 5-15% below current price
 * 6. IV Rank / IV Percentile — higher = richer premiums for sellers
 *
 * COMPANY STABILITY FACTORS (new):
 * 7. Market Cap — large caps are more stable, less gap risk
 * 8. Beta — lower beta = less volatile = safer for put selling
 * 9. Dividend Yield — dividend payers tend to be more stable
 * 10. 52-Week Position — stocks near 52wk low have more downside risk
 *
 * References:
 * - tastytrade: 45 DTE, 16 delta, manage at 50% profit
 * - DataDrivenOptions: 20 delta short put optimal for theta
 * - Schwab/Barchart: IV Rank > 30 + IV Percentile > 50 for premium selling
 * - Spintwig SPY backtests: risk-adjusted returns matter more than absolute
 * - CBOE: lower-beta underlyings have higher put-selling win rates
 * - tastytrade: large-cap stocks reduce assignment gap risk
 */

export interface PutCandidate {
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
  gamma: number;
  theta: number;
  vega: number;
}

/**
 * Company-level stability metrics used to assess whether the underlying
 * is suitable for put selling (would you want to own this stock if assigned?).
 */
export interface CompanyStability {
  marketCap: number;
  beta: number;
  dividendYield: number;
  fiftyTwoWeekLow: number;
  fiftyTwoWeekHigh: number;
  currentPrice: number;
  trailingPE: number;
}

export interface ScoredPut extends PutCandidate {
  score: number;
  premiumYield: number;
  annualizedReturn: number;
  distanceOTM: number;
  bidAskSpread: number;
  stabilityScore: number;
  signals: Signal[];
  recommendation: "STRONG_SELL" | "SELL" | "NEUTRAL" | "AVOID";
}

export interface Signal {
  name: string;
  value: string;
  sentiment: "bullish" | "bearish" | "neutral";
  weight: number;
}

export interface MarketRegime {
  vix: number;
  regime: "LOW_VOL" | "NORMAL" | "HIGH_VOL" | "CRISIS";
  favorsPutSelling: boolean;
  description: string;
}

export function classifyMarketRegime(vix: number): MarketRegime {
  if (vix < 15) {
    return {
      vix,
      regime: "LOW_VOL",
      favorsPutSelling: true,
      description:
        "Low volatility environment. Premiums are thin but probability of profit is high. Smaller position sizes recommended.",
    };
  } else if (vix < 25) {
    return {
      vix,
      regime: "NORMAL",
      favorsPutSelling: true,
      description:
        "Normal volatility. Ideal environment for put selling — balanced premiums with reasonable probability of profit.",
    };
  } else if (vix < 35) {
    return {
      vix,
      regime: "HIGH_VOL",
      favorsPutSelling: true,
      description:
        "Elevated volatility. Rich premiums available but higher assignment risk. Use wider strikes (lower delta). Scale in gradually.",
    };
  } else {
    return {
      vix,
      regime: "CRISIS",
      favorsPutSelling: false,
      description:
        "Crisis-level volatility. Extremely high premiums but extreme tail risk. Wait for VIX to decline below 35 or use very small positions with far OTM strikes.",
    };
  }
}

/**
 * Score company stability for put selling suitability.
 * Returns 0-100 score and contributing signals.
 *
 * Key insight: when you sell a put, you're agreeing to BUY the stock.
 * So the underlying company must be one you'd want to own.
 *
 * Dimensions:
 * - Market Cap (30%): Large-cap = less gap risk, more liquidity
 * - Beta (30%): Low beta = less correlated drawdown risk
 * - 52-Week Position (25%): Where is price relative to range?
 * - Dividend Yield (15%): Dividends provide downside cushion
 */
export function scoreCompanyStability(
  stability: CompanyStability
): { score: number; signals: Signal[] } {
  const signals: Signal[] = [];

  // 1. Market Cap Score (30%)
  // Research: Large caps have smaller overnight gaps, more predictable pricing
  let capScore: number;
  const capB = stability.marketCap / 1e9; // in billions
  if (capB >= 200) capScore = 100; // mega cap
  else if (capB >= 50) capScore = 90; // large cap
  else if (capB >= 10) capScore = 70; // mid cap
  else if (capB >= 2) capScore = 40; // small cap
  else capScore = 15; // micro cap — dangerous for CSP

  let capLabel: string;
  if (capB >= 200) capLabel = "Mega Cap";
  else if (capB >= 50) capLabel = "Large Cap";
  else if (capB >= 10) capLabel = "Mid Cap";
  else if (capB >= 2) capLabel = "Small Cap";
  else capLabel = "Micro Cap";

  signals.push({
    name: "Market Cap",
    value: `$${capB.toFixed(0)}B (${capLabel})`,
    sentiment: capScore >= 70 ? "bullish" : capScore >= 40 ? "neutral" : "bearish",
    weight: 0.3,
  });

  // 2. Beta Score (30%)
  // Research: Beta < 1.0 means less volatile than market, ideal for put selling
  // CBOE data shows lower-beta underlyings have higher put-selling win rates
  let betaScore: number;
  if (stability.beta <= 0.8) betaScore = 100; // defensive
  else if (stability.beta <= 1.0) betaScore = 85; // market-like
  else if (stability.beta <= 1.3) betaScore = 60; // moderate growth
  else if (stability.beta <= 1.8) betaScore = 35; // aggressive
  else betaScore = 15; // very volatile

  signals.push({
    name: "Beta",
    value: `${stability.beta.toFixed(2)}`,
    sentiment: stability.beta <= 1.0 ? "bullish" : stability.beta <= 1.3 ? "neutral" : "bearish",
    weight: 0.3,
  });

  // 3. 52-Week Position Score (25%)
  // Stocks near 52wk lows have more downside risk; near highs = momentum support
  const range = stability.fiftyTwoWeekHigh - stability.fiftyTwoWeekLow;
  const position =
    range > 0
      ? ((stability.currentPrice - stability.fiftyTwoWeekLow) / range) * 100
      : 50;

  let positionScore: number;
  if (position >= 60 && position <= 90) positionScore = 100; // healthy uptrend
  else if (position >= 40 && position <= 95) positionScore = 70; // mid-range
  else if (position >= 20) positionScore = 40; // weak
  else positionScore = 15; // near 52wk low — high assignment risk

  signals.push({
    name: "52wk Position",
    value: `${position.toFixed(0)}% of range`,
    sentiment: position >= 50 ? "bullish" : position >= 30 ? "neutral" : "bearish",
    weight: 0.25,
  });

  // 4. Dividend Yield Score (15%)
  // Dividend-paying companies tend to be more stable, provide downside cushion
  let divScore: number;
  if (stability.dividendYield >= 2.5) divScore = 100;
  else if (stability.dividendYield >= 1.0) divScore = 80;
  else if (stability.dividendYield >= 0.5) divScore = 60;
  else if (stability.dividendYield > 0) divScore = 40;
  else divScore = 30; // no dividend isn't terrible, just less cushion

  signals.push({
    name: "Dividend",
    value:
      stability.dividendYield > 0
        ? `${stability.dividendYield.toFixed(2)}%`
        : "None",
    sentiment: stability.dividendYield >= 1.0 ? "bullish" : stability.dividendYield > 0 ? "neutral" : "bearish",
    weight: 0.15,
  });

  const score =
    capScore * 0.3 + betaScore * 0.3 + positionScore * 0.25 + divScore * 0.15;

  return { score: Math.round(score * 10) / 10, signals };
}

/**
 * Score a put option candidate using research-validated multi-factor model.
 *
 * Revised weights (now include stability):
 * - Premium yield: 20% (income driver)
 * - Delta quality: 15% (probability of profit)
 * - DTE quality: 12% (theta decay timing)
 * - Liquidity: 12% (execution quality)
 * - Distance OTM: 12% (margin of safety)
 * - IV environment: 9% (premium richness)
 * - Company stability: 20% (would you own this stock?)
 */
export function scorePut(
  candidate: PutCandidate,
  ivRank: number | null,
  marketRegime: MarketRegime,
  stability?: CompanyStability
): ScoredPut {
  const signals: Signal[] = [];

  // 1. Premium Yield (annualized return on collateral)
  // Use lastPrice as fallback when bid/ask are 0 (after hours / weekends)
  const midPrice = candidate.bid > 0 && candidate.ask > 0
    ? (candidate.bid + candidate.ask) / 2
    : candidate.lastPrice > 0
    ? candidate.lastPrice
    : (candidate.bid + candidate.ask) / 2;
  const premiumYield = (midPrice / candidate.strikePrice) * 100;
  const annualizedReturn = premiumYield * (365 / candidate.dte);

  let yieldScore: number;
  if (annualizedReturn >= 20) yieldScore = 100;
  else if (annualizedReturn >= 12) yieldScore = 80;
  else if (annualizedReturn >= 8) yieldScore = 60;
  else if (annualizedReturn >= 4) yieldScore = 40;
  else yieldScore = 20;

  signals.push({
    name: "Annualized Return",
    value: `${annualizedReturn.toFixed(1)}%`,
    sentiment: annualizedReturn >= 10 ? "bullish" : annualizedReturn >= 5 ? "neutral" : "bearish",
    weight: 0.2,
  });

  // 2. Delta Quality (0.15-0.30 is sweet spot)
  const absDelta = Math.abs(candidate.delta);
  let deltaScore: number;
  if (absDelta >= 0.15 && absDelta <= 0.30) deltaScore = 100;
  else if (absDelta >= 0.10 && absDelta <= 0.35) deltaScore = 75;
  else if (absDelta >= 0.05 && absDelta <= 0.45) deltaScore = 50;
  else deltaScore = 20;

  const probOTM = ((1 - absDelta) * 100).toFixed(0);
  signals.push({
    name: "Delta / P(OTM)",
    value: `${absDelta.toFixed(2)} / ${probOTM}%`,
    sentiment: absDelta >= 0.15 && absDelta <= 0.30 ? "bullish" : "neutral",
    weight: 0.15,
  });

  // 3. DTE Quality (30-45 optimal)
  let dteScore: number;
  if (candidate.dte >= 30 && candidate.dte <= 50) dteScore = 100;
  else if (candidate.dte >= 20 && candidate.dte <= 60) dteScore = 70;
  else if (candidate.dte >= 14 && candidate.dte <= 75) dteScore = 50;
  else dteScore = 25;

  signals.push({
    name: "Days to Expiration",
    value: `${candidate.dte} days`,
    sentiment: candidate.dte >= 30 && candidate.dte <= 50 ? "bullish" : "neutral",
    weight: 0.12,
  });

  // 4. Liquidity (bid-ask spread as % of mid, OI)
  const bidAskSpread = candidate.ask - candidate.bid;
  const spreadPct = midPrice > 0 ? (bidAskSpread / midPrice) * 100 : 100;

  let liquidityScore: number;
  if (spreadPct <= 5 && candidate.openInterest >= 500) liquidityScore = 100;
  else if (spreadPct <= 10 && candidate.openInterest >= 100) liquidityScore = 75;
  else if (spreadPct <= 20 && candidate.openInterest >= 50) liquidityScore = 50;
  else if (spreadPct <= 30) liquidityScore = 30;
  else liquidityScore = 10;

  signals.push({
    name: "Liquidity",
    value: `Spread: ${spreadPct.toFixed(1)}%, OI: ${candidate.openInterest}`,
    sentiment: liquidityScore >= 75 ? "bullish" : liquidityScore >= 50 ? "neutral" : "bearish",
    weight: 0.12,
  });

  // 5. Distance OTM (5-15% below current price ideal)
  const distanceOTM =
    ((candidate.stockPrice - candidate.strikePrice) / candidate.stockPrice) * 100;

  let distanceScore: number;
  if (distanceOTM >= 5 && distanceOTM <= 15) distanceScore = 100;
  else if (distanceOTM >= 3 && distanceOTM <= 20) distanceScore = 70;
  else if (distanceOTM >= 1 && distanceOTM <= 25) distanceScore = 40;
  else distanceScore = 15;

  signals.push({
    name: "Distance OTM",
    value: `${distanceOTM.toFixed(1)}%`,
    sentiment: distanceOTM >= 5 && distanceOTM <= 15 ? "bullish" : "neutral",
    weight: 0.12,
  });

  // 6. IV Rank (if available)
  let ivScore = 50;
  if (ivRank !== null) {
    if (ivRank >= 50) ivScore = 100;
    else if (ivRank >= 30) ivScore = 70;
    else ivScore = 30;

    signals.push({
      name: "IV Rank",
      value: `${ivRank.toFixed(0)}%`,
      sentiment: ivRank >= 50 ? "bullish" : ivRank >= 30 ? "neutral" : "bearish",
      weight: 0.09,
    });
  }

  // 7. Company Stability (if provided)
  let stabilityScore = 60; // neutral default when not provided
  if (stability) {
    const stabilityResult = scoreCompanyStability(stability);
    stabilityScore = stabilityResult.score;
    signals.push(...stabilityResult.signals);
  }

  // Weighted composite score
  const score = stability
    ? yieldScore * 0.20 +
      deltaScore * 0.15 +
      dteScore * 0.12 +
      liquidityScore * 0.12 +
      distanceScore * 0.12 +
      ivScore * 0.09 +
      stabilityScore * 0.20
    : // Original weights when no stability data available
      yieldScore * 0.25 +
      deltaScore * 0.20 +
      dteScore * 0.15 +
      liquidityScore * 0.15 +
      distanceScore * 0.15 +
      ivScore * 0.10;

  // Apply market regime modifier
  let adjustedScore = score;
  if (marketRegime.regime === "CRISIS") adjustedScore *= 0.6;
  else if (marketRegime.regime === "HIGH_VOL") adjustedScore *= 0.9;
  else if (marketRegime.regime === "NORMAL") adjustedScore *= 1.0;
  else adjustedScore *= 0.95;

  // Recommendation
  let recommendation: ScoredPut["recommendation"];
  if (adjustedScore >= 75) recommendation = "STRONG_SELL";
  else if (adjustedScore >= 55) recommendation = "SELL";
  else if (adjustedScore >= 40) recommendation = "NEUTRAL";
  else recommendation = "AVOID";

  return {
    ...candidate,
    score: Math.round(adjustedScore * 10) / 10,
    premiumYield,
    annualizedReturn,
    distanceOTM,
    bidAskSpread,
    stabilityScore,
    signals,
    recommendation,
  };
}

/**
 * Filter and rank put candidates by score.
 * Returns top N candidates sorted by score descending.
 */
export function rankPuts(
  candidates: PutCandidate[],
  ivRank: number | null,
  marketRegime: MarketRegime,
  topN: number = 20,
  stability?: CompanyStability
): ScoredPut[] {
  return candidates
    .map((c) => scorePut(c, ivRank, marketRegime, stability))
    .filter((s) => (s.bid > 0 || s.lastPrice > 0) && s.dte >= 7)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

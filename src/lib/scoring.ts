/**
 * Put Sale Scoring Engine
 *
 * Multi-factor scoring model based on research-validated criteria:
 *
 * 1. Premium Yield (annualized return on capital) — higher is better
 * 2. Delta (probability of assignment) — 0.15-0.30 optimal range
 * 3. IV Rank / IV Percentile — higher = more expensive premiums (good for sellers)
 * 4. Days to Expiration — 30-45 DTE sweet spot per tastytrade research
 * 5. Liquidity (bid-ask spread, volume) — tighter spreads = better execution
 * 6. Distance OTM (margin of safety) — 5-15% below current price
 * 7. Market Regime — VIX-based regime detection
 *
 * References:
 * - tastytrade: 45 DTE, 16 delta, manage at 50% profit
 * - DataDrivenOptions: 20 delta short put optimal for theta
 * - Schwab/Barchart: IV Rank > 30 + IV Percentile > 50 for premium selling
 * - Spintwig SPY backtests: risk-adjusted returns matter more than absolute
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

export interface ScoredPut extends PutCandidate {
  score: number;
  premiumYield: number;
  annualizedReturn: number;
  distanceOTM: number;
  bidAskSpread: number;
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
 * Score a put option candidate using research-validated multi-factor model.
 *
 * Weights derived from backtesting literature:
 * - Premium yield: 25% (primary income driver)
 * - Delta quality: 20% (probability of profit is key per tastytrade)
 * - DTE quality: 15% (45 DTE optimal per tastytrade research)
 * - Liquidity: 15% (execution quality matters for real returns)
 * - Distance OTM: 15% (margin of safety)
 * - IV environment: 10% (sell when IV is elevated)
 */
export function scorePut(
  candidate: PutCandidate,
  ivRank: number | null, // 0-100, null if unavailable
  marketRegime: MarketRegime
): ScoredPut {
  const signals: Signal[] = [];

  // 1. Premium Yield (annualized return on collateral)
  const midPrice = (candidate.bid + candidate.ask) / 2;
  const collateral = candidate.strikePrice * 100; // cash-secured
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
    weight: 0.25,
  });

  // 2. Delta Quality (0.15-0.30 is sweet spot)
  const absDelta = Math.abs(candidate.delta);
  let deltaScore: number;
  if (absDelta >= 0.15 && absDelta <= 0.30) deltaScore = 100; // sweet spot
  else if (absDelta >= 0.10 && absDelta <= 0.35) deltaScore = 75;
  else if (absDelta >= 0.05 && absDelta <= 0.45) deltaScore = 50;
  else deltaScore = 20;

  const probOTM = ((1 - absDelta) * 100).toFixed(0);
  signals.push({
    name: "Delta / P(OTM)",
    value: `${absDelta.toFixed(2)} / ${probOTM}%`,
    sentiment: absDelta >= 0.15 && absDelta <= 0.30 ? "bullish" : "neutral",
    weight: 0.2,
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
    weight: 0.15,
  });

  // 4. Liquidity (bid-ask spread as % of mid, volume, OI)
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
    weight: 0.15,
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
    weight: 0.15,
  });

  // 6. IV Rank (if available)
  let ivScore = 50; // neutral default
  if (ivRank !== null) {
    if (ivRank >= 50) ivScore = 100;
    else if (ivRank >= 30) ivScore = 70;
    else ivScore = 30;

    signals.push({
      name: "IV Rank",
      value: `${ivRank.toFixed(0)}%`,
      sentiment: ivRank >= 50 ? "bullish" : ivRank >= 30 ? "neutral" : "bearish",
      weight: 0.1,
    });
  }

  // Weighted composite score
  const score =
    yieldScore * 0.25 +
    deltaScore * 0.2 +
    dteScore * 0.15 +
    liquidityScore * 0.15 +
    distanceScore * 0.15 +
    ivScore * 0.1;

  // Apply market regime modifier
  let adjustedScore = score;
  if (marketRegime.regime === "CRISIS") adjustedScore *= 0.6;
  else if (marketRegime.regime === "HIGH_VOL") adjustedScore *= 0.9;
  else if (marketRegime.regime === "NORMAL") adjustedScore *= 1.0;
  else adjustedScore *= 0.95; // low vol = slightly less attractive premiums

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
  topN: number = 20
): ScoredPut[] {
  return candidates
    .map((c) => scorePut(c, ivRank, marketRegime))
    .filter((s) => s.bid > 0 && s.dte >= 7) // filter out worthless / too-close
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

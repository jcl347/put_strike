/**
 * Shared checklist evaluation logic for put selling decisions.
 * Used by PutDecisionAssistant, ScreenerResults, and Top10Puts.
 */

export interface StockContext {
  earningsDate: string | null;
  daysToEarnings: number | null;
  earningsWarning: boolean;
  trendDirection: "up" | "down" | "sideways";
  trendStrength: number;
  sma20: number;
  sma50: number;
  sma200: number;
  priceVsSMA20: number;
  priceVsSMA50: number;
  priceVsSMA200: number;
  rsi14: number;
  supportLevel: number;
  resistanceLevel: number;
  avgTrueRange: number;
  recentHighs: number[];
  recentLows: number[];
}

export interface ChecklistInput {
  symbol: string;
  price: number;
  ivRank: number;
  beta: number;
  marketCap: number;
  dividendYield: number;
  stabilityScore: number;
  vix: number;
  context: StockContext | null;
  trailingPE?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHigh?: number;
  volume?: number;
  avgVolume?: number;
}

export interface ChecklistItem {
  label: string;
  category: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  rule: string;
}

export interface ChecklistSummary {
  items: ChecklistItem[];
  passes: number;
  warns: number;
  fails: number;
  verdict: "SELL PUT" | "CAUTION" | "AVOID";
  /** Key flags for compact display */
  flags: ChecklistFlag[];
}

export interface ChecklistFlag {
  label: string;
  status: "pass" | "warn" | "fail";
  short: string; // very short label for badges
}

export function evaluateChecklist(d: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const ctx = d.context;

  // ── Stock Selection ──
  items.push({
    label: "Company Quality",
    category: "Stock Selection",
    status: d.stabilityScore >= 60 ? "pass" : d.stabilityScore >= 40 ? "warn" : "fail",
    detail: `Stability: ${d.stabilityScore.toFixed(0)}/100`,
    rule: "Sell puts only on stocks you'd be happy to own at the strike price",
  });

  items.push({
    label: "Liquidity",
    category: "Stock Selection",
    status: d.marketCap > 50e9 ? "pass" : d.marketCap > 10e9 ? "warn" : "fail",
    detail: `Market cap: $${(d.marketCap / 1e9).toFixed(0)}B`,
    rule: "Stick to liquid underlyings with tight bid/ask spreads",
  });

  items.push({
    label: "Earnings Clear",
    category: "Stock Selection",
    status: !ctx?.earningsWarning ? "pass" : "fail",
    detail: ctx?.earningsDate
      ? `Earnings: ${ctx.earningsDate} (${ctx.daysToEarnings}d)`
      : "No earnings date found",
    rule: "Avoid earnings announcements — surprise moves can blow past your strike",
  });

  // ── IV Timing ──
  items.push({
    label: "IV Rank",
    category: "IV Timing",
    status: d.ivRank >= 50 ? "pass" : d.ivRank >= 30 ? "warn" : "fail",
    detail: `HV Rank: ${d.ivRank.toFixed(0)}% (proxy for IV Rank)`,
    rule: "Sell when IV Rank > 50 — you're being paid more for the risk",
  });

  items.push({
    label: "VIX Environment",
    category: "IV Timing",
    status: d.vix >= 15 && d.vix < 35 ? "pass" : d.vix < 15 ? "warn" : "fail",
    detail: `VIX: ${d.vix.toFixed(1)}`,
    rule: d.vix >= 35
      ? "Crisis VIX — extreme tail risk, consider waiting"
      : d.vix < 15
      ? "Low VIX — premiums are thin, lower opportunity"
      : "Normal/elevated VIX — good premium environment",
  });

  // ── Trend Analysis ──
  if (ctx) {
    items.push({
      label: "Trend Direction",
      category: "Chart Analysis",
      status: ctx.trendDirection === "up" ? "pass"
        : ctx.trendDirection === "sideways" ? "warn" : "fail",
      detail: `Trend: ${ctx.trendDirection} (strength: ${ctx.trendStrength.toFixed(0)}%)`,
      rule: "Don't sell puts into a clear downtrend",
    });

    items.push({
      label: "Price vs Moving Averages",
      category: "Chart Analysis",
      status: d.price > ctx.sma50 && d.price > ctx.sma200 ? "pass"
        : d.price > ctx.sma200 ? "warn" : "fail",
      detail: `vs SMA20: ${ctx.priceVsSMA20 > 0 ? "+" : ""}${ctx.priceVsSMA20.toFixed(1)}%, vs SMA50: ${ctx.priceVsSMA50 > 0 ? "+" : ""}${ctx.priceVsSMA50.toFixed(1)}%`,
      rule: "Price above key moving averages confirms uptrend support",
    });

    items.push({
      label: "RSI",
      category: "Chart Analysis",
      status: ctx.rsi14 >= 30 && ctx.rsi14 <= 70 ? "pass"
        : ctx.rsi14 < 30 ? "warn" : "warn",
      detail: `RSI(14): ${ctx.rsi14.toFixed(1)}`,
      rule: ctx.rsi14 < 30
        ? "Oversold — potential bounce but also downtrend risk"
        : ctx.rsi14 > 70
        ? "Overbought — higher risk of pullback to your strike"
        : "RSI in normal range — no extreme momentum",
    });

    items.push({
      label: "Support Level",
      category: "Strike Selection",
      status: ctx.supportLevel < d.price * 0.95 ? "pass" : "warn",
      detail: `Support: $${ctx.supportLevel.toFixed(2)} (${((d.price - ctx.supportLevel) / d.price * 100).toFixed(1)}% below)`,
      rule: "Target strikes at or below key support levels",
    });
  }

  // ── Risk ──
  items.push({
    label: "Beta",
    category: "Risk Management",
    status: d.beta <= 1.0 ? "pass" : d.beta <= 1.5 ? "warn" : "fail",
    detail: `Beta: ${d.beta.toFixed(2)}`,
    rule: "Lower beta = less volatile = safer for put selling (CBOE research)",
  });

  items.push({
    label: "Dividend Cushion",
    category: "Risk Management",
    status: d.dividendYield > 1.5 ? "pass" : d.dividendYield > 0 ? "warn" : "fail",
    detail: d.dividendYield > 0 ? `Yield: ${d.dividendYield.toFixed(2)}%` : "No dividend",
    rule: "Dividend-paying stocks provide downside cushion if assigned",
  });

  // ── Valuation ──
  if (d.trailingPE && d.trailingPE > 0) {
    items.push({
      label: "Valuation (P/E)",
      category: "Risk Management",
      status: d.trailingPE <= 25 ? "pass" : d.trailingPE <= 40 ? "warn" : "fail",
      detail: `P/E: ${d.trailingPE.toFixed(1)}`,
      rule: d.trailingPE > 40
        ? "Very high P/E — valuation compression risk if assigned"
        : d.trailingPE > 25
        ? "Above-average P/E — moderate valuation risk"
        : "Reasonable valuation — comfortable ownership if assigned",
    });
  }

  // ── 52-Week Range Position ──
  if (d.fiftyTwoWeekLow && d.fiftyTwoWeekHigh) {
    const range = d.fiftyTwoWeekHigh - d.fiftyTwoWeekLow;
    const position = range > 0 ? ((d.price - d.fiftyTwoWeekLow) / range) * 100 : 50;
    items.push({
      label: "52-Week Position",
      category: "Risk Management",
      status: position >= 30 && position <= 85 ? "pass" : position < 30 ? "fail" : "warn",
      detail: `${position.toFixed(0)}% of 52wk range ($${d.fiftyTwoWeekLow.toFixed(0)}-$${d.fiftyTwoWeekHigh.toFixed(0)})`,
      rule: position < 30
        ? "Near 52-week low — high risk of further decline"
        : position > 85
        ? "Near 52-week high — limited upside, watch for reversal"
        : "Healthy position within 52-week range",
    });
  }

  // ── Volume Analysis ──
  if (d.volume && d.avgVolume && d.avgVolume > 0) {
    const volumeRatio = d.volume / d.avgVolume;
    items.push({
      label: "Volume Activity",
      category: "Chart Analysis",
      status: volumeRatio >= 0.5 && volumeRatio <= 2 ? "pass"
        : volumeRatio > 2 ? "warn" : "warn",
      detail: `${(volumeRatio * 100).toFixed(0)}% of avg volume`,
      rule: volumeRatio > 2
        ? "Unusual volume — potential news or institutional activity, investigate before selling"
        : volumeRatio < 0.5
        ? "Very low volume — may indicate poor liquidity for options"
        : "Normal trading volume",
    });
  }

  // ── ATR-Based Risk ──
  if (ctx) {
    const atrPct = (ctx.avgTrueRange / d.price) * 100;
    items.push({
      label: "Daily Volatility (ATR)",
      category: "Risk Management",
      status: atrPct <= 2 ? "pass" : atrPct <= 3.5 ? "warn" : "fail",
      detail: `ATR: $${ctx.avgTrueRange.toFixed(2)} (${atrPct.toFixed(1)}% of price)`,
      rule: atrPct > 3.5
        ? "High daily moves — use wider OTM strikes for safety"
        : "Normal daily range — standard strike selection applies",
    });
  }

  return items;
}

export function getVerdict(items: ChecklistItem[]): "SELL PUT" | "CAUTION" | "AVOID" {
  const fails = items.filter(i => i.status === "fail").length;
  const passes = items.filter(i => i.status === "pass").length;
  const total = items.length;

  if (fails >= 3 || (fails >= 2 && passes < total * 0.5)) return "AVOID";
  if (fails >= 1 || passes < total * 0.6) return "CAUTION";
  return "SELL PUT";
}

/**
 * Build compact flag badges for inline display in screener/top10 views.
 * Returns only the most important flags that need attention.
 */
export function getChecklistFlags(d: ChecklistInput): ChecklistFlag[] {
  const flags: ChecklistFlag[] = [];
  const ctx = d.context;

  // Earnings warning — critical flag
  if (ctx?.earningsWarning) {
    flags.push({
      label: `Earnings in ${ctx.daysToEarnings}d`,
      status: "fail",
      short: `ER ${ctx.daysToEarnings}d`,
    });
  }

  // Trend direction
  if (ctx) {
    flags.push({
      label: `Trend: ${ctx.trendDirection}`,
      status: ctx.trendDirection === "up" ? "pass" : ctx.trendDirection === "sideways" ? "warn" : "fail",
      short: ctx.trendDirection === "up" ? "\u25B2 Up" : ctx.trendDirection === "down" ? "\u25BC Down" : "\u25C6 Flat",
    });
  }

  // RSI extremes
  if (ctx && (ctx.rsi14 < 30 || ctx.rsi14 > 70)) {
    flags.push({
      label: `RSI: ${ctx.rsi14.toFixed(0)}`,
      status: "warn",
      short: ctx.rsi14 < 30 ? "RSI Low" : "RSI High",
    });
  }

  // Below SMA200
  if (ctx && d.price < ctx.sma200) {
    flags.push({
      label: "Below 200 SMA",
      status: "fail",
      short: "<SMA200",
    });
  }

  // IV Rank
  if (d.ivRank >= 50) {
    flags.push({
      label: `HV Rank: ${d.ivRank.toFixed(0)}%`,
      status: "pass",
      short: `IVR ${d.ivRank.toFixed(0)}`,
    });
  } else if (d.ivRank < 30) {
    flags.push({
      label: `HV Rank: ${d.ivRank.toFixed(0)}%`,
      status: "fail",
      short: `IVR ${d.ivRank.toFixed(0)}`,
    });
  }

  // Beta warning
  if (d.beta > 1.5) {
    flags.push({
      label: `High Beta: ${d.beta.toFixed(2)}`,
      status: "fail",
      short: `\u03B2${d.beta.toFixed(1)}`,
    });
  }

  return flags;
}

/**
 * Full summary with items, counts, verdict, and flags.
 */
export function getChecklistSummary(d: ChecklistInput): ChecklistSummary {
  const items = evaluateChecklist(d);
  const passes = items.filter(i => i.status === "pass").length;
  const warns = items.filter(i => i.status === "warn").length;
  const fails = items.filter(i => i.status === "fail").length;
  const verdict = getVerdict(items);
  const flags = getChecklistFlags(d);

  return { items, passes, warns, fails, verdict, flags };
}

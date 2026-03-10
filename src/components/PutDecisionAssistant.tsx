"use client";

import { useState } from "react";

interface StockContext {
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

interface DecisionData {
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

interface Props {
  data: DecisionData;
}

// Rule severity: critical rules carry more weight in the overall verdict.
// - critical: Earnings, Trend, VIX crisis, Moving Averages — can cause large losses alone
// - important: IV Rank, Beta, Company Quality, Liquidity, Support — affect probability of success
// - informational: Dividend, P/E, RSI, Volume, ATR, 52-Week — provide context but rarely disqualify
type Severity = "critical" | "important" | "informational";

interface ChecklistItem {
  label: string;
  category: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  rule: string;
  severity: Severity;
}

export type ChecklistInput = DecisionData;

// ─── Research-Backed Thresholds ─────────────────────────────────
// IV Rank: tastytrade research — IVR > 50 optimal; Schwab — IVR > 30 + IVP > 50 → 56.8% win rate
// VIX: CBOE PUT index data — best risk-adjusted returns VIX 15-25; elevated 25-30 still viable;
//       30-35 caution needed; >35 crisis (ERN wheel analysis confirms severe drawdowns)
// Delta: tastytrade — 16 delta; DataDrivenOptions — 20 delta optimizes theta
// DTE: tastytrade — 45 DTE optimal entry; manage at 21 DTE
// Beta: CBOE — lower-beta underlyings have higher put-selling win rates; ≤1.2 is the practical threshold
// RSI: Standard TA — 30/70 boundaries; for put sellers, RSI > 80 = high pullback risk (fail)
// Earnings: tastytrade — binary events destroy expected value; avoid positions spanning earnings
// Support: Schaeffer's Research — heavy OI at strikes creates support; target strikes near identifiable floors
// Dividend: Provides assignment cushion but non-dividend stocks (e.g., GOOGL) can still be excellent
//           put-selling candidates — downgrade from fail to warn for zero yield
// P/E: S&P 500 historical avg ~22; >40 indicates speculative valuation
// 52-Week: <20% = severe downtrend risk (fail); 20-30% = warn; 30-80% = pass; >80% = overextension (warn)
// ATR: >3.5% of price = high daily risk for short puts; 2-3.5% needs wider strikes
// Volume: >3x avg = likely catalyst event (fail); <0.3x = poor liquidity (fail)

function evaluateChecklist(d: DecisionData): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const ctx = d.context;

  // ── Stock Selection ──
  items.push({
    label: "Company Quality",
    category: "Stock Selection",
    severity: "important",
    status: d.stabilityScore >= 60 ? "pass" : d.stabilityScore >= 40 ? "warn" : "fail",
    detail: `Stability: ${d.stabilityScore.toFixed(0)}/100`,
    rule: "Sell puts only on stocks you'd be happy to own at the strike price",
  });

  items.push({
    label: "Liquidity",
    category: "Stock Selection",
    severity: "important",
    status: d.marketCap > 50e9 ? "pass" : d.marketCap > 10e9 ? "warn" : "fail",
    detail: `Market cap: $${(d.marketCap / 1e9).toFixed(0)}B`,
    rule: "Stick to liquid underlyings with tight bid/ask spreads",
  });

  // Earnings: CRITICAL — binary events can gap past any strike.
  // tastytrade research shows selling through earnings destroys expected value.
  // No earnings data = warn (absence of data ≠ safety)
  items.push({
    label: "Earnings Clear",
    category: "Stock Selection",
    severity: "critical",
    status: ctx?.earningsWarning ? "fail"
      : ctx?.earningsDate ? "pass" : "warn",
    detail: ctx?.earningsDate
      ? `Earnings: ${ctx.earningsDate} (${ctx.daysToEarnings}d)`
      : "No earnings date found",
    rule: ctx?.earningsWarning
      ? `Earnings in ${ctx.daysToEarnings}d — avoid selling puts through earnings`
      : ctx?.earningsDate
      ? "Earnings date is outside the risk window"
      : "No earnings date found — verify manually before entering",
  });

  // ── IV Timing ──
  // Schwab: IVR > 30 + IVP > 50 → 56.8% win rate (vs 48.2% unfiltered)
  // tastytrade: sell premium when IV is elevated (IVR > 50)
  items.push({
    label: "IV Rank",
    category: "IV Timing",
    severity: "important",
    status: d.ivRank >= 50 ? "pass" : d.ivRank >= 30 ? "warn" : "fail",
    detail: `HV Rank: ${d.ivRank.toFixed(0)}% (proxy for IV Rank)`,
    rule: d.ivRank >= 50
      ? "IV elevated — premiums are rich, favorable for sellers (Schwab: 56.8% win rate)"
      : d.ivRank >= 30
      ? "IV moderate — acceptable but premiums are not as rich"
      : "IV low — premiums are cheap, poor risk/reward for sellers",
  });

  // VIX: CBOE PUT index data — normal 15-25 is ideal.
  // 25-30 still works with rich premiums. 30-35 is elevated risk. >35 = crisis.
  items.push({
    label: "VIX Environment",
    category: "IV Timing",
    severity: "critical",
    status: d.vix >= 15 && d.vix < 30 ? "pass"
      : d.vix >= 30 && d.vix < 35 ? "warn"
      : d.vix < 15 ? "warn" : "fail",
    detail: `VIX: ${d.vix.toFixed(1)}`,
    rule: d.vix >= 35
      ? "Crisis VIX — extreme tail risk, ERN research shows severe wheel drawdowns"
      : d.vix >= 30
      ? "Elevated VIX (30-35) — rich premiums but reduce position size"
      : d.vix < 15
      ? "Low VIX — premiums are thin, lower opportunity"
      : "Normal/elevated VIX — ideal premium environment (CBOE PUT index)",
  });

  // ── Chart Analysis (requires context) ──
  if (ctx) {
    // Trend: selling puts = bullish bet. Downtrend = CRITICAL fail.
    items.push({
      label: "Trend Direction",
      category: "Chart Analysis",
      severity: "critical",
      status: ctx.trendDirection === "up" ? "pass"
        : ctx.trendDirection === "sideways" ? "warn" : "fail",
      detail: `Trend: ${ctx.trendDirection} (strength: ${ctx.trendStrength.toFixed(0)}%)`,
      rule: ctx.trendDirection === "down"
        ? "Downtrend — selling puts into a decline is the #1 cause of assignment losses"
        : ctx.trendDirection === "sideways"
        ? "Sideways trend — acceptable but less directional confirmation"
        : "Uptrend confirmed — favorable for selling puts",
    });

    // Moving Averages: price below SMA200 = major regime change
    items.push({
      label: "Price vs Moving Averages",
      category: "Chart Analysis",
      severity: "critical",
      status: d.price > ctx.sma50 && d.price > ctx.sma200 ? "pass"
        : d.price > ctx.sma200 ? "warn" : "fail",
      detail: `vs SMA20: ${ctx.priceVsSMA20 > 0 ? "+" : ""}${ctx.priceVsSMA20.toFixed(1)}%, vs SMA50: ${ctx.priceVsSMA50 > 0 ? "+" : ""}${ctx.priceVsSMA50.toFixed(1)}%`,
      rule: d.price <= ctx.sma200
        ? "Price below 200-day MA — major bearish signal, high assignment risk"
        : d.price <= ctx.sma50
        ? "Price below 50-day MA but above 200-day — short-term weakness"
        : "Price above key moving averages — uptrend support confirmed",
    });

    // RSI: Standard 30/70 boundaries.
    // For put sellers specifically: RSI > 80 = strong overbought → high pullback risk to strike
    // RSI < 25 = deep oversold → likely in a crash/downtrend, not bouncing
    items.push({
      label: "RSI",
      category: "Chart Analysis",
      severity: "informational",
      status: ctx.rsi14 >= 30 && ctx.rsi14 <= 70 ? "pass"
        : ctx.rsi14 > 80 ? "fail"
        : ctx.rsi14 < 25 ? "fail"
        : "warn",
      detail: `RSI(14): ${ctx.rsi14.toFixed(1)}`,
      rule: ctx.rsi14 > 80
        ? "Strongly overbought (>80) — high probability of pullback to your strike"
        : ctx.rsi14 > 70
        ? "Overbought — elevated pullback risk, consider waiting for RSI to cool"
        : ctx.rsi14 < 25
        ? "Deeply oversold (<25) — likely in a severe decline, avoid"
        : ctx.rsi14 < 30
        ? "Oversold — potential bounce but downtrend risk remains"
        : "RSI in normal range — no extreme momentum",
    });

    // Support Level: Schaeffer's Research — heavy OI at strikes creates support floors.
    // For put selling: you want identifiable support near your typical OTM strikes (5-10% below).
    // Support within 3-10% below = pass (clear floor for strike placement)
    // Support very close (<3%) = warn (strike would need to be very aggressive)
    // Support far away (>10%) = warn (no useful floor near typical strikes)
    const supportPctBelow = ((d.price - ctx.supportLevel) / d.price) * 100;
    items.push({
      label: "Support Level",
      category: "Strike Selection",
      severity: "important",
      status: supportPctBelow >= 3 && supportPctBelow <= 10 ? "pass"
        : supportPctBelow < 3 ? "warn"
        : "warn",
      detail: `Support: $${ctx.supportLevel.toFixed(2)} (${supportPctBelow.toFixed(1)}% below)`,
      rule: supportPctBelow >= 3 && supportPctBelow <= 10
        ? "Support aligns with typical OTM strike zone — good floor for strike placement"
        : supportPctBelow < 3
        ? "Support very close to price — limited room for OTM strikes above support"
        : "Support far below — no clear floor near typical strike range, use wider OTM",
    });
  }

  // ── Risk Management ──
  // Beta: CBOE research — lower-beta underlyings have higher put-selling win rates
  // ≤1.2 is practical threshold for "low beta" in diversified portfolios
  items.push({
    label: "Beta",
    category: "Risk Management",
    severity: "important",
    status: d.beta <= 1.2 ? "pass" : d.beta <= 1.5 ? "warn" : "fail",
    detail: `Beta: ${d.beta.toFixed(2)}`,
    rule: d.beta <= 1.2
      ? "Low beta — less volatile, higher put-selling win rate (CBOE research)"
      : d.beta <= 1.5
      ? "Moderate beta — acceptable but expect wider price swings"
      : "High beta (>1.5) — volatile, elevated assignment risk",
  });

  // Dividend: provides cushion if assigned, but not a hard requirement.
  // Quality tech stocks (GOOGL, META) have no dividend and are excellent put candidates.
  // Changed: no-dividend is warn (not fail) to avoid penalizing high-quality non-dividend stocks.
  items.push({
    label: "Dividend Cushion",
    category: "Risk Management",
    severity: "informational",
    status: d.dividendYield > 1.5 ? "pass" : d.dividendYield > 0 ? "warn" : "warn",
    detail: d.dividendYield > 0 ? `Yield: ${d.dividendYield.toFixed(2)}%` : "No dividend",
    rule: d.dividendYield > 1.5
      ? "Strong dividend cushion if assigned — reduces cost basis"
      : d.dividendYield > 0
      ? "Small dividend — modest cushion if assigned"
      : "No dividend — no income cushion if assigned, rely on company quality instead",
  });

  // ── Valuation ──
  // S&P 500 historical avg P/E ~22. P/E > 40 = speculative premium, >50 = extreme.
  if (d.trailingPE && d.trailingPE > 0) {
    items.push({
      label: "Valuation (P/E)",
      category: "Risk Management",
      severity: "informational",
      status: d.trailingPE <= 25 ? "pass" : d.trailingPE <= 40 ? "warn" : "fail",
      detail: `P/E: ${d.trailingPE.toFixed(1)}`,
      rule: d.trailingPE > 40
        ? "Very high P/E (>40) — valuation compression risk if assigned (S&P avg: ~22)"
        : d.trailingPE > 25
        ? "Above-average P/E — moderate valuation risk if assigned"
        : "Reasonable valuation (≤25) — comfortable ownership if assigned",
    });
  }

  // ── 52-Week Range Position ──
  // Research: stocks near 52-week lows show momentum persistence (continued decline).
  // <20% = severe decline territory (fail), 20-30% = near lows (warn),
  // 30-80% = healthy range (pass), >80% = overextension (warn), >95% = extreme (warn)
  if (d.fiftyTwoWeekLow && d.fiftyTwoWeekHigh) {
    const range = d.fiftyTwoWeekHigh - d.fiftyTwoWeekLow;
    const position = range > 0 ? ((d.price - d.fiftyTwoWeekLow) / range) * 100 : 50;
    items.push({
      label: "52-Week Position",
      category: "Risk Management",
      severity: "informational",
      status: position < 20 ? "fail"
        : position < 30 ? "warn"
        : position <= 80 ? "pass"
        : "warn",
      detail: `${position.toFixed(0)}% of 52wk range ($${d.fiftyTwoWeekLow.toFixed(0)}-$${d.fiftyTwoWeekHigh.toFixed(0)})`,
      rule: position < 20
        ? "Near 52-week low (<20%) — severe decline, high risk of further downside"
        : position < 30
        ? "Near 52-week low (20-30%) — weakness, potential for continued decline"
        : position > 80
        ? "Near 52-week high (>80%) — limited upside, watch for mean reversion"
        : "Healthy position within 52-week range (30-80%)",
    });
  }

  // ── Volume Analysis ──
  // >3x avg = likely major catalyst/news event → avoid (fail)
  // >2x avg = unusual activity → investigate (warn)
  // <0.3x avg = extremely thin liquidity → poor option fills (fail)
  // <0.5x avg = low liquidity (warn)
  if (d.volume && d.avgVolume && d.avgVolume > 0) {
    const volumeRatio = d.volume / d.avgVolume;
    items.push({
      label: "Volume Activity",
      category: "Chart Analysis",
      severity: "informational",
      status: volumeRatio >= 0.5 && volumeRatio <= 2 ? "pass"
        : volumeRatio > 3 ? "fail"
        : volumeRatio < 0.3 ? "fail"
        : "warn",
      detail: `${(volumeRatio * 100).toFixed(0)}% of avg volume`,
      rule: volumeRatio > 3
        ? "Extreme volume (>3x) — likely major news or event, do not sell puts until settled"
        : volumeRatio > 2
        ? "Unusual volume (>2x) — potential news or institutional activity, investigate"
        : volumeRatio < 0.3
        ? "Extremely low volume (<30%) — poor liquidity, wide option spreads likely"
        : volumeRatio < 0.5
        ? "Low volume — may indicate poor liquidity for options"
        : "Normal trading volume",
    });
  }

  // ── ATR-Based Risk ──
  if (ctx) {
    const atrPct = (ctx.avgTrueRange / d.price) * 100;
    items.push({
      label: "Daily Volatility (ATR)",
      category: "Risk Management",
      severity: "informational",
      status: atrPct <= 2 ? "pass" : atrPct <= 3.5 ? "warn" : "fail",
      detail: `ATR: $${ctx.avgTrueRange.toFixed(2)} (${atrPct.toFixed(1)}% of price)`,
      rule: atrPct > 3.5
        ? "High daily moves (>3.5%) — use wider OTM strikes or reduce position size"
        : atrPct > 2
        ? "Moderate daily range (2-3.5%) — consider slightly wider OTM strikes"
        : "Normal daily range — standard strike selection applies",
    });
  }

  return items;
}

// ─── Severity-Weighted Verdict ──────────────────────────────────
// Not all rules are equal. A downtrend fail is far more dangerous than a missing dividend.
// Critical fails trigger CAUTION at minimum, and AVOID with compounding failures.
function getOverallVerdict(items: ChecklistItem[]): {
  verdict: "SELL PUT" | "CAUTION" | "AVOID";
  color: string;
  bg: string;
} {
  const criticalFails = items.filter(i => i.status === "fail" && i.severity === "critical").length;
  const importantFails = items.filter(i => i.status === "fail" && i.severity === "important").length;
  const infoFails = items.filter(i => i.status === "fail" && i.severity === "informational").length;
  const totalFails = criticalFails + importantFails + infoFails;
  const passes = items.filter(i => i.status === "pass").length;
  const total = items.length;

  // AVOID: any 2+ critical fails, or 1 critical + 2 important, or 4+ total fails
  if (
    criticalFails >= 2
    || (criticalFails >= 1 && importantFails >= 2)
    || totalFails >= 4
    || (totalFails >= 3 && passes < total * 0.5)
  ) {
    return { verdict: "AVOID", color: "text-red-400", bg: "bg-red-900/30" };
  }

  // CAUTION: any critical fail, or 2+ important fails, or low pass rate
  if (
    criticalFails >= 1
    || importantFails >= 2
    || totalFails >= 2
    || passes < total * 0.55
  ) {
    return { verdict: "CAUTION", color: "text-yellow-400", bg: "bg-yellow-900/30" };
  }

  return { verdict: "SELL PUT", color: "text-green-400", bg: "bg-green-900/30" };
}

export default function PutDecisionAssistant({ data }: Props) {
  const [expanded, setExpanded] = useState(false);
  const items = evaluateChecklist(data);
  const verdict = getOverallVerdict(items);
  const categories = [...new Set(items.map(i => i.category))];

  const passes = items.filter(i => i.status === "pass").length;
  const warns = items.filter(i => i.status === "warn").length;
  const fails = items.filter(i => i.status === "fail").length;

  const ctx = data.context;

  return (
    <div className={`border rounded-lg overflow-hidden ${
      verdict.verdict === "SELL PUT" ? "border-green-700/50" :
      verdict.verdict === "CAUTION" ? "border-yellow-700/50" : "border-red-700/50"
    }`}>
      {/* Header - always visible */}
      <div
        className={`${verdict.bg} px-4 py-3 cursor-pointer flex items-center justify-between`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`text-lg font-bold ${verdict.color}`}>
            {verdict.verdict === "SELL PUT" ? "\u2713" : verdict.verdict === "CAUTION" ? "!" : "\u2717"}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`font-bold ${verdict.color}`}>{verdict.verdict}</span>
              <span className="text-gray-400 text-sm">{data.symbol}</span>
            </div>
            <div className="text-xs text-gray-500">
              {passes} pass, {warns} caution, {fails} fail
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Quick stats */}
          {ctx && (
            <div className="hidden md:flex items-center gap-3 text-xs">
              <span className={`px-2 py-0.5 rounded ${
                ctx.trendDirection === "up" ? "bg-green-900/40 text-green-400" :
                ctx.trendDirection === "down" ? "bg-red-900/40 text-red-400" :
                "bg-gray-700 text-gray-400"
              }`}>
                {ctx.trendDirection === "up" ? "\u25B2" : ctx.trendDirection === "down" ? "\u25BC" : "\u25C6"} {ctx.trendDirection}
              </span>
              {ctx.earningsWarning && (
                <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-400">
                  Earnings {ctx.daysToEarnings}d
                </span>
              )}
            </div>
          )}
          <span className="text-gray-500 text-sm">{expanded ? "\u25B2" : "\u25BC"}</span>
        </div>
      </div>

      {/* Expanded checklist */}
      {expanded && (
        <div className="bg-gray-900/50 px-4 py-3">
          {/* Position Sizing Calculator */}
          <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <h4 className="text-xs font-medium text-gray-400 uppercase mb-2">
              Schwab Cash-Secured Put Calculator
            </h4>
            <PositionSizer
              price={data.price}
              supportLevel={ctx?.supportLevel ?? data.price * 0.92}
              atr={ctx?.avgTrueRange ?? data.price * 0.02}
            />
          </div>

          {/* Checklist by category */}
          {categories.map(cat => (
            <div key={cat} className="mb-3">
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-1.5">{cat}</h4>
              <div className="space-y-1">
                {items.filter(i => i.category === cat).map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 font-bold ${
                      item.status === "pass" ? "text-green-400" :
                      item.status === "warn" ? "text-yellow-400" : "text-red-400"
                    }`}>
                      {item.status === "pass" ? "\u2713" : item.status === "warn" ? "!" : "\u2717"}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-white">{item.label}</span>
                        <span className="text-gray-400 text-xs">{item.detail}</span>
                      </div>
                      <p className="text-xs text-gray-600 mt-0.5">{item.rule}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Strike Suggestions with Profit Scenarios */}
          {ctx && (
            <div className="mt-3 pt-3 border-t border-gray-700/50">
              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                Suggested Strike Targets
              </h4>
              <div className="grid grid-cols-3 gap-2 text-sm">
                {[
                  {
                    label: "Conservative",
                    strike: Math.round(Math.min(ctx.supportLevel, data.price * 0.90)),
                    color: "text-gray-500",
                    border: "",
                    estPremium: 0.003,
                  },
                  {
                    label: "Optimal",
                    strike: Math.round(data.price * 0.92),
                    color: "text-blue-400",
                    border: "border border-blue-700/30",
                    estPremium: 0.006,
                  },
                  {
                    label: "Aggressive",
                    strike: Math.round(data.price * 0.95),
                    color: "text-gray-500",
                    border: "",
                    estPremium: 0.012,
                  },
                ].map(({ label, strike, color, border, estPremium }) => {
                  const otmPct = ((data.price - strike) / data.price * 100);
                  const estCredit = strike * estPremium;
                  const annReturn = estPremium * (365 / 35) * 100;
                  return (
                    <div key={label} className={`bg-gray-800/50 rounded p-2 text-center ${border}`}>
                      <div className={`${color} text-xs`}>{label}</div>
                      <div className="text-white font-medium">${strike}</div>
                      <div className="text-gray-600 text-xs">{otmPct.toFixed(1)}% OTM</div>
                      <div className="text-gray-500 text-xs mt-1">
                        ~${estCredit.toFixed(2)}/sh credit
                      </div>
                      <div className="text-gray-600 text-xs">
                        ~{annReturn.toFixed(0)}% ann.
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Profit/Loss Scenarios */}
              <div className="mt-3">
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                  Scenario Analysis (Optimal Strike, 35 DTE)
                </h4>
                {(() => {
                  const strike = Math.round(data.price * 0.92);
                  const estCredit = strike * 0.006;
                  const collateral = strike * 100;
                  return (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-green-900/20 border border-green-700/30 rounded p-2">
                        <div className="text-green-400 font-medium">Max Profit (OTM)</div>
                        <div className="text-white">${(estCredit * 100).toFixed(0)}/contract</div>
                        <div className="text-gray-500">
                          {(estCredit / strike * 100).toFixed(2)}% return in 35d
                        </div>
                        <div className="text-gray-600 mt-1">
                          Close at 50%: ${(estCredit * 50).toFixed(0)}
                        </div>
                      </div>
                      <div className="bg-yellow-900/20 border border-yellow-700/30 rounded p-2">
                        <div className="text-yellow-400 font-medium">Breakeven</div>
                        <div className="text-white">${(strike - estCredit).toFixed(2)}</div>
                        <div className="text-gray-500">
                          {((data.price - (strike - estCredit)) / data.price * 100).toFixed(1)}% below current
                        </div>
                        <div className="text-gray-600 mt-1">
                          Collateral: ${collateral.toLocaleString()}
                        </div>
                      </div>
                      <div className="bg-red-900/20 border border-red-700/30 rounded p-2">
                        <div className="text-red-400 font-medium">Stop Loss (2x)</div>
                        <div className="text-white">-${(estCredit * 100).toFixed(0)}/contract</div>
                        <div className="text-gray-500">
                          Close when loss = 2x credit
                        </div>
                        <div className="text-gray-600 mt-1">
                          Max risk: ${(estCredit * 200).toFixed(0)}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Exit Rules */}
          <div className="mt-3 pt-3 border-t border-gray-700/50">
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
              Schwab Trade Management Rules
            </h4>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 bg-green-900/20 border border-green-700/30 rounded text-green-400">
                Close at 50% profit
              </span>
              <span className="px-2 py-1 bg-red-900/20 border border-red-700/30 rounded text-red-400">
                Stop at 2x premium loss
              </span>
              <span className="px-2 py-1 bg-blue-900/20 border border-blue-700/30 rounded text-blue-400">
                Roll at 21 DTE if profitable
              </span>
              <span className="px-2 py-1 bg-gray-800 border border-gray-700/50 rounded text-gray-400">
                Max 5-10% of capital per position
              </span>
              <span className="px-2 py-1 bg-gray-800 border border-gray-700/50 rounded text-gray-400">
                Cash-secured: full assignment capital reserved
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Position Sizer Sub-component ─────────────────────────────

function PositionSizer({
  price,
  supportLevel,
  atr,
}: {
  price: number;
  supportLevel: number;
  atr: number;
}) {
  const [portfolioSize, setPortfolioSize] = useState(100000);
  const [riskPct, setRiskPct] = useState(5);

  const maxPosition = portfolioSize * (riskPct / 100);
  const suggestedStrike = Math.round(Math.min(price * 0.92, supportLevel));
  const collateral = suggestedStrike * 100; // per contract
  const maxContracts = Math.floor(maxPosition / collateral);
  const totalCollateral = maxContracts * collateral;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">Portfolio Size ($)</label>
          <input
            type="number"
            value={portfolioSize}
            onChange={e => setPortfolioSize(Number(e.target.value) || 0)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">Max Risk per Position (%)</label>
          <input
            type="number"
            value={riskPct}
            min={1}
            max={20}
            onChange={e => setRiskPct(Number(e.target.value) || 5)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white"
          />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div>
          <div className="text-gray-500">Max Allocation</div>
          <div className="text-white font-medium">${maxPosition.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-gray-500">Collateral/Contract</div>
          <div className="text-white font-medium">${collateral.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-gray-500">Max Contracts</div>
          <div className="text-white font-medium">{maxContracts}</div>
        </div>
        <div>
          <div className="text-gray-500">Total Collateral</div>
          <div className="text-white font-medium">${totalCollateral.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

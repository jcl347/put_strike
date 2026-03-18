/**
 * iTransformer Feature Engineering — Server-Side
 *
 * Computes the exact 172 features used to train the iTransformer model.
 * Must stay in sync with compute_features() in colab/train_itransformer.ipynb.
 *
 * Input: OHLCV daily data (need 260+ days for warmup)
 * Output: (numDays, 166) feature matrix for the available days
 *
 * Features 0-82: Original technicals + macro (SMA/EMA, RSI, MACD, BB, ATR,
 *   volume, stochastic, ROC, CCI, Aroon, returns, volatility, moments,
 *   autocorrelation, z-scores, percentile ranks, drawdown, gaps, calendar,
 *   trend slopes, Ichimoku, vol regime, VIX, Treasury, USD, Gold, Oil)
 * Features 83-107: Relative strength vs SPY, cross-asset correlations,
 *   advanced volume [MFI, A/D, VWAP, Force Index], price structure
 *   [range position, ATR ratio, consecutive days, candle body],
 *   statistical regime [Hurst, Parkinson/GK vol, consistency, tail ratio],
 *   intermarket [SPY momentum, gold/oil ratio, DXY-VIX interaction]
 * Features 108-119: Industry/sector/credit features — sector ETF relative
 *   strength, credit market signals (HYG/TLT), VIX9D term structure,
 *   industry commodity sensitivity, copper/gold ratio, BTC sentiment
 * Features 120-125: FRED macro features — HY credit spread, yield curve,
 *   breakeven inflation, 2Y Treasury, jobless claims, consumer sentiment
 * Features 126-131: Gamma squeeze proxies — volume acceleration, price-volume
 *   momentum, range expansion, gap acceleration, squeeze breakout, vol-price impact
 * Features 132-135: Market breadth & rotation — tech rotation, small cap rotation,
 *   semiconductor momentum, biotech momentum
 * Features 136-139: Sentiment proxies — realized/implied vol ratio, VIX-SPY
 *   short correlation, credit momentum, fear composite
 * Features 140-143: Stock-specific drivers — per-company primary/secondary
 *   driving asset returns and correlations
 * Features 144-145: FRED extended — financial stress index, 10Y-3M yield spread
 * Features 146-147: FRED rates — fed funds rate, fed funds rate change
 * Features 148-149: FRED FX — JPY/USD change, JPY/USD z-score
 * Features 150-151: CBOE SKEW — tail risk level, tail risk z-score
 * Features 152: Value/growth rotation — IWF vs IWD 20d spread
 * Features 153: Risk appetite — XLY vs XLP 20d spread
 * Features 154-160: Importance-analysis-driven OHLCV features — RSI divergence,
 *   volume-weighted returns, trend agreement, price acceleration, overnight
 *   return ratio, Keltner channel position, mean reversion speed
 * Features 161-163: Importance-analysis-driven macro features — sector breadth,
 *   credit-equity divergence speed, VIX term structure momentum
 * Features 164-165: Importance-analysis-driven FRED features — real interest
 *   rate, financial stress momentum
 * Features 166-167: Wikipedia pageview sentiment — retail attention z-score,
 *   attention momentum (5d change)
 * Features 168-169: FINRA short volume sentiment — short volume ratio,
 *   short volume ratio z-score
 * Features 170-171: Finnhub insider sentiment — MSPR level, MSPR 3-month momentum
 */

export const FEATURE_NAMES = [
  // Original 83 features (0-82)
  "price_vs_sma_5_pct", "price_vs_sma_10_pct", "price_vs_sma_20_pct",
  "price_vs_sma_50_pct", "price_vs_sma_200_pct",
  "price_vs_ema_5_pct", "price_vs_ema_12_pct", "price_vs_ema_26_pct",
  "sma_20_50_cross", "sma_50_200_cross",
  "rsi_7", "rsi_14", "rsi_21",
  "macd_histogram", "macd_cross_above",
  "bb_width", "bb_pctb",
  "atr_7_pct", "atr_14_pct",
  "volume_ratio_5_20", "relative_volume", "obv_zscore", "cmf_20", "volume_zscore_20",
  "stoch_k", "stoch_d", "williams_r",
  "roc_5", "roc_10", "roc_20",
  "cci_20",
  "aroon_up", "aroon_down", "aroon_oscillator",
  "return_1d", "return_5d", "return_10d", "return_20d", "return_60d",
  "volatility_5d", "volatility_10d", "volatility_20d", "volatility_60d",
  "skewness_20d", "skewness_60d", "kurtosis_20d", "kurtosis_60d",
  "autocorr_lag_1", "autocorr_lag_3", "autocorr_lag_5",
  "zscore_20", "zscore_50", "zscore_100", "zscore_200",
  "percentile_rank_20d", "percentile_rank_60d", "percentile_rank_252d",
  "max_drawdown_20d", "max_drawdown_60d",
  "up_ratio_10d", "up_ratio_20d",
  "avg_gap_20d", "gap_frequency_20d",
  "day_of_week", "month_sin", "month_cos", "is_quarter_end", "is_opex_week",
  "price_slope_20", "price_slope_50", "ichimoku_tk_cross",
  "vol_regime_ratio", "vol_expanding",
  "vix_level", "vix_change_5d", "vix_zscore_20", "vix_term_structure",
  "treasury_10y", "treasury_change_20d",
  "usd_index", "usd_change_20d",
  "gold_change_20d", "oil_change_20d",
  // New 25 features (83-107)
  "rel_return_vs_spy_5d", "rel_return_vs_spy_20d", "rel_return_vs_spy_60d",
  "rolling_corr_spy_20d",
  "rolling_corr_vix_20d", "rolling_beta_spy_60d", "corr_volume_price_20d",
  "mfi_14", "ad_line_zscore", "vwap_deviation", "force_index_13",
  "range_position_20d", "range_position_60d", "atr_ratio_7_60",
  "consecutive_up_days", "candle_body_ratio_5d",
  "hurst_exponent", "parkinson_vol_20d", "garman_klass_vol_20d",
  "return_consistency_20d", "tail_ratio_20d",
  "spy_return_5d", "spy_return_20d",
  "gold_oil_ratio_change", "dxy_vix_interaction",
  // Industry/sector/credit features (108-119)
  "sector_rel_return_5d", "sector_rel_return_20d", "sector_corr_20d",
  "hyg_return_20d", "tlt_return_20d", "credit_spread_change_20d",
  "hyg_spy_divergence", "vix_9d_ratio",
  "industry_commodity_corr_20d", "industry_commodity_return_20d",
  "copper_gold_ratio_change", "btc_change_20d",
  // FRED macro features (120-125)
  "fred_hy_spread", "fred_yield_curve", "fred_breakeven_inflation",
  "fred_2y_yield", "fred_jobless_claims_zscore", "fred_consumer_sentiment_change",
  // Gamma squeeze proxies (126-131)
  "volume_acceleration_3_10", "price_volume_momentum_5d", "range_expansion_ratio",
  "gap_acceleration_10_20", "squeeze_breakout_signal", "volume_price_impact_1d",
  // Market breadth & rotation (132-135)
  "tech_rotation_20d", "small_cap_rotation_20d", "sox_momentum_20d", "xbi_momentum_20d",
  // Sentiment proxies (136-139)
  "realized_implied_vol_ratio", "vix_spy_short_corr_10d",
  "credit_momentum_10d", "fear_composite",
  // Stock-specific drivers (140-143)
  "stock_driver_1_return_20d", "stock_driver_1_corr_20d",
  "stock_driver_2_return_20d", "stock_driver_2_corr_20d",
  // FRED extended (144-145)
  "fred_financial_stress", "fred_t10y3m_spread",
  // FRED rates & FX (146-149)
  "fed_funds_rate", "fed_funds_rate_change_20d",
  "jpy_usd_change_20d", "jpy_usd_zscore_20",
  // Tail risk & style rotation (150-153)
  "skew_level", "skew_zscore_20",
  "value_growth_spread_20d", "risk_appetite_ratio_20d",
  // Importance-analysis-driven OHLCV features (154-160)
  "rsi_divergence_20d", "volume_weighted_return_5d", "trend_agreement_score",
  "price_acceleration_10d", "overnight_return_ratio_20d",
  "keltner_channel_position", "mean_reversion_speed_20d",
  // Importance-analysis-driven macro features (161-163)
  "sector_breadth_bullish", "credit_equity_divergence_speed",
  "vix_term_structure_momentum",
  // Importance-analysis-driven FRED features (164-165)
  "real_interest_rate", "financial_stress_momentum",
  // Sentiment features (166-171)
  "wiki_attention_zscore_20d", "wiki_attention_change_5d",
  "short_volume_ratio", "short_volume_ratio_zscore_20d",
  "insider_mspr", "insider_mspr_momentum_3m",
] as const;

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MacroData {
  vix?: number[];       // daily VIX values aligned to dates
  vix3m?: number[];     // VIX3M values
  tnx?: number[];       // 10yr Treasury yield
  dxy?: number[];       // USD index
  gold?: number[];      // Gold close
  oil?: number[];       // Oil close
  spy?: number[];       // SPY close (for relative strength features)
  sectorEtf?: number[]; // Sector ETF close (per-stock mapped: XLK, XLF, XLV, etc.)
  hyg?: number[];       // HYG (high yield corporate bond ETF)
  tlt?: number[];       // TLT (20+ year treasury bond ETF)
  vix9d?: number[];     // 9-day VIX (ultra-short-term fear)
  industryCommodity?: number[];  // Industry-specific commodity (per-stock mapped)
  copper?: number[];    // HG=F copper futures
  btc?: number[];       // BTC-USD bitcoin
  // Market breadth (v8.0)
  qqq?: number[];       // QQQ NASDAQ 100 ETF (tech rotation)
  iwm?: number[];       // IWM Russell 2000 ETF (small cap rotation)
  sox?: number[];       // ^SOX Philadelphia Semiconductor Index
  xbi?: number[];       // XBI Biotech ETF
  // Stock-specific drivers (v8.0, per-stock mapped)
  stockDriver1?: number[];  // Primary driving asset (per-stock mapped)
  stockDriver2?: number[];  // Secondary driving asset (per-stock mapped)
  // FRED macro series (forward-filled daily values)
  fredHySpread?: number[];       // BAMLH0A0HYM2 HY OAS credit spread
  fredYieldCurve?: number[];     // T10Y2Y 10Y-2Y yield curve
  fredBreakeven?: number[];      // T10YIE 10Y breakeven inflation
  fredTreasury2y?: number[];     // DGS2 2-year Treasury yield
  fredJoblessClaims?: number[];  // ICSA initial jobless claims
  fredConsumerSentiment?: number[]; // UMCSENT UMich consumer sentiment
  fredFinancialStress?: number[];   // STLFSI4 St. Louis Fed Financial Stress Index
  fredT10y3mSpread?: number[];     // T10Y3M 10Y-3M yield spread
  fredFedFundsRate?: number[];     // DFF Daily Federal Funds Effective Rate
  fredJpyUsd?: number[];           // DEXJPUS JPY/USD exchange rate
  // Tail risk & style rotation (v9.0)
  skew?: number[];        // ^SKEW CBOE SKEW Index (tail risk)
  iwf?: number[];         // IWF Russell 1000 Growth ETF
  iwd?: number[];         // IWD Russell 1000 Value ETF
  xly?: number[];         // XLY Consumer Discretionary SPDR
  xlp?: number[];         // XLP Consumer Staples SPDR
  // Sector breadth (v11.0) — all sector ETFs for breadth calculation
  sectorEtfs?: Record<string, number[]>;  // Map of ETF symbol -> daily closes (XLK, XLF, XLV, XLE, XLI, XLY, XLP, XLC, XLB)
  // Sentiment features (v11.0)
  wikiPageviews?: number[];     // Daily Wikipedia pageviews for company article (retail attention)
  shortVolumeRatio?: number[];  // FINRA daily short volume / total volume (institutional sentiment)
  insiderMspr?: number[];       // Finnhub Monthly Share Purchase Ratio (insider sentiment, forward-filled)
}

/**
 * Maps each stock to its GICS sector ETF for relative performance features.
 * Uses SPDR Select Sector ETFs (XLK, XLF, XLV, XLE, XLI, XLY, XLP, XLC, XLB, XLU, XLRE).
 */
export const SECTOR_ETF_MAP: Record<string, string> = {
  // Technology
  AAPL: "XLK", MSFT: "XLK", NVDA: "XLK", AVGO: "XLK", ORCL: "XLK", CRM: "XLK",
  AMD: "XLK", INTC: "XLK", QCOM: "XLK", ADBE: "XLK", CSCO: "XLK", IBM: "XLK",
  TXN: "XLK", NOW: "XLK", AMAT: "XLK", MU: "XLK", LRCX: "XLK", KLAC: "XLK",
  SNPS: "XLK", CDNS: "XLK", PANW: "XLK", CRWD: "XLK", FTNT: "XLK", PYPL: "XLK",
  // Communication Services
  GOOGL: "XLC", META: "XLC", NFLX: "XLC", DIS: "XLC",
  // Consumer Discretionary
  AMZN: "XLY", TSLA: "XLY", MCD: "XLY", NKE: "XLY", SBUX: "XLY",
  TGT: "XLY", HD: "XLY", LOW: "XLY", ABNB: "XLY", UBER: "XLY",
  // Finance
  JPM: "XLF", V: "XLF", MA: "XLF", BAC: "XLF", WFC: "XLF", GS: "XLF",
  MS: "XLF", AXP: "XLF", BLK: "XLF", SCHW: "XLF", C: "XLF", SQ: "XLF", COIN: "XLF",
  // Healthcare
  JNJ: "XLV", UNH: "XLV", LLY: "XLV", PFE: "XLV", ABBV: "XLV", MRK: "XLV",
  TMO: "XLV", ABT: "XLV", DHR: "XLV", BMY: "XLV", AMGN: "XLV",
  // Consumer Staples
  PG: "XLP", KO: "XLP", PEP: "XLP", COST: "XLP", WMT: "XLP",
  // Energy
  XOM: "XLE", CVX: "XLE", COP: "XLE", SLB: "XLE", EOG: "XLE",
  // Industrials
  CAT: "XLI", DE: "XLI", HON: "XLI", UNP: "XLI", RTX: "XLI",
  BA: "XLI", GE: "XLI", LMT: "XLI", MMM: "XLI",
  // ETFs — map to themselves or closest sector
  SPY: "SPY", QQQ: "XLK", IWM: "IWM", DIA: "DIA",
  XLF: "XLF", XLE: "XLE", XLK: "XLK", XLV: "XLV", XBI: "XLV",
};

/**
 * Maps stocks to industry-specific commodities for correlation features.
 * Only stocks with strong commodity sensitivity are mapped.
 */
export const INDUSTRY_COMMODITY_MAP: Record<string, string> = {
  // Energy → Natural Gas (NG=F)
  XOM: "NG=F", CVX: "NG=F", COP: "NG=F", SLB: "NG=F", EOG: "NG=F", XLE: "NG=F",
  // Industrials → Copper (HG=F)
  CAT: "HG=F", DE: "HG=F", HON: "HG=F", UNP: "HG=F", RTX: "HG=F",
  BA: "HG=F", GE: "HG=F", LMT: "HG=F", MMM: "HG=F", XLI: "HG=F",
  // Crypto-exposed → Bitcoin (BTC-USD)
  COIN: "BTC-USD", SQ: "BTC-USD", PYPL: "BTC-USD",
};

/**
 * Maps each stock to 2 specific driving assets (primary, secondary).
 * Captures business-specific factors not already in sector ETF or commodity mappings.
 * Researched per-company based on revenue drivers, supply chain, and market dynamics.
 */
export const STOCK_SPECIFIC_DRIVERS: Record<string, [string, string]> = {
  // Semiconductors → SOX index + sub-sector
  AAPL: ["^SOX", "XRT"],  NVDA: ["^SOX", "BTC-USD"], AMD: ["^SOX", "QQQ"],
  INTC: ["^SOX", "QQQ"],  AVGO: ["^SOX", "QQQ"],  QCOM: ["^SOX", "QQQ"],
  TXN: ["^SOX", "XLI"],   AMAT: ["^SOX", "QQQ"],  MU: ["^SOX", "QQQ"],
  LRCX: ["^SOX", "QQQ"],  KLAC: ["^SOX", "QQQ"],  SNPS: ["^SOX", "IGV"],
  CDNS: ["^SOX", "IGV"],
  // Software → IGV + tech
  MSFT: ["IGV", "QQQ"],   ORCL: ["IGV", "QQQ"],   CRM: ["IGV", "QQQ"],
  ADBE: ["IGV", "QQQ"],   NOW: ["IGV", "QQQ"],
  // Cybersecurity → HACK + tech
  PANW: ["HACK", "QQQ"],  CRWD: ["HACK", "QQQ"],  FTNT: ["HACK", "QQQ"],
  // Communication/Media
  GOOGL: ["IGV", "QQQ"],  META: ["IGV", "QQQ"],    NFLX: ["XRT", "QQQ"],
  DIS: ["XRT", "QQQ"],
  // Consumer Tech / E-commerce
  AMZN: ["XRT", "QQQ"],   TSLA: ["LIT", "QQQ"],
  // Legacy Tech
  CSCO: ["IGV", "QQQ"],   IBM: ["IGV", "QQQ"],
  // Fintech / Crypto
  PYPL: ["IGV", "BTC-USD"], SQ: ["IGV", "ETH-USD"], COIN: ["BTC-USD", "ETH-USD"],
  // Banks → KRE + rates
  JPM: ["KRE", "^TNX"],   BAC: ["KRE", "^TNX"],    WFC: ["KRE", "^TNX"],
  GS: ["KRE", "^TNX"],    MS: ["KRE", "^TNX"],     C: ["KRE", "^TNX"],
  SCHW: ["KRE", "^TNX"],
  // Payment Networks
  V: ["XLF", "QQQ"],      MA: ["XLF", "QQQ"],      AXP: ["XLF", "XRT"],
  BLK: ["XLF", "QQQ"],
  // Healthcare / Pharma → IBB + sector
  JNJ: ["IBB", "XLV"],    UNH: ["XLV", "QQQ"],     LLY: ["IBB", "XBI"],
  PFE: ["IBB", "XBI"],    ABBV: ["IBB", "XBI"],     MRK: ["IBB", "XBI"],
  TMO: ["IBB", "XLV"],    ABT: ["IBB", "XLV"],      DHR: ["IBB", "XLV"],
  BMY: ["IBB", "XBI"],    AMGN: ["IBB", "XBI"],
  // Consumer Staples
  PG: ["XLP", "XRT"],     KO: ["XLP", "XRT"],       PEP: ["XLP", "XRT"],
  COST: ["XRT", "XLP"],   WMT: ["XRT", "XLP"],
  // Consumer Discretionary
  MCD: ["XRT", "XLP"],    NKE: ["XRT", "XLY"],      SBUX: ["XRT", "XLY"],
  TGT: ["XRT", "XLY"],    HD: ["XHB", "XRT"],       LOW: ["XHB", "XRT"],
  // Energy → XOP + crude oil
  XOM: ["XOP", "CL=F"],   CVX: ["XOP", "CL=F"],     COP: ["XOP", "CL=F"],
  SLB: ["XOP", "CL=F"],   EOG: ["XOP", "CL=F"],
  // Industrial
  CAT: ["XLI", "HG=F"],   DE: ["XLI", "DBA"],       HON: ["XLI", "ITA"],
  UNP: ["XLI", "IYT"],    RTX: ["ITA", "XLI"],      BA: ["ITA", "XLI"],
  GE: ["ITA", "XLI"],     LMT: ["ITA", "XLI"],      MMM: ["XLI", "XLB"],
  // Travel / Gig
  ABNB: ["XRT", "QQQ"],   UBER: ["XRT", "QQQ"],
  // ETFs
  SPY: ["QQQ", "IWM"],    QQQ: ["^SOX", "IGV"],     IWM: ["SPY", "KRE"],
  DIA: ["SPY", "XLI"],    XLF: ["KRE", "^TNX"],     XLE: ["XOP", "CL=F"],
  XLK: ["^SOX", "IGV"],   XLV: ["IBB", "XBI"],      XBI: ["IBB", "XLV"],
};

// ── Helper functions ──

function sma(arr: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += arr[j];
    result.push(sum / period);
  }
  return result;
}

function ema(arr: number[], span: number): number[] {
  const k = 2 / (span + 1);
  const result: number[] = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    result.push(arr[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function rollingStd(arr: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    const window = arr.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    result.push(Math.sqrt(variance));
  }
  return result;
}

function rollingMean(arr: number[], period: number): (number | null)[] {
  return sma(arr, period);
}

function rollingMin(arr: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (arr[j] < min) min = arr[j];
    result.push(min);
  }
  return result;
}

function rollingMax(arr: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (arr[j] > max) max = arr[j];
    result.push(max);
  }
  return result;
}

function pctChange(arr: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period || arr[i - period] === 0) { result.push(null); continue; }
    result.push((arr[i] - arr[i - period]) / arr[i - period]);
  }
  return result;
}

function diff(arr: number[]): (number | null)[] {
  const result: (number | null)[] = [null];
  for (let i = 1; i < arr.length; i++) result.push(arr[i] - arr[i - 1]);
  return result;
}

function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function cumsum(arr: number[]): number[] {
  const result: number[] = [];
  let sum = 0;
  for (const v of arr) { sum += v; result.push(sum); }
  return result;
}

function rollingApply(arr: number[], period: number, fn: (window: number[]) => number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    result.push(fn(arr.slice(i - period + 1, i + 1)));
  }
  return result;
}

function autocorr(arr: number[], lag: number): number {
  if (arr.length < lag + 2) return 0;
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = lag; i < n; i++) {
    num += (arr[i] - mean) * (arr[i - lag] - mean);
  }
  for (let i = 0; i < n; i++) den += (arr[i] - mean) ** 2;
  return den === 0 ? 0 : num / den;
}

function linearSlope(arr: number[]): number {
  const n = arr.length;
  if (n < 2 || arr[0] === 0) return 0;
  // Normalize by first value
  const norm = arr.map(v => v / arr[0]);
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += norm[i]; sumXY += i * norm[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

/**
 * Compute 172 features for each day of the OHLCV array.
 * Returns a 2D array: [numDays][166]
 * Days with insufficient warmup data get 0-filled features.
 */
export function computeITransformerFeatures(
  ohlcv: OHLCV[],
  macro?: MacroData
): number[][] {
  const n = ohlcv.length;
  const close = ohlcv.map(d => d.close);
  const high = ohlcv.map(d => d.high);
  const low = ohlcv.map(d => d.low);
  const open = ohlcv.map(d => d.open);
  const volume = ohlcv.map(d => d.volume);
  const dates = ohlcv.map(d => new Date(d.date));

  // Pre-compute reusable arrays
  const sma5 = sma(close, 5);
  const sma10 = sma(close, 10);
  const sma20 = sma(close, 20);
  const sma50 = sma(close, 50);
  const sma200 = sma(close, 200);
  const ema5 = ema(close, 5);
  const ema12 = ema(close, 12);
  const ema26 = ema(close, 26);

  // RSI helper
  const closeDiff = diff(close);
  function computeRSI(period: number): (number | null)[] {
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = closeDiff[i] ?? 0;
      gains.push(d > 0 ? d : 0);
      losses.push(d < 0 ? -d : 0);
    }
    const avgGain = rollingMean(gains, period);
    const avgLoss = rollingMean(losses, period);
    return avgGain.map((g, i) => {
      if (g == null || avgLoss[i] == null) return null;
      const rs = g / ((avgLoss[i] as number) + 1e-10);
      return 100 - 100 / (1 + rs);
    });
  }
  const rsi7 = computeRSI(7);
  const rsi14 = computeRSI(14);
  const rsi21 = computeRSI(21);

  // MACD
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const macdSignal = ema(macdLine, 9);

  // Bollinger
  const bbSma = sma20;
  const bbStd = rollingStd(close, 20);

  // ATR
  function computeATR(period: number): (number | null)[] {
    const tr: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) { tr.push(high[i] - low[i]); continue; }
      tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
    }
    return rollingMean(tr, period);
  }
  const atr7 = computeATR(7);
  const atr14 = computeATR(14);

  // Volume indicators
  const vol5 = sma(volume, 5);
  const vol20 = sma(volume, 20);
  const volStd20 = rollingStd(volume, 20);

  // OBV
  const obvRaw: number[] = [];
  for (let i = 0; i < n; i++) {
    obvRaw.push(sign(closeDiff[i] ?? 0) * volume[i]);
  }
  const obv = cumsum(obvRaw);
  const obvMean20 = rollingMean(obv, 20);
  const obvStd20 = rollingStd(obv, 20);

  // CMF
  const clv: number[] = [];
  for (let i = 0; i < n; i++) {
    const hl = high[i] - low[i] + 1e-10;
    clv.push(((close[i] - low[i]) - (high[i] - close[i])) / hl);
  }

  // Stochastic
  const low14 = rollingMin(low, 14);
  const high14 = rollingMax(high, 14);

  // Log returns
  const logRet: number[] = [];
  for (let i = 0; i < n; i++) {
    logRet.push(i === 0 ? 0 : Math.log(close[i] / close[i - 1]));
  }

  // Volatilities
  const vol5d = rollingStd(logRet, 5);
  const vol10d = rollingStd(logRet, 10);
  const vol20d = rollingStd(logRet, 20);
  const vol60d = rollingStd(logRet, 60);

  // Z-scores
  const closeMean20 = rollingMean(close, 20);
  const closeMean50 = rollingMean(close, 50);
  const closeMean100 = rollingMean(close, 100);
  const closeMean200 = rollingMean(close, 200);
  const closeStd20 = rollingStd(close, 20);
  const closeStd50 = rollingStd(close, 50);
  const closeStd100 = rollingStd(close, 100);
  const closeStd200 = rollingStd(close, 200);

  // Ichimoku
  const tenkanHigh = rollingMax(high, 9);
  const tenkanLow = rollingMin(low, 9);
  const kijunHigh = rollingMax(high, 26);
  const kijunLow = rollingMin(low, 26);

  // Gap
  const gap: number[] = [];
  for (let i = 0; i < n; i++) {
    gap.push(i === 0 ? 0 : (open[i] - close[i - 1]) / (close[i - 1] + 1e-10));
  }

  // ── Pre-compute arrays for new features (83-107) ──

  // SPY log returns (for relative strength + cross-asset features)
  const spyLogRet: number[] = [];
  if (macro?.spy) {
    for (let i = 0; i < n; i++) {
      spyLogRet.push(i === 0 || !macro.spy[i - 1] || macro.spy[i - 1] <= 0
        ? 0 : Math.log(macro.spy[i] / macro.spy[i - 1]));
    }
  }

  // VIX log returns (for rolling correlation)
  const vixLogRet: number[] = [];
  if (macro?.vix) {
    for (let i = 0; i < n; i++) {
      vixLogRet.push(i === 0 || !macro.vix[i - 1] || macro.vix[i - 1] <= 0
        ? 0 : Math.log(macro.vix[i] / macro.vix[i - 1]));
    }
  }

  // Volume log returns (for volume-price correlation)
  const volLogRet: number[] = [];
  for (let i = 0; i < n; i++) {
    volLogRet.push(i === 0 || volume[i - 1] <= 0
      ? 0 : Math.log((volume[i] + 1) / (volume[i - 1] + 1)));
  }

  // Sector ETF log returns (for sector relative strength)
  const sectorLogRet: number[] = [];
  if (macro?.sectorEtf) {
    for (let i = 0; i < n; i++) {
      sectorLogRet.push(i === 0 || !macro.sectorEtf[i - 1] || macro.sectorEtf[i - 1] <= 0
        ? 0 : Math.log(macro.sectorEtf[i] / macro.sectorEtf[i - 1]));
    }
  }

  // Industry commodity log returns
  const commodityLogRet: number[] = [];
  if (macro?.industryCommodity) {
    for (let i = 0; i < n; i++) {
      commodityLogRet.push(i === 0 || !macro.industryCommodity[i - 1] || macro.industryCommodity[i - 1] <= 0
        ? 0 : Math.log(macro.industryCommodity[i] / macro.industryCommodity[i - 1]));
    }
  }

  // True Range for ATR ratio
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr.push(high[i] - low[i]); continue; }
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  const atr7Arr = rollingMean(tr, 7);
  const atr60Arr = rollingMean(tr, 60);

  // CLV for A/D line
  const clvArr: number[] = [];
  for (let i = 0; i < n; i++) {
    const hl = high[i] - low[i] + 1e-10;
    clvArr.push(((close[i] - low[i]) - (high[i] - close[i])) / hl);
  }

  // A/D line (cumulative CLV * volume)
  const adRaw: number[] = [];
  for (let i = 0; i < n; i++) {
    adRaw.push(clvArr[i] * volume[i]);
  }
  const adLine = cumsum(adRaw);
  const adMean20 = rollingMean(adLine, 20);
  const adStd20 = rollingStd(adLine, 20);

  // Typical price for MFI and VWAP
  const typicalPrice: number[] = [];
  for (let i = 0; i < n; i++) {
    typicalPrice.push((high[i] + low[i] + close[i]) / 3);
  }

  // Rolling correlation helper
  function rollingCorr(a: number[], b: number[], period: number): (number | null)[] {
    const result: (number | null)[] = [];
    for (let i = 0; i < a.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      const wa = a.slice(i - period + 1, i + 1);
      const wb = b.slice(i - period + 1, i + 1);
      const ma = wa.reduce((s, v) => s + v, 0) / period;
      const mb = wb.reduce((s, v) => s + v, 0) / period;
      let cov = 0, va = 0, vb = 0;
      for (let j = 0; j < period; j++) {
        const da = wa[j] - ma;
        const db = wb[j] - mb;
        cov += da * db;
        va += da * da;
        vb += db * db;
      }
      const denom = Math.sqrt(va * vb) + 1e-10;
      result.push(cov / denom);
    }
    return result;
  }

  // Hurst exponent helper (R/S method)
  function hurstRS(arr: number[]): number {
    const nn = arr.length;
    if (nn < 20) return 0.5;
    const mean = arr.reduce((s, v) => s + v, 0) / nn;
    const cumDev: number[] = [];
    let cum = 0;
    for (let j = 0; j < nn; j++) { cum += arr[j] - mean; cumDev.push(cum); }
    const r = Math.max(...cumDev) - Math.min(...cumDev);
    let variance = 0;
    for (let j = 0; j < nn; j++) variance += (arr[j] - mean) ** 2;
    const s = Math.sqrt(variance / (nn - 1)) + 1e-10;
    const rs = r / s;
    if (rs <= 0) return 0.5;
    return Math.log(rs) / Math.log(nn);
  }

  // Build per-day feature rows
  const result: number[][] = [];

  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(172).fill(0);
    const c = close[i];
    const dt = dates[i];

    // 0-4: price vs SMA
    if (sma5[i] != null) row[0] = ((c - sma5[i]!) / sma5[i]!) * 100;
    if (sma10[i] != null) row[1] = ((c - sma10[i]!) / sma10[i]!) * 100;
    if (sma20[i] != null) row[2] = ((c - sma20[i]!) / sma20[i]!) * 100;
    if (sma50[i] != null) row[3] = ((c - sma50[i]!) / sma50[i]!) * 100;
    if (sma200[i] != null) row[4] = ((c - sma200[i]!) / sma200[i]!) * 100;

    // 5-7: price vs EMA
    row[5] = ((c - ema5[i]) / ema5[i]) * 100;
    row[6] = ((c - ema12[i]) / ema12[i]) * 100;
    row[7] = ((c - ema26[i]) / ema26[i]) * 100;

    // 8-9: SMA crosses
    if (sma20[i] != null && sma50[i] != null) row[8] = sma20[i]! > sma50[i]! ? 1 : 0;
    if (sma50[i] != null && sma200[i] != null) row[9] = sma50[i]! > sma200[i]! ? 1 : 0;

    // 10-12: RSI
    row[10] = rsi7[i] ?? 50;
    row[11] = rsi14[i] ?? 50;
    row[12] = rsi21[i] ?? 50;

    // 13-14: MACD
    row[13] = c > 0 ? ((macdLine[i] - macdSignal[i]) / c) * 100 : 0;
    row[14] = (i > 0 && macdLine[i] > macdSignal[i] && macdLine[i - 1] <= macdSignal[i - 1]) ? 1 : 0;

    // 15-16: Bollinger
    if (bbSma[i] != null && bbStd[i] != null) {
      row[15] = ((4 * bbStd[i]!) / bbSma[i]!) * 100;
      const bbLower = bbSma[i]! - 2 * bbStd[i]!;
      row[16] = (c - bbLower) / (4 * bbStd[i]! + 1e-10);
    }

    // 17-18: ATR
    if (atr7[i] != null) row[17] = (atr7[i]! / c) * 100;
    if (atr14[i] != null) row[18] = (atr14[i]! / c) * 100;

    // 19-23: Volume
    if (vol5[i] != null && vol20[i] != null) row[19] = vol5[i]! / (vol20[i]! + 1);
    if (vol20[i] != null) row[20] = volume[i] / (vol20[i]! + 1);
    if (obvMean20[i] != null && obvStd20[i] != null) row[21] = (obv[i] - obvMean20[i]!) / (obvStd20[i]! + 1e-10);
    // CMF 20
    if (i >= 19) {
      let clvVolSum = 0, volSum = 0;
      for (let j = i - 19; j <= i; j++) { clvVolSum += clv[j] * volume[j]; volSum += volume[j]; }
      row[22] = clvVolSum / (volSum + 1);
    }
    if (vol20[i] != null && volStd20[i] != null) row[23] = (volume[i] - vol20[i]!) / (volStd20[i]! + 1e-10);

    // 24-26: Stochastic, Williams %R
    if (low14[i] != null && high14[i] != null) {
      const range = high14[i]! - low14[i]! + 1e-10;
      row[24] = ((c - low14[i]!) / range) * 100; // stoch_k
      // stoch_d is 3-period SMA of stoch_k, we approximate
      if (i >= 2) {
        let sum = row[24];
        // Recalculate stoch_k for i-1, i-2
        for (const offset of [1, 2]) {
          const idx = i - offset;
          if (low14[idx] != null && high14[idx] != null) {
            sum += ((close[idx] - low14[idx]!) / (high14[idx]! - low14[idx]! + 1e-10)) * 100;
          } else {
            sum += 50;
          }
        }
        row[25] = sum / 3;
      }
      row[26] = ((high14[i]! - c) / range) * -100; // williams_r
    }

    // 27-29: ROC
    if (i >= 5) row[27] = (pctChange(close, 5)[i] ?? 0) * 100;
    if (i >= 10) row[28] = (pctChange(close, 10)[i] ?? 0) * 100;
    if (i >= 20) row[29] = (pctChange(close, 20)[i] ?? 0) * 100;

    // 30: CCI 20
    if (i >= 19) {
      const tp = (high[i] + low[i] + c) / 3;
      let tpSum = 0;
      for (let j = i - 19; j <= i; j++) tpSum += (high[j] + low[j] + close[j]) / 3;
      const tpMean = tpSum / 20;
      let madSum = 0;
      for (let j = i - 19; j <= i; j++) madSum += Math.abs((high[j] + low[j] + close[j]) / 3 - tpMean);
      const mad = madSum / 20;
      row[30] = (tp - tpMean) / (0.015 * mad + 1e-10);
    }

    // 31-33: Aroon
    if (i >= 24) {
      const window25h = high.slice(i - 24, i + 1);
      const window25l = low.slice(i - 24, i + 1);
      let hiIdx = 0, loIdx = 0;
      for (let j = 1; j < 25; j++) {
        if (window25h[j] >= window25h[hiIdx]) hiIdx = j;
        if (window25l[j] <= window25l[loIdx]) loIdx = j;
      }
      row[31] = (hiIdx / 24) * 100;
      row[32] = (loIdx / 24) * 100;
      row[33] = row[31] - row[32];
    }

    // 34-38: Returns
    if (i >= 1) row[34] = pctChange(close, 1)[i] ?? 0;
    if (i >= 5) row[35] = pctChange(close, 5)[i] ?? 0;
    if (i >= 10) row[36] = pctChange(close, 10)[i] ?? 0;
    if (i >= 20) row[37] = pctChange(close, 20)[i] ?? 0;
    if (i >= 60) row[38] = pctChange(close, 60)[i] ?? 0;

    // 39-42: Volatility (annualized)
    if (vol5d[i] != null) row[39] = vol5d[i]! * Math.sqrt(252);
    if (vol10d[i] != null) row[40] = vol10d[i]! * Math.sqrt(252);
    if (vol20d[i] != null) row[41] = vol20d[i]! * Math.sqrt(252);
    if (vol60d[i] != null) row[42] = vol60d[i]! * Math.sqrt(252);

    // 43-46: Skewness, Kurtosis
    for (const [idx, period] of [[43, 20], [44, 60]] as const) {
      if (i >= period - 1) {
        const w = logRet.slice(i - period + 1, i + 1);
        const m = w.reduce((a, b) => a + b, 0) / period;
        const s = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / period) + 1e-10;
        row[idx] = w.reduce((a, b) => a + ((b - m) / s) ** 3, 0) / period;
      }
    }
    for (const [idx, period] of [[45, 20], [46, 60]] as const) {
      if (i >= period - 1) {
        const w = logRet.slice(i - period + 1, i + 1);
        const m = w.reduce((a, b) => a + b, 0) / period;
        const s = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / period) + 1e-10;
        row[idx] = w.reduce((a, b) => a + ((b - m) / s) ** 4, 0) / period - 3;
      }
    }

    // 47-49: Autocorrelation
    if (i >= 29) {
      const w = logRet.slice(i - 29, i + 1);
      row[47] = autocorr(w, 1);
      row[48] = autocorr(w, 3);
      row[49] = autocorr(w, 5);
    }

    // 50-53: Z-scores
    if (closeMean20[i] != null && closeStd20[i] != null) row[50] = (c - closeMean20[i]!) / (closeStd20[i]! + 1e-10);
    if (closeMean50[i] != null && closeStd50[i] != null) row[51] = (c - closeMean50[i]!) / (closeStd50[i]! + 1e-10);
    if (closeMean100[i] != null && closeStd100[i] != null) row[52] = (c - closeMean100[i]!) / (closeStd100[i]! + 1e-10);
    if (closeMean200[i] != null && closeStd200[i] != null) row[53] = (c - closeMean200[i]!) / (closeStd200[i]! + 1e-10);

    // 54-56: Percentile ranks
    for (const [idx, period] of [[54, 20], [55, 60], [56, 252]] as const) {
      if (i >= period - 1) {
        const w = close.slice(i - period + 1, i + 1);
        row[idx] = (w.filter(v => v < c).length / period) * 100;
      } else {
        row[idx] = 50;
      }
    }

    // 57-58: Max drawdown
    for (const [idx, period] of [[57, 20], [58, 60]] as const) {
      if (i >= period - 1) {
        const w = close.slice(i - period + 1, i + 1);
        const rolMax = Math.max(...w);
        row[idx] = (c - rolMax) / (rolMax + 1e-10);
      }
    }

    // 59-60: Up ratios
    for (const [idx, period] of [[59, 10], [60, 20]] as const) {
      if (i >= period) {
        let ups = 0;
        for (let j = i - period + 1; j <= i; j++) {
          if ((closeDiff[j] ?? 0) > 0) ups++;
        }
        row[idx] = ups / period;
      }
    }

    // 61-62: Gap features
    if (i >= 19) {
      const gapWindow = gap.slice(i - 19, i + 1);
      row[61] = gapWindow.reduce((a, b) => a + b, 0) / 20;
      row[62] = gapWindow.filter(g => Math.abs(g) > 0.01).length / 20;
    }

    // 63-67: Calendar
    row[63] = dt.getDay() / 4; // day_of_week (Mon=1..Fri=5, /4)
    const month = dt.getMonth() + 1;
    row[64] = Math.sin(2 * Math.PI * month / 12);
    row[65] = Math.cos(2 * Math.PI * month / 12);
    row[66] = [3, 6, 9, 12].includes(month) ? 1 : 0;
    const day = dt.getDate();
    row[67] = (day >= 15 && day <= 21) ? 1 : 0;

    // 68-69: Trend slopes
    if (i >= 19) row[68] = linearSlope(close.slice(i - 19, i + 1));
    if (i >= 49) row[69] = linearSlope(close.slice(i - 49, i + 1));

    // 70: Ichimoku TK cross
    if (tenkanHigh[i] != null && tenkanLow[i] != null && kijunHigh[i] != null && kijunLow[i] != null) {
      const tenkan = (tenkanHigh[i]! + tenkanLow[i]!) / 2;
      const kijun = (kijunHigh[i]! + kijunLow[i]!) / 2;
      row[70] = tenkan > kijun ? 1 : 0;
    }

    // 71-72: Vol regime
    if (vol20d[i] != null && vol60d[i] != null) {
      row[71] = vol20d[i]! / (vol60d[i]! + 1e-10);
      row[72] = vol20d[i]! > vol60d[i]! ? 1 : 0;
    }

    // 73-82: Macro features
    if (macro) {
      if (macro.vix && macro.vix[i] != null) {
        row[73] = macro.vix[i];
        if (i >= 5 && macro.vix[i - 5] > 0) row[74] = (macro.vix[i] - macro.vix[i - 5]) / macro.vix[i - 5];
        // VIX z-score 20
        if (i >= 19) {
          const vixW = macro.vix.slice(i - 19, i + 1);
          const vixM = vixW.reduce((a, b) => a + b, 0) / 20;
          const vixS = Math.sqrt(vixW.reduce((a, b) => a + (b - vixM) ** 2, 0) / 20) + 1e-10;
          row[75] = (macro.vix[i] - vixM) / vixS;
        }
      }
      if (macro.vix && macro.vix3m && macro.vix[i] > 0 && macro.vix3m[i] != null) {
        row[76] = (macro.vix3m[i] - macro.vix[i]) / (macro.vix[i] + 1e-10);
      }
      if (macro.tnx && macro.tnx[i] != null) {
        row[77] = macro.tnx[i];
        if (i >= 20) row[78] = macro.tnx[i] - (macro.tnx[i - 20] ?? macro.tnx[i]);
      }
      if (macro.dxy && macro.dxy[i] != null) {
        row[79] = macro.dxy[i];
        if (i >= 20 && macro.dxy[i - 20] > 0) row[80] = (macro.dxy[i] - macro.dxy[i - 20]) / macro.dxy[i - 20];
      }
      if (macro.gold && i >= 20 && macro.gold[i - 20] > 0) {
        row[81] = (macro.gold[i] - macro.gold[i - 20]) / macro.gold[i - 20];
      }
      if (macro.oil && i >= 20 && macro.oil[i - 20] > 0) {
        row[82] = (macro.oil[i] - macro.oil[i - 20]) / macro.oil[i - 20];
      }
    }

    // ── 83-86: Sector Relative Strength vs SPY ──
    if (macro?.spy) {
      if (i >= 5 && macro.spy[i - 5] > 0) {
        const stockRet5 = (close[i] - close[i - 5]) / close[i - 5];
        const spyRet5 = (macro.spy[i] - macro.spy[i - 5]) / macro.spy[i - 5];
        row[83] = stockRet5 - spyRet5;
      }
      if (i >= 20 && macro.spy[i - 20] > 0) {
        const stockRet20 = (close[i] - close[i - 20]) / close[i - 20];
        const spyRet20 = (macro.spy[i] - macro.spy[i - 20]) / macro.spy[i - 20];
        row[84] = stockRet20 - spyRet20;
      }
      if (i >= 60 && macro.spy[i - 60] > 0) {
        const stockRet60 = (close[i] - close[i - 60]) / close[i - 60];
        const spyRet60 = (macro.spy[i] - macro.spy[i - 60]) / macro.spy[i - 60];
        row[85] = stockRet60 - spyRet60;
      }
      // Rolling correlation with SPY (20d)
      if (i >= 19 && spyLogRet.length > 0) {
        const corr = rollingCorr(logRet, spyLogRet, 20);
        row[86] = corr[i] ?? 0;
      }
    }

    // ── 87-89: Cross-Asset Correlations ──
    // Rolling correlation with VIX (20d)
    if (i >= 19 && vixLogRet.length > 0) {
      const corrVix = rollingCorr(logRet, vixLogRet, 20);
      row[87] = corrVix[i] ?? 0;
    }
    // Rolling beta to SPY (60d)
    if (i >= 59 && spyLogRet.length > 0) {
      const wStock = logRet.slice(i - 59, i + 1);
      const wSpy = spyLogRet.slice(i - 59, i + 1);
      const mStock = wStock.reduce((s, v) => s + v, 0) / 60;
      const mSpy = wSpy.reduce((s, v) => s + v, 0) / 60;
      let cov = 0, varSpy = 0;
      for (let j = 0; j < 60; j++) {
        cov += (wStock[j] - mStock) * (wSpy[j] - mSpy);
        varSpy += (wSpy[j] - mSpy) ** 2;
      }
      row[88] = cov / (varSpy + 1e-10);
    } else {
      row[88] = 1.0; // default beta
    }
    // Volume-price correlation (20d)
    if (i >= 19) {
      const corrVP = rollingCorr(logRet, volLogRet, 20);
      row[89] = corrVP[i] ?? 0;
    }

    // ── 90-93: Advanced Volume ──
    // MFI (14-period)
    if (i >= 13) {
      let posFlow = 0, negFlow = 0;
      for (let j = i - 13; j <= i; j++) {
        const tp = typicalPrice[j];
        const flow = tp * volume[j];
        if (j > 0 && tp > typicalPrice[j - 1]) posFlow += flow;
        else if (j > 0) negFlow += flow;
      }
      const mRatio = posFlow / (negFlow + 1e-10);
      row[90] = 100 - 100 / (1 + mRatio);
    }
    // A/D line z-score
    if (adMean20[i] != null && adStd20[i] != null) {
      row[91] = (adLine[i] - adMean20[i]!) / (adStd20[i]! + 1e-10);
    }
    // VWAP deviation
    if (i >= 19) {
      let tpVolSum = 0, volSum = 0;
      for (let j = i - 19; j <= i; j++) {
        tpVolSum += typicalPrice[j] * volume[j];
        volSum += volume[j];
      }
      const vwap = tpVolSum / (volSum + 1);
      row[92] = ((close[i] - vwap) / vwap) * 100;
    }
    // Force Index (13-period EMA)
    if (i >= 13) {
      // Approximate 13-period EMA of (close_diff * volume)
      const k13 = 2 / 14;
      let forceEma = 0;
      for (let j = Math.max(1, i - 25); j <= i; j++) {
        const forceRaw = (close[j] - close[j - 1]) * volume[j];
        forceEma = forceEma * (1 - k13) + forceRaw * k13;
      }
      const avgVol = (vol20[i] ?? volume[i]) as number;
      row[93] = (forceEma / (close[i] * avgVol + 1e-10)) * 100;
    }

    // ── 94-98: Price Structure ──
    // Range position 20d
    if (i >= 19) {
      let lo = Infinity, hi = -Infinity;
      for (let j = i - 19; j <= i; j++) { if (low[j] < lo) lo = low[j]; if (high[j] > hi) hi = high[j]; }
      row[94] = (close[i] - lo) / (hi - lo + 1e-10);
    }
    // Range position 60d
    if (i >= 59) {
      let lo = Infinity, hi = -Infinity;
      for (let j = i - 59; j <= i; j++) { if (low[j] < lo) lo = low[j]; if (high[j] > hi) hi = high[j]; }
      row[95] = (close[i] - lo) / (hi - lo + 1e-10);
    }
    // ATR ratio 7/60
    if (atr7Arr[i] != null && atr60Arr[i] != null) {
      row[96] = atr7Arr[i]! / (atr60Arr[i]! + 1e-10);
    }
    // Consecutive up days
    if (i >= 1) {
      let count = 0;
      for (let j = i; j >= 1; j--) {
        if (close[j] > close[j - 1]) count++;
        else break;
      }
      row[97] = count / 10.0;
    }
    // Candle body ratio (5d avg)
    if (i >= 4) {
      let bodySum = 0;
      for (let j = i - 4; j <= i; j++) {
        const body = Math.abs(close[j] - open[j]);
        const wick = high[j] - low[j] + 1e-10;
        bodySum += body / wick;
      }
      row[98] = bodySum / 5;
    }

    // ── 99-103: Statistical Regime Detection ──
    // Hurst exponent (100-day window)
    if (i >= 99) {
      row[99] = hurstRS(logRet.slice(i - 99, i + 1));
    } else {
      row[99] = 0.5;
    }
    // Parkinson volatility (20d)
    if (i >= 19) {
      let hlSum = 0;
      for (let j = i - 19; j <= i; j++) {
        hlSum += Math.log(high[j] / low[j]) ** 2;
      }
      row[100] = Math.sqrt(hlSum / (4 * 20 * Math.log(2))) * Math.sqrt(252);
    }
    // Garman-Klass volatility (20d)
    if (i >= 19) {
      let gkSum = 0;
      for (let j = i - 19; j <= i; j++) {
        gkSum += 0.5 * Math.log(high[j] / low[j]) ** 2
          - (2 * Math.log(2) - 1) * Math.log(close[j] / open[j]) ** 2;
      }
      row[101] = Math.sqrt((gkSum / 20) * 252);
    }
    // Return consistency (signal-to-noise 20d)
    if (i >= 19) {
      const w = logRet.slice(i - 19, i + 1);
      const m = w.reduce((s, v) => s + v, 0) / 20;
      const std = Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / 20) + 1e-10;
      row[102] = Math.abs(m) / std;
    }
    // Tail ratio (20d)
    if (i >= 19) {
      const w = logRet.slice(i - 19, i + 1).slice().sort((a, b) => a - b);
      const top5 = w[w.length - 1]; // 95th percentile approx
      const bottom5 = Math.abs(w[0]) + 1e-10; // 5th percentile approx
      row[103] = top5 / bottom5;
    }

    // ── 104-107: Intermarket ──
    // SPY returns
    if (macro?.spy) {
      if (i >= 5 && macro.spy[i - 5] > 0) {
        row[104] = (macro.spy[i] - macro.spy[i - 5]) / macro.spy[i - 5];
      }
      if (i >= 20 && macro.spy[i - 20] > 0) {
        row[105] = (macro.spy[i] - macro.spy[i - 20]) / macro.spy[i - 20];
      }
    }
    // Gold/Oil ratio change (20d)
    if (macro?.gold && macro?.oil && i >= 20) {
      const goldOilNow = macro.gold[i] / (macro.oil[i] + 1e-10);
      const goldOilPrev = macro.gold[i - 20] / (macro.oil[i - 20] + 1e-10);
      if (goldOilPrev > 0) row[106] = (goldOilNow - goldOilPrev) / goldOilPrev;
    }
    // DXY-VIX interaction
    if (macro?.dxy && macro?.vix && i >= 5) {
      const dxyChg = macro.dxy[i - 5] > 0 ? (macro.dxy[i] - macro.dxy[i - 5]) / macro.dxy[i - 5] : 0;
      const vixChg = macro.vix[i - 5] > 0 ? (macro.vix[i] - macro.vix[i - 5]) / macro.vix[i - 5] : 0;
      row[107] = dxyChg * vixChg * 100;
    }

    // ── 108-110: Sector ETF Relative Strength ──
    if (macro?.sectorEtf) {
      if (i >= 5 && macro.sectorEtf[i - 5] > 0) {
        const stockRet5 = (close[i] - close[i - 5]) / close[i - 5];
        const sectorRet5 = (macro.sectorEtf[i] - macro.sectorEtf[i - 5]) / macro.sectorEtf[i - 5];
        row[108] = stockRet5 - sectorRet5;
      }
      if (i >= 20 && macro.sectorEtf[i - 20] > 0) {
        const stockRet20 = (close[i] - close[i - 20]) / close[i - 20];
        const sectorRet20 = (macro.sectorEtf[i] - macro.sectorEtf[i - 20]) / macro.sectorEtf[i - 20];
        row[109] = stockRet20 - sectorRet20;
      }
      if (i >= 19 && sectorLogRet.length > 0) {
        const corrSector = rollingCorr(logRet, sectorLogRet, 20);
        row[110] = corrSector[i] ?? 0;
      }
    }

    // ── 111-114: Credit Market Signals ──
    if (macro?.hyg && i >= 20 && macro.hyg[i - 20] > 0) {
      row[111] = (macro.hyg[i] - macro.hyg[i - 20]) / macro.hyg[i - 20];
    }
    if (macro?.tlt && i >= 20 && macro.tlt[i - 20] > 0) {
      row[112] = (macro.tlt[i] - macro.tlt[i - 20]) / macro.tlt[i - 20];
    }
    // Credit spread proxy: HYG/TLT ratio change (rising = risk-on, falling = risk-off)
    if (macro?.hyg && macro?.tlt && i >= 20) {
      const hygTltNow = macro.hyg[i] / (macro.tlt[i] + 1e-10);
      const hygTltPrev = macro.hyg[i - 20] / (macro.tlt[i - 20] + 1e-10);
      if (hygTltPrev > 0) row[113] = (hygTltNow - hygTltPrev) / hygTltPrev;
    }
    // HYG-SPY divergence (risk appetite check)
    if (macro?.hyg && macro?.spy && i >= 20 && macro.hyg[i - 20] > 0 && macro.spy[i - 20] > 0) {
      const hygRet = (macro.hyg[i] - macro.hyg[i - 20]) / macro.hyg[i - 20];
      const spyRet = (macro.spy[i] - macro.spy[i - 20]) / macro.spy[i - 20];
      row[114] = hygRet - spyRet;
    }

    // ── 115: VIX 9-Day Term Structure ──
    if (macro?.vix9d && macro?.vix && macro.vix[i] > 0 && macro.vix9d[i] > 0) {
      row[115] = macro.vix9d[i] / macro.vix[i];
    } else {
      row[115] = 1.0; // neutral default
    }

    // ── 116-117: Industry Commodity Sensitivity ──
    if (macro?.industryCommodity) {
      if (i >= 19 && commodityLogRet.length > 0) {
        const corrCom = rollingCorr(logRet, commodityLogRet, 20);
        row[116] = corrCom[i] ?? 0;
      }
      if (i >= 20 && macro.industryCommodity[i - 20] > 0) {
        row[117] = (macro.industryCommodity[i] - macro.industryCommodity[i - 20]) / macro.industryCommodity[i - 20];
      }
    }

    // ── 118: Copper/Gold Ratio Change (economic health proxy) ──
    if (macro?.copper && macro?.gold && i >= 20) {
      const cuAuNow = macro.copper[i] / (macro.gold[i] + 1e-10);
      const cuAuPrev = macro.copper[i - 20] / (macro.gold[i - 20] + 1e-10);
      if (cuAuPrev > 0) row[118] = (cuAuNow - cuAuPrev) / cuAuPrev;
    }

    // ── 119: Bitcoin Sentiment (risk-on indicator) ──
    if (macro?.btc && i >= 20 && macro.btc[i - 20] > 0) {
      row[119] = (macro.btc[i] - macro.btc[i - 20]) / macro.btc[i - 20];
    }

    // ── 120-125: FRED Macro Features ──
    if (macro?.fredHySpread && macro.fredHySpread[i] > 0) {
      row[120] = macro.fredHySpread[i]; // HY OAS spread level (typically 3-10%)
    }
    if (macro?.fredYieldCurve) {
      row[121] = macro.fredYieldCurve[i] ?? 0; // 10Y-2Y spread (can be negative = inversion)
    }
    if (macro?.fredBreakeven && macro.fredBreakeven[i] > 0) {
      row[122] = macro.fredBreakeven[i]; // breakeven inflation rate
    }
    if (macro?.fredTreasury2y && macro.fredTreasury2y[i] > 0) {
      row[123] = macro.fredTreasury2y[i]; // 2Y yield level
    }
    // Jobless claims: z-score over 20-day window (weekly data forward-filled to daily)
    if (macro?.fredJoblessClaims && i >= 19) {
      const claimsWindow = macro.fredJoblessClaims.slice(i - 19, i + 1);
      const claimsMean = claimsWindow.reduce((s, v) => s + v, 0) / 20;
      const claimsStd = Math.sqrt(claimsWindow.reduce((s, v) => s + (v - claimsMean) ** 2, 0) / 20) + 1e-10;
      row[124] = (macro.fredJoblessClaims[i] - claimsMean) / claimsStd;
    }
    // Consumer sentiment: 20-day change (monthly data forward-filled)
    if (macro?.fredConsumerSentiment && i >= 20 && macro.fredConsumerSentiment[i] > 0 && macro.fredConsumerSentiment[i - 20] > 0) {
      row[125] = (macro.fredConsumerSentiment[i] - macro.fredConsumerSentiment[i - 20]) / macro.fredConsumerSentiment[i - 20];
    }

    // ── 126-131: Gamma Squeeze Proxies ──
    // Volume acceleration (3d avg / 10d avg)
    if (i >= 9) {
      const vol3Avg = (volume[i] + volume[i-1] + volume[i-2]) / 3;
      let vol10Sum = 0;
      for (let j = i - 9; j <= i; j++) vol10Sum += volume[j];
      const vol10Avg = vol10Sum / 10;
      row[126] = vol3Avg / (vol10Avg + 1);
    }
    // Price-volume momentum (5d return × volume ratio)
    if (i >= 4) {
      const ret5 = close[i - 5] > 0 ? (close[i] - close[i - 5]) / close[i - 5] : 0;
      const vol3Avg = (volume[i] + volume[i-1] + volume[i-2]) / 3;
      let vol10Sum = 0;
      for (let j = Math.max(0, i - 9); j <= i; j++) vol10Sum += volume[j];
      const vol10Avg = vol10Sum / Math.min(10, i + 1);
      row[127] = ret5 * (vol3Avg / (vol10Avg + 1));
    }
    // Range expansion ratio (intraday range vs 20d average)
    if (i >= 19) {
      const rangeToday = (high[i] - low[i]) / (close[i] + 1e-10);
      let avgRange = 0;
      for (let j = i - 19; j <= i; j++) avgRange += (high[j] - low[j]) / (close[j] + 1e-10);
      avgRange /= 20;
      row[128] = rangeToday / (avgRange + 1e-10);
    }
    // Gap acceleration (10d gap freq - 20d gap freq)
    if (i >= 19) {
      let gapFreq10 = 0, gapFreq20 = 0;
      for (let j = i - 9; j <= i; j++) {
        if (Math.abs(gap[j]) > 0.01) gapFreq10++;
      }
      for (let j = i - 19; j <= i; j++) {
        if (Math.abs(gap[j]) > 0.01) gapFreq20++;
      }
      row[129] = gapFreq10 / 10 - gapFreq20 / 20;
    }
    // Squeeze breakout signal (close > upper BB + high volume z-score)
    if (bbSma[i] != null && bbStd[i] != null && vol20[i] != null && volStd20[i] != null) {
      const bbUpper = bbSma[i]! + 2 * bbStd[i]!;
      const aboveBB = close[i] > bbUpper ? 1 : 0;
      const volZ = (volume[i] - vol20[i]!) / (volStd20[i]! + 1e-10);
      row[130] = aboveBB * (volZ > 1.5 ? 1 : 0);
    }
    // Volume-price impact (abs return / relative volume)
    if (i >= 1 && vol20[i] != null) {
      const absRet = Math.abs(close[i] - close[i - 1]) / (close[i - 1] + 1e-10);
      const relVol = volume[i] / (vol20[i]! + 1);
      row[131] = absRet / (relVol + 1e-10);
    }

    // ── 132-135: Market Breadth & Rotation ──
    // Tech rotation (QQQ - SPY 20d return)
    if (macro?.qqq && macro?.spy && i >= 20 && macro.qqq[i - 20] > 0 && macro.spy[i - 20] > 0) {
      const qqqRet = (macro.qqq[i] - macro.qqq[i - 20]) / macro.qqq[i - 20];
      const spyRet = (macro.spy[i] - macro.spy[i - 20]) / macro.spy[i - 20];
      row[132] = qqqRet - spyRet;
    }
    // Small cap rotation (IWM - SPY 20d return)
    if (macro?.iwm && macro?.spy && i >= 20 && macro.iwm[i - 20] > 0 && macro.spy[i - 20] > 0) {
      const iwmRet = (macro.iwm[i] - macro.iwm[i - 20]) / macro.iwm[i - 20];
      const spyRet = (macro.spy[i] - macro.spy[i - 20]) / macro.spy[i - 20];
      row[133] = iwmRet - spyRet;
    }
    // SOX semiconductor momentum (20d return)
    if (macro?.sox && i >= 20 && macro.sox[i - 20] > 0) {
      row[134] = (macro.sox[i] - macro.sox[i - 20]) / macro.sox[i - 20];
    }
    // XBI biotech momentum (20d return)
    if (macro?.xbi && i >= 20 && macro.xbi[i - 20] > 0) {
      row[135] = (macro.xbi[i] - macro.xbi[i - 20]) / macro.xbi[i - 20];
    }

    // ── 136-139: Sentiment Proxies ──
    // Realized vs implied volatility ratio
    if (macro?.vix && macro.vix[i] > 0 && vol20d[i] != null) {
      const hv20Ann = vol20d[i]! * Math.sqrt(252);
      row[136] = hv20Ann / (macro.vix[i] / 100 + 1e-10);
    } else {
      row[136] = 1.0;
    }
    // VIX-SPY short-term correlation (10d)
    if (macro?.vix && macro?.spy && i >= 9) {
      const vixRets: number[] = [];
      const spyRets: number[] = [];
      for (let j = i - 9; j <= i; j++) {
        vixRets.push(j > 0 && macro.vix![j-1] > 0 ? (macro.vix![j] - macro.vix![j-1]) / macro.vix![j-1] : 0);
        spyRets.push(j > 0 && macro.spy![j-1] > 0 ? (macro.spy![j] - macro.spy![j-1]) / macro.spy![j-1] : 0);
      }
      const corrResult = rollingCorr(vixRets, spyRets, 10);
      row[137] = corrResult[9] ?? -0.7;
    } else {
      row[137] = -0.7; // typical negative correlation
    }
    // Credit momentum 10d (HYG 10d return)
    if (macro?.hyg && i >= 10 && macro.hyg[i - 10] > 0) {
      row[138] = (macro.hyg[i] - macro.hyg[i - 10]) / macro.hyg[i - 10];
    }
    // Fear composite (VIX z-score × (1 - credit spread change))
    if (macro?.vix && i >= 19) {
      const vixW = macro.vix.slice(i - 19, i + 1);
      const vixM = vixW.reduce((a, b) => a + b, 0) / 20;
      const vixS = Math.sqrt(vixW.reduce((a, b) => a + (b - vixM) ** 2, 0) / 20) + 1e-10;
      const vixZ = (macro.vix[i] - vixM) / vixS;
      if (macro?.hyg && macro?.tlt && i >= 20 && macro.tlt[i] > 0 && macro.tlt[i - 20] > 0) {
        const hygTltNow = macro.hyg[i] / (macro.tlt[i] + 1e-10);
        const hygTltPrev = macro.hyg[i - 20] / (macro.tlt[i - 20] + 1e-10);
        const creditChg = hygTltPrev > 0 ? (hygTltNow - hygTltPrev) / hygTltPrev : 0;
        row[139] = vixZ * (1 - creditChg);
      } else {
        row[139] = vixZ;
      }
    }

    // ── 140-143: Stock-Specific Drivers ──
    if (macro?.stockDriver1) {
      if (i >= 20 && macro.stockDriver1[i - 20] > 0) {
        row[140] = (macro.stockDriver1[i] - macro.stockDriver1[i - 20]) / macro.stockDriver1[i - 20];
      }
      if (i >= 19) {
        // Compute correlation between stock log returns and driver log returns
        const driverLogRet: number[] = [];
        for (let j = 0; j <= i; j++) {
          driverLogRet.push(j === 0 || !macro.stockDriver1[j - 1] || macro.stockDriver1[j - 1] <= 0
            ? 0 : Math.log(macro.stockDriver1[j] / macro.stockDriver1[j - 1]));
        }
        const corrD1 = rollingCorr(logRet.slice(0, i + 1), driverLogRet, 20);
        row[141] = corrD1[i] ?? 0;
      }
    }
    if (macro?.stockDriver2) {
      if (i >= 20 && macro.stockDriver2[i - 20] > 0) {
        row[142] = (macro.stockDriver2[i] - macro.stockDriver2[i - 20]) / macro.stockDriver2[i - 20];
      }
      if (i >= 19) {
        const driver2LogRet: number[] = [];
        for (let j = 0; j <= i; j++) {
          driver2LogRet.push(j === 0 || !macro.stockDriver2[j - 1] || macro.stockDriver2[j - 1] <= 0
            ? 0 : Math.log(macro.stockDriver2[j] / macro.stockDriver2[j - 1]));
        }
        const corrD2 = rollingCorr(logRet.slice(0, i + 1), driver2LogRet, 20);
        row[143] = corrD2[i] ?? 0;
      }
    }

    // ── 144-145: FRED Extended ──
    if (macro?.fredFinancialStress) {
      row[144] = macro.fredFinancialStress[i] ?? 0;
    }
    if (macro?.fredT10y3mSpread) {
      row[145] = macro.fredT10y3mSpread[i] ?? 0;
    }

    // ── 146-147: FRED Rates — Fed Funds Rate ──
    if (macro?.fredFedFundsRate) {
      row[146] = macro.fredFedFundsRate[i] ?? 0;
      if (i >= 20 && macro.fredFedFundsRate[i - 20] != null) {
        row[147] = (macro.fredFedFundsRate[i] ?? 0) - (macro.fredFedFundsRate[i - 20] ?? 0);
      }
    }

    // ── 148-149: FRED FX — JPY/USD ──
    if (macro?.fredJpyUsd && macro.fredJpyUsd[i]) {
      if (i >= 20 && macro.fredJpyUsd[i - 20]) {
        row[148] = (macro.fredJpyUsd[i] - macro.fredJpyUsd[i - 20]) / macro.fredJpyUsd[i - 20];
      }
      // Z-score of JPY/USD over 20d
      if (i >= 19) {
        const jpySlice = macro.fredJpyUsd.slice(Math.max(0, i - 19), i + 1).filter(v => v > 0);
        if (jpySlice.length >= 5) {
          const mean = jpySlice.reduce((a, b) => a + b, 0) / jpySlice.length;
          const stdDev = Math.sqrt(jpySlice.reduce((a, b) => a + (b - mean) ** 2, 0) / jpySlice.length) + 1e-10;
          row[149] = (macro.fredJpyUsd[i] - mean) / stdDev;
        }
      }
    }

    // ── 150-151: CBOE SKEW Index — tail risk ──
    if (macro?.skew && macro.skew[i]) {
      row[150] = macro.skew[i];
      // Z-score of SKEW over 20d
      if (i >= 19) {
        const skewSlice = macro.skew.slice(Math.max(0, i - 19), i + 1).filter(v => v > 0);
        if (skewSlice.length >= 5) {
          const mean = skewSlice.reduce((a, b) => a + b, 0) / skewSlice.length;
          const stdDev = Math.sqrt(skewSlice.reduce((a, b) => a + (b - mean) ** 2, 0) / skewSlice.length) + 1e-10;
          row[151] = (macro.skew[i] - mean) / stdDev;
        }
      }
    }

    // ── 152: Value/Growth Rotation — IWF vs IWD spread ──
    if (macro?.iwf && macro?.iwd && i >= 20 &&
        macro.iwf[i] && macro.iwf[i - 20] && macro.iwd[i] && macro.iwd[i - 20]) {
      const iwfReturn = Math.log(macro.iwf[i] / macro.iwf[i - 20]);
      const iwdReturn = Math.log(macro.iwd[i] / macro.iwd[i - 20]);
      row[152] = iwfReturn - iwdReturn; // positive = growth outperforming value
    }

    // ── 153: Risk Appetite — XLY vs XLP spread ──
    if (macro?.xly && macro?.xlp && i >= 20 &&
        macro.xly[i] && macro.xly[i - 20] && macro.xlp[i] && macro.xlp[i - 20]) {
      const xlyReturn = Math.log(macro.xly[i] / macro.xly[i - 20]);
      const xlpReturn = Math.log(macro.xlp[i] / macro.xlp[i - 20]);
      row[153] = xlyReturn - xlpReturn; // positive = risk-on, negative = risk-off
    }

    // ── 154: RSI Divergence (20d) ──
    // Detects price making new highs while RSI declines (bearish divergence) or vice versa
    // Output: -1 (bearish divergence), 0 (no divergence), +1 (bullish divergence)
    if (i >= 20 && rsi14[i] != null && rsi14[i - 20] != null) {
      const priceChange = close[i] - close[i - 20];
      const rsiChange = (rsi14[i] ?? 50) - (rsi14[i - 20] ?? 50);
      // Bearish: price up significantly but RSI down
      if (priceChange > 0 && close[i - 20] > 0 && priceChange / close[i - 20] > 0.02 && rsiChange < -5) {
        row[154] = -1;
      // Bullish: price down significantly but RSI up
      } else if (priceChange < 0 && close[i - 20] > 0 && priceChange / close[i - 20] < -0.02 && rsiChange > 5) {
        row[154] = 1;
      }
    }

    // ── 155: Volume-Weighted Return (5d) ──
    // 5d return weighted by average relative volume over that period
    if (i >= 5 && close[i - 5] > 0 && vol20[i] != null) {
      const ret5 = (close[i] - close[i - 5]) / close[i - 5];
      let relVolSum = 0;
      for (let j = i - 4; j <= i; j++) {
        relVolSum += volume[j] / ((vol20[j] as number ?? volume[j]) + 1);
      }
      const avgRelVol = relVolSum / 5;
      row[155] = ret5 * avgRelVol;
    }

    // ── 156: Trend Agreement Score ──
    // Fraction of SMA timeframes (5, 20, 50, 200) where price is above SMA
    // 1.0 = all bullish, 0.0 = all bearish, 0.5 = mixed
    {
      let agreements = 0;
      let total = 0;
      if (sma5[i] != null) { total++; if (close[i] > sma5[i]!) agreements++; }
      if (sma20[i] != null) { total++; if (close[i] > sma20[i]!) agreements++; }
      if (sma50[i] != null) { total++; if (close[i] > sma50[i]!) agreements++; }
      if (sma200[i] != null) { total++; if (close[i] > sma200[i]!) agreements++; }
      row[156] = total > 0 ? agreements / total : 0.5;
    }

    // ── 157: Price Acceleration (10d) ──
    // 2nd derivative: (5d return now) - (5d return 5 days ago)
    // Positive = accelerating up, negative = decelerating or accelerating down
    if (i >= 10 && close[i - 5] > 0 && close[i - 10] > 0) {
      const ret5Now = (close[i] - close[i - 5]) / close[i - 5];
      const ret5Prev = (close[i - 5] - close[i - 10]) / close[i - 10];
      row[157] = ret5Now - ret5Prev;
    }

    // ── 158: Overnight Return Ratio (20d) ──
    // Fraction of 20d total return that comes from overnight gaps
    // High ratio = institutional/news-driven; low ratio = intraday/retail-driven
    if (i >= 20) {
      let overnightSum = 0;
      let totalRetSum = 0;
      for (let j = i - 19; j <= i; j++) {
        if (j >= 1) {
          const overnightRet = Math.abs(open[j] - close[j - 1]);
          const totalRet = Math.abs(close[j] - close[j - 1]);
          overnightSum += overnightRet;
          totalRetSum += totalRet;
        }
      }
      row[158] = totalRetSum > 0 ? overnightSum / totalRetSum : 0.5;
    }

    // ── 159: Keltner Channel Position ──
    // Position within ATR-based Keltner Channel (different from Bollinger's vol-based)
    // 0 = at lower band, 0.5 = at middle (EMA), 1 = at upper band
    if (i >= 19 && atr14[i] != null) {
      const midline = ema12[i]; // Use 12-period EMA as center
      const upperKC = midline + 2 * atr14[i]!;
      const lowerKC = midline - 2 * atr14[i]!;
      const kcWidth = upperKC - lowerKC;
      row[159] = kcWidth > 0 ? (close[i] - lowerKC) / kcWidth : 0.5;
    }

    // ── 160: Mean Reversion Speed (20d) ──
    // How quickly price reverts to 20d SMA after deviation
    // Computed as correlation between deviation and next-day return over 20d window
    if (i >= 20 && closeMean20[i] != null && closeStd20[i] != null) {
      const deviations: number[] = [];
      const nextReturns: number[] = [];
      for (let j = i - 19; j < i; j++) {
        if (closeMean20[j] != null && closeStd20[j] != null && (closeStd20[j] as number) > 0) {
          deviations.push((close[j] - (closeMean20[j] as number)) / ((closeStd20[j] as number) + 1e-10));
          nextReturns.push(j + 1 < n ? (close[j + 1] - close[j]) / (close[j] + 1e-10) : 0);
        }
      }
      if (deviations.length >= 10) {
        // Negative correlation = mean-reverting; positive = trending
        const mDev = deviations.reduce((a, b) => a + b, 0) / deviations.length;
        const mRet = nextReturns.reduce((a, b) => a + b, 0) / nextReturns.length;
        let cov = 0, vDev = 0, vRet = 0;
        for (let k = 0; k < deviations.length; k++) {
          const dd = deviations[k] - mDev;
          const dr = nextReturns[k] - mRet;
          cov += dd * dr;
          vDev += dd * dd;
          vRet += dr * dr;
        }
        const denom = Math.sqrt(vDev * vRet) + 1e-10;
        row[160] = cov / denom; // negative = mean-reverting, positive = trending
      }
    }

    // ── 161: Sector Breadth — Bullish ──
    // Fraction of sector ETFs with positive 20d returns (market breadth)
    if (macro?.sectorEtfs && i >= 20) {
      const etfKeys = Object.keys(macro.sectorEtfs);
      let bullCount = 0;
      let totalCount = 0;
      for (const key of etfKeys) {
        const etfData = macro.sectorEtfs[key];
        if (etfData && etfData[i] > 0 && etfData[i - 20] > 0) {
          totalCount++;
          if (etfData[i] > etfData[i - 20]) bullCount++;
        }
      }
      row[161] = totalCount > 0 ? bullCount / totalCount : 0.5;
    }

    // ── 162: Credit-Equity Divergence Speed ──
    // 5d rate of change of HYG-SPY divergence — fast divergence signals regime change
    if (macro?.hyg && macro?.spy && i >= 25 && macro.hyg[i - 5] > 0 && macro.spy[i - 5] > 0 &&
        macro.hyg[i - 20] > 0 && macro.spy[i - 20] > 0 && macro.hyg[i - 25] > 0 && macro.spy[i - 25] > 0) {
      const hygRetNow = (macro.hyg[i] - macro.hyg[i - 20]) / macro.hyg[i - 20];
      const spyRetNow = (macro.spy[i] - macro.spy[i - 20]) / macro.spy[i - 20];
      const divNow = hygRetNow - spyRetNow;

      const hygRetPrev = (macro.hyg[i - 5] - macro.hyg[i - 25]) / macro.hyg[i - 25];
      const spyRetPrev = (macro.spy[i - 5] - macro.spy[i - 25]) / macro.spy[i - 25];
      const divPrev = hygRetPrev - spyRetPrev;

      row[162] = divNow - divPrev; // positive = divergence widening (risk-off accelerating)
    }

    // ── 163: VIX Term Structure Momentum ──
    // 5d change in VIX3M/VIX contango ratio
    // Rising = increasing backwardation expectation; falling = normalizing
    if (macro?.vix && macro?.vix3m && i >= 5 &&
        macro.vix[i] > 0 && macro.vix[i - 5] > 0 &&
        macro.vix3m[i] > 0 && macro.vix3m[i - 5] > 0) {
      const ratioNow = macro.vix3m[i] / macro.vix[i];
      const ratioPrev = macro.vix3m[i - 5] / macro.vix[i - 5];
      row[163] = ratioNow - ratioPrev;
    }

    // ── 164: Real Interest Rate ──
    // Fed funds rate minus breakeven inflation — actual monetary tightening measure
    if (macro?.fredFedFundsRate && macro?.fredBreakeven) {
      const ffr = macro.fredFedFundsRate[i] ?? 0;
      const bei = macro.fredBreakeven[i] ?? 0;
      if (ffr > 0 && bei > 0) {
        row[164] = ffr - bei; // positive = restrictive, negative = accommodative
      }
    }

    // ── 165: Financial Stress Momentum ──
    // 5d change in STLFSI4 — speed of stress change matters more than level
    if (macro?.fredFinancialStress && i >= 5) {
      const stressNow = macro.fredFinancialStress[i] ?? 0;
      const stressPrev = macro.fredFinancialStress[i - 5] ?? 0;
      row[165] = stressNow - stressPrev; // positive = stress increasing
    }

    // ── 166-167: Wikipedia Pageview Sentiment — Retail Attention Proxy ──
    if (macro?.wikiPageviews) {
      const pv = macro.wikiPageviews[i] ?? 0;
      // Z-score of pageviews over 20d window
      if (i >= 19) {
        const pvSlice = macro.wikiPageviews.slice(i - 19, i + 1).filter(v => v > 0);
        if (pvSlice.length >= 5) {
          const pvMean = pvSlice.reduce((a, b) => a + b, 0) / pvSlice.length;
          const pvStd = Math.sqrt(pvSlice.reduce((a, b) => a + (b - pvMean) ** 2, 0) / pvSlice.length) + 1e-10;
          row[166] = (pv - pvMean) / pvStd;
        }
      }
      // 5d change in pageviews (momentum of attention)
      if (i >= 5 && macro.wikiPageviews[i - 5] > 0) {
        row[167] = (pv - macro.wikiPageviews[i - 5]) / macro.wikiPageviews[i - 5];
      }
    }

    // ── 168-169: FINRA Short Volume Sentiment — Institutional Positioning ──
    if (macro?.shortVolumeRatio) {
      const svr = macro.shortVolumeRatio[i] ?? 0;
      row[168] = svr; // raw ratio (typically 0.3-0.6)
      // Z-score over 20d window
      if (i >= 19) {
        const svrSlice = macro.shortVolumeRatio.slice(i - 19, i + 1).filter(v => v > 0);
        if (svrSlice.length >= 5) {
          const svrMean = svrSlice.reduce((a, b) => a + b, 0) / svrSlice.length;
          const svrStd = Math.sqrt(svrSlice.reduce((a, b) => a + (b - svrMean) ** 2, 0) / svrSlice.length) + 1e-10;
          row[169] = (svr - svrMean) / svrStd;
        }
      }
    }

    // ── 170-171: Finnhub Insider Sentiment — Smart Money Proxy ──
    if (macro?.insiderMspr) {
      const mspr = macro.insiderMspr[i] ?? 0;
      row[170] = mspr / 100; // Normalize to [-1, 1] range
      // 3-month (~63 trading days) momentum
      if (i >= 63 && macro.insiderMspr[i - 63] != null) {
        row[171] = (mspr - (macro.insiderMspr[i - 63] ?? 0)) / 100;
      }
    }

    // Replace NaN/Infinity
    for (let f = 0; f < 172; f++) {
      if (!isFinite(row[f])) row[f] = 0;
    }

    result.push(row);
  }

  return result;
}

/**
 * Normalize features using per-stock mean/std from model config.
 * Clips to [-5, 5] matching training normalization.
 */
export function normalizeFeatures(
  matrix: number[][],
  mean: number[],
  std: number[]
): number[][] {
  return matrix.map(row =>
    row.map((v, j) => {
      const normalized = (v - (mean[j] ?? 0)) / ((std[j] ?? 1) + 1e-10);
      return Math.max(-5, Math.min(5, normalized));
    })
  );
}

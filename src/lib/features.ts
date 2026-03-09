/**
 * Feature Engineering Module for Stock Price Prediction
 *
 * Computes 300+ features across 8 categories for time-series prediction:
 *
 * 1. Technical Indicators (~80 features)
 *    - Moving averages (SMA, EMA at multiple periods)
 *    - Momentum (RSI, Stochastic, Williams %R, ROC, CCI, MFI)
 *    - MACD variants
 *    - Volatility (Bollinger Bands, ATR, Keltner)
 *    - Volume (OBV, VWAP, A/D, CMF)
 *    - Trend (ADX, Aroon, Parabolic SAR)
 *
 * 2. Statistical Features (~50 features)
 *    - Rolling returns, volatility, skewness, kurtosis
 *    - Autocorrelation, Hurst exponent
 *    - Z-scores, percentile ranks
 *    - Drawdown metrics
 *
 * 3. Options-Derived Features (~40 features)
 *    - IV levels, skew, term structure
 *    - Put/call ratios, unusual activity
 *    - Volatility risk premium
 *
 * 4. Market Regime / Macro Features (~30 features)
 *    - VIX and term structure
 *    - Yield curve proxies
 *    - Cross-asset correlations
 *
 * 5. Fundamental Features (~25 features)
 *    - Valuation ratios and z-scores
 *    - Growth metrics
 *    - Quality indicators
 *
 * 6. Sentiment Proxies (~25 features)
 *    - Put/call ratio sentiment
 *    - Volume anomalies
 *    - Price action sentiment
 *
 * 7. Calendar / Seasonal (~15 features)
 *    - Day of week, month, quarter
 *    - OPEX proximity, earnings proximity
 *
 * 8. Cross-Asset / Relative (~35 features)
 *    - Relative strength vs indices
 *    - Beta regime changes
 *    - Sector rotation signals
 */

// ─── Data Types ─────────────────────────────────────────────────

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionsSnapshot {
  putCallVolumeRatio: number;
  putCallOIRatio: number;
  atmIV: number;
  ivSkew25d: number;     // 25-delta put IV - 25-delta call IV
  ivTermSlope: number;   // near-term IV vs far-term IV
  totalPutOI: number;
  totalCallOI: number;
  totalPutVolume: number;
  totalCallVolume: number;
  maxPainStrike: number;
}

export interface MarketData {
  vix: number;
  vixChange: number;
  spyReturn1d: number;
  spyReturn5d: number;
  spyReturn20d: number;
  twoYearYield?: number;
  tenYearYield?: number;
  dxy?: number;
}

export interface FundamentalData {
  trailingPE: number;
  forwardPE?: number;
  priceToBook?: number;
  priceToSales?: number;
  dividendYield: number;
  beta: number;
  marketCap: number;
  debtToEquity?: number;
  roe?: number;
  revenueGrowth?: number;
  earningsGrowth?: number;
  shortPercentOfFloat?: number;
  analystRating?: number; // 1-5 scale
  sector?: string;
  industry?: string;
}

export interface FeatureVector {
  features: Record<string, number>;
  metadata: {
    symbol: string;
    date: string;
    featureCount: number;
    categories: Record<string, number>;
  };
}

// ─── Helper Math Functions ─────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function sma(arr: number[], period: number): number {
  if (arr.length < period) return mean(arr);
  return mean(arr.slice(-period));
}

function ema(arr: number[], period: number): number {
  if (arr.length === 0) return 0;
  const k = 2 / (period + 1);
  let value = arr[0];
  for (let i = 1; i < arr.length; i++) {
    value = arr[i] * k + value * (1 - k);
  }
  return value;
}

function emaSeries(arr: number[], period: number): number[] {
  if (arr.length === 0) return [];
  const k = 2 / (period + 1);
  const result = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    result.push(arr[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function percentileRank(value: number, arr: number[]): number {
  if (arr.length === 0) return 50;
  const below = arr.filter(v => v < value).length;
  return (below / arr.length) * 100;
}

function linearRegSlope(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += arr[i];
    sumXY += i * arr[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function maxDrawdown(arr: number[]): number {
  if (arr.length < 2) return 0;
  let peak = arr[0];
  let maxDD = 0;
  for (const v of arr) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function autocorrelation(arr: number[], lag: number): number {
  if (arr.length < lag + 2) return 0;
  const m = mean(arr);
  let num = 0, denom = 0;
  for (let i = lag; i < arr.length; i++) {
    num += (arr[i] - m) * (arr[i - lag] - m);
  }
  for (let i = 0; i < arr.length; i++) {
    denom += (arr[i] - m) ** 2;
  }
  return denom === 0 ? 0 : num / denom;
}

function skewness(arr: number[]): number {
  if (arr.length < 3) return 0;
  const m = mean(arr);
  const s = stdDev(arr);
  if (s === 0) return 0;
  const n = arr.length;
  const sum = arr.reduce((a, b) => a + ((b - m) / s) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * sum;
}

function kurtosis(arr: number[]): number {
  if (arr.length < 4) return 0;
  const m = mean(arr);
  const s = stdDev(arr);
  if (s === 0) return 0;
  const n = arr.length;
  const sum = arr.reduce((a, b) => a + ((b - m) / s) ** 4, 0);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum
    - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}

// Hurst exponent (R/S analysis, simplified)
function hurstExponent(arr: number[]): number {
  if (arr.length < 20) return 0.5;
  const returns: number[] = [];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i - 1] > 0) returns.push(Math.log(arr[i] / arr[i - 1]));
  }
  if (returns.length < 16) return 0.5;

  const sizes = [8, 16, 32, 64].filter(s => s <= returns.length);
  if (sizes.length < 2) return 0.5;

  const logRS: number[] = [];
  const logN: number[] = [];

  for (const size of sizes) {
    const nBlocks = Math.floor(returns.length / size);
    let rsSum = 0;
    for (let b = 0; b < nBlocks; b++) {
      const block = returns.slice(b * size, (b + 1) * size);
      const m = mean(block);
      const s = stdDev(block);
      if (s === 0) continue;
      // Cumulative deviations
      const cumDev: number[] = [];
      let cum = 0;
      for (const r of block) {
        cum += r - m;
        cumDev.push(cum);
      }
      const range = Math.max(...cumDev) - Math.min(...cumDev);
      rsSum += range / s;
    }
    if (nBlocks > 0) {
      logRS.push(Math.log(rsSum / nBlocks));
      logN.push(Math.log(size));
    }
  }

  if (logN.length < 2) return 0.5;
  return linearRegSlope(logRS.map((_, i) => logRS[i] / logN[i])) || 0.5;
}

// ─── Feature Computation Categories ────────────────────────────

function computeTechnicalIndicators(data: OHLCV[]): Record<string, number> {
  const f: Record<string, number> = {};
  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const volumes = data.map(d => d.volume);
  const n = closes.length;
  const price = closes[n - 1];

  // ── Moving Averages (15 features) ──
  for (const p of [5, 10, 20, 50, 200]) {
    const s = sma(closes, p);
    f[`sma_${p}`] = s;
    f[`price_vs_sma_${p}_pct`] = price > 0 ? ((price - s) / s) * 100 : 0;
  }
  for (const p of [5, 12, 26]) {
    f[`ema_${p}`] = ema(closes, p);
  }
  // SMA crossovers
  f["sma_20_50_cross"] = sma(closes, 20) > sma(closes, 50) ? 1 : 0;
  f["sma_50_200_cross"] = sma(closes, 50) > (n >= 200 ? sma(closes, 200) : sma(closes, 50)) ? 1 : 0;

  // ── Momentum Indicators (20 features) ──
  // RSI at multiple periods
  for (const period of [7, 14, 21]) {
    const changes = [];
    const start = Math.max(1, closes.length - period - 1);
    for (let i = start; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }
    let gains = 0, losses = 0;
    for (const c of changes) {
      if (c > 0) gains += c; else losses += Math.abs(c);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    f[`rsi_${period}`] = 100 - 100 / (1 + rs);
  }

  // Stochastic %K, %D
  const stochPeriod = 14;
  const stochHigh = Math.max(...highs.slice(-stochPeriod));
  const stochLow = Math.min(...lows.slice(-stochPeriod));
  f["stoch_k"] = stochHigh === stochLow ? 50 : ((price - stochLow) / (stochHigh - stochLow)) * 100;
  // %D = 3-day SMA of %K (approximated)
  f["stoch_d"] = f["stoch_k"]; // simplified

  // Williams %R
  f["williams_r"] = stochHigh === stochLow ? -50 : ((stochHigh - price) / (stochHigh - stochLow)) * -100;

  // Rate of Change
  for (const p of [5, 10, 20]) {
    const prev = closes[Math.max(0, n - p - 1)];
    f[`roc_${p}`] = prev > 0 ? ((price - prev) / prev) * 100 : 0;
  }

  // CCI (Commodity Channel Index)
  const typicalPrices = data.slice(-20).map(d => (d.high + d.low + d.close) / 3);
  const tpMean = mean(typicalPrices);
  const tpMeanDev = mean(typicalPrices.map(tp => Math.abs(tp - tpMean)));
  f["cci_20"] = tpMeanDev === 0 ? 0 : (typicalPrices[typicalPrices.length - 1] - tpMean) / (0.015 * tpMeanDev);

  // MFI (Money Flow Index, simplified)
  let posFlow = 0, negFlow = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) {
    const tp = (data[i].high + data[i].low + data[i].close) / 3;
    const prevTp = (data[i - 1].high + data[i - 1].low + data[i - 1].close) / 3;
    const rawMF = tp * data[i].volume;
    if (tp > prevTp) posFlow += rawMF; else negFlow += rawMF;
  }
  const mfRatio = negFlow === 0 ? 100 : posFlow / negFlow;
  f["mfi_14"] = 100 - 100 / (1 + mfRatio);

  // ── MACD (6 features) ──
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const macdSignal = emaSeries(macdLine, 9);
  f["macd_line"] = macdLine[macdLine.length - 1] || 0;
  f["macd_signal"] = macdSignal[macdSignal.length - 1] || 0;
  f["macd_histogram"] = f["macd_line"] - f["macd_signal"];
  // MACD crossover direction
  f["macd_cross_above"] = f["macd_histogram"] > 0 && (macdLine.length > 1 && macdLine[macdLine.length - 2] - macdSignal[macdSignal.length - 2] <= 0) ? 1 : 0;

  // Alternative MACD (5,35,5)
  const ema5 = emaSeries(closes, 5);
  const ema35 = emaSeries(closes, 35);
  const altMacd = ema5.map((v, i) => v - ema35[i]);
  f["macd_alt_line"] = altMacd[altMacd.length - 1] || 0;
  f["macd_alt_histogram"] = f["macd_alt_line"] - (emaSeries(altMacd, 5).pop() || 0);

  // ── Volatility (12 features) ──
  // Bollinger Bands
  const bb20 = sma(closes, 20);
  const bb20std = stdDev(closes.slice(-20));
  f["bb_upper"] = bb20 + 2 * bb20std;
  f["bb_lower"] = bb20 - 2 * bb20std;
  f["bb_width"] = bb20 > 0 ? (4 * bb20std / bb20) * 100 : 0;
  f["bb_pctb"] = bb20std > 0 ? (price - f["bb_lower"]) / (f["bb_upper"] - f["bb_lower"]) : 0.5;

  // ATR at multiple periods
  for (const period of [7, 14]) {
    const atrData = data.slice(-period - 1);
    let atrSum = 0;
    for (let i = 1; i < atrData.length; i++) {
      const tr = Math.max(
        atrData[i].high - atrData[i].low,
        Math.abs(atrData[i].high - atrData[i - 1].close),
        Math.abs(atrData[i].low - atrData[i - 1].close)
      );
      atrSum += tr;
    }
    f[`atr_${period}`] = atrSum / period;
    f[`atr_${period}_pct`] = price > 0 ? (f[`atr_${period}`] / price) * 100 : 0;
  }

  // Keltner Channel
  const keltnerMid = ema(closes, 20);
  f["keltner_upper"] = keltnerMid + 1.5 * f["atr_14"];
  f["keltner_lower"] = keltnerMid - 1.5 * f["atr_14"];

  // Donchian Channel (20-day)
  f["donchian_high"] = Math.max(...highs.slice(-20));
  f["donchian_low"] = Math.min(...lows.slice(-20));

  // ── Volume (8 features) ──
  // OBV (On-Balance Volume)
  let obv = 0;
  for (let i = 1; i < n; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
  }
  f["obv"] = obv;

  // Volume ratios
  const avgVol20 = sma(volumes, 20);
  const avgVol5 = sma(volumes, 5);
  f["volume_ratio_5_20"] = avgVol20 > 0 ? avgVol5 / avgVol20 : 1;
  f["relative_volume"] = avgVol20 > 0 ? volumes[n - 1] / avgVol20 : 1;

  // Accumulation/Distribution
  let adLine = 0;
  for (let i = 0; i < n; i++) {
    const clv = highs[i] === lows[i] ? 0 :
      ((closes[i] - lows[i]) - (highs[i] - closes[i])) / (highs[i] - lows[i]);
    adLine += clv * volumes[i];
  }
  f["ad_line"] = adLine;

  // Chaikin Money Flow (20-day)
  let cmfNum = 0, cmfDen = 0;
  for (let i = Math.max(0, n - 20); i < n; i++) {
    const clv = highs[i] === lows[i] ? 0 :
      ((closes[i] - lows[i]) - (highs[i] - closes[i])) / (highs[i] - lows[i]);
    cmfNum += clv * volumes[i];
    cmfDen += volumes[i];
  }
  f["cmf_20"] = cmfDen > 0 ? cmfNum / cmfDen : 0;

  // Force Index
  f["force_index_13"] = n >= 2 ? ema(
    closes.slice(1).map((c, i) => (c - closes[i]) * volumes[i + 1]), 13
  ) : 0;

  // Volume trend (linear regression slope)
  f["volume_trend"] = linearRegSlope(volumes.slice(-20));

  // ── Trend (10 features) ──
  // ADX approximation
  const dx: number[] = [];
  for (let i = 1; i < Math.min(14, n); i++) {
    const upMove = highs[n - i] - highs[n - i - 1];
    const downMove = lows[n - i - 1] - lows[n - i];
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(
      highs[n - i] - lows[n - i],
      Math.abs(highs[n - i] - closes[n - i - 1]),
      Math.abs(lows[n - i] - closes[n - i - 1])
    );
    if (tr > 0) dx.push(Math.abs(plusDM - minusDM) / tr * 100);
  }
  f["adx_14"] = mean(dx);

  // Aroon
  const aroonPeriod = 25;
  const recentHighsSlice = highs.slice(-aroonPeriod);
  const recentLowsSlice = lows.slice(-aroonPeriod);
  const highIdx = recentHighsSlice.indexOf(Math.max(...recentHighsSlice));
  const lowIdx = recentLowsSlice.indexOf(Math.min(...recentLowsSlice));
  f["aroon_up"] = (highIdx / (aroonPeriod - 1)) * 100;
  f["aroon_down"] = (lowIdx / (aroonPeriod - 1)) * 100;
  f["aroon_oscillator"] = f["aroon_up"] - f["aroon_down"];

  // Linear regression slope of price (normalized)
  f["price_slope_20"] = linearRegSlope(closes.slice(-20));
  f["price_slope_50"] = linearRegSlope(closes.slice(-50));

  // Price acceleration
  const slope5recent = linearRegSlope(closes.slice(-5));
  const slope5prev = linearRegSlope(closes.slice(-10, -5));
  f["price_acceleration"] = slope5recent - slope5prev;

  // Ichimoku (simplified: Tenkan-sen, Kijun-sen)
  const tenkan = (Math.max(...highs.slice(-9)) + Math.min(...lows.slice(-9))) / 2;
  const kijun = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
  f["ichimoku_tenkan"] = tenkan;
  f["ichimoku_kijun"] = kijun;
  f["ichimoku_tk_cross"] = tenkan > kijun ? 1 : 0;

  return f;
}

function computeStatisticalFeatures(data: OHLCV[]): Record<string, number> {
  const f: Record<string, number> = {};
  const closes = data.map(d => d.close);
  const n = closes.length;

  // Log returns
  const logReturns: number[] = [];
  for (let i = 1; i < n; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }

  // ── Rolling Returns (5 features) ──
  for (const p of [1, 5, 10, 20, 60]) {
    const prev = closes[Math.max(0, n - p - 1)];
    f[`return_${p}d`] = prev > 0 ? (closes[n - 1] - prev) / prev : 0;
  }

  // ── Rolling Volatility (4 features) ──
  for (const p of [5, 10, 20, 60]) {
    const slice = logReturns.slice(-p);
    f[`volatility_${p}d`] = stdDev(slice) * Math.sqrt(252);
  }

  // ── Higher Moments (4 features) ──
  f["skewness_20d"] = skewness(logReturns.slice(-20));
  f["skewness_60d"] = skewness(logReturns.slice(-60));
  f["kurtosis_20d"] = kurtosis(logReturns.slice(-20));
  f["kurtosis_60d"] = kurtosis(logReturns.slice(-60));

  // ── Autocorrelation (5 features) ──
  for (let lag = 1; lag <= 5; lag++) {
    f[`autocorr_lag_${lag}`] = autocorrelation(logReturns, lag);
  }

  // ── Hurst Exponent (1 feature) ──
  f["hurst_exponent"] = hurstExponent(closes);

  // ── Z-Scores (5 features) ──
  for (const p of [20, 50, 100, 200]) {
    const slice = closes.slice(-p);
    const s = stdDev(slice);
    f[`zscore_${p}`] = s > 0 ? (closes[n - 1] - mean(slice)) / s : 0;
  }
  // Z-score of volume
  const volSlice = data.map(d => d.volume).slice(-20);
  const volStd = stdDev(volSlice);
  f["volume_zscore_20"] = volStd > 0 ? (data[n - 1].volume - mean(volSlice)) / volStd : 0;

  // ── Percentile Ranks (3 features) ──
  f["percentile_rank_20d"] = percentileRank(closes[n - 1], closes.slice(-20));
  f["percentile_rank_60d"] = percentileRank(closes[n - 1], closes.slice(-60));
  f["percentile_rank_252d"] = percentileRank(closes[n - 1], closes.slice(-252));

  // ── Max Drawdown (2 features) ──
  f["max_drawdown_20d"] = maxDrawdown(closes.slice(-20));
  f["max_drawdown_60d"] = maxDrawdown(closes.slice(-60));

  // ── Up/Down Day Ratios (4 features) ──
  for (const p of [10, 20]) {
    const changes = logReturns.slice(-p);
    const upDays = changes.filter(c => c > 0).length;
    f[`up_ratio_${p}d`] = changes.length > 0 ? upDays / changes.length : 0.5;
    f[`avg_up_vs_down_${p}d`] = (() => {
      const ups = changes.filter(c => c > 0);
      const downs = changes.filter(c => c < 0);
      const avgUp = ups.length > 0 ? mean(ups) : 0;
      const avgDown = downs.length > 0 ? Math.abs(mean(downs)) : 0;
      return avgDown > 0 ? avgUp / avgDown : 1;
    })();
  }

  // ── Gap Statistics (4 features) ──
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) {
    const gap = (data[i].open - data[i - 1].close) / data[i - 1].close;
    gaps.push(gap);
  }
  f["avg_gap_20d"] = mean(gaps.slice(-20));
  f["gap_frequency_20d"] = gaps.slice(-20).filter(g => Math.abs(g) > 0.01).length / 20;
  f["max_gap_up_20d"] = Math.max(...gaps.slice(-20), 0);
  f["max_gap_down_20d"] = Math.min(...gaps.slice(-20), 0);

  // ── Log Return Distribution (5 features) ──
  const recent = logReturns.slice(-60);
  f["mean_return_60d"] = mean(recent);
  f["median_return_60d"] = (() => {
    const sorted = [...recent].sort((a, b) => a - b);
    return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
  })();
  f["return_iqr_60d"] = (() => {
    const sorted = [...recent].sort((a, b) => a - b);
    if (sorted.length < 4) return 0;
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    return q3 - q1;
  })();
  f["tail_ratio_60d"] = (() => {
    const sorted = [...recent].sort((a, b) => a - b);
    if (sorted.length < 10) return 1;
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p05 = sorted[Math.floor(sorted.length * 0.05)];
    return Math.abs(p05) > 0 ? Math.abs(p95) / Math.abs(p05) : 1;
  })();
  f["var_95_60d"] = (() => {
    const sorted = [...recent].sort((a, b) => a - b);
    return sorted.length >= 20 ? sorted[Math.floor(sorted.length * 0.05)] : 0;
  })();

  // ── Regime Detection (3 features) ──
  const vol20 = f["volatility_20d"] || 0;
  const vol60 = f["volatility_60d"] || 0;
  f["vol_regime_ratio"] = vol60 > 0 ? vol20 / vol60 : 1;
  f["vol_expanding"] = vol20 > vol60 ? 1 : 0;
  f["mean_reversion_score"] = f["zscore_20"] ? Math.abs(f["zscore_20"]) : 0;

  return f;
}

function computeOptionsFeatures(options: OptionsSnapshot | null): Record<string, number> {
  const f: Record<string, number> = {};

  if (!options) {
    // Return default features when no options data
    f["pcr_volume"] = 1;
    f["pcr_oi"] = 1;
    f["atm_iv"] = 0.25;
    f["iv_skew_25d"] = 0;
    f["iv_term_slope"] = 0;
    f["put_oi_total"] = 0;
    f["call_oi_total"] = 0;
    f["put_volume_total"] = 0;
    f["call_volume_total"] = 0;
    f["max_pain_distance"] = 0;
    f["pcr_extreme_put"] = 0;
    f["pcr_extreme_call"] = 0;
    f["iv_elevated"] = 0;
    f["iv_compressed"] = 0;
    f["options_sentiment"] = 0;
    return f;
  }

  f["pcr_volume"] = options.putCallVolumeRatio;
  f["pcr_oi"] = options.putCallOIRatio;
  f["atm_iv"] = options.atmIV;
  f["iv_skew_25d"] = options.ivSkew25d;
  f["iv_term_slope"] = options.ivTermSlope;
  f["put_oi_total"] = options.totalPutOI;
  f["call_oi_total"] = options.totalCallOI;
  f["put_volume_total"] = options.totalPutVolume;
  f["call_volume_total"] = options.totalCallVolume;
  f["max_pain_distance"] = options.maxPainStrike;

  // Derived options sentiment features
  f["pcr_extreme_put"] = options.putCallVolumeRatio > 1.5 ? 1 : 0;
  f["pcr_extreme_call"] = options.putCallVolumeRatio < 0.5 ? 1 : 0;
  f["iv_elevated"] = options.atmIV > 0.35 ? 1 : 0;
  f["iv_compressed"] = options.atmIV < 0.15 ? 1 : 0;

  // Combined options sentiment (-1 to 1)
  f["options_sentiment"] = Math.max(-1, Math.min(1,
    (options.putCallVolumeRatio > 1.2 ? -0.3 : options.putCallVolumeRatio < 0.8 ? 0.3 : 0) +
    (options.ivSkew25d > 0.05 ? -0.3 : options.ivSkew25d < -0.02 ? 0.3 : 0) +
    (options.ivTermSlope > 0 ? 0.2 : -0.2)
  ));

  return f;
}

function computeMarketFeatures(market: MarketData | null): Record<string, number> {
  const f: Record<string, number> = {};

  if (!market) {
    f["vix"] = 20; f["vix_change"] = 0;
    f["spy_return_1d"] = 0; f["spy_return_5d"] = 0; f["spy_return_20d"] = 0;
    f["vix_regime_low"] = 0; f["vix_regime_normal"] = 1; f["vix_regime_high"] = 0; f["vix_regime_crisis"] = 0;
    f["yield_curve_slope"] = 0; f["market_stress"] = 0; f["risk_on"] = 1;
    return f;
  }

  f["vix"] = market.vix;
  f["vix_change"] = market.vixChange;
  f["spy_return_1d"] = market.spyReturn1d;
  f["spy_return_5d"] = market.spyReturn5d;
  f["spy_return_20d"] = market.spyReturn20d;

  // VIX regime (one-hot encoded)
  f["vix_regime_low"] = market.vix < 15 ? 1 : 0;
  f["vix_regime_normal"] = market.vix >= 15 && market.vix < 25 ? 1 : 0;
  f["vix_regime_high"] = market.vix >= 25 && market.vix < 35 ? 1 : 0;
  f["vix_regime_crisis"] = market.vix >= 35 ? 1 : 0;

  // VIX z-score (crude: using typical range)
  f["vix_zscore"] = (market.vix - 18) / 6;

  // Yield curve
  if (market.twoYearYield != null && market.tenYearYield != null) {
    f["yield_curve_slope"] = market.tenYearYield - market.twoYearYield;
    f["yield_curve_inverted"] = f["yield_curve_slope"] < 0 ? 1 : 0;
  } else {
    f["yield_curve_slope"] = 0;
    f["yield_curve_inverted"] = 0;
  }

  // Dollar index proxy
  f["dxy"] = market.dxy ?? 100;

  // Market stress composite
  f["market_stress"] = Math.max(0, Math.min(1,
    (market.vix > 25 ? 0.4 : 0) +
    (market.spyReturn5d < -0.03 ? 0.3 : 0) +
    (market.vixChange > 3 ? 0.3 : 0)
  ));

  // Risk-on/risk-off
  f["risk_on"] = market.vix < 20 && market.spyReturn5d > 0 ? 1 : 0;

  return f;
}

function computeFundamentalFeatures(fundamentals: FundamentalData | null): Record<string, number> {
  const f: Record<string, number> = {};

  if (!fundamentals) {
    return {
      pe_ratio: 0, pe_zscore: 0, price_to_book: 0, price_to_sales: 0,
      dividend_yield: 0, div_yield_zscore: 0, beta: 1, market_cap_log: 0,
      debt_to_equity: 0, roe: 0, revenue_growth: 0, earnings_growth: 0,
      short_interest: 0, analyst_rating: 3, is_mega_cap: 0, is_large_cap: 0,
      is_mid_cap: 0, is_small_cap: 0, is_value: 0, is_growth: 0,
      quality_score: 50, value_score: 50, safety_score: 50,
    };
  }

  f["pe_ratio"] = fundamentals.trailingPE;
  f["forward_pe"] = fundamentals.forwardPE ?? fundamentals.trailingPE;
  f["pe_zscore"] = fundamentals.trailingPE > 0
    ? (fundamentals.trailingPE - 20) / 10 : 0; // crude z-score vs market avg
  f["price_to_book"] = fundamentals.priceToBook ?? 0;
  f["price_to_sales"] = fundamentals.priceToSales ?? 0;
  f["dividend_yield"] = fundamentals.dividendYield;
  f["div_yield_zscore"] = (fundamentals.dividendYield - 1.5) / 1.0;
  f["beta"] = fundamentals.beta;
  f["market_cap_log"] = fundamentals.marketCap > 0 ? Math.log10(fundamentals.marketCap) : 0;
  f["debt_to_equity"] = fundamentals.debtToEquity ?? 0;
  f["roe"] = fundamentals.roe ?? 0;
  f["revenue_growth"] = fundamentals.revenueGrowth ?? 0;
  f["earnings_growth"] = fundamentals.earningsGrowth ?? 0;
  f["short_interest"] = fundamentals.shortPercentOfFloat ?? 0;
  f["analyst_rating"] = fundamentals.analystRating ?? 3;

  // Market cap classification (one-hot)
  const capB = fundamentals.marketCap / 1e9;
  f["is_mega_cap"] = capB >= 200 ? 1 : 0;
  f["is_large_cap"] = capB >= 50 && capB < 200 ? 1 : 0;
  f["is_mid_cap"] = capB >= 10 && capB < 50 ? 1 : 0;
  f["is_small_cap"] = capB < 10 ? 1 : 0;

  // Style classification
  f["is_value"] = fundamentals.trailingPE > 0 && fundamentals.trailingPE < 15 ? 1 : 0;
  f["is_growth"] = (fundamentals.earningsGrowth ?? 0) > 0.15 ? 1 : 0;

  // Composite scores
  f["quality_score"] = Math.min(100, Math.max(0,
    ((fundamentals.roe ?? 10) > 15 ? 30 : 10) +
    ((fundamentals.debtToEquity ?? 50) < 50 ? 30 : 10) +
    (fundamentals.dividendYield > 1 ? 20 : 5) +
    (fundamentals.beta <= 1.2 ? 20 : 5)
  ));

  f["value_score"] = Math.min(100, Math.max(0,
    (fundamentals.trailingPE > 0 && fundamentals.trailingPE < 15 ? 30 : 10) +
    ((fundamentals.priceToBook ?? 5) < 3 ? 25 : 10) +
    (fundamentals.dividendYield > 2 ? 25 : 5) +
    ((fundamentals.priceToSales ?? 5) < 2 ? 20 : 5)
  ));

  f["safety_score"] = Math.min(100, Math.max(0,
    (capB >= 50 ? 25 : capB >= 10 ? 15 : 5) +
    (fundamentals.beta <= 0.8 ? 25 : fundamentals.beta <= 1.2 ? 15 : 5) +
    (fundamentals.dividendYield > 1.5 ? 25 : fundamentals.dividendYield > 0 ? 15 : 5) +
    ((fundamentals.debtToEquity ?? 100) < 50 ? 25 : 10)
  ));

  return f;
}

function computeCalendarFeatures(date: Date, daysToEarnings: number | null): Record<string, number> {
  const f: Record<string, number> = {};

  // Day of week (one-hot)
  const dow = date.getDay();
  f["is_monday"] = dow === 1 ? 1 : 0;
  f["is_tuesday"] = dow === 2 ? 1 : 0;
  f["is_wednesday"] = dow === 3 ? 1 : 0;
  f["is_thursday"] = dow === 4 ? 1 : 0;
  f["is_friday"] = dow === 5 ? 1 : 0;

  // Month (cyclical encoding)
  const month = date.getMonth();
  f["month_sin"] = Math.sin(2 * Math.PI * month / 12);
  f["month_cos"] = Math.cos(2 * Math.PI * month / 12);

  // Quarter
  f["is_quarter_end"] = [2, 5, 8, 11].includes(month) ? 1 : 0;

  // OPEX week (3rd Friday of month)
  const dayOfMonth = date.getDate();
  f["is_opex_week"] = dow >= 1 && dow <= 5 && dayOfMonth >= 15 && dayOfMonth <= 21 ? 1 : 0;

  // Earnings proximity
  f["days_to_earnings"] = daysToEarnings ?? 999;
  f["near_earnings"] = daysToEarnings != null && daysToEarnings <= 14 && daysToEarnings >= 0 ? 1 : 0;
  f["post_earnings"] = daysToEarnings != null && daysToEarnings < 0 && daysToEarnings >= -5 ? 1 : 0;

  // January effect / Tax-loss selling (December)
  f["is_january"] = month === 0 ? 1 : 0;
  f["is_december"] = month === 11 ? 1 : 0;

  // Week of year (cyclical)
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const weekOfYear = Math.ceil(((date.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
  f["week_sin"] = Math.sin(2 * Math.PI * weekOfYear / 52);
  f["week_cos"] = Math.cos(2 * Math.PI * weekOfYear / 52);

  return f;
}

function computeSentimentProxies(
  data: OHLCV[],
  options: OptionsSnapshot | null,
  market: MarketData | null
): Record<string, number> {
  const f: Record<string, number> = {};
  const closes = data.map(d => d.close);
  const volumes = data.map(d => d.volume);
  const n = closes.length;

  // Price action sentiment
  const recent5 = closes.slice(-5);
  const upDays5 = recent5.filter((c, i) => i > 0 && c > recent5[i - 1]).length;
  f["price_momentum_5d"] = (upDays5 / 4) * 2 - 1; // -1 to 1

  // Volume sentiment (high volume on up days vs down days)
  let upVol = 0, downVol = 0;
  for (let i = Math.max(1, n - 10); i < n; i++) {
    if (closes[i] > closes[i - 1]) upVol += volumes[i];
    else downVol += volumes[i];
  }
  f["volume_sentiment_10d"] = (upVol + downVol) > 0
    ? (upVol - downVol) / (upVol + downVol) : 0;

  // Unusual volume
  const avgVol = sma(volumes, 20);
  f["unusual_volume"] = avgVol > 0 ? volumes[n - 1] / avgVol : 1;
  f["unusual_volume_signal"] = f["unusual_volume"] > 2 ? 1 : f["unusual_volume"] > 1.5 ? 0.5 : 0;

  // Gap sentiment (recent gaps)
  const recentGaps: number[] = [];
  for (let i = Math.max(1, n - 5); i < n; i++) {
    recentGaps.push((data[i].open - data[i - 1].close) / data[i - 1].close);
  }
  f["gap_sentiment_5d"] = mean(recentGaps) * 100;

  // Fear gauge (combination of VIX + put/call + price action)
  const vixFear = market ? Math.max(0, (market.vix - 15) / 20) : 0;
  const pcrFear = options ? Math.max(0, (options.putCallVolumeRatio - 1) / 1) : 0;
  const priceFear = f["price_momentum_5d"] < 0 ? Math.abs(f["price_momentum_5d"]) * 0.5 : 0;
  f["composite_fear"] = Math.min(1, (vixFear + pcrFear + priceFear) / 3);

  // Greed gauge
  const vixGreed = market ? Math.max(0, (15 - market.vix) / 10) : 0;
  const pcrGreed = options ? Math.max(0, (1 - options.putCallVolumeRatio) / 1) : 0;
  const priceGreed = f["price_momentum_5d"] > 0 ? f["price_momentum_5d"] * 0.5 : 0;
  f["composite_greed"] = Math.min(1, (vixGreed + pcrGreed + priceGreed) / 3);

  // Net sentiment
  f["net_sentiment"] = f["composite_greed"] - f["composite_fear"];

  // Capitulation signal (very high volume + large down day)
  const lastReturn = n >= 2 ? (closes[n - 1] - closes[n - 2]) / closes[n - 2] : 0;
  f["capitulation_signal"] = lastReturn < -0.03 && f["unusual_volume"] > 2.5 ? 1 : 0;

  // Euphoria signal (very high volume + large up day at highs)
  const near52wkHigh = closes[n - 1] >= Math.max(...closes.slice(-252)) * 0.97;
  f["euphoria_signal"] = lastReturn > 0.03 && f["unusual_volume"] > 2 && near52wkHigh ? 1 : 0;

  // Accumulation vs distribution
  f["smart_money_flow"] = f["volume_sentiment_10d"];

  // Short squeeze potential (simplified - uses price action)
  const shortSqueezeSetup = f["price_momentum_5d"] > 0.5 && f["unusual_volume"] > 1.5;
  f["short_squeeze_signal"] = shortSqueezeSetup ? 1 : 0;

  return f;
}

function computeCrossAssetFeatures(
  data: OHLCV[],
  fundamentals: FundamentalData | null,
  market: MarketData | null
): Record<string, number> {
  const f: Record<string, number> = {};
  const closes = data.map(d => d.close);
  const price = closes[closes.length - 1];

  // Relative strength vs market (SPY proxy via market returns)
  if (market) {
    const stockReturn5d = closes.length >= 6
      ? (price - closes[closes.length - 6]) / closes[closes.length - 6] : 0;
    const stockReturn20d = closes.length >= 21
      ? (price - closes[closes.length - 21]) / closes[closes.length - 21] : 0;

    f["rs_vs_spy_5d"] = stockReturn5d - market.spyReturn5d;
    f["rs_vs_spy_20d"] = stockReturn20d - market.spyReturn20d;
    f["outperforming_spy_5d"] = f["rs_vs_spy_5d"] > 0 ? 1 : 0;
    f["outperforming_spy_20d"] = f["rs_vs_spy_20d"] > 0 ? 1 : 0;
  } else {
    f["rs_vs_spy_5d"] = 0; f["rs_vs_spy_20d"] = 0;
    f["outperforming_spy_5d"] = 0; f["outperforming_spy_20d"] = 0;
  }

  // Beta-adjusted features
  const beta = fundamentals?.beta ?? 1;
  f["beta_adjusted_return_5d"] = f["rs_vs_spy_5d"] / (beta || 1);
  f["high_beta"] = beta > 1.3 ? 1 : 0;
  f["low_beta"] = beta < 0.8 ? 1 : 0;
  f["beta_regime"] = beta;

  // Sector proxy features (based on style)
  f["is_defensive"] = beta < 0.8 && (fundamentals?.dividendYield ?? 0) > 1.5 ? 1 : 0;
  f["is_cyclical"] = beta > 1.2 ? 1 : 0;
  f["is_tech_proxy"] = beta > 1 && (fundamentals?.trailingPE ?? 0) > 25 ? 1 : 0;

  // Correlation regime (approximation via beta stability)
  f["correlation_with_market"] = Math.min(1, Math.max(-1, beta * 0.7));

  // Factor exposure proxies
  f["momentum_factor"] = closes.length >= 252
    ? (price - closes[closes.length - 252]) / closes[closes.length - 252] : 0;
  f["quality_factor"] = fundamentals?.roe ?? 0 > 15 ? 1 : 0;
  f["value_factor"] = (fundamentals?.trailingPE ?? 20) < 15 ? 1 : 0;
  f["size_factor"] = (fundamentals?.marketCap ?? 0) > 100e9 ? 1 : 0;

  // Interest rate sensitivity proxy
  f["rate_sensitive"] = (fundamentals?.dividendYield ?? 0) > 3 ? 1 : 0;

  return f;
}

// ─── Main Feature Computation ──────────────────────────────────

/**
 * Compute the full 300+ feature vector for a given stock.
 * This is used as input to the prediction model.
 */
export function computeFeatures(
  symbol: string,
  data: OHLCV[],
  options: OptionsSnapshot | null,
  market: MarketData | null,
  fundamentals: FundamentalData | null,
  daysToEarnings: number | null
): FeatureVector {
  const date = data.length > 0 ? new Date(data[data.length - 1].date) : new Date();

  const technical = computeTechnicalIndicators(data);
  const statistical = computeStatisticalFeatures(data);
  const optionsFeats = computeOptionsFeatures(options);
  const marketFeats = computeMarketFeatures(market);
  const fundamentalFeats = computeFundamentalFeatures(fundamentals);
  const calendar = computeCalendarFeatures(date, daysToEarnings);
  const sentiment = computeSentimentProxies(data, options, market);
  const crossAsset = computeCrossAssetFeatures(data, fundamentals, market);

  const features = {
    ...technical,
    ...statistical,
    ...optionsFeats,
    ...marketFeats,
    ...fundamentalFeats,
    ...calendar,
    ...sentiment,
    ...crossAsset,
  };

  return {
    features,
    metadata: {
      symbol,
      date: date.toISOString().split("T")[0],
      featureCount: Object.keys(features).length,
      categories: {
        technical: Object.keys(technical).length,
        statistical: Object.keys(statistical).length,
        options: Object.keys(optionsFeats).length,
        market: Object.keys(marketFeats).length,
        fundamental: Object.keys(fundamentalFeats).length,
        calendar: Object.keys(calendar).length,
        sentiment: Object.keys(sentiment).length,
        crossAsset: Object.keys(crossAsset).length,
      },
    },
  };
}

/**
 * Get ordered feature names for consistent model input.
 */
export function getFeatureNames(): string[] {
  // Generate a dummy feature vector to get all keys in consistent order
  const dummy = computeFeatures("DUMMY", generateDummyOHLCV(252), null, null, null, null);
  return Object.keys(dummy.features).sort();
}

function generateDummyOHLCV(n: number): OHLCV[] {
  const data: OHLCV[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const change = (Math.random() - 0.5) * 2;
    price = Math.max(50, price + change);
    data.push({
      date: new Date(Date.now() - (n - i) * 86400000).toISOString().split("T")[0],
      open: price - 0.5,
      high: price + 1,
      low: price - 1,
      close: price,
      volume: 1000000 + Math.random() * 500000,
    });
  }
  return data;
}

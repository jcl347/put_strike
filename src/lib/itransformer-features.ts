/**
 * iTransformer Feature Engineering — Server-Side
 *
 * Computes the exact 83 features used to train the iTransformer model.
 * Must stay in sync with compute_features() in colab/train_itransformer.ipynb.
 *
 * Input: OHLCV daily data (need 260+ days for warmup)
 * Output: (numDays, 83) feature matrix for the available days
 */

export const FEATURE_NAMES = [
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
}

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
 * Compute 83 features for each day of the OHLCV array.
 * Returns a 2D array: [numDays][83]
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

  // Build per-day feature rows
  const result: number[][] = [];

  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(83).fill(0);
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

    // Replace NaN/Infinity
    for (let f = 0; f < 83; f++) {
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

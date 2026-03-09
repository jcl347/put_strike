/**
 * Stock Price Prediction Engine
 *
 * Implements an ensemble of statistical methods for price forecasting:
 *
 * 1. Mean-Reversion Model — Z-score based, captures tendency of prices to
 *    revert to moving averages.
 * 2. Momentum Model — Trend following using multiple timeframes.
 * 3. Volatility-Adjusted Model — Projects price ranges using ATR/HV.
 * 4. Options-Implied Model — Uses IV to project probability cones.
 * 5. Technical Composite — Combines RSI, MACD, Bollinger %B signals.
 * 6. Seasonal/Calendar Model — Day-of-week and monthly effects.
 *
 * For the iTransformer (Inverted Transformer):
 * ──────────────────────────────────────────────
 * The iTransformer (ICLR 2024) inverts the standard Transformer:
 * - Standard: each time step is a token, attention captures temporal patterns
 * - iTransformer: each FEATURE is a token, attention captures cross-variate correlations
 *
 * Architecture:
 *   Input: (batch, num_features, lookback_window) — each feature's time series is a token
 *   → Per-variate embedding (project each feature's lookback into d_model)
 *   → Multi-head self-attention (across features, not time)
 *   → Feed-forward network
 *   → Linear projection to forecast horizon
 *
 * Why it works for stocks:
 *   - Captures how features interact (e.g., VIX rising + put/call ratio spiking
 *     together predicts different outcomes than either alone)
 *   - Each feature's temporal pattern is preserved in the embedding
 *   - Scales well with 300+ features (each is a token)
 *
 * Training Requirements:
 *   - GPU: Required (A100 or T4 for 300 features × 60-day lookback)
 *   - Data: 5+ years daily data for training, walk-forward validation
 *   - Time: ~2-4 hours on T4 for full training
 *   - Framework: PyTorch → export to ONNX for inference
 *
 * Deployment on Vercel:
 *   - Train offline (Colab, AWS, or Modal)
 *   - Export to ONNX format
 *   - Run inference with onnxruntime-node in serverless function
 *   - Inference time: <500ms for single prediction (CPU is fine)
 *   - Model size: ~10-50MB depending on d_model and layers
 *
 * CURRENT IMPLEMENTATION:
 *   This file implements the statistical ensemble (no GPU needed).
 *   When an ONNX model is available, it will be loaded for the
 *   iTransformer predictions alongside the ensemble.
 */

import { FeatureVector } from "./features";

// ─── Types ────────────────────────────────────────────────────

export interface PricePrediction {
  symbol: string;
  currentPrice: number;
  predictions: ForecastPoint[];
  confidenceBands: ConfidenceBand[];
  putSellingWindow: PutSellingWindow;
  modelSignals: ModelSignal[];
  ensembleScore: number;    // -100 to 100 (bearish to bullish)
  optimalPutDTE: number;    // Recommended DTE for put selling
  optimalStrike: number;    // Recommended strike price
  methodology: string;
}

export interface ForecastPoint {
  date: string;
  daysOut: number;
  predicted: number;
  lower95: number;
  upper95: number;
  lower68: number;
  upper68: number;
}

export interface ConfidenceBand {
  daysOut: number;
  level: number;      // confidence level (0.68, 0.95)
  lower: number;
  upper: number;
}

export interface PutSellingWindow {
  recommended: boolean;
  optimalEntryDate: string;
  reasoning: string[];
  ivTiming: "high" | "normal" | "low";
  trendAlignment: "favorable" | "neutral" | "unfavorable";
  earningsSafe: boolean;
  riskLevel: "low" | "moderate" | "high";
}

export interface ModelSignal {
  model: string;
  signal: "bullish" | "bearish" | "neutral";
  strength: number;   // 0-100
  prediction30d: number;  // predicted % change
  description: string;
}

// ─── Statistical Models ───────────────────────────────────────

function meanReversionModel(features: Record<string, number>, price: number): ModelSignal {
  const zscore20 = features["zscore_20"] ?? 0;
  const zscore50 = features["zscore_50"] ?? 0;
  const bbPctB = features["bb_pctb"] ?? 0.5;

  // Mean reversion strength: how far from mean
  const reversionPull = -(zscore20 * 0.5 + zscore50 * 0.3 + (bbPctB - 0.5) * 2 * 0.2);

  // Convert to % prediction
  const vol20 = features["volatility_20d"] ?? 0.2;
  const prediction30d = reversionPull * vol20 * Math.sqrt(30 / 252) * 100;

  const signal = prediction30d > 1 ? "bullish" : prediction30d < -1 ? "bearish" : "neutral";
  const strength = Math.min(100, Math.abs(reversionPull) * 50);

  return {
    model: "Mean Reversion",
    signal,
    strength,
    prediction30d,
    description: zscore20 > 1.5
      ? "Price is extended above mean — likely to pull back"
      : zscore20 < -1.5
      ? "Price is below mean — potential bounce"
      : "Price is near fair value range",
  };
}

function momentumModel(features: Record<string, number>, price: number): ModelSignal {
  const roc5 = features["roc_5"] ?? 0;
  const roc10 = features["roc_10"] ?? 0;
  const roc20 = features["roc_20"] ?? 0;
  const sma20Cross = features["sma_20_50_cross"] ?? 0;
  const macdHist = features["macd_histogram"] ?? 0;
  const adx = features["adx_14"] ?? 20;
  const priceSlope = features["price_slope_20"] ?? 0;

  // Momentum composite
  const momentum = (
    (roc5 * 0.15) +
    (roc10 * 0.25) +
    (roc20 * 0.25) +
    (sma20Cross * 3) * 0.15 +
    (macdHist > 0 ? 1 : -1) * Math.min(Math.abs(macdHist) / price * 100, 2) * 0.1 +
    (priceSlope > 0 ? 1 : -1) * 0.1
  );

  // Trend strength modifier
  const trendFactor = adx > 25 ? 1.3 : adx > 15 ? 1.0 : 0.7;

  const prediction30d = momentum * trendFactor * 0.5;
  const signal = prediction30d > 0.5 ? "bullish" : prediction30d < -0.5 ? "bearish" : "neutral";
  const strength = Math.min(100, Math.abs(momentum) * trendFactor * 20);

  return {
    model: "Momentum",
    signal,
    strength,
    prediction30d,
    description: adx > 25
      ? `Strong trend detected (ADX ${adx.toFixed(0)}) — momentum ${prediction30d > 0 ? "up" : "down"}`
      : "No strong directional trend — momentum is mixed",
  };
}

function volatilityModel(features: Record<string, number>, price: number): ModelSignal {
  const vol20 = features["volatility_20d"] ?? 0.2;
  const vol60 = features["volatility_60d"] ?? 0.2;
  const atrPct = features["atr_14_pct"] ?? 2;
  const volRegime = features["vol_regime_ratio"] ?? 1;

  // Volatility is expanding or contracting?
  const volExpanding = vol20 > vol60 * 1.2;
  const volContracting = vol20 < vol60 * 0.8;

  // Project 30-day range using current volatility
  const dailyVol = vol20 / Math.sqrt(252);
  const thirtyDayVol = dailyVol * Math.sqrt(30);
  const expectedRange = price * thirtyDayVol;

  const prediction30d = 0; // Volatility model is non-directional
  const signal = "neutral" as const;

  return {
    model: "Volatility Forecast",
    signal,
    strength: Math.min(100, atrPct * 20),
    prediction30d,
    description: volExpanding
      ? `Volatility expanding (${(vol20 * 100).toFixed(1)}% vs ${(vol60 * 100).toFixed(1)}% 60d) — wider ranges expected. 30d range: ±$${expectedRange.toFixed(2)}`
      : volContracting
      ? `Volatility contracting — breakout may be imminent. 30d range: ±$${expectedRange.toFixed(2)}`
      : `Normal volatility. 30d range: ±$${expectedRange.toFixed(2)}`,
  };
}

function optionsImpliedModel(features: Record<string, number>, price: number): ModelSignal {
  const atmIV = features["atm_iv"] ?? 0.25;
  const ivSkew = features["iv_skew_25d"] ?? 0;
  const pcr = features["pcr_volume"] ?? 1;
  const optionsSentiment = features["options_sentiment"] ?? 0;

  // Options-implied 30-day move
  const implied30dMove = atmIV * Math.sqrt(30 / 365) * 100;

  // Put/call ratio as contrarian signal
  const pcrSignal = pcr > 1.3 ? 1 : pcr < 0.7 ? -1 : 0; // contrarian
  const skewSignal = ivSkew > 0.05 ? -0.5 : ivSkew < -0.02 ? 0.5 : 0;

  const directionalBias = (pcrSignal * 0.6 + skewSignal * 0.4) * implied30dMove * 0.3;
  const prediction30d = directionalBias;

  const signal = prediction30d > 0.5 ? "bullish" : prediction30d < -0.5 ? "bearish" : "neutral";

  return {
    model: "Options-Implied",
    signal,
    strength: Math.min(100, implied30dMove * 3),
    prediction30d,
    description: `IV implies ±${implied30dMove.toFixed(1)}% move over 30 days. ` +
      (pcr > 1.3 ? "High put/call ratio (contrarian bullish)." :
       pcr < 0.7 ? "Low put/call ratio (contrarian bearish)." :
       "Put/call ratio neutral."),
  };
}

function technicalComposite(features: Record<string, number>, price: number): ModelSignal {
  const rsi14 = features["rsi_14"] ?? 50;
  const macdCross = features["macd_cross_above"] ?? 0;
  const bbPctB = features["bb_pctb"] ?? 0.5;
  const stochK = features["stoch_k"] ?? 50;
  const cmf = features["cmf_20"] ?? 0;
  const aroonOsc = features["aroon_oscillator"] ?? 0;
  const ichimokuCross = features["ichimoku_tk_cross"] ?? 0;

  // Score each indicator (-1 to 1)
  const rsiSignal = rsi14 < 30 ? 1 : rsi14 > 70 ? -1 : (50 - rsi14) / 50;
  const macdSignal = macdCross ? 1 : features["macd_histogram"] > 0 ? 0.3 : -0.3;
  const bbSignal = bbPctB < 0.1 ? 1 : bbPctB > 0.9 ? -1 : 0;
  const stochSignal = stochK < 20 ? 1 : stochK > 80 ? -1 : 0;
  const cmfSignal = cmf > 0.1 ? 0.5 : cmf < -0.1 ? -0.5 : 0;
  const aroonSignal = aroonOsc / 100;
  const ichiSignal = ichimokuCross ? 0.5 : -0.5;

  const composite = (
    rsiSignal * 0.2 +
    macdSignal * 0.2 +
    bbSignal * 0.15 +
    stochSignal * 0.1 +
    cmfSignal * 0.15 +
    aroonSignal * 0.1 +
    ichiSignal * 0.1
  );

  const prediction30d = composite * 3;
  const signal = composite > 0.15 ? "bullish" : composite < -0.15 ? "bearish" : "neutral";

  return {
    model: "Technical Composite",
    signal,
    strength: Math.min(100, Math.abs(composite) * 100),
    prediction30d,
    description: `${[
      rsi14 < 30 ? "RSI oversold" : rsi14 > 70 ? "RSI overbought" : null,
      macdCross ? "MACD bullish cross" : null,
      bbPctB < 0.1 ? "Below Bollinger low" : bbPctB > 0.9 ? "Above Bollinger high" : null,
      cmf > 0.1 ? "Positive money flow" : cmf < -0.1 ? "Negative money flow" : null,
    ].filter(Boolean).join(", ") || "Mixed technical signals"}`,
  };
}

function sentimentModel(features: Record<string, number>): ModelSignal {
  const netSentiment = features["net_sentiment"] ?? 0;
  const fear = features["composite_fear"] ?? 0;
  const greed = features["composite_greed"] ?? 0;
  const capitulation = features["capitulation_signal"] ?? 0;
  const euphoria = features["euphoria_signal"] ?? 0;

  // Contrarian: extreme fear = bullish, extreme greed = bearish
  let contrarian = 0;
  if (capitulation) contrarian = 2;
  else if (fear > 0.7) contrarian = 1;
  else if (euphoria) contrarian = -2;
  else if (greed > 0.7) contrarian = -1;
  else contrarian = netSentiment;

  const prediction30d = contrarian * 1.5;
  const signal = contrarian > 0.3 ? "bullish" : contrarian < -0.3 ? "bearish" : "neutral";

  return {
    model: "Sentiment",
    signal,
    strength: Math.min(100, Math.abs(contrarian) * 40),
    prediction30d,
    description: capitulation
      ? "Capitulation detected — contrarian bullish"
      : euphoria
      ? "Euphoria detected — contrarian bearish"
      : fear > 0.5
      ? "Elevated fear — potential buying opportunity"
      : greed > 0.5
      ? "Elevated greed — caution warranted"
      : "Sentiment is balanced",
  };
}

// ─── Ensemble Prediction ─────────────────────────────────────

/**
 * Generate a full price prediction using the statistical ensemble.
 * This runs entirely on CPU in the Vercel serverless function.
 */
export function generatePrediction(
  symbol: string,
  currentPrice: number,
  featureVector: FeatureVector,
  ivRank: number,
  daysToEarnings: number | null,
  trendDirection: "up" | "down" | "sideways"
): PricePrediction {
  const features = featureVector.features;

  // Run all models
  const models: ModelSignal[] = [
    meanReversionModel(features, currentPrice),
    momentumModel(features, currentPrice),
    volatilityModel(features, currentPrice),
    optionsImpliedModel(features, currentPrice),
    technicalComposite(features, currentPrice),
    sentimentModel(features),
  ];

  // Ensemble: weighted average of directional models
  const weights = [0.20, 0.25, 0.05, 0.20, 0.20, 0.10];
  let ensemblePrediction = 0;
  for (let i = 0; i < models.length; i++) {
    ensemblePrediction += models[i].prediction30d * weights[i];
  }

  // Ensemble score (-100 to 100)
  const ensembleScore = Math.max(-100, Math.min(100, ensemblePrediction * 15));

  // Generate forecast points
  const vol20 = features["volatility_20d"] ?? 0.2;
  const dailyVol = vol20 / Math.sqrt(252);
  const driftPerDay = ensemblePrediction / 3000; // daily drift from ensemble

  const predictions: ForecastPoint[] = [];
  const horizons = [7, 14, 21, 30, 45, 60];

  for (const days of horizons) {
    const drift = driftPerDay * days;
    const diffusion = dailyVol * Math.sqrt(days);
    const predicted = currentPrice * (1 + drift);

    predictions.push({
      date: new Date(Date.now() + days * 86400000).toISOString().split("T")[0],
      daysOut: days,
      predicted: Math.round(predicted * 100) / 100,
      lower95: Math.round(currentPrice * (1 + drift - 1.96 * diffusion) * 100) / 100,
      upper95: Math.round(currentPrice * (1 + drift + 1.96 * diffusion) * 100) / 100,
      lower68: Math.round(currentPrice * (1 + drift - diffusion) * 100) / 100,
      upper68: Math.round(currentPrice * (1 + drift + diffusion) * 100) / 100,
    });
  }

  // Confidence bands
  const confidenceBands: ConfidenceBand[] = horizons.map(days => ({
    daysOut: days,
    level: 0.95,
    lower: predictions.find(p => p.daysOut === days)!.lower95,
    upper: predictions.find(p => p.daysOut === days)!.upper95,
  }));

  // Determine optimal put selling parameters
  const ivTiming = ivRank > 50 ? "high" : ivRank > 25 ? "normal" : "low";
  const earningsSafe = daysToEarnings === null || daysToEarnings < 0 || daysToEarnings > 45;
  const trendAlignment = trendDirection === "down"
    ? "unfavorable"
    : trendDirection === "up"
    ? "favorable"
    : "neutral";

  const reasoning: string[] = [];
  if (ivTiming === "high") reasoning.push("IV Rank is elevated — premium is rich (good for selling)");
  else if (ivTiming === "low") reasoning.push("IV Rank is low — thin premiums, consider waiting");
  if (!earningsSafe) reasoning.push(`Earnings in ${daysToEarnings} days — avoid selling puts through earnings`);
  if (trendDirection === "down") reasoning.push("Stock is in a downtrend — higher assignment risk");
  if (trendDirection === "up") reasoning.push("Stock is in an uptrend — favorable for put selling");
  if (ensembleScore < -30) reasoning.push("Ensemble model is bearish — extra caution");
  if (ensembleScore > 30) reasoning.push("Ensemble model is bullish — good entry timing");

  // Risk assessment
  const riskLevel = trendDirection === "down" || !earningsSafe || ensembleScore < -40
    ? "high"
    : trendDirection === "up" && earningsSafe && ivTiming !== "low"
    ? "low"
    : "moderate";

  // Optimal DTE: prefer 30-45 but adjust for earnings
  let optimalPutDTE = 35;
  if (daysToEarnings !== null && daysToEarnings > 0 && daysToEarnings < 45) {
    optimalPutDTE = Math.max(14, daysToEarnings - 7); // Close before earnings
    reasoning.push(`Adjusted DTE to ${optimalPutDTE} days to close before earnings`);
  }

  // Optimal strike: based on support level and delta target
  const pred30 = predictions.find(p => p.daysOut === 30);
  const supportLevel = features["donchian_low"] ?? currentPrice * 0.93;
  const optimalStrike = Math.min(
    Math.round(currentPrice * 0.92), // ~8% OTM
    Math.round(supportLevel),
    pred30 ? Math.round(pred30.lower68) : Math.round(currentPrice * 0.92)
  );

  const recommended = earningsSafe && trendDirection !== "down" && riskLevel !== "high";

  return {
    symbol,
    currentPrice,
    predictions,
    confidenceBands,
    putSellingWindow: {
      recommended,
      optimalEntryDate: new Date().toISOString().split("T")[0],
      reasoning,
      ivTiming: ivTiming as "high" | "normal" | "low",
      trendAlignment: trendAlignment as "favorable" | "neutral" | "unfavorable",
      earningsSafe,
      riskLevel: riskLevel as "low" | "moderate" | "high",
    },
    modelSignals: models,
    ensembleScore,
    optimalPutDTE,
    optimalStrike,
    methodology: "Statistical Ensemble (6 models: Mean Reversion, Momentum, Volatility, Options-Implied, Technical Composite, Sentiment)",
  };
}

# Feature Importance Analysis & Improvement Hypotheses

## Executive Summary

Analysis of permutation importance across 89 per-stock iTransformer models reveals **three critical problems** and **six actionable hypotheses** for improving directional accuracy.

**Key Findings:**
1. **86% of feature categories have negative mean importance** — they actively hurt predictions when present
2. **Even top features explain only 0.5-7.7% of MSE** — the model distributes weight thinly across 154 features
3. **Feature importance is highly stock-specific** — no single feature appears in the top-5 for even 20% of stocks
4. **Massive redundancy exists** — multiple features measure the same signal (4 volatilities, 4 z-scores, 5 returns, 3 RSIs, 3 autocorrelations)

---

## Problem 1: Feature Pollution (Negative Importance)

### Evidence

**Bottom 10 features (aggregate, all negative):**
| Feature | Mean Importance | Interpretation |
|---------|----------------|----------------|
| volatility_60d | -0.000028 | Highly correlated with volatility_20d, garman_klass_vol_20d |
| stock_driver_2_return_20d | -0.000025 | Raw returns are noisy; correlation feature is better |
| zscore_50 | -0.000025 | Redundant with zscore_20, zscore_100, zscore_200 |
| roc_20 | -0.000022 | Redundant with return_20d (same signal) |
| skewness_60d | -0.000022 | Too slow-moving, dilutes skewness_20d |
| price_vs_sma_50_pct | -0.000022 | Redundant with price_vs_sma_20_pct, sma_20_50_cross |
| price_vs_sma_20_pct | -0.000022 | Redundant (5 price_vs_sma features!) |
| percentile_rank_60d | -0.000021 | Redundant with percentile_rank_20d, 252d |
| return_20d | -0.000021 | Redundant with roc_20 and other return features |
| rel_return_vs_spy_20d | -0.000021 | Redundant with rel_return_vs_spy_60d/5d |

**18 of 21 feature categories have negative mean importance**, meaning the average feature in those categories hurts predictions.

### Root Cause

With 154 features and only ~2,500 samples per stock, the model is 175x over-parameterized. The iTransformer's cross-variate attention mechanism treats each feature as a token — feeding in noisy/redundant features forces the attention to divide capacity across tokens that add noise rather than signal.

---

## Problem 2: Massive Feature Redundancy

### Redundant Feature Groups Identified

| Group | Features | Keep | Remove |
|-------|----------|------|--------|
| **SMA Distance** (5) | price_vs_sma_5/10/20/50/200_pct | sma_20_50_cross, sma_50_200_cross | price_vs_sma_5/10/20/50/200_pct (all 5) |
| **EMA Distance** (3) | price_vs_ema_5/12/26_pct | (none — SMA crosses cover this) | price_vs_ema_5/12/26_pct (all 3) |
| **RSI** (3) | rsi_7, rsi_14, rsi_21 | rsi_14 | rsi_7, rsi_21 |
| **ROC/Returns** (8) | roc_5/10/20, return_1d/5d/10d/20d/60d | return_1d, return_5d, return_60d | roc_5/10/20, return_10d, return_20d |
| **Volatility** (6) | volatility_5d/10d/20d/60d, parkinson_vol_20d, garman_klass_vol_20d | garman_klass_vol_20d, vol_regime_ratio | volatility_5d/10d/20d/60d, parkinson_vol_20d |
| **Z-Scores** (4) | zscore_20/50/100/200 | zscore_20, zscore_200 | zscore_50, zscore_100 |
| **Percentile Ranks** (3) | percentile_rank_20d/60d/252d | percentile_rank_252d | percentile_rank_20d/60d |
| **Autocorrelation** (3) | autocorr_lag_1/3/5 | autocorr_lag_1, autocorr_lag_5 | autocorr_lag_3 |
| **ATR** (3) | atr_7_pct, atr_14_pct, atr_ratio_7_60 | atr_14_pct, atr_ratio_7_60 | atr_7_pct |
| **Skewness/Kurtosis** (4) | skewness_20d/60d, kurtosis_20d/60d | kurtosis_20d (top-10 for INTC) | skewness_60d, kurtosis_60d, skewness_20d |
| **SPY Relative** (4) | rel_return_vs_spy_5d/20d/60d, rolling_corr_spy_20d | rel_return_vs_spy_60d, rolling_corr_spy_20d | rel_return_vs_spy_5d/20d |
| **Drawdown** (2) | max_drawdown_20d/60d | max_drawdown_60d | max_drawdown_20d |

**Total removable features: ~35-40**, reducing from 154 to ~114-119.

---

## Problem 3: Low Individual Feature Impact

Even the most important features explain under 8% of MSE. This suggests:
1. The model is learning **cross-feature interactions** (as intended by iTransformer), but with 154 tokens the attention is spread too thin
2. **Correlated features compensate** for each other when one is shuffled, masking their true importance
3. The **Huber loss (delta=0.02)** clips large errors aggressively, reducing the variance that permutation importance measures

---

## Hypothesis 1: Aggressive Feature Pruning (HIGH CONFIDENCE)

**Claim**: Removing the ~40 features with consistently negative aggregate importance will improve directional accuracy by 1-3 percentage points.

**Rationale**:
- Reduces over-parameterization from 175x to ~125x
- Removes attention tokens that the model wastes capacity on
- Each removed noisy token frees attention budget for signal-bearing tokens
- The iTransformer paper (Liu et al., ICLR 2024) used 7-21 features, not 154

**Validation**:
- This is the **most validated** hypothesis because we have direct permutation importance evidence
- Features with negative importance literally improve predictions when shuffled — their learned patterns are noise
- The bottom categories (Advanced Volume -0.000020, Price Action -0.000013, Statistical -0.000013) are large groups
- Risk: some features are stock-specific (e.g., volatility_60d is negative aggregate but positive for TMO, EOG). Mitigation: only prune features negative for >70% of stocks

**Expected outcome**: Modest but consistent improvement (~1-2% directional accuracy)

---

## Hypothesis 2: Per-Stock Feature Selection (MEDIUM-HIGH CONFIDENCE)

**Claim**: Selecting the top-K features per stock (K=50-80) based on training-set mutual information will improve per-stock accuracy by 2-5 percentage points, especially for outlier stocks.

**Rationale**:
- Feature importance is highly heterogeneous: ADBE's top feature (squeeze_breakout_signal, 7.7% MSE) is irrelevant for COST (0.1% MSE top feature)
- A universal 154-feature set forces stocks like MMM, COST, AMZN (top features <0.2% MSE) to process 150+ noise tokens
- Per-stock feature selection focuses attention capacity on the 50-80 features that actually matter for each stock

**Validation**:
- This matches H4 in the existing hypotheses ("Feature selection beats all-features")
- The evidence strongly supports it: per-stock importance is so different that a universal feature set is suboptimal
- Risk: per-stock feature selection adds pipeline complexity and requires mutual information computation during data prep
- Risk: different feature counts per stock means different model architectures (num_variates varies)

**Expected outcome**: Significant improvement for low-importance stocks (COST, MMM, AMZN), modest for already-good stocks

**Implementation**: Compute mutual information between each feature and target returns during data prep (Cell 5). Select top-K features per stock. Store selected feature indices in per_stock_config.json for inference.

---

## Hypothesis 3: Replace Redundant Features with Composite Signals (MEDIUM CONFIDENCE)

**Claim**: Replacing redundant feature groups with PCA-derived composites or best-in-class representatives will improve model efficiency without losing signal.

**Rationale**:
- 5 price_vs_sma features all measure the same concept (price relative to moving average)
- 4 z-score features, 3 percentile ranks, 4 volatility measures — all redundant within groups
- The model wastes attention capacity disambiguating near-identical tokens
- Replacing 5 SMA distances with 2 cross signals (sma_20_50_cross, sma_50_200_cross) preserves the trend regime signal in 2 tokens instead of 7

**Validation**:
- The importance data confirms: sma_20_50_cross and sma_50_200_cross are consistently in top-10, while price_vs_sma_* features are in the bottom 10
- Autocorr_lag_1 and autocorr_lag_5 appear in top-5 frequently, but autocorr_lag_3 never does
- garman_klass_vol_20d appears in top-10 for 5 stocks while volatility_5d/10d never do
- Risk: PCA composites lose interpretability; simpler approach is just picking the best representative

**Expected outcome**: 0.5-1.5% improvement from reduced noise, plus computational savings

---

## Hypothesis 4: New Feature — Options-Implied Probability (HIGH POTENTIAL, RESEARCH NEEDED)

**Claim**: Adding the risk-neutral probability of assignment (from put option implied volatility) would provide a unique forward-looking signal that no current OHLCV-derived feature captures.

**Proposed features**:
1. `put_implied_assignment_prob_30d` — Probability stock closes below ATM-5% strike in 30 days (from IV surface)
2. `iv_skew_25d_ratio` — 25-delta put IV / 25-delta call IV (fear asymmetry, different from CBOE SKEW which is index-level)
3. `iv_term_structure_slope` — 30d IV / 60d IV for the specific stock (not VIX-based, stock-specific)

**Rationale**:
- All 154 current features are backward-looking (derived from historical OHLCV, macro, or cross-market data)
- Options IV is the market's **forward-looking consensus** on stock-specific risk
- Stock-level IV skew captures institutional hedging demand that is orthogonal to CBOE SKEW (index-level)
- IV term structure slope captures whether short-term risk exceeds long-term risk (event premium)

**Validation**:
- This is a genuinely **new signal dimension** — no current feature captures stock-specific forward-looking risk pricing
- Yahoo Finance provides some IV data (via options chains), making it feasible for the training pipeline
- Risk: historical IV data availability is limited (need 10 years, may not have full surface history)
- Risk: IV is partially captured by existing VIX features, reducing orthogonality for high-beta stocks
- Partial mitigation: the `realized_implied_vol_ratio` feature already exists but has **negative** aggregate importance — this suggests the ratio itself isn't useful, but the raw IV components might be

**Expected outcome**: If implementable, 2-4% improvement for stocks with active options markets. Less impact for lower-liquidity names.

---

## Hypothesis 5: Target Engineering — Predict Volatility-Adjusted Returns (MEDIUM CONFIDENCE)

**Claim**: Predicting return/volatility (Sharpe-like) instead of raw returns will improve directional accuracy by normalizing across regimes.

**Rationale**:
- Current target: `y = (future_price - current_price) / current_price` (raw return)
- A 2% move for KO (vol ~15%) is significant; a 2% move for TSLA (vol ~60%) is noise
- The model sees the same 0.02 magnitude for both but needs to learn different thresholds per stock
- RevIN helps somewhat but operates on the lookback window, not the target

**Proposed change**: `y = (future_price - current_price) / (current_price * realized_vol_20d * sqrt(horizon/252))`

**Validation**:
- This matches standard practice in quantitative finance (risk-adjusted returns)
- The Huber loss delta=0.02 is calibrated for raw returns; with normalized targets, the loss landscape changes
- Risk: volatile stocks get compressed, potentially losing useful signal about magnitude
- Risk: requires recalibration of the Huber delta
- Partial evidence: stocks with highest baseline MSE (COIN 0.100, MU 0.083, TSLA 0.059) are the highest-vol stocks — normalizing would make their targets comparable to low-vol stocks

**Expected outcome**: 1-3% improvement in directional accuracy, especially for high-vol stocks where raw returns have wider distribution

---

## Hypothesis 6: Attention-Based Feature Selection During Training (HIGH CONFIDENCE, COMPLEX)

**Claim**: Adding a learnable feature gate (sparse attention mask) that the model learns to zero out irrelevant features during training would achieve per-stock feature selection without manual preprocessing.

**Proposed architecture change**:
```python
# Add to iTransformer.__init__:
self.feature_gate = nn.Parameter(torch.ones(num_variates))

# Add to forward():
gate = torch.sigmoid(self.feature_gate * 5)  # sharp sigmoid
tokens = tokens * gate.unsqueeze(0).unsqueeze(-1)
# Add L1 sparsity loss: lambda * gate.abs().sum()
```

**Rationale**:
- Achieves per-stock feature selection implicitly during training
- The model learns which features to zero out for each stock
- Sparsity penalty (L1 on gate values) encourages dropping irrelevant features
- No need for separate mutual information computation or feature index tracking

**Validation**:
- Feature gating is well-established in deep learning (Mixture of Experts, attention masking)
- The sharp sigmoid (temperature=5) creates near-binary gates
- L1 sparsity has strong theoretical backing (LASSO regression analogy)
- Risk: adds hyperparameters (sparsity lambda, gate temperature) that need tuning
- Risk: gate may not converge cleanly with only 2,500 samples
- The current model already has `agg_weights` (variate aggregation weights) — but these are post-attention, not pre-attention

**Expected outcome**: 2-5% improvement by automatically pruning stock-specific noise features

---

## Hypothesis Validation Summary

| # | Hypothesis | Confidence | Expected Gain | Implementation Effort | Risk |
|---|-----------|-----------|---------------|---------------------|------|
| **H1** | Aggressive Feature Pruning | HIGH | 1-2% | Low (remove features) | Low |
| **H2** | Per-Stock Feature Selection | MED-HIGH | 2-5% | Medium (MI computation) | Medium |
| **H3** | Replace Redundant Features | MEDIUM | 0.5-1.5% | Low (edit feature list) | Low |
| **H4** | Options-Implied Features | HIGH potential | 2-4% | High (data pipeline) | High (data availability) |
| **H5** | Volatility-Adjusted Targets | MEDIUM | 1-3% | Medium (target change) | Medium (recalibration) |
| **H6** | Attention Feature Gating | HIGH | 2-5% | Medium (arch change) | Medium (hyperparams) |

---

## Recommended Implementation Order

### Phase 1: Low-hanging fruit (do first)
1. **H1 + H3 combined**: Remove 35-40 redundant/negative features → 114-119 features
2. Re-run training and compare directional accuracy

### Phase 2: Architecture improvement
3. **H6**: Add feature gating to iTransformer
4. Re-train with gating + reduced feature set

### Phase 3: Signal improvement
5. **H5**: Experiment with volatility-adjusted targets
6. **H4**: Research options IV data availability for training pipeline

### Phase 4: Full per-stock optimization
7. **H2**: If gating (H6) doesn't fully solve it, implement explicit per-stock MI-based feature selection

---

## Feature Pruning Candidates (H1 + H3 Combined)

### Remove (35 features → reduce to 119):

**Price Action (remove 8):**
- price_vs_sma_5_pct, price_vs_sma_10_pct, price_vs_sma_20_pct, price_vs_sma_50_pct, price_vs_sma_200_pct
- price_vs_ema_5_pct, price_vs_ema_12_pct, price_vs_ema_26_pct

**Momentum (remove 5):**
- rsi_7, rsi_21 (keep rsi_14)
- roc_5, roc_10, roc_20 (redundant with return_* features)

**Returns (remove 2):**
- return_10d, return_20d (keep 1d, 5d, 60d)

**Volatility (remove 4):**
- volatility_5d, volatility_10d, volatility_20d, volatility_60d (keep garman_klass, parkinson, vol_regime_ratio, vol_expanding)

**Statistical (remove 7):**
- zscore_50, zscore_100 (keep zscore_20, zscore_200)
- percentile_rank_20d, percentile_rank_60d (keep 252d)
- skewness_60d, kurtosis_60d (keep 20d versions)
- autocorr_lag_3 (keep lag_1, lag_5)

**Other (remove 6):**
- atr_7_pct (keep atr_14_pct, atr_ratio_7_60)
- max_drawdown_20d (keep 60d)
- rel_return_vs_spy_5d, rel_return_vs_spy_20d (keep 60d)
- up_ratio_10d (keep 20d)
- stock_driver_2_return_20d (negative importance; keep correlation feature)

**Volume (remove 3):**
- obv_zscore (rarely in top-10)
- vwap_deviation (Advanced Volume category is worst: -0.000020)
- force_index_13 (Advanced Volume)

### Keep (119 features):
All other features remain, including those with stock-specific positive importance.

---

## New Feature Avenues to Explore

### High Priority (orthogonal signal, feasible data)

1. **Stock-Level Implied Volatility** (see H4 above)
   - IV rank (current IV vs 1yr range) — already used in scoring.ts but not in ML features
   - IV skew (put vs call premium)
   - IV term structure

2. **Earnings Calendar Distance**
   - Days until next earnings (cyclical signal)
   - Days since last earnings (post-earnings drift)
   - Historical earnings surprise direction (beat/miss pattern)
   - Currently rejected in CLAUDE.md because Yahoo only returns 4 quarters, but third-party sources (Alpha Vantage, Financial Modeling Prep) have full history

3. **Analyst Sentiment Momentum**
   - EPS revision direction (upward/downward) over 30/90 days
   - Number of analyst upgrades vs downgrades
   - Available via Yahoo Finance quoteSummary

### Medium Priority (potentially useful but harder to source)

4. **Options Open Interest Concentration**
   - Max pain level (price where most options expire worthless)
   - Put/call open interest ratio at key strikes
   - OI change rate (institutional positioning shifts)

5. **Dark Pool / Off-Exchange Volume Ratio**
   - FINRA short volume ratio (available daily, free)
   - Off-exchange volume percentage (proxy for institutional activity)

6. **Sector Dispersion**
   - Cross-stock return dispersion within sector (high dispersion = stock-picking environment)
   - Sector ETF vs. equal-weight sector return gap (concentration risk)

### Lower Priority (marginal expected value)

7. **Alternative Macro**
   - Baltic Dry Index (global trade, available via FRED: BDIY or Yahoo)
   - Copper/lumber ratio (construction activity)
   - China A50 futures (global risk appetite, available via Yahoo: ^FTSE)

8. **Intraday Features** (if data available)
   - Opening gap direction consistency
   - First-hour vs rest-of-day return ratio
   - Volume distribution (AM vs PM heavy)

# CLAUDE.md - Development Guide for PutStrike

## Project Overview

PutStrike is a Next.js 15 app (App Router) that optimizes cash-secured put option sales using live market data, company stability analysis, and a research-validated multi-factor scoring model. Deployed on Vercel.

## Commands

- `npm run dev` - Start development server
- `npm run build` - Production build (also runs TypeScript checking and linting)
- `npx jest` - Run 31 validation tests (scoring model + stability + Black-Scholes accuracy)
- `npx jest --watch` - Run tests in watch mode

## Architecture

### Core Engine (`src/lib/`)

- **`black-scholes.ts`** - Black-Scholes-Merton pricing model for European puts. Uses Abramowitz & Stegun 26.2.17 for the normal CDF (error < 7.5e-8). Newton-Raphson IV solver with bisection fallback. All Greeks computed analytically.

- **`scoring.ts`** - Multi-factor scoring engine. Ten dimensions across two categories:
  - **Option-Level** (6 factors): premium yield (20%), delta quality (15%), DTE quality (12%), liquidity (12%), distance OTM (12%), HV rank (9%)
  - **Company Stability** (4 factors): market cap (30% of stability), beta (30%), 52-week position (25%), dividend yield (15%)
  - Stability contributes 20% of overall score when available
  - Market regime modifier based on VIX
  - Outputs 0-100 score with recommendation (STRONG_SELL / SELL / NEUTRAL / AVOID)

- **`yahoo-finance.ts`** - Data provider wrapping yahoo-finance2. Includes:
  - Retry with exponential backoff for rate limiting resilience
  - Batch processing (3 symbols at a time with 1s delays) to avoid 429 errors
  - Fetches quotes (including beta, P/E), options chains, historical prices, VIX, symbol search
  - Uses `any` casts for yahoo-finance2 return types due to strict/complex generics

### API Routes (`src/app/api/`)

All routes are `force-dynamic` (no caching — live data).

- **`/api/analyze?symbol=AAPL`** - Deep analysis with stability scoring and stock context. Fetches multiple expirations (14-75 DTE window), computes Greeks via Black-Scholes, scores all OTM puts, returns sorted results with HV rank, stability assessment, market regime, and stock context (earnings, trend, support/resistance, RSI, ATR).

- **`/api/screen?symbols=AAPL,MSFT`** - Multi-stock screener with batch processing. Defaults to 18 high-liquidity stocks. Returns:
  - `top10`: Global top 10 put sales across all stocks (ranked by combined score)
  - `results`: Per-stock results with top 5 puts each
  - `failedSymbols`: Any symbols that failed to load (for status display)

- **`/api/options?symbol=AAPL`** - Raw options chain data with quote and VIX.

- **`/api/search?q=app`** - Symbol autocomplete search.

### Frontend (`src/components/`)

Client-side React components with Tailwind CSS (v4). Dark theme only.

- `SymbolSearch` - Debounced autocomplete with dropdown
- `MarketRegime` - VIX-based regime indicator (color-coded)
- `StockQuoteCard` - Quote display with beta, P/E, HV rank visualization
- `Top10Puts` - Ranked top 10 put sales with expandable details, stability scores, and cross-comparison guide (? button)
- `PutDecisionAssistant` - Severity-weighted go/no-go checklist (14 rules across 6 categories: Stock Selection, IV Timing, Chart Analysis, Strike Selection, Risk Management). Rules are classified as critical/important/informational to prevent minor flags from overriding safety signals.
- `PricePrediction` - 6-model statistical ensemble for price forecasting + put timing with color-coded confidence intervals
- `PutTable` - Expandable table of scored puts with trade details
- `ScreenerResults` - Multi-stock collapsible results view with stability scores
- `ColabConnect` - iTransformer GPU model connection for Colab inference
- Data source status indicator (connected/degraded/down)

## Key Design Decisions

1. **Scoring model over ML** - Research findings are well-established (tastytrade, DataDrivenOptions). A transparent weighted model is more interpretable and reliable than ML for this problem. The edge comes from filtering/timing, not prediction.

2. **Company stability as a scoring dimension** - When you sell a put, you agree to buy the stock. The underlying must be one you'd want to own if assigned. Beta, market cap, dividends, and 52-week position capture this.

3. **HV Rank as IV Rank proxy** - True IV rank requires historical IV data (not freely available). We compute 20-day rolling historical volatility rank as a proxy.

4. **Batch processing for rate limiting** - Yahoo Finance aggressively rate limits. Processing 3 symbols at a time with 1-second delays between batches + retry with exponential backoff prevents cascade failures.

5. **yahoo-finance2 for data** - Free, JS-native, community-maintained since 2013. v3 requires `new YahooFinance()` instantiation.

6. **Data source status display** - Shows connected/degraded/down status so users know when data is stale or unavailable. Lists failed symbols in degraded mode.

## Research References

- tastytrade: 45 DTE, 16 delta, manage at 50% profit, stop at 2x credit; avoid selling through earnings
- DataDrivenOptions: 20 delta optimizes theta for short puts
- Schwab: IV Rank > 30 + IV Percentile > 50 produces 56.8% win rate vs 48.2% unfiltered
- Spintwig: SPY wheel backtests show Sharpe 1.08 vs 0.70 buy-hold
- CBOE: Lower-beta underlyings (≤1.2) have higher put-selling win rates; PUT index data shows VIX 15-25 is optimal
- Early Retirement Now: Wheel strategy struggles in prolonged bear markets (VIX >35 regime)
- Schaeffer's Research: Heavy OI at strikes creates support/resistance zones for strike selection
- Standard TA: RSI 30/70 standard boundaries; for put sellers, RSI >80 = high pullback risk

## Decision Assistant Rule System

The `PutDecisionAssistant` component implements a severity-weighted checklist in `evaluateChecklist()`. Rules have three severity levels:

- **Critical** (Earnings, VIX crisis, Trend, Moving Averages): A single critical fail → CAUTION; two → AVOID
- **Important** (IV Rank, Beta, Company Quality, Liquidity, Support): Two important fails → CAUTION
- **Informational** (Dividend, P/E, RSI, Volume, ATR, 52-Week): Provide context but rarely disqualify alone

Key research-backed thresholds:
- IV Rank: ≥50 pass, 30-49 warn, <30 fail (Schwab 56.8% win rate data)
- VIX: 15-30 pass, 30-35 warn, ≥35 fail (CBOE PUT index + ERN analysis)
- Beta: ≤1.2 pass, 1.2-1.5 warn, >1.5 fail (CBOE lower-beta research)
- RSI: 30-70 pass, 25-30/70-80 warn, <25/>80 fail
- Earnings: date found + outside window = pass, no date = warn, imminent = fail
- Dividend: >1.5% pass, all others warn (no fail — quality non-dividend stocks are valid)
- Volume: 0.5-2x avg = pass, extreme >3x or <0.3x = fail
- Support: 3-10% below price = pass (useful for strike placement)

To modify thresholds, edit `evaluateChecklist()` in `src/components/PutDecisionAssistant.tsx`.
To modify verdict logic, edit `getOverallVerdict()` — it uses severity-weighted fail counts.

## Modifying the Scoring Model

Weights are in `src/lib/scoring.ts` in the `scorePut()` function. Each factor has:
1. A raw score (0-100) computed from the candidate's attributes
2. A weight (all weights sum to 1.0)
3. A signal object for UI display

Company stability scoring is in `scoreCompanyStability()` with its own 4-factor model.

To adjust scoring:
- Change option-level weights in `scorePut()` (must sum to 0.80 when stability is present)
- Change stability sub-weights in `scoreCompanyStability()` (must sum to 1.0)
- Modify score thresholds in individual factor scoring blocks
- Adjust recommendation cutoffs (75/55/40)
- Modify regime multipliers in `classifyMarketRegime()`

Always run `npx jest` after changes to verify model behavior (31 tests).

## iTransformer ML Pipeline

### Architecture Overview

PutStrike uses a two-tier prediction system:
1. **Statistical Ensemble** (always available) — 6 CPU-based models in `src/lib/prediction.ts`, instant inference
2. **iTransformer Deep Learning** (HuggingFace-hosted) — individual per-stock ONNX models loaded from HF Hub on demand

The iTransformer pipeline:
- **Training**: Google Colab notebook (`colab/train_itransformer.ipynb`) trains on L4 GPU
- **Storage**: Per-stock ONNX models + config pushed to HuggingFace Hub
- **Inference**: Website downloads per-stock ONNX model on demand, runs via onnxruntime-web (WASM)
- **ONNX Export**: Uses PyTorch's dynamo-based exporter with `onnxscript` and `dynamic_shapes` (not deprecated `dynamic_axes`)
- **No Colab dependency at runtime** — models are self-contained on HF
- **Secrets**: HF_TOKEN and HF_REPO_ID loaded via Colab Secrets (key icon in sidebar)

### Training Strategy

**Per-stock models** — one iTransformer trained per stock on that stock's data only:
- Each stock has ~2,500 sliding window samples (10yr daily data × 60-day windows)
- Walk-forward validation: 70% train / 15% val / 15% test (chronological, no look-ahead)
- Each model learns stock-specific feature interactions via cross-variate attention

**Why per-stock over universal:**
- Each stock has unique volatility characteristics, sector dynamics, and price patterns
- Eliminates cross-stock contamination — a bank's patterns don't dilute a tech stock's model
- ~2,500 samples per stock is sufficient for the iTransformer architecture (128-dim, 3 layers)
- Individual models allow targeted retraining when a stock's regime changes

### Model Architecture (iTransformer — ICLR 2024, Liu et al.)

Standard Transformers treat time steps as tokens. iTransformer **inverts** this — each feature is a token:
- Input: `(batch, lookback=60, num_features)` → transpose → `(batch, num_features, lookback=60)`
- Each feature projected: `Linear(lookback → d_model=128)`
- Multi-head self-attention across features (captures cross-variate correlations)
- Shared output projection: `Linear(d_model → horizon=60)`
- RevIN normalization (instance norm per window, reversed on output)

Config: `d_model=128, n_heads=8, n_layers=3, d_ff=256, dropout=0.15`

### Feature Engineering (83 features)

Features computed in both Python (notebook) and TypeScript (website) — must stay synchronized:

| Category | Features | Source |
|----------|----------|--------|
| Price Action | SMA/EMA crosses, Bollinger, ATR, Keltner | OHLCV |
| Momentum | RSI, MACD, Stochastic, Williams %R, CCI, Aroon, ROC | OHLCV |
| Volume | OBV, CMF, relative volume, volume z-score | OHLCV |
| Volatility | HV 5/10/20/60d, vol expansion ratio, skewness, kurtosis | OHLCV |
| Statistical | Z-scores, percentile ranks, autocorrelation, Hurst exponent | OHLCV |
| Macro | VIX term structure, Treasury yields, USD index, Gold, Oil | Yahoo tickers |
| Calendar | Day of week, month cycle, OPEX week, quarter end | Date |
| Returns | 1/5/10/20/60d log returns, drawdown, up/down ratios | OHLCV |

**Macro data sources:**
- `^VIX`, `^VIX3M` — VIX term structure (contango/backwardation signals risk appetite)
- `^TNX` — 10-year Treasury yield (rate sensitivity, growth vs value rotation)
- `DX-Y.NYB` — US Dollar Index (inverse correlation with equities for many sectors)
- `GC=F` — Gold futures (risk-off indicator)
- `CL=F` — Crude Oil futures (energy sector driver, inflation proxy)

### Prediction Horizons

The model predicts 60 trading days ahead (≈84 calendar days), mapping to DTE presets:

| DTE Preset | Calendar Days | Trading Days | Model Days Used |
|------------|--------------|--------------|-----------------|
| Weekly | 7-14d | 5-10 | 5-10 |
| Short | 14-30d | 10-21 | 10-21 |
| Optimal | 30-45d | 21-32 | 21-32 |
| Standard | 14-75d | 10-53 | 10-53 |
| Medium | 30-60d | 21-42 | 21-42 |
| Long | 45-90d | 32-63 | 32-60 (extrapolated) |
| Extended | 60-120d | 42-85 | 42-60 (extrapolated) |

For Long/Extended horizons beyond 60 trading days, confidence bands widen proportionally.

### HuggingFace Integration

**Repository structure on HF Hub:**
```
jcl347/putstrike/
├── model_config.json              # Model config (dims, features, horizons, avg metrics)
├── per_stock/
│   ├── per_stock_config.json      # Per-stock metrics and training details
│   ├── AAPL.onnx                  # Per-stock ONNX model (~1.5-2MB each)
│   ├── MSFT.onnx
│   └── ...                        # One .onnx per trained stock
├── training_results.png           # Training visualization
└── README.md                      # Model card
```

**Website loading flow:**
1. On page load, download `model_config.json` and `per_stock/per_stock_config.json` from HF Hub
2. When a stock is analyzed, download `per_stock/{SYMBOL}.onnx` on demand (cached after first load)
3. Compute features from OHLCV + macro data (same pipeline as training)
4. Run ONNX inference via `onnxruntime-web` (WASM backend, no native deps)
5. Return predictions alongside statistical ensemble

### Put Pick Validation

iTransformer predictions validate the scoring model's recommendations:
- **Concordant**: iTransformer predicts neutral/bullish + scoring says SELL → high confidence
- **Discordant**: iTransformer predicts bearish + scoring says SELL → flag for review
- **Agreement score**: displayed in Top10Puts and screener results

### Hypotheses to Test

1. **H1: Macro features improve predictions** — Adding VIX term structure, yields, dollar, gold, oil improves over OHLCV-only features. Test via ablation study.
2. **H2: Longer lookback helps long horizons** — 120-day lookback improves 45-60d predictions vs 60-day lookback. Test by comparing horizon-specific accuracy.
3. **H3: iTransformer concordance predicts put profitability** — Puts where scoring and iTransformer agree have higher simulated win rates. Test on historical data.
4. **H4: Feature selection beats all-features** — Top-K features by mutual information outperform full feature set. Test via training comparison.

### Modifying the ML Pipeline

- **Colab secrets**: Add `HF_TOKEN` and `HF_REPO_ID` via the Secrets panel (key icon) in Colab
- **Training config**: Edit Cell 3 of `colab/train_itransformer.ipynb`
- **Feature engineering**: Edit `compute_features()` in the notebook AND `src/lib/itransformer-features.ts` (must stay in sync)
- **Model architecture**: Edit the `iTransformer` class in notebook Cell 6
- **Website inference**: Edit `src/lib/hf-model.ts`
- **ONNX export**: Uses `dynamic_shapes` with `torch.export.Dim` (not deprecated `dynamic_axes`). Requires `onnxscript` pip package for the dynamo ONNX translation pipeline. The `TransformerEncoderLayer` uses `enable_nested_tensor=False` to suppress warnings when `norm_first=True`.

## Common Issues

- **yahoo-finance2 errors**: The library may fail during market closures or for symbols with no options. Errors are caught per-symbol in the screener; the UI shows failed symbols.
- **Rate limiting**: The screener processes 3 stocks at a time with 1s delays. If Yahoo still throttles, reduce `batchSize` in `src/app/api/screen/route.ts`.
- **Type errors with yahoo-finance2**: The library has complex generics. We use `any` casts in `yahoo-finance.ts` — this is intentional for practicality.
- **v3 migration**: yahoo-finance2 v3 requires `new YahooFinance()` instead of the default export.

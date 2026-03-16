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

- **`db.ts`** - Neon Postgres serverless connection via `@neondatabase/serverless`. Lazy schema initialization creates `simulated_trades` table on first API request. Auto-detects `DATABASE_URL` (manual) or `POSTGRES_URL` (Vercel auto-injected). Returns null gracefully when unconfigured — builds succeed without database.

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

- **`/api/trades`** - Simulated trades CRUD (Neon Postgres). Requires `DATABASE_URL`.
  - `GET /api/trades?status=OPEN|all` - List trades
  - `POST /api/trades` - Create trade (symbol, strikePrice, expiration, premiumReceived, stockPriceAtEntry, etc.)
  - `PUT /api/trades/[id]` - Close trade (status, closePrice, stockPriceAtClose → auto-calculates P&L)
  - `DELETE /api/trades/[id]` - Delete trade
  - `GET /api/trades/stats` - Aggregate statistics (win rate, cumulative P&L, monthly breakdown, per-symbol breakdown)

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
- `SimulateTradeModal` - Modal to create a simulated put trade from any scored put row. Pre-fills all trade parameters.
- `TradesDashboard` - Full simulation trading analytics with SVG charts:
  - KPI cards (total P&L, win rate, avg return, open trades, best/worst trade)
  - Win rate donut chart (SVG)
  - Cumulative P&L line chart with trade dots (SVG)
  - Monthly P&L bar chart (SVG)
  - Per-symbol P&L breakdown with horizontal bars
  - Score vs outcome analysis (validates scoring model edge)
  - Trade history list with filter (all/open/closed), close trade modal, delete
- Data source status indicator (connected/degraded/down)

## Simulation Trading

### Overview

Simulation trading allows paper-trading put sales directly from scored put recommendations, tracking P&L and validating the scoring model's effectiveness over time.

### Database

Uses **Neon** (serverless Postgres) via `@neondatabase/serverless`. Schema is auto-created on first API request.

**Environment variables** (auto-detected, either works):
- `DATABASE_URL` — manual Neon connection string (`.env.local`)
- `POSTGRES_URL` — auto-injected by Vercel when you connect a database via the Storage dashboard

### Trade Lifecycle

1. **Open**: User clicks "Simulate Trade" on any scored put → modal pre-fills all parameters → saved to DB
2. **Close**: User clicks "Close" on an open trade → selects outcome (Expired/Profit/Loss/Assigned) → P&L auto-calculated
3. **Track**: Dashboard shows cumulative P&L, win rate, monthly performance, per-symbol breakdown, and score-vs-outcome analysis

### P&L Calculation

- **Expired** (worthless): P&L = premium × 100 (full profit)
- **Closed**: P&L = (premium received − close price) × 100
- **Assigned**: P&L = premium × 100 − (strike − stock price at close) × 100

### Key Analytics

- **Win Rate**: % of closed trades with positive P&L
- **Score vs Outcome**: Compares average entry score for winners vs losers — validates the scoring model
- **Cumulative P&L Chart**: SVG line chart showing equity curve across all closed trades
- **Monthly P&L**: Bar chart of monthly returns
- **Per-Symbol Breakdown**: Horizontal bar chart ranked by total P&L per stock

### Schema

```sql
simulated_trades (
  id SERIAL PRIMARY KEY,
  symbol, company_name, strike_price, expiration, dte_at_entry,
  premium_received, stock_price_at_entry, delta_at_entry,
  score_at_entry, stability_score_at_entry, iv_rank_at_entry,
  collateral, status (OPEN/CLOSED_PROFIT/CLOSED_LOSS/ASSIGNED/EXPIRED),
  close_price, stock_price_at_close, pnl, pnl_percent,
  closed_at, notes, created_at, updated_at
)
```

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
- **ONNX Export**: Uses legacy TorchScript exporter (`dynamo=False`) with `dynamic_axes` — dynamo exporter incompatible with RevIN architecture
- **No Colab dependency at runtime** — models are self-contained on HF
- **Secrets**: HF_TOKEN, HF_REPO_ID, and FRED_API_KEY loaded via Colab Secrets (key icon in sidebar)

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

### Feature Engineering (126 features)

Features computed in both Python (notebook) and TypeScript (website) — must stay synchronized:

| Category | Count | Features | Source |
|----------|-------|----------|--------|
| Price Action | 10 | SMA/EMA crosses, Bollinger, ATR | OHLCV |
| Momentum | 15 | RSI, MACD, Stochastic, Williams %R, CCI, Aroon, ROC | OHLCV |
| Volume (basic) | 5 | OBV, CMF, relative volume, volume z-score | OHLCV |
| Volume (advanced) | 4 | MFI-14, A/D line z-score, VWAP deviation, Force Index | OHLCV |
| Volatility | 4 | HV 5/10/20/60d | OHLCV |
| Statistical | 10 | Z-scores, percentile ranks, autocorrelation | OHLCV |
| Regime Detection | 5 | Hurst exponent, Parkinson vol, Garman-Klass vol, return consistency, tail ratio | OHLCV |
| Price Structure | 5 | Range position 20/60d, ATR ratio 7/60, consecutive up days, candle body ratio | OHLCV |
| Relative Strength | 4 | Returns vs SPY (5/20/60d), rolling correlation with SPY | OHLCV + SPY |
| Cross-Asset Corr | 3 | Rolling correlation with VIX, rolling beta to SPY, volume-price correlation | OHLCV + macro |
| Intermarket | 4 | SPY momentum (5/20d), gold/oil ratio change, DXY-VIX interaction | Macro tickers |
| Macro | 10 | VIX term structure, Treasury yields, USD index, Gold, Oil | Yahoo tickers |
| Calendar | 5 | Day of week, month cycle, OPEX week, quarter end | Date |
| Returns | 5 | 1/5/10/20/60d log returns | OHLCV |
| Drawdown/Gap | 4 | Max drawdown 20/60d, avg gap, gap frequency | OHLCV |
| Trend | 5 | Price slopes, Ichimoku, up/down ratios | OHLCV |
| Moments | 4 | Skewness/kurtosis 20/60d | OHLCV |
| Vol Regime | 2 | Vol expansion ratio, vol expanding flag | OHLCV |
| Sector ETF Relative | 3 | Stock vs sector ETF returns (5/20d), sector correlation | Sector ETFs |
| Credit Market | 4 | HYG/TLT returns, credit spread proxy, HYG-SPY divergence | HYG, TLT |
| VIX Term Structure | 1 | VIX9D/VIX short-term fear ratio | ^VIX9D |
| Industry Commodity | 2 | Per-stock commodity correlation and return | NG=F, HG=F, BTC-USD |
| Intermarket Extended | 2 | Copper/gold ratio change, BTC sentiment | HG=F, BTC-USD |
| FRED Macro | 6 | HY credit spread, yield curve, breakeven inflation, 2Y yield, jobless claims z-score, consumer sentiment change | FRED API |

**Macro data sources:**
- `^VIX`, `^VIX3M` — VIX term structure (contango/backwardation signals risk appetite)
- `^VIX9D` — 9-day VIX (ultra-short-term fear, VIX9D/VIX ratio signals panic spikes)
- `^TNX` — 10-year Treasury yield (rate sensitivity, growth vs value rotation)
- `DX-Y.NYB` — US Dollar Index (inverse correlation with equities for many sectors)
- `GC=F` — Gold futures (risk-off indicator)
- `CL=F` — Crude Oil futures (energy sector driver, inflation proxy)
- `SPY` — S&P 500 ETF (market benchmark for relative strength features)
- `HYG` — iShares High Yield Corporate Bond ETF (credit appetite signal)
- `TLT` — iShares 20+ Year Treasury Bond ETF (flight to safety signal)
- `HG=F` — Copper futures (economic health indicator, copper/gold ratio)
- `BTC-USD` — Bitcoin (risk-on sentiment, fintech sector driver)
- `NG=F` — Natural Gas futures (energy sector commodity, via industry mapping)

**FRED API data sources** (requires `FRED_API_KEY` env var):
- `BAMLH0A0HYM2` — ICE BofA US High Yield OAS (credit spread level, risk appetite)
- `T10Y2Y` — 10-Year minus 2-Year Treasury yield curve (inversion = recession signal)
- `T10YIE` — 10-Year Breakeven Inflation Rate (inflation expectations)
- `DGS2` — 2-Year Treasury Constant Maturity Rate (short-term rate expectations)
- `ICSA` — Initial Jobless Claims, weekly (labor market health, z-scored over 20d)
- `UMCSENT` — University of Michigan Consumer Sentiment, monthly (consumer confidence, 20d pct change)

**Per-stock mappings:**
- `SECTOR_ETF_MAP` — Maps each stock to its GICS sector ETF (XLK, XLF, XLV, XLE, XLI, XLY, XLP, XLC). Sector-relative features capture whether a stock is outperforming/underperforming its peers, independent of broad market moves.
- `INDUSTRY_COMMODITY_MAP` — Maps energy stocks to NG=F, industrials to HG=F, fintech to BTC-USD. Only stocks with strong commodity sensitivity are mapped; unmapped stocks get 0-filled commodity features.

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
5. **H5: Relative strength + regime features improve tail accuracy** — The 25 new v5.0 features (relative strength, advanced volume, regime detection, intermarket) should improve predictions for stocks with the worst v4.0 accuracy (AMAT, INTC, PANW at ~52-55%) by providing market context that OHLCV alone misses.
6. **H6: Credit/sector/commodity features improve sector-specific accuracy** — The 12 v6.0 features (sector ETF relative strength, credit market signals, industry commodities) should improve predictions for sector-sensitive stocks (energy, financials, industrials) by capturing sector rotation, credit conditions, and commodity sensitivity that broad market indicators miss.
7. **H7: FRED macro indicators improve regime-change predictions** — The 6 v7.0 FRED features (HY spread, yield curve, breakeven inflation, 2Y yield, jobless claims, consumer sentiment) should improve predictions during macro regime changes (rate hikes, credit stress, recession signals) by providing direct economic data that market-derived proxies (VIX, HYG/TLT) may lag.

### Modifying the ML Pipeline

- **Colab secrets**: Add `HF_TOKEN`, `HF_REPO_ID`, and `FRED_API_KEY` via the Secrets panel (key icon) in Colab
- **Training config**: Edit Cell 3 of `colab/train_itransformer.ipynb`
- **Feature engineering**: Edit `compute_features()` in the notebook AND `src/lib/itransformer-features.ts` (must stay in sync). Also update `src/app/api/forecast/route.ts` macro tickers if adding new data sources. FRED features also require `src/lib/fred.ts` updates
- **Model architecture**: Edit the `iTransformer` class in notebook Cell 6
- **Website inference**: Edit `src/lib/hf-model.ts`
- **ONNX export**: Uses the legacy TorchScript exporter (`dynamo=False`) with `dynamic_axes` because the dynamo exporter (`torch.export.export`) fails on RevIN's dynamic buffer reassignment and string `mode` parameter. Requires `onnxscript` pip package (PyTorch ONNX infrastructure dependency). The `TransformerEncoder` uses `enable_nested_tensor=False` to suppress warnings when `norm_first=True`.

## Common Issues

- **yahoo-finance2 errors**: The library may fail during market closures or for symbols with no options. Errors are caught per-symbol in the screener; the UI shows failed symbols.
- **Rate limiting**: The screener processes 3 stocks at a time with 1s delays. If Yahoo still throttles, reduce `batchSize` in `src/app/api/screen/route.ts`.
- **Type errors with yahoo-finance2**: The library has complex generics. We use `any` casts in `yahoo-finance.ts` — this is intentional for practicality.
- **v3 migration**: yahoo-finance2 v3 requires `new YahooFinance()` instead of the default export.

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
  - `POST /api/trades` - Create trade with auto-calculated tastytrade management targets (profit_target_price = 50% premium, stop_loss_price = 3x premium, management_date = expiration − 21d). Supports quantity (contracts).
  - `PUT /api/trades/[id]` - Close trade (status, closePrice, stockPriceAtClose → auto-calculates P&L)
  - `DELETE /api/trades/[id]` - Delete trade
  - `GET /api/trades/stats` - Aggregate statistics: win rate, profit factor, max drawdown, avg holding period, cumulative P&L timeline, monthly breakdown, per-symbol breakdown
  - `GET /api/trades/capital` - Capital summary: deposits, withdrawals, portfolio value, available capital, return on capital, capital deployed
  - `POST /api/trades/capital` - Add deposit or withdrawal event

### Frontend (`src/components/`)

Client-side React components with Tailwind CSS (v4). Dark theme only. Compact risk disclaimer banner at top of page.

- `SymbolSearch` - Debounced autocomplete with dropdown
- `MarketRegime` - VIX-based regime indicator (color-coded)
- `StockQuoteCard` - Quote display with beta, P/E, HV rank visualization
- `Top10Puts` - Ranked top 10 put sales with expandable details, stability scores, and cross-comparison guide (? button)
- `PutDecisionAssistant` - Severity-weighted go/no-go checklist (14 rules across 6 categories: Stock Selection, IV Timing, Chart Analysis, Strike Selection, Risk Management). Rules are classified as critical/important/informational to prevent minor flags from overriding safety signals.
- `PricePrediction` - 6-model statistical ensemble for price forecasting + put timing with color-coded confidence intervals
- `PutTable` - Expandable table of scored puts with trade details
- `ScreenerResults` - Multi-stock collapsible results view with stability scores
- `ColabConnect` - iTransformer GPU model connection for Colab inference
- `SimulateTradeModal` - Modal to create a simulated put trade from any scored put row. Pre-fills all trade parameters. Includes quantity (contracts) selector, tastytrade management targets display (50% profit close, 2x credit stop, 21 DTE management), and position sizing summary (collateral, max gain, max loss).
- `TradesDashboard` - Full simulation trading analytics with SVG charts:
  - KPI cards (total P&L, win rate, profit factor, max drawdown, avg holding period, open trades)
  - Capital management section (deposits/withdrawals, portfolio value, available capital, capital deployed %)
  - Management alerts (21 DTE warnings, approaching expiration, tastytrade targets for each open trade)
  - Win rate donut chart (SVG)
  - Cumulative P&L line chart with trade dots (SVG)
  - Monthly P&L bar chart (SVG)
  - Per-symbol P&L breakdown with horizontal bars
  - Score vs outcome analysis (validates scoring model edge)
  - Trade history list with filter (all/open/closed), close trade modal (with quantity support), delete
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

1. **Open**: User clicks "Simulate Trade" on any scored put → modal pre-fills all parameters (including quantity) → tastytrade management targets auto-calculated → saved to DB
2. **Monitor**: Dashboard shows management alerts — 21 DTE roll/close warnings, approaching expiration, profit targets and stop losses for each open position
3. **Close**: User clicks "Close" on an open trade → selects outcome (Expired/Profit/Loss/Assigned) → P&L auto-calculated (quantity-aware)
4. **Track**: Dashboard shows cumulative P&L, win rate, profit factor, max drawdown, monthly performance, per-symbol breakdown, and score-vs-outcome analysis

### Management Targets (Research-Backed Defaults, Auto-Calculated)

- **Profit target**: Close at 50% profit (buy back at 50% of premium received). Default from tastytrade; 25% also validated for faster capital turnover.
- **Stop loss**: Stop at 2x credit loss (buy back at 3x premium). This is a tastytrade **starting guideline**, not an ironclad rule — contested by SJ Options backtests; some practitioners prefer wider stops or purely mechanical 21 DTE management.
- **Management date**: Roll or close at 21 DTE before expiration. **Most validated rule** across all sources — reduces gamma risk.
- These values are stored per-trade (`profit_target_price`, `stop_loss_price`, `management_date`)
- UI presents these as guidelines with research context, not rigid rules

### P&L Calculation

- **Expired** (worthless): P&L = premium × 100 × quantity (full profit)
- **Closed**: P&L = (premium received − close price) × 100 × quantity
- **Assigned**: P&L = premium × 100 × quantity − (strike − stock price at close) × 100 × quantity

### Capital Management

- **Deposits/Withdrawals**: Track capital added or removed from the simulation fund
- **Portfolio Value**: Net capital + realized P&L
- **Available Capital**: Portfolio value − capital deployed in open positions
- **Return on Capital**: Realized P&L / net capital deposited (%)
- Stored in `capital_events` table (type, amount, notes, created_at)

### Key Analytics

- **Win Rate**: % of closed trades with positive P&L
- **Profit Factor**: Gross wins / gross losses (tastytrade key metric; >1.0 = profitable system)
- **Max Drawdown**: Peak-to-trough from equity curve (calculated from cumulative P&L timeline)
- **Avg Holding Period**: Average days from open to close (split by winners/losers)
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
  collateral, quantity, status (OPEN/CLOSED_PROFIT/CLOSED_LOSS/ASSIGNED/EXPIRED),
  profit_target_price, stop_loss_price, management_date,
  vix_at_entry, market_regime_at_entry,
  close_price, stock_price_at_close, pnl, pnl_percent,
  closed_at, notes, created_at, updated_at
)

capital_events (
  id SERIAL PRIMARY KEY,
  type (DEPOSIT/WITHDRAWAL), amount, notes, created_at
)
```

## Key Design Decisions

1. **Scoring model over ML** - Research findings are well-established (tastytrade, DataDrivenOptions). A transparent weighted model is more interpretable and reliable than ML for this problem. The edge comes from filtering/timing, not prediction.

2. **Company stability as a scoring dimension** - When you sell a put, you agree to buy the stock. The underlying must be one you'd want to own if assigned. Beta, market cap, dividends, and 52-week position capture this.

3. **HV Rank as IV Rank proxy** - True IV rank requires historical IV data (not freely available). We compute 20-day rolling historical volatility rank as a proxy.

4. **Batch processing for rate limiting** - Yahoo Finance aggressively rate limits. Processing 3 symbols at a time with 1-second delays between batches + retry with exponential backoff prevents cascade failures.

5. **yahoo-finance2 for data** - Free, JS-native, community-maintained since 2013. v3 requires `new YahooFinance()` instantiation.

6. **Data source status display** - Shows connected/degraded/down status so users know when data is stale or unavailable. Lists failed symbols in degraded mode.

## Research References & Methodology Evaluation

### Entry Criteria (Strongly Validated)
- **Delta 14-22**: tastytrade 16 delta (1 SD) + DataDrivenOptions 20 delta. Both validated; 14-22 range captures the sweet spot. Spintwig: 16 delta with leverage has better Sharpe ratio than 30 delta.
- **DTE 30-45**: tastytrade 45 DTE + DataDrivenOptions 35-45 DTE. Both validated. Longer DTEs (60+) have diminishing theta efficiency.
- **IV Rank > 50**: Schwab data shows 56.8% win rate vs 48.2% unfiltered. Strongly validated.
- **VIX 15-25 optimal**: CBOE PUT index data. VIX >35 = crisis regime (ERN analysis).
- **Beta ≤ 1.2**: CBOE research shows lower-beta underlyings have higher put-selling win rates.

### Management Rules (Nuanced — NOT All Ironclad)
- **Profit target 25-50%**: STRONGLY VALIDATED. tastytrade Sept 2018 study: managing at 25%, 50%, or 21 DTE all outperform holding to expiration. 50% = higher absolute P/L. 25% = faster capital turnover. Key: managing at all matters more than the exact percentage.
- **21 DTE management**: MOST VALIDATED RULE. Universally agreed upon across tastytrade, DataDrivenOptions, Option Alpha. Gamma risk accelerates near expiration; rolling at 21 DTE reduces this exposure.
- **Stop loss at 2x credit (3x premium)**: CONTESTED GUIDELINE. tastytrade presents as starting point, not strict rule. SJ Options 11-year SPX backtest showed underwhelming results. Third-party tests suggest wider stops (3-4x) or mechanical 21 DTE management can outperform fixed stops. Some practitioners prefer no fixed stop, relying on 21 DTE management as the primary risk mechanism.
- **Never hold through earnings**: Strongly validated across all sources.

### Contract Sizing
- Standard US equity options = 100 shares per contract (OCC mandated). No exceptions for retail equity options.
- Mini options (10 shares) were introduced in 2013 for 5 symbols only, delisted by late 2014 due to poor liquidity and disproportionate commission costs.
- Small accounts should consider vertical spreads (bull put spreads) for lower capital requirements. Example: $400 margin for a 4-wide spread vs $13,000+ for a cash-secured put.

### Additional Sources
- Spintwig: SPY wheel backtests show Sharpe 1.08 vs 0.70 buy-hold
- Early Retirement Now: Wheel strategy struggles in prolonged bear markets (VIX >35 regime)
- Schaeffer's Research: Heavy OI at strikes creates support/resistance zones for strike selection
- Standard TA: RSI 30/70 standard boundaries; for put sellers, RSI >80 = high pullback risk
- Option Alpha: Similar framework to tastytrade, emphasizes "trade small, trade often" + automation

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

### Feature Engineering (154 features)

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
| **Gamma Squeeze Proxies** | 6 | Volume acceleration 3/10, price-volume momentum, range expansion ratio, gap acceleration, squeeze breakout signal, volume-price impact | OHLCV |
| **Market Breadth** | 4 | Tech rotation (QQQ-SPY), small cap rotation (IWM-SPY), SOX semiconductor momentum, XBI biotech momentum | QQQ, IWM, ^SOX, XBI |
| **Sentiment Proxies** | 4 | Realized/implied vol ratio, VIX-SPY 10d correlation, credit momentum 10d, fear composite | OHLCV + macro |
| **Stock-Specific Drivers** | 4 | Per-company primary/secondary driver returns and correlations | Per-stock ETF/index mapping |
| **FRED Extended** | 2 | St. Louis Fed Financial Stress Index, 10Y-3M Treasury spread | FRED API |
| **FRED Rates** | 2 | Federal Funds Rate level, 20d change (monetary policy stance) | FRED API (DFF) |
| **FRED FX** | 2 | JPY/USD 20d change, JPY/USD 20d z-score (carry trade proxy) | FRED API (DEXJPUS) |
| **Tail Risk** | 2 | CBOE SKEW level, SKEW 20d z-score (options tail risk pricing) | ^SKEW (Yahoo) |
| **Style Rotation** | 1 | IWF vs IWD 20d return spread (value/growth rotation regime) | IWF, IWD (Yahoo) |
| **Risk Appetite** | 1 | XLY vs XLP 20d return spread (consumer discretionary vs staples) | XLY, XLP (Yahoo) |

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
- `QQQ` — Invesco QQQ Trust (NASDAQ 100, tech rotation signal)
- `IWM` — iShares Russell 2000 ETF (small cap rotation, risk appetite breadth)
- `^SOX` — Philadelphia Semiconductor Index (chip cycle indicator)
- `^SKEW` — CBOE SKEW Index (options tail risk pricing; high SKEW = expensive crash protection, backtested from 1990)
- `IWF` — iShares Russell 1000 Growth ETF (growth style benchmark for value/growth rotation)
- `IWD` — iShares Russell 1000 Value ETF (value style benchmark for value/growth rotation)
- `XLY` — Consumer Discretionary Select Sector SPDR (risk-on consumer spending)
- `XLP` — Consumer Staples Select Sector SPDR (risk-off defensive spending)

**Stock-specific driver tickers** (per-stock mapped via `STOCK_SPECIFIC_DRIVERS`):
- `IGV` — iShares Expanded Tech-Software ETF (software company driver)
- `HACK` — ETFMG Prime Cyber Security ETF (cybersecurity company driver)
- `KRE` — SPDR S&P Regional Banking ETF (bank stock driver)
- `ITA` — iShares U.S. Aerospace & Defense ETF (defense company driver)
- `XOP` — SPDR S&P Oil & Gas Exploration ETF (energy company driver)
- `IBB` — iShares Biotechnology ETF (pharma/biotech company driver)
- `XHB` — SPDR S&P Homebuilders ETF (home improvement company driver)
- `XRT` — SPDR S&P Retail ETF (consumer/retail company driver)
- `LIT` — Global X Lithium & Battery Tech ETF (EV company driver)
- `ETH-USD` — Ethereum (crypto-exposed company driver)
- `DBA` — Invesco DB Agriculture Fund (agricultural equipment driver)
- `IYT` — iShares U.S. Transportation ETF (railroad/transport driver)
- `XLB` — Materials Select Sector SPDR (materials/industrial driver)

**FRED API data sources** (requires `FRED_API_KEY` env var):
- `BAMLH0A0HYM2` — ICE BofA US High Yield OAS (credit spread level, risk appetite)
- `T10Y2Y` — 10-Year minus 2-Year Treasury yield curve (inversion = recession signal)
- `T10YIE` — 10-Year Breakeven Inflation Rate (inflation expectations)
- `DGS2` — 2-Year Treasury Constant Maturity Rate (short-term rate expectations)
- `ICSA` — Initial Jobless Claims, weekly (labor market health, z-scored over 20d)
- `UMCSENT` — University of Michigan Consumer Sentiment, monthly (consumer confidence, 20d pct change)
- `STLFSI4` — St. Louis Fed Financial Stress Index, weekly (replaced STLFSI2; composite of 18 financial indicators; 0 = normal, positive = above-average stress)
- `T10Y3M` — 10-Year minus 3-Month Treasury spread (alternative recession indicator, more sensitive than 10Y-2Y; inversion preceded every US recession since 1970)
- `DFF` — Daily Federal Funds Effective Rate (actual overnight rate; captures monetary policy stance; directly impacts bank NIM and rate-sensitive growth stocks)
- `DEXJPUS` — JPY/USD Exchange Rate, daily (yen carry trade proxy; carry trade unwinding caused Aug 2024 market crash; high JPY strengthening = risk-off)

**Per-stock mappings:**
- `SECTOR_ETF_MAP` — Maps each stock to its GICS sector ETF (XLK, XLF, XLV, XLE, XLI, XLY, XLP, XLC). Sector-relative features capture whether a stock is outperforming/underperforming its peers, independent of broad market moves.
- `INDUSTRY_COMMODITY_MAP` — Maps energy stocks to NG=F, industrials to HG=F, fintech to BTC-USD. Only stocks with strong commodity sensitivity are mapped; unmapped stocks get 0-filled commodity features.
- `STOCK_SPECIFIC_DRIVERS` — Maps each stock to 2 unique driving assets (primary, secondary) based on company business model and market dynamics. Examples: NVDA→(^SOX, BTC-USD), JPM→(KRE, ^TNX), TSLA→(LIT, QQQ), BA→(ITA, XLI). See `src/lib/itransformer-features.ts` for full mapping. Unmapped stocks get 0-filled driver features.

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
8. **H8: Gamma squeeze proxies detect mechanical price amplification** — The 6 v8.0 gamma squeeze features (volume acceleration, price-volume momentum, range expansion, gap acceleration, squeeze breakout, volume-price impact) should improve short-term (7-14d) directional accuracy by detecting when market maker hedging flows are amplifying price moves, especially for high-options-volume stocks (TSLA, NVDA, AMD, SPY).
9. **H9: Stock-specific drivers improve per-stock predictions** — The 4 v8.0 stock-specific driver features should improve predictions for stocks with strong sector/industry dependencies by providing business-relevant signals. Test by comparing per-stock accuracy with vs without driver features. Stocks with strongest expected improvement: energy (XOP correlation), banks (KRE + rates), semis (SOX), defense (ITA).
10. **H10: Market breadth + sentiment features improve regime detection** — The 8 v8.0 market breadth and sentiment features (tech rotation, small cap rotation, SOX/XBI momentum, vol risk premium, fear composite) should improve predictions during style rotation and risk-off events by providing cross-market context that single-stock OHLCV misses.
11. **H11: Monetary policy features improve rate-sensitive stocks** — The 2 v9.0 DFF features (fed funds rate level and 20d change) should improve predictions for bank stocks (JPM, BAC, WFC, GS, MS, C, SCHW) and rate-sensitive growth stocks (MSFT, ADBE, NOW, CRM) by capturing actual overnight rate policy stance rather than just market-implied rates.
12. **H12: Carry trade proxy improves risk-off event detection** — The 2 v9.0 DEXJPUS features (JPY/USD change and z-score) should improve predictions during carry trade unwinding events by detecting yen strengthening as a leading indicator. The Aug 2024 market crash was driven by yen carry trade unwinding, which VIX-based features detected too late.
13. **H13: SKEW tail risk captures crash protection pricing** — The 2 v9.0 CBOE SKEW features should improve predictions for high-beta stocks (semis, fintech, crypto-adjacent) by detecting when options market participants are pricing in extreme tail risk, which VIX (at-the-money IV) does not capture.
14. **H14: Value/growth rotation regime improves style-sensitive predictions** — The v9.0 IWF-IWD spread feature should improve predictions during style rotation periods, particularly for growth stocks (tech, software) during value rotations and vice versa.
15. **H15: Risk appetite indicator improves consumer/defensive predictions** — The v9.0 XLY-XLP spread feature should improve predictions for consumer discretionary (HD, LOW, NKE, SBUX, TGT) and consumer staples (PG, KO, PEP, COST, WMT) stocks by capturing institutional risk appetite shifts.

16. **H16: Feature pruning improves predictions by reducing noise** — Removing 35 features with consistently negative permutation importance across 70%+ of stocks should improve directional accuracy by 1-2 percentage points by reducing the over-parameterization ratio from 175x to ~125x and freeing attention capacity for signal-bearing features. Confirmed by permutation importance analysis: 86% of feature categories have negative mean importance.
17. **H17: Learnable feature gating achieves per-stock feature selection** — Adding a sigmoid gate layer (with L1 sparsity penalty) that the model learns to zero out irrelevant features should improve per-stock accuracy by 2-5%, especially for stocks where top features explain <1% of MSE (COST, MMM, AMZN). The gate temperature (5.0) creates near-binary gates, and the sparsity penalty (lambda=1e-4) encourages dropping noisy features automatically.

### Feature Pruning (v10.0)

Based on permutation importance analysis across 89 per-stock models, 35 features with consistently negative importance were identified for removal:

**Removed features (35 total):**
- **Price Action (8)**: price_vs_sma_5/10/20/50/200_pct, price_vs_ema_5/12/26_pct — redundant with SMA cross signals
- **Momentum (5)**: rsi_7, rsi_21, roc_5/10/20 — redundant within group (keep rsi_14, return_*)
- **Returns (2)**: return_10d, return_20d — keep 1d, 5d, 60d
- **Volatility (4)**: volatility_5d/10d/20d/60d — keep garman_klass_vol_20d, parkinson_vol_20d, vol_regime_ratio
- **Statistical (7)**: zscore_50/100, percentile_rank_20d/60d, skewness_60d, kurtosis_60d, autocorr_lag_3
- **Other (6)**: atr_7_pct, max_drawdown_20d, rel_return_vs_spy_5d/20d, up_ratio_10d, stock_driver_2_return_20d
- **Volume (3)**: obv_zscore, vwap_deviation, force_index_13 — Advanced Volume category was worst (-0.000020)

**Remaining features: 119** (configurable via `PRUNE_FEATURES = True/False` in Cell 3)

### Feature Gating (v10.0)

Learnable per-feature gate added to iTransformer architecture:
- Each feature gets a sigmoid gate (0-1) initialized to ~0.88 (logit=2.0, temperature=5.0)
- L1 sparsity penalty (`GATE_SPARSITY_LAMBDA=1e-4`) encourages dropping noisy features
- Gate values are trained alongside model weights — per-stock feature selection happens automatically
- Active gate count per stock is logged in `per_stock_metrics["active_gates"]`
- Configurable via `USE_FEATURE_GATE = True/False` in Cell 3

### Per-Stock Dataset Analysis (v9.0)

Systematic analysis of how v9.0 universal features map to stock-specific prediction improvement. Each feature was evaluated for orthogonality (does it add signal not already captured?) and expected impact by stock category.

| Stock Category | Stocks | DFF (Fed Funds) | DEXJPUS (JPY) | ^SKEW (Tail Risk) | IWF/IWD (Style) | XLY/XLP (Risk) |
|----------------|--------|-----------------|---------------|-------------------|-----------------|----------------|
| **Semiconductors** | NVDA, AMD, INTC, AVGO, QCOM, TXN, AMAT, MU, LRCX, KLAC, SNPS, CDNS | Moderate — discount rate on high-duration growth | HIGH — carry trade unwinding hits high-beta growth hardest | HIGH — high-beta, tail risk repricing matters | HIGH — growth stocks, style rotation directly impacts | Moderate |
| **Software** | MSFT, CRM, ORCL, ADBE, NOW, CSCO, IBM | HIGH — rate-sensitive growth (long duration) | Moderate — carry trade impact | HIGH — growth stocks sensitive to tail risk | HIGH — growth stocks | Moderate |
| **Banks** | JPM, BAC, WFC, GS, MS, C, SCHW | HIGHEST — overnight rate directly sets net interest margin | Moderate — global banking exposure | Moderate — financial tail risk | HIGH — banks are value stocks | Moderate |
| **Healthcare/Pharma** | JNJ, UNH, LLY, PFE, ABBV, MRK, TMO, ABT, DHR, BMY, AMGN | Low-Moderate | Low — mostly domestic | Moderate — defensive, benefits from tail risk flow | Moderate — mixed value/growth | Low |
| **Consumer Disc.** | AMZN, MCD, NKE, SBUX, TGT, HD, LOW, ABNB, UBER | Moderate — consumer spending is rate-sensitive | Low — mostly domestic | Moderate | Moderate | HIGHEST — directly measures consumer spending rotation |
| **Consumer Staples** | PG, KO, PEP, COST, WMT | Low | Low | Low-Moderate — defensive | Moderate | HIGHEST — XLP is their sector; inversely benefits from risk-off |
| **Energy** | XOM, CVX, COP, SLB, EOG | Moderate — capex is rate-sensitive | Moderate — dollar strength affects oil | Low-Moderate | Moderate — value stocks | Low |
| **Industrials** | CAT, DE, HON, UNP, RTX, BA, GE, LMT, MMM | HIGH — capex-sensitive | Moderate — global exposure | Moderate | Moderate — cyclical value | Moderate |
| **Fintech/Crypto** | PYPL, SQ, COIN | HIGH — rate-sensitive growth | Moderate — risk-off impact | HIGH — high-beta speculative | HIGH — growth stocks | Moderate |
| **Communication** | GOOGL, META, NFLX, DIS | Moderate | Moderate | HIGH — growth stocks | HIGH — growth stocks | Moderate |
| **EV** | TSLA | Moderate | HIGH — carry trade unwinding | HIGH — highest beta in universe | HIGH — growth stock | Moderate |
| **ETFs** | SPY, QQQ, IWM, DIA, XLF, XLE, XLK, XLV, XBI | All features contribute — ETFs aggregate individual stock sensitivities | | | | |

**Datasets Researched and Rejected:**

| Dataset | Reason for Rejection |
|---------|---------------------|
| CBOE Equity Put/Call Ratio (equitypc.csv) | CSV files on cdn.cboe.com are **stale** — data ends mid-2016. Not updated. |
| AAII Investor Sentiment Survey | Historical data requires paid AAII membership. Not freely available. |
| FINRA Margin Debt Statistics | Monthly frequency with 6-7 week lag. No API. Too stale for daily prediction. |
| Yahoo Finance Earnings Dates | Only returns last 4 quarters of history. Insufficient for 10-year training. |
| Monthly FRED (CPI, UNRATE, M2SL, INDPRO) | Monthly updates mean 20+ days of stale forward-filled data. Too low frequency for daily prediction. |
| CFTC Commitment of Traders (COT) | Weekly frequency, complex CFTC API parsing, slow-moving signal. Marginal value vs implementation complexity. |
| Fama-French Factors (Kenneth French Library) | Data inside zip archives requiring custom parsing in both Python and TypeScript. Used ETF proxies (IWF/IWD) instead for value/growth signal with simpler implementation. |
| CBOE ^PUT / ^BXM Strategy Indices | Available on Yahoo Finance but highly correlated with SPY. Marginal orthogonal signal. |
| Currency Pairs (EUR/USD, GBP/USD) | DXY already captures most dollar strength signal. EUR/USD is ~58% of DXY weight. Low marginal value. |
| Short Interest (FINRA) | Bi-monthly release, significant lag, not available programmatically for 10 years. |
| Social Media Sentiment | No free dataset with 10-year daily history exists. |
| Google Trends | `pytrends` library is fragile, frequently blocked. Data is weekly. Not reliable for production training. |

### Modifying the ML Pipeline

- **Colab secrets**: Add `HF_TOKEN`, `HF_REPO_ID`, and `FRED_API_KEY` via the Secrets panel (key icon) in Colab
- **Training config**: Edit Cell 3 of `colab/train_itransformer.ipynb`
- **Feature engineering**: Edit `compute_features()` in the notebook AND `src/lib/itransformer-features.ts` (must stay in sync). Also update `src/app/api/forecast/route.ts` macro tickers if adding new data sources. FRED features also require `src/lib/fred.ts` updates. Stock-specific driver mappings in `STOCK_SPECIFIC_DRIVERS` (both files).
- **Feature importance**: Run Cell 9 after training — performs permutation importance analysis per stock, outputs `feature_importance_report.json` for Claude analysis. Requires state dicts saved during training (Cell 7).
- **Model architecture**: Edit the `iTransformer` class in notebook Cell 6
- **Website inference**: Edit `src/lib/hf-model.ts`
- **ONNX export**: Uses the legacy TorchScript exporter (`dynamo=False`) with `dynamic_axes` because the dynamo exporter (`torch.export.export`) fails on RevIN's dynamic buffer reassignment and string `mode` parameter. Requires `onnxscript` pip package (PyTorch ONNX infrastructure dependency). The `TransformerEncoder` uses `enable_nested_tensor=False` to suppress warnings when `norm_first=True`.

## Common Issues

- **yahoo-finance2 errors**: The library may fail during market closures or for symbols with no options. Errors are caught per-symbol in the screener; the UI shows failed symbols.
- **Rate limiting**: The screener processes 3 stocks at a time with 1s delays. If Yahoo still throttles, reduce `batchSize` in `src/app/api/screen/route.ts`.
- **Type errors with yahoo-finance2**: The library has complex generics. We use `any` casts in `yahoo-finance.ts` — this is intentional for practicality.
- **v3 migration**: yahoo-finance2 v3 requires `new YahooFinance()` instead of the default export.

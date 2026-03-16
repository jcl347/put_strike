# PutStrike

Research-backed cash-secured put optimization using live market data, multi-factor scoring, and iTransformer deep learning price forecasting.

## What It Does

PutStrike screens 80+ high-liquidity stocks, scores put selling opportunities using a research-validated 8-factor model (tastytrade, DataDrivenOptions, CBOE, Schwab research), and forecasts price movement using both a statistical ensemble (6 CPU models) and an iTransformer deep learning model (ONNX from HuggingFace).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Next.js 15 / React 19 / Tailwind v4)        │
│  ├── SymbolSearch → Single Stock Analysis               │
│  ├── Screen Top Stocks → Top 10 Puts + Forecasts        │
│  ├── DTE Range Filter (7-120d presets, client-side)     │
│  ├── Decision Assistant (14-rule severity checklist)    │
│  └── StockForecast (iTransformer time series display)   │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│  API Layer (Next.js App Router, force-dynamic)          │
│  ├── /api/analyze      — Deep single-stock analysis     │
│  ├── /api/screen-single — Per-stock screener            │
│  ├── /api/predict      — Ensemble + iTransformer pred.  │
│  ├── /api/options      — Raw options chain              │
│  ├── /api/search       — Symbol autocomplete            │
│  └── /api/trades       — Simulation trading CRUD + stats│
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│  Prediction Engine (Two-Tier)                           │
│                                                         │
│  Tier 1: Statistical Ensemble (CPU, instant)            │
│  ├── Mean Reversion (20%)   — Z-score reversion         │
│  ├── Momentum (25%)         — ROC + MACD + ADX          │
│  ├── Volatility (5%)        — ATR-based range forecast  │
│  ├── Options-Implied (20%)  — IV + put/call ratio       │
│  ├── Technical (20%)        — RSI + BB + Stoch + CMF    │
│  └── Sentiment (10%)        — Contrarian fear/greed     │
│                                                         │
│  Tier 2: iTransformer (ONNX from HuggingFace, ~100ms)  │
│  ├── Universal model: all 80+ stocks                    │
│  ├── 100+ features (OHLCV + macro + calendar)           │
│  ├── 60d lookback → 60 trading day forecast             │
│  ├── Cross-variate attention (features as tokens)       │
│  └── Concordance validation vs scoring model            │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│  Put Scoring Engine (8-factor weighted model)           │
│  ├── Premium yield (22%), Theta efficiency (8%)         │
│  ├── Delta quality (13%), DTE quality (10%)             │
│  ├── Liquidity (10%), Distance OTM (10%)                │
│  ├── IV rank (10%), Company stability (17%)             │
│  ├── Market regime modifier (VIX-based)                 │
│  └── → STRONG_SELL / SELL / NEUTRAL / AVOID             │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│  Data Sources                                           │
│  ├── yahoo-finance2 (quotes, options, OHLCV)            │
│  ├── Macro: ^VIX, ^VIX3M, ^TNX, DX-Y.NYB, GC=F, CL=F │
│  ├── HuggingFace Hub (ONNX model download + cache)     │
│  └── Neon Postgres (simulation trading persistence)    │
└─────────────────────────────────────────────────────────┘
```

## ML Pipeline

### Training (Google Colab with L4 GPU)

```bash
# 1. Open colab/train_itransformer.ipynb in Google Colab
# 2. Set HF_TOKEN and HF_REPO_ID in the configuration cell
# 3. Run all cells (~30-60 min on L4 GPU)
# 4. Model auto-exports to ONNX and pushes to HuggingFace Hub
```

**Training approach:**
- **Universal model** trained on all 80+ screener stocks simultaneously
- 10 years of daily data per stock → ~200K training windows total
- 100+ features: OHLCV technicals + macro indicators (VIX term structure, Treasury yields, USD, Gold, Oil)
- Walk-forward validation: 70/15/15 chronological split (no look-ahead bias)
- HuberLoss(delta=0.02) — robust to earnings/event return outliers
- iTransformer architecture (ICLR 2024): features as tokens, cross-variate multi-head attention

**Why universal over per-stock models:**
- 200K samples >> 2,500 per stock → better generalization
- Features encode stock identity (beta, market cap, vol regime)
- Single model to deploy (~2-5MB ONNX)
- Captures cross-stock patterns (sector rotation, risk-on/off)

### Additional Data Sources

Beyond per-stock OHLCV, the model ingests macro indicators (all free via Yahoo Finance):

| Ticker | Description | Signal |
|--------|-------------|--------|
| ^VIX, ^VIX3M | VIX term structure | Contango = complacency, backwardation = stress |
| ^TNX | 10-year Treasury yield | Rate regime, growth vs value rotation |
| DX-Y.NYB | US Dollar Index | Inverse equity correlation, import/export impact |
| GC=F | Gold futures | Risk-off flight indicator |
| CL=F | Crude Oil futures | Energy sector driver, inflation proxy |

### Hypotheses

1. **Universal > per-stock**: Universal model generalizes better on held-out stocks
2. **Macro improves predictions**: VIX/yields/dollar add signal beyond OHLCV
3. **Concordance predicts profitability**: Puts where scoring + iTransformer agree have higher win rates
4. **Longer lookback for longer horizons**: 120d lookback improves 45-60d predictions
5. **Feature selection vs all-features**: Top-K by mutual information vs full feature set

## Quick Start

```bash
npm install
npm run dev          # Development server at http://localhost:3000
npm run build        # Production build (includes TypeScript + lint checks)
npx jest             # 31 validation tests
```

## Simulation Trading Setup (Neon Postgres)

PutStrike includes a simulation trading system that lets you paper-trade put sales from scored recommendations and track P&L over time.

### Option A: Vercel Dashboard (Recommended for Deployment)

Vercel has built-in Neon integration. This is the easiest path if deploying on Vercel.

1. Go to your Vercel project → **Storage** tab
2. Click **Connect Database** → select your existing Neon database, or click **Create Database** to create a new one
3. Vercel auto-injects `POSTGRES_URL` (and related env vars) into your project — no manual config needed
4. Redeploy and the trades feature is live

PutStrike auto-detects both `POSTGRES_URL` (Vercel) and `DATABASE_URL` (manual), so either works.

### Option B: Manual Neon Setup (Local Dev or Self-Hosted)

1. Sign up at [neon.tech](https://neon.tech) (free tier: 0.5 GB storage, always-on compute)
2. Create a new project (any name, e.g., "putstrike")
3. Copy the connection string from the Neon dashboard
4. Create `.env.local` in the project root:

```bash
# Neon Postgres connection string for simulation trading
DATABASE_URL="postgresql://user:password@ep-xxx-xxx-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

5. Restart the dev server

### Using Simulation Trading

No migration step needed — the schema auto-creates on first API request.

1. Run the screener or analyze a stock
2. Expand any put row and click **"Simulate Trade"**
3. Review the pre-filled trade parameters and click **"Open Simulated Trade"**
4. Switch to the **Trades** tab to view your dashboard
5. Close trades by clicking **"Close"** and selecting the outcome (Expired, Profit, Loss, Assigned)

### Trade Analytics

The Trades dashboard provides:
- **KPI Cards**: Total P&L, win rate, avg return, capital at risk, best/worst trade
- **Win Rate Donut**: Visual win/loss ratio (SVG)
- **Cumulative P&L Chart**: Equity curve across all closed trades (SVG)
- **Monthly P&L Bars**: Monthly performance breakdown (SVG)
- **Per-Symbol Breakdown**: Horizontal bar chart ranked by total P&L per stock
- **Score vs Outcome**: Compares avg entry score for winners vs losers — validates the scoring model

## Research Foundation

| Source | Finding | Implementation |
|--------|---------|----------------|
| tastytrade | 45 DTE, 16 delta, manage at 50% profit | DTE/delta scoring weights |
| DataDrivenOptions | 20 delta optimizes theta for short puts | Delta quality sweet spot |
| Schwab | IVR>30 + IVP>50 → 56.8% win rate | IV rank checklist threshold |
| CBOE | Beta ≤1.2 → higher put-selling win rates | Beta scoring + checklist |
| Spintwig | SPY wheel Sharpe 1.08 vs 0.70 buy-hold | Validates scoring approach |
| ERN | Wheel fails in prolonged bear markets | VIX crisis regime penalty |
| iTransformer (ICLR 2024) | Cross-variate attention for time series | Deep learning forecasting |

## Disclaimer

PutStrike is a research and educational tool. Options trading involves substantial risk of loss. Past performance does not guarantee future results. Always do your own research before trading.

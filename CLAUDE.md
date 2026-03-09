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

- **`/api/analyze?symbol=AAPL`** - Deep analysis with stability scoring. Fetches multiple expirations (14-75 DTE window), computes Greeks via Black-Scholes, scores all OTM puts, returns sorted results with HV rank, stability assessment, and market regime.

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
- `Top10Puts` - Ranked top 10 put sales with expandable details and stability scores
- `PutTable` - Expandable table of scored puts with trade details
- `ScreenerResults` - Multi-stock collapsible results view with stability scores
- Data source status indicator (connected/degraded/down)

## Key Design Decisions

1. **Scoring model over ML** - Research findings are well-established (tastytrade, DataDrivenOptions). A transparent weighted model is more interpretable and reliable than ML for this problem. The edge comes from filtering/timing, not prediction.

2. **Company stability as a scoring dimension** - When you sell a put, you agree to buy the stock. The underlying must be one you'd want to own if assigned. Beta, market cap, dividends, and 52-week position capture this.

3. **HV Rank as IV Rank proxy** - True IV rank requires historical IV data (not freely available). We compute 20-day rolling historical volatility rank as a proxy.

4. **Batch processing for rate limiting** - Yahoo Finance aggressively rate limits. Processing 3 symbols at a time with 1-second delays between batches + retry with exponential backoff prevents cascade failures.

5. **yahoo-finance2 for data** - Free, JS-native, community-maintained since 2013. v3 requires `new YahooFinance()` instantiation.

6. **Data source status display** - Shows connected/degraded/down status so users know when data is stale or unavailable. Lists failed symbols in degraded mode.

## Research References

- tastytrade: 45 DTE, 16 delta, manage at 50% profit, stop at 2x credit
- DataDrivenOptions: 20 delta optimizes theta for short puts
- Schwab: IV Rank > 30 + IV Percentile > 50 produces 56.8% win rate
- Spintwig: SPY wheel backtests show Sharpe 1.08 vs 0.70 buy-hold
- CBOE: Lower-beta underlyings have higher put-selling win rates
- Early Retirement Now: Wheel strategy struggles in prolonged bear markets

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

## Common Issues

- **yahoo-finance2 errors**: The library may fail during market closures or for symbols with no options. Errors are caught per-symbol in the screener; the UI shows failed symbols.
- **Rate limiting**: The screener processes 3 stocks at a time with 1s delays. If Yahoo still throttles, reduce `batchSize` in `src/app/api/screen/route.ts`.
- **Type errors with yahoo-finance2**: The library has complex generics. We use `any` casts in `yahoo-finance.ts` — this is intentional for practicality.
- **v3 migration**: yahoo-finance2 v3 requires `new YahooFinance()` instead of the default export.

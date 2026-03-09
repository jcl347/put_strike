# CLAUDE.md - Development Guide for PutStrike

## Project Overview

PutStrike is a Next.js 15 app (App Router) that optimizes cash-secured put option sales using live market data and a research-validated multi-factor scoring model. Deployed on Vercel.

## Commands

- `npm run dev` - Start development server
- `npm run build` - Production build (also runs TypeScript checking and linting)
- `npx jest` - Run 24 validation tests (scoring model + Black-Scholes accuracy)
- `npx jest --watch` - Run tests in watch mode

## Architecture

### Core Engine (`src/lib/`)

- **`black-scholes.ts`** - Black-Scholes-Merton pricing model for European puts. Uses Abramowitz & Stegun 26.2.17 for the normal CDF (error < 7.5e-8). Newton-Raphson IV solver with bisection fallback. All Greeks computed analytically.

- **`scoring.ts`** - Multi-factor scoring engine. Six weighted dimensions: premium yield (25%), delta quality (20%), DTE quality (15%), liquidity (15%), distance OTM (15%), HV rank (10%). Market regime modifier based on VIX. Outputs a 0-100 score with recommendation (STRONG_SELL / SELL / NEUTRAL / AVOID).

- **`yahoo-finance.ts`** - Data provider wrapping yahoo-finance2. Fetches quotes, options chains, historical prices for HV calculation, VIX, and symbol search. Uses `any` casts for yahoo-finance2 return types due to strict/complex generics.

### API Routes (`src/app/api/`)

All routes are `force-dynamic` (no caching — live data).

- **`/api/analyze?symbol=AAPL`** - Deep analysis of a single stock. Fetches multiple expirations (14-75 DTE window), computes Greeks via Black-Scholes, scores all OTM puts, returns sorted results with HV rank and market regime.

- **`/api/screen?symbols=AAPL,MSFT`** - Multi-stock screener. Defaults to 18 high-liquidity stocks. Returns top 5 puts per stock, sorted by best score across all stocks.

- **`/api/options?symbol=AAPL`** - Raw options chain data with quote and VIX.

- **`/api/search?q=app`** - Symbol autocomplete search.

### Frontend (`src/components/`)

Client-side React components with Tailwind CSS (v4). Dark theme only.

- `SymbolSearch` - Debounced autocomplete with dropdown
- `MarketRegime` - VIX-based regime indicator (color-coded)
- `StockQuoteCard` - Quote display with HV rank visualization
- `PutTable` - Expandable table of scored puts with trade details
- `ScreenerResults` - Multi-stock collapsible results view

## Key Design Decisions

1. **Scoring model over ML** - Research findings are well-established (tastytrade, DataDrivenOptions). A transparent weighted model is more interpretable and reliable than ML for this problem. The edge comes from filtering/timing, not prediction.

2. **HV Rank as IV Rank proxy** - True IV rank requires historical IV data (not freely available). We compute 20-day rolling historical volatility rank as a proxy. This is a reasonable approximation since IV and HV are correlated and mean-reverting.

3. **yahoo-finance2 for data** - Free, JS-native, community-maintained since 2013. Tradeoff: unofficial API that may break if Yahoo changes their site. For production, consider Alpha Vantage or Theta Data.

4. **Server-side Greeks computation** - We compute Greeks via Black-Scholes rather than relying on exchange-reported Greeks because: (a) not all options have reported Greeks, (b) it ensures consistency, (c) it allows sensitivity analysis.

5. **No database** - All data is fetched live from Yahoo Finance. No persistence needed for the core use case. Future enhancement: add a database for tracking opened positions and P&L.

## Research References

- tastytrade: 45 DTE, 16 delta, manage at 50% profit, stop at 2x credit
- DataDrivenOptions: 20 delta optimizes theta for short puts
- Schwab: IV Rank > 30 + IV Percentile > 50 produces 56.8% win rate
- Spintwig: SPY wheel backtests show Sharpe 1.08 vs 0.70 buy-hold
- Early Retirement Now: Wheel strategy struggles in prolonged bear markets

## Modifying the Scoring Model

Weights are in `src/lib/scoring.ts` in the `scorePut()` function. Each factor has:
1. A raw score (0-100) computed from the candidate's attributes
2. A weight (all weights sum to 1.0)
3. A signal object for UI display

To adjust scoring:
- Change weights in the final `score` calculation
- Modify score thresholds in individual factor scoring blocks
- Adjust recommendation cutoffs (75/55/40)
- Modify regime multipliers in `classifyMarketRegime()`

Always run `npx jest` after changes to verify model behavior.

## Common Issues

- **yahoo-finance2 errors**: The library may fail during market closures or for symbols with no options. Errors are caught and returned as JSON error responses.
- **Rate limiting**: The screener fetches data for 18 stocks in parallel. If Yahoo throttles requests, reduce `DEFAULT_SYMBOLS` in `src/app/api/screen/route.ts`.
- **Type errors with yahoo-finance2**: The library has complex generics. We use `any` casts in `yahoo-finance.ts` — this is intentional for practicality.

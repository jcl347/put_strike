# PutStrike - Put Options Selling Optimizer

A research-backed tool for optimizing cash-secured put sales. Built with Next.js and deployable on Vercel, PutStrike uses live market data and a multi-factor scoring model to identify optimal put selling opportunities.

## Research Foundation

The scoring model is built on established options research:

| Source | Key Finding | How We Use It |
|--------|------------|---------------|
| [tastytrade Market Measures](https://www.tastytrade.com/tt/shows/market-measures/episodes/increasing-duration-a-put-selling-experiment-05-04-2016) | 45 DTE is optimal entry; 16 delta; manage at 50% profit | DTE and delta scoring weights |
| [DataDrivenOptions](https://datadrivenoptions.com/best-delta-put-spreads/) | 20 delta short put optimizes theta | Delta sweet spot range (0.15-0.30) |
| [Schwab IV Percentile Research](https://www.schwab.com/learn/story/using-implied-volatility-percentiles) | IV Rank > 30 + IV Percentile > 50 filters produce 56.8% win rate vs 48.2% unfiltered | HV Rank scoring factor |
| [Spintwig SPY Backtests](https://spintwig.com/spy-wheel-45-dte-options-backtest/) | Risk-adjusted returns (Sharpe) matter more than absolute returns; Sharpe 1.08 vs 0.70 for buy-hold | Focus on probability-weighted returns |
| [Barchart IV Rank vs Percentile](https://www.barchart.com/education/iv_rank_vs_iv_percentile) | Both IV rank and percentile above 50 = historically expensive premiums | Premium environment classification |
| [The Option Premium - Delta Guide](https://www.theoptionpremium.com/p/how-to-use-delta-when-selling-puts-targeting-the-right-strike-price-like-a-pro) | 0.25-0.35 delta is the balanced risk/reward sweet spot | Default delta targeting |
| [Early Retirement Now - Wheel Strategy Analysis](https://earlyretirementnow.com/2024/09/17/the-wheel-strategy-doesnt-work-options-series-part-12/) | Prolonged bear markets destroy wheel returns | VIX-based regime detection and CRISIS penalty |

### Why a Scoring Model Instead of ML

We evaluated whether machine learning would improve put selection. Our conclusion: **a transparent multi-factor scoring model is superior for this use case** because:

1. **Interpretability matters for trading decisions** - You need to understand *why* a put scores highly, not just that it does
2. **The research is clear and well-validated** - tastytrade's 45 DTE / 16 delta findings are backtested across thousands of trades
3. **Options pricing is well-modeled by Black-Scholes** - the underlying math is solved; the edge comes from *filtering* and *timing*, not prediction
4. **ML needs large labeled datasets** - Options outcomes are path-dependent and regime-dependent, making training data problematic
5. **Overfitting risk** - An ML model would likely overfit to recent market conditions and fail in regime changes

The scoring weights are derived from relative importance established in backtesting literature, not arbitrary choices.

## Scoring Model

Each put option is scored 0-100 using six weighted factors:

| Factor | Weight | Optimal Range | Rationale |
|--------|--------|---------------|-----------|
| Premium Yield (annualized) | 25% | >10% annualized | Primary income driver |
| Delta | 20% | -0.15 to -0.30 | Probability of profit sweet spot |
| DTE | 15% | 30-45 days | Theta decay acceleration zone |
| Liquidity | 15% | Spread <5%, OI >500 | Execution quality |
| Distance OTM | 15% | 5-15% below price | Margin of safety |
| HV Rank | 10% | >50% | Premium richness indicator |

A market regime modifier is applied based on VIX:
- **Normal (VIX 15-25)**: 1.0x (ideal conditions)
- **Low Vol (<15)**: 0.95x (thin premiums)
- **High Vol (25-35)**: 0.9x (caution, wider strikes needed)
- **Crisis (>35)**: 0.6x (significant risk penalty)

### Recommendations

| Score | Recommendation | Meaning |
|-------|---------------|---------|
| 75+ | STRONG SELL PUT | All factors align favorably |
| 55-74 | SELL PUT | Good opportunity with minor concerns |
| 40-54 | NEUTRAL | Mixed signals, proceed with caution |
| <40 | AVOID | One or more critical factors unfavorable |

## Architecture

```
src/
  lib/
    black-scholes.ts    # BS pricing, Greeks, IV solver (Newton-Raphson + bisection)
    scoring.ts          # Multi-factor scoring engine
    yahoo-finance.ts    # Live data provider (yahoo-finance2)
    __tests__/
      scoring.test.ts   # 24 validation tests
  app/
    page.tsx            # Main UI with search, analysis, screener
    api/
      analyze/route.ts  # Deep single-stock analysis
      screen/route.ts   # Multi-stock screener (top 18 liquid stocks)
      options/route.ts  # Raw options chain data
      search/route.ts   # Symbol search autocomplete
  components/
    SymbolSearch.tsx     # Autocomplete stock search
    MarketRegime.tsx     # VIX regime indicator
    StockQuoteCard.tsx   # Quote + volatility display
    PutTable.tsx         # Scored puts with expandable details
    ScreenerResults.tsx  # Multi-stock results grid
```

## Data Sources

- **Live quotes & options chains**: [yahoo-finance2](https://github.com/gadicc/yahoo-finance2) (free, community-maintained since 2013)
- **VIX**: Yahoo Finance ^VIX quote
- **Historical volatility**: Computed from 1-year daily price history using 20-day rolling standard deviation, annualized by sqrt(252)
- **Greeks**: Computed locally using Black-Scholes-Merton (Abramowitz & Stegun 26.2.17 normal CDF approximation)

## Getting Started

### Prerequisites

- Node.js 20+ (LTS)
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production Build

```bash
npm run build
npm start
```

### Tests

```bash
npx jest
```

Runs 24 validation tests covering:
- Market regime classification (4 tests)
- Scoring model behavior against research findings (10 tests)
- Put ranking and filtering (3 tests)
- Black-Scholes pricing accuracy (7 tests, including IV roundtrip and put-call parity)

### Deploy to Vercel

```bash
npx vercel
```

Or connect the repository to Vercel for automatic deployments.

## Usage

### Single Stock Analysis

1. Enter a stock symbol (e.g., AAPL, SPY, MSFT) in the search bar
2. The system fetches live options chains across multiple expirations
3. Each put is scored and ranked, showing the best opportunities
4. Expand any row to see trade details (collateral, breakeven, max profit/loss)

### Multi-Stock Screener

Click "Screen Top Stocks" to scan 18 liquid stocks (AAPL, MSFT, GOOGL, AMZN, META, NVDA, JPM, V, JNJ, PG, KO, PEP, WMT, HD, DIS, SPY, QQQ, IWM) for the best put selling opportunities across all of them.

### Trade Management (from tastytrade research)

Once you enter a trade based on PutStrike recommendations:

1. **Close at 50% of max profit** - Don't wait for full expiration
2. **Stop loss at 2x premium received** - Cut losers early
3. **Roll at 21 DTE** - If still profitable, roll to new 45 DTE cycle
4. **Never hold through earnings** - Close before earnings announcements
5. **Position sizing**: Max 5% of portfolio per position

## Validation

The scoring model has been validated against research findings:

- Sweet spot puts (45 DTE, 0.20 delta, good liquidity) achieve scores >70 (STRONG SELL)
- Extreme deltas (<0.05 or >0.45) score lower than sweet spot range
- 45 DTE correctly scores higher than 90 DTE in the DTE dimension
- High HV Rank (60%) produces higher scores than low HV Rank (10%)
- Crisis regime (VIX >35) applies a 40% penalty
- Good liquidity significantly outscores poor liquidity
- 5-15% OTM distance outscores both ITM and very far OTM
- Black-Scholes pricing matches known analytical values (ATM put at $5.57 for standard params)
- Implied volatility solver recovers input volatility with <0.01 error
- Put-call parity holds

## Disclaimer

PutStrike is a research and educational tool. Options trading involves substantial risk of loss and is not appropriate for all investors. Past performance and backtesting results do not guarantee future results. Always do your own research and consider consulting a financial advisor before trading options.

"use client";

/**
 * StockForecast — iTransformer time series prediction display
 *
 * Shows predicted price trajectory with confidence bands for stocks
 * in the Screen Top Stocks results. Compact inline display.
 */

interface ForecastData {
  symbol: string;
  predicted_prices: number[];
  forecast_returns: number[];
  current_price: number;
  horizon_days: number;
  confidence: {
    lower_68: number[];
    upper_68: number[];
  };
  model_confidence: number;
  metadata?: {
    test_metrics?: {
      dir_acc_7d?: number;
      dir_acc_30d?: number;
      dir_acc_60d?: number;
    };
  };
}

interface StockForecastProps {
  forecast: ForecastData;
  compact?: boolean;
}

export default function StockForecast({
  forecast,
  compact = false,
}: StockForecastProps) {
  const { predicted_prices, current_price, forecast_returns, confidence } =
    forecast;

  if (!predicted_prices || predicted_prices.length === 0) return null;

  // Key horizon predictions
  const horizons = [
    { label: "7d", idx: 6 },
    { label: "14d", idx: 13 },
    { label: "30d", idx: 29 },
    { label: "45d", idx: 44 },
    { label: "60d", idx: 59 },
  ].filter((h) => h.idx < predicted_prices.length);

  // Overall direction
  const endReturn =
    forecast_returns[forecast_returns.length - 1] ?? 0;
  const direction = endReturn > 0.005 ? "bullish" : endReturn < -0.005 ? "bearish" : "neutral";

  // Mini sparkline using CSS
  const minPrice = Math.min(current_price, ...predicted_prices);
  const maxPrice = Math.max(current_price, ...predicted_prices);
  const priceRange = maxPrice - minPrice || 1;

  // Sample 12 points for sparkline
  const sparkPoints = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
    .filter((i) => i < predicted_prices.length)
    .map((i) => ({
      price: predicted_prices[i],
      pct: ((predicted_prices[i] - minPrice) / priceRange) * 100,
    }));

  if (compact) {
    // Compact inline display for screener list items
    const ret30d = forecast_returns[29] ?? forecast_returns[forecast_returns.length - 1] ?? 0;
    const pct = (ret30d * 100).toFixed(1);

    return (
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-medium ${
            ret30d > 0.005
              ? "text-green-400"
              : ret30d < -0.005
              ? "text-red-400"
              : "text-gray-400"
          }`}
        >
          {ret30d > 0 ? "+" : ""}
          {pct}%
        </span>
        <span className="text-[10px] text-gray-500">30d</span>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-gray-300">
            iTransformer Forecast
          </h4>
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              direction === "bullish"
                ? "bg-green-900/30 text-green-400"
                : direction === "bearish"
                ? "bg-red-900/30 text-red-400"
                : "bg-gray-700 text-gray-400"
            }`}
          >
            {direction === "bullish"
              ? "Bullish"
              : direction === "bearish"
              ? "Bearish"
              : "Neutral"}
          </span>
        </div>
        <span className="text-[10px] text-gray-500">
          {forecast.model_confidence > 0
            ? `${(forecast.model_confidence * 100).toFixed(0)}% confidence`
            : ""}
        </span>
      </div>

      {/* Sparkline visualization */}
      <div className="flex items-end gap-px h-8 mb-3">
        {sparkPoints.map((p, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t-sm min-w-[3px] ${
              p.price >= current_price ? "bg-green-500/60" : "bg-red-500/60"
            }`}
            style={{ height: `${Math.max(10, p.pct)}%` }}
            title={`$${p.price.toFixed(2)}`}
          />
        ))}
      </div>

      {/* Horizon predictions */}
      <div className="grid grid-cols-5 gap-2">
        {horizons.map((h) => {
          const ret = forecast_returns[h.idx] ?? 0;
          const price = predicted_prices[h.idx] ?? current_price;
          const lo = confidence.lower_68[h.idx] ?? price;
          const hi = confidence.upper_68[h.idx] ?? price;

          return (
            <div key={h.label} className="text-center">
              <div className="text-[10px] text-gray-500 mb-0.5">
                {h.label}
              </div>
              <div
                className={`text-xs font-medium ${
                  ret > 0.005
                    ? "text-green-400"
                    : ret < -0.005
                    ? "text-red-400"
                    : "text-gray-400"
                }`}
              >
                {ret > 0 ? "+" : ""}
                {(ret * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-gray-600">
                ${lo.toFixed(0)}-{hi.toFixed(0)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Concordance note */}
      <div className="mt-2 text-[10px] text-gray-600 text-right">
        ICLR 2024 &middot; 60d lookback &middot; ONNX
      </div>
    </div>
  );
}

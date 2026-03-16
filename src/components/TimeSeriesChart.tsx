"use client";

/**
 * TimeSeriesChart — SVG-based 60-day forecast visualization
 *
 * Shows historical prices + iTransformer predicted prices with confidence bands.
 * Pure CSS/SVG — no chart library dependency.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface TimeSeriesChartProps {
  historicalPrices: { date: string; close: number }[];
  predictedPrices: number[];
  currentPrice: number;
  symbol: string;
  confidence?: {
    lower_68: number[];
    upper_68: number[];
    lower_95: number[];
    upper_95: number[];
  };
  /** Model directional accuracy confidence (0-1) */
  modelConfidence?: number;
  /** DTE markers to show on the forecast (e.g., put expiration dates) */
  dteMarkers?: { dte: number; label: string }[];
}

export default function TimeSeriesChart({
  historicalPrices,
  predictedPrices,
  currentPrice,
  symbol,
  confidence,
  modelConfidence,
  dteMarkers,
}: TimeSeriesChartProps) {
  if (!predictedPrices || predictedPrices.length === 0) return null;

  const W = 600;
  const H = 200;
  const PAD_L = 55;
  const PAD_R = 10;
  const PAD_T = 15;
  const PAD_B = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  // Build data series
  const histCloses = historicalPrices.map((p) => p.close);
  const allPrices = [
    ...histCloses,
    ...predictedPrices,
    ...(confidence?.upper_95 ?? []),
    ...(confidence?.lower_95 ?? []),
  ];
  const minP = Math.min(...allPrices) * 0.995;
  const maxP = Math.max(...allPrices) * 1.005;
  const totalDays = histCloses.length + predictedPrices.length;

  const xScale = (i: number) => PAD_L + (i / (totalDays - 1)) * plotW;
  const yScale = (p: number) =>
    PAD_T + plotH - ((p - minP) / (maxP - minP)) * plotH;

  // Historical line
  const histLine = histCloses
    .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(p).toFixed(1)}`)
    .join(" ");

  // Forecast line (starts from current price)
  const forecastStart = histCloses.length - 1;
  const forecastLine = [currentPrice, ...predictedPrices]
    .map((p, i) => {
      const x = xScale(forecastStart + i);
      const y = yScale(p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // 95% confidence band
  let confBand95 = "";
  if (confidence?.upper_95 && confidence?.lower_95) {
    const upper = [currentPrice, ...confidence.upper_95];
    const lower = [currentPrice, ...confidence.lower_95];
    const topPath = upper.map(
      (p, i) => `${i === 0 ? "M" : "L"}${xScale(forecastStart + i).toFixed(1)},${yScale(p).toFixed(1)}`
    );
    const bottomPath = [...lower]
      .reverse()
      .map(
        (p, i) =>
          `L${xScale(forecastStart + lower.length - 1 - i).toFixed(1)},${yScale(p).toFixed(1)}`
      );
    confBand95 = `${topPath.join(" ")} ${bottomPath.join(" ")} Z`;
  }

  // 68% confidence band
  let confBand68 = "";
  if (confidence?.upper_68 && confidence?.lower_68) {
    const upper = [currentPrice, ...confidence.upper_68];
    const lower = [currentPrice, ...confidence.lower_68];
    const topPath = upper.map(
      (p, i) => `${i === 0 ? "M" : "L"}${xScale(forecastStart + i).toFixed(1)},${yScale(p).toFixed(1)}`
    );
    const bottomPath = [...lower]
      .reverse()
      .map(
        (p, i) =>
          `L${xScale(forecastStart + lower.length - 1 - i).toFixed(1)},${yScale(p).toFixed(1)}`
      );
    confBand68 = `${topPath.join(" ")} ${bottomPath.join(" ")} Z`;
  }

  // Y-axis labels (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const p = minP + ((maxP - minP) * i) / 4;
    return { price: p, y: yScale(p) };
  });

  // End prediction info
  const endPrice = predictedPrices[predictedPrices.length - 1];
  const returnPct = ((endPrice / currentPrice - 1) * 100).toFixed(1);
  const isUp = endPrice >= currentPrice;

  // Key horizon returns
  const horizons = [
    { label: "7d", idx: 6 },
    { label: "14d", idx: 13 },
    { label: "30d", idx: 29 },
    { label: "45d", idx: 44 },
    { label: "60d", idx: 59 },
  ].filter((h) => h.idx < predictedPrices.length);

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-gray-300">
            {symbol} iTransformer Forecast
          </h4>
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              isUp
                ? "bg-green-900/30 text-green-400"
                : "bg-red-900/30 text-red-400"
            }`}
          >
            {isUp ? "+" : ""}
            {returnPct}% (60d)
          </span>
          {modelConfidence != null && (
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                modelConfidence >= 0.6
                  ? "bg-green-900/20 text-green-500"
                  : modelConfidence >= 0.5
                  ? "bg-yellow-900/20 text-yellow-500"
                  : "bg-gray-800 text-gray-500"
              }`}
            >
              {(modelConfidence * 100).toFixed(0)}% confidence
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-600">
          ONNX &middot; 60d lookback &middot; {predictedPrices.length}d forecast
        </span>
      </div>

      {/* SVG Chart */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ maxHeight: 220 }}
      >
        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={t.y}
              y2={t.y}
              stroke="#374151"
              strokeWidth={0.5}
            />
            <text
              x={PAD_L - 5}
              y={t.y + 3}
              textAnchor="end"
              fill="#6b7280"
              fontSize={9}
            >
              ${t.price.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Divider line between historical and forecast */}
        <line
          x1={xScale(forecastStart)}
          x2={xScale(forecastStart)}
          y1={PAD_T}
          y2={H - PAD_B}
          stroke="#4b5563"
          strokeWidth={1}
          strokeDasharray="4,3"
        />
        <text
          x={xScale(forecastStart)}
          y={H - PAD_B + 12}
          textAnchor="middle"
          fill="#6b7280"
          fontSize={8}
        >
          Today
        </text>

        {/* 95% confidence band */}
        {confBand95 && (
          <path d={confBand95} fill="rgba(59, 130, 246, 0.08)" />
        )}

        {/* 68% confidence band */}
        {confBand68 && (
          <path d={confBand68} fill="rgba(59, 130, 246, 0.15)" />
        )}

        {/* Historical price line */}
        <path
          d={histLine}
          fill="none"
          stroke="#9ca3af"
          strokeWidth={1.5}
        />

        {/* Forecast price line */}
        <path
          d={forecastLine}
          fill="none"
          stroke={isUp ? "#4ade80" : "#f87171"}
          strokeWidth={2}
        />

        {/* Current price dot */}
        <circle
          cx={xScale(forecastStart)}
          cy={yScale(currentPrice)}
          r={3}
          fill="#60a5fa"
        />

        {/* DTE markers */}
        {dteMarkers?.map((m) => {
          // Convert calendar DTE to ~trading days
          const tradingDay = Math.round(m.dte * 5 / 7);
          if (tradingDay >= predictedPrices.length) return null;
          const x = xScale(forecastStart + tradingDay);
          const price = predictedPrices[tradingDay] ?? currentPrice;
          return (
            <g key={m.label}>
              <line
                x1={x}
                x2={x}
                y1={yScale(price) - 8}
                y2={yScale(price) + 8}
                stroke="#f59e0b"
                strokeWidth={1}
              />
              <text
                x={x}
                y={PAD_T + 8}
                textAnchor="middle"
                fill="#f59e0b"
                fontSize={7}
              >
                {m.label}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        <text
          x={PAD_L}
          y={H - PAD_B + 12}
          textAnchor="start"
          fill="#6b7280"
          fontSize={8}
        >
          -60d
        </text>
        <text
          x={W - PAD_R}
          y={H - PAD_B + 12}
          textAnchor="end"
          fill="#6b7280"
          fontSize={8}
        >
          +60d
        </text>
      </svg>

      {/* Horizon predictions row */}
      <div className="grid grid-cols-5 gap-2 mt-2">
        {horizons.map((h) => {
          const price = predictedPrices[h.idx];
          const ret = (price / currentPrice - 1) * 100;
          const lo68 = confidence?.lower_68?.[h.idx];
          const hi68 = confidence?.upper_68?.[h.idx];
          return (
            <div key={h.label} className="text-center">
              <div className="text-[10px] text-gray-500">{h.label}</div>
              <div
                className={`text-xs font-medium ${
                  ret > 0.5
                    ? "text-green-400"
                    : ret < -0.5
                    ? "text-red-400"
                    : "text-gray-400"
                }`}
              >
                {ret > 0 ? "+" : ""}
                {ret.toFixed(1)}%
              </div>
              <div className="text-[10px] text-gray-600">
                ${price.toFixed(0)}
                {lo68 != null && hi68 != null && (
                  <span>
                    {" "}
                    ({lo68.toFixed(0)}-{hi68.toFixed(0)})
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-600">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-gray-400 inline-block" /> Historical
        </span>
        <span className="flex items-center gap-1">
          <span className={`w-3 h-0.5 inline-block ${isUp ? "bg-green-400" : "bg-red-400"}`} /> Forecast
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-2 bg-blue-500/15 inline-block" /> 68% CI
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-2 bg-blue-500/8 inline-block" /> 95% CI
        </span>
      </div>
    </div>
  );
}

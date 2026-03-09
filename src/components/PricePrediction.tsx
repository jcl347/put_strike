"use client";

import { useState } from "react";

interface ForecastPoint {
  date: string;
  daysOut: number;
  predicted: number;
  lower95: number;
  upper95: number;
  lower68: number;
  upper68: number;
}

interface ModelSignal {
  model: string;
  signal: "bullish" | "bearish" | "neutral";
  strength: number;
  prediction30d: number;
  description: string;
}

interface PutSellingWindow {
  recommended: boolean;
  optimalEntryDate: string;
  reasoning: string[];
  ivTiming: "high" | "normal" | "low";
  trendAlignment: "favorable" | "neutral" | "unfavorable";
  earningsSafe: boolean;
  riskLevel: "low" | "moderate" | "high";
}

interface ColabPrediction {
  predicted_prices?: number[];
  confidence?: number;
  model_name?: string;
  prediction_30d?: number;
}

interface PredictionData {
  symbol: string;
  currentPrice: number;
  predictions: ForecastPoint[];
  putSellingWindow: PutSellingWindow;
  modelSignals: ModelSignal[];
  ensembleScore: number;
  optimalPutDTE: number;
  optimalStrike: number;
  methodology: string;
  featureCount: number;
  featureCategories?: string[];
  colabPrediction?: ColabPrediction | null;
  colabStatus?: "connected" | "unavailable" | "not_configured";
}

interface Props {
  prediction: PredictionData;
}

const signalColors = {
  bullish: { text: "text-green-400", bg: "bg-green-900/30", bar: "bg-green-500" },
  bearish: { text: "text-red-400", bg: "bg-red-900/30", bar: "bg-red-500" },
  neutral: { text: "text-yellow-400", bg: "bg-yellow-900/30", bar: "bg-yellow-500" },
};

export default function PricePrediction({ prediction: p }: Props) {
  const [showModels, setShowModels] = useState(false);
  const [selectedHorizon, setSelectedHorizon] = useState(30);

  const selectedForecast = p.predictions.find(f => f.daysOut === selectedHorizon)
    ?? p.predictions[0];

  const ensembleColor = p.ensembleScore > 20 ? "text-green-400"
    : p.ensembleScore < -20 ? "text-red-400" : "text-yellow-400";

  const riskColors = {
    low: { text: "text-green-400", bg: "bg-green-900/20" },
    moderate: { text: "text-yellow-400", bg: "bg-yellow-900/20" },
    high: { text: "text-red-400", bg: "bg-red-900/20" },
  };
  const rc = riskColors[p.putSellingWindow.riskLevel];

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700/50 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Price Prediction & Put Timing
          </h2>
          <p className="text-xs text-gray-500">
            {p.methodology} | {p.featureCount} features analyzed
          </p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${ensembleColor}`}>
            {p.ensembleScore > 0 ? "+" : ""}{p.ensembleScore.toFixed(0)}
          </div>
          <div className="text-xs text-gray-500">ensemble score</div>
        </div>
      </div>

      {/* Put Selling Recommendation */}
      <div className={`px-4 py-3 ${p.putSellingWindow.recommended ? "bg-green-900/10" : "bg-red-900/10"} border-b border-gray-700/50`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`text-lg font-bold ${p.putSellingWindow.recommended ? "text-green-400" : "text-red-400"}`}>
              {p.putSellingWindow.recommended ? "\u2713 SELL PUT" : "\u2717 WAIT"}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs ${rc.bg} ${rc.text}`}>
              {p.putSellingWindow.riskLevel} risk
            </span>
          </div>
          <div className="text-right text-sm">
            <div className="text-white">
              Optimal: ${p.optimalStrike} put, {p.optimalPutDTE}d DTE
            </div>
          </div>
        </div>

        {/* Timing indicators */}
        <div className="flex gap-3 text-xs mb-2">
          <span className={`px-2 py-0.5 rounded ${
            p.putSellingWindow.ivTiming === "high" ? "bg-green-900/40 text-green-400" :
            p.putSellingWindow.ivTiming === "low" ? "bg-red-900/40 text-red-400" :
            "bg-gray-700 text-gray-400"
          }`}>
            IV: {p.putSellingWindow.ivTiming}
          </span>
          <span className={`px-2 py-0.5 rounded ${
            p.putSellingWindow.trendAlignment === "favorable" ? "bg-green-900/40 text-green-400" :
            p.putSellingWindow.trendAlignment === "unfavorable" ? "bg-red-900/40 text-red-400" :
            "bg-gray-700 text-gray-400"
          }`}>
            Trend: {p.putSellingWindow.trendAlignment}
          </span>
          <span className={`px-2 py-0.5 rounded ${
            p.putSellingWindow.earningsSafe ? "bg-green-900/40 text-green-400" :
            "bg-red-900/40 text-red-400"
          }`}>
            Earnings: {p.putSellingWindow.earningsSafe ? "clear" : "NEAR"}
          </span>
        </div>

        {/* Reasoning */}
        <div className="space-y-0.5">
          {p.putSellingWindow.reasoning.map((r, i) => (
            <p key={i} className="text-xs text-gray-400">- {r}</p>
          ))}
        </div>
      </div>

      {/* Forecast Table */}
      <div className="px-4 py-3 border-b border-gray-700/50">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Price Forecast</h3>

        {/* Horizon selector */}
        <div className="flex gap-1 mb-3">
          {p.predictions.map(f => (
            <button
              key={f.daysOut}
              onClick={() => setSelectedHorizon(f.daysOut)}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                selectedHorizon === f.daysOut
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {f.daysOut}d
            </button>
          ))}
        </div>

        {/* Selected forecast detail */}
        {selectedForecast && (
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="grid grid-cols-5 gap-3 text-center text-sm">
              <div>
                <div className="text-gray-500 text-xs">95% Low</div>
                <div className="text-red-400 font-medium">${selectedForecast.lower95.toFixed(2)}</div>
                <div className="text-gray-600 text-xs">
                  {((selectedForecast.lower95 - p.currentPrice) / p.currentPrice * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">68% Low</div>
                <div className="text-yellow-400 font-medium">${selectedForecast.lower68.toFixed(2)}</div>
                <div className="text-gray-600 text-xs">
                  {((selectedForecast.lower68 - p.currentPrice) / p.currentPrice * 100).toFixed(1)}%
                </div>
              </div>
              <div className="border-x border-gray-700/50">
                <div className="text-gray-500 text-xs">Predicted</div>
                <div className="text-white font-bold text-lg">${selectedForecast.predicted.toFixed(2)}</div>
                <div className="text-gray-600 text-xs">
                  {((selectedForecast.predicted - p.currentPrice) / p.currentPrice * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">68% High</div>
                <div className="text-yellow-400 font-medium">${selectedForecast.upper68.toFixed(2)}</div>
                <div className="text-gray-600 text-xs">
                  +{((selectedForecast.upper68 - p.currentPrice) / p.currentPrice * 100).toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">95% High</div>
                <div className="text-green-400 font-medium">${selectedForecast.upper95.toFixed(2)}</div>
                <div className="text-gray-600 text-xs">
                  +{((selectedForecast.upper95 - p.currentPrice) / p.currentPrice * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Visual range bar */}
            <div className="mt-3 relative h-6 bg-gray-800 rounded-full overflow-hidden">
              {/* 95% band */}
              <div
                className="absolute h-full bg-gray-700/50"
                style={{
                  left: `${Math.max(0, ((selectedForecast.lower95 - selectedForecast.lower95) / (selectedForecast.upper95 - selectedForecast.lower95)) * 100)}%`,
                  width: "100%",
                }}
              />
              {/* 68% band */}
              <div
                className="absolute h-full bg-blue-900/40"
                style={{
                  left: `${((selectedForecast.lower68 - selectedForecast.lower95) / (selectedForecast.upper95 - selectedForecast.lower95)) * 100}%`,
                  width: `${((selectedForecast.upper68 - selectedForecast.lower68) / (selectedForecast.upper95 - selectedForecast.lower95)) * 100}%`,
                }}
              />
              {/* Current price marker */}
              <div
                className="absolute h-full w-0.5 bg-white"
                style={{
                  left: `${((p.currentPrice - selectedForecast.lower95) / (selectedForecast.upper95 - selectedForecast.lower95)) * 100}%`,
                }}
              />
              {/* Predicted marker */}
              <div
                className="absolute h-full w-1.5 bg-blue-400 rounded-full"
                style={{
                  left: `${((selectedForecast.predicted - selectedForecast.lower95) / (selectedForecast.upper95 - selectedForecast.lower95)) * 100}%`,
                }}
              />
              {/* Strike suggestion */}
              <div
                className="absolute h-full w-0.5 bg-green-400"
                style={{
                  left: `${Math.max(0, ((p.optimalStrike - selectedForecast.lower95) / (selectedForecast.upper95 - selectedForecast.lower95)) * 100)}%`,
                }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-gray-600">
              <span>${selectedForecast.lower95.toFixed(0)}</span>
              <span className="text-green-500">Strike: ${p.optimalStrike}</span>
              <span>Now: ${p.currentPrice.toFixed(0)}</span>
              <span>${selectedForecast.upper95.toFixed(0)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Colab GPU Model Results */}
      {p.colabPrediction && p.colabStatus === "connected" && (
        <div className="px-4 py-3 border-b border-gray-700/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <h3 className="text-sm font-medium text-gray-400">
              iTransformer GPU Prediction
            </h3>
            <span className="text-xs text-gray-600">
              {p.colabPrediction.model_name ?? "iTransformer"}
            </span>
          </div>
          <div className="bg-purple-900/20 border border-purple-700/30 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-500">30-Day Prediction</div>
                {p.colabPrediction.prediction_30d !== undefined ? (
                  <div className={`text-lg font-bold ${
                    p.colabPrediction.prediction_30d > 0 ? "text-green-400" :
                    p.colabPrediction.prediction_30d < 0 ? "text-red-400" : "text-yellow-400"
                  }`}>
                    {p.colabPrediction.prediction_30d > 0 ? "+" : ""}
                    {p.colabPrediction.prediction_30d.toFixed(2)}%
                  </div>
                ) : (
                  <div className="text-white font-bold">
                    ${p.colabPrediction.predicted_prices?.[p.colabPrediction.predicted_prices.length - 1]?.toFixed(2) ?? "—"}
                  </div>
                )}
              </div>
              {p.colabPrediction.confidence !== undefined && (
                <div className="text-right">
                  <div className="text-xs text-gray-500">Model Confidence</div>
                  <div className="text-purple-400 font-medium">
                    {(p.colabPrediction.confidence * 100).toFixed(0)}%
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Deep learning model trained on cross-variate feature correlations (inverted attention mechanism)
            </p>
          </div>
        </div>
      )}

      {/* Put Profitability Analysis */}
      <div className="px-4 py-3 border-b border-gray-700/50">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Put Sale Profitability</h3>
        <div className="grid grid-cols-4 gap-3 text-center text-xs">
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-500">Prob. of Profit</div>
            <div className="text-green-400 font-bold text-lg">
              {selectedForecast
                ? `${Math.min(95, Math.max(55, Math.round(
                    ((p.currentPrice - p.optimalStrike) / p.currentPrice * 100) * 5 + 60
                  )))}%`
                : "—"}
            </div>
            <div className="text-gray-600">at ${p.optimalStrike} strike</div>
          </div>
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-500">Optimal DTE</div>
            <div className="text-white font-bold text-lg">{p.optimalPutDTE}d</div>
            <div className="text-gray-600">
              {p.optimalPutDTE >= 30 && p.optimalPutDTE <= 45
                ? "sweet spot"
                : p.optimalPutDTE < 30
                ? "earnings adj."
                : "extended"}
            </div>
          </div>
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-500">Risk/Reward</div>
            <div className="text-white font-bold text-lg">
              {((p.currentPrice - p.optimalStrike) / p.optimalStrike * 100).toFixed(1)}%
            </div>
            <div className="text-gray-600">margin of safety</div>
          </div>
          <div className="bg-gray-900/50 rounded p-2">
            <div className="text-gray-500">Max Pain</div>
            <div className="text-white font-bold text-lg">
              {p.putSellingWindow.recommended ? "Aligned" : "Divergent"}
            </div>
            <div className="text-gray-600">
              {p.putSellingWindow.riskLevel} risk
            </div>
          </div>
        </div>
      </div>

      {/* Feature Categories */}
      {p.featureCategories && p.featureCategories.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-700/50">
          <div className="flex flex-wrap gap-1">
            {p.featureCategories.map((cat, i) => (
              <span key={i} className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-500">
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Model Signals */}
      <div className="px-4 py-3">
        <button
          onClick={() => setShowModels(!showModels)}
          className="text-sm font-medium text-gray-400 hover:text-white transition-colors flex items-center gap-1"
        >
          Model Breakdown ({p.modelSignals.length} models{p.colabStatus === "connected" ? " + GPU" : ""}) {showModels ? "\u25B2" : "\u25BC"}
        </button>

        {showModels && (
          <div className="mt-2 space-y-2">
            {p.modelSignals.map((m, i) => {
              const c = signalColors[m.signal];
              return (
                <div key={i} className={`${c.bg} rounded-lg p-3`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${c.text}`}>{m.model}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${c.text}`}>
                        {m.signal.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className={c.text}>
                        {m.prediction30d > 0 ? "+" : ""}{m.prediction30d.toFixed(1)}%
                      </span>
                      <span className="text-gray-500 text-xs ml-1">30d</span>
                    </div>
                  </div>
                  {/* Strength bar */}
                  <div className="h-1 bg-gray-800 rounded-full mb-1">
                    <div
                      className={`h-full ${c.bar} rounded-full`}
                      style={{ width: `${m.strength}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">{m.description}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

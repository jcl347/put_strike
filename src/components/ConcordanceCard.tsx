"use client";

/**
 * ConcordanceCard — Validates iTransformer predictions against the statistical ensemble.
 *
 * Compares directional signals and magnitude across both prediction systems.
 * Concordant predictions (both agree) get higher confidence; discordant ones are flagged.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ConcordanceCardProps {
  iTransformerForecast: {
    symbol: string;
    forecast_returns: number[];
    predicted_prices: number[];
    current_price: number;
    model_confidence: number;
  };
  ensemblePrediction: {
    ensembleScore: number;
    predictions: Array<{
      daysOut: number;
      predicted: number;
    }>;
    putSellingWindow: {
      recommended: boolean;
      riskLevel: string;
    };
    modelSignals: Array<{
      model: string;
      signal: "bullish" | "bearish" | "neutral";
      prediction30d: number;
    }>;
  };
  symbol: string;
}

type Agreement = "concordant" | "discordant" | "partial";

function getDirection(returnPct: number): "bullish" | "bearish" | "neutral" {
  if (returnPct > 0.5) return "bullish";
  if (returnPct < -0.5) return "bearish";
  return "neutral";
}

export default function ConcordanceCard({
  iTransformerForecast: itf,
  ensemblePrediction: ens,
  symbol,
}: ConcordanceCardProps) {
  const currentPrice = itf.current_price;

  // iTransformer 30d prediction
  const itf30dReturn = itf.forecast_returns[29] ?? itf.forecast_returns[itf.forecast_returns.length - 1] ?? 0;
  const itf30dPct = itf30dReturn * 100;
  const itfDirection = getDirection(itf30dPct);

  // Ensemble 30d prediction
  const ens30d = ens.predictions.find((p) => p.daysOut === 30) ?? ens.predictions[0];
  const ens30dPct = ens30d ? ((ens30d.predicted - currentPrice) / currentPrice) * 100 : 0;
  const ensDirection = getDirection(ens30dPct);

  // Ensemble score direction
  const ensScoreDirection: "bullish" | "bearish" | "neutral" =
    ens.ensembleScore > 20 ? "bullish" : ens.ensembleScore < -20 ? "bearish" : "neutral";

  // Compute agreement
  let agreement: Agreement;
  if (itfDirection === ensDirection) {
    agreement = "concordant";
  } else if (itfDirection === "neutral" || ensDirection === "neutral") {
    agreement = "partial";
  } else {
    agreement = "discordant";
  }

  // Agreement with individual ensemble models
  const modelAgreement = ens.modelSignals.map((m) => ({
    model: m.model,
    signal: m.signal,
    agrees: m.signal === itfDirection || m.signal === "neutral" || itfDirection === "neutral",
  }));
  const agreeCount = modelAgreement.filter((m) => m.agrees).length;
  const agreePct = Math.round((agreeCount / modelAgreement.length) * 100);

  // Put selling concordance
  const itfSupportsPutSelling = itfDirection !== "bearish";
  const ensSupportsPutSelling = ens.putSellingWindow.recommended;
  const putConcordant = itfSupportsPutSelling === ensSupportsPutSelling;

  const agreementStyle = {
    concordant: {
      bg: "bg-green-900/20",
      border: "border-green-700/40",
      text: "text-green-400",
      label: "CONCORDANT",
      desc: "Both models agree on direction — higher confidence",
    },
    partial: {
      bg: "bg-yellow-900/15",
      border: "border-yellow-700/30",
      text: "text-yellow-400",
      label: "PARTIAL",
      desc: "One model is neutral — moderate confidence",
    },
    discordant: {
      bg: "bg-red-900/15",
      border: "border-red-700/30",
      text: "text-red-400",
      label: "DISCORDANT",
      desc: "Models disagree on direction — review before acting",
    },
  }[agreement];

  return (
    <div className={`${agreementStyle.bg} border ${agreementStyle.border} rounded-lg p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-gray-300">
            Prediction Concordance — {symbol}
          </h4>
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${agreementStyle.text} ${agreementStyle.bg}`}>
            {agreementStyle.label}
          </span>
        </div>
        <span className="text-[10px] text-gray-500">
          iTransformer vs Statistical Ensemble
        </span>
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div className="bg-gray-900/40 rounded-lg p-3">
          <div className="text-[10px] text-purple-400 font-medium mb-1">iTransformer (Deep Learning)</div>
          <div className={`text-lg font-bold ${itf30dPct > 0.5 ? "text-green-400" : itf30dPct < -0.5 ? "text-red-400" : "text-gray-400"}`}>
            {itf30dPct > 0 ? "+" : ""}{itf30dPct.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500">
            30d prediction &middot; ${(currentPrice * (1 + itf30dReturn)).toFixed(2)}
          </div>
          <div className="text-[10px] text-gray-600 mt-1">
            Confidence: {(itf.model_confidence * 100).toFixed(0)}%
          </div>
        </div>

        <div className="bg-gray-900/40 rounded-lg p-3">
          <div className="text-[10px] text-blue-400 font-medium mb-1">Statistical Ensemble (6 Models)</div>
          <div className={`text-lg font-bold ${ens30dPct > 0.5 ? "text-green-400" : ens30dPct < -0.5 ? "text-red-400" : "text-gray-400"}`}>
            {ens30dPct > 0 ? "+" : ""}{ens30dPct.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500">
            30d prediction &middot; ${ens30d?.predicted.toFixed(2) ?? "—"}
          </div>
          <div className="text-[10px] text-gray-600 mt-1">
            Ensemble score: {ens.ensembleScore > 0 ? "+" : ""}{ens.ensembleScore.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Model agreement breakdown */}
      <div className="flex items-center gap-3 mb-2">
        <div className="text-xs text-gray-400">
          Model agreement: <span className={`font-medium ${agreePct >= 70 ? "text-green-400" : agreePct >= 40 ? "text-yellow-400" : "text-red-400"}`}>{agreePct}%</span>
          <span className="text-gray-600"> ({agreeCount}/{modelAgreement.length} models)</span>
        </div>
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${agreePct >= 70 ? "bg-green-500" : agreePct >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
            style={{ width: `${agreePct}%` }}
          />
        </div>
      </div>

      {/* Put selling concordance */}
      <div className="flex items-center gap-2 text-xs">
        <span className={`px-2 py-0.5 rounded ${putConcordant ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
          Put Selling: {putConcordant ? "Both Agree" : "Disagree"}
        </span>
        <span className="text-gray-500">
          iTransformer: {itfSupportsPutSelling ? "supports" : "caution"} &middot;
          Ensemble: {ensSupportsPutSelling ? "recommends" : "wait"}
        </span>
      </div>

      <p className="text-[10px] text-gray-600 mt-2">{agreementStyle.desc}</p>
    </div>
  );
}
